const { Op } = require('sequelize');
const { User, Message, MessageStatus, Group, GroupMember, MessageReaction, MessageAction, Sequelize, 
  ChatSetting, MessageDisappearing, sequelize, Broadcast, BroadcastMember
} = require('../models');

async function formatMessageForDisplay(message, currentUserId) {
  let metadata = message.metadata;
  
  if (metadata && typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch (e) {
      metadata = {};
    }
  }

  if (message.message_type === 'system' && metadata) {
    if (metadata.system_action === 'block_status_change') {
      if (metadata.visible_to !== currentUserId) {
        return null;
      }
    }
  }

  let content;

  if (message.message_type === 'system' && metadata) {
    const systemAction = metadata.system_action;

    if (metadata.action === 'pin' && metadata.pinned_by) {
      if (metadata.pinned_by === currentUserId) {
        content = 'You pinned a message';
      } else {
        content = `${message.sender?.name || 'Someone'} pinned a message`;
      }
    } else if (systemAction === 'member_left' && metadata.user_id === currentUserId) {
      content = 'You left the group';
    } else if (systemAction === 'group_created' && metadata.creator_user_id === currentUserId) {
      content = 'You created this group.';
    } else {
      content = message.content;
    }
  } else if (message.sender_id === currentUserId && message.group_id && message.message_type === 'system') {
    const displayName = message.sender_id === currentUserId ? 'You' : message.sender.name;
    content = message.content.replace(message.sender.name, displayName);
  } else {
    content = message.content;
  }

  const actions = (message.actions || []).map((a) => {
    if (typeof a.details === 'string') {
      a.details = JSON.parse(a.details);
    }
    return a;
  });
  
  const deleteForMe = actions.find(
    (a) => a.user_id === currentUserId && a.action_type === 'delete' && a.details?.type === 'me' && !a.details?.is_broadcast_view
  );
  
  const deleteForEveryone = actions.find((a) => a.action_type === 'delete' && a.details?.type === 'everyone');

  const isStarred = actions.some((a) => a.user_id === currentUserId && a.action_type === 'star');

  if (deleteForMe) return null;

  if (message.disappearing && 
    message.disappearing.enabled && 
    message.disappearing.expire_after_seconds === null &&
    message.disappearing.expire_at) {
  
    const expireTime = new Date(message.disappearing.expire_at);
    const now = new Date();
    
    if (expireTime <= now) {
      return null;
    }
  }

  const isEdited = actions.some((a) => a.action_type === 'edit');
  const isForwarded = actions.some((a) => a.action_type === 'forward');

  const reactionCounts = await getMessageReactionCount(message.id, currentUserId);
  
  const formattedReactions = reactionCounts ? reactionCounts.map(reaction => ({
    emoji: reaction.emoji,
    count: reaction.count,
    userReacted: reaction.userReacted,
    users: reaction.users?.map(user => ({
      id: user.id, name: user.name, avatar: user.avatar
    })) || []
  })) : [];
  
  const isAnnouncement = message.message_type === 'announcement' ? true : false;
  const messageType = message.message_type === 'announcement' && message.file_url ? 'image' : message.message_type;
  
  const msg = {
    id: message.id,
    content: content,
    default_content: message.metadata?.default_content,
    message_type: messageType,
    parent_id: message.parent_id || null,
    file_url: message.file_url,
    created_at: message.created_at,
    recipient_id: message.recipient_id,
    sender: message.sender || null,
    recipient: message.recipient || null,
    statuses: message.statuses,
    reactions: formattedReactions || null,
    mentions: message.mentions || null,
    has_unread_mentions: message.has_unread_mentions || null,
    parentMessage: message.parent || null,
    metadata: message.metadata,
    isDeleted: !!deleteForEveryone,
    isDeletedForEveryone: !!deleteForEveryone,
    deletedBy: deleteForEveryone?.details?.deleted_by || null,
    isEdited: isEdited,
    isForwarded: isForwarded,
    isStarred: isStarred,
    isPinned: !!message.pin,
    isAnnouncement: isAnnouncement,
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

  return msg;
};

function isMessageTimeGapLarge(earlierTime, laterTime, thresholdMinutes = 5) {
  if (!earlierTime || !laterTime) return true;

  const earlier = new Date(earlierTime);
  const later = new Date(laterTime);

  if (isNaN(earlier.getTime()) || isNaN(later.getTime())) return true;

  const diffMinutes = (later - earlier) / (1000 * 60);
  return Math.abs(diffMinutes) > thresholdMinutes;
};

async function groupMessagesBySender(messages, currentUser) {
  if (!messages || messages.length === 0) return [];

  messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const grouped = [];
  let currentGroup = null;

  for (const message of messages) {
    const formattedMsg = await formatMessageForDisplay(message, currentUser);

    if (!formattedMsg) continue;

    const shouldStartNewGroup = !currentGroup || currentGroup.sender_id !== message.sender_id || (currentGroup.sender_id === message.sender_id && isMessageTimeGapLarge(currentGroup.lastMessageTime, message.created_at));

    if (shouldStartNewGroup) {
      if (currentGroup && currentGroup.messages.length > 0) {
        grouped.push(currentGroup);
      }

      currentGroup = {
        sender_id: message.sender_id,
        sender: message.sender
          ? {
              id: message.sender.id,
              name: message.sender.name,
              avatar: message.sender.avatar,
            }
          : null,
        recipient: message.recipient
          ? {
              id: message.recipient.id,
              name: message.recipient.name,
              avatar: message.recipient.avatar,
            }
          : null,
        messages: [formattedMsg],
        created_at: message.created_at,
        lastMessageTime: message.created_at,
        groupId: `group_${message.sender_id}_${message.recipient_id}_${new Date(message.created_at).getTime()}`,
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
};

function formatDateLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const messageDate = new Date(date);

  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yesterdayDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  const msgDate = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate());

  if (msgDate.getTime() === todayDate.getTime()) {
    return 'Today';
  } else if (msgDate.getTime() === yesterdayDate.getTime()) {
    return 'Yesterday';
  } else {
    const daysDiff = Math.floor((todayDate - msgDate) / (1000 * 60 * 60 * 24));

    if (daysDiff <= 6 && daysDiff > 1) {
      return messageDate.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      return messageDate.toLocaleDateString('en-US', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }
  }
};

function groupMessagesByDate(messageGroups) {
  if (!messageGroups || messageGroups.length === 0) return [];

  const dateGroups = {};

  messageGroups.forEach((group) => {
    if (!group?.created_at) return;
    const messageDate = new Date(group.created_at);
    const dateKey = messageDate?.toISOString()?.split('T')[0];

    if (!dateGroups[dateKey]) {
      dateGroups[dateKey] = {
        dateLabel: formatDateLabel(messageDate),
        dateKey: dateKey,
        messageGroups: [],
      };
    }

    dateGroups[dateKey].messageGroups.push(group);
  });

  return Object.values(dateGroups).sort((a, b) => {
    return new Date(a.dateKey) - new Date(b.dateKey);
  });
};

function getFileTypeFromMime(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('video/')) return 'video';

  return 'file';
};

function getDefaultContentForFileType(fileType) {
  const defaults = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎤 Voice message',
    file: '📎 File',
  };
  return defaults[fileType] || '📎 File';
};

async function getMessageReactionCount(messageId, currentUserId) {
  try {
    const reactions = await MessageReaction.findAll({
      where: { message_id: messageId },
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'avatar'],
        },
      ],
      order: [['created_at', 'ASC']],
      raw: true,
    });

    const reactionGroups = {};

    reactions.forEach((reaction) => {
      if (!reactionGroups[reaction.emoji]) {
        reactionGroups[reaction.emoji] = {
          emoji: reaction.emoji,
          count: 0,
          userReacted: false,
          users: [],
        };
      }

      reactionGroups[reaction.emoji].count++;
      reactionGroups[reaction.emoji].users.push({
        id: reaction['User.id'],
        name: reaction['User.name'],
        avatar: reaction['User.avatar'],
      });

      if (reaction.user_id === currentUserId) {
        reactionGroups[reaction.emoji].userReacted = true;
      }
    });

    return Object.values(reactionGroups).map((group) => ({
      emoji: group.emoji,
      count: group.count,
      userReacted: group.userReacted,
      users: group.users,
    }));
  } catch (error) {
    console.error('Error in getMessageReactionCount:', error);
    return [];
  }
}

