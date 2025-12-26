module.exports = (sequelize,DataTypes) => {
    const UserDelete = sequelize.define(
        'UserDelete',
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
                onDelete: 'CASCADE',
            },
            target_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            target_type: {
                type: DataTypes.ENUM('user', 'group'),
                allowNull: false,
            },
            delete_type: {
                type: DataTypes.ENUM('hide_chat', 'delete_messages'),
                defaultValue: 'hide_chat',
                allowNull: false,
            },
        },
        {
            tableName: 'user_deletes',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                { name: 'idx_user_target_delete', fields: ['user_id', 'target_type', 'target_id'], unique: true },
                { name: 'idx_user_delete', fields: ['user_id']},
                { name: 'idx_delete_type', fields: ['delete_type']},
                { name: 'idx_created_at', fields: ['created_at']}
            ],
        }
    );

    UserDelete.associate = (models) => {
        UserDelete.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    };

    return UserDelete;
};