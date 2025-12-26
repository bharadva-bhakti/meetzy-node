module.exports = (sequelize, DataTypes) => {
    const Favorite = sequelize.define(
        'Favorite',
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
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
                type: DataTypes.ENUM('user', 'group', 'announcement'),
                allowNull: false,
            },
        },
        {
            tableName: 'favorites',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                { name: 'idx_user_target', fields: ['user_id', 'target_type', 'target_id'], unique: true},
                { name: 'idx_user_id', fields: ['user_id']},
                { name: 'idx_target_type_target_id', fields: ['target_type', 'target_id']},
                { name: 'idx_created_at', fields: ['created_at']}
            ],
        }
    );

    Favorite.associate = (models) => {
        Favorite.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    };

    return Favorite;
};