async function getUserDocuments(userId, { search = '', page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  const baseWhere = {
    message_type: ['file', 'audio', 'video', 'image'],
    deleted_at: null,
    content: { [Op.ne]: null },
    [Op.or]: [
      { sender_id: userId },
      { recipient_id: userId },
      {
        group_id: {
          [Op.in]: sequelize.literal(`(
            SELECT group_id FROM group_members WHERE user_id = ${userId}
          )`),
        },
      },
    ],
  };

  const excludeCleared = Sequelize.literal(`
    NOT EXISTS (
      SELECT 1 FROM chat_clears cc
      WHERE cc.user_id = ${userId}
      AND (
        (
          cc.recipient_id IS NOT NULL
          AND (
            (cc.recipient_id = Message.sender_id AND Message.recipient_id = ${userId})
            OR (cc.recipient_id = Message.recipient_id AND Message.sender_id = ${userId})
          )
        )
        OR (
          cc.group_id IS NOT NULL
          AND cc.group_id = Message.group_id
        )
      )
      AND Message.created_at <= cc.cleared_at
    )
  `);

  const andConditions = [excludeCleared];
  if (search) {
    andConditions.push(
      sequelize.literal(`
        LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.original_filename'))) LIKE '%${search.toLowerCase()}%'
      `)
    );
  }

  const whereClause = { ...baseWhere, [Op.and]: andConditions };
  const totalCount = await Message.count({ where: whereClause });

  const rows = await Message.findAll({
    where: whereClause,
    include: [
      { model: User, as: 'sender', attributes: ['id', 'name'], required: false },
      { model: User, as: 'recipient', attributes: ['id', 'name'], required: false },
      { model: Group, as: 'group', attributes: ['id', 'name'], required: false },
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset,
    subQuery: false,
    includeIgnoreAttributes: false,
    raw: false,
  });

  const formattedDocs = rows.map((message) => {
    let metadata = message.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (error) {
        console.error('Error parsing metadata:', error);
        metadata = {};
      }
    }

    return {
      id: message.id,
      file_name: metadata?.original_filename || 'Untitled',
      file_url: message.file_url,
      file_type: message.file_type || metadata?.mime_type,
      file_size: metadata?.file_size,
      message_type: message.message_type,
      created_at: message.created_at,
      sender: message.sender,
      recipient: message.recipient,
      group: message.group,
    };
  });

  const grouped = {};
  for (const doc of formattedDocs) {
    const label = formatDateLabel(doc.created_at);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(doc);
  }

  const documents = Object.entries(grouped).map(([label, docs]) => ({
    dateLabel: label,
    documents: docs,
  }));

  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    documents,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore,
    },
  };
}

