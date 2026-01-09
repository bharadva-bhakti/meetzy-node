const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const subscriptionController = require('../controllers/subscription.controller');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

router.get('/my', authenticate, subscriptionController.getMySubscription);
router.get('/limits', authenticate, subscriptionController.getUserLimits);
router.get('/:id', authenticate, subscriptionController.getSubscriptionDetails); 
router.post('/cancel', authenticate, restrictImpersonationActions, subscriptionController.cancelSubscription); 
router.get('/payments/:subscription_id', authenticate, subscriptionController.getSubscriptionPayments); 
router.get('/get/admin', authenticate, authorizeRoles(['super_admin']), subscriptionController.getAllSubscriptions); 

module.exports = router;