const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const { getEffectiveLimits } = require('../utils/userLimits');
const { db } = require('../models');
const VerificationRequest = db.VerificationRequest;
const User = db.User;
const Payment = db.Payment;
const Plan = db.Plan;
const Subscription = db.Subscription;

// PayPal setup
const paypalEnvironment = process.env.PAYPAL_MODE === 'live'
  ? new paypal.core.LiveEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    )
  : new paypal.core.SandboxEnvironment(
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_CLIENT_SECRET
    );
const paypalClient = new paypal.core.PayPalHttpClient(paypalEnvironment);

exports.getMySubscription = async (req, res) => {
  const userId = req.user._id;

  try {
    const subscription = await Subscription.findOne({
      user_id: userId,
      status: { $in: ['active', 'past_due', 'trialing'] },
    })
      .populate({
        path: 'plan',
        select: 'id name slug description max_members_per_group max_groups max_broadcasts_list max_members_per_broadcasts_list max_status allows_file_sharing price_per_user_per_month price_per_user_per_year billing_cycle status is_default trial_period_days features video_calls_enabled',
      })
      .populate({
        path: 'verificationRequest',
        select: 'request_id status category',
      })
      .populate({
        path: 'payments',
        select: 'id amount status completed_at subscription_payment_sequence',
        options: { sort: { completed_at: -1 }, limit: 5 },
      })
      .sort({ created_at: -1 })
      .lean();

    const user = await User.findById(userId)
      .select('id is_verified verified_at stripe_customer_id')
      .lean();

    return res.json({
      success: true,
      data: {
        user: {
          is_verified: user?.is_verified || false,
          verified_at: user?.verified_at || null,
          stripe_customer_id: user?.stripe_customer_id || null,
        },
        subscription: subscription
          ? {
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
              plan: subscription.plan,
              verification_request: subscription.verificationRequest,
              recent_payments: subscription.payments || [],
            }
          : null,
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

    const subscription = await Subscription.findOne({
      _id: id,
      user_id: userId,
    })
      .populate({
        path: 'plan',
        select: 'id name slug description',
      })
      .populate({
        path: 'verificationRequest',
        select: 'request_id status category',
      })
      .populate({
        path: 'payments',
        select: 'id amount status payment_gateway gateway_payment_id completed_at failure_reason subscription_payment_sequence gateway_response',
        options: { sort: { created_at: -1 } },
      })
      .lean();

    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    // Transform _id to id
    const result = {
      ...subscription,
      id: subscription._id.toString(),
      _id: undefined,
      plan: subscription.plan ? { ...subscription.plan, id: subscription.plan._id.toString(), _id: undefined } : null,
      payments: subscription.payments?.map(p => ({ ...p, id: p._id.toString(), _id: undefined })) || [],
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

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!mongoose.Types.ObjectId.isValid(subscription_id)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: 'Invalid subscription ID' });
    }

    const subscription = await Subscription.findOne({
      _id: subscription_id,
      user_id: userId,
      status: { $in: ['active', 'past_due', 'trialing'] },
    }).session(session);

    if (!subscription) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Active subscription not found',
      });
    }

    if (subscription.payment_gateway === 'stripe' && subscription.stripe_subscription_id) {
      await stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    } else if (subscription.payment_gateway === 'paypal' && subscription.paypal_subscription_id) {
      const request = new paypal.subscriptions.SubscriptionsCancelRequest(
        subscription.paypal_subscription_id
      );
      request.requestBody({ reason: 'Cancelled by user' });

      try {
        await paypalClient.execute(request);
      } catch (paypalError) {
        console.error('PayPal cancellation error:', paypalError);
        // Continue — PayPal might already be cancelled
      }
    }

    subscription.cancel_at_period_end = true;
    await subscription.save({ session });

    await session.commitTransaction();

    return res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of billing period',
      data: {
        subscription_id: subscription._id.toString(),
        cancel_at_period_end: true,
        current_period_end: subscription.current_period_end,
        status: subscription.status,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error cancelling subscription:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to cancel subscription',
      error: error.message,
    });
  } finally {
    session.endSession();
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

    const subscription = await Subscription.findOne({
      _id: subscription_id,
      user_id: userId,
    });

    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const total = await Payment.countDocuments({ subscription_id });

    const payments = await Payment.find({ subscription_id })
      .select('id amount currency status payment_gateway gateway_payment_id completed_at failure_reason subscription_payment_sequence created_at updated_at')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Transform _id to id
    const transformedPayments = payments.map(p => ({
      ...p,
      id: p._id.toString(),
      _id: undefined,
    }));

    return res.json({
      success: true,
      data: {
        payments: transformedPayments,
        pagination: {
          total,
          page,
          limit,
          total_pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error getting subscription payments:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
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
      userQuery.$or = [
        { name: regex },
        { email: regex },
      ];
    }

    const total = await Subscription.countDocuments({
      ...query,
      ...(Object.keys(userQuery).length > 0 && { 'user': userQuery }),
    });

    const subscriptions = await Subscription.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'user_doc',
        },
      },
      { $unwind: { path: '$user_doc', preserveNullAndEmptyArrays: true } },
      { $match: Object.keys(userQuery).length > 0 ? { 'user_doc': userQuery } : {} },
      {
        $lookup: {
          from: 'plans',
          localField: 'plan_id',
          foreignField: '_id',
          as: 'plan_doc',
        },
      },
      { $unwind: { path: '$plan_doc', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'verificationrequests',
          localField: '_id',
          foreignField: 'subscription_id',
          as: 'verificationRequest',
        },
      },
      { $unwind: { path: '$verificationRequest', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          user: {
            id: '$user_doc._id',
            name: '$user_doc.name',
            email: '$user_doc.email',
            avatar: '$user_doc.avatar',
            is_verified: '$user_doc.is_verified',
          },
          plan: {
            id: '$plan_doc._id',
            name: '$plan_doc.name',
            slug: '$plan_doc.slug',
          },
          verification_request: {
            $cond: [
              '$verificationRequest',
              {
                request_id: '$verificationRequest.request_id',
                status: '$verificationRequest.status',
                category: '$verificationRequest.category',
              },
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
      success: true,
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
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};

exports.getUserLimits = async (req, res) => {
  const userId = req.user._id;
  const userRole = req.user.role || 'user';

  try {
    const limits = await getEffectiveLimits(userId, userRole);

    return res.json({
      success: true,
      data: limits,
    });
  } catch (error) {
    console.error('Error getting user limits:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};