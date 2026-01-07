const { db } = require('../models');
const User = db.User;
const Message = db.Message;
const MessageStatus = db.MessageStatus;
const MessageReaction = db.MessageReaction;
const MessageAction = db.MessageAction;
const Group = db.Group;
const GroupMember = db.GroupMember;
const ChatSetting = db.ChatSetting;
const Block = db.Block;
const Setting = db.Setting;
const ChatClear = db.ChatClear;
const UserSetting = db.UserSetting;
const MessageDisappearing = db.MessageDisappearing;
const Broadcast = db.Broadcast;
const BroadcastMember = db.BroadcastMember;
const Status = db.Status;
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function formatMessageForDisplay(message, currentUserId) {
  let metadata = message.metadata || {};

  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (e) {
      metadata = {};
    }
  }

  if (message.message_type === 'system' && metadata.system_action === 'block_status_change') {
    if (metadata.visible_to?.toString() !== currentUserId.toString()) {
      return null;
    }
  }

  let content = message.content;

  if (message.message_type === 'system' && metadata) {
    if (metadata.action === 'pin' && metadata.pinned_by) {
      content = metadata.pinned_by.toString() === currentUserId.toString()
        ? 'You pinned a message'
        : `${message.sender?.name || 'Someone'} pinned a message`;
    } else if (metadata.system_action === 'member_left' && metadata.user_id?.toString() === currentUserId.toString()) {
      content = 'You left the group';
    } else if (metadata.system_action === 'group_created' && metadata.creator_user_id?.toString() === currentUserId.toString()) {
      content = 'You created this group.';
    }
  } else if (
    message.sender_id?.toString() === currentUserId.toString() &&
    message.group_id &&
    message.message_type === 'system'
  ) {
    const displayName = message.sender_id.toString() === currentUserId.toString() ? 'You' : message.sender?.name;
    content = content.replace(message.sender?.name || '', displayName);
  }

  const actions = (message.actions || []).map(a => {
    if (typeof a.details === 'string') {
      try {
        a.details = JSON.parse(a.details);
      } catch {}
    }
    return a;
  });

  const deleteForMe = actions.find(
    a => a.user_id.toString() === currentUserId.toString() && a.action_type === 'delete' && a.details?.type === 'me' && !a.details?.is_broadcast_view
  );

  const deleteForEveryone = actions.find(a => a.action_type === 'delete' && a.details?.type === 'everyone');  

  if(deleteForEveryone){
    content = 'This message was deleted.';
  }
  const isStarred = actions.some(a => a.user_id.toString() === currentUserId.toString() && a.action_type === 'star');

  if (deleteForMe) return null;

  if ( message.disappearing?.enabled && (message.disappearing.expire_at ||  message.disappearing?.metadata?.immediate_disappear)) {
    const expireTime = new Date(message.disappearing.expire_at);
    const now = new Date();
    if (expireTime <= now) return null;
  }

  const isEdited = actions.some(a => a.action_type === 'edit');
  const isForwarded = actions.some(a => a.action_type === 'forward');

  const reactionCounts = await getMessageReactionCount(message.id, currentUserId);
  const formattedReactions = reactionCounts.map(reaction => ({
    emoji: reaction.emoji,
    count: reaction.count,
    userReacted: reaction.userReacted,
    users: reaction.users || [],
  }));

  const isAnnouncement = message.message_type === 'announcement';
  const messageType = isAnnouncement && message.file_url ? 'image' : message.message_type;

  // Handle status reply expiry
  if (metadata && (metadata.is_status_reply === true || metadata.is_status_reply === 'true')) {
    const status = await Status.findById(metadata.status_id);
    const expiresAt = status?.expires_at;
    const now = new Date();
    const isExpired = expiresAt ? new Date(expiresAt) < now : false;
    
    if (isExpired || !status) {
      metadata.status_file_url = null;
    }
  }

  return {
    id: message.id,
    content,
    default_content: metadata?.default_content || null,
    message_type: messageType,
    parent_id: message.parent?.id || null,
    file_url: message.file_url,
    created_at: message.created_at,
    recipient_id: message.recipient_id,
    sender: message.sender || null,
    recipient: message.recipient || null,
    statuses: message.statuses || [],
    reactions: formattedReactions,
    mentions: message.mentions || null,
    has_unread_mentions: message.has_unread_mentions || false,
    parentMessage: message.parent || null,
    metadata,
    isDeleted: !!deleteForEveryone,
    isDeletedForEveryone: !!deleteForEveryone,
    deletedBy: deleteForEveryone?.details?.deleted_by || null,
    isEdited,
    isForwarded,
    isStarred,
    isPinned: !!message.pin,
    isAnnouncement : isForwarded ? false : isAnnouncement,
    pinInfo: message.pin
      ? {
          id: message.pin.id,
          pinned_until: message.pin.pinned_until,
          pinner: message.pin.pinner || null,
        }
      : null,
    isBroadcast: metadata?.is_broadcast === true || metadata?.is_broadcast === 'true',
    broadcastId: metadata?.broadcast_id || null,
  };
}

