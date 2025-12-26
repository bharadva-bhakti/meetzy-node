module.exports = (sequelize, DataTypes) => {
    const UserSetting = sequelize.define('UserSetting', {
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
        },

        // privacy setting
        last_seen: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        profile_pic: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        display_bio: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        read_receipts: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        typing_indicator: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        hide_phone: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },

        // Status Setting
        status_privacy: {
            type: DataTypes.ENUM('my_contacts', 'only_share_with'),
            defaultValue: 'my_contacts',
            allowNull: false
        },

        shared_with: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: [] 
        },

        // customizer
        chat_wallpaper: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'none'
        },
        mode: {
            type: DataTypes.ENUM('light', 'dark'),
            allowNull: false,
            defaultValue: 'light'
        },
        color: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'style'
        },
        layout: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'default-layout'
        },
        sidebar: {
            type: DataTypes.ENUM('three-column', 'two-column'),
            allowNull: false,
            defaultValue: 'three-column'
        },
        direction: {
            type: DataTypes.ENUM('ltr', 'rtl'),
            allowNull: false,
            defaultValue: 'ltr',
        },

        // chat backup
        auto_backup: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        doc_backup: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },
        video_backup: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },

        // lock chat
        pin_hash: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        chat_lock_enabled: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        locked_chat_ids: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        chat_lock_digit: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 4
        },
    },
    {
        tableName: 'user_settings',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        indexes: [{ unique: true, fields: ['user_id'] }]
    });

    UserSetting.associate = (models) => {
        UserSetting.belongsTo(models.User, { as: 'user', foreignKey: 'user_id'});
    };
  
    return UserSetting;
};