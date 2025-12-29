const { db } = require('../models');
const User = db.User;
const Session = db.Session;
const OTPLog = db.OTPLog;
const Setting = db.Setting;

const { generateToken } = require('../utils/jwt');
const { sendMail } = require('../utils/mail');
const { sendTwilioSMS } = require('../services/twilioService');
const { sendSMS } = require('../services/customSMSService');

function generateOTP() {
  return process.env.DEMO === 'true' ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
};

async function getSettings() {
  const settings = await Setting.findOne();
  if (!settings) throw new Error('Settings not defined');
  return settings;
};

async function checkMaintenanceAccess(ip) {
  const settings = await getSettings();
  if (settings.maintenance_mode && !settings.maintenance_allowed_ips?.includes(ip)) {
    throw new Error('MAINTENANCE_MODE');
  }
  return settings;
};

async function findUserByIdentifier(identifier) {
  const clean = identifier.replace(/\s+/g, '').trim().toLowerCase();
  const isEmail = isEmailIdentifier(clean);
  const isPhone = isPhoneIdentifier(clean);

  if (isEmail) {
    return await User.findOne({ email: clean });
  }

  if (isPhone) {
    const phoneNumber = clean;
    for (let i = 2; i <= 5; i++) {
      const code = phoneNumber.slice(0, i);
      const number = phoneNumber.slice(i);
      if (!/^\d{4,14}$/.test(number)) continue;

      const user = await User.findOne({ country_code: code, phone: number });
      if (user) return user;
    }
  }

  return null;
};

async function sendOtp(sendType, sendValue, subject, updateType, updateValue) {
  const otp = generateOTP();

  await OTPLog.create({
    email: sendType === 'email' ? sendValue : (updateType === 'email' ? updateValue : null),
    phone: sendType === 'phone' ? sendValue : (updateType === 'phone' ? updateValue : null),
    otp,
    verified: false,
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });

  if (process.env.DEMO === 'true') return { demo: true, otp };

  const msg = `Your verification OTP is ${otp}`;
  let sent = false;

  if (sendType === 'email') {
    sent = await sendMail(sendValue, subject, msg);
  } else {
    const settings = await getSettings();
    const gw = settings.sms_gateway?.toLowerCase();
    sent = gw === 'custom' ? await sendSMS(sendValue, msg) : await sendTwilioSMS(sendValue, msg);
  }

  return { sent, otp, updateType, updateValue };
};

const isEmailIdentifier = (identifier) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
const isPhoneIdentifier = (identifier) => /^\+[1-9]\d{6,14}$/.test(identifier);

async function verifyOtpForUser(identifier, otp) {
  const clean = identifier.replace(/\s+/g, '').trim().toLowerCase();
  if (!isEmailIdentifier(clean) && !isPhoneIdentifier(clean)) {
    return { error: 'Invalid identifier format' };
  }

  const record = await OTPLog.findOne({
    otp,
    verified: false,
    ...(isEmailIdentifier(clean) ? { email: clean } : {}),
    ...(isPhoneIdentifier(clean) ? { phone: clean } : {}),
    expires_at: { $gt: new Date() },
  }).sort({ created_at: -1 });

  if (!record) return { error: 'Invalid or expired OTP' };
  return { otpRecord: record };
};

async function getTestEmailHtml() {
  const timestamp = new Date().toLocaleString();
  const settings = await getSettings();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset='UTF-8'>
      <meta name='viewport' content='width=device-width, initial-scale=1.0'>
      <title>Test Email</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          line-height: 1.6;
          color: #333;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
        }
        .email-container {
          max-width: 600px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .email-header {
          background: linear-gradient(135deg, #25767b 0%,rgb(109, 198, 202) 100%);
          color: white;
          padding: 30px 20px;
          text-align: center;
        }
        .email-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .email-content {
          padding: 40px 30px;
        }
        .email-content h2 {
          color: #2d3748;
          margin-top: 0;
          font-size: 22px;
          font-weight: 600;
        }
        .test-message {
          background: #f8f9fa;
          border-left: 4px solid #25767b;
          padding: 20px;
          margin: 25px 0;
          border-radius: 0 8px 8px 0;
        }
        .test-message p {
          margin: 10px 0;
          color: #4a5568;
        }
        .success-badge {
          display: inline-block;
          background: #48bb78;
          color: white;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          margin: 10px 0;
        }
        .info-box {
          background: #fffaf0;
          border: 1px solid #fed7d7;
          border-radius: 8px;
          padding: 15px;
          margin: 20px 0;
          font-size: 14px;
          color: #744210;
        }
        .timestamp {
          color: #a0aec0;
          font-size: 13px;
          margin-top: 10px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class='email-container'>
        <div class='email-header'>
          <h1>${settings.app_name}</h1>
        </div>
        
        <div class='email-content'>
          <h2>✉️ Email Configuration Test</h2>
          <p>This is a test email to verify your ${settings.app_name} SMTP configuration.</p>
          
          <div class='test-message'>
            <p><strong>If you received this email:</strong></p>
            <p>- Your email settings are correctly configured</p>
            <p>- Emails are being sent from ${settings.app_name}</p>
            <p>- The mail server connection is working properly</p>
            <div class='success-badge'>SMTP Configuration Verified</div>
          </div>
            
          <div class='info-box'>
            <strong>📋 Important:</strong> This is an automated test message. No action is required.
          </div>
          
          <div class='timestamp'>
            Test sent on: ${timestamp}
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

const getUserByIdentifier = async (identifier, authMethod) => {
  const clean = identifier.trim().toLowerCase();
  if (isEmailIdentifier(clean) && ['email', 'both'].includes(authMethod)) {
    return await User.findOne({ email: clean });
  }

  if (isPhoneIdentifier(clean) && ['phone', 'both'].includes(authMethod)) {
    const phoneNumber = clean;
    for (let i = 2; i <= 5; i++) {
      const code = phoneNumber.slice(0, i);
      const number = phoneNumber.slice(i);
      if (!/^\d{4,14}$/.test(number)) continue;

      const user = await User.findOne({ country_code: code, phone: number });
      if (user) return user;
    }
  }

  return null;
};

const manageSession = async (user, req, agenda, expirationDays = 7) => {
  const sessionLimit = 10;
  const activeSessions = await Session.find({
    user_id: user._id,
    status: 'active',
    device_info: req.headers['user-agent'],
  }).sort({ created_at: 1 });

  if (activeSessions.length >= sessionLimit) {
    await activeSessions[0].deleteOne();
  }

  const expires_at = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

  const token = generateToken({ id: user._id, email: user.email });
  await Session.create({
    user_id: user._id,
    session_token: token,
    device_info: req.headers['user-agent'],
    ip_address: req.ip,
    agenda,
    expires_at,
  });

  await User.updateOne({ _id: user._id }, { last_login: new Date() });
  return token;
};

module.exports = {
  generateOTP,
  getSettings,
  checkMaintenanceAccess,
  findUserByIdentifier,
  sendOtp,
  verifyOtpForUser,
  getTestEmailHtml,
  getUserByIdentifier,
  manageSession,
  isEmailIdentifier,
  isPhoneIdentifier,
};