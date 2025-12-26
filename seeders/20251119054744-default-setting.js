'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('settings', [{
      app_name: 'My Application',
      app_description: 'A modern chat application',
      app_email: 'support@example.com',
      support_email: 'support@example.com',

      // Logos
      favicon_url: '',
      logo_light_url: '',
      logo_dark_url: '',
      sidebar_logo_url: '',
      mobile_logo_url: '',
      landing_logo_url: '',
      favicon_notification_logo_url: '',
      onboarding_logo_url: '',

      // Maintenance
      maintenance_mode: false,
      maintenance_title: 'Under Maintenance',
      maintenance_message: 'We are performing some maintenance. Please check back later.',
      maintenance_image_url: '',
      maintenance_allowed_ips: null,

      // Dynamic Pages
      page_404_title: 'Page Not Found',
      page_404_content: 'The page you are looking for does not exist.',
      page_404_image_url: '',
      no_internet_title: 'No Internet Connection',
      no_internet_content: 'Please check your internet connection and try again.',
      no_internet_image_url: '',

      // Email configuration
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_pass: '',
      mail_from_name: 'My Application',
      mail_from_email: 'noreply@myapplication.com',
      mail_encryption: 'tls',

      default_theme_mode: 'light',
      display_customizer: true,
      audio_calls_enabled: true,
      video_calls_enabled: true,
      allow_voice_message: true,
      allow_archive_chat: true,
      allow_media_send: true,
      allow_user_block: true,
      allow_user_signup: true,
      call_timeout_seconds: 25,
      session_expiration_days: 7,

      // Media & Chat limits
      document_file_limit: 15,
      audio_file_limit: 15,
      video_file_limit: 20,
      image_file_limit: 10,
      multiple_file_share_limit: 10,
      maximum_message_length: 40000,
      allowed_file_upload_types: null,

      // Group Settings
      max_groups_per_user: 500,
      max_group_members: 1024,

      auth_method: 'both',
      login_method: 'both',
      allow_screen_share: true,
      time_format: '12h',
      allow_status: true,
      status_expiry_time: 24,
      status_limit: 3,
      sms_gateway: null,

      // Timestamps
      created_at: new Date(),
      updated_at: new Date(),
    }]);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('settings', null, {});
  }
};
