module.exports = (sequelize, DataTypes) => {
  const PageContent = sequelize.define(
    'Page',
    {
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      content: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
      },
      meta_title: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      meta_description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
    },
    {
      tableName: 'pages',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_slug', fields: ['slug']},
        { name: 'idx_status', fields: ['status']},
        { name: 'idx_created_by', fields: ['created_by']},
        { name: 'idx_created_at', fields: ['created_at']}
      ]
    }
  );
  return PageContent;
};
