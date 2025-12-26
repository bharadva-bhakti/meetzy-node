const { Op } = require('sequelize');
const { User, Message, MessageStatus, UserDelete, Friend, Group, GroupMember, Favorite, Call, CallParticipant,
  Block, Archive, MessageReaction, MessageAction, MutedChat, ChatClear, Setting, GroupSetting, Sequelize, ChatSetting, 
  MessageDisappearing, UserSetting, MessagePin, sequelize, Announcement, Broadcast, BroadcastMember } = require('../models');
const { groupMessagesBySender, groupMessagesByDate, getMessageReactionCount, getUserDocuments, getConversationData, processDeleteForMe, 
  processDeleteForEveryone, deleteMessageFiles, buildMessagePayloads, createMessageWithStatus, groupBroadcastMessages, handleBroadcastDeletion 
} = require('../helper/messageHelpers');
const bcrypt = require('bcryptjs');
const { getEffectiveLimits } = require('../utils/userLimits');

exports.sendMessage = async (req, res) => {
  const senderId = req.user?.id;
  const files = req.files || [];
  const singleFile = req.file;

  const { 
    recipientId, groupId, broadcastId, content, message_type = 'text', metadata = null, 
    parent_id, file_url = null, mentions, is_encrypted
  } = req.body;

  if (!senderId) return res.status(401).json({ message: 'Unauthorized' });

  if ((!recipientId && !groupId && !broadcastId) ||
      ([recipientId, groupId, broadcastId].filter(Boolean).length > 1)) {
    return res.status(400).json({ message: 'Provide recipientId, groupId or broadcastId' });
  }

  if (message_type === 'text' && !content && !files.length && !singleFile) {
    return res.status(400).json({ message: 'Message content required' });
  }

  try {
    const settings = await Setting.findOne({ order: [['id', 'DESC']], raw: true });
    const maxLen = settings?.maximum_message_length || 50000;

    if (content?.length > maxLen) {
      return res.status(400).json({ message: `Max ${maxLen} characters allowed` });
    }

    const isEncrypted = is_encrypted === true || is_encrypted === 'true';

    if (settings?.e2e_encryption_enabled && !isEncrypted) {
      return res.status(400).json({ message: 'Encryption required' });
    }

    const limits = await getEffectiveLimits(senderId, req.user.role);

    const hasFiles = files.length > 0 || singleFile || file_url;
    const isMediaMessage = ['image', 'video', 'audio', 'document', 'file'].includes(message_type);

    if ((hasFiles || isMediaMessage) && !limits.allow_media_send) {
      return res.status(403).json({
        message: 'Sending media files is not allowed on your current plan.',
      });
    }

    let validatedMentions = [];
    if (mentions?.length) {
      const users = await User.findAll({
        where: { id: mentions },
        attributes: ['id']
      });
      validatedMentions = users.map(u => u.id);
    }

    let recipientIds = [];
    let isBroadcast = false;

    if (broadcastId) {
      isBroadcast = true;
      const broadcast = await Broadcast.findOne({
        where: { id: broadcastId, creator_id: senderId },
        include: [{ model: BroadcastMember, as: 'recipients' }]
      });

      if (!broadcast || !broadcast.recipients.length) {
        return res.status(400).json({ message: 'Invalid broadcast' });
      }

      recipientIds = broadcast.recipients.map(r => r.recipient_id);
    } else if (recipientId) {
      recipientIds = [recipientId];
    }

    if (groupId) {
      const member = await GroupMember.findOne({
        where: { group_id: groupId, user_id: senderId }
      });
      if (!member) return res.status(403).json({ message: 'Not a group member' });
    }

    const payloads = await buildMessagePayloads({ 
      content, message_type, metadata, files, singleFile, file_url, parent_id
    });

    const messages = [];
    const io = req.app.get('io');

    if (groupId) {
      const payloads = await buildMessagePayloads({
        content, message_type, metadata, files, singleFile, file_url, parent_id
      });

      const groupMembers = await GroupMember.findAll({
        where: { group_id: groupId, user_id: { [Op.ne]: senderId }},
        attributes: ['user_id'],
        raw: true
      });

      const messages = [];

      for (const payload of payloads) {
        const message = await createMessageWithStatus({
          senderId,
          recipientId: null,
          groupId,
          payload,
          mentions: validatedMentions,
          isEncrypted,
          isBlocked: false
        });

        messages.push(message);

        await MessageStatus.bulkCreate(
          groupMembers.map(m => ({ message_id: message.id, user_id: m.user_id, status: 'sent'}))
        );
      }

      const fullMessages = await Promise.all(
        messages.map(m =>
          Message.findByPk(m.id, {
            include: [
              { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
              { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] }
            ]
          })
        )
      );

      const io = req.app.get('io');

      for (const member of groupMembers) {
        io.to(`user_${member.user_id}`).emit('receive-message', fullMessages[0]);
      }

      io.to(`user_${senderId}`).emit('receive-message', fullMessages[0]);

      return res.status(201).json({ messages: fullMessages });
    }

    for (const rid of recipientIds) {
      const blocked = await Block.findOne({
        where: { blocker_id: rid, blocked_id: senderId }
      });

      for (const payload of payloads) {
        const msg = await createMessageWithStatus({
          senderId,
          recipientId: isBroadcast ? rid : recipientId,
          groupId,
          payload: isBroadcast
            ? {
                ...payload,
                metadata: {
                  ...payload.metadata,
                  is_broadcast: true,
                  broadcast_id: broadcastId
                }
              }
            : payload,
          mentions: validatedMentions,
          isEncrypted,
          isBlocked: !!blocked
        });

        messages.push(msg);
      }
    }

    const fullMessages = await Promise.all(
      messages.map(m =>
        Message.findByPk(m.id, {
          include: [
            { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
            { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'] },
            { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
          ]
        })
      )
    );

    if (isBroadcast) {
      const mergedMessages = groupBroadcastMessages(fullMessages, senderId);

      if (mergedMessages.length > 0) {
        io.to(`user_${senderId}`).emit('receive-message', mergedMessages[0]);
      }

      const recipientMessageMap = new Map();
      fullMessages.forEach(msg => {
        if (msg.recipient_id) {
          if (!recipientMessageMap.has(msg.recipient_id)) {
            recipientMessageMap.set(msg.recipient_id, msg);
          }
        }
      });

      recipientIds.forEach(recipientId => {
        const msg = recipientMessageMap.get(recipientId);
        if (msg) {
          io.to(`user_${recipientId}`).emit('receive-message', msg);
          io.to(`user_${senderId}`).emit('receive-message', msg);
        }
      });

    } else {
      fullMessages.forEach(msg => {
        io.to(`user_${senderId}`).emit('receive-message', msg);

        if (msg.recipient_id) {
          io.to(`user_${msg.recipient_id}`).emit('receive-message', msg);
        }
      });
    }

    return res.status(201).json({ messages: fullMessages });

  } catch (err) {
    console.error('Send Message Error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getMessages = async (req, res) => { 
  const userId = req.user.id;
  const { limit = 50, offset = 0, recipientId, groupId, isAnnouncement = false, isBroadcast=false, broadcastId, announcementId } = req.query;

  try {
    const isGroup = !!groupId;
    let targetType = null;
    let targetId = null;

    if (isAnnouncement === 'true' || isAnnouncement === true) {
      targetType = 'announcement';
      targetId = announcementId || null;

    } else if (isBroadcast === 'true' || isBroadcast === true) {
      targetType = 'broadcast';
      targetId = broadcastId || null;

    } else if (isGroup) {
      targetType = 'group';
      targetId = groupId;

    } else if (recipientId) {
      targetType = 'user';
      targetId = recipientId;
    }

    const whereCondition = targetId ? { user_id: userId, target_id: targetId, target_type: targetType } : null;

    const [muteEntry, favoriteEntry, archiveEntry] = await Promise.all([
      whereCondition ? MutedChat.findOne({ where: whereCondition }) : null,
      whereCondition ? Favorite.findOne({ where: whereCondition }) : null,
      whereCondition ? Archive.findOne({ where: whereCondition }) : null,
    ]);

    const commonChatMeta = {
      isMuted: !!muteEntry,
      isFavorite: !!favoriteEntry,
      isArchived: !!archiveEntry,
    };

    const commonIncludes = [
      { model: User, as: 'sender', attributes: ['id', 'name', 'email', 'avatar'] },
      { model: MessageStatus, as: 'statuses', attributes: ['user_id', 'status', 'updated_at'] },
      { model: MessageReaction, as: 'reactions', include: [{ model: User, attributes: ['id', 'name', 'avatar'] }] },
      { model: MessageAction, as: 'actions', attributes: ['id', 'user_id', 'action_type', 'details'] },
      {
        model: MessagePin, as: 'pin',
        required: false,
        attributes: ['id', 'pinned_until'],
        include: [{ model: User, as: 'pinner', attributes: ['id', 'name', 'avatar', 'email'] }]
      },
      {
        model: MessageAction,
        as: 'actions',
        attributes: ['id', 'user_id', 'action_type', 'details'],
        required: false
      },
      { model: MessageDisappearing, as: 'disappearing', required: false},
      {
        model: Message,
        as: 'parent',
        required: false,
        attributes: [
          'id', 'sender_id', 'recipient_id', 'content', 'message_type', 'file_url', 
          'file_type', 'mentions', 'metadata', 'created_at', 'updated_at'
        ],
        include: [
          { model: User, as: 'sender', attributes: ['id', 'name', 'email', 'avatar'] },
          { model: User, as: 'recipient', attributes: ['id', 'name', 'email', 'avatar'] },
          { model: MessageStatus, as: 'statuses', attributes: ['user_id', 'status', 'updated_at'] },
        ],
      },
    ];

    let isChatLocked = false;
    const userSetting = await UserSetting.findOne({ where: { user_id: userId }, raw: true });

    if (userSetting?.chat_lock_enabled && Array.isArray(userSetting.locked_chat_ids) && targetType && targetId) {
      isChatLocked = userSetting.locked_chat_ids.some(
        chat => chat.type === targetType && chat.id === Number(targetId)
      );

      if (isChatLocked) {
        const pin = req.query.pin;
        if (!pin) return res.status(400).json({ message: 'PIN_REQUIRED' });
        if (!userSetting?.pin_hash) return res.status(400).json({ message: 'PIN_REQUIRED' });

        const match = await bcrypt.compare(pin, userSetting.pin_hash);
        if (!match) return res.status(400).json({ message: 'INVALID_PIN' });
      }
    }

    if (isAnnouncement === 'true' || isAnnouncement === true) {
      if(!announcementId) return res.status(404).json({message: 'Announcement Id is required.'})
      
      const [iBlockedThem, theyBlockedMe, clearEntry] = announcementId ? await Promise.all([
        Block.findOne({ where: { blocker_id: userId, blocked_id: announcementId } }),
        Block.findOne({ where: { blocker_id: announcementId, blocked_id: userId } }),
        ChatClear.findOne({ where: { user_id: userId, recipient_id: announcementId } }),
      ]) : [null, null, null];

      const messageWhere = {
        message_type: 'announcement',
        recipient_id: null,
        group_id: null,
        ...(clearEntry && { created_at: { [Op.gt]: clearEntry.cleared_at } })
      };

      if (iBlockedThem) {
        messageWhere.created_at = { ...messageWhere.created_at, [Op.lte]: iBlockedThem.created_at };
      }
      if (theyBlockedMe) {
        messageWhere.message_type = { [Op.not]: 'system' };
      }

      const messages = await Message.findAll({
        where: messageWhere,
        include: [
          ...commonIncludes,
          {
            model: Announcement,
            as: 'announcement',
            required: true,
            attributes: ['id', 'title', 'announcement_type', 'action_link', 'created_at']
          }
        ],
        order: [['created_at', 'DESC']],
        offset: parseInt(offset),
        limit: parseInt(limit),
      });

      const groupedMessages = await groupMessagesBySender(messages, userId);
      const dateGroupedMessages = groupMessagesByDate(groupedMessages);

      return res.json({
        messages: dateGroupedMessages,
        chatTarget: {
          type: 'direct',
          name: 'Announcements',
          isAnnouncement: true,
          ...commonChatMeta,
          isBlocked: !!iBlockedThem,
          hasBlockedMe: !!theyBlockedMe,
          blockedBy: theyBlockedMe ? {
            id: theyBlockedMe.blocker?.id,
            name: theyBlockedMe.blocker?.name
          } : null,
        },
        metadata: {
          offset,
          limit,
          hasMore: messages.length === parseInt(limit),
          messageCount: messages.length,
          isChatLocked
        }
      });
    }

    if (isBroadcast === 'true' || isBroadcast === true) {
      if (!broadcastId) return res.status(400).json({ message: 'broadcastId is required' });

      const clearEntry = await ChatClear.findOne({ 
        where: { user_id: userId, broadcast_id: broadcastId } 
      });

      const messageWhere = {
        sender_id: userId,
        [Op.and]: [
          Sequelize.where(Sequelize.json('metadata.is_broadcast'), 'true'),
          Sequelize.where(Sequelize.json('metadata.broadcast_id'), String(broadcastId)),
        ],
        ...(clearEntry && { created_at: { [Op.gt]: clearEntry.cleared_at } })
      };

      const messages = await Message.findAll({
        where: messageWhere,
        include: commonIncludes,
        order: [['created_at', 'ASC']],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      const archive = await Archive.findOne({
        where: { user_id: userId, target_id: broadcastId, target_type: 'broadcast' }
      });

      const merged = groupBroadcastMessages(messages, userId);
      const dateGroupedMessages = groupMessagesByDate([
        {
          sender_id: userId,
          sender: null,
          messages: merged,
          created_at: merged[0]?.created_at,
          lastMessageTime: merged[0]?.created_at,
          groupId: `broadcast_${broadcastId}`
        }
      ]);

      return res.json({
        messages: dateGroupedMessages,
        chatTarget: {
          type: 'broadcast',
          broadcast_id: broadcastId,
          isArchived: !!archive,
        },
        metadata: {
          offset,
          limit,
          hasMore: messages.length === parseInt(limit),
          messageCount: messages.length,
          isChatLocked
        }
      });
    }

    const paramCount = [groupId, recipientId].filter(Boolean).length;
    if (paramCount !== 1) {
      return res.status(400).json({ message: 'Provide exactly one of: groupId, recipientId.' });
    }

    let chatTarget;
    let messages;

    if (recipientId) {
      const user = await User.findByPk(recipientId);
      if (!user) return res.status(404).json({ message: 'User Not Found' });

      const [iBlockedThem, theyBlockedMe, friendEntry, clearEntry] = await Promise.all([
        Block.findOne({ 
          where: { blocker_id: userId, blocked_id: recipientId }, 
          include: [
            { model: User, as: 'blocker', attributes: ['id', 'name'] }, 
            { model: User, as: 'blocked', attributes: ['id', 'name'] }
          ] 
        }),
        Block.findOne({ 
          where: { blocker_id: recipientId, blocked_id: userId }, 
          include: [
            { model: User, as: 'blocker', attributes: ['id', 'name'] }, 
            { model: User, as: 'blocked', attributes: ['id', 'name'] }
          ]
        }),
        Friend.findOne({ 
          where: { [Op.or]: [
            { user_id: userId, friend_id: recipientId }, 
            { user_id: recipientId, friend_id: userId }
          ]} 
        }),
        ChatClear.findOne({ where: { user_id: userId, recipient_id: recipientId } }),
      ]);

      const messageWhere = {
        [Op.or]: [
          { sender_id: userId, recipient_id: recipientId },
          { sender_id: recipientId, recipient_id: userId },
        ],
        ...(clearEntry && { created_at: { [Op.gt]: clearEntry.cleared_at } })
      };

      if (iBlockedThem) {
        messageWhere.created_at = { ...messageWhere.created_at, [Op.lte]: iBlockedThem.created_at };
      }
      if (theyBlockedMe) {
        messageWhere.message_type = { [Op.not]: 'system' };
      }

      messages = await Message.findAll({
        where: messageWhere,
        include: [
          ...commonIncludes,
          { model: User, as: 'recipient', attributes: ['id', 'name', 'email', 'avatar'] },
        ],
        order: [['created_at', 'DESC']],
        offset: parseInt(offset),
        limit: parseInt(limit),
      });

      const canSendMessages = !iBlockedThem && !theyBlockedMe ? true : !iBlockedThem;
      const canReceiveMessages = !theyBlockedMe;

      chatTarget = {
        ...user.toJSON(),
        type: 'direct',
        ...commonChatMeta,
        isBlocked: !!iBlockedThem,
        hasBlockedMe: !!theyBlockedMe,
        blockedBy: theyBlockedMe ? { id: theyBlockedMe.blocker?.id, name: theyBlockedMe.blocker?.name } : null,
        blockedAt: iBlockedThem?.created_at || null,
        isFriend: !!friendEntry,
        canSendMessages,
        canReceiveMessages,
      };
    } else {
      const member = await GroupMember.findOne({ where: { group_id: groupId, user_id: userId } });

      let leftAt = null;
      if (!member) {
        const leaveMessage = await Message.findOne({
          where: {
            group_id: groupId,
            message_type: 'system',
            [Op.and]: [
              Sequelize.where(Sequelize.json('metadata.system_action'), 'member_left'),
              Sequelize.where(Sequelize.json('metadata.user_id'), userId)
            ]
          },
          order: [['created_at', 'DESC']],
          limit: 1
        });

        if (leaveMessage) leftAt = leaveMessage.created_at;
        else {
          const userMessage = await Message.findOne({ where: { group_id: groupId, sender_id: userId }, order: [['created_at', 'DESC']] });
          if (!userMessage) return res.status(403).json({ message: 'You are not a member of this group.' });
        }
      }

      const group = await Group.findByPk(groupId, { attributes: ['id', 'name', 'avatar', 'description'] });

      const clearEntry = await ChatClear.findOne({ where: { user_id: userId, group_id: groupId } });
      const groupBlockEntry = await Block.findOne({ where: { blocker_id: userId, group_id: groupId, block_type: 'group' } });

      const messageWhere = { group_id: groupId };
      if (clearEntry) messageWhere.created_at = { [Op.gt]: clearEntry.cleared_at };
      if (leftAt) messageWhere.created_at = { ...messageWhere.created_at, [Op.lte]: leftAt };

      if (groupBlockEntry) {
        const visibleToBlocker = {
          [Op.or]: [
            Sequelize.where(Sequelize.cast(Sequelize.json('metadata.visible_to'), 'UNSIGNED'), userId),
            Sequelize.where(Sequelize.fn('JSON_UNQUOTE', Sequelize.json('metadata.visible_to')), String(userId)),
          ],
        };
        messageWhere[Op.or] = [
          { created_at: { [Op.lte]: groupBlockEntry.created_at } },
          { created_at: { [Op.gt]: groupBlockEntry.created_at }, [Op.and]: visibleToBlocker },
        ];
      }

      messages = await Message.findAll({
        where: messageWhere,
        include: [
          ...commonIncludes,
          { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] },
          {
            model: MessageDisappearing,
            as: 'disappearing',
            required: false,
          },
        ],
        order: [['created_at', 'DESC']],
        offset: parseInt(offset),
        limit: parseInt(limit),
      });

      const callIds = messages.filter(m => m.message_type === 'call' && m.metadata?.call_id).map(m => m.metadata.call_id);
      let callData = {};
      if (callIds.length > 0) {
        const calls = await Call.findAll({
          where: { id: callIds },
          include: [{ model: CallParticipant, as: 'participants', include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }] }],
        });
        callData = Object.fromEntries(calls.map(c => [c.id, c.toJSON()]));
      }

      messages = messages.map(msg => {
        if (msg.message_type !== 'call' || !msg.metadata?.call_id) return msg;
        const call = callData[msg.metadata.call_id];
        if (!call) return msg;

        const participant = call.participants.find(p => p.user_id === userId);
        const userStatus = participant?.status || 'missed';

        let displayText = '📞 Group call';
        if (userStatus === 'declined') displayText = '❌ You declined the call';
        else if (userStatus === 'missed') displayText = '📞 Missed group call';
        else if (userStatus === 'joined' || userStatus === 'left') {
          displayText = `✅ Call ended ${call.duration ? `(${call.duration}s)` : ''}`;
        }

        msg.content = displayText;
        msg.metadata.call_summary = {
          totalParticipants: call.participants.length,
          joined: call.participants.filter(p => p.status === 'joined').map(p => p.user.name),
          declined: call.participants.filter(p => p.status === 'declined').map(p => p.user.name),
          missed: call.participants.filter(p => p.status === 'missed').map(p => p.user.name),
        };
        return msg;
      });

      chatTarget = {
        ...group.toJSON(),
        type: 'group',
        ...commonChatMeta,
        isBlocked: !!groupBlockEntry,
      };
    }

    const processedMessages = [];
    const now = new Date();

    for (const msg of messages) {
      const existingDeleteAction = await MessageAction.findOne({
        where: { 
          message_id: msg.id, 
          user_id: userId, 
          action_type: 'delete',
          details: {
            is_broadcast_view: false
          }
        }
      });
      if (existingDeleteAction) {
        continue;
      }

      if (msg.disappearing?.enabled && msg.disappearing.expire_after_seconds === null && msg.disappearing.expire_at) {
        const expireTime = new Date(msg.disappearing.expire_at);
        
        if (expireTime <= now) {
          await MessageAction.create({
            message_id: msg.id,
            user_id: userId,
            action_type: 'delete',
            details: {
              type: 'me',
              deleted_by: null,
              original_sender_id: msg.sender_id,
              immediate_disappear: true,
              auto_deleted_at: now.toISOString()
            }
          });
          continue;
        }
      }
      processedMessages.push(msg);
    }

    const groupedMessages = await groupMessagesBySender(processedMessages, userId);
    const dateGroupedMessages = groupMessagesByDate(groupedMessages);

    return res.json({
      messages: dateGroupedMessages,
      chatTarget,
      metadata: {
        offset,
        limit,
        hasMore: processedMessages.length === parseInt(limit),
        messageCount: processedMessages.length,
        isChatLocked
      }
    });
  } catch (error) {
    console.error('Error in getMessages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.markMessagesAsRead = async (req, res) => {
  const { chat_id, chat_type } = req.body;
  const userId = req.user.id;

  try {
    let whereClause = {};

    if (chat_type === 'group') {
      whereClause.group_id = chat_id;
    } else if (chat_type === 'direct') {
      whereClause = {
        [Op.or]: [
          { sender_id: userId, recipient_id: chat_id },
          { sender_id: chat_id, recipient_id: userId },
        ],
      };
    }
        
    const unreadMessages = await MessageStatus.findAll({
      where: { user_id: userId, status: { [Op.ne]: 'seen' }},
      include: [
        { model: Message, as: 'message', where: whereClause, required: true }
      ],
    });

    if (unreadMessages.length === 0) {
      return res.status(200).json({ message: 'No unread messages.' });
    }

    await MessageStatus.update(
      { status: 'seen' },
      {
        where: { user_id: userId, status: { [Op.ne]: 'seen' } },
        include: [
          { model: Message, as: 'message', where: whereClause, required: true },
        ],
      }
    );

    const now = new Date();

    for (const status of unreadMessages) {
      const msg = status.message;

      const disappearing = await MessageDisappearing.findOne({ 
        where: { message_id: msg.id }
      });

      if (!disappearing) continue;
      if (!disappearing.enabled) continue;
      if (disappearing.expire_at) continue;

      if (disappearing.expire_after_seconds === null) {
        await disappearing.update({ 
          expire_at: now,
          metadata: { immediate_disappear: true }
        });
      } else {
        const expireAt = new Date(now.getTime() + disappearing.expire_after_seconds * 1000);
        await disappearing.update({ expire_at: expireAt });
      }
    }

    await Message.update(
      { has_unread_mentions: false },
      { where: { ...whereClause, has_unread_mentions: true }}
    );

    return res.status(200).json({ message: 'Messages marked as read successfully.' });
  } catch (error) {
    console.error('Error in markMessagesAsRead:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.toggleReaction = async (req,res) => {
  const userId = req.user.id;
  const { messageId, emoji } = req.body;

  if(!userId) res.status(400).json({ message: 'Not Authenticated.' });

  if(!messageId || !emoji) {
    return res.status(400).json({ message: 'Message Id and Emoji are required' });
  }

  if(typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ message: 'Invalid Emoji' });
  }

  try {
    const message = await Message.findByPk(messageId);
    if(!message) return res.status(404).json({ message: 'Message Not Found.' });

    if(message.sender_id !== userId && message.recipient_id !== userId){
      if(message.group_id){
        const membership = await GroupMember.findOne({
          where: {
            group_id: message.group_id,
            user_id: userId
          }
        });

        if(!membership){
          return res.status(403).json({ message: 'Access Denied' });
        }
      } else {
        return res.status(403).json({ message: 'Access Denied' });
      }
    }

    const existingReaction = await MessageReaction.findOne({
      where: {
        message_id: messageId,
        user_id: userId,
        emoji: emoji
      }
    });

    let action, reaction;

    if(existingReaction){
      await existingReaction.destroy();
      action = 'removed';
      reaction = existingReaction
    } else {
      const existDifferentReaction = await MessageReaction.findOne({
        where: { message_id: messageId, user_id: userId }
      });

      if(!existDifferentReaction){
        reaction = await MessageReaction.create({
          message_id: messageId,
          user_id: userId,
          emoji: emoji
        });
      } else {
        reaction = await existDifferentReaction.update({
          message_id: messageId,
          user_id: userId,
          emoji: emoji
        });
      }
      action = 'added'
    }

    const reactionCounts = await getMessageReactionCount(messageId,userId);
    const io = req.app.get('io');

    const rawReactions = await MessageReaction.findAll({ where: { message_id: messageId }});
    const grouped = rawReactions.reduce((acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
      acc[r.emoji].count++;
      acc[r.emoji].users.push(r.user_id);
      return acc;
    }, {});
    const reactions = Object.values(grouped);

    if (message.group_id) {
      io.to(`group_${message.group_id}`).emit('message-reaction-updated', {messageId, reactions:reactionCounts });

    } else if (message.sender_id && message.recipient_id) {
      io.to(`user_${message.sender_id}`).emit('message-reaction-updated', { messageId, reactions:reactionCounts});
      io.to(`user_${message.recipient_id}`).emit('message-reaction-updated', { messageId, reactions:reactionCounts});

    } else {
      console.warn(`Cannot determine room for message id ${message.id}`);
      return res.status(400).json({ message: 'Invalid message for reaction room' });
    }

    return res.status(200).json({
      action,
      reaction: {
        id: reaction.id,
        message_id: messageId,
        user_id: userId,
        emoji: emoji
      },
      reactionCounts: reactionCounts
    });
  } catch (error) {
    console.error('Error in toggleReaction:', error);
    res.status(500).json({ message: 'Internal Server Error'});
  }
};

exports.toggleStarMessage = async (req,res) => {
  let { messageIds, isStarred } = req.body;
  const currentUserId = req.user.id;
  const io = req.app.get('io');

  try {
    if(!currentUserId) return res.status(400).json({ message: 'Unauthorized!' });

    if (!Array.isArray(messageIds)) messageIds = [messageIds];

    const messages = await Message.findAll({ where: { id: messageIds }});

    if (messages.length === 0) {
      return res.status(404).json({ message: 'Messages not found.' });
    }

    for (const msg of messages) {
      if (msg.group_id) {
        const isMember = await GroupMember.findOne({
          where: { group_id: msg.group_id, user_id: currentUserId }
        });
        if (!isMember) return res.status(403).json({ message: 'Access Denied - not in group' });
      } else if (msg.sender_id && msg.recipient_id === null && msg.group_id === null){
        continue;
      } else if (msg.sender_id !== currentUserId && msg.recipient_id !== currentUserId) {
        return res.status(403).json({ message: 'Access Denied.' });
      } 
    }

    const existing = await MessageAction.findAll({
      where: {
        message_id: messageIds,
        user_id: currentUserId,
        action_type: 'star'
      }
    });

    const existingIds = existing.map(e => e.message_id);
    let affectedIds = [];

    if (isStarred) {
      const toInsert = messageIds
        .filter(id => !existingIds.includes(id))
        .map(id => ({
          message_id: id,
          user_id: currentUserId,
          action_type: 'star'
        }));

      if (toInsert.length > 0) {
        await MessageAction.bulkCreate(toInsert);
      }

      affectedIds = toInsert.map(i => i.message_id);
    } else {
      if (existing.length > 0) {
        await MessageAction.destroy({
          where: {
            message_id: existingIds,
            user_id: currentUserId,
            action_type: 'star'
          }
        });
      }

      affectedIds = existingIds;
    }

    if (io && affectedIds.length > 0) {
      io.to(`user_${currentUserId}`).emit('message-favorite', {
        messageId: affectedIds,
        isStarred: isStarred,
        userId: currentUserId,
      });
    }

    return res.status(200).json({
      action: isStarred ? 'starred' : 'unstarred',
      message: `Messages ${isStarred ? 'starred' : 'un-starred'} successfully`,
      messageIds: affectedIds,
      isStarred
    });
  } catch (error) {
    console.error('Error in toggleStarMessage:', error);
    res.status(500).json({ message: 'Internal Server Error'});
  }
};

exports.editMessage = async (req,res) => {
  const messageId = req.params.id;
  const userId = req.user.id;
  const { content, is_encrypted } = req.body;

  try {
    const message = await Message.findByPk(messageId);
    if(!message) return res.status(400).json({ message: 'Message not found' });

    if(message.sender_id !== userId){
      return res.status(403).json({ message: 'You are not authorized to edit the message.'});
    }

    if(message.message_type !== 'text'){
      return res.status(400).json({ message: 'Only text messages can edit'});
    }

    const oldContent = message.content;

    const updateData = { content };
    if (is_encrypted !== undefined) {
      updateData.is_encrypted = is_encrypted;
    }
    await message.update(updateData);

    const existing = await MessageAction.findOne({
      where: { message_id: messageId, user_id: userId, action_type: 'edit'}
    });
    if(existing){
      await existing.update({details: { old_content: oldContent, new_content: content }});
    }else{
      await MessageAction.create({
        message_id: messageId,
        user_id: userId,
        action_type: 'edit',
        details: { old_content: oldContent, new_content: content }
      });
    }

    const updatedMessage = await Message.findByPk(message.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'], required: false },
      ],
    });

    const io = req.app.get('io');
    if (message.group_id) {
      io.to(`group_${message.group_id}`).emit('message-updated', updatedMessage);
    } else if (message.recipient_id) {
      io.to(`user_${message.sender_id}`).emit('message-updated', updatedMessage);
      io.to(`user_${message.recipient_id}`).emit('message-updated', updatedMessage);
    }

    res.status(200).json({ message: 'Message Edited Successfully' });
  } catch (error) {
    console.error('Error in editMessage:', error);
    res.status(500).json({ message: 'Internal Server Error'});
  }
};

exports.forwardMessage = async (req, res) => {
  const senderId = req.user.id;
  let { messageIds, recipients, encryptedContents } = req.body;

  try {
    if (!senderId || !messageIds || !Array.isArray(recipients) || recipients.length === 0){
      return res.status(400).json({ message: 'messageIds and recipients are required.' });
    }

    if (!Array.isArray(messageIds)) messageIds = [messageIds];

    const originals = await Message.findAll({ where: { id: messageIds }});

    if (!originals.length)
      return res.status(404).json({ message: 'Message(s) not found.' });

    const forwardedMessages = [];
    const io = req.app.get('io');

    for (const existing of originals) {
      const fileMetadata = {};
      const fileKeys = ['file_size', 'mime_type', 'file_index', 'is_multiple', 'original_filename', 'title', 'redirect_url', 'sent_by_admin', 'announcement_type'];
      for (const key of fileKeys) {
        if (existing.metadata?.[key]) fileMetadata[key] = existing.metadata[key];
      }

      for (const rec of recipients) {
        if (!rec?.type || !rec.id) continue;

        const isGroup = rec.type === 'group';
        const recipient_id = isGroup ? null : rec.id;
        const group_id = isGroup ? rec.id : null;

        if (isGroup) {
          const isMember = await GroupMember.findOne({
            where: { group_id, user_id: senderId }
          });
          if (!isMember) continue;
        }

        let contentToUse = existing.content;
        let isEncryptedToUse = existing.is_encrypted || false;
        
        if (encryptedContents && encryptedContents[existing.id]) {
          const encryptedForRecipient = encryptedContents[existing.id];
          const settings = await Setting.findOne({ order: [['id', 'DESC']], raw: true });
          const e2eEnabled = settings?.e2e_encryption_enabled === true || settings?.e2e_encryption_enabled === 1 || settings?.e2e_encryption_enabled === '1' || settings?.e2e_encryption_enabled === 'true';
          
          if (isGroup && encryptedForRecipient[`group_${group_id}`]) {
            contentToUse = encryptedForRecipient[`group_${group_id}`];
            isEncryptedToUse = e2eEnabled;
          } else if (!isGroup && encryptedForRecipient[`user_${recipient_id}`]) {
            contentToUse = encryptedForRecipient[`user_${recipient_id}`];
            isEncryptedToUse = e2eEnabled;
          }
        }

        const forwardMessage = await Message.create({
          sender_id: senderId,
          recipient_id,
          group_id,
          content: contentToUse,
          message_type: existing.message_type,
          file_url: existing.file_url,
          file_type: existing.file_type,
          metadata: Object.keys(fileMetadata).length ? fileMetadata : null,
          is_encrypted: isEncryptedToUse,
        });

        if (isGroup) {
          const members = await GroupMember.findAll({
            where: { group_id },
            attributes: ['user_id'],
            raw: true,
          });

          const statuses = members
            .filter((m) => m.user_id !== senderId)
            .map((m) => ({
              message_id: forwardMessage.id,
              user_id: m.user_id,
              status: 'sent',
            }));

          if (statuses.length) await MessageStatus.bulkCreate(statuses);
        } else {
          await MessageStatus.create({
            message_id: forwardMessage.id,
            user_id: recipient_id,
            status: 'sent',
          });
        }

        await MessageAction.create({
          message_id: forwardMessage.id,
          user_id: senderId,
          action_type: 'forward',
          details: {
            original_message_id: existing.id,
            original_sender_id: existing.sender_id,
          },
        });

        forwardedMessages.push(forwardMessage.id);

        const fullMessage = await Message.findOne({
          where: { id: forwardMessage.id },
          include: [
            { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
            {
              model: User,
              as: 'recipient',
              attributes: ['id', 'name', 'avatar'],
              required: false,
            },
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'avatar'],
              required: false,
            },
            {
              model: MessageAction,
              as: 'actions',
              where: { action_type: 'forward' },
              required: false,
            },
          ],
        });

        if (fullMessage && io) {
          if (isGroup) {
            const members = await GroupMember.findAll({
              where: { group_id },
              attributes: ['user_id'],
              raw: true,
            });

            members.forEach((member) => {
              const messageData = fullMessage.toJSON();
              io.to(`user_${member.user_id}`).emit('receive-message', {
                ...messageData,
                isForwarded: true,
                is_encrypted: messageData.is_encrypted || false,
              });
            });
          } else {
            const messageData = fullMessage.toJSON();
            io.to(`user_${recipient_id}`).emit('receive-message', {
              ...messageData,
              isForwarded: true,
              is_encrypted: messageData.is_encrypted || false,
            });

            io.to(`user_${senderId}`).emit('receive-message', {
              ...messageData,
              isForwarded: true,
              is_encrypted: messageData.is_encrypted || false,
            });
          }
        }
      }
    }

    const fullMessages = await Message.findAll({
      where: { id: forwardedMessages },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'recipient',
          attributes: ['id', 'name', 'avatar'],
          required: false,
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'avatar'],
          required: false,
        },
        {
          model: MessageAction,
          as: 'actions',
          where: { action_type: 'forward' },
          required: false,
        },
      ],
    });

    return res.status(200).json({
      count: fullMessages.length,
      messages: fullMessages,
    });

  } catch (error) {
    console.error('Error in forwardMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteMessage = async (req, res) => {
  const userId = req.user.id;
  const { messageIds, deleteType, isBroadcast = false, broadcastId = null } = req.body;

  try {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ message: 'Invalid message IDs' });
    }

    const messages = await Message.findAll({
      where: { id: messageIds },
      order: [['created_at', 'DESC']],
    });

    if (messages.length === 0) {
      return res.status(404).json({ message: 'Messages not found' });
    }

    const io = req.app.get('io');
    
    const isBroadcastDeletion = isBroadcast && broadcastId;
    
    if (isBroadcastDeletion) {
      return await handleBroadcastDeletion({
        userId, messages, isBroadcast, messageIds, deleteType, broadcastId, io, res
      });
    }

    const userMessages = messages.filter(msg => msg.sender_id === userId);
    const otherMessages = messages.filter(msg => msg.sender_id !== userId);

    const { newPrevMessagesMap, conversationMessages } = await getConversationData(messages, messageIds);

    const deleteActions = [];
    const socketEvents = [];

    if (deleteType === 'delete-for-me') {
      await processDeleteForMe(userId, messages, newPrevMessagesMap, deleteActions, socketEvents);
    } else if (deleteType === 'delete-for-everyone') {
      await processDeleteForEveryone(userId, userMessages, otherMessages, newPrevMessagesMap, deleteActions, socketEvents);
    } else {
      return res.status(400).json({ message: 'Invalid delete type.' });
    }

    await Promise.all([
      deleteActions.length > 0 ? MessageAction.bulkCreate(deleteActions, { ignoreDuplicates: true }) : Promise.resolve(),
      ...socketEvents.map(event => io.to(event.room).emit('message-deleted', event.payload))
    ]);

    if (deleteType === 'delete-for-everyone' && userMessages.length > 0) {
      await deleteMessageFiles(userMessages);
    }

    return res.status(200).json({
      message: 'Message deleted successfully.',
      deletedForEveryone: deleteType === 'delete-for-everyone' ? userMessages.length : 0,
      deletedForMe: deleteType === 'delete-for-everyone' ? otherMessages.length : messages.length
    });

  } catch (error) {
    console.error('Error in deleteMessage:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleDisappearingMessages = async (req, res) => {
  const userId = req.user?.id;
  const { recipientId, groupId, enabled, duration } = req.body;

  try {
    if (!recipientId && !groupId) {
      return res.status(400).json({ message: 'recipientId or groupId is required.' });
    }

    const DURATION_MAP = {
      '24h': 24 * 3600,
      '7d': 7 * 24 * 3600,
      '90d': 90 * 24 * 3600,
      'after_seen': null,
    };

    let expireSeconds = null;
    if (enabled) {
      if (!duration || !DURATION_MAP.hasOwnProperty(duration)) {
        return res.status(400).json({ message: 'Invalid duration value.' });
      }
      expireSeconds = DURATION_MAP[duration];
    }

    if (recipientId) {
      const userExists = await User.findByPk(recipientId);
      if (!userExists) {
        return res.status(404).json({ message: 'User not found.' });
      }
      
      const [iBlockedThem, theyBlockedMe] = await Promise.all([
        Block.findOne({ where: { blocker_id: userId, blocked_id: recipientId } }),
        Block.findOne({ where: { blocker_id: recipientId, blocked_id: userId } }),
      ]);
      
      if (iBlockedThem || theyBlockedMe) {
        return res.status(403).json({ message: 'Cannot change settings in a blocked chat.' });
      }
    } else if (groupId) {
      const groupExists = await Group.findByPk(groupId);
      if (!groupExists) return res.status(404).json({ message: 'Group not found.' });
      
      const membership = await GroupMember.findOne({ where: { group_id: groupId, user_id: userId }});
      if (!membership) {
        return res.status(403).json({ message: 'You are not a member of this group.' });
      }
      
      if (membership.role !== 'admin') {
        return res.status(403).json({ message: 'Only group admins can change disappearing messages.' });
      }
    }

    let setting = null;

    if (recipientId) {
      setting = await ChatSetting.findOne({
        where: {
          [Op.or]: [
            { user_id: userId, recipient_id: recipientId },
            { user_id: recipientId, recipient_id: userId },
          ],
        },
      });
    } else if (groupId) {
      setting = await ChatSetting.findOne({ where: { group_id: groupId } });
    }

    const wasEnabled = setting?.disappearing_enabled || false;
    const oldDuration = setting?.expire_after_seconds || null;

    if (!setting) {
      setting = await ChatSetting.create({
        user_id: recipientId ? userId : null,
        recipient_id: recipientId || null,
        group_id: groupId || null,
        disappearing_enabled: enabled,
        duration,
        expire_after_seconds: expireSeconds,
      });
    } else {
      setting.disappearing_enabled = enabled;
      setting.expire_after_seconds = enabled ? expireSeconds : null;
      setting.duration = enabled ? duration : null;
      await setting.save();
    }

    const currentUser = await User.findByPk(userId, { attributes: ['id', 'name']});

    let systemMessageContent = '';
    
    if (enabled) {
      let durationText;
      if (duration === 'after_seen') {
        durationText = 'immediately after viewing';
      } else {
        durationText = duration === '24h' ? '24 hours' : duration === '7d' ? '7 days' : '90 days';
      }
      systemMessageContent = `${currentUser.name} turned on disappearing messages. Messages will disappear ${durationText}.`;
    } else {
      systemMessageContent = `${currentUser.name} turned off disappearing messages.`;
    }

    const systemMessage = await Message.create({
      sender_id: userId,
      recipient_id: recipientId || null,
      group_id: groupId || null,
      content: systemMessageContent,
      message_type: 'system',
      metadata: {
        action: enabled ? 'enabled' : 'disabled',
        duration: enabled ? expireSeconds : null,
        duration_display: enabled ? duration : null,
        changed_by: {
          id: currentUser.id,
          name: currentUser.name
        },
        previous_state: {
          enabled: wasEnabled,
          duration: oldDuration
        },
        timestamp: new Date().toISOString()
      }
    });

    const io = req.app.get('io');

    if(!groupId){
      io.to(`user_${recipientId}`).emit('receive-message', systemMessage);
      io.to(`user_${userId}`).emit('receive-message', systemMessage);
    } else {
      io.to(`group_${groupId}`).emit('receive-message', systemMessage);
    }
    
    return res.json({
      message: 'Disappearing messages updated successfully.',
      data: { setting, systemMessage },
    });
  } catch (error) {
    console.error('Error in toggleDisappearingMessages:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchMessages = async (req, res) => {
  const currentUserId = req.user.id;
  const { 
    searchTerm, limit = 50, recipientId = null, groupId = null, broadcast_id = null, page = 1, isAnnouncement = false, isBroadcast = false 
  } = req.query;

  try {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters.' });
    }

    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);
    const offset = (parsedPage - 1) * parsedLimit;
    const searchQuery = `%${searchTerm.trim()}%`;
    const baseConditions = [{ deleted_at: null }, { '$actions.id$': null }];

    let whereCondition = { [Op.and]: baseConditions };

    let include = [
      { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
      {
        model: MessageAction,
        as: 'actions',
        attributes: [],
        required: false,
        where: { user_id: currentUserId, action_type: 'delete' }
      }
    ];

    let searchType = null;

    if (isAnnouncement === 'true' || isAnnouncement === true) {
      searchType = 'announcement';
    } else if (isBroadcast === 'true' || isBroadcast === true) {
      searchType = 'broadcast';
      if (!broadcast_id) {
        return res.status(400).json({ message: 'broadcast_id is required when isBroadcast=true' });
      }
    } else if (recipientId) {
      searchType = 'direct';
    } else if (groupId) {
      searchType = 'group';
    } else {
      return res.status(400).json({ message: 'Must provide one of: recipientId, groupId, broadcast_id with isBroadcast=true, or isAnnouncement=true' });
    }

    if (searchType === 'announcement') {
      whereCondition[Op.and].push(
        { message_type: 'announcement' },
        {
          [Op.or]: [
            { content: { [Op.like]: searchQuery } }, { '$announcement.title$': { [Op.like]: searchQuery } }
          ]
        }
      );

      include.push({
        model: Announcement,
        as: 'announcement',
        attributes: ['id', 'title', 'announcement_type', 'action_link', 'redirect_url'],
        required: true
      });
    }

    else if (searchType === 'broadcast') {
      whereCondition[Op.and].push(
        { sender_id: currentUserId },
        { content: { [Op.like]: searchQuery } },
        Sequelize.where(Sequelize.json('metadata.is_broadcast'), 'true'),
        Sequelize.where(Sequelize.json('metadata.broadcast_id'), String(broadcast_id))
      );
    }

    else if (searchType === 'direct') {
      const user = await User.findByPk(recipientId);
      if (!user) return res.status(404).json({ message: 'User not found.' });

      whereCondition[Op.and].push(
        { message_type: 'text' },
        { content: { [Op.like]: searchQuery } },
        {
          [Op.or]: [
            { sender_id: currentUserId, recipient_id: recipientId },
            { sender_id: recipientId, recipient_id: currentUserId }
          ]
        }
      );

      const clearEntry = await ChatClear.findOne({
        where: { user_id: currentUserId, recipient_id: recipientId }
      });
      if (clearEntry) {
        whereCondition[Op.and].push({ created_at: { [Op.gt]: clearEntry.cleared_at } });
      }
    }

    else if (searchType === 'group') {
      const membership = await GroupMember.findOne({
        where: { group_id: groupId, user_id: currentUserId }
      });
      if (!membership) {
        return res.status(403).json({ message: 'Not a member of the group.' });
      }

      whereCondition[Op.and].push(
        { group_id: groupId },
        { message_type: 'text' },
        { content: { [Op.like]: searchQuery } }
      );

      include.push({
        model: Group,
        as: 'group',
        attributes: ['id', 'name', 'avatar']
      });

      const clearEntry = await ChatClear.findOne({
        where: { user_id: currentUserId, group_id: groupId }
      });
      if (clearEntry) {
        whereCondition[Op.and].push({ created_at: { [Op.gt]: clearEntry.cleared_at } });
      }
    }

    const totalMessagesCount = await Message.count({
      where: whereCondition,
      include,
      distinct: true,
    });

    const messages = await Message.findAll({
      where: whereCondition,
      include: [
        ...include,
        { model: MessageStatus, as: 'statuses', attributes: ['user_id', 'status']}
      ],
      order: [['created_at', 'DESC']],
      limit: parsedLimit,
      offset,
      subQuery: false
    });

    const totalPages = Math.ceil(totalMessagesCount / parsedLimit);

    const results = messages.map(msg => ({
      id: msg.id,
      content: msg.content,
      message_type: msg.message_type,
      file_url: msg.file_url,
      created_at: msg.created_at,
      sender: msg.sender?.toJSON() || null,
      announcement: msg.announcement || null,
      group: msg.group || null,
      broadcast_id: msg.metadata?.broadcast_id || null,
      is_broadcast: !!msg.metadata?.is_broadcast
    }));

    return res.status(200).json({
      messages: results,
      context: {
        type: searchType,
        recipientId: recipientId || null,
        groupId: groupId || null,
        broadcast_id: broadcast_id || null
      },
      pagination: {
        currentPage: parsedPage,
        limit: parsedLimit,
        totalMessages: totalMessagesCount,
        totalPages,
        hasMore: parsedPage < totalPages
      }
    });

  } catch (error) {
    console.error('Error in searchMessages:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.togglePinMessage = async (req,res) => {
  const { messageId, duration } = req.body;
  const userId = req.user.id;
  const io = req.app.get('io');

  if (!messageId) {
    return res.status(400).json({ message: 'messageId is required.' });
  }

  try {
    const message = await Message.findOne({ where: { id: messageId } });
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const existingPin = await MessagePin.findOne({ where: { message_id: messageId }});
    if (existingPin) {
      await existingPin.destroy();
      const payload = { message_id: messageId, isPinned: false };

      if (message.group_id) {
        io.to(`group_${message.group_id}`).emit('message-pin', payload);
      } else if (message.recipient_id) {
        io.to(`user_${message.sender_id}`).emit('message-pin', payload);
        io.to(`user_${message.recipient_id}`).emit('message-pin', payload);
      }

      return res.status(200).json({ pinned: false, message: 'Message unpinned successfully'});
    }

    const durationMap = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    if (!duration || !durationMap[duration]) {
      return res.status(400).json({ message: 'Invalid duration. Use 24h, 7d, or 30d'});
    }

    let chatPins;

    if(message.group_id){
      chatPins = await MessagePin.findAll({
        include: [{ model: Message, as: 'message', where: { group_id: message.group_id }}],
        order: [['created_at', 'DESC']]
      });
    } else{
      chatPins = await MessagePin.findAll({
        include: [{
          model: Message,
          as: 'message',
          where: {
            group_id: null,
            [Op.or]: [
              { sender_id: message.sender_id, recipient_id: message.recipient_id },
              { sender_id: message.recipient_id, recipient_id: message.sender_id }
            ]
          }
        }],
        order: [['created_at', 'DESC']]
      });
    }

    if (chatPins.length >= 3) {
      const oldest = chatPins[0];
      const oldMessageId = oldest.message_id;

      await oldest.destroy();

      const unpinPayload = { message_id: oldMessageId, isPinned: false,};
      const oldMessage = await Message.findByPk(oldMessageId);

      if (oldMessage.group_id) {
        io.to(`group_${oldMessage.group_id}`).emit('message-pin', unpinPayload);
      } else if (oldMessage.recipient_id) {
        io.to(`user_${oldMessage.sender_id}`).emit('message-pin', unpinPayload);
        io.to(`user_${oldMessage.recipient_id}`).emit('message-pin', unpinPayload);
      }
    }

    const pinnedUntil = new Date(Date.now() + durationMap[duration]);

    const newPin = await MessagePin.create({
      message_id: messageId,
      pinned_by: userId,
      pinned_until: pinnedUntil
    });

    const pinningUser = await User.findByPk(userId, {attributes: ['id', 'name', 'email', 'avatar']});

    const systemMessage = await Message.create({
      sender_id: userId,
      group_id: message.group_id || null,
      recipient_id: message.recipient_id || null,
      message_type: 'system',
      content: `${pinningUser.name} pinned a message.`,
      metadata: {
        action: 'pin',
        pinned_by: userId,
        original_message_id: messageId
      }
    });

    const realtimeMessage = await Message.findByPk(systemMessage.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'avatar']},
        { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar']},
        { model: Group, as: 'group', attributes: ['id', 'name', 'avatar']},
      ]
    });    
    
    const payload = {
      message_id: messageId,
      isPinned: true,
      pins: [{ pinned_by: userId, user: pinningUser.get({ plain: true })}],
    };
    
    if (message.group_id) {
      io.to(`group_${message.group_id}`).emit('message-pin', payload);
      io.to(`group${message.group_id}`).emit('receive-message', realtimeMessage);
    } else if (message.recipient_id) {
      io.to(`user_${message.sender_id}`).emit('message-pin', payload);
      io.to(`user_${message.recipient_id}`).emit('message-pin', payload);

      io.to(`user_${message.sender_id}`).emit('receive-message', realtimeMessage);
      io.to(`user_${message.recipient_id}`).emit('receive-message', realtimeMessage);
    }

    return res.status(200).json({
      pinned: true, message: 'Message pinned successfully', data: newPin
    });
  } catch (error) {
    console.error('Error in togglePinMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.listDocuments = async (req,res) => {
  const currentUserId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const { documents, pagination } = await getUserDocuments(currentUserId, { page, limit });
    res.status(200).json({ documents, ...pagination });

  } catch (error) {
    console.error('Error in listDocuments:', error);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};

exports.searchDocuments = async (req,res) => {
  const currentUserId = req.user.id;
  const search = req.query.search?.toLowerCase() || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { documents, pagination } = await getUserDocuments(currentUserId, { search, page, limit });
    res.status(200).json({ documents, ...pagination });

  } catch (error) {
    console.error('Error in searchDocuments:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};