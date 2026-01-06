const bcrypt = require('bcryptjs');
const { db } = require('../models');
const mongoose = require('mongoose');
const User = db.User;
const OTPLog = db.OTPLog;
const UserSetting = db.UserSetting;
const GoogleToken = db.GoogleToken;
const Friend = db.Friend;
const { generateOTP, getSettings, findUserByIdentifier, isEmailIdentifier, isPhoneIdentifier} = require('../helper/authHelpers');
const { sendMail } = require('../utils/mail');
const { sendTwilioSMS } = require('../services/twilioService');
const { sendSMS } = require('../services/customSMSService');

exports.getUserSetting = async (req, res) => {
  const user_id = req.params.id;

  try {
    const userSetting = await UserSetting.findOne({ user_id }).populate('user_id', 'id name email');

    return res.status(200).json({ userSetting });
  } catch (error) {
    console.error('Error in getUserSetting:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUserSetting = async (req, res) => {
  const userId = req.user._id;
  const io = req.app.get('io');

  try {
    const {
      last_seen, profile_pic, display_bio, status_privacy, read_receipts, typing_indicator, hide_phone, chat_wallpaper, mode,
      color, layout, sidebar, direction, auto_backup, doc_backup, video_backup, pin, new_pin, lock_chat, unlock_chat, chat_lock_enabled,
    } = req.body;

    const userSetting = await UserSetting.findOne({ user_id: userId });
    if (!userSetting) {
      return res.status(404).json({ message: 'User setting not found' });
    }

    const isLocking = !!lock_chat;
    const isUnlocking = !!unlock_chat;
    const isChangingPin = !!new_pin;
    const needsPin = isLocking || isUnlocking || isChangingPin || !!pin;

    if (needsPin) {
      if (!pin) {
        return res.status(400).json({ message: 'PIN is required' });
      }
      if (![4, 6].includes(pin.length)) {
        return res.status(400).json({ message: 'PIN must be 4 or 6 digits' });
      }

      if (userSetting.pin_hash) {
        const valid = await bcrypt.compare(pin, userSetting.pin_hash);
        if (!valid) {
          return res.status(400).json({ message: 'Incorrect PIN' });
        }
      }
    }

    const updatePayload = { last_seen, profile_pic, display_bio, status_privacy, read_receipts, typing_indicator, hide_phone, 
      chat_wallpaper, mode, color, layout, sidebar, direction, auto_backup, doc_backup, video_backup,
    };

    if (!userSetting.pin_hash && isLocking) {
      updatePayload.pin_hash = await bcrypt.hash(pin, 10);
      updatePayload.chat_lock_digit = pin.length;
    }

    if (isChangingPin) {
      if (![4, 6].includes(new_pin.length)) {
        return res.status(400).json({ message: 'New PIN must be 4 or 6 digits' });
      }
      if (pin === new_pin) {
        return res.status(400).json({ message: 'New PIN must be different' });
      }

      updatePayload.pin_hash = await bcrypt.hash(new_pin, 10);
      updatePayload.chat_lock_digit = new_pin.length;
    }

    await UserSetting.updateOne({ user_id: userId }, { $set: updatePayload });

    if (isLocking) {
      const { type, id } = lock_chat;

      if (!['user', 'group', 'broadcast', 'announcement'].includes(type)) {
        return res.status(400).json({ message: 'Invalid chat type' });
      }

      await UserSetting.updateOne(
        { user_id: userId },
        {
          $addToSet: {locked_chat_ids: { type, id: new mongoose.Types.ObjectId(id) },},
          $set: { chat_lock_enabled: true },
        }
      );
    }

    if (isUnlocking) {
      const { type, id } = unlock_chat;

      await UserSetting.updateOne(
        { user_id: userId },
        { $pull: { locked_chat_ids: { type, id: new mongoose.Types.ObjectId(id)}}}
      );

      const updated = await UserSetting.findOne({ user_id: userId });
      if (!updated.locked_chat_ids.length) {
        await UserSetting.updateOne({ user_id: userId }, { $set: { chat_lock_enabled: false } });
      }
    }

    if (chat_lock_enabled === false) {
      await UserSetting.updateOne(
        { user_id: userId },
        { $set: { chat_lock_enabled: false, locked_chat_ids: [], pin_hash: null },}
      );
    }

    if (auto_backup === false) {
      await GoogleToken.deleteMany({ user_id: userId });
    }

    const updatedSetting = await UserSetting.findOne({ user_id: userId });

    if (io) {
      io.to(`user_${userId}`).emit('user-settings-updated', { userId, settings: updatedSetting });
    }

    return res.status(200).json({
      message: 'User setting updated successfully',
      userSetting: updatedSetting,
    });
  } catch (error) {
    console.error('updateUserSetting error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.forgetChatLockPin = async (req, res) => {
  const { identifier } = req.body;

  try {
    if (!identifier) return res.status(400).json({ message: 'Identifier is required' });

    const user = await findUserByIdentifier(identifier);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const settings = await getSettings();
    const isEmail = isEmailIdentifier(identifier.trim());
    const isPhone = isPhoneIdentifier(identifier.trim());

    if (!isEmail && !isPhone) return res.status(400).json({ message: 'Invalid identifier' });

    const otp = generateOTP();

    if (process.env.DEMO !== 'true') {
      let sent = false;
      if (isEmail) {
        sent = await sendMail(user.email.trim(), 'Chat Lock Reset OTP', `Your chat lock reset OTP is ${otp}`);
      }
      if (isPhone) {
        const gateway = settings.sms_gateway?.toLowerCase();
        if (gateway === 'custom') sent = await sendSMS(`${user.country_code}${user.phone}`, `Your chat lock reset OTP is ${otp}`);
        else if (gateway === 'twilio') sent = await sendTwilioSMS(`${user.country_code}${user.phone}`, `Your chat lock reset OTP is ${otp}`);
      }
      if (!sent) return res.status(500).json({ message: 'Failed to send OTP' });
    }

    await OTPLog.create({
      phone: isPhone ? identifier.trim() : null,
      email: isEmail ? identifier.trim() : null,
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
    console.error('Error in forgetChatLockPin:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.verifyChatLockPinOtp = async (req, res) => {
  const { identifier, otp } = req.body;

  try {
    if (!identifier || !otp) return res.status(400).json({ message: 'Identifier and OTP are required' });

    const user = await findUserByIdentifier(identifier.trim());
    if (!user) return res.status(404).json({ message: 'User not found' });

    const otpLog = await OTPLog.findOne({
      otp,
      verified: false,
      expires_at: { $gt: new Date() },
    }).sort({ created_at: -1 });

    if (!otpLog) return res.status(400).json({ message: 'Invalid or expired OTP' });

    await otpLog.updateOne({ verified: true });

    return res.json({ message: 'OTP verified successfully.' });
  } catch (error) {
    console.error('Error in verifyChatLockPinOtp:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.resetChatLockPin = async (req, res) => {
  const { identifier, new_pin, digit } = req.body;

  try {
    if (!identifier || !new_pin) return res.status(400).json({ message: 'Identifier and new PIN are required' });

    if (!/^\d{4,6}$/.test(new_pin)) return res.status(400).json({ message: 'PIN must be 4-6 digits' });

    const user = await findUserByIdentifier(identifier.trim());
    if (!user) return res.status(404).json({ message: 'User not found' });

    const hashedPin = await bcrypt.hash(new_pin.toString(), 10);

    await UserSetting.updateOne(
      { user_id: user._id },
      {
        pin_hash: hashedPin,
        chat_lock_enabled: true,
        chat_lock_digit: digit || new_pin.length,
      }
    );

    return res.json({ message: 'Chat lock PIN updated successfully' });
  } catch (error) {
    console.error('Error in resetChatLockPin:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};