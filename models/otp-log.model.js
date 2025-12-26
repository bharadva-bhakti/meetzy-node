module.exports = (sequelize, DataTypes) => {
  const OTPLog = sequelize.define('OTPLog', {
    email: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    otp: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    }
  }, {
    tableName: 'otp_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { name: 'idx_email', fields: ['email']},
      { name: 'idx_phone', fields: ['phone']},
      { name: 'idx_expires_at', fields: ['expires_at']},
      { name: 'idx_verified', fields: ['verified']},
      { name: 'idx_email_verified', fields: ['email', 'verified']}
    ]
  });

  return OTPLog;
};
  