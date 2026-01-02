const cron = require('node-cron');
const { db } = require('../models');
const MessagePin = db.MessagePin;
const Message = db.Message;

async function expiredPinMessages(io) {
  const now = new Date();

  try {
    const expiredPins = await MessagePin.find({
      pinned_until: { $ne: null, $lte: now }
    }).lean();

    if (expiredPins.length === 0) {
      console.log('No expired pin records found.');
      return;
    }

    const expiredIds = expiredPins.map(p => p._id);
    await MessagePin.deleteMany({ _id: { $in: expiredIds } });

    for (const pin of expiredPins) {
      const message = await Message.findById(pin.message_id).lean();
      if (!message) continue;

      const payload = { message_id: pin.message_id.toString(), isPinned: false };

      if (message.group_id) {
        io.to(`group_${message.group_id}`).emit('message-pin', payload);
      } else {
        io.to(`user_${message.sender_id}`).emit('message-pin', payload);
        io.to(`user_${message.recipient_id}`).emit('message-pin', payload);
      }
    }

    console.log(`Expired & removed ${expiredPins.length} pinned messages.`);
  } catch (error) {
    console.error('Error in expiredPinMessages:', error);
  }
}

module.exports = (io) => {
  cron.schedule('* * * * *', async () => {
    await expiredPinMessages(io);
  });
};