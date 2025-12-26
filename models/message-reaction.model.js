module.exports = (sequelize, DataTypes) => {
  const MessageReaction = sequelize.define(
    'MessageReaction',
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
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
      emoji: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    },
    {
      tableName: 'message_reactions',
      timestamps: true,
      underscored: true,
      indexes: [
        { name: 'idx_message_user_emoji', fields: ['message_id', 'user_id', 'emoji'], unique: true},
        { name: 'idx_user_id', fields: ['user_id']},
        { name: 'idx_emoji', fields: ['emoji']},
        { name: 'idx_created_at', fields: ['created_at']}
    ]
    }
  );

  MessageReaction.associate = (models) => {
    MessageReaction.belongsTo(models.Message, { foreignKey: 'message_id' });
    MessageReaction.belongsTo(models.User, { foreignKey: 'user_id' });
  };

  return MessageReaction;
};