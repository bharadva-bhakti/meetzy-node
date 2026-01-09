const express = require('express');
const router = express.Router();
const groupController = require('../controllers/group.controller');
const { authenticate, authorizeGroupRole, authorizeRoles } = require('../middlewares/auth');
const { uploadSingle } = require('../utils/upload');
const { restrictImpersonationActions } = require('../middlewares/impersonation');

const authorizeAdminRole = async (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  return authorizeGroupRole(['admin', 'member'])(req, res, next);
};

router.get('/get/:id', authenticate, groupController.getGroupInfo);
router.get('/my-group', authenticate, groupController.getUserGroup);

router.get('/members', authenticate, authorizeRoles(['super_admin', 'user']), groupController.getGroupMembers);
router.post('/member/add', authenticate, authorizeGroupRole(['admin', 'member']), restrictImpersonationActions, groupController.addMembersToGroup);
router.post('/member/remove', authenticate, authorizeAdminRole, restrictImpersonationActions, groupController.removeMemberFromGroup);
router.post('/member/update/role', authenticate, authorizeAdminRole, restrictImpersonationActions, groupController.changeMemberRole);

router.post('/create', authenticate, uploadSingle('group-avatars','avatar'), restrictImpersonationActions, groupController.createGroup);
router.put('/update', authenticate, uploadSingle('group-avatars','avatar'), authorizeAdminRole, restrictImpersonationActions, groupController.updateGroup);
router.put('/setting/update', authenticate, authorizeGroupRole(['admin']), restrictImpersonationActions, groupController.updateGroupSetting);
router.delete('/delete', authenticate, authorizeAdminRole, restrictImpersonationActions, groupController.deleteGroup);

router.post('/leave', authenticate, authorizeGroupRole(['admin', 'member']), restrictImpersonationActions, groupController.leaveGroup);

// Admin routes
router.get('/all', authenticate, authorizeRoles(['super_admin', 'user']), groupController.getAllGroups);

module.exports = router;