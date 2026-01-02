'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { db } = require('../models');
const Message = db.Message;
const User = db.User;
const UserSetting = db.UserSetting;
const ChatClear = db.ChatClear;
const GroupMember = db.GroupMember;
const Group = db.Group;

const { groupMessagesByChat, formatChatText } = require('../helper/backupHelpers');

async function createBackupZip(userId) {
  try {
    const userSetting = await UserSetting.findOne({ user_id: userId }).lean();
    const includeDocs = userSetting?.doc_backup;
    const includeVideo = userSetting?.video_backup;

    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(gm => gm.group_id);

    const clearedChats = await ChatClear.find({ user_id: userId }).lean();
    const clearedUserIds = clearedChats.filter(c => c.recipient_id).map(c => c.recipient_id);
    const clearedGroupIds = clearedChats.filter(c => c.group_id).map(c => c.group_id);

    const allMessages = await Message.find({
      $or: [
        {
          $and: [
            { $or: [{ sender_id: userId }, { recipient_id: userId }] },
            { recipient_id: { $nin: clearedUserIds.length ? clearedUserIds : [null] }}
          ]
        },
        {
          group_id: {
            $in: groupIds.length ? groupIds : [null],
            $nin: clearedGroupIds.length ? clearedGroupIds : [null]
          }
        }
      ]
    }).sort({ created_at: 1 })
    .populate({ path: 'sender_id', select: 'id name email' })
    .populate({ path: 'recipient_id', select: 'id name email' })
    .populate({ path: 'group_id', select: 'id name' }).lean();

    const docMessages = includeDocs ? allMessages.filter(m => m.message_type === 'document' && m.file_url) : [];
    const videoMessages = includeVideo ? allMessages.filter(m => m.message_type === 'video' && m.file_url) : [];
    const textMessages = allMessages.filter(m => m.message_type === 'text');

    const chats = groupMessagesByChat(textMessages, userId.toString());
    const textOutput = formatChatText(chats, userId.toString());

    const ROOT_DIR = path.resolve(__dirname, '..');
    const backupDir = path.resolve(ROOT_DIR, 'uploads/backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = Date.now();
    const txtFileName = `Chat_backup_${timestamp}.txt`;
    const txtFilePath = path.join(backupDir, txtFileName);

    const zipFileName = `Chat_backup_${timestamp}.zip`;
    const zipFilePath = path.join(backupDir, zipFileName);

    fs.writeFileSync(txtFilePath, textOutput, 'utf-8');

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log('Archive created.');
        fs.unlinkSync(txtFilePath);
        resolve();
      });

      archive.on('error', reject);
      archive.pipe(output);
      archive.file(txtFilePath, { name: txtFileName });

      [...docMessages, ...videoMessages].forEach((msg, index) => {
        const cleanFileUrl = msg.file_url.replace(/^\/?/, '');
        const filePath = path.join(ROOT_DIR, cleanFileUrl);
        const fileName = path.basename(msg.file_url);

        if (fs.existsSync(filePath)) {
          archive.file(filePath, { name: `${msg.message_type}_${index + 1}_${fileName}` });
        }
      });

      archive.finalize();
    });

    return zipFilePath;
  } catch (error) {
    console.error('Error in createBackupZip:', error);
    throw error;
  }
}

module.exports = { createBackupZip };