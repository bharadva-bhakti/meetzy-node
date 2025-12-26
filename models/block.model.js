module.exports = (sequelize, DataTypes) => {
    const Block = sequelize.define(
        'Block',
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            blocker_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            blocked_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'users', key: 'id' },
                onDelete: 'CASCADE',
            },
            group_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'groups', key: 'id' },
                onDelete: 'CASCADE',
            },
            block_type: {
                type: DataTypes.ENUM('user', 'group'),
                allowNull: false,
                defaultValue: 'user',
            },
        },
        {
            tableName: 'blocks',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                { unique: true, fields: ['blocker_id', 'blocked_id'], where: { block_type: 'user' }},
                { unique: true, fields: ['blocker_id', 'group_id'], where: { block_type: 'group' }},
            ],
        }
    );

    Block.associate = (models) => {
        Block.belongsTo(models.User, { foreignKey: 'blocker_id', as: 'blocker' });
        Block.belongsTo(models.User, { foreignKey: 'blocked_id', as: 'blocked' });
        Block.belongsTo(models.Group, { foreignKey: 'group_id', as: 'blockedGroup' });
    };

    return Block;
};