const fs = require('fs');
const path = require('path');
const { db } = require('../models');
const Setting = db.Setting;
const User = db.User;
const Language = db.Language;

exports.getSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne();
    if (!setting) return res.status(404).json({ message: 'Settings not found.' });

    return res.status(200).json({ settings: setting });
  } catch (error) {
    console.error('Error in getSettings:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getPublicSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne().select([ 
        'login_method', 'favicon_url', 'logo_light_url', 'logo_dark_url', 'sidebar_logo_url', 'mobile_logo_url', 'landing_logo_url',
        'favicon_notification_logo_url', 'onboarding_logo_url', 'auth_method', 'allow_user_signup', 'e2e_encryption_enabled',
      ]);

    if (!setting) return res.status(404).json({ message: 'Settings not found.' });
    return res.status(200).json({ settings: setting });
  } catch (error) {
    console.error('Error in getPublicSettings:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await Setting.findOne().lean({ virtuals: true });
    if (!settings) return res.status(404).json({ message: 'Settings not found' });

    const updateData = {};

    const basicFields = ['app_name', 'app_description', 'app_email', 'support_email'];
    const emailFields = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'mail_from_name', 'mail_from_email', 'mail_encryption'];
    const maintenanceFields = ['maintenance_mode', 'maintenance_title', 'maintenance_message', 'maintenance_image_url', 'maintenance_allowed_ips'];
    const logoFields = [
      'favicon_url', 'logo_light_url', 'logo_dark_url', 'sidebar_logo_url', 'mobile_logo_url',
      'landing_logo_url', 'favicon_notification_logo_url', 'onboarding_logo_url',
    ];
    const pageFields = ['page_404_title', 'page_404_content', 'page_404_image_url', 'no_internet_title', 'no_internet_content', 'no_internet_image_url'];
    const chatFields = [
      'default_theme_mode', 'display_customizer', 'audio_calls_enabled', 'video_calls_enabled', 'allow_voice_message',
      'allow_archive_chat', 'allow_media_send', 'allow_user_block', 'allow_user_signup', 'call_timeout_seconds',
      'document_file_limit', 'audio_file_limit', 'video_file_limit', 'image_file_limit', 'multiple_file_share_limit',
      'maximum_message_length', 'allowed_file_upload_types', 'auth_method', 'login_method', 'allow_screen_share',
      'time_format', 'allow_status', 'status_expiry_time', 'status_limit', 'sms_gateway', 'e2e_encryption_enabled',
      'svg_color', 'default_language',
    ];
    const sessionFields = ['session_expiration_days'];
    const extendedFields = ['max_groups_per_user', 'max_group_members'];

    const allFields = [...basicFields, ...logoFields, ...maintenanceFields, ...pageFields, ...emailFields, 
      ...chatFields, ...sessionFields, ...extendedFields
    ];

    const fieldMap = {
      favicon: 'favicon_url',
      logo_light: 'logo_light_url',
      logo_dark: 'logo_dark_url',
      sidebar_logo: 'sidebar_logo_url',
      mobile_logo: 'mobile_logo_url',
      landing_logo: 'landing_logo_url',
      favicon_notification_logo: 'favicon_notification_logo_url',
      onboarding_logo: 'onboarding_logo_url',
      maintenance_image: 'maintenance_image_url',
      page_404_image: 'page_404_image_url',
      no_internet_image: 'no_internet_image_url',
    };

    allFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === 'maintenance_allowed_ips' || field === 'allowed_file_upload_types') {
          try {
            updateData[field] = Array.isArray(req.body[field]) ? req.body[field] : JSON.parse(req.body[field] || '[]');
          } catch {
            updateData[field] = [];
          }
        } else {
          updateData[field] = req.body[field];
        }
      }
    });

    Object.keys(fieldMap).forEach((uploadField) => {
      if (req.body[uploadField] === 'null' || req.body[uploadField] == null) {
        const dbField = fieldMap[uploadField];
        if (settings[dbField]) {
          const oldPath = path.join(process.cwd(), settings[dbField]);
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        updateData[dbField] = null;
      }
    });

    // Handle file uploads
    if (req.files) {
      Object.keys(req.files).forEach((uploadField) => {
        const file = req.files[uploadField][0];
        const dbField = fieldMap[uploadField];
        if (file && dbField) {
          if (settings[dbField]) {
            const oldPath = path.join(process.cwd(), settings[dbField]);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          }
          updateData[dbField] = file.path;
        }
      });
    }

    // Convert numeric fields
    const numericFields = [
      'document_file_limit', 'audio_file_limit', 'video_file_limit', 'image_file_limit', 'multiple_file_share_limit',
      'maximum_message_length', 'call_timeout_seconds', 'session_expiration_days', 'max_groups_per_user', 'max_group_members',
    ];

    numericFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        updateData[field] = updateData[field] === '' || updateData[field] == null ? null : Number(updateData[field]);
      }
    });

    // Validations (unchanged)
    if (updateData.status_expiry_time !== undefined && (updateData.status_expiry_time < 1 || updateData.status_expiry_time > 24)) {
      return res.status(400).json({ message: 'Status expiry time must be between 1 and 24 hours' });
    }

    if (updateData.smtp_port !== undefined && (updateData.smtp_port < 1 || updateData.smtp_port > 65535)) {
      return res.status(400).json({ message: 'SMTP port must be between 1 and 65535' });
    }

    if (updateData.call_timeout_seconds !== undefined && (updateData.call_timeout_seconds < 1 || updateData.call_timeout_seconds > 50)) {
      return res.status(400).json({ message: 'Call timeout must be between 1 and 50 seconds' });
    }

    if (updateData.maximum_message_length !== undefined && (updateData.maximum_message_length < 1 || updateData.maximum_message_length > 50000)) {
      return res.status(400).json({ message: 'Message length must be between 1 and 50000' });
    }

    if (updateData.session_expiration_days !== undefined && (updateData.session_expiration_days < 1 || updateData.session_expiration_days > 365)) {
      return res.status(400).json({ message: 'Session expiration days must be between 1 and 365' });
    }

    await Setting.updateOne({}, { $set: updateData }, { upsert: true });

    const updatedSettings = await Setting.findOne().lean({ virtuals: true });

    const { smtp_pass, _id, ...safeSettings } = updatedSettings || {};

    safeSettings.id = updatedSettings.id || updatedSettings._id?.toString();

    const io = req.app.get('io');
    const onlineUsers = await User.find({ is_online: true }).select('id').lean({ virtuals: true });
    onlineUsers.forEach((user) => {
      io.to(`user_${user._id}`).emit('admin-settings-updated', safeSettings);
    });

    return res.status(200).json({ message: 'Settings updated successfully', settings: safeSettings, });
  } catch (err) {
    console.error('Error updating settings:', err);

    if (req.files) {
      Object.values(req.files).flat().forEach((file) => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
    }

    return res.status(500).json({ message: 'Internal Server Error' });
  }
};