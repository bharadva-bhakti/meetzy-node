module.exports = (sequelize, DataTypes) => {
    const MessageAction = sequelize.define(
        'MessageAction', 
        {
            message_id: {
                type: DataTypes.BIGINT,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            action_type: {
                type: DataTypes.ENUM('star', 'edit', 'forward', 'delete'),
                allowNull: false,
            },
            details: {
                type: DataTypes.JSON,
                allowNull: true,
            },
        },
        {
            tableName: 'message_actions',
            timestamps: true,
            underscored: true,
            indexes: [
                { name: 'idx_message_user_action', fields: ['message_id', 'user_id', 'action_type'], unique: true },
                { name: 'idx_user_id', fields: ['user_id']},
                { name: 'idx_action_type', fields: ['action_type']},
                { name: 'idx_created_at', fields: ['created_at']}
            ]
        }
    );
  
    MessageAction.associate = (models) => {
      MessageAction.belongsTo(models.Message, { foreignKey: 'message_id' });
      MessageAction.belongsTo(models.User, { foreignKey: 'user_id' });
    };
  
    return MessageAction;
}; 