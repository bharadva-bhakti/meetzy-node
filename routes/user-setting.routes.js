const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const userSettingController = require('../controllers/user-setting.controller');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.get('/:id', authenticate, userSettingController.getUserSetting);
router.put('/update', authenticate, restrictImpersonationActions, userSettingController.updateUserSetting);

router.post('/forgot/pin', authenticate, restrictImpersonationActions, userSettingController.forgetChatLockPin);
router.post('/verify/pin', authenticate, restrictImpersonationActions, userSettingController.verifyChatLockPinOtp);
router.post('/reset/chat-pin', authenticate, restrictImpersonationActions, userSettingController.resetChatLockPin);

module.exports = router;