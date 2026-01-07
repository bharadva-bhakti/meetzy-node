const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const languageController = require('../controllers/language.controller');
const { uploader } = require('../utils/upload');

const uploadFiles = uploader('translations').fields([
    { name: 'translation', maxCount: 1 },
    { name: 'flag', maxCount: 1 }
]);

router.get('/', authenticate, authorizeRoles(['super_admin', 'user']), languageController.fetchLanguages);
router.get('/active', authenticate, authorizeRoles(['super_admin', 'user']), languageController.fetchActiveLanguages);
router.post('/create', authenticate, authorizeRoles(['super_admin']), ...uploadFiles, languageController.createLanguage);

router.put('/update/:id', authenticate, uploadFiles, authorizeRoles(['super_admin']), languageController.updateLanguage);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), languageController.updateLanguageStatus);

router.get('/:locale/translation', languageController.getTranslationFile);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), languageController.deleteLanguages);

module.exports = router;
