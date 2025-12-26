'use strict';

const bcrypt = require('bcryptjs');
const { db } = require('../models');
const User = db.User;

async function createDefaultAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();

  if (!adminEmail || !process.env.ADMIN_PASSWORD || !process.env.ADMIN_NAME) {
    console.log('Admin credentials not provided in .env. Skipping default admin creation.');
    return;
  }

  try {
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);

      await User.create({
        name: process.env.ADMIN_NAME.trim(),
        email: adminEmail,
        password: hashedPassword,
        role: 'super_admin',
        email_verified: true,
        is_online: false,
        status: 'active',
      });

      console.log('Default super admin created successfully!');
    } else {
      console.log('Default super admin already exists.');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
}

module.exports = createDefaultAdmin;