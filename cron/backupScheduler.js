const cron = require('node-cron');
const fs = require('fs');
const { GoogleToken, UserSetting} = require('../models');
const { createBackupZip } = require('../services/backupService');
const { uploadFileToDrive } = require('../services/driveService');

function start() {
    cron.schedule('0 2 * * *', async () => {
       try {
        const tokens = await GoogleToken.findAll({ attributes: ['user_id' ]});

        for(const token of tokens) {
            const user_id = token.user_id;

            const userSetting = await UserSetting.findOne({ where: { user_id }, attributes: ['auto_backup']});
            if (!userSetting || !userSetting.auto_backup) {
                console.log(`Skipping user ${user_id}: auto backup is off`);
                continue;
            }

            try {
                const filePath = await createBackupZip(user_id);

                const exists = fs.existsSync(filePath);
                const stats = exists ? fs.statSync(filePath) : null;

                if (!exists || stats.size === 0) {
                    console.error(` ZIP file for user ${user_id} is invalid or empty`);
                    continue;
                }

                await uploadFileToDrive(user_id, filePath);
                console.log(`Backup complete for user ${user_id}`);
                
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(` Chat backup failed for user ${user_id}:`, error.message);
            }
        }
       } catch (error) {
        console.error('Error in scheduler:', error.message);
       } 
    },{
        timezone: 'Asia/Kolkata'
    });
};

module.exports = { start }