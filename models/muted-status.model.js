module.exports = (sequelize, DataTypes) => {
  const MutedStatus = sequelize.define('MutedStatus', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    target_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  }, {
    tableName: 'muted_status',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [{ unique: true, fields: ['user_id', 'target_id']}]
  });

  MutedStatus.associate = models => {
    MutedStatus.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    MutedStatus.belongsTo(models.User, { foreignKey: 'target_id', constraints: false, as: 'mutedUser' });
  };

  return MutedStatus;
};