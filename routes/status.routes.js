const express = require('express');
const router = express.Router();
const statusController = require('../controllers/status.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { uploadSingle } = require('../utils/upload');
const checkStatusVideoDuration = require('../middlewares/checkStatusVideoDuration');

router.get('/', authenticate, statusController.getStatusFeed);
router.get('/fetch/mute', authenticate, statusController.getMutedStatuses);
router.get('/sponsored', authenticate, authorizeRoles(['super_admin']), statusController.getSponsoredStatuses);

router.post('/create', authenticate, uploadSingle('user-status', 'status'), checkStatusVideoDuration, statusController.createStatus);
router.post('/view', authenticate, statusController.viewStatus);
router.delete('/delete', authenticate, statusController.deleteStatus);

router.post('/mute', authenticate, statusController.toggleMuteStatus);

router.post('/reply', authenticate, statusController.replyToStatus);
router.get('/conversations', authenticate, statusController.getStatusReplyConversations);

module.exports = router