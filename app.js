'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const app = express();
dotenv.config();

let installWizard = null;

module.exports = (async () => {
    // Load models (may be empty if no DB)
    let db = null;
    let User = null;
    let dbConnected = false; // Track actual DB connection status

    try {
        const models = require('./models');
        // Attempt to connect to MongoDB if available
        if (process.env.MONGODB_URI) {
            db = await models.connectDB();
            dbConnected = true;
            console.log('✅ Database connected successfully');
        }
        User = models.db.User;
    } catch (error) {
        console.warn('⚠️ Models not loaded:', error.message);
    }

    // Try to connect to database if available
    if (db) {
        try {
            // MongoDB connection is already established via connectDB()
            dbConnected = true;
            console.log('✅ Database connected successfully');
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            console.warn('⚠️ Running without database - you can configure database via /install');
            dbConnected = false;
            db = null; // Set to null so installation check works
        }
    } else {
        console.warn('⚠️ No database configuration - please visit /install to set up');
    }

    app.use(
        cors({
            origin: function (origin, callback) {
                // Read the allowed origins from the environment variable
                const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
                
                // Always allow same-origin requests and no-origin requests (Postman, curl, etc.)
                if (!origin) return callback(null, true); // allow Postman or mobile apps
                
                // For local development, allow localhost:3000
                if (origin && (origin.includes('localhost:') || origin.includes('127.0.0.1:'))) {
                    return callback(null, true);
                }
                
                if (allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('CORS blocked: ' + origin));
                }
            },
            credentials: true,
        })
    );

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    // Serve install wizard static files
    app.use('/install', express.static(path.join(__dirname, 'public/install')));

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    app.get('/', (req, res) => {
        res.render('welcome');
    });
    // Session handling middleware
    app.use((req, res, next) => {
        // Ensure session object exists
        if (!req.session) {
            req.session = {};
        }
        
        const oldSnapshot = Object.assign({}, req.session._old || {});
        const errorsSnapshot = Object.assign({}, req.session._errors || {});
        res.locals.session = req.session;
        res.locals.errors = errorsSnapshot;
        res.locals.old = (key, fallback = '') => {
            if (!key) return fallback;
            const parts = key.split('.');
            let cur = oldSnapshot;
            for (const p of parts) {
                if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
                    cur = cur[p];
                } else {
                    return fallback;
                }
            }
            return cur ?? fallback;
        };
        req.session._old = {};
        req.session._errors = {};
        next();
    });

    // ----------------- Install Wizard Setup -----------------
    try {
        const { InstallWizard, checkUserModelCompatibility } = require('./index.js');

        installWizard = new InstallWizard({ mountPath: '/install' });

        // Only check user model compatibility if we have database and User model
        if (User && dbConnected) {
            try {
                const userModelCompatibility = await checkUserModelCompatibility(User);

                if (userModelCompatibility.compatible) {
                    installWizard.setExistingUserModel(User);
                    console.log('✅ Will sync with existing User model during installation');
                } else {
                    console.log('⚠️ User model compatibility issues:', userModelCompatibility.reason);
                }
            } catch (error) {
                console.warn('⚠️ Could not check user model compatibility:', error.message);
            }
        }

        installWizard.mount(app);
        console.log('✅ Installation wizard mounted at /install');
    } catch (error) {
        console.error('❌ Could not initialize install wizard:', error.message);
        console.error(error.stack);
    }


    // ----------------- Check Installation Status -----------------
    app.use(async (req, res, next) => {

        // Always allow these paths
        if (
            req.path.startsWith('/install') ||
            req.path.startsWith('/uploads') ||
            req.path === '/favicon.ico' ||
            req.path === '/health'
        ) {
            return next();
        }

        // Check if database is connected
        if (!dbConnected || !db) {
            console.log('⚠️ No database connection - redirecting to /install');
            return res.redirect('/install');
        }

        // Check if installation is complete
        if (installWizard) {
            try {
                const isInstalled = await installWizard.isInstalled();
                if (!isInstalled) {
                    console.log('⚠️ Installation not complete - redirecting to /install');
                    return res.redirect('/install');
                }
            } catch (error) {
                console.warn('⚠️ Could not check installation status:', error.message);
                return res.redirect('/install');
            }
        }

        next();
    });


    const authRoutes = require('./routes/auth.routes');
    const authController = require('./controllers/auth.controller');
    const accountRoutes = require('./routes/account.routes');
    const userRoutes = require('./routes/user.routes');
    const groupRoutes = require('./routes/group.routes');
    const messageRoutes = require('./routes/message.routes');
    const friendRoutes = require('./routes/friend.routes');
    const chatRoutes = require('./routes/chat.routes');
    const notificationRoutes = require('./routes/notification.routes');
    const settingRoutes = require('./routes/setting.routes');
    const faqRoutes = require('./routes/faq.routes');
    const wallpaperRoutes = require('./routes/wallpaper.routes');
    const stickerRoutes = require('./routes/sticker.routes');
    const pageRoutes = require('./routes/page.routes');
    const inquiryRoutes = require('./routes/contact-inquiries.routes');
    const reportReasonRoutes = require('./routes/report-reason.routes');
    const userReportRoutes = require('./routes/user-report.routes');
    const dashboardRoutes = require('./routes/dashboard.routes');
    const userSettingRoutes = require('./routes/user-setting.routes');
    const statusRoutes = require('./routes/status.routes');
    const callRoutes = require('./routes/call.routes');
    const customSMSRoutes = require('./routes/custom-sms.routes');
    const smsGatewayRoutes = require('./routes/sms-gateway.routes');
    const e2eRoutes = require('./routes/e2e.routes');
    const planRoutes = require('./routes/plan.routes');
    const userVerificationRoutes = require('./routes/user-verification.routes');
    const subscriptionRoutes = require('./routes/subscription.routes');
    const announcementRoutes = require('./routes/announcement.routes');
    const broadcastRoutes = require('./routes/broadcast.routes');
    const languageRoutes = require('./routes/language.routes');
    const impersonateRoutes = require('./routes/impersonation.routes');

    app.get('/api/demo', (req, res) => {
        return res.json({ demo: process.env.DEMO === 'true' });
    });

    app.get('/auth/google/callback', authController.saveToken);
    app.post('/api/send-test-email', authController.sendTestMail);
    app.use('/api/auth', authRoutes);
    app.use('/api/account', accountRoutes);
    app.use('/api/user', userRoutes);
    app.use('/api/group', groupRoutes);
    app.use('/api/message', messageRoutes);
    app.use('/api/friend', friendRoutes);
    app.use('/api/chat', chatRoutes);
    app.use('/api/notification', notificationRoutes);
    app.use('/api/setting', settingRoutes);
    app.use('/api/faq', faqRoutes);
    app.use('/api/wallpaper', wallpaperRoutes);
    app.use('/api/sticker', stickerRoutes);
    app.use('/api/page', pageRoutes);
    app.use('/api/inquiry', inquiryRoutes);
    app.use('/api/report', reportReasonRoutes);
    app.use('/api/user-report', userReportRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use('/api/user-setting', userSettingRoutes);
    app.use('/api/status', statusRoutes);
    app.use('/api/call', callRoutes);
    app.use('/api/custom/sms', customSMSRoutes);
    app.use('/api/gateway', smsGatewayRoutes);
    app.use('/api/e2e', e2eRoutes);
    app.use('/api/verification', userVerificationRoutes);
    app.use('/api/plan', planRoutes);
    app.use('/api/subscription', subscriptionRoutes);
    app.use('/api/announcement', announcementRoutes);
    app.use('/api/broadcast', broadcastRoutes);
    app.use('/api/language', languageRoutes);
    app.use('/api/impersonate', impersonateRoutes);

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            error: 'Not Found',
            message: 'The requested resource was not found',
            path: req.path
        });
    });

    // Error handler
    app.use((err, req, res, next) => {
        console.error('Error:', err);
        res.status(err.status || 500).json({
            error: err.message || 'Internal Server Error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    });

    return app;
})();