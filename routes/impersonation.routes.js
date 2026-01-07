const express = require('express');
const router = express.Router();
const impersonationController = require('../controllers/impersonation.controller');
const { authenticate } = require('../middlewares/auth');
const { checkImpersonationStatus, restrictImpersonationActions, } = require('../middlewares/impersonation');

router.use(authenticate);            
router.use(checkImpersonationStatus);

router.post('/start', impersonationController.startImpersonation);
router.post('/stop', impersonationController.stopImpersonation);

router.get('/status', impersonationController.getImpersonationStatus);
router.get('/available-users', impersonationController.getAvailableUsersToImpersonate);

router.use(restrictImpersonationActions);

module.exports = router;