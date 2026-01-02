const cron = require('node-cron');
const { db } = require('../models');
const OTPLog = db.OTPLog;

const deleteExpiredOtp = cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running Cron: Delete expired OTPs...');

    const result = await OTPLog.deleteMany({
      expires_at: { $lt: new Date() },
      verified: false
    });

    console.log(`Deleted expired OTPs count: ${result.deletedCount}`);
  } catch (error) {
    console.error('OTP deletion job error:', error);
  }
});

module.exports = deleteExpiredOtp;