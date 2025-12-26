module.exports = (sequelize, DataTypes) => {
    const Friend = sequelize.define(
        'Friend',
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
            friend_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            status: {
                type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'blocked'),
                defaultValue: 'pending',
            },
            requested_by: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id',
                },
            },
        },
        {
            tableName: 'friends',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                { unique: true, fields: ['user_id', 'friend_id']},
                { name: 'idx_status', fields: ['status']},
                { name: 'idx_requested_by', fields: ['requested_by']},
                { name: 'idx_user_status', fields: ['user_id', 'status']},
                { name: 'idx_created_at', fields: ['created_at']}
            ]
        }
    );

    Friend.associate = (models) => {
        Friend.belongsTo(models.User, { as: 'user', foreignKey: 'user_id'});
        Friend.belongsTo(models.User, { as: 'friend', foreignKey: 'friend_id'});
        Friend.belongsTo(models.User, { as: 'requested', foreignKey: 'requested_by'});
    };

    return Friend;
};