function isMessageTimeGapLarge(earlierTime, laterTime, thresholdMinutes = 5) {
  if (!earlierTime || !laterTime) return true;
  const diffMinutes = Math.abs((new Date(laterTime) - new Date(earlierTime)) / (1000 * 60));
  return diffMinutes > thresholdMinutes;
}

async function groupMessagesBySender(messages, currentUserId) {
  if (!messages || messages.length === 0) return [];

  messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const grouped = [];
  let currentGroup = null;

  for (const message of messages) {
    const formattedMsg = await formatMessageForDisplay(message, currentUserId);
    if (!formattedMsg) continue;

    const shouldStartNewGroup =
      !currentGroup ||
      currentGroup.sender_id.toString() !== message.sender_id.toString() ||
      isMessageTimeGapLarge(currentGroup.lastMessageTime, message.created_at);

    if (shouldStartNewGroup) {
      if (currentGroup && currentGroup.messages.length > 0) {
        grouped.push(currentGroup);
      }

      currentGroup = {
        sender_id: message.sender_id,
        sender: message.sender
          ? { id: message.sender.id, name: message.sender.name, avatar: message.sender.avatar }
          : null,
        recipient: message.recipient
          ? { id: message.recipient.id, name: message.recipient.name, avatar: message.recipient.avatar }
          : null,
        messages: [formattedMsg],
        created_at: message.created_at,
        lastMessageTime: message.created_at,
        groupId: `group_${message.sender_id}_${message.recipient_id || ''}_${Date.now()}`,
      };
    } else {
      currentGroup.messages.push(formattedMsg);
      currentGroup.lastMessageTime = message.created_at;
    }
  }

  if (currentGroup && currentGroup.messages.length > 0) {
    grouped.push(currentGroup);
  }

  return grouped;
}

function formatDateLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const messageDate = new Date(date);
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  const msgDate = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());

  if (msgDate.getTime() === todayDate.getTime()) return 'Today';
  if (msgDate.getTime() === yesterdayDate.getTime()) return 'Yesterday';

  const daysDiff = Math.floor((todayDate - msgDate) / (1000 * 60 * 60 * 24));
  if (daysDiff <= 6 && daysDiff > 1) {
    return messageDate.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return messageDate.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function groupMessagesByDate(messageGroups) {
  if (!messageGroups || messageGroups.length === 0) return [];

  const dateGroups = {};

  messageGroups.forEach(group => {
    if (!group.created_at) return;
    const dateKey = new Date(group.created_at).toISOString().split('T')[0];
    if (!dateGroups[dateKey]) {
      dateGroups[dateKey] = {
        dateLabel: formatDateLabel(group.created_at),
        dateKey,
        messageGroups: [],
      };
    }
    dateGroups[dateKey].messageGroups.push(group);
  });

  return Object.values(dateGroups).sort((a, b) => new Date(a.dateKey) - new Date(b.dateKey));
}

function getFileTypeFromMime(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';
  return 'file';
}

function getDefaultContentForFileType(fileType) {
  const defaults = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎤 Voice message',
    file: '📎 File',
  };
  return defaults[fileType] || '📎 File';
}

async function getMessageReactionCount(messageId, currentUserId) {
  try {
    const reactions = await MessageReaction.aggregate([
      { $match: { message_id: new mongoose.Types.ObjectId(messageId) } },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user_doc' }},
      { $unwind: { path: '$user_doc', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$emoji',
          emoji: { $first: '$emoji' },
          count: { $sum: 1 },
          users: { $push: { id: '$user_doc._id', name: '$user_doc.name', avatar: '$user_doc.avatar' }},
          userReacted: {
            $max: { $cond: [ { $eq: ['$user_id', new mongoose.Types.ObjectId(currentUserId)] }, true, false ]},
          },
        },
      },
      { $project: { _id: 0, emoji: 1, count: 1, users: 1, userReacted: 1 }},
    ]);

    return reactions;
  } catch (error) {
    console.error('Error in getMessageReactionCount:', error);
    return [];
  }
}

