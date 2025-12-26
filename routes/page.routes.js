const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const pageController = require('../controllers/page.controller');

router.get('/', authenticate, authorizeRoles(['super_admin', 'user']), pageController.fetchPages);
router.get('/slug/:slug', authenticate, authorizeRoles(['super_admin', 'user']), pageController.getPageBySlug);
router.post('/create', authenticate, authorizeRoles(['super_admin']), pageController.createPage);

router.put('/update/:id', authenticate, authorizeRoles(['super_admin']), pageController.updatePage);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), pageController.updatePageStatus);

router.delete('/delete', authenticate, authorizeRoles(['super_admin']), pageController.deletePage);

module.exports = router;
