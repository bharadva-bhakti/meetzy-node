'use strict';

const bcrypt = require('bcryptjs');
const { User } = require('../models');

async function createDefaultAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;

  const existingAdmin = await User.findOne({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

    await User.create({
      name: process.env.ADMIN_NAME,
      email: adminEmail,
      password: hashedPassword,
      role: 'super_admin',
      email_verified: true
    });

    console.log('Default admin created!');
  } else {
    console.log('Default admin already exists.');
  }
};

module.exports = createDefaultAdmin;
