const mongoose = require('mongoose');
const { db } = require('../models');
const ReportReason = db.ReportReason;

mongoose.connect(process.env.MONGODB_URI,)
  .then(() => console.log('MongoDB connected for seeding report reasons'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

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

async function seed() {
  try {
    await ReportReason.deleteMany({});

    await ReportReason.insertMany(reportReasons);
    console.log('Report reasons seeded successfully!');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding report reasons:', error);
    process.exit(1);
  }
}

seed();