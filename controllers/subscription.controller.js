const { VerificationRequest, User, Payment, Plan, Subscription, sequelize } = require('../models');
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

exports.getMySubscription = async (req, res) => {
    const userId = req.user.id;
    
    try {
        const subscription = await Subscription.findOne({
            where: { user_id: userId, status: { [Op.in]: ['active', 'past_due', 'trialing'] }},
            include: [
                { model: Plan, as: 'plan', attributes: ['id', 'name', 'slug', 'description']},
                { 
                    model: VerificationRequest, 
                    as: 'verificationRequest',
                    attributes: ['request_id', 'status', 'category']
                },
                {
                    model: Payment,
                    as: 'payments',
                    attributes: ['id', 'amount', 'status', 'completed_at', 'subscription_payment_sequence'],
                    order: [['completed_at', 'DESC']],
                    limit: 5
                }
            ],
            order: [['created_at', 'DESC']]
        });

        const user = await User.findByPk(userId, { attributes: ['id', 'is_verified', 'verified_at', 'stripe_customer_id']});

        return res.json({
            success: true,
            data: {
                user: {
                    is_verified: user.is_verified,
                    verified_at: user.verified_at,
                    stripe_customer_id: user.stripe_customer_id
                },
                subscription: subscription ? {
                    id: subscription.id,
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
                    recent_payments: subscription.payments
                } : null
            }
        });
    } catch (error) {
        console.error('Error getting subscription details:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getSubscriptionDetails = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    try {
        const subscription = await Subscription.findOne({
            where: { id: id, user_id: userId },
            include: [
                { model: Plan, as: 'plan', attributes: ['id', 'name', 'slug', 'description']},
                { model: VerificationRequest, as: 'verificationRequest', attributes: ['request_id', 'status', 'category']},
                {
                    model: Payment,
                    as: 'payments',
                    attributes: ['id', 'amount', 'status', 'completed_at', 'subscription_payment_sequence', 'gateway_response'],
                    order: [['completed_at', 'DESC']]
                }
            ]
        });

        if (!subscription) {
            return res.status(404).json({ message: 'Subscription not found' });
        }

        return res.json({ data: subscription });
    } catch (error) {
        console.error('Error getting subscription details:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.cancelSubscription = async (req, res) => {
    const { subscription_id } = req.body;
    const userId = req.user.id;
    const transaction = await sequelize.transaction();
    
    try {
        const subscription = await Subscription.findOne({
            where: { 
                id: subscription_id,
                user_id: userId,
                status: { [Op.in]: ['active', 'past_due', 'trialing'] }
            },
            lock: transaction.LOCK.UPDATE,
            transaction
        });
        
        if (!subscription) {
            await transaction.rollback();
            return res.status(404).json({ 
                success: false,
                message: 'Active subscription not found' 
            });
        }
        
        if (subscription.payment_gateway === 'stripe' && subscription.stripe_subscription_id) {
            await stripe.subscriptions.update( subscription.stripe_subscription_id, { cancel_at_period_end: true });

        } else if (subscription.payment_gateway === 'paypal' && subscription.paypal_subscription_id) {
            const request = new paypal.subscriptions.SubscriptionsCancelRequest(
                subscription.paypal_subscription_id
            );
            request.requestBody({ reason: 'Cancelled by user' });
            
            try {
                await paypalClient.execute(request);
            } catch (paypalError) {
                console.error('PayPal cancellation error:', paypalError);
            }
        }
        
        await subscription.update({ cancel_at_period_end: true, status: 'active'}, { transaction });
        
        await transaction.commit();
        
        return res.json({
            success: true,
            message: 'Subscription will be cancelled at the end of billing period',
            data: {
                subscription_id: subscription.id,
                cancel_at_period_end: true,
                current_period_end: subscription.current_period_end,
                status: subscription.status
            }
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error cancelling subscription:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Failed to cancel subscription',
            error: error.message 
        });
    }
};

exports.getSubscriptionPayments = async (req, res) => {
    const { subscription_id } = req.params;
    const userId = req.user.id;
    let { page = 1, limit = 20 } = req.query;
    
    page = parseInt(page);
    limit = parseInt(limit);
    const offset = (page - 1) * limit;
    
    try {
        const subscription = await Subscription.findOne({
            where: { id: subscription_id, user_id: userId }
        });

        if (!subscription) {
            return res.status(404).json({ message: 'Subscription not found' });
        }

        const { count, rows } = await Payment.findAndCountAll({
            where: { subscription_id: subscription_id },
            attributes: [
                'id', 'amount', 'currency', 'status', 'payment_gateway',
                'gateway_payment_id', 'completed_at', 'failure_reason',
                'subscription_payment_sequence', 'created_at', 'updated_at'
            ],
            order: [['created_at', 'DESC']],
            offset,
            limit
        });

        return res.json({
            success: true,
            data: {
                payments: rows,
                pagination: {
                    total: count,
                    page,
                    limit,
                    total_pages: Math.ceil(count / limit)
                }
            }
        });
    } catch (error) {
        console.error('Error getting subscription payments:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Internal Server Error' 
        });
    }
};

exports.getAllSubscriptions = async (req, res) => {
    let { page = 1, limit = 20, status = '', search = '' } = req.query;
    
    page = parseInt(page);
    limit = Math.min(parseInt(limit), 50);
    const offset = (page - 1) * limit;
    
    try {
        const whereCondition = {};
        const userWhereCondition = {};
        
        if (status && ['active', 'past_due', 'canceled', 'incomplete', 'trialing'].includes(status)) {
            whereCondition.status = status;
        }
        
        if (search) {
            userWhereCondition[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } }
            ];
        }
        
        const { count, rows } = await Subscription.findAndCountAll({
            where: whereCondition,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'name', 'email', 'avatar', 'is_verified'],
                    where: userWhereCondition
                },
                {
                    model: Plan,
                    as: 'plan',
                    attributes: ['id', 'name', 'slug']
                },
                {
                    model: VerificationRequest,
                    as: 'verificationRequest',
                    attributes: ['request_id', 'status', 'category']
                }
            ],
            order: [['created_at', 'DESC']],
            offset,
            limit,
            distinct: true
        });

        return res.json({
            success: true,
            data: rows,
            pagination: {
                total: count,
                page,
                limit,
                total_pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching all subscriptions:', error);
        return res.status(500).json({ 
            success: false,
            message: 'Internal Server Error' 
        });
    }
};