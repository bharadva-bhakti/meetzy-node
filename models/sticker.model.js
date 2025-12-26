module.exports = (sequelize, DataTypes) => {
  const Sticker = sequelize.define(
    'Sticker', 
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      sticker: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      }
    }, 
    {
      tableName: 'sticker',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Sticker;
};
  