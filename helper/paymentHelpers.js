const mongoose = require('mongoose');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
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

// initialize payment
async function initiateGatewayPayment(payment, amount, user) {
  switch (payment.payment_gateway) {
    case 'stripe':
      return await initStripePayment(payment, amount);
    case 'paypal':
      return await initPayPalPayment(payment, amount, user);
    default:
      throw new Error('Unsupported payment gateway');
  }
}

async function initStripePayment(payment, amount) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: payment.currency,
    description: `Payment for verification - Payment ID: ${payment._id}`,
    metadata: {
      payment_id: payment._id.toString(),
      user_id: payment.user_id.toString(),
      reference_id: payment.reference_id.toString(),
    },
    payment_method_types: ['card'],
  });

  return {
    gateway: 'stripe',
    gateway_order_id: paymentIntent.id,
    client_secret: paymentIntent.client_secret,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
  };
}

async function initPayPalPayment(payment, amount, user) {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      amount: { currency_code: payment.currency, value: amount.toFixed(2) },
      reference_id: payment._id.toString(),
      description: `Verification Fee - Request ID: ${payment.reference_id}`,
    }],
    payer: { email_address: user.email, name: { given_name: user.name } },
    application_context: {
      brand_name: process.env.APP_NAME || 'Your App',
      landing_page: 'BILLING',
      user_action: 'PAY_NOW',
      return_url: `${process.env.FRONTEND_URL}/messenger?payment=success`,
      cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`,
    },
  });

  const order = await paypalClient.execute(request);
  const approvalUrl = order.result.links.find(link => link.rel === 'approve').href;

  return {
    gateway: 'paypal',
    gateway_order_id: order.result.id,
    approval_url: approvalUrl,
  };
}

async function createStripeSubscription(subscription, payment, user, plan) {
  try {
    let stripeCustomerId = user.stripe_customer_id;

    if (stripeCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(stripeCustomerId);
        if (customer.deleted) throw new Error('Customer deleted');
      } catch (error) {
        console.log(`Stripe customer ${stripeCustomerId} invalid, creating new`);
        stripeCustomerId = null;
        await User.updateOne({ _id: user._id }, { stripe_customer_id: null });
      }
    }

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          user_id: user._id.toString(),
          app_user_id: user._id.toString(),
        },
      });
      stripeCustomerId = customer.id;

      await User.updateOne({ _id: user._id }, { stripe_customer_id: customer.id });
    }

    if (!plan.stripe_price_id) {
      const priceData = {
        currency: subscription.currency.toLowerCase(),
        unit_amount: Math.round(parseFloat(subscription.amount) * 100),
        recurring: {
          interval: subscription.billing_cycle === 'yearly' ? 'year' : 'month',
        },
        product_data: { name: plan.name },
      };

      const price = await stripe.prices.create(priceData);

      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price: price.id, quantity: 1 }],
        success_url: `${process.env.FRONTEND_URL}/messenger?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`,
        metadata: {
          subscription_id: subscription._id.toString(),
          user_id: user._id.toString(),
          payment_id: payment._id.toString(),
          plan_id: plan._id.toString(),
          plan_name: plan.name,
          billing_cycle: subscription.billing_cycle,
        },
        subscription_data: {
          metadata: {
            subscription_id: subscription._id.toString(),
            user_id: user._id.toString(),
            payment_id: payment._id.toString(),
            plan_id: plan._id.toString(),
            app_subscription_id: subscription._id.toString(),
          },
        },
      });

      return {
        gateway: 'stripe',
        subscriptionId: null,
        customerId: stripeCustomerId,
        approval_url: session.url,
        publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
        gateway_order_id: session.id,
        checkout_session_id: session.id,
        note: 'Redirect to approval_url to complete payment via Stripe Checkout.',
      };
    }

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/messenger?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`,
      metadata: {
        subscription_id: subscription._id.toString(),
        user_id: user._id.toString(),
        payment_id: payment._id.toString(),
        plan_id: plan._id.toString(),
        plan_name: plan.name,
        billing_cycle: subscription.billing_cycle,
      },
      subscription_data: {
        metadata: {
          subscription_id: subscription._id.toString(),
          user_id: user._id.toString(),
          payment_id: payment._id.toString(),
          plan_id: plan._id.toString(),
          app_subscription_id: subscription._id.toString(),
        },
      },
    });

    return {
      gateway: 'stripe',
      subscriptionId: null,
      customerId: stripeCustomerId,
      approval_url: session.url,
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
      gateway_order_id: session.id,
      checkout_session_id: session.id,
      note: 'Redirect to approval_url to complete payment via Stripe Checkout.',
    };
  } catch (error) {
    console.error('Stripe error:', { message: error.message, type: error.type, user_id: user._id });
    throw new Error(`Stripe subscription failed: ${error.message}`);
  }
}

