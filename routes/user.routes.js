const express = require('express');
const router = express.Router();
const { authenticate, authorizeRoles } = require('../middlewares/auth');
const userController = require('../controllers/user.controller');
const { uploadSingle } = require('../utils/upload');

router.get('/all', authenticate, authorizeRoles(['super_admin', 'user']), userController.getAllUsers);
router.post('/create', authenticate, authorizeRoles(['super_admin']), uploadSingle('avatars','avatar'), userController.createUser);
router.put('/update', authenticate, authorizeRoles(['super_admin']), uploadSingle('avatars','avatar'), userController.updateUser);
router.put('/:id/update/status', authenticate, authorizeRoles(['super_admin']), userController.updateUserStatus);
router.delete('/delete', authenticate, authorizeRoles(['super_admin']), userController.deleteUser);

module.exports = router;