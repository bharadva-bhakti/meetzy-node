const { VerificationRequest, Payment, Subscription, Plan, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');

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
};

async function initStripePayment(payment, amount) {
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: payment.currency,
        description: `Payment for verification - Payment ID: ${payment.id}`,
        metadata: {
            payment_id: payment.id.toString(),
            user_id: payment.user_id.toString(),
            reference_id: payment.reference_id.toString()
        },
        payment_method_types: ['card'],
    });
    return {
        gateway: 'stripe',
        gateway_order_id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        publishable_key: process.env.STRIPE_PUBLISHABLE_KEY
    };
};

async function initPayPalPayment(payment, amount, user) {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
            amount: { currency_code: payment.currency, value: amount.toFixed(2) },
            reference_id: payment.id.toString(),
            description: `Verification Fee - Request ID: ${payment.reference_id}`
        }],
        payer: { email_address: user.email, name: { given_name: user.name }},
        application_context: {
            brand_name: process.env.APP_NAME || 'Your App',
            landing_page: 'BILLING',
            user_action: 'PAY_NOW',
            return_url: `${process.env.FRONTEND_URL}/messenger?payment=success`,
            cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`
        }
    });

    const order = await paypalClient.execute(request);
    const approvalUrl = order.result.links.find(link => link.rel === 'approve').href;

    return {
        gateway: 'paypal',
        gateway_order_id: order.result.id,
        approval_url: approvalUrl
    };
};

async function createStripeSubscription(subscription, payment, user, plan) {
    try {
        // Always create or retrieve Stripe customer first
        let stripeCustomerId = user.stripe_customer_id;
        
        if (stripeCustomerId) {
            try {
                const customer = await stripe.customers.retrieve(stripeCustomerId);
                // Verify customer is not deleted
                if (customer.deleted) {
                    throw new Error('Customer was deleted');
                }
            } catch (error) {
                // Customer doesn't exist or was deleted, clear it from database
                console.log(`Stripe customer ${stripeCustomerId} not found or deleted, creating new customer`);
                stripeCustomerId = null;
                // Clear invalid customer ID from database
                await User.update(
                    { stripe_customer_id: null },
                    { where: { id: user.id } }
                );
            }
        }
        
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.name,
                metadata: {
                    user_id: user.id.toString(),
                    app_user_id: user.id.toString()
                }
            });
            stripeCustomerId = customer.id;

            await User.update(
                { stripe_customer_id: customer.id },
                { where: { id: user.id } }
            );
            user.stripe_customer_id = customer.id;
        }

        // Final safeguard: ensure we have a valid customer ID
        if (!stripeCustomerId || typeof stripeCustomerId !== 'string') {
            throw new Error('Failed to create or retrieve Stripe customer');
        }

        if (!plan.stripe_price_id) {
            const priceData = {
                currency: subscription.currency.toLowerCase(),
                unit_amount: Math.round(parseFloat(subscription.amount) * 100),
                recurring: {
                    interval: subscription.billing_cycle === 'yearly' ? 'year' : 'month',
                },
                product_data: {
                    name: plan.name,
                },
            };

            const price = await stripe.prices.create(priceData);

            const session = await stripe.checkout.sessions.create({
                customer: stripeCustomerId,
                payment_method_types: ['card'],
                mode: 'subscription',
                line_items: [
                    {
                        price: price.id,
                        quantity: 1,
                    },
                ],
                success_url: `${process.env.FRONTEND_URL}/messenger?payment=success&session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`,
                metadata: {
                    subscription_id: subscription.id.toString(),
                    user_id: user.id.toString(),
                    payment_id: payment.id.toString(),
                    plan_id: plan.id.toString(),
                    plan_name: plan.name,
                    billing_cycle: subscription.billing_cycle
                },
                subscription_data: {
                    metadata: {
                        subscription_id: subscription.id.toString(),
                        user_id: user.id.toString(),
                        payment_id: payment.id.toString(),
                        plan_id: plan.id.toString(),
                        app_subscription_id: subscription.id.toString()
                    }
                }
            });

            return {
                gateway: 'stripe',
                subscriptionId: null, // Will be set after checkout completion
                customerId: stripeCustomerId,
                approval_url: session.url, // Checkout Session URL
                publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
                gateway_order_id: session.id,
                checkout_session_id: session.id,
                note: 'Redirect to approval_url to complete payment via Stripe Checkout.'
            };
        }

        // If stripe_price_id exists, create a Stripe Checkout Session for subscription
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [
                {
                    price: plan.stripe_price_id,
                    quantity: 1,
                },
            ],
            success_url: `${process.env.FRONTEND_URL}/messenger?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/messenger?payment=cancel`,
            metadata: {
                subscription_id: subscription.id.toString(),
                user_id: user.id.toString(),
                payment_id: payment.id.toString(),
                plan_id: plan.id.toString(),
                plan_name: plan.name,
                billing_cycle: subscription.billing_cycle
            },
            subscription_data: {
                metadata: {
                    subscription_id: subscription.id.toString(),
                    user_id: user.id.toString(),
                    payment_id: payment.id.toString(),
                    plan_id: plan.id.toString(),
                    app_subscription_id: subscription.id.toString()
                }
            }
        });

        return {
            gateway: 'stripe',
            subscriptionId: null,
            customerId: stripeCustomerId,
            approval_url: session.url,
            publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
            gateway_order_id: session.id,
            checkout_session_id: session.id,
            note: 'Redirect to approval_url to complete payment via Stripe Checkout.'
        };
        
    } catch (error) {
        console.error('Stripe error:', { message: error.message, type: error.type, user_id: user.id });
        throw new Error(`Stripe subscription failed: ${error.message}`);
    }
}

async function createPayPalSubscription(subscription, payment, user, plan) {
    try {
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [
                {
                    amount: {
                        currency_code: subscription.currency,
                        value: parseFloat(subscription.amount).toFixed(2),
                    },
                    reference_id: subscription.id.toString(),
                    description: plan?.name
                        ? `Subscription for ${plan.name}`
                        : 'Subscription payment',
                },
            ],
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
        const approvalUrl = order.result.links.find((link) => link.rel === 'approve')?.href;

        if (!approvalUrl) {
            throw new Error('No approval URL returned from PayPal');
        }

        return {
            gateway: 'paypal',
            subscriptionId: order.result.id,
            approval_url: approvalUrl,
            gateway_order_id: order.result.id
        };
    } catch (error) {
        console.error('PayPal subscription error:', error);
        throw new Error(`PayPal subscription creation failed: ${error.message}`);
    }
};

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
};

async function verifyStripePayment(gatewayResponse) {
    try {
        const { payment_intent_id } = gatewayResponse;
        if (!payment_intent_id) {
            throw new Error('Missing payment_intent_id');
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
        if (paymentIntent.status === 'succeeded') {
            return { transaction_id: paymentIntent.id };
        }

        throw new Error(`Payment failed with status: ${paymentIntent.status}`);
    } catch (error) {
        console.error('Stripe verification error:', error);
        throw new Error(error.message || 'Stripe payment verification failed');
    }
};

async function verifyPayPalPayment(gatewayResponse) {
    try {
        const { orderID } = gatewayResponse;
        if (!orderID) {
            throw new Error('Missing orderID');
        }

        const request = new paypal.orders.OrdersCaptureRequest(orderID);
        request.requestBody({});

        const capture = await paypalClient.execute(request);

        if (capture.result.status === 'COMPLETED') {
            const captureId = capture.result.purchase_units[0].payments.captures[0].id;
            return { transaction_id: captureId };
        }

        throw new Error(`Payment failed with status: ${capture.result.status}`);
    } catch (error) {
        console.error('PayPal verification error:', error);
        throw new Error(error.message || 'PayPal payment verification failed');
    }
};

// Webhooks

async function handleStripePaymentSuccess(paymentIntent) {
    const transaction = await sequelize.transaction();

    try {
        const paymentId = paymentIntent.metadata.payment_id;

        if (!paymentId) {
            console.error('Stripe webhook: No payment_id in metadata');
            await transaction.rollback();
            return;
        }

        const payment = await Payment.findByPk(paymentId, {
            include: [
                { model: VerificationRequest, as: 'verificationRequest' },
                { model: Subscription, as: 'subscription' }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if(!payment){
            console.error(`Stripe webhook: Payment ${paymentId} not found.`);
            await transaction.rollback();
            return;
        }

        if (payment.is_recurring && payment.subscription) {
            await payment.update({
                status:'completed',
                gateway_payment_id: paymentIntent.id,
                gateway_response: paymentIntent,
                completed_at: new Date()
            }, { transaction });

            if (payment.subscription_payment_sequence === 1) {
                await payment.subscription.update({
                    status: 'active',
                    current_period_start: new Date(),
                    current_period_end: calculateNextBillingDate(payment.subscription.billing_cycle)
                }, { transaction });
            }
        } else {
            if(payment.status === 'pending'){
                await payment.update({
                    status:'completed',
                    gateway_payment_id: paymentIntent.id,
                    gateway_response: paymentIntent,
                    completed_at: new Date()
                }, { transaction });

                if (payment.subscription_id) {
                    const subscription = await Subscription.findByPk(payment.subscription_id, {
                        lock: transaction.LOCK.UPDATE,
                        transaction
                    });
                    
                    if (subscription && subscription.status === 'incomplete') {
                        await subscription.update({
                            status: 'active',
                            current_period_start: new Date(),
                            current_period_end: calculateNextBillingDate(subscription.billing_cycle)
                        }, { transaction });
                    }
                }
            }
        }

        await transaction.commit();
        return { success: true, paymentId };
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handleStripePaymentSuccess:', error);
        throw error;
    }
};

async function handleStripePaymentFailure(paymentIntent) {
    const transaction = await sequelize.transaction();
    
    try {
        const paymentId = paymentIntent.metadata.payment_id;
        
        console.log(` Stripe webhook: Payment ${paymentId} failed`);

        const payment = await Payment.findByPk(paymentId, {
            include: [
                { model: VerificationRequest, as: 'verificationRequest' },
                { model: Subscription, as: 'subscription' }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (payment && payment.status === 'pending') {
            await payment.update({
                status: 'failed',
                failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed via webhook',
                gateway_response: paymentIntent
            }, { transaction });
            
            if (payment.verificationRequest) {
                await payment.verificationRequest.update({status: 'payment_failed' }, { transaction });
            }
            
            if (payment.subscription) {
                await payment.subscription.update({ 
                    status: 'incomplete_expired' 
                }, { transaction });
            }
            
            console.log(` Stripe webhook: Payment ${paymentId} marked as failed`);
        }
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback()
        console.error('Error in handleStripePaymentFailure', error);
    }
};

async function handleStripePaymentCanceled(paymentIntent) {
    await handleStripePaymentFailure(paymentIntent);
};

async function handlePayPalPaymentSuccess(webhookEvent) {
    const transaction = await sequelize.transaction();
    
    try {
        const capture = webhookEvent.resource;
        const orderId = capture.id || capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;

        console.log(` PayPal webhook: Processing order ${orderId}`);

        if(!orderId){
            console.error('Paypal webhook : No orderId found.');
            await transaction.rollback();
            return;
        }

        const payment = await Payment.findOne({
            where: { gateway_order_id: orderId, status: 'pending' },
            include: [{ model: VerificationRequest, as: 'verificationRequest' }],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        let paymentAlt;
        if(!payment){
            paymentAlt = await Payment.findOne({
                where: { gateway_payment_id: orderId, status: 'pending' },
                lock: transaction.LOCK.UPDATE,
                transaction
            });
            
            if (!paymentAlt) {
                console.error(` PayPal webhook: Payment not found for order ${orderId}`);
                await transaction.rollback();
                return;
            }
        }

        const targetPayment = payment || paymentAlt;

        await targetPayment.update({
            status: 'completed',
            gateway_payment_id: orderId,
            gateway_response: webhookEvent,
            completed_at: new Date()
        }, { transaction });
        
        console.log(` PayPal webhook: Payment ${targetPayment.id} marked as completed`);
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error(' PayPal webhook success error:', error);
    }
};

async function handlePayPalPaymentFailure(webhookEvent) {
    const transaction = await sequelize.transaction();

    try {
        const capture = webhookEvent.resource;
        const orderId = capture.id;

        const payment = await Payment.findOne({
            where: {
                [Op.or]: [{ gateway_order_id: orderId }, { gateway_payment_id: orderId }],
                status: 'pending'
            },
            include: [{ model: VerificationRequest, as: 'verificationRequest' }],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (payment) {
            await payment.update({
                status: 'failed',
                failure_reason: capture.reason || 'Payment failed via PayPal webhook',
                gateway_response: webhookEvent
            }, { transaction });
            
            if (payment.verificationRequest) {
                await payment.verificationRequest.update({ status: 'payment_failed' }, { transaction });
            }
            
            console.log(` PayPal webhook: Payment ${payment.id} marked as failed`);
        }
        
        await transaction.commit();

    } catch (error) {
        await transaction.rollback();
        console.error(' PayPal webhook failure error:', error);
    }
};

// subscription Functions 
function calculateNextBillingDate(billingCycle) {
    const date = new Date();
    if (billingCycle === 'yearly') {
        date.setFullYear(date.getFullYear() + 1);
    } else {
        date.setMonth(date.getMonth() + 1);
    }
    return date;
};

// Subscription Events
async function handleStripeInvoicePaymentSucceeded(invoice) {
    const transaction = await sequelize.transaction();
    
    try {
        const stripeSubscriptionId = invoice.subscription;
        const subscription = await Subscription.findOne({
            where: { stripe_subscription_id: stripeSubscriptionId },
            include: [
                { model: User, as: 'user' },
                { model: VerificationRequest, as: 'verificationRequest' }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (!subscription) {
            console.error(`Subscription not found for Stripe ID: ${stripeSubscriptionId}`);
            await transaction.rollback();
            return;
        }

        // Create payment record for successful subscription renewal
        const lastPayment = await Payment.findOne({
            where: { subscription_id: subscription.id },
            order: [['subscription_payment_sequence', 'DESC']],
            transaction
        });

        const paymentSequence = lastPayment ? lastPayment.subscription_payment_sequence + 1 : 2;

        const payment = await Payment.create({
            user_id: subscription.user_id,
            subscription_id: subscription.id,
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
            completed_at: new Date()
        }, { transaction });

        // Update subscription dates
        await subscription.update({
            current_period_start: new Date(invoice.period_start * 1000),
            current_period_end: new Date(invoice.period_end * 1000),
            status: 'active'
        }, { transaction });

        console.log(`Subscription ${subscription.id} renewed. Payment ID: ${payment.id}, Sequence: ${paymentSequence}`);
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handleStripeInvoicePaymentSucceeded:', error);
    }
};

async function handleStripeInvoicePaymentFailed(invoice) {
    const transaction = await sequelize.transaction();
    
    try {
        const stripeSubscriptionId = invoice.subscription;
        const subscription = await Subscription.findOne({
            where: { stripe_subscription_id: stripeSubscriptionId },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (subscription) {
            await subscription.update({
                status: 'past_due'
            }, { transaction });

            // Create failed payment record
            await Payment.create({
                user_id: subscription.user_id,
                subscription_id: subscription.id,
                amount: invoice.amount_due / 100,
                currency: invoice.currency.toUpperCase(),
                payment_gateway: 'stripe',
                status: 'failed',
                failure_reason: 'Subscription payment failed',
                gateway_response: invoice,
                is_recurring: true,
                reference_type: 'subscription_renewal'
            }, { transaction });

            console.log(`Subscription ${subscription.id} payment failed. Marked as past_due.`);
        }
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handleStripeInvoicePaymentFailed:', error);
    }
};

async function handleStripeSubscriptionUpdated(stripeSubscription) {
    const transaction = await sequelize.transaction();
    
    try {
        const subscription = await Subscription.findOne({
            where: { stripe_subscription_id: stripeSubscription.id },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (subscription) {
            await subscription.update({
                status: stripeSubscription.status,
                current_period_start: new Date(stripeSubscription.current_period_start * 1000),
                current_period_end: new Date(stripeSubscription.current_period_end * 1000),
                cancel_at_period_end: stripeSubscription.cancel_at_period_end
            }, { transaction });

            // If subscription is canceled or unpaid, revoke verification
            if (['canceled', 'unpaid', 'past_due'].includes(stripeSubscription.status)) {
                const user = await User.findByPk(subscription.user_id, {
                    lock: transaction.LOCK.UPDATE,
                    transaction
                });

                if (user) {
                    await user.update({
                        is_verified: false,
                        verified_at: null
                    }, { transaction });
                }
            }
        }
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handleStripeSubscriptionUpdated:', error);
    }
};

async function handleStripeSubscriptionDeleted(stripeSubscription) {
    const transaction = await sequelize.transaction();
    
    try {
        const subscription = await Subscription.findOne({
            where: { stripe_subscription_id: stripeSubscription.id },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (subscription) {
            await subscription.update({
                status: 'canceled',
                canceled_at: new Date()
            }, { transaction });

            // Revoke verification
            const user = await User.findByPk(subscription.user_id, {
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            if (user) {
                await user.update({
                    is_verified: false,
                    verified_at: null
                }, { transaction });
            }
        }
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handleStripeSubscriptionDeleted:', error);
    }
};

async function handlePayPalSubscriptionPayment(eventData) {
    const transaction = await sequelize.transaction();
    
    try {
        const capture = eventData.resource;
        const subscriptionId = capture.billing_agreement_id || capture.custom_id;
        
        if (!subscriptionId) {
            console.error('PayPal webhook: No subscription ID found');
            await transaction.rollback();
            return;
        }

        const subscription = await Subscription.findOne({
            where: { paypal_subscription_id: subscriptionId },
            include: [
                { model: User, as: 'user' },
                { model: VerificationRequest, as: 'verificationRequest' }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (!subscription) {
            console.error(`Subscription not found for PayPal ID: ${subscriptionId}`);
            await transaction.rollback();
            return;
        }

        const lastPayment = await Payment.findOne({
            where: { subscription_id: subscription.id },
            order: [['subscription_payment_sequence', 'DESC']],
            transaction
        });

        const paymentSequence = lastPayment ? lastPayment.subscription_payment_sequence + 1 : 2;

        const payment = await Payment.create({
            user_id: subscription.user_id,
            subscription_id: subscription.id,
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
            completed_at: new Date()
        }, { transaction });

        // Update subscription dates
        const nextBillingDate = new Date();
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
        
        await subscription.update({
            current_period_end: nextBillingDate,
            status: 'active'
        }, { transaction });

        console.log(`PayPal Subscription ${subscription.id} renewed. Payment ID: ${payment.id}`);
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handlePayPalSubscriptionPayment:', error);
    }
}

async function handlePayPalSubscriptionActivated(eventData) {
    const transaction = await sequelize.transaction();
    
    try {
        const subscriptionId = eventData.resource.id;
        
        const subscription = await Subscription.findOne({
            where: { paypal_subscription_id: subscriptionId },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (subscription) {
            await subscription.update({
                status: 'active',
                current_period_start: new Date(),
                current_period_end: calculateNextBillingDate(subscription.billing_cycle)
            }, { transaction });
            
            console.log(`PayPal Subscription ${subscription.id} activated`);
        }
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handlePayPalSubscriptionActivated:', error);
    }
}

async function handlePayPalSubscriptionCancelled(eventData) {
    const transaction = await sequelize.transaction();
    
    try {
        const subscriptionId = eventData.resource.id;
        
        const subscription = await Subscription.findOne({
            where: { paypal_subscription_id: subscriptionId },
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (subscription) {
            await subscription.update({
                status: 'canceled',
                canceled_at: new Date()
            }, { transaction });

            const user = await User.findByPk(subscription.user_id, {
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            if (user) {
                await user.update({
                    is_verified: false,
                    verified_at: null
                }, { transaction });
            }
            
            console.log(`PayPal Subscription ${subscription.id} cancelled`);
        }
        
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        console.error('Error in handlePayPalSubscriptionCancelled:', error);
    }
};

module.exports = {
    initiateGatewayPayment, initStripePayment, initPayPalPayment,
    verifyGatewayPayment, verifyStripePayment, verifyPayPalPayment,
    handleStripePaymentSuccess, handleStripePaymentFailure, handleStripePaymentCanceled,
    handlePayPalPaymentSuccess, handlePayPalPaymentFailure,
    handleStripeInvoicePaymentSucceeded,
    handleStripeInvoicePaymentFailed,
    handleStripeSubscriptionUpdated,
    handleStripeSubscriptionDeleted,
    createStripeSubscription,
    createPayPalSubscription,
    calculateNextBillingDate,
    handlePayPalSubscriptionPayment,
    handlePayPalSubscriptionActivated,
    handlePayPalSubscriptionCancelled
};