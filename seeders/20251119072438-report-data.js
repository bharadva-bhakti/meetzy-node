const ReportReason = require('../models/report-reason.model');

const reportReasons = [
  { title: 'Spam' },
  { title: 'Fraud' },
  { title: 'Nudity or Sexual Content' },
  { title: 'Hate Speech or Abusive Content' },
  { title: 'Harassment or Bullying' },
  { title: 'Violence or Threats' },
  { title: 'Self-Harm or Suicide' },
  { title: 'Misinformation or Fake News' },
  { title: 'Impersonation' },
  { title: 'Other' },
];

async function up(dbConnection, mongoose) {
  try {
    const ReportReasonModel = dbConnection.db.ReportReason || require('../models/report-reason.model');
    
    await ReportReasonModel.deleteMany({});
    await ReportReasonModel.insertMany(reportReasons);
    console.log('Report reasons seeded successfully!');
  } catch (error) {
    console.error('Error seeding report reasons:', error);
    throw error;
  }
}

async function down(dbConnection, mongoose) {
  try {
    const ReportReasonModel = dbConnection.db.ReportReason || require('../models/report-reason.model');
    
    await ReportReasonModel.deleteMany({});
    console.log('Report reasons removed successfully!');
  } catch (error) {
    console.error('Error removing report reasons:', error);
    throw error;
  }
}

module.exports = { up, down };