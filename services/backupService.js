'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const {Message, User, UserSetting, ChatClear, Group, GroupMember} = require('../models');
const {Op} = require('sequelize');
const { groupMessagesByChat, formatChatText } = require('../helper/backupHelpers');

async function createBackupZip(userId) {
    try {
        const userSetting = await UserSetting.findOne({ where: { user_id: userId }});
        const includeDocs = userSetting?.doc_backup;
        const includeVideo = userSetting?.video_backup;

        const groupIds = await GroupMember.findAll({
            where: { user_id: userId},
            attributes: ['group_id'],
            raw: true
        }).then(rows => rows.map(r => r.group_id));

        const clearedChats = await ChatClear.findAll({ where: { user_id: userId}, raw: true});

        const clearedUserIds = clearedChats.filter(c => c.recipient_id).map(c => c.recipient_id);
        const clearedGroupIds = clearedChats.filter(c => c.group_id).map(c => c.group_id);
        
        const allMessages = await Message.findAll({
            where: {
                [Op.or]: [
                    {
                        [Op.and]: [
                            { [Op.or]: [
                                { sender_id: userId },
                                { recipient_id: userId }
                            ]},
                            { 
                                recipient_id: { 
                                    [Op.notIn]: clearedUserIds.length ? clearedUserIds : [0] 
                                }
                            }
                        ]
                    },
                    {
                        group_id: {
                            [Op.and]: [
                                { [Op.in]: groupIds.length ? groupIds : [0] },
                                { [Op.notIn]: clearedGroupIds.length ? clearedGroupIds : [0] }
                            ]
                        }
                    }
                ]
            },
            order: [['created_at', 'ASC']],
            include: [
                { model: User, as: 'sender', attributes: ['id', 'name', 'email'] },
                { model: User, as: 'recipient', attributes: ['id', 'name', 'email'] },
                { model: Group, as: 'group', attributes: ['id', 'name'] }
            ]
        });
        
        const docMessages = includeDocs ? allMessages.filter(m => m.message_type === 'document' && m.file_url) : [];
        const videoMessages = includeVideo ? allMessages.filter(m => m.message_type === 'video' && m.file_url) : [];
        const textMessages = allMessages.filter(m => m.message_type === 'text');
        const chats = groupMessagesByChat(textMessages, userId);
        const textOutput = formatChatText(chats);

        const ROOT_DIR = path.resolve(__dirname, '..');
        const backupDir = path.resolve(ROOT_DIR, 'uploads/backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const timestamps = Date.now();
        const txtFileName = `Chat_backup_${timestamps}.txt`;
        const txtFilePath = path.join(backupDir, txtFileName);

        const zipFileName = `Chat_backup_${timestamps}.zip`;
        const zipFilePath = path.join(backupDir, zipFileName);

        fs.writeFileSync(txtFilePath, textOutput, 'utf-8');

        await new Promise((resolve,reject) => {
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level:9 }});

            output.on('close',() => {
                console.log('Archive created.');
                fs.unlinkSync(txtFilePath);
                resolve();
            });

            archive.on('error', reject);
            archive.pipe(output);
            archive.file(txtFilePath, { name: txtFileName });

            [...docMessages, ...videoMessages].forEach((msg,index) => {
                const cleanFileUrl = msg.file_url.replace(/^\/?/, '');
                const filePath = path.join(ROOT_DIR, cleanFileUrl);
                const fileName = path.basename(msg.file_url);

                if (fs.existsSync(filePath)) {
                    archive.file(filePath, { name: `${msg.message_type}_${index + 1}_${fileName}` });
                }
            })

            archive.finalize();
        });

        return zipFilePath;
    } catch (error) {
        console.error('Error in createBackupZip:', error);
        throw error;
    }
};

module.exports = { createBackupZip };