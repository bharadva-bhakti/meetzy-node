module.exports = (sequelize, DataTypes) => {
  const Broadcast = sequelize.define(
    'Broadcast',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      creator_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        comment: 'User who created the broadcast list'
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Name of the broadcast list'
      },
    },
    {
      tableName: 'broadcasts',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ fields: ['creator_id'] },]
    }
  );

  Broadcast.associate = (models) => {
    Broadcast.belongsTo(models.User, { foreignKey: 'creator_id', as: 'creator' });
    Broadcast.hasMany(models.BroadcastMember, { foreignKey: 'broadcast_id', as: 'recipients', onDelete: 'CASCADE'});
  };

  return Broadcast;
};