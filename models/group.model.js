module.exports = (sequelize, DataTypes) => {
  const Group = sequelize.define(
    'Group', 
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      avatar: {
        type: DataTypes.STRING,
        allowNull: true
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
      }
    }, 
    {
      tableName: 'groups',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  );

  Group.associate = models => {
    Group.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });

    Group.belongsToMany(models.User, {
      through: models.GroupMember,
      foreignKey: 'group_id',
      otherKey: 'user_id'
    });

    Group.hasMany(models.Message, { as: 'messages', foreignKey: 'group_id' });
    Group.hasMany(models.GroupMember, { foreignKey: 'group_id', as: 'memberships' });
    Group.hasOne(models.GroupSetting, { foreignKey: 'group_id', as: 'setting', onDelete: 'CASCADE' });
  };

  return Group;
};