const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const userVerificationController = require('../controllers/user-verification.controller');
const { uploader } = require('../utils/upload');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

const uploadDocuments = uploader('verification').fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]);

router.post('/initiate', authenticate, restrictImpersonationActions, userVerificationController.initiateVerification);
router.post('/confirm', authenticate, restrictImpersonationActions, userVerificationController.confirmPayment);
router.post('/sync-stripe', authenticate, restrictImpersonationActions, userVerificationController.syncStripeSubscription);

router.get('/my-status', authenticate, userVerificationController.getMyVerificationStatus);
router.post('/upload/doc', authenticate, uploadDocuments, restrictImpersonationActions, userVerificationController.uploadDocuments);

router.post('/admin/approve', authenticate, authorizeRoles(['super_admin']), restrictImpersonationActions, userVerificationController.approveVerificationByAdmin);
router.post('/request/approve', authenticate, authorizeRoles(['super_admin']), restrictImpersonationActions, userVerificationController.approveVerification);
router.post('/request/reject', authenticate, authorizeRoles(['super_admin']), restrictImpersonationActions, userVerificationController.rejectVerification);

router.delete('/delete', authenticate, authorizeRoles(['super_admin']), userVerificationController.deleteVerification);

router.get('/request/all', authenticate, authorizeRoles(['super_admin']), userVerificationController.fetchAllVerificationRequests);

module.exports = router;