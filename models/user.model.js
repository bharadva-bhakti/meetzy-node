module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      bio:{
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue:'Hey, I am using meetzy.'
      },
      email: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      password: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      country_code: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      role: {
        type: DataTypes.ENUM('super_admin', 'user'),
        defaultValue: 'user',
      },
      email_verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      last_login: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_online: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      last_seen: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'deactive'),
        defaultValue: 'active',
      },
      public_key: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "User's public key for E2E encryption",
      },
      private_key: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "User's private key for E2E encryption",
      },

      // blue tick verification
      stripe_customer_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
      },
      is_verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      paranoid: true,
      deletedAt: 'deleted_at',
      indexes: [
        { name: 'idx_email', fields: ['email']},
        { name: 'idx_status', fields: ['status']},
        { name: 'idx_role', fields: ['role']},
        { name: 'idx_last_seen', fields: ['last_seen']},
        { name: 'idx_is_online', fields: ['is_online']},
        { name: 'idx_deleted_at', fields: ['deleted_at']},
        { name: 'idx_created_at', fields: ['created_at']}
      ]
    }
  );

  User.associate = (models) => {
    User.belongsToMany(models.Group, {
      through: models.GroupMember,
      foreignKey: 'user_id',
      otherKey: 'group_id',
    });
  
    User.hasMany(models.MessageStatus, { foreignKey: 'user_id' });  
    User.hasMany(models.GroupMember, { foreignKey: 'user_id', as: 'groupMembers' });
    User.hasOne(models.UserSetting, { foreignKey: 'user_id', as: 'setting' });
    User.hasMany(models.VerificationRequest, { foreignKey: 'user_id', as: 'verificationRequests' });
    User.belongsTo(models.Subscription, { foreignKey: 'id', targetKey: 'user_id', as: 'activeSubscription' });
  };

  return User;
};
  