// Delete message helpers

const hasUnreadMentionsForUser = async (message, targetUserId, deletedMessageHadMentions) => {
  if (!deletedMessageHadMentions) return undefined;

  let countWhere = {
    [Op.not]: { sender_id: targetUserId },
    has_unread_mentions: true,
    id: { [Op.ne]: message.id },
  };

  let includeWhere = {
    user_id: targetUserId,
    status: { [Op.ne]: 'seen' },
  };

  if (message.group_id) {
    countWhere.group_id = message.group_id;
  } else if (message.recipient_id) {
    countWhere = {
      ...countWhere,
      [Op.or]: [
        { sender_id: message.sender_id, recipient_id: message.recipient_id },
        { sender_id: message.recipient_id, recipient_id: message.sender_id },
      ],
    };
  }

  const unreadMentionCount = await Message.count({
    where: countWhere,
    include: [{ model: MessageStatus, as: 'statuses', where: includeWhere, required: true }],
  });

  return unreadMentionCount > 0;
};

async function getConversationData(messages, excludedIds) {
  const newPrevMessagesMap = new Map();
  const processedConversations = new Set();
  const conversationMessages = new Map();

  for (const message of messages) {
    const conversationKey = getConversationKey(message);

    if (!processedConversations.has(conversationKey)) {
      const newPrevMessage = await findNewPrevMessage(message, excludedIds);
      newPrevMessagesMap.set(conversationKey, newPrevMessage);
      processedConversations.add(conversationKey);
    }

    if (!conversationMessages.has(conversationKey)) {
      conversationMessages.set(conversationKey, []);
    }
    conversationMessages.get(conversationKey).push(message);
  }

  return { newPrevMessagesMap, conversationMessages };
}

