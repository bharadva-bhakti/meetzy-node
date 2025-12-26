const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const reportReasonController = require('../controllers/report-reason.controller');

router.get('/all', authenticate, authorizeRoles(['super_admin', 'user']), reportReasonController.fetchAllData);
router.post('/create', authenticate, authorizeRoles(['super_admin']), reportReasonController.createReportReason);
router.put('/:id/update', authenticate, authorizeRoles(['super_admin']), reportReasonController.updateReportReason);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), reportReasonController.deleteReportReason);

module.exports = router;