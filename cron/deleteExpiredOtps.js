const cron = require('node-cron');
const { OTPLog } = require('../models');
const { Op } = require('sequelize');

const deleteExpiredOtp = cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running Cron: Delete expired OTPs...');

    const deleted = await OTPLog.destroy({
      where: {
        expires_at: { [Op.lt]: new Date() },
        verified: false
      }
    });

    console.log(`Deleted expired OTPs count: ${deleted}`);
  } catch (error) {
    console.error('OTP deletion job error:', error);
  }
});

module.exports = deleteExpiredOtp;
