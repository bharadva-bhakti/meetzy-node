module.exports = (sequelize, DataTypes) => {
    const Archive = sequelize.define(
        'Archive',
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
                type: DataTypes.ENUM('user', 'group', 'broadcast', 'announcement'),
                allowNull: false,
            },
        },
        {
            tableName: 'archives',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                {
                    name: 'idx_user_target_archive',
                    fields: ['user_id', 'target_type', 'target_id'],
                    unique: true
                },
                { name: 'idx_user_archive', fields: ['user_id']},
                { name: 'idx_target_type_target_id', fields: ['target_type', 'target_id']},
                { name: 'idx_created_at', fields: ['created_at']}
            ],
        }
    );

    Archive.associate = (models) => {
      Archive.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    };

    return Archive;
};