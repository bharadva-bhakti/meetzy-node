const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth');
const { sequelize } = require('../models');

router.post('/register', authController.register);

router.post('/login/init', authController.loginInit);
router.post('/login/verify-otp', authController.verifyOtpLogin);
router.post('/login/password', authController.loginWithPassword);

router.post('/link', authController.linkIdentifier);
router.post('/verify-linkOtp', authController.verifyLinkOtp);

router.post('/verify-otp', authController.verifyOTP);
router.post('/resend-otp', authController.resendOTP);

router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

router.post('/logout', authenticate, authController.logout);

router.get('/connect/drive', authenticate, authController.connectToDrive);

// ⚠️ DANGEROUS ROUTE - Database Refresh
router.get('/refresh-db', async (req, res) => {
  try {

    const backupPath = path.join(process.cwd(), 'mongo-backup', DB_NAME);

    // 1️⃣ Check backup exists
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({
        error: 'MongoDB backup not found',
        path: backupPath
      });
    }

    console.log('🗑️ Dropping MongoDB database...');

    // 2️⃣ Drop database
    await execPromise(
      `mongosh "${process.env.MONGODB_URI}?authSource=${AUTH_DB}" --eval "db.dropDatabase()"`
    );

    console.log('✅ Database dropped');

    // 3️⃣ Restore database
    console.log('📦 Restoring MongoDB database...');

    const restoreCmd = `
      mongorestore \
        --db ${DB_NAME} \
        --username ${DB_USER} \
        --password ${DB_PASS} \
        --authenticationDatabase ${AUTH_DB} \
        ${backupPath}
    `;

    await execPromise(restoreCmd);

    console.log('✅ Database restored successfully');

    return res.json({
      success: true,
      message: 'MongoDB database refreshed successfully',
      database: DB_NAME
    });

  } catch (error) {
    console.error('❌ MongoDB refresh error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh MongoDB database',
      details: error.message
    });
  }
});

module.exports = router;
