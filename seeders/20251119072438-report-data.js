'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const reportReasons = [
      { id: 1, title: 'Spam', created_at: new Date(), updated_at: new Date() },
      { id: 2, title: 'Fraud', created_at: new Date(), updated_at: new Date() },
      { id: 3, title: 'Nudity or Sexual Content', created_at: new Date(), updated_at: new Date() },
      { id: 4, title: 'Hate Speech or Abusive Content', created_at: new Date(), updated_at: new Date() },
      { id: 5, title: 'Harassment or Bullying', created_at: new Date(), updated_at: new Date() },
      { id: 6, title: 'Violence or Threats', created_at: new Date(), updated_at: new Date() },
      { id: 7, title: 'Self-Harm or Suicide', created_at: new Date(), updated_at: new Date() },
      { id: 8, title: 'Misinformation or Fake News', created_at: new Date(), updated_at: new Date() },
      { id: 9, title: 'Impersonation', created_at: new Date(), updated_at: new Date() },
      { id: 10, title: 'Other', created_at: new Date(), updated_at: new Date() }
    ];

    await queryInterface.bulkInsert('report_reasons', reportReasons, {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('report_reasons', null, {});
  }
};
