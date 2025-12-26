const express = require('express');
const router = express.Router();
const callController = require('../controllers/call.controller');
const { authenticate } = require('../middlewares/auth');

router.post('/initiate', authenticate, callController.initiateCall);
router.post('/answer', authenticate, callController.answerCall);
router.post('/decline', authenticate, callController.declineCall);
router.post('/end', authenticate, callController.endCall);
router.get('/history', authenticate, callController.getCallHistory);

module.exports = router;