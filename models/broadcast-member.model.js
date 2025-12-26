module.exports = (sequelize, DataTypes) => {
    const BroadcastMember = sequelize.define(
      'BroadcastMember',
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        broadcast_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'broadcasts', key: 'id' },
          onDelete: 'CASCADE'
        },
        recipient_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE',
          comment: 'User who will receive broadcast messages'
        },
        added_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW
        }
      },
      {
        tableName: 'broadcast_members',
        timestamps: false,
        indexes: [
          { fields: ['broadcast_id'] },
          { fields: ['recipient_id'] },
          { 
            name: 'idx_broadcast_recipient_unique',
            fields: ['broadcast_id', 'recipient_id'],
            unique: true
          }
        ]
      }
    );
  
    BroadcastMember.associate = (models) => {
      BroadcastMember.belongsTo(models.Broadcast, { foreignKey: 'broadcast_id', as: 'broadcast' });
      BroadcastMember.belongsTo(models.User, { foreignKey: 'recipient_id', as: 'recipient' });
    };
  
    return BroadcastMember;
};