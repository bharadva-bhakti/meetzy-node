const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const smsGatewayController = require('../controllers/sms-gateway.controller');

router.get('/', authenticate, authorizeRoles(['super_admin']), smsGatewayController.getGateways);

router.post('/create', authenticate, authorizeRoles(['super_admin']), smsGatewayController.createGateway);
router.put('/update/:id', authenticate, authorizeRoles(['super_admin']), smsGatewayController.updateGateway);

router.post('/toggle/:id', authenticate, authorizeRoles(['super_admin']), smsGatewayController.changeGatewayStatus);

module.exports = router;