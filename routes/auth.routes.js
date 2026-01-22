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
    const DB_HOST = '167.71.224.42';
    const DB_PORT = 27017;
    const backupPath = path.join(process.cwd(), 'backup', SOURCE_DB);

    // Check backup exists
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

    // Try different auth approaches
    const commands = [
      // Try 1: With authSource
      `mongorestore --uri "mongodb://${DB_USER}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${TARGET_DB}?authSource=admin" --drop "${backupPath}"`,
      
      // Try 2: With authSource=meetzy
      `mongorestore --uri "mongodb://${DB_USER}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${TARGET_DB}?authSource=meetzy" --drop "${backupPath}"`,
      
      // Try 3: Original format with meetzy as auth DB
      `mongorestore --host ${DB_HOST} --port ${DB_PORT} --username ${DB_USER} --password "${DB_PASS}" --authenticationDatabase meetzy --db ${TARGET_DB} --drop "${backupPath}"`
    ];

    let lastError;
    for (let i = 0; i < commands.length; i++) {
      try {
        console.log(`Attempting restore method ${i + 1}...`);
        await execPromise(commands[i]);
        console.log('✅ MongoDB restored successfully');
        
        return res.json({
          success: true,
          message: 'MongoDB database refreshed successfully',
          sourceDb: SOURCE_DB,
          targetDb: TARGET_DB,
          method: i + 1
        });
      } catch (error) {
        lastError = error;
        console.log(`Method ${i + 1} failed, trying next...`);
      }
    }

    throw lastError;

  } catch (error) {
    console.error('❌ MongoDB refresh error:', error.stderr || error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to refresh MongoDB database',
      details: error.stderr || error.message,
      suggestion: 'Check MongoDB user credentials and permissions'
    });
  }
});

module.exports = router;