function getConversationKey(message) {
  return message.group_id ? `group_${message.group_id}` : `dm_${Math.min(message.sender_id, message.recipient_id)}_${Math.max(message.sender_id, message.recipient_id)}`;
}

async function findNewPrevMessage(message, excludedIds) {
  const whereConditions = message.group_id
    ? { group_id: message.group_id, id: { [Op.notIn]: excludedIds } }
    : {
        [Op.or]: [
          { sender_id: message.sender_id, recipient_id: message.recipient_id },
          { sender_id: message.recipient_id, recipient_id: message.sender_id },
        ],
        id: { [Op.notIn]: excludedIds },
      };

  return await Message.findOne({
    where: whereConditions,
    order: [['created_at', 'DESC']],
  });
}

async function processDeleteForMe(userId, messages, newPrevMessagesMap, deleteActions, socketEvents) {
  const promises = messages.map(async (message) => {
    const existing = await MessageAction.findOne({
      where: { message_id: message.id, user_id: userId, action_type: 'delete' },
    });

    if (!existing) {
      deleteActions.push({
        message_id: message.id,
        user_id: userId,
        action_type: 'delete',
        details: {
          type: 'me',
          deleted_by: userId,
          original_sender_id: message.sender_id,
        },
      });
    }

    const socketPayload = await createSocketPayload(message, userId, newPrevMessagesMap, 'delete-for-me');
    socketEvents.push({ room: `user_${userId}`, payload: socketPayload });
  });

  await Promise.all(promises);
}

async function processDeleteForEveryone(userId, userMessages, otherMessages, newPrevMessagesMap, deleteActions, socketEvents) {
  const userPromises = userMessages.map(async (message) => {
    const targetUsers = await getTargetUsers(message);

    const userPromises = targetUsers.map(async (targetUserId) => {
      const existing = await MessageAction.findOne({
        where: { message_id: message.id, user_id: targetUserId, action_type: 'delete' },
      });

      if (!existing) {
        deleteActions.push({
          message_id: message.id,
          user_id: targetUserId,
          action_type: 'delete',
          details: {
            type: 'everyone',
            deleted_by: userId,
            original_sender_id: message.sender_id,
          },
        });
      }

      const socketPayload = await createSocketPayload(message, targetUserId, newPrevMessagesMap, 'delete-for-everyone', targetUserId === userId ? false : undefined);
      socketEvents.push({ room: `user_${targetUserId}`, payload: socketPayload });
    });

    await Promise.all(userPromises);
  });

  const otherPromises = otherMessages.map(async (message) => {
    const existing = await MessageAction.findOne({
      where: { message_id: message.id, user_id: userId, action_type: 'delete' },
    });

    if (!existing) {
      deleteActions.push({
        message_id: message.id,
        user_id: userId,
        action_type: 'delete',
        details: {
          type: 'me',
          deleted_by: userId,
          original_sender_id: message.sender_id,
        },
      });
    }

    const socketPayload = await createSocketPayload(message, userId, newPrevMessagesMap, 'delete-for-me');
    socketEvents.push({ room: `user_${userId}`, payload: socketPayload });
  });

  await Promise.all([...userPromises, ...otherPromises]);
};

