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
        metadata: { user_id: user._id.toString(), app_user_id: user._id.toString() },
      });
      stripeCustomerId = customer.id;

      await User.updateOne({ _id: user._id }, { stripe_customer_id: customer.id });
    }

    if (!plan.stripe_price_id) {
      const priceData = {
        currency: subscription.currency.toLowerCase(),
        unit_amount: Math.round(parseFloat(subscription.amount) * 100),
        recurring: { interval: subscription.billing_cycle === 'yearly' ? 'year' : 'month' },
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
        amount: { currency_code: subscription.currency, value: parseFloat(subscription.amount).toFixed(2) },
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

function calculateNextBillingDate(billingCycle) {
  const date = new Date();
  if (billingCycle === 'yearly') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setMonth(date.getMonth() + 1);
  }
  return date;
}

module.exports = {
  initiateGatewayPayment,
  initStripePayment,
  initPayPalPayment,
  verifyGatewayPayment,
  verifyStripePayment,
  verifyPayPalPayment,
  createStripeSubscription,
  createPayPalSubscription,
  calculateNextBillingDate,
};