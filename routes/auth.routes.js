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

        console.log('🗑️ Dropping all tables...');

        // Drop all tables
        await sequelize.drop();

        console.log('✅ All tables dropped');

        // Path to your SQL file (from project root)
        const sqlFilePath = path.join(process.cwd(), 'db.sql');

        console.log('📂 Reading SQL file...');

        // Check if file exists
        try {
            await fs.access(sqlFilePath);
        } catch (err) {
            return res.status(404).json({
                error: 'SQL file not found',
                path: sqlFilePath
            });
        }

        console.log('💉 Executing SQL import...');

        // Get database credentials from Sequelize config
        const config = sequelize.config;
        const dbName = config.database;
        const dbUser = config.username;
        const dbPass = config.password;
        const dbHost = config.host || 'localhost';

        // Try using mysql command line tool for reliable import
        const command = `mysql -h ${dbHost} -u ${dbUser} ${dbPass ? `-p${dbPass}` : ''} ${dbName} < "${sqlFilePath}"`;

        try {

            const { stdout, stderr } = await execPromise(command);

            if (stderr && !stderr.includes('Warning')) {
                console.error('⚠️ Import warnings:', stderr);
            }

            console.log('✅ Database refreshed successfully via MySQL CLI');

            return res.json({
                success: true,
                message: 'Database refreshed successfully',
                method: 'MySQL CLI',
                output: stdout || 'Import completed'
            });

        } catch (execError) {
            // If mysql CLI fails, fallback to Sequelize query
            console.log('⚠️ MySQL CLI failed, using Sequelize fallback...');
            console.log('Error:', execError.message);

            const sqlContent = await fs.readFile(sqlFilePath, 'utf8');

            // Remove comments and split properly
            const statements = sqlContent
                .split('\n')
                .filter(line => !line.trim().startsWith('--'))
                .join('\n')
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0);

            let success = 0;
            let failed = 0;
            const errors = [];

            for (let i = 0; i < statements.length; i++) {
                try {
                    await sequelize.query(statements[i]);
                    success++;
                    console.log(`✅ Statement ${i + 1}/${statements.length} executed`);
                } catch (err) {
                    failed++;
                    errors.push({
                        statement: i + 1,
                        error: err.message,
                        preview: statements[i].substring(0, 100)
                    });
                    console.error(`❌ Statement ${i + 1} failed:`, err.message);
                }
            }

            console.log(`✅ Import complete: ${success} success, ${failed} failed`);

            return res.json({
                success: failed === 0,
                message: failed === 0 ? 'Database refreshed successfully' : 'Database refreshed with some errors',
                method: 'Sequelize fallback',
                statementsExecuted: success,
                statementsFailed: failed,
                errors: errors.slice(0, 5) // Only show first 5 errors
            });
        }

    } catch (error) {
        console.error('❌ Database refresh error:', error);
        res.status(500).json({
            error: 'Failed to refresh database',
            details: error.message
        });
    }
});

module.exports = router;