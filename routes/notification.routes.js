const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middlewares/auth');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.get('/', authenticate, notificationController.fetchNotifications);
router.get('/unread-count', authenticate, notificationController.getUnreadCount);

router.post('/:id/read', authenticate, restrictImpersonationActions, notificationController.markAsRead);
router.post('/mark-all-read', authenticate, notificationController.markAllAsRead);

router.delete('/delete/:notificationId', authenticate, restrictImpersonationActions, notificationController.deleteNotification);

module.exports = router