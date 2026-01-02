const { format, isToday, isYesterday } = require('date-fns');

function groupMessagesByChat(messages, userId) {
  const chats = {};

  for (const msg of messages) {
    const isGroup = !!msg.group_id;
    const chatKey = isGroup ? `group_${msg.group_id}` : [msg.sender_id, msg.recipient_id].sort().join('_');

    if (!chats[chatKey]) {
      chats[chatKey] = {
        type: isGroup ? 'group' : 'private',
        title: isGroup
          ? `Group Chat: ${msg.group?.name || 'Unnamed Group'}`
          : `Chat between ${
              msg.sender_id.toString() === userId.toString() ? msg.sender?.name : msg.recipient?.name
            } and ${msg.sender_id.toString() === userId.toString() ? msg.recipient?.name : msg.sender?.name}`,
        messages: [],
      };
    }
    chats[chatKey].messages.push(msg);
  }

  for (const chat of Object.values(chats)) {
    chat.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  return chats;
}

function formatChatText(chats, userId) {
  const lines = [];

  lines.push('====== 💾 Chat Backup ======');
  lines.push(`Exported on: ${format(new Date(), 'dd MMM yyyy, hh:mm a')}`);
  lines.push('\n');

  let totalChats = 0;
  let totalMessages = 0;

  for (const chat of Object.values(chats)) {
    totalChats++;
    const totalCount = chat.messages.length;
    totalMessages += totalCount;

    lines.push('───────────────────────────────────────');
    lines.push(`📂 ${chat.title}`);
    lines.push(`Total messages: ${totalCount}`);
    lines.push('─────────────────────────────────────');

    let currentDate = '';
    let lastTime = '';

    for (const msg of chat.messages) {
      const msgDate = new Date(msg.created_at);
      let dateLabel = format(msgDate, 'dd MMM yyyy');

      if (isToday(msgDate)) dateLabel = 'Today';
      else if (isYesterday(msgDate)) dateLabel = 'Yesterday';

      if (dateLabel !== currentDate) {
        currentDate = dateLabel;
        lines.push('\n');
        lines.push(`${dateLabel}`);
        lines.push('----------------------------------------');
        lastTime = '';
      }

      const msgTime = format(msgDate, 'hh:mm a');
      const isYou = msg.sender_id.toString() === userId.toString();
      const sender = isYou ? 'You' : msg.sender?.name || 'Unknown';
      const content = msg.content?.trim() || '';

      if (msgTime !== lastTime) {
        lines.push(`${msgTime} - ${sender}: ${content}`);
        lastTime = msgTime;
      } else {
        lines.push(`${sender}: ${content}`);
      }
    }

    lines.push('\n');
  }

  lines.push('====== 📊 Backup Summary ======');
  lines.push(`Total Chats: ${totalChats}`);
  lines.push(`Total Messages: ${totalMessages}`);
  lines.push(`Generated on: ${format(new Date(), 'dd MMM yyyy, hh:mm a')}`);

  return lines.join('\n');
}

module.exports = {
  groupMessagesByChat,
  formatChatText,
};