async function createPayPalSubscription(subscription, payment, user, plan) {
  try {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: subscription.currency,
          value: parseFloat(subscription.amount).toFixed(2),
        },
        reference_id: subscription._id.toString(),
        description: plan?.name ? `Subscription for ${plan.name}` : 'Subscription payment',
      }],
      payer: { email_address: user.email, name: { given_name: user.name } },
      application_context: {
        brand_name: process.env.APP_NAME || 'Your App',
        landing_page: 'BILLING',
        user_action: 'PAY_NOW',
        return_url: `${process.env.FRONTEND_URL}/messenger?payment=success`,
        cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`,
      },
    });

    const order = await paypalClient.execute(request);
    const approvalUrl = order.result.links.find(link => link.rel === 'approve')?.href;

    if (!approvalUrl) {
      throw new Error('No approval URL returned from PayPal');
    }

    return {
      gateway: 'paypal',
      subscriptionId: order.result.id,
      approval_url: approvalUrl,
      gateway_order_id: order.result.id,
    };
  } catch (error) {
    console.error('PayPal subscription error:', error);
    throw new Error(`PayPal subscription creation failed: ${error.message}`);
  }
}

// Verify payment
async function verifyGatewayPayment(payment, gatewayResponse) {
  switch (payment.payment_gateway) {
    case 'stripe':
      return await verifyStripePayment(gatewayResponse);
    case 'paypal':
      return await verifyPayPalPayment(gatewayResponse);
    default:
      throw new Error('Unsupported payment gateway');
  }
}

async function verifyStripePayment(gatewayResponse) {
  try {
    const { payment_intent_id } = gatewayResponse;
    if (!payment_intent_id) throw new Error('Missing payment_intent_id');

    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (paymentIntent.status === 'succeeded') {
      return { transaction_id: paymentIntent.id };
    }
    throw new Error(`Payment failed with status: ${paymentIntent.status}`);
  } catch (error) {
    console.error('Stripe verification error:', error);
    throw new Error(error.message || 'Stripe payment verification failed');
  }
}

async function verifyPayPalPayment(gatewayResponse) {
  try {
    const { orderID } = gatewayResponse;
    if (!orderID) throw new Error('Missing orderID');

    let order;
    try {
      const getOrderRequest = new paypal.orders.OrdersGetRequest(orderID);
      const orderResponse = await paypalClient.execute(getOrderRequest);
      order = orderResponse.result;
    } catch (orderError) {
      console.error(`Error fetching PayPal order ${orderID}:`, orderError);
    }

    if (order && order.status === 'COMPLETED') {
      const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      const captureStatus = order.purchase_units?.[0]?.payments?.captures?.[0]?.status;
      if (captureId && captureStatus === 'COMPLETED') {
        return { transaction_id: captureId };
      }
    }

    if (!order || ['APPROVED', 'CREATED'].includes(order?.status)) {
      const captureRequest = new paypal.orders.OrdersCaptureRequest(orderID);
      captureRequest.requestBody({});

      let capture;
      try {
        capture = await paypalClient.execute(captureRequest);
      } catch (captureError) {
        console.error(`PayPal capture error for order ${orderID}:`, captureError);
        throw new Error(`PayPal capture failed: ${captureError.message || 'Unknown error'}`);
      }

      if (capture.result.status === 'COMPLETED') {
        const captureId = capture.result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        if (!captureId) throw new Error('Capture completed but no capture ID found');
        return { transaction_id: captureId };
      } else {
        throw new Error(`Payment capture failed with status: ${capture.result.status}`);
      }
    }

    throw new Error(`Order in invalid state: ${order?.status || 'unknown'}`);
  } catch (error) {
    console.error('PayPal verification error:', error);
    throw new Error(`PayPal verification failed: ${error.message}`);
  }
}

// Webhooks & Events
async function handleStripePaymentSuccess(paymentIntent) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const paymentId = paymentIntent.metadata.payment_id;
    if (!paymentId) {
      console.error('Stripe webhook: No payment_id in metadata');
      await session.abortTransaction();
      return;
    }

    const payment = await Payment.findById(paymentId)
      .populate('verificationRequest')
      .populate('subscription')
      .session(session);

    if (!payment) {
      console.error(`Stripe webhook: Payment ${paymentId} not found`);
      await session.abortTransaction();
      return;
    }

    if (payment.is_recurring && payment.subscription) {
      await payment.updateOne({
        status: 'completed',
        gateway_payment_id: paymentIntent.id,
        gateway_response: paymentIntent,
        completed_at: new Date(),
      });

      if (payment.subscription_payment_sequence === 1) {
        await payment.subscription.updateOne({
          status: 'active',
          current_period_start: new Date(),
          current_period_end: calculateNextBillingDate(payment.subscription.billing_cycle),
        });
      }
    } else if (payment.status === 'pending') {
      await payment.updateOne({
        status: 'completed',
        gateway_payment_id: paymentIntent.id,
        gateway_response: paymentIntent,
        completed_at: new Date(),
      });

      if (payment.subscription_id) {
        const subscription = await Subscription.findById(payment.subscription_id).session(session);
        if (subscription && subscription.status === 'incomplete') {
          await subscription.updateOne({
            status: 'active',
            current_period_start: new Date(),
            current_period_end: calculateNextBillingDate(subscription.billing_cycle),
          });
        }
      }
    }

    await session.commitTransaction();
    return { success: true, paymentId };
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handleStripePaymentSuccess:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

async function handleStripePaymentFailure(paymentIntent) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const paymentId = paymentIntent.metadata.payment_id;
    const payment = await Payment.findById(paymentId)
      .populate('verificationRequest')
      .populate('subscription')
      .session(session);

    if (payment && payment.status === 'pending') {
      await payment.updateOne({
        status: 'failed',
        failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed via webhook',
        gateway_response: paymentIntent,
      });

      if (payment.verificationRequest) {
        await payment.verificationRequest.updateOne({ status: 'payment_failed' });
      }

      if (payment.subscription) {
        await payment.subscription.updateOne({ status: 'incomplete_expired' });
      }
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handleStripePaymentFailure:', error);
  } finally {
    session.endSession();
  }
}

async function handleStripePaymentCanceled(paymentIntent) {
  await handleStripePaymentFailure(paymentIntent);
}

async function handlePayPalPaymentSuccess(webhookEvent) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const capture = webhookEvent.resource;
    const orderId = capture.id || capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;

    if (!orderId) {
      console.error('PayPal webhook: No orderId found');
      await session.abortTransaction();
      return;
    }

    let payment = await Payment.findOne({
      $or: [{ gateway_order_id: orderId }, { gateway_payment_id: orderId }],
      status: 'pending',
    })
      .populate('verificationRequest')
      .session(session);

    if (!payment) {
      console.error(`PayPal webhook: Payment not found for order ${orderId}`);
      await session.abortTransaction();
      return;
    }

    await payment.updateOne({
      status: 'completed',
      gateway_payment_id: orderId,
      gateway_response: webhookEvent,
      completed_at: new Date(),
    });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('PayPal webhook success error:', error);
  } finally {
    session.endSession();
  }
}

async function handlePayPalPaymentFailure(webhookEvent) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const capture = webhookEvent.resource;
    const orderId = capture.id;

    const payment = await Payment.findOne({
      $or: [{ gateway_order_id: orderId }, { gateway_payment_id: orderId }],
      status: 'pending',
    })
      .populate('verificationRequest')
      .session(session);

    if (payment) {
      await payment.updateOne({
        status: 'failed',
        failure_reason: capture.reason || 'Payment failed via PayPal webhook',
        gateway_response: webhookEvent,
      });

      if (payment.verificationRequest) {
        await payment.verificationRequest.updateOne({ status: 'payment_failed' });
      }
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('PayPal webhook failure error:', error);
  } finally {
    session.endSession();
  }
}

function calculateNextBillingDate(billingCycle) {
  const date = new Date();
  if (billingCycle === 'yearly') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setMonth(date.getMonth() + 1);
  }
  return date;
}

// Subscription webhook handlers
async function handleStripeInvoicePaymentSucceeded(invoice) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const stripeSubscriptionId = invoice.subscription;
    const subscription = await Subscription.findOne({ stripe_subscription_id: stripeSubscriptionId })
      .populate('user')
      .populate('verificationRequest')
      .session(session);

    if (!subscription) {
      console.error(`Subscription not found for Stripe ID: ${stripeSubscriptionId}`);
      await session.abortTransaction();
      return;
    }

    const lastPayment = await Payment.findOne({ subscription_id: subscription._id })
      .sort({ subscription_payment_sequence: -1 })
      .session(session);

    const paymentSequence = lastPayment ? lastPayment.subscription_payment_sequence + 1 : 2;

    await Payment.create([{
      user_id: subscription.user_id,
      subscription_id: subscription._id,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency.toUpperCase(),
      payment_gateway: 'stripe',
      status: 'completed',
      gateway_payment_id: invoice.payment_intent,
      gateway_response: invoice,
      is_recurring: true,
      reference_type: 'subscription_renewal',
      reference_id: subscription.verification_request_id,
      subscription_payment_sequence: paymentSequence,
      completed_at: new Date(),
    }], { session });

    await subscription.updateOne({
      current_period_start: new Date(invoice.period_start * 1000),
      current_period_end: new Date(invoice.period_end * 1000),
      status: 'active',
    });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handleStripeInvoicePaymentSucceeded:', error);
  } finally {
    session.endSession();
  }
}

async function handleStripeInvoicePaymentFailed(invoice) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const stripeSubscriptionId = invoice.subscription;
    const subscription = await Subscription.findOne({ stripe_subscription_id: stripeSubscriptionId }).session(session);

    if (subscription) {
      await subscription.updateOne({ status: 'past_due' });

      await Payment.create([{
        user_id: subscription.user_id,
        subscription_id: subscription._id,
        amount: invoice.amount_due / 100,
        currency: invoice.currency.toUpperCase(),
        payment_gateway: 'stripe',
        status: 'failed',
        failure_reason: 'Subscription payment failed',
        gateway_response: invoice,
        is_recurring: true,
        reference_type: 'subscription_renewal',
      }], { session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handleStripeInvoicePaymentFailed:', error);
  } finally {
    session.endSession();
  }
}

async function handleStripeSubscriptionUpdated(stripeSubscription) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subscription = await Subscription.findOne({ stripe_subscription_id: stripeSubscription.id }).session(session);

    if (subscription) {
      await subscription.updateOne({
        status: stripeSubscription.status,
        current_period_start: new Date(stripeSubscription.current_period_start * 1000),
        current_period_end: new Date(stripeSubscription.current_period_end * 1000),
        cancel_at_period_end: stripeSubscription.cancel_at_period_end,
      });

      if (['canceled', 'unpaid', 'past_due'].includes(stripeSubscription.status)) {
        await User.updateOne(
          { _id: subscription.user_id },
          { is_verified: false, verified_at: null }
        );
      }
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handleStripeSubscriptionUpdated:', error);
  } finally {
    session.endSession();
  }
}

async function handleStripeSubscriptionDeleted(stripeSubscription) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subscription = await Subscription.findOne({ stripe_subscription_id: stripeSubscription.id }).session(session);

    if (subscription) {
      await subscription.updateOne({
        status: 'canceled',
        canceled_at: new Date(),
      });

      await User.updateOne(
        { _id: subscription.user_id },
        { is_verified: false, verified_at: null }
      );
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handleStripeSubscriptionDeleted:', error);
  } finally {
    session.endSession();
  }
}

async function handlePayPalSubscriptionPayment(eventData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const capture = eventData.resource;
    const subscriptionId = capture.billing_agreement_id || capture.custom_id;

    if (!subscriptionId) {
      console.error('PayPal webhook: No subscription ID found');
      await session.abortTransaction();
      return;
    }

    const subscription = await Subscription.findOne({ paypal_subscription_id: subscriptionId })
      .populate('user')
      .populate('verificationRequest')
      .session(session);

    if (!subscription) {
      console.error(`Subscription not found for PayPal ID: ${subscriptionId}`);
      await session.abortTransaction();
      return;
    }

    const lastPayment = await Payment.findOne({ subscription_id: subscription._id })
      .sort({ subscription_payment_sequence: -1 })
      .session(session);

    const paymentSequence = lastPayment ? lastPayment.subscription_payment_sequence + 1 : 2;

    await Payment.create([{
      user_id: subscription.user_id,
      subscription_id: subscription._id,
      amount: parseFloat(capture.amount.total),
      currency: capture.amount.currency,
      payment_gateway: 'paypal',
      status: 'completed',
      gateway_payment_id: capture.id,
      gateway_response: eventData,
      is_recurring: true,
      reference_type: 'subscription_renewal',
      reference_id: subscription.verification_request_id,
      subscription_payment_sequence: paymentSequence,
      completed_at: new Date(),
    }], { session });

    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);

    await subscription.updateOne({
      current_period_end: nextBillingDate,
      status: 'active',
    });

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handlePayPalSubscriptionPayment:', error);
  } finally {
    session.endSession();
  }
}

async function handlePayPalSubscriptionActivated(eventData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subscriptionId = eventData.resource.id;
    const subscription = await Subscription.findOne({ paypal_subscription_id: subscriptionId }).session(session);

    if (subscription) {
      await subscription.updateOne({
        status: 'active',
        current_period_start: new Date(),
        current_period_end: calculateNextBillingDate(subscription.billing_cycle),
      });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handlePayPalSubscriptionActivated:', error);
  } finally {
    session.endSession();
  }
}

async function handlePayPalSubscriptionCancelled(eventData) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subscriptionId = eventData.resource.id;
    const subscription = await Subscription.findOne({ paypal_subscription_id: subscriptionId }).session(session);

    if (subscription) {
      await subscription.updateOne({
        status: 'canceled',
        canceled_at: new Date(),
      });

      await User.updateOne(
        { _id: subscription.user_id },
        { is_verified: false, verified_at: null }
      );
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in handlePayPalSubscriptionCancelled:', error);
  } finally {
    session.endSession();
  }
}

module.exports = {
  initiateGatewayPayment,
  initStripePayment,
  initPayPalPayment,
  verifyGatewayPayment,
  verifyStripePayment,
  verifyPayPalPayment,
  handleStripePaymentSuccess,
  handleStripePaymentFailure,
  handleStripePaymentCanceled,
  handlePayPalPaymentSuccess,
  handlePayPalPaymentFailure,
  handleStripeInvoicePaymentSucceeded,
  handleStripeInvoicePaymentFailed,
  handleStripeSubscriptionUpdated,
  handleStripeSubscriptionDeleted,
  createStripeSubscription,
  createPayPalSubscription,
  calculateNextBillingDate,
  handlePayPalSubscriptionPayment,
  handlePayPalSubscriptionActivated,
  handlePayPalSubscriptionCancelled,
};