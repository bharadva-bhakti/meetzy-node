const bcrypt = require('bcryptjs');
const { db } = require('../models');
const User = db.User;
const Session = db.Session;
const OTPLog = db.OTPLog;
const UserSetting = db.UserSetting;
const GoogleToken = db.GoogleToken;
const Setting = db.Setting;
const getOAuthClient = require('../config/googleAuth');
const { google } = require('googleapis');
const { sendMail } = require('../utils/mail');
const { sendTwilioSMS } = require('../services/twilioService');
const { sendSMS } = require('../services/customSMSService');
const { generateOTP, getSettings, checkMaintenanceAccess, findUserByIdentifier, sendOtp, verifyOtpForUser, getTestEmailHtml,
  getUserByIdentifier, manageSession, isEmailIdentifier, isPhoneIdentifier,
} = require('../helper/authHelpers');

exports.register = async (req, res) => {
  const { name, email, phone, countryCode, password, country } = req.body;
  const ip = req.ip;

  try {
    await checkMaintenanceAccess(ip);

    const settings = await getSettings();
    const authMethod = settings.auth_method || 'both';
    const loginMethod = settings.login_method || 'both';

    if (!name) {
      return res.status(400).json({ message: 'Name is required.' });
    }

    if (authMethod === 'email') {
      if (!email) return res.status(400).json({ message: 'Email is required.' });
      if (loginMethod === 'password' && !password) return res.status(400).json({ message: 'Password is required.' });
    } else if (authMethod === 'phone') {
      if (!phone) return res.status(400).json({ message: 'Phone is required.' });
      if (!countryCode) return res.status(400).json({ message: 'Country code is required.' });
      if (loginMethod === 'password' && !password) return res.status(400).json({ message: 'Password is required.' });
    } else if (authMethod === 'both') {
      if (!email && !phone) return res.status(400).json({ message: 'Email or phone is required.' });

      if (email && loginMethod === 'password' && !password) {
        return res.status(400).json({ message: 'Password is required for email registration.' });
      }
      if (phone && !countryCode) {
        return res.status(400).json({ message: 'Country code is required.' });
      }
      if (phone && loginMethod === 'password' && !password) {
        return res.status(400).json({ message: 'Password is required for phone registration.' });
      }
    }

    if (email) {
      const lowerEmail = email.toLowerCase().trim();
      if (!isEmailIdentifier(lowerEmail)) {
        return res.status(400).json({ message: 'Please enter a valid email address' });
      }
      const existingEmail = await User.findOne({ email: lowerEmail, role: 'user' });
      if (existingEmail) return res.status(409).json({ message: 'Email already registered' });
    }

    if (phone) {
      if (!isPhoneIdentifier(phone)) {
        return res.status(400).json({ message: 'Phone number must be 7-15 digits' });
      }
      const existingPhone = await User.findOne({ country_code: countryCode, phone, role: 'user' });
      if (existingPhone) return res.status(409).json({ message: 'Phone number already registered' });
    }

    const hashed = password ? await bcrypt.hash(password, 10) : null;

    const user = await User.create({
      name: name.trim(),
      email: email ? email.toLowerCase().trim() : null,
      country_code: countryCode || null,
      phone: phone || null,
      password: hashed,
      country: country || null,
    });

    await UserSetting.create({ user_id: user._id });

    return res.status(201).json({ redirect: '/login', message: 'Registration successful!' });
  } catch (err) {
    console.error('Register error:', err);

    if (err.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({
        message: settings.maintenance_message || 'System under maintenance', maintenance: true,
      });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.loginInit = async (req, res) => {
  const { identifier } = req.body;

  try {
    await checkMaintenanceAccess(req.ip);

    if (!identifier) {
      return res.status(400).json({ message: 'Email or phone is required.' });
    }

    const clean = identifier.trim();
    const isEmail = isEmailIdentifier(clean);
    const isPhone = isPhoneIdentifier(clean);

    const settings = await getSettings();

    if (isEmail && !['email', 'both'].includes(settings.auth_method)) {
      return res.status(400).json({ message: 'Email login is disabled by admin' });
    }

    if (isPhone && !['phone', 'both'].includes(settings.auth_method)) {
      return res.status(400).json({ message: 'Phone login is disabled by admin' });
    }

    const user = await getUserByIdentifier(clean, settings.auth_method);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.status === 'deactive') {
      return res.status(400).json({ message: 'Your account has been deactivated. Please contact your Admin.' });
    }

    if (settings.login_method === 'password') {
      return res.status(400).json({ message: 'OTP login is disabled. Please use password login.' });
    }

    const otp = generateOTP();

    if (process.env.DEMO !== 'true') {
      let sent = false;

      if (isEmail) {
        sent = await sendMail(clean, 'Your Login OTP', `Your login OTP is ${otp}`);
        if (!sent) return res.status(500).json({ message: 'Failed to send OTP email' });
      }

      if (isPhone) {
        const gateway = settings.sms_gateway?.toLowerCase();
        if (!gateway) {
          return res.status(400).json({ message: 'SMS gateway not configured. Add Twilio or Custom.' });
        }

        const phoneNumber = clean;
        if (gateway === 'custom') {
          sent = await sendSMS(phoneNumber, `Your login OTP is ${otp}`);
        } else if (gateway === 'twilio') {
          sent = await sendTwilioSMS(phoneNumber, `Your login OTP is ${otp}`);
        }

        if (!sent) return res.status(500).json({ message: 'Failed to send OTP SMS' });
      }
    }

    await OTPLog.create({
      phone: isPhone ? clean : null,
      email: isEmail ? clean : null,
      otp,
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      verified: false,
    });

    return res.json({
      type: isEmail ? 'email' : 'phone',
      message: 'OTP sent successfully',
      demo_otp: process.env.DEMO !== 'false' ? otp : undefined,
    });
  } catch (error) {
    console.error('Error in loginInit:', error);

    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({
        message: settings.maintenance_message || 'System under maintenance', maintenance: true,
      });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.verifyOtpLogin = async (req, res) => {
  const { identifier, otp } = req.body;

  if (!identifier || !otp) {
    return res.status(400).json({ message: 'Identifier and OTP are required.' });
  }

  try {
    const clean = identifier.trim();
    const isEmail = isEmailIdentifier(clean);
    const isPhone = isPhoneIdentifier(clean);

    const otpRecord = await OTPLog.findOne({
      otp,
      verified: false,
      ...(isEmail ? { email: clean } : {}),
      ...(isPhone ? { phone: clean } : {}),
      expires_at: { $gt: new Date() },
    }).sort({ created_at: -1 });

    if (!otpRecord) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    let user;
    if (isEmail) {
      user = await User.findOne({ email: clean.toLowerCase() });
    } else if (isPhone) {
      const phoneNumber = clean;
      for (let i = 2; i <= 5; i++) {
        const code = phoneNumber.slice(0, i);
        const number = phoneNumber.slice(i);
        if (!/^\d{4,14}$/.test(number)) continue;

        user = await User.findOne({ country_code: code, phone: number });
        if (user) break;
      }
    }

    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.status === 'deactive') {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    await otpRecord.updateOne({ verified: true });

    const settings = await getSettings();
    const token = await manageSession(user, req, 'otp_login', settings?.session_expiration_days || 7);

    return res.json({
      message: 'OTP login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        country_code: user.country_code,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Error in verifyOtpLogin:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.loginWithPassword = async (req, res) => {
  const { identifier, password, remember = false } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Identifier and password are required.' });
  }

  try {
    const settings = await getSettings();
    const authMethod = settings.auth_method || 'both';
    const loginMethod = settings.login_method || 'both';

    const clean = identifier.trim();
    const isEmailFormat = isEmailIdentifier(clean);

    const user = await findUserByIdentifier(clean);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const isSuperAdmin = user.role === 'super_admin';

    if (!isSuperAdmin) {
      if (loginMethod === 'otp') {
        return res.status(400).json({ message: 'Password login is disabled. Please use OTP login.' });
      }

      if (isEmailFormat && authMethod === 'phone') {
        return res.status(400).json({ message: 'Email login is disabled by admin. Use phone to login.' });
      }

      if (!isEmailFormat && authMethod === 'email') {
        return res.status(400).json({ message: 'Phone login is disabled by admin. Use email to login.' });
      }
    }

    if (user.status === 'deactive') {
      return res.status(400).json({ message: 'Your account has been deactivated. Please contact your Admin.' });
    }

    if (!user.password) {
      return res.status(400).json({ message: 'You do not have a password yet.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid password.' });
    }

    const token = await manageSession(
      user,
      req,
      isSuperAdmin ? 'super_admin_password_login' : 'password_login',
      settings?.session_expiration_days || 7
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      remember: Boolean(remember),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Error in loginWithPassword:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.linkIdentifier = async (req, res) => {
  try {
    const { old_identifier, new_email, new_phone, country_code } = req.body;
    const user = await findUserByIdentifier(old_identifier);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let sendType, sendValue, updateType, updateValue;

    if (new_phone) {
      sendType = 'email';
      sendValue = user.email;
      updateType = 'phone';
      updateValue = `${country_code}${new_phone}`;
    } else if (new_email) {
      sendType = 'phone';
      sendValue = `${user.country_code}${user.phone}`;
      updateType = 'email';
      updateValue = new_email.toLowerCase();
    } else {
      return res.status(400).json({ message: 'Provide new_email or new_phone' });
    }

    const result = await sendOtp(sendType, sendValue, 'Verification Code', updateType, updateValue);
    if (result.demo) {
      return res.json({ message: 'OTP sent successfully', demo_otp: result.otp });
    }
    if (!result.sent) {
      return res.status(500).json({ message: 'Failed to send OTP' });
    }

    return res.json({ message: `OTP sent successfully` });
  } catch (err) {
    console.error('Error in linkIdentifier:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.verifyLinkOtp = async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { otpRecord, error } = await verifyOtpForUser(identifier, otp);
    if (error) return res.status(400).json({ message: error });

    if (otpRecord.email) {
      const existing = await User.findOne({ email: otpRecord.email });
      if (existing && existing._id.toString() !== user._id.toString()) {
        return res.status(409).json({ message: 'Email already in use' });
      }
      await User.updateOne({ _id: user._id }, { email: otpRecord.email });
    }

    if (otpRecord.phone) {
      const match = otpRecord.phone.match(/^\+(\d{1,4})(\d+)$/);
      if (!match) return res.status(400).json({ message: 'Invalid phone format' });

      const pure = otpRecord.phone.slice(1);
      const phone = pure.slice(-10);
      const country_code = '+' + pure.slice(0, pure.length - 10);

      const existing = await User.findOne({ country_code, phone });
      if (existing && existing._id.toString() !== user._id.toString()) {
        return res.status(409).json({ message: 'Phone already in use' });
      }
      await User.updateOne({ _id: user._id }, { country_code, phone });
    }

    await otpRecord.updateOne({ verified: true });

    const updatedUser = await User.findById(user._id);
    res.json({ message: 'Identifier updated successfully', updated_user: updatedUser });
  } catch (err) {
    console.error('Error in verifyLinkOtp:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.forgotPassword = async (req, res) => {
  const { identifier } = req.body;
  const ip = req.ip;

  try {
    await checkMaintenanceAccess(ip);

    if (!identifier) {
      return res.status(400).json({ message: 'Email or phone number is required' });
    }

    const clean = identifier.replace(/\s+/g, '').trim().toLowerCase();
    const isEmailInput = isEmailIdentifier(clean);
    const isPhoneInput = isPhoneIdentifier(clean);

    const user = await findUserByIdentifier(clean);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);

    if (process.env.DEMO !== 'true') {
      if (isEmailInput) {
        const sent = await sendMail(clean, 'Password Reset OTP', `Your password reset OTP is: ${otp}`);
        if (!sent) return res.status(500).json({ message: 'Failed to send OTP email' });
      } else if (isPhoneInput) {
        const settings = await getSettings();
        const gateway = settings.sms_gateway?.toLowerCase();

        if (!gateway) {
          return res.status(400).json({ message: 'SMS gateway not configured by admin' });
        }

        let smsSent = true;
        if (gateway === 'custom') {
          smsSent = await sendSMS(clean, `Your password reset OTP is: ${otp}`);
        } else if (gateway === 'twilio') {
          smsSent = await sendTwilioSMS(clean, `Your password reset OTP is: ${otp}`);
        }

        if (!smsSent) return res.status(500).json({ message: 'Failed to send OTP SMS' });
      }
    }

    await OTPLog.create({
      email: isEmailInput ? clean : null,
      phone: isPhoneInput ? clean : null,
      otp,
      expires_at,
      verified: false,
    });

    return res.status(200).json({
      message: `OTP sent successfully to your ${isEmailInput ? 'email' : 'phone'}`,
      demo_otp: process.env.DEMO !== 'false' ? otp : undefined,
    });
  } catch (err) {
    console.error('Forgot Password Error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    const ip = req.ip;

    if (!identifier || !otp) {
      return res.status(400).json({ message: 'Identifier and OTP are required' });
    }

    await checkMaintenanceAccess(ip);

    const { otpRecord, error } = await verifyOtpForUser(identifier, otp);
    if (error) return res.status(400).json({ message: error });

    await otpRecord.updateOne({ verified: true });

    return res.status(200).json({ message: 'OTP verified successfully' });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resendOTP = async (req, res) => {
  try {
    const { identifier } = req.body;
    const ip = req.ip;

    if (!identifier) {
      return res.status(400).json({ message: 'Email or phone is required' });
    }

    await checkMaintenanceAccess(ip);

    const clean = identifier.replace(/\s+/g, '').trim().toLowerCase();
    const isEmailInput = isEmailIdentifier(clean);
    const isPhoneInput = isPhoneIdentifier(clean);

    if (!isEmailInput && !isPhoneInput) {
      return res.status(400).json({ message: 'Invalid email or phone format' });
    }

    const otpLog = await OTPLog.findOne({
      email: isEmailInput ? clean : null,
      phone: isPhoneInput ? clean : null,
      verified: false,
    }).sort({ created_at: -1 });

    let otp;
    let expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    if (!otpLog || otpLog.expires_at < new Date()) {
      otp = generateOTP();
      await OTPLog.create({
        email: isEmailInput ? clean : null,
        phone: isPhoneInput ? clean : null,
        otp,
        expires_at: expiresAt,
        verified: false,
      });
    } else {
      otp = otpLog.otp;
      await otpLog.updateOne({ expires_at: expiresAt });
    }

    if (process.env.DEMO !== 'true') {
      if (isEmailInput) {
        const sent = await sendMail(clean, 'Password Reset OTP', `Your password reset OTP is: ${otp}`);
        if (!sent) return res.status(500).json({ message: 'Failed to send OTP email' });
      }

      if (isPhoneInput) {
        const settings = await getSettings();
        const gateway = settings.sms_gateway?.toLowerCase();

        if (!gateway) {
          return res.status(400).json({ message: 'SMS gateway not configured by admin' });
        }

        let smsSent = true;
        if (gateway === 'custom') {
          smsSent = await sendSMS(clean, `Your password reset OTP is: ${otp}`);
        } else if (gateway === 'twilio') {
          smsSent = await sendTwilioSMS(clean, `Your password reset OTP is: ${otp}`);
        }

        if (!smsSent) return res.status(500).json({ message: 'Failed to send OTP SMS' });
      }
    }

    return res.status(200).json({
      message: `OTP resent successfully to your ${isEmailInput ? 'email' : 'phone'}`,
      demo_otp: process.env.DEMO !== 'false' ? otp : undefined,
    });
  } catch (error) {
    console.error('Error resending OTP:', error);

    if (error.message === 'MAINTENANCE_MODE') {
      const settings = await getSettings();
      return res.status(503).json({
        message: settings.maintenance_message || 'System under maintenance',
        maintenance: true,
      });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { identifier, otp, new_password } = req.body;
    const ip = req.ip;

    if (!identifier || !otp || !new_password) {
      return res.status(400).json({ message: 'Identifier, OTP & new password are required' });
    }

    await checkMaintenanceAccess(ip);

    const clean = identifier.replace(/\s+/g, '').trim().toLowerCase();
    const isEmailInput = isEmailIdentifier(clean);
    const isPhoneInput = isPhoneIdentifier(clean);

    if (!isEmailInput && !isPhoneInput) {
      return res.status(400).json({ message: 'Invalid identifier format' });
    }

    const otpRecord = await OTPLog.findOne({
      email: isEmailInput ? clean : null,
      phone: isPhoneInput ? clean : null,
      otp,
      verified: true,
      expires_at: { $gt: new Date() },
    }).sort({ created_at: -1 });

    if (!otpRecord) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await User.updateOne({ _id: user._id }, { password: hashedPassword });

    await otpRecord.updateOne({ verified: true });

    return res.status(200).json({ message: 'Password reset successful!' });
  } catch (err) {
    console.error('Reset Password Error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.logout = async (req, res) => {
  const userId = req.user._id;
  const token = req.token;

  try {
    const session = await Session.findOne({ user_id: userId, session_token: token, status: 'active', });
    if (!session) {
      return res.status(404).json({ message: 'Session not found or already logged out.' });
    }

    await session.deleteOne();
    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Error in logout:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.connectToDrive = async (req, res) => {
  const userId = req.user._id;

  try {
    if (!userId) return res.status(400).json({ message: 'User is not authorized.' });

    const googleToken = await GoogleToken.findOne({ user_id: userId });
    if (googleToken) return res.status(200).json({ message: 'User is already connected to Google Drive.' });

    const oAuth2Client = getOAuthClient();
    const url = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/userinfo.email'],
      prompt: 'consent',
      state: JSON.stringify({ userId }),
    });

    return res.status(200).json({ message: 'Redirect URL fetched successfully.', redirectUrl: url });
  } catch (error) {
    console.error('Error in connectToDrive:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.saveToken = async (req, res) => {
  const state = JSON.parse(req.query.state || '{}');
  const userId = state.userId;
  const code = req.query.code;
  const oAuth2Client = getOAuthClient();

  try {
    if (!code) return res.status(500).json({ message: 'Internal Server Error' });

    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    await GoogleToken.findOneAndUpdate(
      { user_id: userId },
      {
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry_date: tokens.expiry_date,
        google_email: profile.email,
      },
      { upsert: true }
    );

    return res.redirect(process.env.FRONT_REDIRECT_URL);
  } catch (error) {
    console.error('Error in saveToken:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.sendTestMail = async (req, res) => {
  const { to } = req.body;

  if (!to) return res.status(400).json({ message: 'To is required field.' });

  const html = await getTestEmailHtml();

  try {
    const result = await sendMail(to, 'Test Email Verification', html);

    if (result.success) {
      return res.status(200).json({ message: 'Test email sent successfully!' });
    } else {
      return res.status(500).json({ message: 'Failed to send test email.', error: result.error });
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    return res.status(500).json({ error: 'Error sending test email.' });
  }
};