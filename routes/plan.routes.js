const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const planController = require('../controllers/plan.controller');

router.get('/', authenticate, authorizeRoles(['super_admin', 'user']), planController.getAllPlans);
router.get('/active', authenticate, authorizeRoles(['super_admin', 'user']), planController.getActivePlans);

router.get('/:id', authenticate, authorizeRoles(['super_admin', 'user']), planController.getPlanById);
router.get('/slug/:slug', authenticate, authorizeRoles(['super_admin', 'user']), planController.getPlanBySlug);

router.post('/create', authenticate, authorizeRoles(['super_admin']), planController.createPlan);
router.put('/update/:id', authenticate, authorizeRoles(['super_admin']), planController.updatePlan);

router.put('/status/:id', authenticate, authorizeRoles(['super_admin']), planController.updatePlanStatus);
router.put('/set-default/:id', authenticate, authorizeRoles(['super_admin']), planController.setDefaultPlan);

router.post('/delete', authenticate, authorizeRoles(['super_admin']), planController.deletePlan);

module.exports = router;