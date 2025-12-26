const { MessagePin, Message} = require('../models');
const { Op } = require('sequelize');
const cron = require('node-cron');

async function expiredPinMessages(io) {
    const now = new Date();

    try {
        const expiredPins = await MessagePin.findAll({
            where: { pinned_until: { [Op.ne]: null, [Op.lte]: now}}
        });

        if (expiredPins.length === 0) {
            console.log('No expired pin records found.');
            return;
        }

        const expiredIds = expiredPins.map(p => p.id);

        await MessagePin.destroy({ where: { id: { [Op.in]: expiredIds }}});

        for (const pin of expiredPins) {
            const message = await Message.findByPk(pin.message_id);
            if (!message) continue;

            const payload = { message_id: pin.message_id, isPinned: false};

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