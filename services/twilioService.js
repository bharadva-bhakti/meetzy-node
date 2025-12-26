const twilio = require('twilio');
const { Gateway } = require('../models');
const { Op, fn, col, where} = require('sequelize');

exports.sendTwilioSMS = async (to, message) => {
  try {

    const gateway = await Gateway.findOne({
      where:{
        [Op.and]: [
          where(fn('LOWER', col('name')), 'twilio'.toLowerCase())
        ],
        enabled: true,
      },
      raw: true
    });

    if (!gateway) {
      throw new Error('Twilio gateway not found');
    }

    const config = gateway.config || {};

    const account_sid = config.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const auth_token = config.auth_token || process.env.TWILIO_AUTH_TOKEN

    const client = twilio( account_sid, auth_token );
    
    const response = await client.messages.create({
      body: message,
      from: config.from || process.env.TWILIO_PHONE,
      to: to,
    });

    console.log('SMS Sent:', response.sid);
    return true;
  } catch (err) {
    console.error('Twilio SMS Error:', err.message);
    return false;
  }
};