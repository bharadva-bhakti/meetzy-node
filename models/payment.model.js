module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define(
    'Payment',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
      },
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 0.01 }
      },
      currency: {
        type: DataTypes.STRING(3),
        defaultValue: 'USD'
      },
      payment_gateway: {
        type: DataTypes.ENUM('stripe', 'paypal', 'razorpay'),
        allowNull: false
      },

      // card, upi, netBanking, paypal_balance, etc.
      payment_method: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      //Order / Intent ID from gateway
      gateway_order_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      //Final transaction ID from gateway
      gateway_payment_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // What this payment is for
      reference_type: {
        type: DataTypes.ENUM('blue_tick'),
        allowNull: false,
      },
      reference_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'completed', 'failed', 'refunded'),
        defaultValue: 'pending'
      },
      gateway_response: {
        type: DataTypes.JSON,
        defaultValue: {}
      },
      failure_reason: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
      refunded_at: {
        type: DataTypes.DATE,
        allowNull: true
      },

      // For subscription
      subscription_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'subscriptions', key: 'id' },
        onDelete: 'SET NULL'
      },
      is_recurring: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      invoice_id: {
        type: DataTypes.STRING,
        allowNull: true
      },
      subscription_payment_sequence: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      }
    },
    {
      tableName: 'payments',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['user_id'] },
        { fields: ['status'] },
        { fields: ['reference_type', 'reference_id'] },
        { fields: ['gateway_order_id'] },
        { fields: ['gateway_payment_id'] }
      ]
    }
  );

  Payment.associate = (models) => {
    Payment.belongsTo(models.User, { foreignKey: 'user_id', as: 'user'});
    Payment.hasOne(models.VerificationRequest, { foreignKey: 'payment_id', as: 'verificationRequest' });
    Payment.belongsTo(models.Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
  };

  return Payment;
};