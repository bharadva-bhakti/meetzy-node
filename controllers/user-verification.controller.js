const { VerificationRequest, User, Payment, Plan, Subscription, sequelize } = require('../models');
const { Op } = require('sequelize');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');

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

exports.initiateVerification = async (req,res) => { 
    const userId = req.user.id;
    const { full_name, category, currency='USD', payment_gateway, plan_slug, billing_cycle = 'monthly' } = req.body;
    const transaction = await sequelize.transaction(); 
    let amount = req.body.amount;

    try {
        if(!full_name || !category || !payment_gateway){
            return res.status(400).json({ message: 'full_name, category, and payment_gateway are required' });
        }

        const validGateways = ['stripe', 'paypal'];
        if (!validGateways.includes(payment_gateway.toLowerCase())) {
            return res.status(400).json({ message: 'Invalid payment gateway. Must be stripe or paypal'});
        }

        const user = await User.findByPk(userId, { lock: transaction.LOCK.UPDATE, transaction});
        if(!user){
            await transaction.rollback();
            return res.status(404).json({ message: 'User not found.'});
        } 
        
        if(user.is_verified && !plan_slug){
            await transaction.rollback();
            return res.status(400).json({ message: 'User is already verified. To subscribe to a plan, please select a plan.'});
        }

        if (!user.is_verified) {
            const existingRequest = await VerificationRequest.findOne({
                where: { user_id: userId, status: { [Op.in]: ['pending', 'approved'] }},
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            if(existingRequest){
                if (existingRequest.status === 'approved') {
                    await transaction.rollback();
                    return res.status(400).json({ message: 'User is already verified'});
                }
        
                if (existingRequest.status === 'pending') {
                    await transaction.rollback();
                    return res.status(400).json({ message: 'Verification request already submitted.'});
                }    
            }
        }

        let plan = null;
        let subscription = null;
        let verificationSource = 'user_paid';

        if (plan_slug) {
            plan = await Plan.findOne({
                where: { 
                    slug: plan_slug,
                    status: 'active'
                },
                transaction
            });

            if (!plan) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Plan not found or inactive' });
            }

            // Note: stripe_price_id is optional. If not set, we'll create a PaymentIntent directly

            let calculatedAmount;
            if (billing_cycle === 'yearly') {
                calculatedAmount = plan.getYearlyPrice();
            } else {
                calculatedAmount = plan.price_per_user_per_month;
            }

            subscription = await Subscription.create({
                user_id: userId,
                plan_id: plan.id,
                payment_gateway: payment_gateway.toLowerCase(),
                billing_cycle: billing_cycle,
                amount: calculatedAmount,
                currency: currency,
                status: 'incomplete'
            }, { transaction });

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
            subscription_id: subscription ? subscription.id : null,
            is_recurring: subscription ? true : false,
            subscription_payment_sequence: subscription ? 1 : null
        }, { transaction });

        let verification = null;
        if (!user.is_verified) {
            verification = await VerificationRequest.create({
                user_id: userId,
                full_name,
                category,
                document_type: null,
                document_front: null,
                document_back: null,
                selfie: null,
                status: 'pending',
                payment_id: payment.id,
                verification_source: verificationSource,
                subscription_id: subscription ? subscription.id : null
            }, { transaction });
            
            await payment.update({ reference_id: verification.id }, { transaction });
            
            if (subscription) {
                await subscription.update({ verification_request_id: verification.id }, { transaction });
            }
        } else {
            if (subscription) {
                await subscription.update({ verification_request_id: null }, { transaction });
            }
        }

        await transaction.commit();

        let paymentData;

        try {
            if (subscription) {
                if (payment_gateway === 'stripe') {
                    paymentData = await createStripeSubscription(subscription, payment, user, plan);
                    
                    const updateTransaction = await sequelize.transaction();
                    try {
                        await payment.update({ 
                            gateway_order_id: paymentData.gateway_order_id || paymentData.checkout_session_id
                        }, { transaction: updateTransaction });
                        
                        await updateTransaction.commit();
                    } catch (updateError) {
                        await updateTransaction.rollback();
                        console.error('Error updating Stripe IDs:', updateError);
                    }
                } else if (payment_gateway === 'paypal') {
                    paymentData = await createPayPalSubscription(subscription, payment, user, plan);
                    
                    const updateTransaction = await sequelize.transaction();
                    try {
                        await subscription.update({ 
                            paypal_subscription_id: paymentData.subscriptionId 
                        }, { transaction: updateTransaction });
                        
                        await payment.update({ 
                            gateway_order_id: paymentData.gateway_order_id 
                        }, { transaction: updateTransaction });
                        
                        await updateTransaction.commit();
                    } catch (updateError) {
                        await updateTransaction.rollback();
                        console.error('Error updating PayPal IDs:', updateError);
                    }
                }
            } else {
                paymentData = await initiateGatewayPayment(payment, parseFloat(amount), user);
                
                const updateTransaction = await sequelize.transaction();
                try {
                    await payment.update({ 
                        gateway_order_id: paymentData.gateway_order_id 
                    }, { transaction: updateTransaction });
                    
                    await updateTransaction.commit();
                } catch (updateError) {
                    await updateTransaction.rollback();
                    console.error('Error updating payment gateway order ID:', updateError);
                }
            }

        } catch (error) {
            const errorTransaction = await sequelize.transaction();
            try {
                await payment.update({ 
                    status: 'failed', 
                    failure_reason: error.message 
                }, { transaction: errorTransaction });

                if (verification) {
                    await verification.update({ 
                        status: 'payment_failed' 
                    }, { transaction: errorTransaction });
                }

                if (subscription) {
                    await subscription.update({ 
                        status: 'incomplete_expired' 
                    }, { transaction: errorTransaction });
                }
                
                await errorTransaction.commit();
            } catch (dbError) {
                await errorTransaction.rollback();
                console.error('Error updating failed status:', dbError);
            }

            throw new Error(`Payment initiation failed: ${error.message}`);
        }

        return res.status(201).json({
            message: subscription ? 'Subscription payment initiated successfully.' : 'Payment initiated successfully.',
            data: {
                request_id: verification ? verification.request_id : null,
                subscription_id: subscription ? subscription.id : null,
                verification_status: verification ? verification.status : (user.is_verified ? 'approved' : null),
                payment_id: payment.id,
                payment_status: payment.status,
                payment_gateway: payment.payment_gateway,
                verification_type: subscription ? 'subscription' : 'one_time',
                amount,
                currency,
                ...paymentData
            }
        });
    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        console.error('Error in initiateVerification:', error);
        return res.status(500).json({ message: 'Internal Server Error'});
    }
};

