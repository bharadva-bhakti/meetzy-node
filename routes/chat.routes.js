const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const chatController = require('../controllers/chat.controller');
const { restrictImpersonationActions } = require("../middlewares/impersonation");

router.post('/pin', authenticate, restrictImpersonationActions, chatController.togglePinConversation);

router.get('/get-archive', authenticate, chatController.getArchivedChats);
router.post('/toggle-archive', authenticate, restrictImpersonationActions, chatController.toggleArchive);
router.get('/search-archive', authenticate, chatController.searchArchiveChats);
router.post('/archive/all', authenticate, restrictImpersonationActions, chatController.archiveAllChats);

router.get('/get-block', authenticate, chatController.getBlockedUsers);
router.post('/toggle-block', authenticate, restrictImpersonationActions, chatController.toggleBlock);
router.get('/search-block', authenticate, chatController.searchBlockContact);

router.get('/get-favorite', authenticate, chatController.getFavoriteChat);
router.post('/toggle-favorite', authenticate, restrictImpersonationActions, chatController.toggleFavorite);
router.get('/search-favorite', authenticate, chatController.searchFavorites);

router.post('/mute', authenticate, restrictImpersonationActions, chatController.muteChat);
router.post('/unmute', authenticate, restrictImpersonationActions, chatController.unmuteChat);

router.get('/recent-chats',authenticate,chatController.getRecentChats);
router.get('/search/recent-chats', authenticate, chatController.searchRecentChat);

router.get('/get-contacts', authenticate, chatController.getContacts);
router.get('/search/contact', authenticate, chatController.searchContacts);

router.post('/delete', authenticate, restrictImpersonationActions, chatController.deleteChat);
router.post('/delete/all', authenticate, restrictImpersonationActions, chatController.deleteAllChats);

router.get('/export', authenticate, chatController.exportChat);

router.post('/clear', authenticate, restrictImpersonationActions, chatController.clearChat);
router.post('/clear/all', authenticate, restrictImpersonationActions, chatController.clearAllChats);

module.exports = router