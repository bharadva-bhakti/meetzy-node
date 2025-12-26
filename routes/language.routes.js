const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const languageController = require('../controllers/language.controller');
const { uploadSingle } = require('../utils/upload');

router.get('/', authenticate, authorizeRoles(['super_admin', 'user']), languageController.fetchLanguages);
router.post('/create', authenticate, uploadSingle('translations','file'), authorizeRoles(['super_admin']), languageController.createLanguage);

router.put('/update/:id', authenticate, uploadSingle('translations','file'), authorizeRoles(['super_admin']), languageController.updateLanguage);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), languageController.updateLanguageStatus);

router.get('/:locale/translation', authenticate, languageController.getTranslationFile);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), languageController.deleteLanguages);

module.exports = router;
