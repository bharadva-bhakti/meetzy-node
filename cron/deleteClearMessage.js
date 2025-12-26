const cron = require('node-cron');
const { sequelize, Message } = require('../models');
const { Op } = require('sequelize');

exports.deleteClearedMessages = () => {
    cron.schedule('0 * * * *', async () => {
        console.log('Running auto cleanup...');
        
        try {
            await Message.destroy({
                where: {
                    id: {
                        [Op.in]: sequelize.literal(`
                            (SELECT message_id FROM message_actions WHERE 
                            action_type='delete' AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.type')) = 'everyone')
                        `)
                    }
                },
                force: true
            });
    
            await sequelize.query(`
                DELETE FROM messages
                WHERE recipient_id IS NOT NULL
                AND deleted_at IS NULL
                AND created_at <= (
                    SELECT MIN(cleared_at)
                    FROM chat_clears cc
                    WHERE (cc.user_id = messages.sender_id AND cc.recipient_id = messages.recipient_id)
                    OR (cc.user_id = messages.recipient_id AND cc.recipient_id = messages.sender_id)
                );
            `);
    
            await sequelize.query(`
                DELETE FROM messages WHERE group_id IS NOT NULL
                AND deleted_at IS NULL
                AND created_at <= (
                    SELECT MIN(cleared_at) FROM chat_clears cc
                    WHERE cc.group_id = messages.group_id
                );
            `);
    
            console.log('Cleanup done.');
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    });
};