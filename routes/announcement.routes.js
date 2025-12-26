const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const announcementController = require('../controllers/announcement.controller');
const { uploadSingle } = require('../utils/upload');

router.post('/send', authenticate, authorizeRoles(['super_admin']), uploadSingle('announcements', 'file'), announcementController.sendAnnouncement);
router.put('/update/:id', authenticate, authorizeRoles(['super_admin']), uploadSingle('announcements', 'file'), announcementController.editAnnouncement);

router.delete('/delete', authenticate, authorizeRoles(['super_admin']), announcementController.deleteAnnouncement);
router.get('/fetch', authenticate, authorizeRoles(['super_admin']), announcementController.getAnnouncements);

module.exports = router