module.exports = (sequelize, DataTypes) => {
  const UserReport = sequelize.define(
    'UserReport',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },

      reporter_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
      },

      reported_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
      },

      group_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'groups', key: 'id' },
        onDelete: 'CASCADE'
      },

      chat_type: {
        type: DataTypes.ENUM('direct', 'group'),
        allowNull: false
      },

      reason: {
        type: DataTypes.STRING,
        allowNull: false
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },

      status: {
        type: DataTypes.ENUM('pending', 'under_review', 'resolved', 'dismissed', 'banned'),
        defaultValue: 'pending'
      },

      admin_notes: {
        type: DataTypes.TEXT,
        allowNull: true
      },

      resolved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
      },

      resolved_at: {
        type: DataTypes.DATE,
        allowNull: true
      }
    },
    {
      tableName: 'user_reports',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
      indexes: [
        { fields: ['reporter_id'] },
        { fields: ['reported_user_id'] },
        { fields: ['group_id'] },
        { fields: ['chat_type'] },
        { fields: ['status'] },
        { name: 'idx_resolved_at', fields: ['resolved_at']},
        { name: 'idx_created_at_desc', fields: ['created_at']},
        { name: 'idx_reporter_status', fields: ['reporter_id', 'status']}
      ]
    }
  );

  UserReport.associate = models => {
    UserReport.belongsTo(models.User, { foreignKey: 'reporter_id', as: 'reporter' });
    UserReport.belongsTo(models.User, { foreignKey: 'reported_user_id', as: 'reported_user' });
    UserReport.belongsTo(models.Group, { foreignKey: 'group_id', as: 'group' });
    UserReport.belongsTo(models.User, { foreignKey: 'resolved_by', as: 'resolver' });
  };

  return UserReport;
};
