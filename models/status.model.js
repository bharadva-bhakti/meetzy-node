module.exports = (sequelize, DataTypes) => {
    const Status = sequelize.define('Status',{
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
        },
        type: {
            type: DataTypes.ENUM('text', 'image', 'video'),
            defaultValue: 'text'
        },
        file_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        caption: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        sponsored: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        expires_at: {
            type: DataTypes.DATE,
            allowNull: false
        }
    },{
        tableName: 'statuses',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: false,
        indexes: [
            { fields: ['user_id'] },
            { name: 'idx_expires_at', fields: ['expires_at']},
            { name: 'idx_type', fields: ['type']},
            { name: 'idx_user_expires', fields: ['user_id', 'expires_at']},
            { name: 'idx_created_at_desc', fields: ['created_at']}
        ]
    });

    Status.associate = (models) => {
        Status.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
        Status.hasMany(models.StatusView, { foreignKey: 'status_id', as: 'views' });
    };

    return Status;
};