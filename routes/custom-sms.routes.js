const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const customSmsController = require('../controllers/custom-sms.controller');

router.get('/', authenticate, authorizeRoles(['super_admin']), customSmsController.getAllGateways);
router.get('/:id', authenticate, authorizeRoles(['super_admin']), customSmsController.getGatewayById);

router.post('/create', authenticate, authorizeRoles(['super_admin']), customSmsController.createGateway);
router.put('/update/:id', authenticate, authorizeRoles(['super_admin']), customSmsController.updateGateway);
router.post('/save', authenticate, authorizeRoles(['super_admin']), customSmsController.saveGateway);

router.delete('/delete/:id', authenticate, authorizeRoles(['super_admin']), customSmsController.deleteGateway);

router.post('/toggle', authenticate, authorizeRoles(['super_admin']), customSmsController.toggleGateway);
router.post('/test', authenticate, authorizeRoles(['super_admin']), customSmsController.testGateway);

module.exports = router;