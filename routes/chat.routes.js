const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const chatController = require('../controllers/chat.controller');

router.post('/pin', authenticate, chatController.togglePinConversation);

router.get('/get-archive', authenticate, chatController.getArchivedChats);
router.post('/toggle-archive', authenticate, chatController.toggleArchive);
router.get('/search-archive', authenticate, chatController.searchArchiveChats);
router.post('/archive/all', authenticate, chatController.archiveAllChats);

router.get('/get-block', authenticate, chatController.getBlockedUsers);
router.post('/toggle-block', authenticate, chatController.toggleBlock);
router.get('/search-block', authenticate, chatController.searchBlockContact);

router.get('/get-favorite', authenticate, chatController.getFavoriteChat);
router.post('/toggle-favorite', authenticate, chatController.toggleFavorite);
router.get('/search-favorite', authenticate, chatController.searchFavorites);

router.post('/mute', authenticate, chatController.muteChat);
router.post('/unmute', authenticate, chatController.unmuteChat);

router.get('/recent-chats',authenticate,chatController.getRecentChats);
router.get('/search/recent-chats', authenticate, chatController.searchRecentChat);

router.get('/get-contacts', authenticate, chatController.getContacts);
router.get('/search/contact', authenticate, chatController.searchContacts);

router.post('/delete', authenticate, chatController.deleteChat);
router.post('/delete/all', authenticate, chatController.deleteAllChats);

router.get('/export', authenticate, chatController.exportChat);

router.post('/clear', authenticate, chatController.clearChat);
router.post('/clear/all', authenticate, chatController.clearAllChats);

module.exports = router