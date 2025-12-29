const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SettingSchema = new Schema(
  {
    // App info
    app_name: { 
      type: String, 
      default: 'My Application' 
    },
    app_description: { 
      type: String, 
      default: 'A modern chat application' 
    },
    app_email: { 
      type: String, 
      default: 'support@example.com', required: true 
    },
    support_email: { 
      type: String, 
      default: 'support@example.com', required: true 
    },

    // Logos
    favicon_url: { 
      type: String, 
      default: null 
    },
    logo_light_url: { 
      type: String, 
      default: null 
    },
    logo_dark_url: { 
      type: String, 
      default: null 
    },
    sidebar_logo_url: { 
      type: String, 
      default: null 
    },
    mobile_logo_url: { 
      type: String, 
      default: null 
    },
    landing_logo_url: { 
      type: String, 
      default: null 
    },
    favicon_notification_logo_url: { 
      type: String, 
      default: null 
    },
    onboarding_logo_url: { 
      type: String, 
      default: null 
    },

    // Maintenance
    maintenance_mode: { 
      type: Boolean,
      default: false, 
      required: true 
    },
    maintenance_title: { 
      type: String, 
      default: 'Under Maintenance' 
    },
    maintenance_message: { 
      type: String, 
      default: 'We are performing some maintenance. Please check back later.' 
    },
    maintenance_image_url: { 
      type: String, 
      default: null 
    },
    maintenance_allowed_ips: { 
      type: [String], 
      default: [] 
    },

    // Pages
    page_404_title: { 
      type: String, 
      default: 'Page Not Found' 
    },
    page_404_content: { 
      type: String, 
      default: 'The page you are looking for does not exist.' 
    },
    page_404_image_url: { 
      type: String, 
      default: null 
    },
    no_internet_title: { 
      type: String, 
      default: 'No Internet Connection' 
    },
    no_internet_content: { 
      type: String, 
      default: 'Please check your internet connection and try again.' 
    },
    no_internet_image_url: { 
      type: String, 
      default: null 
    },

    // Email
    smtp_host: { 
      type: String, 
      default: null 
    },
    smtp_port: { 
      type: Number, 
      default: 587 
    },
    smtp_user: { 
      type: String, 
      default: null 
    },
    smtp_pass: { 
      type: String, 
      default: null 
    },
    mail_from_name: { 
      type: String, 
      default: 'My Application' 
    },
    mail_from_email: { 
      type: String, 
      default: 'noreply@myapplication.com' 
    },
    mail_encryption: { 
      type: String, enum: ['ssl', 'tls'], 
      default: 'tls', 
      required: true 
    },

    // General
    default_theme_mode: { 
      type: String, 
      enum: ['dark', 'light', 'system'], 
      default: 'light' 
    },
    display_customizer: { 
      type: Boolean, 
      default: true, required: true 
    },
    audio_calls_enabled: { 
      type: Boolean, 
      default: true 
    },
    video_calls_enabled: { 
      type: Boolean, 
      default: true 
    },
    allow_voice_message: { 
      type: Boolean, 
      default: true 
    },
    allow_archive_chat: { 
      type: Boolean, 
      default: true, 
      required: true 
    },
    allow_media_send: { 
      type: Boolean, 
      default: true, 
      required: true 
    },
    allow_user_block: { 
      type: Boolean, 
      default: true, 
      required: true 
    },
    allow_user_signup: { 
      type: Boolean, 
      default: true, 
      required: true 
    },
    call_timeout_seconds: { 
      type: Number, 
      default: 25 
    },
    session_expiration_days: { 
      type: Number, 
      default: 7 
    },

    // Limits
    document_file_limit: { 
      type: Number, 
      default: 15 
    },
    audio_file_limit: { 
      type: Number, 
      default: 15 
    },
    video_file_limit: { 
      type: Number, 
      default: 20 
    },
    image_file_limit: { 
      type: Number, 
      default: 10 
    },
    multiple_file_share_limit: { 
      type: Number, 
      default: 10 
    },
    maximum_message_length: { 
      type: Number, 
      default: 40000 
    },
    allowed_file_upload_types: { 
      type: Object, 
      default: null 
    },

    // Group & Broadcast
    max_groups_per_user: { 
      type: Number, 
      default: 500 
    },
    max_group_members: { 
      type: Number, 
      default: 1024 
    },
    max_broadcasts_list: { 
      type: Number, 
      default: 10 
    },
    max_members_per_broadcasts_list: { 
      type: Number, 
      default: 100 
    },

    // Auth
    auth_method: { 
      type: String, 
      enum: ['email', 'phone', 'both'], 
      default: 'both', required: true 
    },
    login_method: { 
      type: String, 
      enum: ['otp', 'password', 'both'], 
      default: 'both', required: true 
    },

    // Features
    allow_screen_share: { 
      type: Boolean, 
      default: true 
    },
    time_format: { 
      type: String, enum: ['12h', '24h'], 
      default: '12h', 
      required: true 
    },
    allow_status: { 
      type: Boolean, 
      default: true 
    },
    status_expiry_time: { 
      type: Number, 
      default: 24 
    },
    status_limit: { 
      type: Number, 
      default: 3 
    },
    sms_gateway: { 
      type: String, 
      default: null 
    },
    e2e_encryption_enabled: { 
      type: Boolean, 
      default: false 
    },
    svg_color: { 
      type: String, 
      default: null 
    },
    default_language: { 
      type: String, 
      default: 'en', 
      required: true 
    },
  },
  {
    collection: 'settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(SettingSchema);

module.exports = mongoose.model('Setting', SettingSchema);