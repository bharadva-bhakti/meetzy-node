const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const userVerificationController = require('../controllers/user-verification.controller');
const { uploader } = require('../utils/upload');

const uploadDocuments = uploader('verification').fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
]);

router.post('/initiate', authenticate, userVerificationController.initiateVerification);
router.post('/confirm', authenticate, userVerificationController.confirmPayment);
router.post('/sync-stripe', authenticate, userVerificationController.syncStripeSubscription);

router.get('/my-status', authenticate, userVerificationController.getMyVerificationStatus);
router.post('/upload/doc', authenticate, uploadDocuments, userVerificationController.uploadDocuments);

router.post('/admin/approve', authenticate, authorizeRoles(['super_admin']), userVerificationController.approveVerificationByAdmin);
router.post('/request/approve', authenticate, authorizeRoles(['super_admin']), userVerificationController.approveVerification);
router.post('/request/reject', authenticate, authorizeRoles(['super_admin']), userVerificationController.rejectVerification);

router.get('/request/all', authenticate, authorizeRoles(['super_admin']), userVerificationController.fetchAllVerificationRequests);

module.exports = router;