module.exports = (sequelize, DataTypes) => {
  const Setting = sequelize.define(
    'Setting',
    {
      app_name: {
        type: DataTypes.STRING,
        defaultValue: 'My Application',
      },
      app_description: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'A modern chat application',
      },
      app_email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
        defaultValue: 'support@example.com',
      },
      support_email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: { isEmail: true },
        defaultValue: 'support@example.com',
      },

      // logo
      favicon_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      logo_light_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      logo_dark_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      sidebar_logo_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      mobile_logo_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      landing_logo_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      favicon_notification_logo_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      onboarding_logo_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      // Maintenance
      maintenance_mode: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      maintenance_title: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: 'Under Maintenance',
      },
      maintenance_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: 'We are performing some maintenance. Please check back later.',
      },
      maintenance_image_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      maintenance_allowed_ips: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      // Dynamic Pages
      page_404_title: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: 'Page Not Found',
      },
      page_404_content: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: 'The page you are looking for does not exist.',
      },
      page_404_image_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      no_internet_title: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: 'No Internet Connection',
      },
      no_internet_content: {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: 'Please check your internet connection and try again.',
      },
      no_internet_image_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },

      // Email configuration
      smtp_host: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      smtp_port: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { min: 1, max: 65535 },
        defaultValue: 587,
      },
      smtp_user: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      smtp_pass: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      mail_from_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: 'My Application'
      },
      mail_from_email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: { isEmail: true },
        defaultValue: 'noreply@myapplication.com',
      },

      mail_encryption: {
        type: DataTypes.ENUM('ssl','tls'),
        allowNull: false,
        defaultValue: 'tls'
      },

      // General
      default_theme_mode: {
        type: DataTypes.ENUM('dark', 'light', 'system'),
        defaultValue: 'light',
      },
      display_customizer: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      audio_calls_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      video_calls_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      allow_voice_message: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      allow_archive_chat: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      allow_media_send: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      allow_user_block: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      allow_user_signup: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      call_timeout_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 25,
        validate: { min: 1, max: 50 },
      },
      session_expiration_days: {
        type: DataTypes.INTEGER,
        defaultValue: 7,
      },      

      // Media and chat limits
      document_file_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 15
      },
      audio_file_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 15
      },
      video_file_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 20
      },
      image_file_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 10
      },
      multiple_file_share_limit: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 10
      },
      maximum_message_length: {
        type: DataTypes.INTEGER,
        defaultValue: 40000,
        validate: { min: 1, max: 50000 },
      },
      allowed_file_upload_types: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      // Group Setting
      max_groups_per_user: {
        type: DataTypes.INTEGER,
        defaultValue: 500,
      },
      max_group_members: {
        type: DataTypes.INTEGER,
        defaultValue: 1024,
      },

      //broadcast setting
      max_broadcasts_list: {
        type: DataTypes.INTEGER,
        defaultValue: 10,
      },
      max_members_per_broadcasts_list: {
        type: DataTypes.INTEGER,
        defaultValue: 100,
      },
      auth_method: {
        type: DataTypes.ENUM('email', 'phone', 'both'),
        allowNull: false,
        defaultValue: 'both'
      },
      login_method: {
        type: DataTypes.ENUM('otp', 'password', 'both'),
        allowNull: false,
        defaultValue: 'both'
      },

      allow_screen_share: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      time_format: {
        type: DataTypes.ENUM('12h', '24h'),
        allowNull: false,
        defaultValue: '12h'
      },
      allow_status: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      status_expiry_time: {
        type: DataTypes.INTEGER,
        defaultValue: 24,
      },
      status_limit: {
        type: DataTypes.INTEGER,
        defaultValue: 3,
      },
      sms_gateway: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      e2e_encryption_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Enable/disable E2E encryption.',
      },
      svg_color: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      default_language: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'en',
      }, 
    },
    {
      tableName: 'settings',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  Setting.prototype.canAccessDuringMaintenance = function (ip) {
    if (!this.maintenance_mode) return true;
    return this.maintenance_allowed_ips.includes(ip);
  };

  return Setting;
};