exports.confirmPayment = async (req, res) => {
    const { payment_id, gateway_response } = req.body;
    const transaction = await sequelize.transaction();

    try {
        if (!payment_id) {
            return res.status(400).json({ message: 'Payment ID is required'});
        }

        const payment = await Payment.findByPk(payment_id, {
            include: [
                { model: VerificationRequest, as: 'verificationRequest', required: true },
                { model: Subscription, as: 'subscription' }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if (!payment) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Payment not found' });
        }

        if (payment.status !== 'pending') {
            await transaction.rollback();
            return res.status(400).json({ message: `Payment already processed with status: ${payment.status}` });
        }

        let verificationResult;
        try {
            verificationResult = await verifyGatewayPayment(payment, gateway_response);
        } catch (verificationError) {
            await payment.update({
                status: 'failed',
                failure_reason: verificationError.message,
                gateway_response: gateway_response || {}
            });
            
            await payment.verificationRequest.update({ status: 'payment_failed'});
            
            if (payment.subscription) {
                await payment.subscription.update({ status: 'incomplete_expired' });
            }
            
            return res.status(400).json({ message: `Payment verification failed: ${verificationError.message}`});
        }

        await payment.update({
            status: 'completed',
            gateway_payment_id: verificationResult.transaction_id,
            gateway_response: gateway_response || {},
            completed_at: new Date()
        },{ transaction });

        if (payment.subscription) {
            await payment.subscription.update({
                status: 'active',
                current_period_start: new Date(),
                current_period_end: calculateNextBillingDate(payment.subscription.billing_cycle)
            }, { transaction });
        }

        await transaction.commit();

        return res.status(200).json({
            message: payment.is_recurring 
                ? 'Subscription activated successfully. Please upload your documents.' 
                : 'Payment completed successfully. Please upload your documents.',
            data: {
                payment_id: payment.id,
                request_id: payment.verificationRequest.request_id,
                payment_status: 'completed',
                verification_status: 'pending',
                amount: payment.amount,
                currency: payment.currency,
                subscription_id: payment.subscription ? payment.subscription.id : null,
                subscription_status: payment.subscription ? payment.subscription.status : null
            }
        });
    } catch (error) {
        await transaction.rollback();
        
        console.error('Error in confirmPayment:', error);
        return res.status(500).json({ message: 'Internal server error'});
    }
};

exports.syncStripeSubscription = async (req, res) => {
    const userId = req.user.id;
    const { session_id } = req.body;
    
    if (!session_id) {
        return res.status(400).json({ message: 'Session ID is required' });
    }
    
    const transaction = await sequelize.transaction();
    
    try {
        // Retrieve checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ['subscription']
        });
        
        if (!session) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Checkout session not found' });
        }
        
        const subscriptionId = session.metadata?.subscription_id;
        const paymentId = session.metadata?.payment_id;
        // Extract subscription ID - it can be a string or an expanded object
        const stripeSubscriptionId = typeof session.subscription === 'string' 
            ? session.subscription 
            : session.subscription?.id || null;
        
        if (!subscriptionId || !paymentId) {
            await transaction.rollback();
            return res.status(400).json({ message: 'Invalid session metadata' });
        }
        
        // Find subscription and payment
        const subscription = await Subscription.findByPk(subscriptionId, {
            where: { user_id: userId },
            include: [{ model: Payment, as: 'payments' }],
            lock: transaction.LOCK.UPDATE,
            transaction
        });
        
        const payment = await Payment.findByPk(paymentId, {
            where: { user_id: userId },
            lock: transaction.LOCK.UPDATE,
            transaction
        });
        
        if (!subscription || !payment) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Subscription or payment not found' });
        }
        
        // Update subscription with Stripe subscription ID
        if (stripeSubscriptionId) {
            // Ensure stripeSubscriptionId is a string
            const subscriptionIdString = String(stripeSubscriptionId);
            
            try {
                // If subscription was expanded, use it directly; otherwise retrieve it
                const stripeSub = typeof session.subscription === 'object' && session.subscription
                    ? session.subscription
                    : await stripe.subscriptions.retrieve(subscriptionIdString);
                
                await subscription.update({
                    stripe_subscription_id: subscriptionIdString,
                    status: 'active',
                    current_period_start: new Date(stripeSub.current_period_start * 1000),
                    current_period_end: new Date(stripeSub.current_period_end * 1000)
                }, { transaction });
            } catch (stripeError) {
                console.error('Error retrieving Stripe subscription:', stripeError);
                // Still update subscription to active even if retrieval fails
                await subscription.update({
                    stripe_subscription_id: subscriptionIdString,
                    status: 'active',
                    current_period_start: new Date(),
                    current_period_end: calculateNextBillingDate(subscription.billing_cycle)
                }, { transaction });
            }
        } else {
            // If subscription ID not available, still activate
            await subscription.update({
                status: 'active',
                current_period_start: new Date(),
                current_period_end: calculateNextBillingDate(subscription.billing_cycle)
            }, { transaction });
        }
        
        // Update payment status
        if (payment.status === 'pending') {
            await payment.update({
                status: 'completed',
                gateway_payment_id: session.payment_intent || session.id,
                gateway_response: session,
                completed_at: new Date()
            }, { transaction });
        }
        
        await transaction.commit();
        
        return res.json({
            success: true,
            message: 'Subscription synced successfully',
            data: {
                subscription_id: subscription.id,
                stripe_subscription_id: subscription.stripe_subscription_id,
                status: subscription.status,
                payment_status: payment.status
            }
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error syncing Stripe subscription:', error);
        return res.status(500).json({ 
            message: 'Failed to sync subscription',
            error: error.message 
        });
    }
};

