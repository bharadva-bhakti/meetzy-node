const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth');
const broadcastController = require('../controllers/broadcast.controller');

router.post('/create', authenticate, broadcastController.createBroadcast);

router.get('/my-broadcasts', authenticate, broadcastController.getMyBroadcasts);

router.put('/:broadcast_id', authenticate, broadcastController.updateBroadcast);
router.delete('/:broadcast_id', authenticate, broadcastController.deleteBroadcast);

router.post('/:broadcast_id/recipients', authenticate, broadcastController.addRecipients);
router.delete('/:broadcast_id/recipients', authenticate, broadcastController.removeRecipients);

module.exports = router;