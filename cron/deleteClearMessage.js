const cron = require('node-cron');
const { db } = require('../models');
const Message = db.Message;
const MessageAction = db.MessageAction;
const ChatClear = db.ChatClear;

exports.deleteClearedMessages = () => {
  cron.schedule('* * * * *', async () => {
    console.log('Running auto cleanup...');

    try {
      const deletedForEveryone = await MessageAction.find({
        action_type: 'delete',
        'details.type': 'everyone'
      }).distinct('message_id');

      if (deletedForEveryone.length > 0) {
        await Message.deleteMany({ _id: { $in: deletedForEveryone } });
      }

      const directClears = await ChatClear.find({
        recipient_id: { $ne: null }
      }).lean();

      for (const clear of directClears) {
        const participants = [clear.user_id, clear.recipient_id];
        await Message.deleteMany({
          $or: [
            { sender_id: participants[0], recipient_id: participants[1] },
            { sender_id: participants[1], recipient_id: participants[0] }
          ],
          created_at: { $lte: clear.cleared_at },
          deleted_at: null
        });
      }

      const groupClears = await ChatClear.find({
        group_id: { $ne: null }
      }).lean();

      const groupIds = [...new Set(groupClears.map(c => c.group_id))];
      for (const groupId of groupIds) {
        const minClearedAt = groupClears
          .filter(c => c.group_id.toString() === groupId.toString())
          .reduce((min, c) => c.cleared_at < min ? c.cleared_at : min, new Date());

        await Message.deleteMany({
          group_id: groupId,
          created_at: { $lte: minClearedAt },
          deleted_at: null
        });
      }

      console.log('Cleanup done.');
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  });
};