exports.completeSubscriptionPayment = async (req, res) => {
    try {
        const { subscription_id } = req.body;
        
        if (!subscription_id) {
            return res.status(400).json({ message: 'subscription_id required' });
        }

        const subscription = await Subscription.findByPk(subscription_id, {
            include: [
                { model: User, as: 'user' },
                { model: Payment, as: 'payments', where: { status: 'pending' }, required: true }
            ]
        });

        if (!subscription || !subscription.stripe_subscription_id) {
            return res.status(404).json({ message: 'Stripe subscription not found' });
        }
        
        const stripeSub = await stripe.subscriptions.retrieve(
            subscription.stripe_subscription_id,
            { expand: ['latest_invoice'] }
        );

        if (!stripeSub.latest_invoice) {
            const invoice = await stripe.invoices.create({
                customer: stripeSub.customer,
                subscription: stripeSub.id,
                collection_method: 'charge_automatically',
                auto_advance: true
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

        await stripe.paymentMethods.attach(paymentMethod.id, {
            customer: stripeSub.customer,
        });

        await stripe.customers.update(stripeSub.customer, {
            invoice_settings: {
                default_payment_method: paymentMethod.id,
            },
        });

        const updatedSub = await stripe.subscriptions.retrieve(
            subscription.stripe_subscription_id,
            { expand: ['latest_invoice'] }
        );
        
        const invoiceId = updatedSub.latest_invoice.id;
        const paidInvoice = await stripe.invoices.pay(invoiceId, {
            payment_method: paymentMethod.id,
            paid_out_of_band: true
        });

        const finalSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);

        const transaction = await sequelize.transaction();
        try {
            const payment = subscription.payments[0];
            
            await payment.update({
                status: 'completed',
                gateway_payment_id: paidInvoice.payment_intent || `invoice_${paidInvoice.id}`,
                gateway_response: paidInvoice,
                completed_at: new Date(),
                payment_method: 'card',
                payment_method_id: paymentMethod.id
            }, { transaction });

            await subscription.update({
                status: 'active',
                current_period_start: new Date(paidInvoice.period_start * 1000),
                current_period_end: new Date(paidInvoice.period_end * 1000),
                payment_method_id: paymentMethod.id
            }, { transaction });

            await transaction.commit();

        } catch (dbError) {
            await transaction.rollback();
            throw dbError;
        }

        return res.json({
            message: 'Subscription payment completed successfully',
            data: {
                subscription_id: subscription.id,
                stripe_subscription_id: subscription.stripe_subscription_id,
                invoice_id: paidInvoice.id,
                invoice_status: paidInvoice.status,
                amount_paid: paidInvoice.amount_paid / 100,
                subscription_status: 'active',
                payment_method_id: paymentMethod.id,
                next_billing: new Date(paidInvoice.period_end * 1000)
            }
        });

    } catch (error) {
        console.error('❌ Complete payment error:', {
            message: error.message,
            type: error.type,
            code: error.code
        });
        
        return res.status(400).json({ 
            error: error.message,
            code: error.code,
            note: 'Check Stripe dashboard for invoice status'
        });
    }
};

exports.stripeWebhook = async (req,res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(
            req.body, 
            sig, 
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const eventHandlers = {
        'checkout.session.completed': async (session) => {
            try {
                const subscriptionId = session.metadata?.subscription_id;
                const paymentId = session.metadata?.payment_id;
                const stripeSubscriptionId = session.subscription;

                if (subscriptionId && paymentId) {
                    const transaction = await sequelize.transaction();
                    try {
                        const subscription = await Subscription.findByPk(subscriptionId, {
                            include: [{ model: Payment, as: 'payments' }],
                            lock: transaction.LOCK.UPDATE,
                            transaction
                        });

                        const payment = await Payment.findByPk(paymentId, {
                            lock: transaction.LOCK.UPDATE,
                            transaction
                        });

                        if (subscription && payment) {
                            // Update subscription status to active
                            if (stripeSubscriptionId) {
                                try {
                                    const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
                                    await subscription.update({
                                        stripe_subscription_id: stripeSubscriptionId,
                                        status: 'active',
                                        current_period_start: new Date(stripeSub.current_period_start * 1000),
                                        current_period_end: new Date(stripeSub.current_period_end * 1000)
                                    }, { transaction });
                                } catch (stripeError) {
                                    console.error('Error retrieving Stripe subscription:', stripeError);
                                    // Still update subscription to active even if retrieval fails
                                    await subscription.update({
                                        stripe_subscription_id: stripeSubscriptionId,
                                        status: 'active',
                                        current_period_start: new Date(),
                                        current_period_end: calculateNextBillingDate(subscription.billing_cycle)
                                    }, { transaction });
                                }
                            } else {
                                // If subscription ID not available yet, still activate the subscription
                                // The customer.subscription.created webhook will update it with the ID later
                                await subscription.update({
                                    status: 'active',
                                    current_period_start: new Date(),
                                    current_period_end: calculateNextBillingDate(subscription.billing_cycle)
                                }, { transaction });
                            }

                            await payment.update({
                                status: 'completed',
                                gateway_payment_id: session.payment_intent || session.id,
                                gateway_response: session,
                                completed_at: new Date()
                            }, { transaction });
                        }

                        await transaction.commit();
                        return { processed: true, status: 'checkout_completed' };
                    } catch (dbError) {
                        await transaction.rollback();
                        throw dbError;
                    }
                }
                return { processed: false, error: 'Missing metadata' };
            } catch (error) {
                console.error('Error handling checkout session completion:', error);
                return { processed: false, error: error.message };
            }
        },
        'customer.subscription.created': async (stripeSubscription) => {
            try {
                const appSubscriptionId = stripeSubscription.metadata?.app_subscription_id;
                if (appSubscriptionId) {
                    const transaction = await sequelize.transaction();
                    try {
                        const subscription = await Subscription.findByPk(appSubscriptionId, {
                            lock: transaction.LOCK.UPDATE,
                            transaction
                        });
                        if (subscription) {
                            await subscription.update({
                                stripe_subscription_id: stripeSubscription.id,
                                status: 'active',
                                current_period_start: new Date(stripeSubscription.current_period_start * 1000),
                                current_period_end: new Date(stripeSubscription.current_period_end * 1000)
                            }, { transaction });
                        }
                        await transaction.commit();
                    } catch (dbError) {
                        await transaction.rollback();
                        throw dbError;
                    }
                } else {
                    console.log('No app_subscription_id in metadata, attempting to find subscription by customer');
                    const customerId = stripeSubscription.customer;
                    if (customerId) {
                        const user = await User.findOne({ where: { stripe_customer_id: customerId } });
                        if (user) {
                            const transaction = await sequelize.transaction();
                            try {
                                // Find the most recent incomplete subscription for this user
                                const subscription = await Subscription.findOne({
                                    where: {
                                        user_id: user.id,
                                        payment_gateway: 'stripe',
                                        status: { [Op.in]: ['incomplete', 'active'] },
                                        stripe_subscription_id: null
                                    },
                                    order: [['created_at', 'DESC']],
                                    lock: transaction.LOCK.UPDATE,
                                    transaction
                                });
                                if (subscription) {
                                    await subscription.update({
                                        stripe_subscription_id: stripeSubscription.id,
                                        status: 'active',
                                        current_period_start: new Date(stripeSubscription.current_period_start * 1000),
                                        current_period_end: new Date(stripeSubscription.current_period_end * 1000)
                                    }, { transaction });
                                    console.log(`Linked Stripe subscription ${stripeSubscription.id} to app subscription ${subscription.id}`);
                                }
                                await transaction.commit();
                            } catch (dbError) {
                                await transaction.rollback();
                                throw dbError;
                            }
                        }
                    }
                }
                return { processed: true, status: 'subscription_created' };
            } catch (error) {
                console.error('Error handling subscription creation:', error);
                return { processed: false, error: error.message };
            }
        },
        'payment_intent.succeeded': async (paymentIntent) => {
            try {
                await handleStripePaymentSuccess(paymentIntent);
                return { processed: true, status: 'success' };
            } catch (error) {
                console.error('Error handling payment success:', error);
                return { processed: false, error: error.message };
            }
        },
        'payment_intent.payment_failed': async (paymentIntent) => {
            try {
                await handleStripePaymentFailure(paymentIntent);
                return { processed: true, status: 'failed' };
            } catch (error) {
                console.error('Error handling payment failure:', error);
                return { processed: false, error: error.message };
            }
        },
        'payment_intent.canceled': async (paymentIntent) => {
            try {
                await handleStripePaymentCanceled(paymentIntent);
                return { processed: true, status: 'canceled' };
            } catch (error) {
                console.error('Error handling payment canceled:', error);
                return { processed: false, error: error.message };
            }
        },
        'invoice.payment_succeeded': async (invoice) => {
            try {
                await handleStripeInvoicePaymentSucceeded(invoice);
                return { processed: true, status: 'invoice_paid' };
            } catch (error) {
                console.error('Error handling invoice payment success:', error);
                return { processed: false, error: error.message };
            }
        },
        'invoice.payment_failed': async (invoice) => {
            try {
                await handleStripeInvoicePaymentFailed(invoice);
                return { processed: true, status: 'invoice_failed' };
            } catch (error) {
                console.error('Error handling invoice payment failure:', error);
                return { processed: false, error: error.message };
            }
        },
        'customer.subscription.updated': async (subscription) => {
            try {
                await handleStripeSubscriptionUpdated(subscription);
                return { processed: true, status: 'subscription_updated' };
            } catch (error) {
                console.error('Error handling subscription update:', error);
                return { processed: false, error: error.message };
            }
        },
        'customer.subscription.deleted': async (subscription) => {
            try {
                await handleStripeSubscriptionDeleted(subscription);
                return { processed: true, status: 'subscription_deleted' };
            } catch (error) {
                console.error('Error handling subscription deletion:', error);
                return { processed: false, error: error.message };
            }
        }
    };

    const handler = eventHandlers[event.type];
    if(handler){
        const result = await handler(event.data.object);
        if (result.processed) {
            console.log(`Stripe webhook ${event.type} processed successfully`);
            return res.json({ received: true, status: result.status });
        } else {
            console.error(`Stripe webhook ${event.type} processing failed:`, result.error);
            return res.status(500).json({ received: false, error: result.error });
        }
    } else {
        console.log(`Stripe webhook event type not handled: ${event.type}`);
        res.json({received: true, note: 'Event type not handled'});
    }
};

exports.paypalWebhook = async (req,res) => {
    try {
        const event = req.body;
        console.log(`PayPal webhook received: ${event.event_type}`);

        const eventHandlers = {
            'PAYMENT.CAPTURE.COMPLETED': async (eventData) => {
                try {
                    await handlePayPalPaymentSuccess(eventData);
                    return { processed: true, status: 'completed' };
                } catch (error) {
                    console.error('Error handling PayPal payment success:', error);
                    return { processed: false, error: error.message };
                }
            },
            'PAYMENT.CAPTURE.DENIED': async (eventData) => {
                try {
                    await handlePayPalPaymentFailure(eventData);
                    return { processed: true, status: 'denied' };
                } catch (error) {
                    console.error('Error handling PayPal payment denied:', error);
                    return { processed: false, error: error.message };
                }
            },
            'PAYMENT.SALE.COMPLETED': async (eventData) => {
                try {
                    await handlePayPalSubscriptionPayment(eventData);
                    return { processed: true, status: 'subscription_paid' };
                } catch (error) {
                    console.error('Error handling PayPal subscription payment:', error);
                    return { processed: false, error: error.message };
                }
            },
            'BILLING.SUBSCRIPTION.ACTIVATED': async (eventData) => {
                try {
                    await handlePayPalSubscriptionActivated(eventData);
                    return { processed: true, status: 'subscription_activated' };
                } catch (error) {
                    console.error('Error handling PayPal subscription activation:', error);
                    return { processed: false, error: error.message };
                }
            },
            'BILLING.SUBSCRIPTION.CANCELLED': async (eventData) => {
                try {
                    await handlePayPalSubscriptionCancelled(eventData);
                    return { processed: true, status: 'subscription_cancelled' };
                } catch (error) {
                    console.error('Error handling PayPal subscription cancellation:', error);
                    return { processed: false, error: error.message };
                }
            }
        };

        const handler = eventHandlers[event.event_type];

        if(handler){
           const result = await handler(event);
           if (result.processed) {
                console.log(`PayPal webhook ${event.event_type} processed successfully`);
                return res.json({ received: true, status: result.status });
            } else {
                console.error(`PayPal webhook ${event.event_type} processing failed:`, result.error);
                return res.status(500).json({ received: false, error: result.error });
            }
        } else {
            console.log(`PayPal webhook event type not handled: ${event.event_type}`);
            res.json({received: true, note: 'Event type not handled'});
        }
    } catch (error) {
        console.error('PayPal webhook error:', error);
        res.status(500).json({error: error.message});
    }
};

exports.getVerificationStatus = async (req, res) => {
    const { request_id } = req.params;
    
    try {
        const verification = await VerificationRequest.findOne({
            where: { request_id },
            include: [
                { 
                    model: Payment, 
                    as: 'payment', 
                    attributes: ['id', 'status', 'failure_reason', 'completed_at', 'gateway_response'] 
                },
            ]
        });

        if (!verification) {
            return res.status(404).json({ message: 'Verification request not found' });
        }

        return res.json({  
            data: {
                request_id: verification.request_id,
                verification_status: verification.status,
                payment_status: verification.payment?.status || 'unknown',
                verification_source: verification.verification_source || 'user_paid',
                last_updated: verification.updated_at
            }
        });
    } catch (error) {
        console.error('Error in getVerificationStatus:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getMyVerificationStatus = async (req,res) => {
    const userId = req.user.id;

    try {
        const verification = await VerificationRequest.findOne({
            where: { user_id: userId },
            include: [{ 
                model: Payment, 
                as: 'payment', 
                attributes: ['id', 'status', 'amount', 'currency', 'payment_gateway', 'completed_at'] 
            }],
            order: [['created_at', 'DESC']],
            attributes: [
                'id', 'user_id', 'request_id', 'full_name', 'category', 'document_type',
                'document_front', 'document_back', 'selfie', 'status', 'payment_id',
                'verification_source', 'subscription_id', 'rejection_reason', 'reviewed_by',
                'reviewed_at', 'admin_notes', 'created_at', 'updated_at'
            ]
        });

        const user = await User.findByPk(userId, {attributes: ['id', 'is_verified', 'verified_at'], raw:true});

        return res.status(200).json({
            data: {
                ...user,
                has_pending_request: !!verification,
                current_request: verification ? verification.toJSON() : null
            }
        });
            
    } catch (error) {
        console.error('Error in getMyVerificationStatus:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }  
};

exports.uploadDocuments = async (req, res) => {
    const { request_id, subscription_id, document_type, full_name, category } = req.body;
    const userId = req.user.id;
    const transaction = await sequelize.transaction();

    try {
        if (!document_type) {
            return res.status(400).json({ message: 'Document type is required.' });
        }

        if (!req.files?.front || !req.files?.selfie) {
            return res.status(400).json({ message: 'Document front and selfie are required.' });
        }

        if (!request_id && !subscription_id) {
            await transaction.rollback();
            return res.status(400).json({ message: 'Either request_id or subscription_id is required.' });
        }

        let verification = null;

        if (request_id) {
            // Find existing verification request
            verification = await VerificationRequest.findOne({
                where: { request_id, user_id: userId },
                include: [
                    { model: Payment, as: 'payment', attributes: ['id', 'status', 'amount', 'currency']}
                ],
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            if (!verification) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Verification request not found' });
            }

            if (verification.payment?.status !== 'completed') {
                await transaction.rollback();
                return res.status(400).json({ message: 'Please complete payment before uploading documents.'});
            }
        } else if (subscription_id) {
            // Find subscription
            const subscription = await Subscription.findByPk(subscription_id, {
                where: { user_id: userId },
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            if (!subscription) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Subscription not found' });
            }

            if (subscription.status !== 'active') {
                await transaction.rollback();
                return res.status(400).json({ message: 'Subscription must be active to upload documents.' });
            }

            // Check if verification request already exists for this subscription
            verification = await VerificationRequest.findOne({
                where: { subscription_id: subscription_id, user_id: userId },
                include: [
                    { model: Payment, as: 'payment', attributes: ['id', 'status', 'amount', 'currency']}
                ],
                lock: transaction.LOCK.UPDATE,
                transaction
            });

            // If no verification request exists, create one
            if (!verification) {
                if (!full_name || !category) {
                    await transaction.rollback();
                    return res.status(400).json({ message: 'full_name and category are required when creating a new verification request.' });
                }

                const user = await User.findByPk(userId, { attributes: ['id', 'name', 'is_verified'], transaction });
                
                if (user.is_verified) {
                    await transaction.rollback();
                    return res.status(400).json({ message: 'User is already verified.' });
                }

                // Get the first completed payment for this subscription
                const completedPayment = await Payment.findOne({
                    where: { 
                        subscription_id: subscription_id, 
                        user_id: userId,
                        status: 'completed'
                    },
                    order: [['completed_at', 'DESC']],
                    lock: transaction.LOCK.UPDATE,
                    transaction
                });

                verification = await VerificationRequest.create({
                    user_id: userId,
                    full_name: full_name,
                    category: category.toLowerCase(),
                    document_type: null,
                    document_front: null,
                    document_back: null,
                    selfie: null,
                    status: 'pending',
                    payment_id: completedPayment ? completedPayment.id : null,
                    verification_source: 'subscription',
                    subscription_id: subscription.id
                }, { transaction });

                if (completedPayment) {
                    await completedPayment.update({ reference_id: verification.id }, { transaction });
                }

                await subscription.update({ verification_request_id: verification.id }, { transaction });
            }
        }

        if (verification.document_front && verification.selfie) {
            await transaction.rollback();
            return res.status(400).json({ message: 'Documents already uploaded.',});
        }

        await verification.update({
            document_type: document_type.toLowerCase(),
            document_front: req.files.front[0].path,
            document_back: req.files.back?.[0]?.path || null,
            selfie: req.files.selfie[0].path,
            status: 'pending',
            updated_at: new Date()
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            message: 'Documents uploaded successfully. Your verification is now under review.',
            data: {
                request_id: verification.request_id,
                document_type: document_type,
                verification_status: 'pending',
            }
        });

    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        
        console.error('Error in uploadDocuments:', error);
        return res.status(500).json({ 
            message: 'Internal Server Error' 
        });
    }
};

exports.approveVerificationByAdmin = async (req,res) => {
    const { user_id, category, admin_notes = '', full_name } = req.body;
    const adminId = req.user.id;
    const transaction = await sequelize.transaction();

    try {
        if (req.user.role !== 'super_admin') {
            await transaction.rollback();
            return res.status(400).json({ message: 'Only super administrators can grant verification directly.' });
        }

        if (!user_id || !category) {
            await transaction.rollback();
            return res.status(400).json({ message: 'user_id and category are required' });
        }

        const user = await User.findByPk(user_id, { lock: transaction.LOCK.UPDATE, transaction });
        if (!user) {
            await transaction.rollback();
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.is_verified) {
            await transaction.rollback();
            return res.status(400).json({ message: 'User is already verified' });
        }

        const requestId = `VRQ-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        const verification = await VerificationRequest.create({
            user_id: user_id,
            request_id: requestId,
            full_name: full_name || user.name,
            category: category,
            document_type: 'admin_granted',
            document_front: null,
            document_back: null,
            selfie: null,
            status: 'approved',
            payment_id: null,
            reviewed_by: adminId,
            reviewed_at: new Date(),
            admin_notes: admin_notes.trim() || `Manually granted by admin ${adminId}`,
            verification_source: 'admin_granted',
            created_at: new Date(),
            updated_at: new Date()
        }, { transaction });

        await user.update({ is_verified: true, verified_at: new Date()}, { transaction });

        await transaction.commit();

        return res.status(201).json({
            success: true,
            message: 'Verification granted and approved successfully',
            data: {
                ...user.toJSON(),
                verification_type: category,
                request_id: verification.request_id,
                verification_source: 'admin_granted',
                granted_by: adminId,
                granted_at: new Date(),
                notes: admin_notes.trim() || null,
                is_immediate_approval: true
            }
        });
    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }

        console.error('Error in approveVerificationByAdmin:', error);
        return res.status(500).json({ message: 'Internal Server Error'});
    }  
};

exports.approveVerification = async (req,res) => {
    const { request_id, admin_notes='' } = req.body;
    const adminId = req.user.id;
    const transaction = await sequelize.transaction();

    try {
        if(req.user.role !== 'super_admin'){
            return res.status(400).json({ message: 'Only administrators can approve verification requests' });
        }

        if (!request_id) {
            return res.status(400).json({ message: 'request_id is required' });
        }

        const verification = await VerificationRequest.findOne({
            where: { request_id, status: 'pending'},
            include: [
                { model: User, as:'user', lock: transaction.LOCK.UPDATE, transaction }, 
                { model: Payment, as: 'payment', lock: transaction.LOCK.UPDATE, transaction},
                { model: Subscription, as: 'subscription' }
            ],
            lock: transaction.LOCK.UPDATE,
            transaction
        });
        
        if(!verification){
            await transaction.rollback();
            return res.status(404).json({
                message: 'Verification request not found or already processed.'
            });
        }

        if(verification.payment?.status !== 'completed'){
            await transaction.rollback();
            return res.status(400).json({
                message: 'Cannot approve. Payment not completed.',
                data: {
                    payment_id: verification.payment?.id,
                    payment_status: verification.payment?.status,
                }
            });
        }

        await verification.update({
            status: 'approved',
            reviewed_by: adminId,
            reviewed_at: new Date(),
            admin_notes: admin_notes.trim() || null,
            updated_at: new Date()
        }, {transaction});

        await verification.user.update({ is_verified: true, verified_at: new Date()}, { transaction });

        if (verification.subscription && verification.verification_source === 'subscription') {
            await verification.subscription.update({ status: 'active'}, { transaction });
        }

        await transaction.commit();

        return res.status(200).json({
            message: 'Verification approved successfully',
            data: {
                request_id: verification.request_id,
                user_id: verification.user_id,
                user_name: verification.user.name,
                verification_type: verification.category,
                verification_source: verification.verification_source,
                subscription_id: verification.subscription?.id,
                approved_at: new Date(),
                reviewed_by: adminId
            }
        });
    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }

        console.error('Error in approveVerification:', error);
        return res.status(500).json({ message: 'Internal Server Error'});
    }
};

exports.rejectVerification = async (req,res) => {
    const { request_id, rejection_reason, admin_notes = '' } = req.body;
    const adminId = req.user.id;
    const transaction = await sequelize.transaction();
    try {
        if (!rejection_reason) {
            await transaction.rollback();
            return res.status(400).json({ message: 'Rejection reason is required.' });
        }

        if(req.user.role !== 'super_admin'){
            return res.status(400).json({ message: 'Only admin can reject verification request.' });
        }

        const verification = await VerificationRequest.findOne({
            where: { request_id, status: 'pending' },
            include: [{ model: User, as:'user'}, { model: Payment, as:'payment'}],
            lock: transaction.LOCK.UPDATE,
            transaction
        });

        if(!verification){
            await transaction.rollback();
            return res.status(404).json({ message: 'Verification request not found or already processed.' });
        }

        await verification.update({
            status: 'rejected',
            rejection_reason: rejection_reason.trim(),
            reviewed_by: adminId,
            reviewed_at: new Date(),
            admin_notes: admin_notes.trim() || null,
            updated_at: new Date()
        }, { transaction });

        await transaction.commit();

        return res.status(200).json({
            message: 'Verification rejected successfully.',
            data: {
                request_id: verification.request_id,
                user_id: verification.user_id,
                verification_source: verification.verification_source || 'user_paid',
                rejected_at: new Date(),
                rejection_reason: rejection_reason,
                reviewed_by: adminId
            }
        });
    } catch (error) {
        console.error('Error in rejectVerification:', error);
        return res.status(500).json({ message: 'Internal Server Error'});
    }
};

exports.fetchPendingRequests = async (req, res) => {
    let { page = 1, limit = 20, search = '' } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;

    try {
        let verificationWhere = { status: 'pending' };
        let userWhere = {};
        let searchText = search.trim();
        
        if (searchText) {
            verificationWhere = {
                [Op.and]: [
                    { status: 'pending' },
                    { [Op.or]: [
                        { full_name: { [Op.like]: `%${searchText}%` } },
                        { document_type: { [Op.like]: `%${searchText}%` } },
                        { category: { [Op.like]: `%${searchText}%` } },
                        { request_id: { [Op.like]: `%${searchText}%` } }
                    ]}
                ]
            };

            userWhere = {
                [Op.or]: [
                    { name: { [Op.like]: `%${searchText}%` } }, 
                    { email: { [Op.like]: `%${searchText}%` } },
                ]
            };
        }

        const { count, rows } = await VerificationRequest.findAndCountAll({
            where: verificationWhere,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: [
                        'id', 'name', 'email', 'avatar', 'is_verified', 'verified_at', 
                        'country', 'phone', 'created_at'
                    ],
                    where: userWhere,
                    required: false,
                },
                {
                    model: Payment,
                    as: 'payment',
                    attributes: [
                        'id', 'amount', 'currency', 'payment_gateway', 'payment_method', 'gateway_order_id', 
                        'gateway_payment_id', 'status', 'failure_reason', 'completed_at', 'created_at', 'updated_at'
                    ],
                    required: true
                }
            ],
            order: [['created_at', 'DESC']],
            offset,
            limit
        });

        const formattedRows = rows.map(row => {
            const verification = row.toJSON();
            
            return {
                verification_id: verification.id,
                request_id: verification.request_id,
                full_name: verification.full_name,
                category: verification.category,
                document_type: verification.document_type,
                document_front_url: verification.document_front,
                document_back_url: verification.document_back,
                selfie_url: verification.selfie,
                verification_status: verification.status,
                submitted_at: verification.created_at,
                user: verification.user ? verification.user : null,
                payment: verification.payment ? verification.payment: null,
                can_approve: verification.payment?.status === 'completed',
            };
        });

        return res.status(200).json({
            message: 'Pending verification requests fetched successfully',
            data: formattedRows,
            pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit)},
            summary: {
                pending_count: count,
                with_payment_completed: rows.filter(r => r.payment?.status === 'completed').length,
                with_payment_failed: rows.filter(r => r.payment?.status === 'failed').length,
                with_payment_pending: rows.filter(r => r.payment?.status === 'pending').length
            }
        });
    } catch (error) {
        console.error('Error in fetchPendingRequests:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.fetchAllVerificationRequests = async (req, res) => {
    let { page = 1, limit = 20, search = '', status = '' } = req.query;
    page = parseInt(page);
    limit = Math.min(parseInt(limit), 100);
    const offset = (page - 1) * limit;

    try {
        let verificationWhere = {};
        let userWhere = {};
        const searchText = search.trim();
        
        if (status && ['pending', 'approved', 'rejected', 'payment_failed'].includes(status)) {
            verificationWhere.status = status;
        }

        if (searchText) {
            verificationWhere = {
                [Op.and]: [
                    verificationWhere,
                    { [Op.or]: [
                        { full_name: { [Op.like]: `%${searchText}%` } },
                        { document_type: { [Op.like]: `%${searchText}%` } },
                        { category: { [Op.like]: `%${searchText}%` } },
                        { request_id: { [Op.like]: `%${searchText}%` } }
                    ]}
                ]
            };

            userWhere = {
                [Op.or]: [
                    { name: { [Op.like]: `%${searchText}%` } }, 
                    { email: { [Op.like]: `%${searchText}%` } },
                ]
            };
        }

        const { count, rows } = await VerificationRequest.findAndCountAll({
            where: verificationWhere,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: [
                        'id', 'name', 'email', 'avatar', 'is_verified', 'verified_at', 
                        'country', 'phone', 'created_at'
                    ],
                    where: userWhere,
                    required: false,
                },
                {
                    model: Payment,
                    as: 'payment',
                    attributes: [
                        'id', 'amount', 'currency', 'payment_gateway', 'payment_method', 'gateway_order_id', 
                        'gateway_payment_id', 'status', 'failure_reason', 'completed_at', 'created_at', 'updated_at'
                    ],
                    required: false
                },
                {
                    model: Subscription,
                    as: 'subscription',
                    attributes: ['id', 'status', 'plan_id', 'billing_cycle', 'amount', 'currency'],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']],
            offset,
            limit,
            distinct: true
        });

        const formattedRows = rows.map(row => {
            const verification = row.toJSON();
            
            return {
                verification_id: verification.id,
                request_id: verification.request_id,
                full_name: verification.full_name,
                category: verification.category,
                document_type: verification.document_type,
                document_front_url: verification.document_front,
                document_back_url: verification.document_back,
                selfie_url: verification.selfie,
                has_documents: !!(verification.document_front && verification.selfie),
                verification_status: verification.status,
                verification_source: verification.verification_source,
                submitted_at: verification.created_at,
                updated_at: verification.updated_at,
                user: verification.user ? verification.user : null,
                payment: verification.payment ? verification.payment : null,
                subscription: verification.subscription ? verification.subscription : null,
                can_approve: verification.payment?.status === 'completed' && verification.status === 'pending',
            };
        });

        return res.status(200).json({
            message: 'Verification requests fetched successfully',
            data: formattedRows,
            pagination: { 
                total: count, 
                page, 
                limit, 
                total_pages: Math.ceil(count / limit)
            },
            summary: {
                total_count: count,
                pending_count: rows.filter(r => r.status === 'pending').length,
                approved_count: rows.filter(r => r.status === 'approved').length,
                rejected_count: rows.filter(r => r.status === 'rejected').length,
                with_documents: rows.filter(r => r.document_front && r.selfie).length,
                with_payment_completed: rows.filter(r => r.payment?.status === 'completed').length,
            }
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
    const offset = (page - 1) * limit;

    try {
        const searchText = search.trim();
        const categoryFilter = category.trim().toLowerCase();
        
        let whereCondition = { is_verified: true, status: 'active', deleted_at: null };

        if (searchText) {
            whereCondition = {
                [Op.and]: [
                    whereCondition,
                    {[Op.or]: [
                        { name: { [Op.like]: `%${searchText}%` } },
                        { email: { [Op.like]: `%${searchText}%` } },
                        { bio: { [Op.like]: `%${searchText}%` } },
                        { country: { [Op.like]: `%${searchText}%` } }
                    ]}
                ]
            };
        }
        
        const ALLOWED_SORT_FIELDS = ['verified_at', 'name', 'created_at', 'last_seen'];
        if (!ALLOWED_SORT_FIELDS.includes(sort_by)) sort_by = 'verified_at'; 
        
        const order = [[sort_by, sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC']];
        
        const { count, rows } = await User.findAndCountAll({
            where: whereCondition,
            attributes: [
                'id', 'name', 'avatar', 'bio', 'email', 'country', 'is_verified', 'verified_at', 
                'last_seen', 'created_at', 'is_online', 'country_code', 'phone', 'role'
            ],
            include: [
                {
                    model: VerificationRequest,
                    as: 'verificationRequests',
                    attributes: ['request_id', 'category', 'document_type', 'created_at'],
                    where: categoryFilter && ['individual', 'business', 'creator'].includes(categoryFilter) 
                        ? { status: 'approved', category: categoryFilter }
                        : { status: 'approved' },
                    required: categoryFilter && ['individual', 'business', 'creator'].includes(categoryFilter),
                    limit: 1,
                    order: [['created_at', 'DESC']]
                }
            ],
            order,
            offset,
            limit,
            distinct: true
        });

        const formattedUsers = rows.map(user => {
            const userData = user.toJSON();
            
            return {
                id: userData.id,
                name: userData.name,
                avatar: userData.avatar,
                bio: userData.bio,
                email: userData.email,
                country: userData.country,
                country_code: userData.country_code,
                is_verified: userData.is_verified,
                verification_type: userData.verificationRequests?.[0]?.category || null,
                verified_at: userData.verified_at,
                last_seen: userData.last_seen,
                is_online: userData.is_online,
                account_created: userData.created_at,
                phone: userData.phone ? userData.phone : null,
                role: userData.role,
                verification_request: userData.verificationRequests?.[0] || null,
            };
        });
        
        return res.status(200).json({
            message: 'Verified users fetched successfully',
            data: formattedUsers,
            pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit)},
        });
        
    } catch (error) {
        console.error('Error in fetchVerifiedUsers:', error);
        return res.status(500).json({ message: 'Internal Server Error'});
    }
};