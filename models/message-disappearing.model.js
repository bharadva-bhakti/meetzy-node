module.exports = (sequelize, DataTypes) => {
  const MessageDisappearing = sequelize.define(
    'MessageDisappearing',
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      message_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'messages', key: 'id' },
        onDelete: 'CASCADE',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      expire_after_seconds: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      expire_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      }
    },
    {
      tableName: 'message_disappearings',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  MessageDisappearing.associate = (models) => {
    MessageDisappearing.belongsTo(models.Message, {foreignKey: 'message_id', as: 'message'});
  };

  return MessageDisappearing;
};
  