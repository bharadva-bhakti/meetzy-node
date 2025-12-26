module.exports = (sequelize, DataTypes) => {
  const ReportReason = sequelize.define(
    'ReportReason', 
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      }
    }, 
    {
      tableName: 'report_reasons',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return ReportReason;
};
  