async function getUserDocuments(userId, { search = '', page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const groupIds = await GroupMember.find({ user_id: userObjectId }).distinct('group_id');
  const orConditions = [{ sender_id: userObjectId },{ recipient_id: userObjectId }];

  if (groupIds.length > 0) {
    orConditions.push({ group_id: { $in: groupIds } });
  }

  const match = { deleted_at: null, message_type: { $in: ['file', 'audio', 'video', 'image'] }, $or: orConditions };
  
  if (search) {
    match['metadata.original_filename'] = { $regex: search, $options: 'i', };
  }

  const dataPipeline = [
    { $match: match },
    { $sort: { created_at: -1 } },
    { $skip: offset },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender' }},
    { $unwind: { path: '$sender', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient' }},
    { $unwind: { path: '$recipient', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group' }},
    { $unwind: { path: '$group', preserveNullAndEmptyArrays: true } },
  ];
  
  const countPipeline = [ { $match: match }, { $count: 'total' }];

  const [docs, countResult] = await Promise.all([
    Message.aggregate(dataPipeline),
    Message.aggregate(countPipeline),
  ]);

  const totalCount = countResult[0]?.total || 0;

  const formattedDocs = docs.map(doc => {
    let metadata = doc.metadata || {};
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch {}
    }

    return {
      id: doc._id,
      file_name: metadata.original_filename || 'Untitled',
      file_url: doc.file_url,
      file_type: doc.file_type || metadata.mime_type,
      file_size: metadata.file_size,
      message_type: doc.message_type,
      created_at: doc.created_at,
      sender: doc.sender ? { id: doc.sender._id, name: doc.sender.name } : null,
      recipient: doc.recipient ? { id: doc.recipient._id, name: doc.recipient.name } : null,
      group: doc.group ? { id: doc.group._id, name: doc.group.name } : null,
    };
  });

  const grouped = {};
  formattedDocs.forEach(doc => {
    const label = formatDateLabel(doc.created_at);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(doc);
  });

  const documents = Object.entries(grouped).map(([label, items]) => ({ dateLabel: label, documents: items }));

  const totalPages = Math.ceil(totalCount / limit);

  return {
    documents,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

function getConversationKey(message) {
  return message.group_id
    ? `group_${message.group_id}`
    : `dm_${Math.min(message.sender_id, message.recipient_id)}_${Math.max(message.sender_id, message.recipient_id)}`;
}

async function findNewPrevMessage(message, excludedIds) {
  const match = message.group_id
    ? { group_id: message.group_id, _id: { $nin: excludedIds } }
    : {
        $or: [
          { sender_id: message.sender_id, recipient_id: message.recipient_id },
          { sender_id: message.recipient_id, recipient_id: message.sender_id },
        ],
        _id: { $nin: excludedIds },
      };

  return await Message.findOne(match).sort({ created_at: -1 }).lean({ virtuals: true });
}

async function getConversationData(messages, excludedIds) {
  const newPrevMessagesMap = new Map();
  const processed = new Set();

  for (const message of messages) {
    const key = getConversationKey(message);
    if (!processed.has(key)) {
      const prev = await findNewPrevMessage(message, excludedIds);
      newPrevMessagesMap.set(key, prev);
      processed.add(key);
    }
  }

  return { newPrevMessagesMap };
}

async function processDeleteForMe(userId, messages, newPrevMessagesMap, deleteActions, socketEvents) {
  for (const message of messages) {
    const existing = await MessageAction.findOne({
      message_id: message._id,
      user_id: userId,
      action_type: 'delete',
    });

    if (!existing) {
      deleteActions.push({
        message_id: message._id,
        user_id: userId,
        action_type: 'delete',
        details: {
          type: 'me',
          deleted_by: userId,
          original_sender_id: message.sender_id,
        },
      });
    }

    const payload = await createSocketPayload(message, userId, newPrevMessagesMap, 'delete-for-me');
    socketEvents.push({ room: `user_${userId}`, payload });
  }
}

async function processDeleteForEveryone(userId, userMessages, otherMessages, newPrevMessagesMap, deleteActions, socketEvents) {
  for (const message of userMessages) {
    const targetUsers = await getTargetUsers(message);

    for (const targetUserId of targetUsers) {
      const existing = await MessageAction.findOne({
        message_id: message._id,
        user_id: targetUserId,
        action_type: 'delete',
      });

      if (!existing) {
        deleteActions.push({
          message_id: message._id,
          user_id: targetUserId,
          action_type: 'delete',
          details: {
            type: 'everyone',
            deleted_by: userId,
            original_sender_id: message.sender_id,
          },
        });
      }

      const payload = await createSocketPayload(message, targetUserId, newPrevMessagesMap, 'delete-for-everyone');
      socketEvents.push({ room: `user_${targetUserId}`, payload });
    }
  }

  for (const message of otherMessages) {
    const existing = await MessageAction.findOne({
      message_id: message._id,
      user_id: userId,
      action_type: 'delete',
    });

    if (!existing) {
      deleteActions.push({
        message_id: message._id,
        user_id: userId,
        action_type: 'delete',
        details: {
          type: 'me',
          deleted_by: userId,
          original_sender_id: message.sender_id,
        },
      });
    }

    const payload = await createSocketPayload(message, userId, newPrevMessagesMap, 'delete-for-me');
    socketEvents.push({ room: `user_${userId}`, payload });
  }
}

async function getTargetUsers(message) {
  if (message.group_id) {
    const members = await GroupMember.find({ group_id: message.group_id }).select('user_id').lean();
    return members.map(m => m.user_id);
  }
  return [message.sender_id, message.recipient_id].filter(Boolean);
}

async function createSocketPayload(message, targetUserId, newPrevMessagesMap, deleteType, wasUnreadOverride = undefined) {
  const key = getConversationKey(message);
  const newPrevMessageRaw = newPrevMessagesMap.get(key) || null;

  // Clean newPrevMessage — only include necessary fields and convert IDs to strings
  const newPrevMessage = newPrevMessageRaw
    ? {
        id: newPrevMessageRaw.id || newPrevMessageRaw._id.toString(),
        sender_id: newPrevMessageRaw.sender_id.toString(),
        recipient_id: newPrevMessageRaw.recipient_id ? newPrevMessageRaw.recipient_id.toString() : null,
        group_id: newPrevMessageRaw.group_id ? newPrevMessageRaw.group_id.toString() : null,
        parent_id: newPrevMessageRaw.parent_id || null,
        content: newPrevMessageRaw.content || '',
        message_type: newPrevMessageRaw.message_type || 'text',
        file_url: newPrevMessageRaw.file_url || null,
        file_type: newPrevMessageRaw.file_type || null,
        mentions: newPrevMessageRaw.mentions || [],
        has_unread_mentions: newPrevMessageRaw.has_unread_mentions || false,
        metadata: newPrevMessageRaw.metadata || null,
        is_encrypted: !!newPrevMessageRaw.is_encrypted,
        created_at: newPrevMessageRaw.created_at,
        updated_at: newPrevMessageRaw.updated_at,
        deleted_at: newPrevMessageRaw.deleted_at || null,
      }
    : null;

  // Determine if the deleted message was unread for the target user
  let wasUnread = wasUnreadOverride;
  if (wasUnread === undefined) {
    const status = await MessageStatus.findOne({
      message_id: message._id,
      user_id: targetUserId,
    }).lean();

    wasUnread = status ? status.status !== 'seen' : false;
  }

  // Basic mention tracking (you can enhance this later if needed)
  const hasUnreadMentions = message.has_unread_mentions || false;

  // Minimal info about the deleted message
  const deletedMessage = {
    sender_id: message.sender_id.toString(),
    recipient_id: message.recipient_id ? message.recipient_id.toString() : null,
    group_id: message.group_id ? message.group_id.toString() : null,
  };

  // Base payload
  const payload = {
    messageId: message.id || message._id.toString(),
    newPrevMessage,
    deleteType, // 'delete-for-me' or 'delete-for-everyone'
    wasUnread,
    hasUnreadMentions,
    deletedMessage,
    created_at: message.created_at,
  };

  // Add context-specific fields
  if (message.group_id) {
    payload.group_id = message.group_id.toString();
  } else {
    // Direct message
    payload.sender_id = message.sender_id.toString();
    payload.recipient_id = message.recipient_id.toString();
  }

  return payload;
}

async function deleteMessageFiles(messages) {
  const promises = messages
    .filter(m => m.file_url)
    .map(m => {
      return new Promise(resolve => {
        const filePath = path.join(process.cwd(), m.file_url);
        fs.unlink(filePath, err => {
          if (err) console.log(`Failed to delete file: ${filePath}`, err);
          else console.log(`File deleted: ${filePath}`);
          resolve();
        });
      });
    });

  await Promise.all(promises);
}

async function buildMessagePayloads({ content, message_type, metadata, files, singleFile, file_url, parent_id }) {
  const payloads = [];

  if (files?.length) {
    files.forEach((file, index) => {
      const fileType = getFileTypeFromMime(file.mimetype);
      payloads.push({
        content: content || null,
        message_type: fileType,
        file_url: file.path,
        file_type: file.mimetype,
        parent_id,
        metadata: {
          original_filename: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          is_multiple: true,
          file_index: index,
          default_content: content ? null : getDefaultContentForFileType(fileType),
          ...(typeof metadata === 'string' ? JSON.parse(metadata) : metadata || {}),
        },
      });
    });
    return payloads;
  }

  if (singleFile) {
    const fileType = getFileTypeFromMime(singleFile.mimetype);
    payloads.push({
      content: content || null,
      message_type: fileType,
      file_url: singleFile.path,
      file_type: singleFile.mimetype,
      parent_id,
      metadata: {
        original_filename: singleFile.originalname,
        file_size: singleFile.size,
        mime_type: singleFile.mimetype,
        default_content: content ? null : getDefaultContentForFileType(fileType),
        ...(typeof metadata === 'string' ? JSON.parse(metadata) : metadata || {}),
      },
    });
    return payloads;
  }

  if (message_type === 'sticker') {
    payloads.push({
      content: content || 'Sticker',
      message_type: 'sticker',
      file_url,
      file_type: 'sticker',
      metadata,
      parent_id,
    });
    return payloads;
  }

  if (message_type === 'location') {
    let locationMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata || {};
    payloads.push({
      content: locationMetadata.address || 'Location',
      message_type: 'location',
      metadata: locationMetadata,
      parent_id,
    });
    return payloads;
  }

  payloads.push({ content, message_type, metadata: metadata || null, parent_id });
  return payloads;
}

async function createMessageWithStatus({ senderId, recipientId, groupId, payload, mentions, isEncrypted, isBlocked }) {
  const message = await Message.create({
    sender_id: senderId,
    recipient_id: recipientId || null,
    group_id: groupId || null,
    ...payload,
    mentions: mentions || [],
    is_encrypted: isEncrypted,
  });

  // Handle disappearing messages
  let chatSetting = null;
  if (recipientId) {
    chatSetting = await ChatSetting.findOne({
      $or: [
        { user_id: senderId, recipient_id: recipientId },
        { user_id: recipientId, recipient_id: senderId },
      ],
    });
  } else if (groupId) {
    chatSetting = await ChatSetting.findOne({ group_id: groupId });
  }

  if (chatSetting?.disappearing_enabled) {
    await MessageDisappearing.create({
      message_id: message._id,
      enabled: true,
      expire_after_seconds: chatSetting.expire_after_seconds,
      expire_at: null,
    });
  }

  if (recipientId) {
    await MessageStatus.create({
      message_id: message._id,
      user_id: recipientId,
      status: isBlocked ? 'blocked' : 'sent',
    });
  }

  return message;
}

function groupBroadcastMessages(messages, currentUserId) {
  const map = new Map();

  for (const msg of messages) {
    const actions = msg.actions || [];

    const deletedForMe = actions.some(a =>
      a.user_id?.toString() === currentUserId.toString() &&
      a.action_type === 'delete' &&
      a.details?.type === 'me'
    );

    const deletedForEveryone = actions.some(a =>
      a.action_type === 'delete' &&
      a.details?.type === 'everyone'
    );

    if (deletedForMe && !deletedForEveryone) continue;

    const key = [
      msg.metadata?.broadcast_id,
      msg.message_type,
      msg.file_url || '',
      msg.metadata?.file_index ?? '',
      msg.content || ''
    ].join('|');

    if (!map.has(key)) {
      map.set(key, {
        ...msg,
        recipients: [],
        statuses: [],
        isDeleted: deletedForEveryone,
        isDeletedForEveryone: deletedForEveryone,
      });
    }

    const entry = map.get(key);

    if (msg.recipient) entry.recipients.push(msg.recipient);
    if (msg.statuses?.length) entry.statuses.push(...msg.statuses);
  }

  return Array.from(map.values());
}

async function handleBroadcastDeletion({ userId, messages, isBroadcast, messageIds, deleteType, broadcastId, io, res }) {
  try {
    const broadcast = await Broadcast.findOne({ _id: broadcastId, creator_id: userId }).lean();
    if (!broadcast) {
      return res.status(403).json({ message: 'Broadcast not found or unauthorized' });
    }

    const recipientEntries = await BroadcastMember.find({ broadcast_id: broadcastId }).lean();
    const recipientIds = recipientEntries.map(r => r.recipient_id.toString());

    if (recipientIds.length === 0) {
      return res.status(400).json({ message: 'No recipients found for this broadcast' });
    }

    const broadcastMessages = await Message.find({
      sender_id: userId,
      recipient_id: { $in: recipientIds.map(id => new mongoose.Types.ObjectId(id)) },
      'metadata.is_broadcast': true,
      'metadata.broadcast_id': broadcastId.toString(),
    }).lean();

    const messagesToDelete = broadcastMessages.filter(msg => 
      messages.some(original => 
        original.content === msg.content &&
        original.file_url === msg.file_url &&
        Math.abs(new Date(original.created_at).getTime() - new Date(msg.created_at).getTime()) < 1000 // 1 second tolerance
      )
    );

    if (messagesToDelete.length === 0) {
      return res.status(404).json({ message: 'No matching broadcast messages found' });
    }

    const deleteActions = [];
    const socketEvents = [];

    if (deleteType === 'delete-for-me') {
      for (const msg of messagesToDelete) {
        const existing = await MessageAction.findOne({
          message_id: msg._id,
          user_id: userId,
          action_type: 'delete',
        });

        if (!existing) {
          deleteActions.push({
            message_id: msg._id,
            user_id: userId,
            action_type: 'delete',
            details: {
              type: 'me',
              deleted_by: userId,
              is_broadcast: true,
              is_broadcast_view: true,
              broadcast_id: broadcastId,
            },
          });
        }
      }

      socketEvents.push({
        room: `user_${userId}`,
        payload: {
          messageIds: messagesToDelete.map(m => m._id.toString()),
          deleteType: 'delete-for-me',
          isBroadcast: true,
          broadcastId,
        },
      });
    } else if (deleteType === 'delete-for-everyone') {
      const allAffectedUsers = [userId, ...recipientIds.map(id => id.toString())];

      for (const msg of messagesToDelete) {
        for (const targetUserId of allAffectedUsers) {
          const existing = await MessageAction.findOne({
            message_id: msg._id,
            user_id: targetUserId,
            action_type: 'delete',
          });

          if (!existing) {
            deleteActions.push({
              message_id: msg._id,
              user_id: targetUserId,
              action_type: 'delete',
              details: {
                type: 'everyone',
                deleted_by: userId,
                is_broadcast: true,
                broadcast_id: broadcastId,
              },
            });
          }
        }
      }

      // Emit to all affected users
      for (const uid of allAffectedUsers) {
        socketEvents.push({
          room: `user_${uid}`,
          payload: {
            messageIds: messagesToDelete.map(m => m._id.toString()),
            deleteType: 'delete-for-everyone',
            isBroadcast: true,
            broadcastId,
            deletedBy: userId,
          },
        });
      }

      await deleteMessageFiles(messagesToDelete);
    }

    // Execute all actions and socket emits
    await Promise.all([
      deleteActions.length > 0 ? MessageAction.insertMany(deleteActions) : Promise.resolve(),
      ...socketEvents.map(event => io.to(event.room).emit('message-deleted', event.payload)),
    ]);

    return res.status(200).json({
      message: 'Broadcast message deleted successfully.',
      deletedForEveryone: deleteType === 'delete-for-everyone' ? messagesToDelete.length : 0,
      deletedForMe: deleteType === 'delete-for-me' ? messagesToDelete.length : 0,
    });
  } catch (error) {
    console.error('Error in handleBroadcastDeletion:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
}

module.exports = {
  formatMessageForDisplay,
  isMessageTimeGapLarge,
  groupMessagesBySender,
  formatDateLabel,
  groupMessagesByDate,
  getFileTypeFromMime,
  getDefaultContentForFileType,
  getMessageReactionCount,
  getUserDocuments,
  getConversationData,
  getConversationKey,
  findNewPrevMessage,
  processDeleteForMe,
  processDeleteForEveryone,
  getTargetUsers,
  createSocketPayload,
  deleteMessageFiles,
  buildMessagePayloads,
  createMessageWithStatus,
  groupBroadcastMessages,
  handleBroadcastDeletion,
};