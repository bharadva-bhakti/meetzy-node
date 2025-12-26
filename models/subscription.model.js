module.exports = (sequelize, DataTypes) => {
    const Subscription = sequelize.define('Subscription', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE'
        },
        verification_request_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'verification_requests', key: 'id' },
            onDelete: 'SET NULL'
        },
        plan_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'plans', key: 'id' }
        },
        stripe_subscription_id: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true
        },
        paypal_subscription_id: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true
        },
        payment_gateway: {
            type: DataTypes.ENUM('stripe', 'paypal'),
            allowNull: false
        },
        status: {
            type: DataTypes.ENUM('active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid'),
            defaultValue: 'incomplete'
        },
        current_period_start: {
            type: DataTypes.DATE,
            allowNull: true
        },
        current_period_end: {
            type: DataTypes.DATE,
            allowNull: true
        },
        cancel_at_period_end: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        canceled_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        billing_cycle: {
            type: DataTypes.ENUM('monthly', 'yearly'),
            defaultValue: 'monthly'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false
        },
        currency: {
            type: DataTypes.STRING(3),
            defaultValue: 'USD'
        },
        metadata: {
            type: DataTypes.JSON,
            defaultValue: {}
        }
    }, {
        tableName: 'subscriptions',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    Subscription.associate = (models) => {
        Subscription.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
        Subscription.belongsTo(models.VerificationRequest, { foreignKey: 'verification_request_id', as: 'verificationRequest' });
        Subscription.belongsTo(models.Plan, { foreignKey: 'plan_id', as: 'plan' });
        Subscription.hasMany(models.Payment, { foreignKey: 'subscription_id', as: 'payments' });
    };

    return Subscription;
};