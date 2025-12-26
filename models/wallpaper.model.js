module.exports = (sequelize, DataTypes) => {
  const Wallpaper = sequelize.define(
    'Wallpaper', 
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      wallpaper: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      is_default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      }
    }, 
    {
      tableName: 'wallpapers',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_status', fields: ['status']},
        { name: 'idx_created_at', fields: ['created_at']}
      ]
    }
  );

  return Wallpaper;
};
  