const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const userSettingController = require('../controllers/user-setting.controller');

router.get('/:id', authenticate, userSettingController.getUserSetting);
router.put('/update', authenticate, userSettingController.updateUserSetting);

router.post('/forgot/pin', authenticate, userSettingController.forgetChatLockPin);
router.post('/verify/pin', authenticate, userSettingController.verifyChatLockPinOtp);
router.post('/reset/chat-pin', authenticate, userSettingController.resetChatLockPin);

module.exports = router;