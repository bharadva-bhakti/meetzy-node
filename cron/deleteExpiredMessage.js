const cron = require('node-cron');
const fs = require('fs');
const { db } = require('../models');
const MessageDisappearing = db.MessageDisappearing;
const Message = db.Message;
const MessageAction = db.MessageAction;
const { getConversationData, getTargetUsers, createSocketPayload } = require('../helper/messageHelpers');

module.exports.start = (io) => {
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();

      const expiredMessages = await MessageDisappearing.find({
        expire_at: { $lte: now }
      }).lean();

      if (expiredMessages.length === 0) {
        console.log('No expired messages found.');
        return;
      }

      const messageIds = expiredMessages.map(m => m.message_id);

      const messages = await Message.find({ _id: { $in: messageIds } })
        .sort({ created_at: -1 })
        .lean();

      if (messages.length === 0) return;

      const { newPrevMessagesMap } = await getConversationData(messages, messageIds);

      const deleteActions = [];
      const socketEvents = [];

      for (const message of messages) {
        const targetUsers = await getTargetUsers(message);

        for (const targetUserId of targetUsers) {
          deleteActions.push({
            message_id: message._id,
            user_id: targetUserId,
            action_type: 'delete',
            details: {
              type: 'me',
              deleted_by: null,
              original_sender_id: message.sender_id
            }
          });

          const payload = await createSocketPayload(
            message,
            targetUserId,
            newPrevMessagesMap,
            'delete-for-me',
            false
          );

          payload.deletedBySystem = true;

          socketEvents.push({
            room: `user_${targetUserId}`,
            payload
          });
        }

        if (message.file_url) {
          fs.unlink(message.file_url, () => {});
        }
      }

      if (deleteActions.length > 0) {
        await MessageAction.insertMany(deleteActions);
      }

      socketEvents.forEach(e => {
        io.to(e.room).emit('message-deleted', e.payload);
      });

      await Message.deleteMany({ _id: { $in: messageIds } });
      console.log(`Deleted ${messageIds.length} expired messages successfully ✔`);
    } catch (error) {
      console.error('Error deleting expired messages:', error);
    }
  });
};