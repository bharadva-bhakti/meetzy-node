const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const wallpaperController = require('../controllers/wallpaper.controller');
const { uploadSingle } = require('../utils/upload');

router.get('/all', authenticate, authorizeRoles(['super_admin', 'user']), wallpaperController.getAllWallpapers);
router.post('/create', authenticate, authorizeRoles(['super_admin']), uploadSingle('wallpaper','wallpaper'), wallpaperController.createWallpaper);
router.put('/:id/update', authenticate, authorizeRoles(['super_admin']), uploadSingle('wallpaper','wallpaper'), wallpaperController.updateWallpaper);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), wallpaperController.updateWallpaperStatus);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), wallpaperController.deleteWallpaper);

module.exports = router;