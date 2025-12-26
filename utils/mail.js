const nodemailer = require('nodemailer');
const { db } = require('../models');
const Setting = db.Setting;

const sendMail = async (to, subject, html) => {
  try {
    const settings = await Setting.findOne().lean();
    if (!settings) throw new Error('SMTP settings not found.');

    const isUsingSSL = settings.mail_encryption === 'ssl';

    const transporter = nodemailer.createTransport({
      host: settings.smtp_host || process.env.SMTP_HOST,
      port: settings.smtp_port || process.env.SMTP_PORT,
      secure: isUsingSSL,
      auth: {
        user: settings.smtp_user || process.env.SMTP_USER,
        pass: settings.smtp_pass || process.env.SMTP_PASS,
      },
    });

    const fromName = settings.mail_from_name || settings.app_name || 'App';
    const fromEmail = settings.mail_from_email || settings.smtp_user || process.env.SMTP_USER;
    const from = `${fromName} <${fromEmail}>`;

    await transporter.sendMail({ from, to, subject, html });
    return { success: true };
  } catch (err) {
    console.error('Error sending mail:', err);
    return {
      success: false,
      error: err?.message || 'Unknown error',
    };
  }
};

module.exports = { sendMail };