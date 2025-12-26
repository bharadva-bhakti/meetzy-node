module.exports = (sequelize, DataTypes) => {
  const Language = sequelize.define(
    'Language',
    {
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      locale: {
          type: DataTypes.STRING(10),
          allowNull: false,
          unique: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      translation_json: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'languages',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return Language;
};
  