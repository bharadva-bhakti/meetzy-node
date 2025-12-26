module.exports = (sequelize, DataTypes) => {
    const VerificationRequest = sequelize.define('VerificationRequest', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
        },
        request_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            unique: true,
        },
        full_name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        category: {
            type: DataTypes.ENUM('individual', 'business', 'creator'),
            allowNull: false,
        },
        document_type: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        document_front: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        document_back: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        selfie: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('pending', 'payment_failed', 'approved', 'rejected'),
            defaultValue: 'pending',
        },
        payment_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'payments', key: 'id' },
            onDelete: 'RESTRICT'
        },
        verification_source: {
            type: DataTypes.ENUM('user_paid', 'subscription', 'admin_granted'),
            defaultValue: 'user_paid',
            allowNull: false
        },
        subscription_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'subscriptions', key: 'id' },
            onDelete: 'SET NULL'
        },
        rejection_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        reviewed_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' },
        },
        reviewed_at: {
            type: DataTypes.DATE,
            allowNull: true
        },
        admin_notes: {
            type: DataTypes.TEXT,
            allowNull: true
        }
    }, {
        tableName: 'verification_requests',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [
            { fields: ['user_id'] },
            { fields: ['request_id'] },
            { fields: ['status'] },
            { fields: ['reviewed_by'] },
            { fields: ['reviewed_at'] }
        ],
    });
  
    VerificationRequest.associate = (models) => {
      VerificationRequest.belongsTo(models.User, {foreignKey: 'user_id', as: 'user' });
      VerificationRequest.belongsTo(models.Payment, { foreignKey: 'payment_id', as: 'payment' });
      VerificationRequest.belongsTo(models.User, { foreignKey: 'reviewed_by', as: 'reviewer' });
      VerificationRequest.belongsTo(models.Subscription, { foreignKey: 'subscription_id', as: 'subscription' });
    };
  
    return VerificationRequest;
};