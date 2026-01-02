const cron = require('node-cron');
const { db } = require('../models');
const MutedChat = db.MutedChat;

async function expiredMuteChat(io) {
  const now = new Date();

  try {
    const expiredMutes = await MutedChat.find({
      muted_until: { $ne: null, $lte: now }
    }).lean();

    if (expiredMutes.length > 0) {
      const ids = expiredMutes.map(m => m._id);
      await MutedChat.deleteMany({ _id: { $in: ids } });

      for (const mute of expiredMutes) {
        io.to(`user_${mute.user_id}`).emit('chat_unmuted', {
          userId: mute.user_id.toString(),
          targetId: mute.target_id.toString(),
          targetType: mute.target_type
        });
      }
    }

    console.log(`Expired ${expiredMutes.length} muted chat records`);
  } catch (error) {
    console.error('Error expiring muted chats:', error);
  }
}

module.exports = (io) => {
  cron.schedule('* * * * *', async () => {
    await expiredMuteChat(io);
  });
};