const express = require('express');
const router = express.Router();
const friendController = require('../controllers/friend.controller');
const { authenticate } = require('../middlewares/auth');

router.get('/suggestions', authenticate, friendController.getFriendSuggestions);
router.get('/pending-request', authenticate, friendController.getPendingRequests);

router.post('/send-request', authenticate, friendController.sendFriendRequest);
router.post('/respond', authenticate, friendController.respondToFriendRequest);

router.get('/search-friend', authenticate, friendController.searchFriendSuggestions);

router.post('/unfriend', authenticate, friendController.unFriend);

module.exports = router;