const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const faqController = require('../controllers/faq.controller');

router.get('/all', authenticate, authorizeRoles(['super_admin', 'user']), faqController.getAllFaqs);
router.post('/create', authenticate, authorizeRoles(['super_admin']), faqController.createFaq);
router.put('/:id/update', authenticate, authorizeRoles(['super_admin']), faqController.updateFaq);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), faqController.updateFaqStatus);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), faqController.deleteFaq);

module.exports = router;