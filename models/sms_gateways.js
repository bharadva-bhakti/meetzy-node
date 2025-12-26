module.exports = (sequelize, DataTypes) => {
    const Gateway = sequelize.define('Gateway', {

        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },

        name: {
            type: DataTypes.STRING,
            allowNull: false
        },

        config: {
            type: DataTypes.JSON,
            allowNull: false
        },

        enabled: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        }

    }, {
        tableName: 'gateways',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    });

    return Gateway;
};
