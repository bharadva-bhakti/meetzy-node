const cron = require('node-cron');
const { Status } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

function start() {
    cron.schedule('0 * * * *', async () => {
        const now = new Date();

        try {
            const expired = await Status.findAll({ 
                where: { 
                    expires_at: {[Op.lte]: now }, 
                    sponsored: false 
                } 
            });
    
            for(const s of expired){
                if(s.file_url) {
                    const filePath = path.join(__dirname, '../', s.file_url);
                    fs.unlink(filePath, err => {
                        if(err && err.code !== 'ENOENT') console.error(err);
                    });
                }
        
                await s.destroy();
            }

            console.log(`Deleted ${expired.length} expired statuses.`);
            
        } catch (error) {
            console.error('Error deleting expired statuses:', error);
        }
        
    });
};

module.exports = { start };