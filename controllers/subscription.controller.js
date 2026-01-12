const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fetch = require('node-fetch');
const { getEffectiveLimits } = require('../utils/userLimits');
const { db } = require('../models');
const VerificationRequest = db.VerificationRequest;
const User = db.User;
const Payment = db.Payment;
const Plan = db.Plan;
const Subscription = db.Subscription;

exports.getMySubscription = async (req, res) => {
  const userId = req.user._id;

  try {
    const subscriptions = await Subscription.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(userId), status: { $in: ['active', 'past_due', 'trialing'] }}},
      { $sort: { created_at: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: 'plans',
          localField: 'plan_id',
          foreignField: '_id',
          as: 'plan',
          pipeline: [
            {
              $project: {
                id: '$_id',
                _id: 0,
                name: 1,
                slug: 1,
                description: 1,
                max_members_per_group: 1,
                max_groups: 1,
                max_broadcasts_list: 1,
                max_members_per_broadcasts_list: 1,
                max_status: 1,
                allows_file_sharing: 1,
                price_per_user_per_month: 1,
                price_per_user_per_year: 1,
                billing_cycle: 1,
                status: 1,
                is_default: 1,
                trial_period_days: 1,
                features: 1,
                video_calls_enabled: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'verification_requests',
          localField: 'verification_request_id',
          foreignField: '_id',
          as: 'verificationRequest',
          pipeline: [{ $project: { id: '$_id', _id: 0,request_id: 1, status: 1, category: 1 } }],
        },
      },
      { $unwind: { path: '$verificationRequest', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'subscription_id',
          as: 'payments',
          pipeline: [
            { $match: { status: 'completed' }},
            { $project: { id: '$_id', _id: 0, amount: 1, status: 1, completed_at: 1, subscription_payment_sequence: 1 }},
            { $sort: { completed_at: -1 } },
            { $limit: 5 },
          ],
        },
      },
    ]);

    const subscription = subscriptions[0] || null;

    const user = await User.findById(userId).select('id is_verified verified_at stripe_customer_id').lean();

    if (!subscription) {
      return res.json({
        data: {
          user: {
            is_verified: user?.is_verified || false,
            verified_at: user?.verified_at || null,
            stripe_customer_id: user?.stripe_customer_id || null,
          },
          subscription: null,
        },
      });
    }

    const transformedSubscription = {
      id: subscription._id.toString(),
      status: subscription.status,
      billing_cycle: subscription.billing_cycle,
      amount: subscription.amount,
      currency: subscription.currency,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      payment_gateway: subscription.payment_gateway,
      stripe_subscription_id: subscription.stripe_subscription_id,
      paypal_subscription_id: subscription.paypal_subscription_id,
      plan: subscription.plan || null,
      verification_request: subscription.verificationRequest || null,
      recent_payments: subscription.payments || [],
    };

    return res.json({
      data: {
        user: {
          is_verified: user?.is_verified || false,
          verified_at: user?.verified_at || null,
          stripe_customer_id: user?.stripe_customer_id || null,
        },
        subscription: transformedSubscription,
      },
    });
  } catch (error) {
    console.error('Error getting subscription details:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getSubscriptionDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid subscription ID' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const subscriptionId = new mongoose.Types.ObjectId(id);
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const subscriptions = await Subscription.aggregate([
      { $match: { _id: subscriptionId, user_id: userObjectId }},
      {
        $lookup: {
          from: 'plans',
          localField: 'plan_id',
          foreignField: '_id',
          as: 'plan',
          pipeline: [{ $project: { id: '$_id', _id: 0, name: 1, slug: 1, description: 1 }}],
        },
      },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'verification_requests',
          localField: 'verification_request_id',
          foreignField: '_id',
          as: 'verificationRequest',
          pipeline: [{ $project: { request_id: 1, status: 1, category: 1 }}],
        },
      },
      { $unwind: { path: '$verificationRequest', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'subscription_id',
          as: 'payments',
          pipeline: [
            {
              $project: {
                id: '$_id',
                _id: 0,
                amount: 1,
                status: 1,
                payment_gateway: 1,
                gateway_payment_id: 1,
                completed_at: 1,
                failure_reason: 1,
                subscription_payment_sequence: 1,
                gateway_response: 1,
                created_at: 1,
              },
            },
            { $sort: { created_at: -1 } },
          ],
        },
      },
    ]);

    const subscription = subscriptions[0];
    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found or does not belong to you' });
    }

    const result = {
      id: subscription._id.toString(),
      user_id: subscription.user_id.toString(),
      plan_id: subscription.plan_id?.toString() || null,
      payment_gateway: subscription.payment_gateway,
      billing_cycle: subscription.billing_cycle,
      amount: subscription.amount,
      currency: subscription.currency,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      stripe_subscription_id: subscription.stripe_subscription_id,
      paypal_subscription_id: subscription.paypal_subscription_id,
      verification_request_id: subscription.verification_request_id?.toString() || null,
      created_at: subscription.created_at,
      updated_at: subscription.updated_at,
      plan: subscription.plan || null,
      verification_request: subscription.verificationRequest || null,
      payments: subscription.payments.map(p => ({
        id: p.id.toString(),
        amount: p.amount,
        status: p.status,
        payment_gateway: p.payment_gateway,
        gateway_payment_id: p.gateway_payment_id,
        completed_at: p.completed_at,
        failure_reason: p.failure_reason,
        subscription_payment_sequence: p.subscription_payment_sequence,
        gateway_response: p.gateway_response,
        created_at: p.created_at,
      })),
    };

    return res.json({ data: result });
  } catch (error) {
    console.error('Error getting subscription details:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.cancelSubscription = async (req, res) => {
  const { subscription_id } = req.body;
  const userId = req.user._id;

  try {
    if (!mongoose.Types.ObjectId.isValid(subscription_id)) {
      return res.status(400).json({ message: 'Invalid subscription ID' });
    }

    const subscription = await Subscription.findOneAndUpdate(
      {
        _id: subscription_id,
        user_id: userId,
        status: { $in: ['active', 'past_due', 'trialing'] },
        cancel_at_period_end: { $ne: true }
      },
      { $set: { cancel_at_period_end: true } },
      {  new: true, lean: true  }
    );

    if (!subscription) {
      return res.status(404).json({ message: 'Active subscription not found or already cancelled' });
    }

    if (subscription.payment_gateway === 'stripe' && subscription.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
        console.log('Stripe subscription scheduled for cancellation');
      } catch (stripeError) {
        console.error('Stripe cancellation error:', stripeError);
      }
    }

    if (subscription.payment_gateway === 'paypal' && subscription.paypal_subscription_id) {
      try {
        const clientId = process.env.PAYPAL_CLIENT_ID;
        const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          throw new Error('PayPal credentials not configured');
        }

        const baseUrl = process.env.PAYPAL_MODE === 'live'
          ? 'https://api-m.paypal.com'
          : 'https://api-m.sandbox.paypal.com';

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const tokenResponse = await fetch(`${baseUrl}/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Token fetch failed: ${tokenResponse.status} ${errorText}`);
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        const cancelUrl = `${baseUrl}/v1/billing/subscriptions/${subscription.paypal_subscription_id}/cancel`;

        const cancelResponse = await fetch(cancelUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ reason: 'Cancelled by user' }),
        });

        if (cancelResponse.status === 204) {
          console.log('PayPal subscription cancelled successfully');
        } else {
          const errorData = await cancelResponse.json().catch(() => ({}));
          console.error('PayPal cancellation failed:', cancelResponse.status, errorData);
        }
      } catch (paypalError) {
        console.error('PayPal cancellation error:', paypalError);
      }
    }
    return res.json({
      message: 'Subscription will be cancelled at the end of the billing period',
      data: {
        subscription_id: subscription._id.toString(),
        cancel_at_period_end: true,
        current_period_end: subscription.current_period_end,
        status: subscription.status,
      },
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getSubscriptionPayments = async (req, res) => {
  const { subscription_id } = req.params;
  const userId = req.user._id;
  let { page = 1, limit = 20 } = req.query;

  page = parseInt(page);
  limit = Math.min(parseInt(limit), 50);
  const skip = (page - 1) * limit;

  try {
    if (!mongoose.Types.ObjectId.isValid(subscription_id)) {
      return res.status(400).json({ message: 'Invalid subscription ID' });
    }

    const subscription = await Subscription.findOne({ _id: subscription_id, user_id: userId, });
    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const total = await Payment.countDocuments({ subscription_id });

    const payments = await Payment.find({ subscription_id })
      .select(
        'id amount currency status payment_gateway gateway_payment_id completed_at failure_reason subscription_payment_sequence created_at updated_at'
      ).sort({ created_at: -1 }).skip(skip).limit(limit).lean();

    const transformedPayments = payments.map(p => ({ ...p, id: p._id.toString(), _id: undefined, }));

    return res.json({
      data: {
        payments: transformedPayments,
        pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    console.error('Error getting subscription payments:', error);
    return res.status(500).json({ message: 'Internal Server Error', });
  }
};

exports.getAllSubscriptions = async (req, res) => {
  let { page = 1, limit = 20, status = '', search = '' } = req.query;
  page = parseInt(page);
  limit = Math.min(parseInt(limit), 50);
  const skip = (page - 1) * limit;

  try {
    const query = {};
    const userQuery = {};

    if (status && ['active', 'past_due', 'canceled', 'incomplete', 'trialing'].includes(status)) {
      query.status = status;
    }

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      userQuery.$or = [{ name: regex }, { email: regex }];
    }

    const total = await Subscription.countDocuments({
      ...query, ...(Object.keys(userQuery).length > 0 && { 'user': userQuery }),
    });

    const subscriptions = await Subscription.aggregate([
      { $match: query },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user_doc' }},
      { $unwind: { path: '$user_doc', preserveNullAndEmptyArrays: true } },
      { $match: Object.keys(userQuery).length > 0 ? { 'user_doc': userQuery } : {} },
      { $lookup: { from: 'plans', localField: 'plan_id', foreignField: '_id', as: 'plan_doc' }},
      { $unwind: { path: '$plan_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'verification_requests', localField: '_id', foreignField: 'subscription_id', as: 'verificationRequest' }},
      { $unwind: { path: '$verificationRequest', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          user: { id: '$user_doc._id',name: '$user_doc.name',email: '$user_doc.email',avatar: '$user_doc.avatar',is_verified: '$user_doc.is_verified',},
          plan: { id: '$plan_doc._id', name: '$plan_doc.name', slug: '$plan_doc.slug' },
          verification_request: {
            $cond: [
              '$verificationRequest',
              { request_id: '$verificationRequest.request_id', status: '$verificationRequest.status', category: '$verificationRequest.category' },
              null,
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          user_id: 1,
          plan_id: 1,
          status: 1,
          billing_cycle: 1,
          amount: 1,
          currency: 1,
          current_period_start: 1,
          current_period_end: 1,
          cancel_at_period_end: 1,
          payment_gateway: 1,
          stripe_subscription_id: 1,
          paypal_subscription_id: 1,
          created_at: 1,
          updated_at: 1,
          user: 1,
          plan: 1,
          verification_request: 1,
        },
      },
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    return res.json({
      data: subscriptions,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching all subscriptions:', error);
    return res.status(500).json({ message: 'Internal Server Error', });
  }
};

exports.getUserLimits = async (req, res) => {
  const userId = req.user._id;
  const userRole = req.user.role || 'user';

  try {
    const limits = await getEffectiveLimits(userId, userRole);

    return res.json({ data: limits, });
  } catch (error) {
    console.error('Error getting user limits:', error);
    return res.status(500).json({ message: 'Internal Server Error', });
  }
};