const express = require('express');
const router = express.Router();
const callController = require('../controllers/call.controller');
const { authenticate } = require('../middlewares/auth');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.post('/initiate', authenticate, restrictImpersonationActions, callController.initiateCall);
router.post('/answer', authenticate, restrictImpersonationActions, callController.answerCall);
router.post('/decline', authenticate, restrictImpersonationActions, callController.declineCall);
router.post('/end', authenticate, restrictImpersonationActions, callController.endCall);
router.get('/history', authenticate, callController.getCallHistory);

module.exports = router;