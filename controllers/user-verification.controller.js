const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { db } = require('../models');
const VerificationRequest = db.VerificationRequest;
const User = db.User;
const Payment = db.Payment;
const Plan = db.Plan;
const Subscription = db.Subscription;

const { 
  initiateGatewayPayment, verifyGatewayPayment, createStripeSubscription, createPayPalSubscription,calculateNextBillingDate
} = require('../helper/paymentHelpers');

exports.initiateVerification = async (req, res) => {
  const userId = req.user._id;
  const { full_name, category, currency = 'USD', payment_gateway, plan_slug, billing_cycle = 'monthly' } = req.body;
  let amount = req.body.amount;

  try {
    if (!full_name || !category || !payment_gateway) {
      return res.status(400).json({ message: 'full_name, category, and payment_gateway are required' });
    }

    const validGateways = ['stripe', 'paypal'];
    if (!validGateways.includes(payment_gateway.toLowerCase())) {
      return res.status(400).json({ message: 'Invalid payment gateway. Must be stripe or paypal' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.is_verified && !plan_slug) {
      return res.status(400).json({ message: 'User is already verified. To subscribe to a plan, please select a plan.' });
    }

    if (!user.is_verified) {
      const existingRequest = await VerificationRequest.findOne({ user_id: userId, status: { $in: ['pending', 'approved'] }});
      if (existingRequest?.status === 'approved') {
        return res.status(400).json({ message: 'User is already verified' });
      }
      
      if (existingRequest?.status === 'pending') {
        return res.status(400).json({ message: 'Verification request already submitted.' });
      }
    }

    let plan = null;
    let subscription = null;
    let verificationSource = 'user_paid';

    if (plan_slug) {
      plan = await Plan.findOne({ slug: plan_slug, status: 'active' });
      if (!plan) {
        return res.status(404).json({ message: 'Plan not found or inactive' });
      }

      const existingSubscription = await Subscription.findOne({
        user_id: userId,
        status: { $in: ['active', 'past_due', 'trialing'] },
      });

      if (existingSubscription) {
        return res.status(400).json({
          message: 'You already have an active subscription. Please cancel your current subscription before subscribing to a new plan.',
        });
      }

      const calculatedAmount = billing_cycle === 'yearly' ? plan.getYearlyPrice() : plan.price_per_user_per_month;

      subscription = await Subscription.create({
        user_id: userId,
        plan_id: plan._id,
        payment_gateway: payment_gateway.toLowerCase(),
        billing_cycle,
        amount: calculatedAmount,
        currency,
        status: 'incomplete',
      });

      verificationSource = 'subscription';
      amount = calculatedAmount;
    }

    const payment = await Payment.create({
      user_id: userId,
      amount,
      currency,
      payment_gateway: payment_gateway.toLowerCase(),
      reference_type: 'blue_tick',
      reference_id: null,
      status: 'pending',
      subscription_id: subscription?._id || null,
      is_recurring: !!subscription,
      subscription_payment_sequence: subscription ? 1 : null,
    });

    let verification = null;
    if (!user.is_verified) {
      verification = await VerificationRequest.create({
        user_id: userId,
        full_name,
        category,
        status: 'pending',
        payment_id: payment._id,
        verification_source: verificationSource,
        subscription_id: subscription?._id || null,
      });

      await Payment.updateOne({ _id: payment._id }, { reference_id: verification._id });

      if (subscription) {
        await Subscription.updateOne({ _id: subscription._id }, { verification_request_id: verification._id });
      }
    } else if (subscription) {
      await Subscription.updateOne({ _id: subscription._id },{ verification_request_id: null });
    }

    let paymentData;
    try {
      if (subscription) {
        if (payment_gateway.toLowerCase() === 'stripe') {
          paymentData = await createStripeSubscription(subscription, payment, user, plan);
          await Payment.updateOne(
            { _id: payment._id },
            { gateway_order_id: paymentData.gateway_order_id || paymentData.checkout_session_id }
          );

        } else if (payment_gateway.toLowerCase() === 'paypal') {
          paymentData = await createPayPalSubscription(subscription, payment, user, plan);
          await Subscription.updateOne({ _id: subscription._id }, { paypal_subscription_id: paymentData.subscriptionId });
          await Payment.updateOne({ _id: payment._id },{ gateway_order_id: paymentData.gateway_order_id });
        }
      } else {
        paymentData = await initiateGatewayPayment(payment, parseFloat(amount), user);
        await Payment.updateOne({ _id: payment._id },{ gateway_order_id: paymentData.gateway_order_id });
      }
    } catch (error) {
      await Payment.updateOne({ _id: payment._id }, { status: 'failed', failure_reason: error.message });

      if (verification) {
        await VerificationRequest.updateOne({ _id: verification._id }, { status: 'payment_failed' });
      }

      if (subscription) {
        await Subscription.updateOne({ _id: subscription._id }, { status: 'incomplete_expired' });
      }

      throw error;
    }

    return res.status(201).json({
      message: subscription ? 'Subscription payment initiated successfully.' : 'Payment initiated successfully.',
      data: {
        request_id: verification?._id?.toString() || null,
        subscription_id: subscription?._id?.toString() || null,
        verification_status: verification ? verification.status : (user.is_verified ? 'approved' : null),
        payment_id: payment._id.toString(),
        payment_status: payment.status,
        payment_gateway: payment.payment_gateway,
        verification_type: subscription ? 'subscription' : 'one_time',
        amount,
        currency,
        ...paymentData,
      },
    });
  } catch (error) {
    console.error('Error in initiateVerification:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.confirmPayment = async (req, res) => {
  const { payment_id, gateway_response } = req.body;

  try {
    if (!payment_id || !mongoose.Types.ObjectId.isValid(payment_id)) {
      return res.status(400).json({ message: 'Valid Payment ID is required' });
    }

    const payment = await Payment.findById(payment_id)
      .select('subscription_id status payment_gateway amount currency is_recurring billing_cycle verificationRequest')
      .lean();

    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ message: `Payment already processed with status: ${payment.status}` });
    }

    console.log(`Starting payment verification for payment ${payment._id}`, {
      payment_id: payment._id, gateway: payment.payment_gateway, gateway_response,
    });

    let verificationResult;
    try {
      verificationResult = await verifyGatewayPayment(payment, gateway_response);
      if (!verificationResult?.transaction_id) {
        throw new Error('Payment verification did not return a valid transaction ID');
      }

    } catch (verificationError) {
      console.error(`Payment verification failed for payment ${payment._id}:`, verificationError);

      await Payment.updateOne(
        { _id: payment._id },
        {
          status: 'failed',
          failure_reason: verificationError.message,
          gateway_response: {
            ...(gateway_response || {}),
            error: verificationError.message,
            error_at: new Date(),
          },
        }
      );

      if (payment.verificationRequest) {
        await VerificationRequest.updateOne({ _id: payment.verificationRequest },{ status: 'payment_failed' });
      }

      if (payment.subscription_id) {
        await Subscription.updateOne({ _id: payment.subscription_id }, { status: 'incomplete_expired' });
      }

      return res.status(400).json({ message: `Payment verification failed: ${verificationError.message}` });
    }

    await Payment.updateOne(
      { _id: payment._id },
      {
        status: 'completed',
        gateway_payment_id: verificationResult.transaction_id,
        gateway_response: {
          ...gateway_response,
          verification_result: verificationResult,
          verified_at: new Date(),
        },
        completed_at: new Date(),
      }
    );

    if (payment.subscription_id) {
      await Subscription.updateOne(
        { _id: payment.subscription_id },
        {
          status: 'active',
          current_period_start: new Date(),
          current_period_end: calculateNextBillingDate(payment.billing_cycle || 'monthly'),
        }
      );
    }

    const verification = payment.verificationRequest
      ? await VerificationRequest.findById(payment.verificationRequest).select('_id status').lean()
      : null;

    const subscription = payment.subscription_id
      ? await Subscription.findById(payment.subscription_id).select('status').lean()
      : null;

    return res.status(200).json({
      message: payment.is_recurring
        ? 'Subscription activated successfully. Please upload your documents.'
        : 'Payment completed successfully. Please upload your documents.',
      data: {
        payment_id: payment._id.toString(),
        request_id: verification?._id?.toString() || null,
        payment_status: 'completed',
        verification_status: verification?.status || 'pending',
        amount: payment.amount,
        currency: payment.currency,
        subscription_id: payment.subscription_id?.toString() || null,
        subscription_status: subscription?.status || null,
      },
    });
  } catch (error) {
    console.error('Error in confirmPayment:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.syncStripeSubscription = async (req, res) => {
  const userId = req.user._id;
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ message: 'Session ID is required' });
  }

  try {
    const sessionData = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'], });
    if (!sessionData) {
      return res.status(404).json({ message: 'Checkout session not found' });
    }

    const subscriptionId = sessionData.metadata?.subscription_id;
    const paymentId = sessionData.metadata?.payment_id;
    const stripeSubscriptionId =
      typeof sessionData.subscription === 'string' ? sessionData.subscription : sessionData.subscription?.id || null;

    if (!subscriptionId || !paymentId) {
      return res.status(400).json({ message: 'Invalid session metadata' });
    }

    const subscription = await Subscription.findOne({ _id: subscriptionId, user_id: userId });
    const payment = await Payment.findById(paymentId);
    if (!subscription || !payment) {
      return res.status(404).json({ message: 'Subscription or payment not found' });
    }

    let currentPeriodStart = new Date();
    let currentPeriodEnd = calculateNextBillingDate(subscription.billing_cycle);

    if (stripeSubscriptionId) {
      let stripeSub = null;
      try {
        stripeSub = typeof sessionData.subscription === 'object' 
          ? sessionData.subscription : await stripe.subscriptions.retrieve(stripeSubscriptionId);

      } catch (stripeError) {
        console.error('Error retrieving Stripe subscription details:', stripeError);
      }

      if (stripeSub && stripeSub.current_period_start && stripeSub.current_period_end) {
        currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
        currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
      }
    }

    await Subscription.updateOne(
      { _id: subscription._id },
      {
        stripe_subscription_id: stripeSubscriptionId || undefined,
        status: 'active',
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
      }
    );

    if (payment.status === 'pending') {
      await Payment.updateOne(
        { _id: payment._id },
        {
          status: 'completed',
          gateway_payment_id: sessionData.payment_intent || sessionData.id,
          gateway_response: sessionData,
          completed_at: new Date(),
        }
      );
    }

    return res.json({
      success: true,
      message: 'Subscription synced successfully',
      data: {
        subscription_id: subscription._id.toString(),
        stripe_subscription_id: stripeSubscriptionId || null,
        status: 'active',
        payment_status: 'completed',
        current_period_start: currentPeriodStart.toISOString(),
        current_period_end: currentPeriodEnd.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error syncing Stripe subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync subscription',
      error: error.message || 'Unknown error',
    });
  }
};

exports.completeSubscriptionPayment = async (req, res) => {
  try {
    const { subscription_id } = req.body;

    if (!subscription_id || !mongoose.Types.ObjectId.isValid(subscription_id)) {
      return res.status(400).json({ message: 'Valid subscription_id required' });
    }

    const subscription = await Subscription.findById(subscription_id)
      .populate({ path: 'payments', match: { status: 'pending' }});

    if (!subscription || !subscription.stripe_subscription_id) {
      return res.status(404).json({ message: 'Stripe subscription not found' });
    }

    let stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
      expand: ['latest_invoice'],
    });

    if (!stripeSub.latest_invoice) {
      const invoice = await stripe.invoices.create({
        customer: stripeSub.customer,
        subscription: stripeSub.id,
        collection_method: 'charge_automatically',
        auto_advance: true,
      });
      stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, { expand: ['latest_invoice'] });
    }

    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: { number: '4242424242424242', exp_month: 12, exp_year: 34, cvc: '123' },
    });

    await stripe.paymentMethods.attach(paymentMethod.id, { customer: stripeSub.customer });

    await stripe.customers.update(stripeSub.customer, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });

    const paidInvoice = await stripe.invoices.pay(stripeSub.latest_invoice.id, {
      payment_method: paymentMethod.id,
      paid_out_of_band: true,
    });

    const finalSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const payment = subscription.payments[0];

      await payment.updateOne({
        status: 'completed',
        gateway_payment_id: paidInvoice.payment_intent || `invoice_${paidInvoice.id}`,
        gateway_response: paidInvoice,
        completed_at: new Date(),
        payment_method: 'card',
        payment_method_id: paymentMethod.id,
      });

      await subscription.updateOne({
        status: 'active',
        current_period_start: new Date(paidInvoice.period_start * 1000),
        current_period_end: new Date(paidInvoice.period_end * 1000),
        payment_method_id: paymentMethod.id,
      });

      await session.commitTransaction();
    } catch (dbError) {
      await session.abortTransaction();
      throw dbError;
    } finally {
      session.endSession();
    }

    return res.json({
      message: 'Subscription payment completed successfully',
      data: {
        subscription_id: subscription._id.toString(),
        stripe_subscription_id: subscription.stripe_subscription_id,
        invoice_id: paidInvoice.id,
        invoice_status: paidInvoice.status,
        amount_paid: paidInvoice.amount_paid / 100,
        subscription_status: 'active',
        payment_method_id: paymentMethod.id,
        next_billing: new Date(paidInvoice.period_end * 1000),
      },
    });
  } catch (error) {
    console.error('❌ Complete payment error:', error);
    return res.status(400).json({
      error: error.message,
      code: error.code,
      note: 'Check Stripe dashboard for invoice status',
    });
  }
};