async function handleBroadcastDeletion({ userId, messages, isBroadcast, messageIds, deleteType, broadcastId, io, res }) {
  try {
    const broadcast = await Broadcast.findOne({
      where: { id: broadcastId, creator_id: userId },
      include: [{ model: BroadcastMember, as: 'recipients' }]
    });

    if (!broadcast) {
      return res.status(403).json({ message: 'Broadcast not found or unauthorized' });
    }

    const recipientIds = broadcast.recipients.map(r => r.recipient_id);
    
    const broadcastMessages = await Message.findAll({
      where: {
        sender_id: userId,
        recipient_id: { [Op.in]: recipientIds },
        [Op.and]: [
          Sequelize.json('metadata.is_broadcast', 'true'),
          Sequelize.json('metadata.broadcast_id', String(broadcastId))
        ]
      },
      include: [{ model: MessageAction, as: 'actions' }]
    });

    const messagesToDelete = broadcastMessages.filter(msg => 
      messages.some(original => 
        original.content === msg.content &&
        original.file_url === msg.file_url &&
        new Date(original.created_at).getTime() === new Date(msg.created_at).getTime()
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
          where: { 
            message_id: msg.id, 
            user_id: userId, 
            action_type: 'delete' 
          }
        });
    
        if (!existing) {
          deleteActions.push({
            message_id: msg.id,
            user_id: userId,
            action_type: 'delete',
            details: {
              type: 'me',
              deleted_by: userId,
              is_broadcast: isBroadcast,
              is_broadcast_view: isBroadcast ? true : false,
              broadcast_id: broadcastId
            }
          });
        }
      }
    
      socketEvents.push({
        room: `user_${userId}`,
        payload: {
          messageIds: messagesToDelete.map(m => m.id),
          deleteType: 'delete-for-me',
          isBroadcast: true,
          broadcastId
        }
      });
    } else if (deleteType === 'delete-for-everyone') {
      const allAffectedUsers = [userId, ...recipientIds];

      for (const msg of messagesToDelete) {
        for (const targetUserId of allAffectedUsers) {
          const existing = await MessageAction.findOne({
            where: { message_id: msg.id, user_id: targetUserId, action_type: 'delete' }
          });

          if (!existing) {
            deleteActions.push({
              message_id: msg.id,
              user_id: targetUserId,
              action_type: 'delete',
              details: {
                type: 'everyone',
                deleted_by: userId,
                is_broadcast: true,
                broadcast_id: broadcastId
              }
            });
          }
        }
      }

      for (const uid of allAffectedUsers) {
        const affectedMsgs = messagesToDelete.filter(m => 
          m.recipient_id === uid || uid === userId
        );
        socketEvents.push({
          room: `user_${uid}`,
          payload: {
            messageIds: affectedMsgs.map(m => m.id),
            deleteType: 'delete-for-everyone',
            isBroadcast: true,
            broadcastId,
            deletedBy: userId
          }
        });
      }

      await deleteMessageFiles(messagesToDelete);
    }

    await Promise.all([
      deleteActions.length > 0 ? MessageAction.bulkCreate(deleteActions, { ignoreDuplicates: true }) : null,
      ...socketEvents.map(event => io.to(event.room).emit('message-deleted', event.payload))
    ]);

    return res.status(200).json({
      message: 'Broadcast message deleted successfully.',
      deletedForEveryone: deleteType === 'delete-for-everyone' ? messagesToDelete.length : 0,
      deletedForMe: deleteType === 'delete-for-me' ? messagesToDelete.length : 0
    });

  } catch (error) {
    console.error('Error in handleBroadcastDeletion:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

async function getTargetUsers(message) {
  if (message.group_id) {
    const members = await GroupMember.findAll({
      where: { group_id: message.group_id },
      attributes: ['user_id'],
      raw: true,
    });
    return members.map((member) => member.user_id);
  }
  return [message.sender_id, message.recipient_id];
}

async function createSocketPayload(message, targetUserId, newPrevMessagesMap, deleteType, wasUnreadOverride) {
  const conversationKey = getConversationKey(message);
  const newPrevMessage = newPrevMessagesMap.get(conversationKey);
  const deletedMessageHadMentions = message.has_unread_mentions;

  let wasUnread = wasUnreadOverride;
  if (wasUnread === undefined) {
    const messageStatus = await MessageStatus.findOne({
      where: { message_id: message.id, user_id: targetUserId },
    });
    wasUnread = messageStatus ? messageStatus.status !== 'seen' : false;
  }

  const hasUnreadMentions = await hasUnreadMentionsForUser(message, targetUserId, deletedMessageHadMentions);

  const payload = {
    messageId: message.id,
    newPrevMessage: newPrevMessage,
    deleteType,
    wasUnread,
    hasUnreadMentions,
    deletedMessage: {
      sender_id: message.sender_id,
      group_id: message.group_id,
      recipient_id: message.recipient_id,
    },
    created_at: message.created_at,
    sender_id: message.sender_id,
  };

  if (message.group_id) {
    payload.group_id = message.group_id;
  } else {
    payload.recipient_id = message.recipient_id;
  }

  return payload;
}

async function deleteMessageFiles(messages) {
  const fileDeletionPromises = messages
    .filter((message) => message.file_url)
    .map(
      (message) =>
        new Promise((resolve) => {
          fs.unlink(message.file_url, (err) => {
            if (err) {
              console.log(`Failed to delete file: ${message.file_url}`, err);
            } else {
              console.log(`File deleted: ${message.file_url}`);
            }
            resolve();
          });
        })
    );

  await Promise.all(fileDeletionPromises);
}

async function buildMessagePayloads({ content, message_type, metadata, files, singleFile, file_url, parent_id }) {
  const payloads = [];

  if (files?.length) {
    for (const [index, file] of files.entries()) {
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
          ...(typeof metadata === 'string' ? JSON.parse(metadata) : metadata),
        },
      });
    }
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
        ...metadata,
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
    let locationMetadata = metadata;
    if (typeof metadata === 'string') {
      try {
        locationMetadata = JSON.parse(metadata);
      } catch {}
    }
    payloads.push({
      content: locationMetadata?.address || 'Location',
      message_type: 'location',
      metadata: locationMetadata,
      parent_id,
    });
    return payloads;
  }

  payloads.push({ content, message_type, metadata, parent_id });
  return payloads;
}

