const express = require('express');
const router = express.Router();
const statusController = require('../controllers/status.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { uploadSingle } = require('../utils/upload');
const checkStatusVideoDuration = require('../middlewares/checkStatusVideoDuration');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.get('/', authenticate, statusController.getStatusFeed);
router.get('/fetch/mute', authenticate, statusController.getMutedStatuses);
router.get('/sponsored', authenticate, authorizeRoles(['super_admin']), statusController.getSponsoredStatuses);

router.post('/create', authenticate, uploadSingle('user-status', 'status'), checkStatusVideoDuration, restrictImpersonationActions, statusController.createStatus);
router.post('/view', authenticate, restrictImpersonationActions, statusController.viewStatus);
router.delete('/delete', authenticate, restrictImpersonationActions, statusController.deleteStatus);

router.post('/mute', authenticate, restrictImpersonationActions, statusController.toggleMuteStatus);

router.post('/reply', authenticate, restrictImpersonationActions, statusController.replyToStatus);
router.get('/conversations', authenticate, statusController.getStatusReplyConversations);

module.exports = router