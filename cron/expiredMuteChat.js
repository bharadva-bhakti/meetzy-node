const cron = require('node-cron');
const { MutedChat } = require('../models');
const { Op } = require('sequelize');

async function expiredMuteChat(io) {
    const now = new Date();

    try {
        const expiredMutes = await MutedChat.findAll({
            where: {
                muted_until: { [Op.ne]: null, [Op.lte]: now }
            }
        });

        if (expiredMutes.length > 0) {
            await MutedChat.destroy({
                where: {
                    id: {[Op.in]: expiredMutes.map(mute => mute.id)}
                }
            });

            for (const mute of expiredMutes) {
                io.to(`user_${mute.user_id}`).emit('chat_unmuted', {
                    userId: mute.user_id,
                    targetId: mute.target_id,
                    targetType: mute.target_type
                });
            }
        }
        
        console.log(`Expired ${expiredMutes.length} muted chat records`);
    } catch (error) {
        console.error('Error expiring muted chats:', error);
    }
};

module.exports = (io) => {
    cron.schedule('* * * * *', async () => {
        await expiredMuteChat(io);
    });
};