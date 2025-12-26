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

router.post('/webhook/stripe', express.raw({type: 'application/json'}), userVerificationController.stripeWebhook);
router.post('/webhook/paypal', express.json(), userVerificationController.paypalWebhook);

router.get('/status/:request_id', userVerificationController.getVerificationStatus);
router.get('/my-status', authenticate, userVerificationController.getMyVerificationStatus);
router.post('/upload/doc', authenticate, uploadDocuments, userVerificationController.uploadDocuments);

router.post('/admin/approve', authenticate, authorizeRoles(['super_admin']), userVerificationController.approveVerificationByAdmin);
router.post('/request/approve', authenticate, authorizeRoles(['super_admin']), userVerificationController.approveVerification);
router.post('/request/reject', authenticate, authorizeRoles(['super_admin']), userVerificationController.rejectVerification);

router.get('/request/pending', authenticate, authorizeRoles(['super_admin']), userVerificationController.fetchPendingRequests);
router.get('/request/all', authenticate, authorizeRoles(['super_admin']), userVerificationController.fetchAllVerificationRequests);
router.get('/fetch/verified', authenticate, authorizeRoles(['super_admin']), userVerificationController.fetchVerifiedUsers);

module.exports = router;