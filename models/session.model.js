module.exports = (sequelize, DataTypes) => {
  const Session = sequelize.define('Session', {
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE'
    },
    session_token: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    device_info: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ip_address: {
      type: DataTypes.STRING,
      allowNull: true
    },
    agenda: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    }
  }, 
  {
    tableName: 'sessions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { name: 'idx_user_status', fields: ['user_id', 'status']},
      { name: 'idx_expires_at', fields: ['expires_at']},
      { name: 'idx_session_token', fields: ['session_token']},
      { name: 'idx_agenda', fields: ['agenda']},
      { name: 'idx_created_at', fields: ['created_at']}
    ]
  });

  Session.associate = models => {
    Session.belongsTo(models.User, { foreignKey: 'user_id' });
  };

  return Session;
};
  