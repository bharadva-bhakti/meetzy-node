module.exports = (sequelize, DataTypes) => {
    const GoogleToken = sequelize.define(
        'GoogleToken',
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
            google_email: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            access_token: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            refresh_token: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            expiry_date: {
                type: DataTypes.BIGINT,
                allowNull: true,
            },
        },
        {
            tableName: 'google_tokens',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        }
    );
    GoogleToken.associate = models => {
        GoogleToken.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    };

    return GoogleToken;
};