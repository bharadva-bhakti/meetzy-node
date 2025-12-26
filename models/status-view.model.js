module.exports = (sequelize, DataTypes) => {
    const StatusView = sequelize.define('StatusView', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        status_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'statuses', key: 'id' },
            onDelete: 'CASCADE'
        },
        viewer_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
        },
        viewer_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },{
        tableName: 'status_views',
        timestamps: false,
        uniqueKeys: {
            unique_status_view: {fields: ['status_id', 'viewer_id']}
        },
        indexes: [
            { fields: ['status_id'] },
            { fields: ['viewer_id'] },
            { name: 'idx_viewer_at', fields: ['viewer_at']},
            { name: 'idx_status_viewer', fields: ['status_id', 'viewer_id']}
        ]          
    });

    StatusView.associate = (models) => {
        StatusView.belongsTo(models.Status, { foreignKey: 'status_id', as: 'status' });
        StatusView.belongsTo(models.User, { foreignKey: 'viewer_id', as: 'viewer' });
    };
    
    return StatusView;
}