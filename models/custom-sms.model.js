module.exports = (sequelize, DataTypes) => {
    const SMSGateway = sequelize.define('SMSGateway', {

        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        base_url: {
            type: DataTypes.STRING,
            allowNull: false
        },
        method: {
            type: DataTypes.STRING,
            defaultValue: 'POST'
        },
        auth_type: {
            type: DataTypes.JSON,
            allowNull: true
        },
        account_sid: {
            type: DataTypes.STRING,
            allowNull: true
        },
        auth_token: {
            type: DataTypes.STRING,
            allowNull: true
        },
        from_number: {
            type: DataTypes.STRING,
            allowNull: true
        },
        custom_config: {
            type: DataTypes.JSON,
            allowNull: true
        },
        enabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
    }, {
        tableName: 'sms_gateways',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    });
  
    return SMSGateway;
};
    