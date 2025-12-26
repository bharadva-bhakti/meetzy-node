module.exports = (sequelize, DataTypes) => {
    const GroupSetting = sequelize.define(
        'GroupSetting',
        {
            group_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'groups', key: 'id' },
                onDelete: 'CASCADE'
            },
            allow_edit_info: {
                type: DataTypes.ENUM('admin', 'everyone'),
                defaultValue: 'admin'
            },
            allow_send_message: {
                type: DataTypes.ENUM('admin', 'everyone'),
                defaultValue: 'everyone' 
            },
            allow_add_member: {
                type: DataTypes.ENUM('admin', 'everyone'),
                defaultValue: 'admin'
            },
            allow_mentions: {
                type: DataTypes.ENUM('admin', 'everyone'),
                defaultValue: 'everyone',
            },
        },
        {
            tableName: 'group_settings',
            timestamps: true,
            indexes: [{ unique: true, fields: ['group_id'] }],
        }
    );
    
    GroupSetting.associate = (models) => {
        GroupSetting.belongsTo(models.Group, {
          foreignKey: 'group_id',
          as: 'group',
          onDelete: 'CASCADE',
        });
    };

    return GroupSetting;
};