exports.uploadDocuments = async (req, res) => {
  const { request_id, subscription_id, document_type, full_name, category } = req.body;
  const userId = req.user._id;

  try {
    if (!document_type) {
      return res.status(400).json({ message: 'Document type is required.' });
    }

    if (!req.files?.front || !req.files?.selfie) {
      return res.status(400).json({ message: 'Document front and selfie are required.' });
    }

    if (!request_id && !subscription_id) {
      return res.status(400).json({ message: 'Either request_id or subscription_id is required.' });
    }

    let verification = null;

    if (request_id) {

      verification = await VerificationRequest.findOne({ request_id: request_id, user_id: userId, }).lean();
      if (!verification) {
        return res.status(404).json({ message: 'Verification request not found' });
      }

      if (verification.payment_id) {
        const payment = await Payment.findById(verification.payment_id).lean();
        if (payment?.status !== 'completed') {
          return res.status(400).json({ message: 'Please complete payment before uploading documents.' });
        }
      }
    } else if (subscription_id) {
      const subscription = await Subscription.findOne({ _id: new mongoose.Types.ObjectId(subscription_id), user_id: userId }).lean();
      if (!subscription) {
        return res.status(404).json({ message: 'Subscription not found' });
      }

      if (subscription.status !== 'active') {
        return res.status(400).json({ message: 'Subscription must be active to upload documents.' });
      }

      verification = await VerificationRequest.findOne({ subscription_id: new mongoose.Types.ObjectId(subscription_id), user_id: userId }).lean();
      if (!verification) {
        if (!full_name || !category) {
          return res.status(400).json({ message: 'full_name and category are required when creating a new verification request.' });
        }

        const user = await User.findById(userId).select('is_verified').lean();
        if (user?.is_verified) {
          return res.status(400).json({ message: 'User is already verified.' });
        }

        const completedPayment = await Payment.findOne({
          subscription_id: new mongoose.Types.ObjectId(subscription_id),
          user_id: userId,
          status: 'completed',
        }).sort({ completed_at: -1 }).lean();

        verification = await VerificationRequest.create({
          user_id: userId,
          full_name,
          category: category.toLowerCase(),
          document_type: null,
          document_front: null,
          document_back: null,
          selfie: null,
          status: 'pending',
          payment_id: completedPayment?._id || null,
          verification_source: 'subscription',
          subscription_id: subscription._id,
        });

        if (completedPayment) {
          await Payment.updateOne({ _id: completedPayment._id }, { reference_id: verification._id });
        }
        await Subscription.updateOne({ _id: subscription._id }, { verification_request_id: verification._id });
      }
    }

    if (verification.document_front && verification.selfie) {
      return res.status(400).json({ message: 'Documents already uploaded.' });
    }

    await VerificationRequest.updateOne(
      { _id: verification._id },
      {
        document_type: document_type.toLowerCase(),
        document_front: req.files.front[0].path,
        document_back: req.files.back?.[0]?.path || null,
        selfie: req.files.selfie[0].path,
        status: 'pending',
        updated_at: new Date(),
      }
    );

    return res.status(200).json({
      message: 'Documents uploaded successfully. Your verification is now under review.',
      data: {
        request_id: verification._id.toString(),
        document_type: document_type,
        verification_status: 'pending',
      },
    });
  } catch (error) {
    console.error('Error in uploadDocuments:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};
  
exports.getMyVerificationStatus = async (req, res) => {
  const userId = req.user._id;

  try {
    const verification = await VerificationRequest.findOne({ user_id: userId }).sort({ created_at: -1 })
      .select([
        '_id', 'user_id', 'request_id', 'full_name', 'category', 'document_type',
        'document_front', 'document_back', 'selfie', 'status', 'payment_id',
        'verification_source', 'subscription_id', 'rejection_reason', 'reviewed_by',
        'reviewed_at', 'admin_notes', 'created_at', 'updated_at',
    ]).lean();

    const user = await User.findById(userId).select('id is_verified verified_at').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let payment = null;
    if (verification?.payment_id) {
      payment = await Payment.findById(verification.payment_id).select('id amount status currency payment_gateway completed_at').lean();
    }

    const responseData = {
      id: user._id.toString(),
      is_verified: user.is_verified || false,
      verified_at: user.verified_at || null,
      has_pending_request: !!verification,
      current_request: verification
        ? {
            id: verification._id.toString(),
            user_id: verification.user_id?.toString(),
            request_id: verification.request_id,
            full_name: verification.full_name,
            category: verification.category,
            document_type: verification.document_type,
            document_front: verification.document_front,
            document_back: verification.document_back,
            selfie: verification.selfie,
            status: verification.status,
            payment_id: verification.payment_id?.toString() || null,
            verification_source: verification.verification_source,
            subscription_id: verification.subscription_id?.toString() || null,
            rejection_reason: verification.rejection_reason,
            reviewed_by: verification.reviewed_by?.toString() || null,
            reviewed_at: verification.reviewed_at,
            admin_notes: verification.admin_notes,
            created_at: verification.created_at,
            updated_at: verification.updated_at,
            payment: payment
              ? {
                  id: payment._id.toString(),
                  amount: payment.amount,
                  status: payment.status,
                  currency: payment.currency,
                  payment_gateway: payment.payment_gateway,
                  completed_at: payment.completed_at,
                }
              : null,
          }
        : null,
    };

    return res.status(200).json({ data: responseData });
  } catch (error) {
    console.error('Error in getMyVerificationStatus:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.approveVerificationByAdmin = async (req, res) => {
  const { user_id, category, admin_notes = '', full_name } = req.body;
  const adminId = req.user._id;

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(400).json({ message: 'Only super administrators can grant verification directly.' });
    }

    if (!user_id || !category) {
      return res.status(400).json({ message: 'user_id and category are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      return res.status(400).json({ message: 'Invalid user_id' });
    }

    const user = await User.findById(user_id).select('name avatar email is_verified').lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: 'User is already verified' });
    }

    const requestId = `VRQ-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    const verification = await VerificationRequest.create({
      user_id,
      request_id: requestId,
      full_name: full_name || user.name,
      category,
      document_type: null,
      document_front: null,
      document_back: null,
      selfie: null,
      status: 'approved',
      payment_id: null,
      reviewed_by: adminId,
      reviewed_at: new Date(),
      admin_notes: admin_notes.trim() || `Manually granted by admin ${adminId}`,
      verification_source: 'admin_granted',
    });

    await User.updateOne({ _id: user_id }, { is_verified: true, verified_at: new Date() });

    return res.status(201).json({
      success: true,
      message: 'Verification granted and approved successfully',
      data: {
        id: user._id.toString(),
        name: user.name,
        avatar: user.avatar,
        email: user.email,
        is_verified: true,
        verified_at: new Date(),
        verification_type: category,
        request_id: verification.request_id,
        verification_source: 'admin_granted',
        granted_by: adminId.toString(),
        granted_at: new Date(),
        notes: admin_notes.trim() || null,
        is_immediate_approval: true,
      },
    });
  } catch (error) {
    console.error('Error in approveVerificationByAdmin:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.approveVerification = async (req, res) => {
  const { request_id, admin_notes = '' } = req.body;
  const adminId = req.user._id;

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(400).json({ message: 'Only administrators can approve verification requests' });
    }

    if (!request_id) {
      return res.status(400).json({ message: 'request_id is required' });
    }

    const verification = await VerificationRequest.findOne({ request_id, status: 'pending', })
      .select('user_id category verification_source subscription_id payment_id').lean();

    if (!verification) {
      return res.status(404).json({ message: 'Verification request not found or already processed.' });
    }

    if (verification.payment_id) {
      const payment = await Payment.findById(verification.payment_id).select('status').lean();
      if (payment?.status !== 'completed') {
        return res.status(400).json({
          message: 'Cannot approve. Payment not completed.',
          data: {
            payment_id: verification.payment_id.toString(),
            payment_status: payment?.status || null,
          },
        });
      }
    }

    await VerificationRequest.updateOne(
      { _id: verification._id },
      {
        status: 'approved',
        reviewed_by: adminId,
        reviewed_at: new Date(),
        admin_notes: admin_notes.trim() || null,
        updated_at: new Date(),
      }
    );

    await User.updateOne({ _id: verification.user_id }, { is_verified: true, verified_at: new Date() });

    if (verification.subscription_id && verification.verification_source === 'subscription') {
      await Subscription.updateOne({ _id: verification.subscription_id }, { status: 'active' });
    }

    const user = await User.findById(verification.user_id).select('name').lean();

    return res.status(200).json({
      message: 'Verification approved successfully',
      data: {
        request_id: verification.request_id,
        user_id: verification.user_id.toString(),
        user_name: user?.name || null,
        verification_type: verification.category,
        verification_source: verification.verification_source,
        subscription_id: verification.subscription_id?.toString() || null,
        approved_at: new Date(),
        reviewed_by: adminId.toString(),
      },
    });
  } catch (error) {
    console.error('Error in approveVerification:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.rejectVerification = async (req, res) => {
  const { request_id, rejection_reason, admin_notes = '' } = req.body;
  const adminId = req.user._id;

  try {
    if (!rejection_reason) {
      return res.status(400).json({ message: 'Rejection reason is required.' });
    }

    if (req.user.role !== 'super_admin') {
      return res.status(400).json({ message: 'Only admin can reject verification request.' });
    }

    if (!request_id) {
      return res.status(400).json({ message: 'request_id is required' });
    }

    const verification = await VerificationRequest.findOne({ request_id, status: 'pending', })
      .select('user_id verification_source request_id').lean();

    if (!verification) {
      return res.status(404).json({ message: 'Verification request not found or already processed.' });
    }

    await VerificationRequest.updateOne(
      { _id: verification._id },
      {
        status: 'rejected',
        rejection_reason: rejection_reason.trim(),
        reviewed_by: adminId,
        reviewed_at: new Date(),
        admin_notes: admin_notes.trim() || null,
        updated_at: new Date(),
      }
    );

    return res.status(200).json({
      message: 'Verification rejected successfully.',
      data: {
        request_id: verification.request_id,
        user_id: verification.user_id.toString(),
        verification_source: verification.verification_source || 'user_paid',
        rejected_at: new Date(),
        rejection_reason: rejection_reason.trim(),
        reviewed_by: adminId.toString(),
      },
    });
  } catch (error) {
    console.error('Error in rejectVerification:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.fetchAllVerificationRequests = async (req, res) => {
  let { page = 1, limit = 20, search = '', status = '', filter = '' } = req.query;
  page = parseInt(page);
  limit = Math.min(parseInt(limit), 100);
  const skip = (page - 1) * limit;

  try {
    const searchText = search.trim();
    const statusFilter = status.trim();
    const sourceFilter = filter ? filter.split(',').map(f => f.trim()) : [];
    const matchStage = {};

    if (statusFilter && ['pending', 'approved', 'rejected', 'payment_failed'].includes(statusFilter)) {
      matchStage.status = statusFilter;
    }

    if (sourceFilter.length > 0) {
      const allowed = ['admin_granted', 'subscription', 'user_paid'];
      const validSources = sourceFilter.filter(s => allowed.includes(s));
      if (validSources.length > 0) {
        matchStage.verification_source = { $in: validSources };
      }
    }

    const pipeline = [{ $match: matchStage }];

    if (searchText) {
      const regex = new RegExp(searchText, 'i');
      pipeline.push({
        $match: {$or: [{ full_name: regex }, { document_type: regex }, { category: regex }, { request_id: regex }]},
      });
    }

    const totalPipeline = [...pipeline, { $count: 'total' }];
    const [totalResult] = await VerificationRequest.aggregate(totalPipeline);
    const total = totalResult ? totalResult.total : 0;

    const requests = await VerificationRequest.aggregate([
      ...pipeline,
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user' }},
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'payments', localField: 'payment_id', foreignField: '_id', as: 'payment' }},
      { $unwind: { path: '$payment', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'subscriptions', localField: 'subscription_id', foreignField: '_id', as: 'subscription' }},
      { $unwind: { path: '$subscription', preserveNullAndEmptyArrays: true } },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          request_id: 1,
          full_name: 1,
          category: 1,
          document_type: 1,
          document_front_url: '$document_front',
          document_back_url: '$document_back',
          selfie_url: '$selfie',
          has_documents: { $and: [{ $ne: ['$document_front', null] },{ $ne: ['$selfie', null] }]},
          verification_status: '$status',
          verification_source: 1,
          submitted_at: '$created_at',
          updated_at: 1,
          user: {
            id: '$user._id',
            name: '$user.name',
            email: '$user.email',
            avatar: '$user.avatar',
            is_verified: '$user.is_verified',
            verified_at: '$user.verified_at',
            country: '$user.country',
            phone: '$user.phone',
            created_at: '$user.created_at',
          },
          payment: {
            id: '$payment._id',
            amount: '$payment.amount',
            currency: '$payment.currency',
            payment_gateway: '$payment.payment_gateway',
            payment_method: '$payment.payment_method',
            gateway_order_id: '$payment.gateway_order_id',
            gateway_payment_id: '$payment.gateway_payment_id',
            status: '$payment.status',
            failure_reason: '$payment.failure_reason',
            completed_at: '$payment.completed_at',
            created_at: '$payment.created_at',
            updated_at: '$payment.updated_at',
          },
          subscription: {
            id: '$subscription._id',
            status: '$subscription.status',
            plan_id: '$subscription.plan_id',
            billing_cycle: '$subscription.billing_cycle',
            amount: '$subscription.amount',
            currency: '$subscription.currency',
          },
          can_approve: {
            $and: [
              { $eq: ['$status', 'pending'] },
              {
                $or: [
                  { $eq: ['$verification_source', 'admin_granted'] },
                  { $eq: ['$payment.status', 'completed'] },
                  { $eq: ['$subscription.status', 'active'] },
                ],
              },
            ],
          },
        },
      },
    ]);

    const summary = {
      total_count: total,
      pending_count: requests.filter(r => r.verification_status === 'pending').length,
      approved_count: requests.filter(r => r.verification_status === 'approved').length,
      rejected_count: requests.filter(r => r.verification_status === 'rejected').length,
      admin_granted_count: requests.filter(r => r.verification_source === 'admin_granted').length,
      subscription_count: requests.filter(r => r.verification_source === 'subscription').length,
      user_paid_count: requests.filter(r => r.verification_source === 'user_paid').length,
    };

    const transformedRequests = requests.map(r => ({
      id: r._id?.toString() || null,
      request_id: r.request_id,
      full_name: r.full_name,
      category: r.category,
      document_type: r.document_type,
      document_front_url: r.document_front_url,
      document_back_url: r.document_back_url,
      selfie_url: r.selfie_url,
      has_documents: r.has_documents,
      verification_status: r.verification_status,
      verification_source: r.verification_source,
      submitted_at: r.submitted_at,
      updated_at: r.updated_at,
      user: r.user ? {
        id: r.user.id?.toString() || null,
        name: r.user.name,
        email: r.user.email,
        avatar: r.user.avatar,
        is_verified: r.user.is_verified,
        verified_at: r.user.verified_at,
        country: r.user.country,
        phone: r.user.phone,
        created_at: r.user.created_at,
      } : null,
      payment: r.payment ? {
        id: r.payment.id?.toString() || null,
        amount: r.payment.amount,
        currency: r.payment.currency,
        payment_gateway: r.payment.payment_gateway,
        payment_method: r.payment.payment_method,
        gateway_order_id: r.payment.gateway_order_id,
        gateway_payment_id: r.payment.gateway_payment_id,
        status: r.payment.status,
        failure_reason: r.payment.failure_reason,
        completed_at: r.payment.completed_at,
        created_at: r.payment.created_at,
        updated_at: r.payment.updated_at,
      } : null,
      subscription: r.subscription ? {
        id: r.subscription.id?.toString() || null,
        status: r.subscription.status,
        plan_id: r.subscription.plan_id?.toString() || null,
        billing_cycle: r.subscription.billing_cycle,
        amount: r.subscription.amount,
        currency: r.subscription.currency,
      } : null,
      can_approve: r.can_approve,
    }));

    return res.status(200).json({
      message: 'Verification requests fetched successfully',
      data: transformedRequests,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
      summary,
    });
  } catch (error) {
    console.error('Error in fetchAllVerificationRequests:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};