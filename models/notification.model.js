module.exports = (sequelize, DataTypes) => {
    const Notification = sequelize.define(
        'Notification',
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
                allowNull: false,
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            from_user_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id'},
                onDelete: 'SET NULL',
            },
            type: {
                type: DataTypes.ENUM('friend_request', 'friend_accepted', 'friend_rejected', 'message', 'group_invite', 'system'),
                allowNull: false,
            },
            title: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            message: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            data: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            is_read: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            read_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        },
        {
            tableName: 'notifications',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                { name: 'idx_user_read', fields: ['user_id', 'is_read']},
                { name: 'idx_type', fields: ['type']},
                { name: 'idx_from_user', fields: ['from_user_id']},
                { name: 'idx_created_at_desc', fields: ['created_at']},
                { name: 'idx_read_at', fields: ['read_at']}
            ]
        }
    );

    Notification.associate = (models) => {
        Notification.belongsTo(models.User, {
            as: 'user',
            foreignKey: 'user_id'
        });

        Notification.belongsTo(models.User, {
            as: 'from_user',
            foreignKey: 'from_user_id'
        });
    };

    return Notification;
};