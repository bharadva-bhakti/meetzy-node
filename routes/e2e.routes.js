const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const e2eController = require('../controllers/e2e.controller');

router.post('/keys', authenticate, e2eController.savePublicKey);
router.get('/keys/:user_id', authenticate, e2eController.getPublicKey);
router.post('/delete/keys', authenticate, e2eController.deletePublicKey);

module.exports = router;