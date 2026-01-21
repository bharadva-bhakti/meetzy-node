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
    const SOURCE_DB = 'meetzy';
    const TARGET_DB = 'meetzy_new';

    const DB_USER = 'meetzy_user';
    const DB_PASS = 'T$123eam';
    const AUTH_DB = 'admin';
    const DB_HOST = 'localhost';
    const DB_PORT = 27017;

    const backupPath = path.join(process.cwd(), 'backup', SOURCE_DB);

    // ✅ async backup check
    try {
      await fs.access(backupPath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'MongoDB backup not found',
        path: backupPath
      });
    }

    console.log('📦 Restoring MongoDB database...');

    // ✅ SINGLE-LINE command (CRITICAL)
    const restoreCmd =
      `mongorestore --host ${DB_HOST} --port ${DB_PORT} ` +
      `--username ${DB_USER} --password "${DB_PASS}" ` +
      `--authenticationDatabase ${AUTH_DB} --drop ` +
      `--nsFrom "${SOURCE_DB}.*" --nsTo "${TARGET_DB}.*" ` +
      `"${backupPath}"`;

    await execPromise(restoreCmd);

    console.log('✅ MongoDB restored into meetzy_new');

    return res.json({
      success: true,
      message: 'MongoDB database refreshed successfully',
      sourceDb: SOURCE_DB,
      targetDb: TARGET_DB
    });

  } catch (error) {
    console.error('❌ MongoDB refresh error:', error.stderr || error.message);

    return res.status(500).json({
      success: false,
      error: 'Failed to refresh MongoDB database',
      details: error.stderr || error.message
    });
  }
});

module.exports = router;
