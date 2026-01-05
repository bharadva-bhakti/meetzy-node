const express = require('express');
const router = express.Router();
const impersonationController = require('../controllers/impersonation.controller');
const { authenticate } = require('../middlewares/auth');
// const { impersonateUser, checkImpersonationStatus, restrictImpersonationActions } = require('../middlewares/impersonation');

router.use(authenticate);

// router.use(checkImpersonationStatus);

router.post('/start', impersonateUser, impersonationController.startImpersonation);

router.get('/available-users', impersonationController.getAvailableUsersToImpersonate);
router.get('/my-teams', impersonationController.getCurrentUserTeams);
router.get('/status', impersonationController.getImpersonationStatus);

router.post('/stop', impersonationController.stopImpersonation);

// router.use(restrictImpersonationActions);

module.exports = router;