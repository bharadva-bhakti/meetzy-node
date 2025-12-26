module.exports = (sequelize, DataTypes) => {
  const PinnedConversation = sequelize.define(
    'PinnedConversation', 
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      type: {
        type: DataTypes.ENUM('group', 'direct', 'broadcast', 'announcement'),
        allowNull: false,
      },
      target_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      pinned_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      }
    }, 
    {
      tableName: 'pinned_conversations',
      timestamps: false,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_user_type_target', fields: ['user_id', 'type', 'target_id'], unique: true},
        { name: 'idx_pinned_at', fields: ['pinned_at']},
        { name: 'idx_type', fields: ['type']}
      ]
    }
  );

  return PinnedConversation;
};
