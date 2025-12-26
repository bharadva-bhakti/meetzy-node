module.exports = (sequelize, DataTypes) => {
  const MessageStatus = sequelize.define('MessageStatus', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    message_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    status: {
      type: DataTypes.ENUM('sent', 'delivered', 'seen', 'blocked'),
      allowNull: false,
      defaultValue: 'sent',
    },
  }, {
    tableName: 'message_statuses',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['message_id'] },
      { fields: ['user_id'] },
      { name: 'idx_status', fields: ['status']},
      { name: 'idx_message_status', fields: ['message_id', 'status']},
      { name: 'idx_user_status', fields: ['user_id', 'status']},
      { name: 'idx_created_at', fields: ['created_at']}
    ]
  });

  MessageStatus.associate = models => {
    MessageStatus.belongsTo(models.Message, { foreignKey: 'message_id', as: 'message' });
    MessageStatus.belongsTo(models.User, { foreignKey: 'user_id' });
  };

  return MessageStatus;
};
  