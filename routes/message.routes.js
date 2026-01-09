const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const { restrictImpersonationActions } = require("../middlewares/impersonation");
const messageController = require('../controllers/message.controller');
const { uploadFiles, uploadSingle } = require('../utils/upload');

router.post('/send', authenticate, uploadFiles('messages', 'files'), restrictImpersonationActions, messageController.sendMessage);
router.get('/get',authenticate,messageController.getMessages);

router.post('/mark/read', authenticate, messageController.markMessagesAsRead)

router.post('/toggle-reaction', authenticate, restrictImpersonationActions, messageController.toggleReaction);
router.post('/star', authenticate, restrictImpersonationActions, messageController.toggleStarMessage);
router.post('/edit/:id',authenticate, restrictImpersonationActions, messageController.editMessage);
router.post('/forward', authenticate, restrictImpersonationActions, messageController.forwardMessage);
router.post('/delete', authenticate, restrictImpersonationActions, messageController.deleteMessage);

router.post('/toggle-disappear', authenticate, restrictImpersonationActions, messageController.toggleDisappearingMessages);

router.get('/search', authenticate, messageController.searchMessages);
router.post('/pin', authenticate, restrictImpersonationActions, messageController.togglePinMessage);

router.get('/get-documents', authenticate, messageController.listDocuments);
router.get('/search-document', authenticate, messageController.searchDocuments);

module.exports = router