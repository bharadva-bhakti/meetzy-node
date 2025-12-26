const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const settingController = require('../controllers/setting.controller');
const { uploader } = require('../utils/upload');

const uploadLogos = uploader('logos').fields([
    { name: 'favicon', maxCount: 1 },
    { name: 'logo_light', maxCount: 1 },
    { name: 'logo_dark', maxCount: 1 },
    { name: 'sidebar_logo', maxCount: 1 },
    { name: 'mobile_logo', maxCount: 1 },
    { name: 'landing_logo', maxCount: 1 },
    { name: 'favicon_notification_logo', maxCount: 1 },
    { name: 'onboarding_logo', maxCount: 1 },
    { name: 'maintenance_image', maxCount: 1 },
    { name: 'page_404_image', maxCount: 1 },
    { name: 'no_internet_image', maxCount: 1 }
]);

router.get('/', authenticate, settingController.getSettings);
router.get('/public', settingController.getPublicSettings);
router.put('/update', authenticate, authorizeRoles(['super_admin']), uploadLogos, settingController.updateSettings);

module.exports = router;