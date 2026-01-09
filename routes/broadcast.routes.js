const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const broadcastController = require('../controllers/broadcast.controller');
const { restrictImpersonationActions } = require("../middlewares/impersonation");

router.post('/create', authenticate, restrictImpersonationActions, broadcastController.createBroadcast);

router.get('/my-broadcasts', authenticate, broadcastController.getMyBroadcasts);
router.get('/:broadcast_id', authenticate, broadcastController.getBroadcast);

router.put('/:broadcast_id', authenticate, restrictImpersonationActions, broadcastController.updateBroadcast);
router.delete('/:broadcast_id', authenticate, restrictImpersonationActions, broadcastController.deleteBroadcast);

router.post('/:broadcast_id/recipients', authenticate, restrictImpersonationActions, broadcastController.addRecipients);
router.delete('/:broadcast_id/recipients', authenticate, restrictImpersonationActions, broadcastController.removeRecipients);

module.exports = router;