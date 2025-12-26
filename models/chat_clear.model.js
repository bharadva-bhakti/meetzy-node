module.exports = (sequelize, DataTypes) => {
  const ChatClear = sequelize.define('ChatClear', {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    recipient_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    group_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    broadcast_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    cleared_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    }
  }, {
    tableName: 'chat_clears',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['user_id', 'recipient_id'] },
      { unique: true, fields: ['user_id', 'group_id'] },
      { name: 'idx_cleared_at', fields: ['cleared_at']},
      { name: 'idx_user_cleared_at', fields: ['user_id', 'cleared_at']}
    ]
  });

  return ChatClear;
};