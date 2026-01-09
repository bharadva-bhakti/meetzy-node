const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const contactInquiryController = require('../controllers/contact-inquiries.controller');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.get('/all', authenticate, authorizeRoles(['super_admin']), contactInquiryController.getAllInquiries);
router.post('/create', authenticate, restrictImpersonationActions, contactInquiryController.createInquiry);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), contactInquiryController.deleteInquiry);

module.exports = router;