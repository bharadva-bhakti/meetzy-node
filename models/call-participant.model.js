module.exports = (sequelize, DataTypes) => {
  const CallParticipant = sequelize.define(
    'CallParticipant',
    {
      id: {
        type: DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
      },
      call_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'calls', key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      status: {
        type: DataTypes.ENUM('invited', 'joined', 'declined', 'missed', 'left', 'kicked'),
        defaultValue: 'invited',
      },
      joined_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      left_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      is_muted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      is_screen_sharing: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      is_video_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      video_status: {
        type: DataTypes.ENUM('enabled', 'disabled', 'unavailable'),
        defaultValue: 'disabled',
      },
      peer_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      tableName: 'call_participants',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_call_user', fields: ['call_id', 'user_id'], unique: true},
        { name: 'idx_user_status', fields: ['user_id', 'status']},
        { name: 'idx_call_status', fields: ['call_id', 'status']},
        { name: 'idx_user_joined_at', fields: ['user_id', 'joined_at']},
        { name: 'idx_status_joined_at', fields: ['status', 'joined_at']},
        { name: 'idx_peer_id', fields: ['peer_id']}
      ],
    }
  );

  CallParticipant.associate = (models) => {
    CallParticipant.belongsTo(models.Call, { foreignKey: 'call_id', as: 'call' });
    CallParticipant.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return CallParticipant;
};