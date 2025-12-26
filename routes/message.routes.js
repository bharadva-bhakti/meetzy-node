const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const messageController = require('../controllers/message.controller');
const { uploadFiles, uploadSingle } = require('../utils/upload');

router.post('/send', authenticate, uploadFiles('messages', 'files'), messageController.sendMessage);
router.get('/get',authenticate,messageController.getMessages);

router.post('/mark/read', authenticate, messageController.markMessagesAsRead)

router.post('/toggle-reaction', authenticate, messageController.toggleReaction);
router.post('/star', authenticate, messageController.toggleStarMessage);
router.post('/edit/:id',authenticate, messageController.editMessage);
router.post('/forward', authenticate, messageController.forwardMessage);
router.post('/delete', authenticate, messageController.deleteMessage);

router.post('/toggle-disappear', authenticate, messageController.toggleDisappearingMessages);

router.get('/search', authenticate, messageController.searchMessages);
router.post('/pin', authenticate, messageController.togglePinMessage);

router.get('/get-documents', authenticate, messageController.listDocuments);
router.get('/search-document', authenticate, messageController.searchDocuments);

module.exports = router