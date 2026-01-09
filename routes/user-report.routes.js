const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const userReportController = require('../controllers/user-report.controller');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.get('/all', authenticate, authorizeRoles(['super_admin']), userReportController.fetchReports);
router.post('/create', authenticate, authorizeRoles(['super_admin', 'user']), restrictImpersonationActions, userReportController.createUserReport);
router.put('/:id/update', authenticate, authorizeRoles(['super_admin']), userReportController.updateUserReport);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), userReportController.deleteUserReport);

module.exports = router;