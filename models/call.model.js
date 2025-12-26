module.exports = (sequelize, DataTypes) => {
  const Call = sequelize.define(
    'Call',
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      initiator_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      group_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'groups', key: 'id' },
        onDelete: 'CASCADE',
      },
      receiver_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      call_type: {
        type: DataTypes.ENUM('audio', 'video'),
        allowNull: false,
      },
      call_mode: {
        type: DataTypes.ENUM('direct', 'group'),
        defaultValue: 'direct',
      },
      status: {
        type: DataTypes.ENUM('active', 'ended'),
        defaultValue: 'active',
      },
      started_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      ended_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      accepted_time: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      max_participants: {
        type: DataTypes.INTEGER,
        defaultValue: 10,
      },
    },
    {
      tableName: 'calls',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_initiator_created_at', fields: ['initiator_id', 'created_at']},
        { name: 'idx_group_created_at', fields: ['group_id', 'created_at']},
        { name: 'idx_receiver_created_at', fields: ['receiver_id', 'created_at']},
        { name: 'idx_status', fields: ['status']},
        { name: 'idx_call_mode', fields: ['call_mode']},
        { name: 'idx_status_ended_at', fields: ['status', 'ended_at']},
        { name: 'idx_call_type_mode', fields: ['call_type', 'call_mode']},
        { name: 'idx_started_at', fields: ['started_at']}
      ],
    }
  );

  Call.associate = (models) => {
    Call.belongsTo(models.User, { foreignKey: 'initiator_id', as: 'initiator' });
    Call.belongsTo(models.Group, { foreignKey: 'group_id', as: 'group' });
    Call.belongsTo(models.User, { foreignKey: 'receiver_id', as: 'receiver' });
    Call.hasMany(models.CallParticipant, { foreignKey: 'call_id', as: 'participants' });
  };

  return Call;
};