const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const subscriptionController = require('../controllers/subscription.controller');

router.get('/my', authenticate, subscriptionController.getMySubscription);
router.get('/:id', authenticate, subscriptionController.getSubscriptionDetails); 
router.post('/cancel', authenticate, subscriptionController.cancelSubscription); 
router.get('/payments/:subscription_id', authenticate, subscriptionController.getSubscriptionPayments); 
router.get('get-admin', authenticate, authorizeRoles(['super_admin']), subscriptionController.getAllSubscriptions); 

module.exports = router;