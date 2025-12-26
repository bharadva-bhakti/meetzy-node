const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const stickerController = require('../controllers/sticker.controller');
const { uploadSingle } = require('../utils/upload');

router.get('/all', authenticate, authorizeRoles(['super_admin', 'user']), stickerController.getAllSticker);
router.post('/create', authenticate, authorizeRoles(['super_admin']), uploadSingle('sticker','sticker'), stickerController.createSticker);
router.put('/:id/update', authenticate, authorizeRoles(['super_admin']), uploadSingle('sticker','sticker'), stickerController.updateSticker);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), stickerController.updateStickerStatus);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), stickerController.deleteSticker);

module.exports = router;