module.exports = (sequelize, DataTypes) => {
  const ChatSetting = sequelize.define(
    'ChatSetting',
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      recipient_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      group_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'groups', key: 'id' },
      },
      disappearing_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      duration: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expire_after_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'chat_settings',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  ChatSetting.associate = (models) => {
    ChatSetting.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    ChatSetting.belongsTo(models.User, { foreignKey: 'recipient_id', as: 'recipient' });
    ChatSetting.belongsTo(models.Group, { foreignKey: 'group_id', as: 'group' });
  };

  return ChatSetting;
};