async function createMessageWithStatus({ senderId, recipientId, groupId, payload, mentions, isEncrypted, isBlocked }) {
  const message = await Message.create({
    sender_id: senderId,
    recipient_id: recipientId || null,
    group_id: groupId || null,
    ...payload,
    mentions,
    is_encrypted: isEncrypted,
  });

  let chatSetting = null;

  if (recipientId) {
    chatSetting = await ChatSetting.findOne({
      where: {
        [Op.or]: [
          { user_id: senderId, recipient_id: recipientId },
          { user_id: recipientId, recipient_id: senderId },
        ],
      },
    });
  } else if (groupId) {
    chatSetting = await ChatSetting.findOne({ where: { group_id: groupId } });
  }

  if (chatSetting?.disappearing_enabled) {
    await MessageDisappearing.create({
      message_id: message.id,
      enabled: true,
      expire_after_seconds: chatSetting.expire_after_seconds,
      expire_at: null,
    });
  }

  if (recipientId) {
    await MessageStatus.create({
      message_id: message.id,
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
      a.user_id === currentUserId && 
      a.action_type === 'delete' && 
      a.details?.type === 'me'
    );
    const deletedForEveryone = actions.some(a => 
      a.action_type === 'delete' && 
      a.details?.type === 'everyone'
    );

    if (deletedForMe && !deletedForEveryone) continue; 
    if (deletedForEveryone) {
      msg.isDeleted = true;
      msg.isDeletedForEveryone = true;
      msg.content = 'This message was deleted';
    }

    const key = `${msg.created_at.toISOString()}_${msg.content}_${msg.file_url || ''}_${msg.message_type}`;

    if (!map.has(key)) {
      const base = msg.toJSON();
      base.recipients = [];
      base.statuses = [];
      base.isDeleted = deletedForEveryone;
      base.isDeletedForEveryone = deletedForEveryone;
      map.set(key, base);
    }

    const entry = map.get(key);

    if (msg.recipient) entry.recipients.push(msg.recipient);
    if (msg.statuses?.length) entry.statuses.push(...msg.statuses);
  }

  return Array.from(map.values());
};

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

  handleBroadcastDeletion
};
