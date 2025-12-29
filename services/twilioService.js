const twilio = require('twilio');
const { db } = require('../models');
const Gateway = db.Gateway;

exports.sendTwilioSMS = async (to, message) => {
  try {
    const gateway = await Gateway.findOne({
      name: { $regex: /^twilio$/i },
      enabled: true,
    });

    if (!gateway) {
      throw new Error('Twilio gateway not found or disabled');
    }

    const config = gateway.config || {};

    const account_sid = config.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const auth_token = config.auth_token || process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = config.from || process.env.TWILIO_PHONE;

    if (!account_sid || !auth_token || !fromNumber) {
      throw new Error('Twilio credentials missing');
    }

    const client = twilio(account_sid, auth_token);

    const response = await client.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    });

    console.log('SMS Sent via Twilio:', response.sid);
    return true;
  } catch (err) {
    console.error('Twilio SMS Error:', err.message);
    return false;
  }
};