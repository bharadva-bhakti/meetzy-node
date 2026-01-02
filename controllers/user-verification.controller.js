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
    initiateGatewayPayment, 
    verifyGatewayPayment, 
    handleStripePaymentSuccess, 
    handleStripePaymentFailure,
    handleStripePaymentCanceled, 
    handlePayPalPaymentSuccess, 
    handlePayPalPaymentFailure, 
    createStripeSubscription, 
    createPayPalSubscription,
    handleStripeInvoicePaymentSucceeded,
    handleStripeInvoicePaymentFailed,
    handleStripeSubscriptionUpdated,
    handleStripeSubscriptionDeleted,
    handlePayPalSubscriptionPayment,
    handlePayPalSubscriptionActivated,
    handlePayPalSubscriptionCancelled,
    calculateNextBillingDate
} = require('../helper/paymentHelpers');

exports.initiateVerification = async (req, res) => {
  const userId = req.user._id;
  const { full_name, category, currency = 'USD', payment_gateway, plan_slug, billing_cycle = 'monthly' } = req.body;
  let amount = req.body.amount;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!full_name || !category || !payment_gateway) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'full_name, category, and payment_gateway are required' });
    }

    const validGateways = ['stripe', 'paypal'];
    if (!validGateways.includes(payment_gateway.toLowerCase())) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid payment gateway. Must be stripe or paypal' });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'User not found.' });
    }

    if (user.is_verified && !plan_slug) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'User is already verified. To subscribe to a plan, please select a plan.' });
    }

    if (!user.is_verified) {
      const existingRequest = await VerificationRequest.findOne({
        user_id: userId,
        status: { $in: ['pending', 'approved'] },
      }).session(session);

      if (existingRequest) {
        if (existingRequest.status === 'approved') {
          await session.abortTransaction();
          return res.status(400).json({ message: 'User is already verified' });
        }
        if (existingRequest.status === 'pending') {
          await session.abortTransaction();
          return res.status(400).json({ message: 'Verification request already submitted.' });
        }
      }
    }

    let plan = null;
    let subscription = null;
    let verificationSource = 'user_paid';

    if (plan_slug) {
      plan = await Plan.findOne({
        slug: plan_slug,
        status: 'active',
      }).session(session);

      if (!plan) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Plan not found or inactive' });
      }

      const existingSubscription = await Subscription.findOne({
        user_id: userId,
        status: { $in: ['active', 'past_due', 'trialing'] },
      }).session(session);

      if (existingSubscription) {
        await session.abortTransaction();
        return res.status(400).json({
          message: 'You already have an active subscription. Please cancel your current subscription before subscribing to a new plan.',
        });
      }

      let calculatedAmount;
      if (billing_cycle === 'yearly') {
        calculatedAmount = plan.getYearlyPrice();
      } else {
        calculatedAmount = plan.price_per_user_per_month;
      }

      subscription = await Subscription.create([{
        user_id: userId,
        plan_id: plan._id,
        payment_gateway: payment_gateway.toLowerCase(),
        billing_cycle,
        amount: calculatedAmount,
        currency,
        status: 'incomplete',
      }], { session })[0];

      verificationSource = 'subscription';
      amount = calculatedAmount;
    }

    const payment = await Payment.create([{
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
    }], { session })[0];

    let verification = null;
    if (!user.is_verified) {
      verification = await VerificationRequest.create([{
        user_id: userId,
        full_name,
        category,
        document_type: null,
        document_front: null,
        document_back: null,
        selfie: null,
        status: 'pending',
        payment_id: payment._id,
        verification_source: verificationSource,
        subscription_id: subscription?._id || null,
      }], { session })[0];

      await Payment.updateOne(
        { _id: payment._id },
        { reference_id: verification._id },
        { session }
      );

      if (subscription) {
        await Subscription.updateOne(
          { _id: subscription._id },
          { verification_request_id: verification._id },
          { session }
        );
      }
    } else if (subscription) {
      await Subscription.updateOne(
        { _id: subscription._id },
        { verification_request_id: null },
        { session }
      );
    }

    await session.commitTransaction();

    let paymentData;
    try {
      if (subscription) {
        if (payment_gateway.toLowerCase() === 'stripe') {
          paymentData = await createStripeSubscription(subscription, payment, user, plan);

          const updateSession = await mongoose.startSession();
          updateSession.startTransaction();
          try {
            await Payment.updateOne(
              { _id: payment._id },
              { gateway_order_id: paymentData.gateway_order_id || paymentData.checkout_session_id },
              { session: updateSession }
            );
            await updateSession.commitTransaction();
          } catch (updateError) {
            await updateSession.abortTransaction();
            console.error('Error updating Stripe IDs:', updateError);
          } finally {
            updateSession.endSession();
          }
        } else if (payment_gateway.toLowerCase() === 'paypal') {
          paymentData = await createPayPalSubscription(subscription, payment, user, plan);

          const updateSession = await mongoose.startSession();
          updateSession.startTransaction();
          try {
            await Subscription.updateOne(
              { _id: subscription._id },
              { paypal_subscription_id: paymentData.subscriptionId },
              { session: updateSession }
            );
            await Payment.updateOne(
              { _id: payment._id },
              { gateway_order_id: paymentData.gateway_order_id },
              { session: updateSession }
            );
            await updateSession.commitTransaction();
          } catch (updateError) {
            await updateSession.abortTransaction();
            console.error('Error updating PayPal IDs:', updateError);
          } finally {
            updateSession.endSession();
          }
        }
      } else {
        paymentData = await initiateGatewayPayment(payment, parseFloat(amount), user);

        const updateSession = await mongoose.startSession();
        updateSession.startTransaction();
        try {
          await Payment.updateOne(
            { _id: payment._id },
            { gateway_order_id: paymentData.gateway_order_id },
            { session: updateSession }
          );
          await updateSession.commitTransaction();
        } catch (updateError) {
          await updateSession.abortTransaction();
          console.error('Error updating payment gateway order ID:', updateError);
        } finally {
          updateSession.endSession();
        }
      }
    } catch (error) {
      const errorSession = await mongoose.startSession();
      errorSession.startTransaction();
      try {
        await Payment.updateOne(
          { _id: payment._id },
          { status: 'failed', failure_reason: error.message },
          { session: errorSession }
        );

        if (verification) {
          await VerificationRequest.updateOne(
            { _id: verification._id },
            { status: 'payment_failed' },
            { session: errorSession }
          );
        }

        if (subscription) {
          await Subscription.updateOne(
            { _id: subscription._id },
            { status: 'incomplete_expired' },
            { session: errorSession }
          );
        }

        await errorSession.commitTransaction();
      } catch (dbError) {
        await errorSession.abortTransaction();
        console.error('Error updating failed status:', dbError);
      } finally {
        errorSession.endSession();
      }

      throw new Error(`Payment initiation failed: ${error.message}`);
    }

    return res.status(201).json({
      message: subscription ? 'Subscription payment initiated successfully.' : 'Payment initiated successfully.',
      data: {
        request_id: verification?._id || null,
        subscription_id: subscription?._id.toString() || null,
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
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    console.error('Error in initiateVerification:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    session.endSession();
  }
};

exports.confirmPayment = async (req, res) => {
  const { payment_id, gateway_response } = req.body;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!payment_id || !mongoose.Types.ObjectId.isValid(payment_id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Valid Payment ID is required' });
    }

    const payment = await Payment.findById(payment_id)
      .populate('verificationRequest')
      .populate('subscription')
      .session(session);

    if (!payment) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Payment not found' });
    }

    if (payment.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ message: `Payment already processed with status: ${payment.status}` });
    }

    console.log(`Starting payment verification for payment ${payment._id}`, {
      payment_id: payment._id,
      gateway: payment.payment_gateway,
      gateway_response,
    });

    let verificationResult;
    try {
      verificationResult = await verifyGatewayPayment(payment, gateway_response);

      if (!verificationResult?.transaction_id) {
        throw new Error('Payment verification did not return a valid transaction ID');
      }
    } catch (verificationError) {
      console.error(`Payment verification failed for payment ${payment._id}:`, verificationError);

      await payment.updateOne({
        status: 'failed',
        failure_reason: verificationError.message,
        gateway_response: {
          ...(gateway_response || {}),
          error: verificationError.message,
          error_at: new Date(),
        },
      });

      await payment.verificationRequest?.updateOne({ status: 'payment_failed' });

      if (payment.subscription) {
        await payment.subscription.updateOne({ status: 'incomplete_expired' });
      }

      await session.commitTransaction();
      return res.status(400).json({ message: `Payment verification failed: ${verificationError.message}` });
    }

    await payment.updateOne({
      status: 'completed',
      gateway_payment_id: verificationResult.transaction_id,
      gateway_response: {
        ...gateway_response,
        verification_result: verificationResult,
        verified_at: new Date(),
      },
      completed_at: new Date(),
    });

    if (payment.subscription) {
      await payment.subscription.updateOne({
        status: 'active',
        current_period_start: new Date(),
        current_period_end: calculateNextBillingDate(payment.subscription.billing_cycle),
      });
    }

    await session.commitTransaction();

    return res.status(200).json({
      message: payment.is_recurring
        ? 'Subscription activated successfully. Please upload your documents.'
        : 'Payment completed successfully. Please upload your documents.',
      data: {
        payment_id: payment._id.toString(),
        request_id: payment.verificationRequest?._id || null,
        payment_status: 'completed',
        verification_status: 'pending',
        amount: payment.amount,
        currency: payment.currency,
        subscription_id: payment.subscription?._id.toString() || null,
        subscription_status: payment.subscription?.status || null,
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error('Error in confirmPayment:', error);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    session.endSession();
  }
};

exports.syncStripeSubscription = async (req, res) => {
  const userId = req.user._id;
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ message: 'Session ID is required' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const sessionData = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    if (!sessionData) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Checkout session not found' });
    }

    const subscriptionId = sessionData.metadata?.subscription_id;
    const paymentId = sessionData.metadata?.payment_id;
    const stripeSubscriptionId = typeof sessionData.subscription === 'string'
      ? sessionData.subscription
      : sessionData.subscription?.id || null;

    if (!subscriptionId || !paymentId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid session metadata' });
    }

    const subscription = await Subscription.findOne({
      _id: subscriptionId,
      user_id: userId,
    }).populate('payments').session(session);

    const payment = await Payment.findById(paymentId).session(session);

    if (!subscription || !payment) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Subscription or payment not found' });
    }

    if (stripeSubscriptionId) {
      let stripeSub;
      try {
        stripeSub = typeof sessionData.subscription === 'object'
          ? sessionData.subscription
          : await stripe.subscriptions.retrieve(stripeSubscriptionId);
      } catch (stripeError) {
        console.error('Error retrieving Stripe subscription:', stripeError);
      }

      await subscription.updateOne({
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
        current_period_start: stripeSub ? new Date(stripeSub.current_period_start * 1000) : new Date(),
        current_period_end: stripeSub ? new Date(stripeSub.current_period_end * 1000) : calculateNextBillingDate(subscription.billing_cycle),
      });
    } else {
      await subscription.updateOne({
        status: 'active',
        current_period_start: new Date(),
        current_period_end: calculateNextBillingDate(subscription.billing_cycle),
      });
    }

    if (payment.status === 'pending') {
      await payment.updateOne({
        status: 'completed',
        gateway_payment_id: sessionData.payment_intent || sessionData.id,
        gateway_response: sessionData,
        completed_at: new Date(),
      });
    }

    await session.commitTransaction();

    return res.json({
      success: true,
      message: 'Subscription synced successfully',
      data: {
        subscription_id: subscription._id.toString(),
        stripe_subscription_id: subscription.stripe_subscription_id,
        status: subscription.status,
        payment_status: payment.status,
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error('Error syncing Stripe subscription:', error);
    return res.status(500).json({
      message: 'Failed to sync subscription',
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

exports.completeSubscriptionPayment = async (req, res) => {
  try {
    const { subscription_id } = req.body;

    if (!subscription_id || !mongoose.Types.ObjectId.isValid(subscription_id)) {
      return res.status(400).json({ message: 'Valid subscription_id required' });
    }

    const subscription = await Subscription.findById(subscription_id)
      .populate({
        path: 'payments',
        match: { status: 'pending' },
      });

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
      stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
        expand: ['latest_invoice'],
      });
    }

    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: '4242424242424242',
        exp_month: 12,
        exp_year: 34,
        cvc: '123',
      },
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

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await require('../helper/paymentHelpers').handleStripeCheckoutSessionCompleted?.(event.data.object);
        break;
      case 'customer.subscription.created':
        await require('../helper/paymentHelpers').handleStripeSubscriptionCreated?.(event.data.object);
        break;
      case 'payment_intent.succeeded':
        await handleStripePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handleStripePaymentFailure(event.data.object);
        break;
      case 'payment_intent.canceled':
        await handleStripePaymentCanceled(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handleStripeInvoicePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleStripeInvoicePaymentFailed(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleStripeSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleStripeSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error(`Error processing Stripe webhook ${event.type}:`, error);
    res.status(500).json({ received: true, error: error.message });
  }
};

exports.paypalWebhook = async (req, res) => {
  try {
    const event = req.body;
    console.log(`PayPal webhook received: ${event.event_type}`);

    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        await handlePayPalPaymentSuccess(event);
        break;
      case 'PAYMENT.CAPTURE.DENIED':
        await handlePayPalPaymentFailure(event);
        break;
      case 'PAYMENT.SALE.COMPLETED':
        await handlePayPalSubscriptionPayment(event);
        break;
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handlePayPalSubscriptionActivated(event);
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handlePayPalSubscriptionCancelled(event);
        break;
      default:
        console.log(`Unhandled PayPal event type: ${event.event_type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.uploadDocuments = async (req, res) => {
  const { request_id, subscription_id, document_type, full_name, category } = req.body;
  const userId = req.user._id;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!document_type) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Document type is required.' });
    }

    if (!req.files?.front || !req.files?.selfie) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Document front and selfie are required.' });
    }

    if (!request_id && !subscription_id) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Either request_id or subscription_id is required.' });
    }

    let verification = null;

    if (request_id) {
      if (!mongoose.Types.ObjectId.isValid(request_id)) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Invalid request_id' });
      }

      verification = await VerificationRequest.findOne({
        _id: request_id,
        user_id: userId,
      })
        .populate('payment')
        .session(session);

      if (!verification) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Verification request not found' });
      }

      if (verification.payment?.status !== 'completed') {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Please complete payment before uploading documents.' });
      }
    } else if (subscription_id) {
      if (!mongoose.Types.ObjectId.isValid(subscription_id)) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Invalid subscription_id' });
      }

      const subscription = await Subscription.findOne({
        _id: subscription_id,
        user_id: userId,
      }).session(session);

      if (!subscription) {
        await session.abortTransaction();
        return res.status(404).json({ message: 'Subscription not found' });
      }

      if (subscription.status !== 'active') {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Subscription must be active to upload documents.' });
      }

      verification = await VerificationRequest.findOne({
        subscription_id: subscription_id,
        user_id: userId,
      })
        .populate('payment')
        .session(session);

      if (!verification) {
        if (!full_name || !category) {
          await session.abortTransaction();
          return res.status(400).json({ message: 'full_name and category are required when creating a new verification request.' });
        }

        const user = await User.findById(userId).select('is_verified').session(session);

        if (user.is_verified) {
          await session.abortTransaction();
          return res.status(400).json({ message: 'User is already verified.' });
        }

        const completedPayment = await Payment.findOne({
          subscription_id: subscription_id,
          user_id: userId,
          status: 'completed',
        })
          .sort({ completed_at: -1 })
          .session(session);

        verification = await VerificationRequest.create([{
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
        }], { session })[0];

        if (completedPayment) {
          await Payment.updateOne(
            { _id: completedPayment._id },
            { reference_id: verification._id },
            { session }
          );
        }

        await Subscription.updateOne(
          { _id: subscription._id },
          { verification_request_id: verification._id },
          { session }
        );
      }
    }

    if (verification.document_front && verification.selfie) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Documents already uploaded.' });
    }

    await verification.updateOne({
      document_type: document_type.toLowerCase(),
      document_front: req.files.front[0].path,
      document_back: req.files.back?.[0]?.path || null,
      selfie: req.files.selfie[0].path,
      status: 'pending',
      updated_at: new Date(),
    });

    await session.commitTransaction();

    return res.status(200).json({
      message: 'Documents uploaded successfully. Your verification is now under review.',
      data: {
        request_id: verification._id.toString(),
        document_type: document_type,
        verification_status: 'pending',
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error('Error in uploadDocuments:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    session.endSession();
  }
};

exports.getVerificationStatus = async (req, res) => {
    const { request_id } = req.params;
  
    try {
      const verification = await VerificationRequest.findOne({ request_id })
        .populate({
          path: 'payment',
          select: 'id status failure_reason completed_at gateway_response',
        })
        .lean();
  
      if (!verification) {
        return res.status(404).json({ message: 'Verification request not found' });
      }
  
      return res.json({
        data: {
          request_id: verification.request_id,
          verification_status: verification.status,
          payment_status: verification.payment?.status || 'unknown',
          verification_source: verification.verification_source || 'user_paid',
          last_updated: verification.updated_at,
        },
      });
    } catch (error) {
      console.error('Error in getVerificationStatus:', error);
      return res.status(500).json({ message: 'Internal Server Error' });
    }
};
  
exports.getMyVerificationStatus = async (req, res) => {
const userId = req.user._id;

try {
    const verification = await VerificationRequest.findOne({ user_id: userId })
    .populate({
        path: 'payment',
        select: 'id status amount currency payment_gateway completed_at',
    })
    .sort({ created_at: -1 })
    .select([
        'id', 'user_id', 'request_id', 'full_name', 'category', 'document_type',
        'document_front', 'document_back', 'selfie', 'status', 'payment_id',
        'verification_source', 'subscription_id', 'rejection_reason', 'reviewed_by',
        'reviewed_at', 'admin_notes', 'created_at', 'updated_at',
    ])
    .lean();

    const user = await User.findById(userId)
    .select('id is_verified verified_at')
    .lean();

    if (!user) {
    return res.status(404).json({ message: 'User not found' });
    }

    // Transform to match original response
    const responseData = {
    id: user._id.toString(),
    is_verified: user.is_verified,
    verified_at: user.verified_at,
    has_pending_request: !!verification,
    current_request: verification
        ? {
            ...verification,
            id: verification._id.toString(),
            _id: undefined,
            payment: verification.payment
            ? { ...verification.payment, id: verification.payment._id.toString(), _id: undefined }
            : null,
        }
        : null,
    };

    return res.status(200).json({
    data: responseData,
    });
} catch (error) {
    console.error('Error in getMyVerificationStatus:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
}
};

exports.approveVerificationByAdmin = async (req, res) => {
  const { user_id, category, admin_notes = '', full_name } = req.body;
  const adminId = req.user._id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.user.role !== 'super_admin') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Only super administrators can grant verification directly.' });
    }

    if (!user_id || !category) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'user_id and category are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid user_id' });
    }

    const user = await User.findById(user_id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.is_verified) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'User is already verified' });
    }

    const requestId = `VRQ-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

    const verification = await VerificationRequest.create([{
      user_id: user_id,
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
    }], { session })[0];

    await User.updateOne(
      { _id: user_id },
      { is_verified: true, verified_at: new Date() },
      { session }
    );

    await session.commitTransaction();

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
    if (session.inTransaction()) await session.abortTransaction();
    console.error('Error in approveVerificationByAdmin:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    session.endSession();
  }
};

exports.approveVerification = async (req, res) => {
  const { request_id, admin_notes = '' } = req.body;
  const adminId = req.user._id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (req.user.role !== 'super_admin') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Only administrators can approve verification requests' });
    }

    if (!request_id) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'request_id is required' });
    }

    const verification = await VerificationRequest.findOne({
      request_id,
      status: 'pending',
    })
      .populate('user')
      .populate('payment')
      .populate('subscription')
      .session(session);

    if (!verification) {
      await session.abortTransaction();
      return res.status(404).json({
        message: 'Verification request not found or already processed.',
      });
    }

    if (verification.payment && verification.payment.status !== 'completed') {
      await session.abortTransaction();
      return res.status(400).json({
        message: 'Cannot approve. Payment not completed.',
        data: {
          payment_id: verification.payment?._id?.toString() || null,
          payment_status: verification.payment?.status || null,
        },
      });
    }

    await verification.updateOne({
      status: 'approved',
      reviewed_by: adminId,
      reviewed_at: new Date(),
      admin_notes: admin_notes.trim() || null,
      updated_at: new Date(),
    });

    await User.updateOne(
      { _id: verification.user_id },
      { is_verified: true, verified_at: new Date() },
      { session }
    );

    if (verification.subscription && verification.verification_source === 'subscription') {
      await Subscription.updateOne(
        { _id: verification.subscription._id },
        { status: 'active' },
        { session }
      );
    }

    await session.commitTransaction();

    return res.status(200).json({
      message: 'Verification approved successfully',
      data: {
        request_id: verification.request_id,
        user_id: verification.user_id.toString(),
        user_name: verification.user?.name || null,
        verification_type: verification.category,
        verification_source: verification.verification_source,
        subscription_id: verification.subscription?._id?.toString() || null,
        approved_at: new Date(),
        reviewed_by: adminId.toString(),
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error('Error in approveVerification:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    session.endSession();
  }
};

exports.rejectVerification = async (req, res) => {
  const { request_id, rejection_reason, admin_notes = '' } = req.body;
  const adminId = req.user._id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!rejection_reason) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Rejection reason is required.' });
    }

    if (req.user.role !== 'super_admin') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Only admin can reject verification request.' });
    }

    const verification = await VerificationRequest.findOne({
      request_id,
      status: 'pending',
    })
      .populate('user')
      .populate('payment')
      .session(session);

    if (!verification) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Verification request not found or already processed.' });
    }

    await verification.updateOne({
      status: 'rejected',
      rejection_reason: rejection_reason.trim(),
      reviewed_by: adminId,
      reviewed_at: new Date(),
      admin_notes: admin_notes.trim() || null,
      updated_at: new Date(),
    });

    await session.commitTransaction();

    return res.status(200).json({
      message: 'Verification rejected successfully.',
      data: {
        request_id: verification.request_id,
        user_id: verification.user_id.toString(),
        verification_source: verification.verification_source || 'user_paid',
        rejected_at: new Date(),
        rejection_reason: rejection_reason,
        reviewed_by: adminId.toString(),
      },
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error('Error in rejectVerification:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  } finally {
    session.endSession();
  }
};

exports.fetchPendingRequests = async (req, res) => {
  let { page = 1, limit = 20, search = '' } = req.query;
  page = parseInt(page);
  limit = parseInt(limit);
  const skip = (page - 1) * limit;

  try {
    const searchText = search.trim();
    const matchStage = { status: 'pending' };

    if (searchText) {
      const regex = new RegExp(searchText, 'i');
      matchStage.$or = [
        { full_name: regex },
        { document_type: regex },
        { category: regex },
        { request_id: regex },
      ];
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'payments',
          localField: 'payment_id',
          foreignField: '_id',
          as: 'payment',
        },
      },
      { $unwind: { path: '$payment', preserveNullAndEmptyArrays: false } },
    ];

    if (searchText) {
      const userRegex = new RegExp(searchText, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'user.name': userRegex },
            { 'user.email': userRegex },
          ],
        },
      });
    }

    const totalPipeline = [...pipeline, { $count: 'total' }];
    const [totalResult] = await VerificationRequest.aggregate(totalPipeline);
    const total = totalResult ? totalResult.total : 0;

    const requests = await VerificationRequest.aggregate([
      ...pipeline,
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          verification_id: '$_id',
          request_id: 1,
          full_name: 1,
          category: 1,
          document_type: 1,
          document_front_url: '$document_front',
          document_back_url: '$document_back',
          selfie_url: '$selfie',
          verification_status: '$status',
          submitted_at: '$created_at',
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
          can_approve: { $eq: ['$payment.status', 'completed'] },
        },
      },
    ]);

    const summary = {
      pending_count: total,
      with_payment_completed: requests.filter(r => r.payment?.status === 'completed').length,
      with_payment_failed: requests.filter(r => r.payment?.status === 'failed').length,
      with_payment_pending: requests.filter(r => r.payment?.status === 'pending').length,
    };

    return res.status(200).json({
      message: 'Pending verification requests fetched successfully',
      data: requests.map(r => ({
        ...r,
        verification_id: r.verification_id.toString(),
        user: r.user ? { ...r.user, id: r.user.id.toString() } : null,
        payment: r.payment ? { ...r.payment, id: r.payment.id.toString() } : null,
      })),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
      summary,
    });
  } catch (error) {
    console.error('Error in fetchPendingRequests:', error);
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
    const categoryFilter = status.trim();
    const sourceFilter = filter ? filter.split(',').map(f => f.trim()) : [];

    const matchStage = {};

    if (categoryFilter && ['pending', 'approved', 'rejected', 'payment_failed'].includes(categoryFilter)) {
      matchStage.status = categoryFilter;
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
        $match: {
          $or: [
            { full_name: regex },
            { document_type: regex },
            { category: regex },
            { request_id: regex },
          ],
        },
      });
    }

    const totalPipeline = [...pipeline, { $count: 'total' }];
    const [totalResult] = await VerificationRequest.aggregate(totalPipeline);
    const total = totalResult ? totalResult.total : 0;

    const requests = await VerificationRequest.aggregate([
      ...pipeline,
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'payments',
          localField: 'payment_id',
          foreignField: '_id',
          as: 'payment',
        },
      },
      { $unwind: { path: '$payment', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'subscriptions',
          localField: 'subscription_id',
          foreignField: '_id',
          as: 'subscription',
        },
      },
      { $unwind: { path: '$subscription', preserveNullAndEmptyArrays: true } },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          id: '$_id',
          request_id: 1,
          full_name: 1,
          category: 1,
          document_type: 1,
          document_front_url: '$document_front',
          document_back_url: '$document_back',
          selfie_url: '$selfie',
          has_documents: {
            $and: [
              { $ne: ['$document_front', null] },
              { $ne: ['$selfie', null] },
            ],
          },
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

    return res.status(200).json({
      message: 'Verification requests fetched successfully',
      data: requests.map(r => ({
        ...r,
        id: r.id.toString(),
        user: r.user ? { ...r.user, id: r.user.id.toString() } : null,
        payment: r.payment ? { ...r.payment, id: r.payment.id.toString() } : null,
        subscription: r.subscription ? { ...r.subscription, id: r.subscription.id.toString() } : null,
      })),
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

exports.fetchVerifiedUsers = async (req, res) => {
  let { page = 1, limit = 20, search = '', sort_by = 'verified_at', sort_order = 'DESC', category = '' } = req.query;
  page = parseInt(page);
  limit = Math.min(parseInt(limit), 100);
  const skip = (page - 1) * limit;

  try {
    const searchText = search.trim();
    const categoryFilter = category.trim().toLowerCase();

    const matchStage = {
      is_verified: true,
      status: 'active',
    };

    if (searchText) {
      const regex = new RegExp(searchText, 'i');
      matchStage.$or = [
        { name: regex },
        { email: regex },
        { bio: regex },
        { country: regex },
      ];
    }

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'verificationrequests',
          localField: '_id',
          foreignField: 'user_id',
          as: 'verificationRequests',
        },
      },
      {
        $addFields: {
          verificationRequests: {
            $filter: {
              input: '$verificationRequests',
              cond: { $eq: ['$$this.status', 'approved'] },
            },
          },
        },
      },
      {
        $addFields: {
          latestVerification: { $arrayElemAt: ['$verificationRequests', -1] },
        },
      },
    ];

    if (categoryFilter && ['individual', 'business', 'creator'].includes(categoryFilter)) {
      pipeline.push({
        $match: { 'latestVerification.category': categoryFilter },
      });
    }

    const sortStage = {};
    const allowedSort = ['verified_at', 'name', 'created_at', 'last_seen'];
    if (allowedSort.includes(sort_by)) {
      sortStage[sort_by] = sort_order.toUpperCase() === 'ASC' ? 1 : -1;
    } else {
      sortStage.verified_at = -1;
    }

    const totalPipeline = [...pipeline, { $count: 'total' }];
    const [totalResult] = await User.aggregate(totalPipeline);
    const total = totalResult ? totalResult.total : 0;

    const users = await User.aggregate([
      ...pipeline,
      { $sort: sortStage },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          id: '$_id',
          name: 1,
          avatar: 1,
          bio: 1,
          email: 1,
          country: 1,
          country_code: 1,
          is_verified: 1,
          verification_type: '$latestVerification.category',
          verified_at: 1,
          last_seen: 1,
          is_online: 1,
          account_created: '$created_at',
          phone: 1,
          role: 1,
          verification_request: {
            request_id: '$latestVerification.request_id',
            category: '$latestVerification.category',
            document_type: '$latestVerification.document_type',
            created_at: '$latestVerification.created_at',
          },
        },
      },
    ]);

    return res.status(200).json({
      message: 'Verified users fetched successfully',
      data: users.map(u => ({
        ...u,
        id: u.id.toString(),
      })),
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error in fetchVerifiedUsers:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};