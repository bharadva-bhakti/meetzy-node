module.exports = (sequelize, DataTypes) => {
  const GroupMember = sequelize.define(
    'GroupMember', 
    {
      group_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'groups', key: 'id' },
        onDelete: 'CASCADE'
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE'
      },
      role: {
        type: DataTypes.ENUM('admin', 'member'),
        defaultValue: 'member'
      }
    },
    {
      tableName: 'group_members',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_group_user', fields: ['group_id', 'user_id'], unique: true},
        { name: 'idx_user_id', fields: ['user_id']},
        { name: 'idx_group_role', fields: ['group_id', 'role']},
        { name: 'idx_created_at', fields: ['created_at']}
      ]
    }
  );

  GroupMember.associate = models => {
    GroupMember.belongsTo(models.Group, { foreignKey: 'group_id' });
    GroupMember.belongsTo(models.User, { as: 'user', foreignKey: 'user_id' });
  };

  return GroupMember;
};