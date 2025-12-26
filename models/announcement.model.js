module.exports = (sequelize, DataTypes) => {
  const Announcement = sequelize.define(
    'Announcement',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      message_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'messages', key: 'id' },
        onDelete: 'CASCADE',
        unique: true,
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      announcement_type: {
        type: DataTypes.ENUM('get_started', 'learn_more', 'none'),
        allowNull: true,
      },
      action_link: {
        type: DataTypes.STRING(500),
        allowNull: true, 
      },
      redirect_url: {
        type: DataTypes.STRING(500),
        allowNull: true, 
      }
    },
    {
      tableName: 'announcements',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_message_id', fields: ['message_id'] },
        { name: 'idx_announcement_type', fields: ['announcement_type'] },
      ],
    }
  );

  Announcement.associate = (models) => {
    Announcement.belongsTo(models.Message, { foreignKey: 'message_id', as: 'message', onDelete: 'CASCADE'});
  };

  return Announcement;
};