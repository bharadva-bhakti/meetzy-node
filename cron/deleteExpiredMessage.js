const cron = require('node-cron');
const { Message, MessageDisappearing, MessageAction } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const { getConversationData, getTargetUsers, createSocketPayload } = require('../helper/messageHelpers');

module.exports.start = (io) => {
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      
      const expiredMessages = await MessageDisappearing.findAll({
        where: { expire_at: {[Op.lte]: now }},
        raw: true
      });

      if (!expiredMessages.length) {
        console.log('No expired messages found.');
        return;
      }

      const messageIds = expiredMessages.map(m => m.message_id);

      const messages = await Message.findAll({
        where: { id: messageIds },
        order: [['created_at', 'DESC']]
      });
  
      if (!messages.length) return;
      
      const { newPrevMessagesMap } =
      await getConversationData(messages, messageIds);

      const deleteActions = [];
      const socketEvents = [];

      for (const message of messages) {
        const targetUsers = await getTargetUsers(message);

        for (const targetUserId of targetUsers) {
          deleteActions.push({
            message_id: message.id,
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

      await MessageAction.bulkCreate(deleteActions, { ignoreDuplicates: true });
  
      socketEvents.forEach(e => {
        io.to(e.room).emit('message-deleted', e.payload);
      });
      
      await Message.destroy({ where: { id: messageIds }, force: true });
      console.log(`Deleted ${messageIds.length} expired messages successfully ✔`);
    } catch (error) {
      console.error('Error deleting expired messages:', error);
    }
  });
};