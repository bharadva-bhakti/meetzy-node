'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(
    cors({
        origin: function (origin, callback) {
            // Read the allowed origins from the environment variable
            const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
            if (!origin) return callback(null, true); // allow Postman or mobile apps
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
app.use('/api/message',messageRoutes);
app.use('/api/friend',friendRoutes);
app.use('/api/chat',chatRoutes);
app.use('/api/notification',notificationRoutes);
app.use('/api/setting',settingRoutes);
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

module.exports = app;