const { Op } = require('sequelize');
const { User, OTPLog, UserSetting, GoogleToken, Friend, Setting } = require('../models');
const { findUserByIdentifier, isEmailIdentifier, isPhoneIdentifier, generateOTP } = require('../helper/authHelpers');
const { sendMail } = require('../utils/mail');
const { sendTwilioSMS } = require('../services/twilioService');
const { sendSMS } = require('../services/customSMSService');
const bcrypt = require('bcryptjs');

exports.getUserSetting = async (req,res) => {
    const user_id = req.params.id;
    try {
        const userSetting = await UserSetting.findOne({ 
            where: { user_id }, 
            include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email']}] 
        });
    
        return res.status(201).json({ userSetting });
    } catch (error) {
        console.error('Error in getUserSetting:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateUserSetting = async (req, res) => {
    const userId = req.user.id;
    const io = req.app.get('io');

    try {
        const {
            last_seen, profile_pic, display_bio, status_privacy, read_receipts, typing_indicator, hide_phone, chat_wallpaper, 
            mode, color, layout, sidebar, direction, auto_backup, doc_backup, video_backup, chat_lock_enabled, pin, 
            locked_chat_ids, lock_chat, unlock_chat, new_pin, targetId, targetType
        } = req.body;

        let sharedWith = req.body.shared_with;

        if (typeof sharedWith === 'string') {
            try {
                sharedWith = JSON.parse(sharedWith);
            } catch (e) {
                return res.status(400).json({ message: 'Invalid shared_with JSON' });
            }
        }

        if (!Array.isArray(sharedWith)) sharedWith = [];

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const userSetting = await UserSetting.findOne({ where: { user_id: user.id } });
        if (!userSetting) return res.status(404).json({ message: 'User setting not found.' });

        const isChatLocked = !!userSetting && userSetting.chat_lock_enabled &&
            Array.isArray(userSetting.locked_chat_ids) &&
            userSetting.locked_chat_ids.some(
                chat => chat.type === targetType && chat.id === Number(targetId)
            );
        
        if (isChatLocked) {
            if (!userSetting?.pin_hash) return res.status(400).json({ message: 'Pin is required.' });
            
            const match = await bcrypt.compare(pin, userSetting.pin_hash);
            if (!match) return res.status(400).json({ message: 'Invalid pin' });
        }

        const updatePayload = {
            last_seen, profile_pic, display_bio, status_privacy,
            shared_with: status_privacy === 'my_contacts' ? [] : sharedWith,
            read_receipts, typing_indicator, hide_phone,
            chat_wallpaper, mode, color, layout, sidebar, direction,
            auto_backup, doc_backup, video_backup,
        };

        const isLocking = !!lock_chat;
        const isUnlocking = !!unlock_chat;
        const isChangingPin = !!new_pin;
        const needsPin = isLocking || isUnlocking || isChangingPin;

        if (needsPin) {
            if (!pin) {
                return res.status(400).json({ message: 'PIN is required' });
            }

            if (![4, 6].includes(pin.length)) {
                return res.status(400).json({ message: 'PIN must be 4 or 6 digits' });
            }

            if (!userSetting.pin_hash && isLocking && !isChangingPin) {
                updatePayload.pin_hash = await bcrypt.hash(pin, 10);
                updatePayload.chat_lock_digit = pin.length;
            } else if (userSetting.pin_hash) {
                const valid = await bcrypt.compare(pin, userSetting.pin_hash);
                if (!valid) {
                    return res.status(400).json({ message: 'Incorrect PIN' });
                }
            } else {
                return res.status(400).json({ message: 'No PIN set yet' });
            }
        }

        if (isChangingPin) {
            if (![4, 6].includes(new_pin.length)) {
                return res.status(400).json({ message: 'New PIN must be 4 or 6 digits' });
            }

            if (pin === new_pin) {
                return res.status(400).json({ message: 'New PIN must be different from old PIN' });
            }

            updatePayload.pin_hash = await bcrypt.hash(new_pin, 10);
            updatePayload.chat_lock_digit = new_pin.length;
        }

        if (isLocking && lock_chat) {
            const { type, id } = lock_chat;
            
            if (!type || !id) {
                return res.status(400).json({ message: 'lock_chat must contain type and id' });
            }

            if (!['user', 'group', 'broadcast', 'announcement'].includes(type)) {
                return res.status(400).json({ message: 'Invalid chat type' });
            }

            const existingLocked = Array.isArray(userSetting.locked_chat_ids)
                ? userSetting.locked_chat_ids
                : [];

            const alreadyLocked = existingLocked.some(
                chat => chat.type === type && chat.id === id
            );

            if (!alreadyLocked) {
                updatePayload.locked_chat_ids = [...existingLocked, { type, id }];
                updatePayload.chat_lock_enabled = true;
            }
        }

        if (isUnlocking && unlock_chat) {
            const { type, id } = unlock_chat;
            
            if (!type || !id) {
                return res.status(400).json({ message: 'unlock_chat must contain type and id' });
            }

            const existingLocked = Array.isArray(userSetting.locked_chat_ids)
                ? userSetting.locked_chat_ids
                : [];

            const updatedLocked = existingLocked.filter(
                chat => !(chat.type === type && chat.id === id)
            );
            
            updatePayload.locked_chat_ids = updatedLocked;

            if (updatedLocked.length === 0) {
                updatePayload.chat_lock_enabled = false;
            }
        }
        
        if (Array.isArray(locked_chat_ids) && locked_chat_ids.length) {
            const existingLockedIds = Array.isArray(userSetting.locked_chat_ids) 
                ? userSetting.locked_chat_ids 
                : [];
            
            for (const chat of locked_chat_ids) {
                if (!chat.type || !chat.id) {
                    return res.status(400).json({ message: 'Each locked chat must have type and id' });
                }
                if (!['user', 'group', 'broadcast', 'announcement'].includes(chat.type)) {
                    return res.status(400).json({ message: 'Invalid chat type: ' + chat.type });
                }
            }

            const merged = [...existingLockedIds];
            for (const newChat of locked_chat_ids) {
                const exists = merged.some(
                    chat => chat.type === newChat.type && chat.id === newChat.id
                );
                if (!exists) {
                    merged.push(newChat);
                }
            }

            updatePayload.locked_chat_ids = merged;
            updatePayload.chat_lock_enabled = true;
        }

        if (typeof chat_lock_enabled === 'boolean' && !chat_lock_enabled) {
            updatePayload.chat_lock_enabled = false;
            updatePayload.locked_chat_ids = [];
            updatePayload.pin_hash = null;
        }

        await userSetting.update(updatePayload);

        if (auto_backup === false) {
            await GoogleToken.destroy({ where: { user_id: userId } });
        }

        const updatedSetting = await userSetting.reload();
        const updatedSettingData = updatedSetting ? updatedSetting.toJSON() : null;
        
        if (io && updatedSettingData) {
            const payload = {
                userId, 
                settings: updatedSettingData,
            };

            const friendships = await Friend.findAll({
                where: {
                    status: 'accepted',
                    [Op.or]: [{ user_id: userId }, { friend_id: userId }],
                },
                attributes: ['user_id', 'friend_id'],
            });

            const friendIds = Array.from(
                new Set(
                    friendships.map((friendship) =>
                        friendship.user_id === userId ? friendship.friend_id : friendship.user_id
                    )
                )
            ).filter((id) => !!id && id !== userId);

            io.to(`user_${userId}`).emit('user-settings-updated', payload);
            friendIds.forEach((friendId) => {
                io.to(`user_${friendId}`).emit('user-settings-updated', payload);
            });
        }

        return res.status(200).json({
            message: 'User setting updated successfully.',
            userSetting: updatedSettingData,
        });
    } catch (error) {
        console.error('Error in updateUserSetting:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.forgetChatLockPin = async (req,res) => {
    const { identifier } = req.body;

    try {
        if (!identifier) {
            return res.status(400).json({ message: 'Identifier is required' });
        }

        const user = await findUserByIdentifier(identifier);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const settings = await Setting.findOne({
            attributes: ['sms_gateway', 'auth_method', 'login_method'],
            raw: true
        });

        const isEmail = isEmailIdentifier(identifier.trim());
        const isPhone = isPhoneIdentifier(identifier.trim());
        if (!isEmail && !isPhone) {
            return res.status(400).json({ message: 'Invalid identifier' });
        }

        const otp = generateOTP();

        if(process.env.DEMO !== 'true'){
            let sent = false;
      
            if (isEmail) {
              sent = await sendMail(user.email.trim(), 'Chat Lock Reset OTP', `Your login OTP is ${otp}`);
              if (!sent){
                return res.status(500).json({ message: 'Failed to send OTP email' });
              }
            }
        
            if (isPhone) {
              const gateway = settings.sms_gateway?.toLowerCase();
              if (!gateway) {
                return res.status(400).json({ message: 'SMS gateway not configured. Add Twilio or Custom.' });
              }
              
              if (user.country_code && user.phone) {
                const phoneNumber = `${user.country_code}${user.phone}`;
                if (gateway === 'custom'){
                  sent = await sendSMS(phoneNumber, `Your chat lock reset OTP is ${otp}`);
                } else if (gateway === 'twilio'){
                  sent = await sendTwilioSMS(phoneNumber, `Your chat lock reset OTP is ${otp}`);
                } else {
                  return res.status(400).json({ message: 'Invalid SMS gateway selected' });
                } 
        
                if (!sent) return res.status(500).json({ message: 'Failed to send OTP SMS' });
              }
            }
        }

        await OTPLog.create({
            phone: isPhone ? identifier.trim() : null,
            email: isEmail ? identifier.trim() : null,
            otp,
            expires_at: new Date(Date.now() + 5 * 60 * 1000),
            verified: false
        });
    
        return res.json({
            type: isEmail ? 'email' : 'phone',
            message: 'OTP sent successfully',
            demo_otp: process.env.DEMO !== 'false' ? otp : undefined
        });
    } catch (error) {
        console.error('Error in getUserSetting:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.verifyChatLockPinOtp = async (req, res) => {
    const { identifier, otp } = req.body;
  
    try {
      if (!identifier || !otp) {
        return res.status(400).json({ message: 'Identifier, OTP and new PIN are required' });
      }
  
      const user = await findUserByIdentifier(identifier.trim());
      if (!user) return res.status(404).json({ message: 'User not found' });
  
      const otpLog = await OTPLog.findOne({
        where: { otp, verified: false, expires_at: { [Op.gt]: new Date() }},
        order: [['created_at', 'DESC']]
      });
      if (!otpLog) return res.status(400).json({ message: 'Invalid or expired OTP' });

      await OTPLog.update({ verified: true }, { where: { id: otpLog.id }});
  
      return res.json({ message: 'Otp verify successfully.'});

    } catch (error) {
      console.error('verifyChatLockPinOtp error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.resetChatLockPin = async (req,res) => {
    const { identifier, new_pin, digit } = req.body;
  
    try {
      if (!identifier || !new_pin) {
        return res.status(400).json({ message: 'Identifier, OTP and new PIN are required' });
      }
  
      if (!/^\d{4,6}$/.test(new_pin)) {
        return res.status(400).json({ message: 'PIN must be 4-6 digits' });
      }
  
      const user = await findUserByIdentifier(identifier.trim());
      if (!user) return res.status(404).json({ message: 'User not found' });

      const hashedPin = await bcrypt.hash(new_pin.toString(), 10);
  
      await UserSetting.update(
        { pin_hash: hashedPin, chat_lock_enabled: true, chat_lock_digit: digit },
        { where: { user_id: user.id } }
      );
  
      return res.json({ message: 'Chat lock PIN updated successfully'});

    } catch (error) {
      console.error('resetChatLockPin error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
}