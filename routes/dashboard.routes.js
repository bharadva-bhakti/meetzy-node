const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const dashboardController = require('../controllers/dashboard.controller');

router.get('/', authenticate, authorizeRoles(['super_admin']), dashboardController.dashboard);

module.exports = router;