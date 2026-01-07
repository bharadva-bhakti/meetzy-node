const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const { restrictImpersonationActions } = require("../middlewares/impersonation");
const accountController = require('../controllers/account.controller');
const { uploadSingle } = require('../utils/upload');

router.get('/getUserDetails', authenticate, accountController.getUserDetails);
router.get('/:id/profile', authenticate, accountController.getUserProfile);

router.put('/updateProfile', authenticate, uploadSingle('avatars','avatar'), restrictImpersonationActions, accountController.updateProfile);
router.put('/updatePassword', authenticate, restrictImpersonationActions, accountController.updatePassword);

router.delete('/delete', authenticate, accountController.deleteAccount);

module.exports = router