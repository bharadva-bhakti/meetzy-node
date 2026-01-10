const { db } = require('../models');
const User = db.User;
const Message = db.Message;
const MessageStatus = db.MessageStatus;
const MessageReaction = db.MessageReaction;
const MessageAction = db.MessageAction;
const MessagePin = db.MessagePin;
const Group = db.Group;
const GroupMember = db.GroupMember;
const Block = db.Block;
const Setting = db.Setting;
const Friend = db.Friend;
const MutedChat = db.MutedChat;
const Favorite = db.Favorite;
const Archive = db.Archive;
const ChatClear = db.ChatClear;
const UserSetting = db.UserSetting;
const MessageDisappearing = db.MessageDisappearing;
const Broadcast = db.Broadcast;
const UserDelete = db.UserDelete;
const BroadcastMember = db.BroadcastMember;
const ChatSetting = db.ChatSetting;
const Call = db.Call;
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose')
const {
  groupMessagesBySender, groupMessagesByDate, getMessageReactionCount, buildMessagePayloads, createMessageWithStatus, groupBroadcastMessages,
  getUserDocuments, getConversationData, processDeleteForMe, processDeleteForEveryone, deleteMessageFiles, handleBroadcastDeletion
} = require('../helper/messageHelpers');
const { getEffectiveLimits } = require('../utils/userLimits');

exports.sendMessage = async (req, res) => {
  const senderId = req.user?._id;
  const files = req.files || [];
  const singleFile = req.file;

  const {
    recipientId, groupId, broadcastId, content, message_type = 'text', metadata = null, parent_id, file_url = null, mentions, is_encrypted,
  } = req.body;

  if (!senderId) return res.status(401).json({ message: 'Unauthorized' });

  if ((!recipientId && !groupId && !broadcastId) || [recipientId, groupId, broadcastId].filter(Boolean).length > 1) {
    return res.status(400).json({ message: 'Provide recipientId, groupId or broadcastId' });
  }

  if (message_type === 'text' && !content && !files.length && !singleFile) {
    return res.status(400).json({ message: 'Message content required' });
  }

  try {
    const settings = await Setting.findOne().lean();
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
      return res.status(403).json({ message: 'Sending media files is not allowed on your current plan.' });
    }

    let validatedMentions = [];
    if (mentions?.length) {
      const users = await User.find({ _id: { $in: mentions } }).select('_id').lean();
      validatedMentions = users.map(u => u._id);
    }

    let recipientIds = [];
    let isBroadcast = false;

    if (recipientId) {
      const blockEntry = await Block.findOne({ blocker_id: senderId, blocked_id: recipientId, }).lean();
      if (blockEntry) {
        return res.status(403).json({ message: 'Cannot send message to blocked contact' });
      }
    }

    if (groupId) {
      const blockEntry = await Block.findOne({ blocker_id: senderId, group_id: groupId, block_type: 'group', }).lean();
      if (blockEntry) {
        return res.status(403).json({ message: 'Cannot send message to blocked group' });
      }
    }

    if (broadcastId) {
      isBroadcast = true;

      const broadcastResult = await Broadcast.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(broadcastId), creator_id: senderId } },
        { $lookup: { from: 'broadcast_members', localField: '_id', foreignField: 'broadcast_id', as: 'recipients'}},
        { $project: { id: '$_id', _id: 0, creator_id: 1, recipients: { recipient_id: 1 }}},
      ]);

      const broadcast = broadcastResult[0];
      if (!broadcast || !broadcast.recipients.length) {
        return res.status(400).json({ message: 'Invalid broadcast' });
      }

      recipientIds = broadcast.recipients.map(r => r.recipient_id);
    } else if (recipientId) {
      recipientIds = [recipientId];
    }

    if (groupId) {
      const member = await GroupMember.findOne({ group_id: groupId, user_id: senderId });
      if (!member) return res.status(403).json({ message: 'Not a group member' });

      const groupMemberIds = await GroupMember.find({ group_id: groupId })
        .select('user_id')
        .lean()
        .then(members => members.map(m => m.user_id));

      if (groupMemberIds.length > 0) {
        await UserDelete.deleteMany({
          target_id: new mongoose.Types.ObjectId(groupId),
          target_type: 'group',
          user_id: { $in: groupMemberIds }
        });
      }
    }

    if (recipientId) {
      const targetId = recipientId ? recipientId :  groupId;

      const deleteChat = await UserDelete.findOne({
        user_id: senderId,
        target_id: new mongoose.Types.ObjectId(targetId),
        target_type: recipientId ? 'user' : 'group',
      });
    
      if (deleteChat) {
        await UserDelete.deleteOne({ _id: deleteChat._id });
      }
    }    

    const payloads = await buildMessagePayloads({ content, message_type, metadata, files, singleFile, file_url, parent_id});

    const messages = [];
    const io = req.app.get('io');

    if (groupId) {
      for (const payload of payloads) {
        const message = await createMessageWithStatus({
          senderId, recipientId: null, groupId, payload, mentions: validatedMentions, isEncrypted, isBlocked: false,
        });

        messages.push(message);

        const groupMembers = await GroupMember.find({ group_id: groupId, user_id: { $ne: senderId } }).select('user_id').lean();

        if (groupMembers.length > 0) {
          await MessageStatus.insertMany(
            groupMembers.map(m => ({ message_id: message._id, user_id: m.user_id, status: 'sent'}))
          );
        }
      }

      const fullMessages = await Message.aggregate([
        { $match: { _id: { $in: messages.map(m => m._id) } } },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc', }},
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc', }},
        { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            id: '$_id',
            sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar', },
            group: { id: '$group_doc._id', name: '$group_doc.name', avatar: '$group_doc.avatar',},
            recipient: null,
          },
        },
        {$project: {
          _id: 0,
          id: 1,
          sender_id: 1,
          recipient_id: 1,
          parent_id: 1,
          group_id: 1,
          content: 1,
          message_type: 1,
          file_url: 1,
          file_type: 1,
          mentions: 1,
          has_unread_mentions: 1,
          metadata: 1,
          is_encrypted: 1,
          created_at: 1,
          updated_at: 1,
          deleted_at: 1,
          sender: 1,
          recipient: 1,
          group: 1,
        }},
      ]);

      const groupMembers = await GroupMember.find({ group_id: groupId }).select('user_id').lean();

      groupMembers.forEach(member => {
        io.to(`user_${member.user_id}`).emit('receive-message', fullMessages);
      });

      return res.status(201).json({ messages: fullMessages });
    }

    const blockedRecipients = new Set();

    const broadcastMessageId = new mongoose.Types.ObjectId().toString();

    for (const rid of recipientIds) {
      const recipientBlockedSender = await Block.findOne({
        blocker_id: rid,
        blocked_id: senderId,
      }).lean();

      if (recipientBlockedSender) {
        blockedRecipients.add(rid.toString());
      }

      for (const payload of payloads) {
        const isBlocked = blockedRecipients.has(rid.toString());

        const msg = await createMessageWithStatus({
          senderId,
          recipientId: isBroadcast ? rid : recipientId,
          groupId,
          payload: isBroadcast
            ? { ...payload, metadata: { ...payload.metadata, is_broadcast: true, broadcast_id: broadcastId, broadcast_message_id: broadcastMessageId }}
            : payload,
          mentions: validatedMentions,
          isEncrypted,
          isBlocked,
        });

        messages.push(msg);
      }
    }

    const fullMessages = await Message.aggregate([
      { $match: { _id: { $in: messages.map(m => m._id) } } },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc', }, },
      { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc'}},
      { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          id: '$_id',
          sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar', is_verified: '$sender_doc.is_verified'},
          recipient: { id: '$recipient_doc._id', name: '$recipient_doc.name', avatar: '$recipient_doc.avatar', is_verified: '$sender_doc.is_verified'},
          group: null,
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          sender_id: 1,
          recipient_id: 1,
          group_id: 1,
          parent_id: 1,
          content: 1,
          message_type: 1,
          file_url: 1,
          file_type: 1,
          mentions: 1,
          has_unread_mentions: 1,
          metadata: 1,
          is_encrypted: 1,
          created_at: 1,
          updated_at: 1,
          deleted_at: 1,
          sender: 1,
          recipient: 1,
          group: 1,
        },
      },
    ]);

    if (isBroadcast) {
      const mergedMessages = groupBroadcastMessages(fullMessages, senderId);

      if (mergedMessages.length > 0) {
        io.to(`user_${senderId}`).emit('receive-message', mergedMessages[0]);
      }

      const recipientMessageMap = new Map();
      fullMessages.forEach(msg => {
        if (msg.recipient_id) {
          recipientMessageMap.set(msg.recipient_id.toString(), msg);
        }
      });

      recipientIds.forEach(recipientId => {
        const msg = recipientMessageMap.get(recipientId.toString());
        if (msg) {
          io.to(`user_${recipientId}`).emit('receive-message', msg);
          io.to(`user_${senderId}`).emit('receive-message', msg);
        }
      });
    } else {
      fullMessages.forEach(msg => {
        io.to(`user_${senderId}`).emit('receive-message', msg);

        if (msg.recipient_id) {
          const recipientIdStr = msg.recipient_id.toString();
          if (blockedRecipients.has(recipientIdStr)) {
            return;
          }
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
  const userId = req.user._id;
  const { limit = 50, offset = 0, recipientId, groupId, isAnnouncement = false, isBroadcast = false, broadcastId, announcementId } = req.query;

  try {
    let messages = [];
    let chatTarget = {};
    let isChatLocked = false;

    const userSetting = await UserSetting.findOne({ user_id: userId }).lean();

    const checkLockedChat = (type, id) => {
      if (userSetting?.chat_lock_enabled && Array.isArray(userSetting.locked_chat_ids)) {
        return userSetting.locked_chat_ids.some(chat => chat.type === type && chat.id.toString() === id.toString());
      }
      return false;
    };

    let clearFilter = null;
    if (recipientId) {
      const clearEntry = await ChatClear.findOne({ 
        user_id: userId, recipient_id: new mongoose.Types.ObjectId(recipientId) 
      }).lean();
      if (clearEntry) clearFilter = { created_at: { $gt: clearEntry.cleared_at } };

    } else if (groupId) {
      const clearEntry = await ChatClear.findOne({ 
        user_id: userId, group_id: new mongoose.Types.ObjectId(groupId) 
      }).lean();
      if (clearEntry) clearFilter = { created_at: { $gt: clearEntry.cleared_at } };

    } else if (isBroadcast === 'true' && broadcastId) {
      const clearEntry = await ChatClear.findOne({ 
        user_id: userId, broadcast_id: new mongoose.Types.ObjectId(broadcastId) 
      }).lean();
      if (clearEntry) clearFilter = { created_at: { $gt: clearEntry.cleared_at } };
    }
    
    const getCommonChatMeta = async (targetType, targetId) => {
      const whereCondition = targetId ? { user_id: userId, target_id: targetId, target_type: targetType } : null;
      if (!whereCondition) return {};

      const [muteEntry, favoriteEntry, archiveEntry] = await Promise.all([
        MutedChat.findOne(whereCondition),
        Favorite.findOne(whereCondition),
        Archive.findOne(whereCondition),
      ]);

      return {
        isMuted: !!muteEntry,
        isFavorite: !!favoriteEntry,
        isArchived: !!archiveEntry,
      };
    };

    const addStatusesAndReactions = [
      { $lookup: { from: 'message_statuses', localField: '_id', foreignField: 'message_id', as: 'statuses' } },
      {
        $addFields: {
          statuses: {
            $map: {
              input: '$statuses',
              as: 's',
              in: { user_id: '$$s.user_id', status: '$$s.status', updated_at: '$$s.updated_at' },
            },
          },
        },
      },
      { $lookup: { from: 'message_reactions', localField: '_id', foreignField: 'message_id', as: 'reaction_docs' } },
      { $lookup: { from: 'users', localField: 'reaction_docs.user_id', foreignField: '_id', as: 'reaction_users' } },
      {
        $addFields: {
          reactions: {
            $map: {
              input: '$reaction_docs',
              as: 'r',
              in: {
                emoji: '$$r.emoji',
                user: {
                  id: '$$r.user_id',
                  name: {
                    $let: {
                      vars: { u: { $arrayElemAt: [ { $filter: { input: '$reaction_users', as: 'u', cond: { $eq: ['$$u._id', '$$r.user_id'] } } }, 0 ] } },
                      in: { $ifNull: ['$$u.name', 'Unknown'] }
                    }
                  },
                  avatar: {
                    $let: {
                      vars: { u: { $arrayElemAt: [ { $filter: { input: '$reaction_users', as: 'u', cond: { $eq: ['$$u._id', '$$r.user_id'] } } }, 0 ] } },
                      in: { $ifNull: ['$$u.avatar', null] }
                    }
                  },
                },
              },
            },
          },
        },
      },
      { $lookup: { from: 'message_actions', localField: '_id', foreignField: 'message_id', as: 'action_docs' }},
      {
        $addFields: {
          actions: {
            $map: {
              input: '$action_docs',
              as: 'a',
              in: {action_type: '$$a.action_type',user_id: '$$a.user_id',details: '$$a.details',created_at: '$$a.created_at',},
            },
          },
        },
      },
      {
        $lookup: {
          from: 'message_pins',
          let: { msgId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$message_id', '$$msgId'] } } },
            { $lookup: { from: 'users', localField: 'pinned_by', foreignField: '_id', as: 'pinner_doc' }},
            { $unwind: { path: '$pinner_doc', preserveNullAndEmptyArrays: true } },
            { $addFields: { id: '$_id', pinner: { id: '$pinner_doc._id', name: '$pinner_doc.name', avatar: '$pinner_doc.avatar' }}},
            { $project: { _id: 0, id: 1, message_id: 1, pinned_by: 1, pinned_until: 1, pinner: 1 } },
          ],
          as: 'pin_docs',
        },
      },
      { $addFields: { pin: { $arrayElemAt: ['$pin_docs', 0] }}},
      { $lookup: { from: 'message_disappearings', localField: '_id', foreignField: 'message_id', as: 'disappearing_docs' }},
      { $addFields: { disappearing: { $arrayElemAt: ['$disappearing_docs', 0] }}},
      {
        $addFields: {
          disappearing: {
            $cond: [
              { $eq: ['$disappearing', null] },
              null,
              {
                enabled: '$disappearing.enabled',
                expire_after_seconds: '$disappearing.expire_after_seconds',
                expire_at: '$disappearing.expire_at',
                metadata: '$disappearing.metadata',
              },
            ],
          },
        },
      },
      { $lookup: { from: 'messages', localField: 'parent_id', foreignField: '_id', as: 'parent_message_doc' }},
      { $unwind: { path: '$parent_message_doc', preserveNullAndEmptyArrays: true }},
      { $lookup: { from: 'users', localField: 'parent_message_doc.sender_id', foreignField: '_id', as: 'parent_sender_doc' }},
      { $unwind: { path: '$parent_sender_doc', preserveNullAndEmptyArrays: true }},
      {
        $addFields: {
          parent: {
            $cond: [
              { $eq: ['$parent_message_doc', null] },
              null,
              {
                id: '$parent_message_doc._id',
                content: '$parent_message_doc.content',
                message_type: '$parent_message_doc.message_type',
                file_url: '$parent_message_doc.file_url',
                created_at: '$parent_message_doc.created_at',
                sender: { id: '$parent_sender_doc._id', name: '$parent_sender_doc.name', avatar: '$parent_sender_doc.avatar' }
              }
            ]
          }
        }
      }
    ];

    const commonProject = {
      _id: 0,
      id: 1,
      sender_id: 1,
      recipient_id: 1,
      group_id: 1,
      content: 1,
      message_type: 1,
      file_url: 1,
      file_type: 1,
      mentions: 1,
      has_unread_mentions: 1,
      metadata: 1,
      is_encrypted: 1,
      created_at: 1,
      updated_at: 1,
      deleted_at: 1,
      sender: 1,
      parent: 1,
      statuses: 1,
      reactions: 1,
      actions: 1,
      pin: 1,
      disappearing: 1,
    };

    if (isAnnouncement === 'true' || isAnnouncement === true) {
      if (!announcementId) return res.status(404).json({ message: 'Announcement Id is required.' });

      const pipeline = [
        { $match: { message_type: 'announcement', recipient_id: null, group_id: null } },
        ...(clearFilter ? [{ $match: clearFilter }] : []),
        { $sort: { created_at: -1 } },
        { $skip: parseInt(offset) },
        { $limit: parseInt(limit) },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' }},
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $addFields: {id: '$_id',sender: {id: '$sender_doc._id',name: '$sender_doc.name',avatar: '$sender_doc.avatar'}}},
        { $project: { _id: 0, id: 1, sender_id: 1, content: 1, message_type: 1, file_url: 1, metadata: 1, created_at: 1, sender: 1}},
      ];

      messages = await Message.aggregate(pipeline);

      const groupedMessages = await groupMessagesBySender(messages, userId);
      const dateGroupedMessages = groupMessagesByDate(groupedMessages);

      const commonMeta = await getCommonChatMeta('announcement', announcementId);

      chatTarget = {
        type: 'direct',
        name: 'Announcements',
        isAnnouncement: true,
        ...commonMeta,
        isBlocked: false,
        hasBlockedMe: false,
        blockedBy: null,
      };

      return res.json({
        messages: dateGroupedMessages,
        chatTarget,
        metadata: { offset, limit, hasMore: messages.length === parseInt(limit), messageCount: messages.length, isChatLocked},
      });
    }

    if (isBroadcast === 'true' || isBroadcast === true) {
      if (!broadcastId) return res.status(400).json({ message: 'broadcastId is required' });
    
      isChatLocked = checkLockedChat('broadcast', broadcastId);
    
      const broadcast = await Broadcast.findById(broadcastId).lean({ virtuals: true });
      if (!broadcast || broadcast.creator_id.toString() !== userId.toString()) {
        return res.status(404).json({ message: 'Broadcast not found or access denied' });
      }
    
      const pipeline = [
        { $match: { 
          sender_id: userId, 
          'metadata.is_broadcast': true, 
          'metadata.broadcast_id': broadcastId.toString()
        }},
        ...(clearFilter ? [{ $match: clearFilter }] : []),
        {
          $group: {
            _id: '$metadata.broadcast_message_id',
            doc: { $first: '$$ROOT' },
            // Collect all recipient_ids for status tracking
            recipient_ids: { $push: '$recipient_id' },
            // Collect all statuses
            all_statuses: { $push: '$_id' }
          }
        },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { created_at: -1 } },
        { $skip: parseInt(offset) },
        { $limit: parseInt(limit) },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            id: '$_id',
            sender: { 
              id: '$sender_doc._id', 
              name: '$sender_doc.name', 
              avatar: '$sender_doc.avatar' 
            },
          }
        },
        ...addStatusesAndReactions,
        { $project: { ...commonProject, group: null, recipient: null } },
      ];
    
      let messages = await Message.aggregate(pipeline);
    
      messages = messages.filter(msg => {
        const actions = msg.actions || [];
        const deletedForMe = actions.some(a =>
          a.user_id?.toString() === userId.toString() &&
          a.action_type === 'delete' &&
          a.details?.type === 'me'
        );
        const deletedForEveryone = actions.some(a => a.action_type === 'delete' && a.details?.type === 'everyone');
    
        if (deletedForMe && !deletedForEveryone) return false;
        if (deletedForEveryone) {
          msg.content = 'This message was deleted';
          msg.isDeleted = true;
          msg.isDeletedForEveryone = true;
        }
        return true;
      });
    
      const groupedMessages = await groupMessagesBySender(messages, userId);
      const dateGroupedMessages = groupMessagesByDate(groupedMessages);
    
      const commonMeta = await getCommonChatMeta('broadcast', broadcastId);
    
      chatTarget = {
        id: broadcastId,
        name: broadcast.name || 'Broadcast',
        avatar: null,
        type: 'broadcast',
        broadcast_id: broadcastId,
        recipient_count: broadcast.recipients?.length || 0,
        ...commonMeta,
        isBlocked: false,
        hasBlockedMe: false,
        canSendMessages: true,
        canReceiveMessages: true,
      };
    
      return res.json({
        messages: dateGroupedMessages,
        chatTarget,
        metadata: {
          offset,
          limit,
          hasMore: messages.length === parseInt(limit),
          messageCount: messages.length,
          isChatLocked,
        },
      });
    }  

    if (groupId) {
      isChatLocked = checkLockedChat('group', groupId);
    
      const group = await Group.findById(groupId).lean({ virtuals: true });
      if (!group) return res.status(404).json({ message: 'Group not found' });
    
      const groupObjId = new mongoose.Types.ObjectId(groupId);
    
      if (isChatLocked) {
        const pin = req.query.pin;
        if (!pin) return res.status(400).json({ message: 'PIN_REQUIRED' });
        if (!userSetting.pin_hash) return res.status(400).json({ message: 'Set Your Pin first.' });
        const match = await bcrypt.compare(pin, userSetting.pin_hash);
        if (!match) return res.status(400).json({ message: 'INVALID_PIN' });
      }
    
      const pipeline = [
        { $match: { group_id: groupObjId } },
        ...(clearFilter ? [{ $match: clearFilter }] : []),
        { $sort: { created_at: -1 } },
        { $skip: parseInt(offset) },
        { $limit: parseInt(limit) },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' } },
        { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            id: '$_id',
            sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar' },
            group: { id: '$group_doc._id', name: '$group_doc.name', avatar: '$group_doc.avatar' },
            recipient: { id: null, name: null, avatar: null },
          },
        },
        ...addStatusesAndReactions,
        { $project: { ...commonProject, recipient: { id: null, name: null, avatar: null }, group: 1 } },
      ];
    
      let messages = await Message.aggregate(pipeline);
    
      const callMessageIds = messages
        .filter(m => m.message_type === 'call' && m.metadata?.call_id)
        .map(m => m.metadata.call_id);
    
      let callDataMap = {};
    
      if (callMessageIds.length > 0) {
        const calls = await Call.aggregate([
          { $match: { _id: { $in: callMessageIds.map(id => new mongoose.Types.ObjectId(id)) } } },
          { $lookup: { from: 'call_participants', localField: '_id', foreignField: 'call_id', as: 'participants', }, },
          { $lookup: { from: 'users', localField: 'participants.user_id', foreignField: '_id', as: 'participant_users' }},
          {
            $addFields: {
              participants: {
                $map: {
                  input: '$participants',
                  as: 'p',
                  in: {
                    user_id: '$$p.user_id',
                    status: '$$p.status',
                    user: {
                      $arrayElemAt: [{ $filter: { input: '$participant_users', as: 'u', cond: { $eq: ['$$u._id', '$$p.user_id']}}}, 0 ]
                    }
                  }
                }
              }
            }
          },
          {
            $project: {
              _id: 1,
              duration: 1,
              participants: { user_id: 1, status: 1, 'user.id': 1, 'user.name': 1, 'user.avatar': 1 }
            }
          }
        ]);
    
        callDataMap = Object.fromEntries(
          calls.map(call => [
            call._id.toString(),
            {
              ...call,
              participants: call.participants.map(p => ({
                user_id: p.user_id,
                status: p.status,
                user: p.user ? { id: p.user.id, name: p.user.name, avatar: p.user.avatar } : null
              }))
            }
          ])
        );
      }
    
      messages = messages.map(msg => {
        if (msg.message_type !== 'call' || !msg.metadata?.call_id) return msg;
    
        const callIdStr = msg.metadata.call_id.toString();
        const call = callDataMap[callIdStr];
    
        if (!call) return msg;
    
        const participant = call.participants.find(p => p.user_id.toString() === userId.toString());
        const userStatus = participant?.status || 'missed';
    
        let displayText = '📞 Group call';
    
        if (call.duration === 0) {
          displayText = '📞 Missed call';
        }
    
        if (userStatus === 'declined') {
          displayText = '❌ You declined the call';
        } else if (userStatus === 'missed') {
          displayText = '📞 Missed group call';
        } else if (userStatus === 'joined' || userStatus === 'left') {
          displayText = `✅ Call ended ${call.duration ? `(${call.duration}s)` : ''}`;
        }
    
        msg.content = displayText;
        msg.metadata.call_summary = {
          totalParticipants: call.participants.length,
          joined: call.participants.filter(p => p.status === 'joined').map(p => p.user?.name).filter(Boolean),
          declined: call.participants.filter(p => p.status === 'declined').map(p => p.user?.name).filter(Boolean),
          missed: call.participants.filter(p => p.status === 'missed').map(p => p.user?.name).filter(Boolean),
        };
    
        return msg;
      });
    
      const groupedMessages = await groupMessagesBySender(messages, userId);
      const dateGroupedMessages = groupMessagesByDate(groupedMessages);
    
      const commonMeta = await getCommonChatMeta('group', groupId);
      const groupBlockEntry = await Block.findOne({ blocker_id: userId, group_id: groupId, block_type: 'group' });
    
      chatTarget = {
        id: group._id.toString(),
        name: group.name,
        avatar: group.avatar,
        description: group.description || null,
        type: 'group',
        ...commonMeta,
        isBlocked: !!groupBlockEntry,
      };
    
      return res.json({
        messages: dateGroupedMessages,
        chatTarget,
        metadata: {
          offset,
          limit,
          hasMore: messages.length === parseInt(limit),
          messageCount: messages.length,
          isChatLocked,
        },
      });
    }

    if (recipientId) {
      isChatLocked = checkLockedChat('user', recipientId);
    
      const recipient = await User.findById(recipientId).lean({ virtuals: true });
      if (!recipient) return res.status(404).json({ message: 'User not found' });
    
      const userObjId = new mongoose.Types.ObjectId(userId);
      const recipientObjId = new mongoose.Types.ObjectId(recipientId);
    
      if (isChatLocked) {
        const pin = req.query.pin;
        if (!pin) return res.status(400).json({ message: 'PIN_REQUIRED' });
    
        if (!userSetting.pin_hash) {
          return res.status(400).json({ message: 'Set Your Pin first.' });
        }
    
        const match = await bcrypt.compare(pin, userSetting.pin_hash);
        if (!match) return res.status(400).json({ message: 'INVALID_PIN' });
      }
    
      const pipeline = [
        {
          $match: {
            $or: [
              { sender_id: userObjId, recipient_id: recipientObjId },
              { sender_id: recipientObjId, recipient_id: userObjId },
            ],
          },
        },
        ...(clearFilter ? [{ $match: clearFilter }] : []),
        { $sort: { created_at: -1 } },
        { $skip: parseInt(offset) },
        { $limit: parseInt(limit) },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc' } },
        { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            id: '$_id',
            sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar' },
            recipient: { id: '$recipient_doc._id', name: '$recipient_doc.name', avatar: '$recipient_doc.avatar' },
            group: null,
          },
        },
        ...addStatusesAndReactions,
        { $project: { ...commonProject, group: 1 } },
      ];
    
      let messages = await Message.aggregate(pipeline);
      
      const [iBlockedThem, theyBlockedMe] = await Promise.all([
        Block.findOne({ blocker_id: userId, blocked_id: new mongoose.Types.ObjectId(recipientId) }).lean(),        
        Block.findOne({ blocker_id: new mongoose.Types.ObjectId(recipientId), blocked_id: userId }).lean(),
      ]);
      
      if (iBlockedThem) {
        const blockTime = new Date(iBlockedThem.created_at);
    
        messages = messages.filter(msg => {
          if (msg.sender_id.toString() === userId.toString()) return true;

          return new Date(msg.created_at) <= blockTime;
        });
      }
    
      const groupedMessages = await groupMessagesBySender(messages, userId);
      const dateGroupedMessages = groupMessagesByDate(groupedMessages);
    
      const commonMeta = await getCommonChatMeta('user', recipientId);
    
      const friendEntry = await Friend.findOne({
        $or: [{ user_id: userId, friend_id: recipientId }, { user_id: recipientId, friend_id: userId }],
      });
    
      const canSendMessages = !iBlockedThem && !theyBlockedMe;
      const canReceiveMessages = !theyBlockedMe;
    
      chatTarget = {
        id: recipient._id.toString(),
        avatar: recipient.avatar,
        name: recipient.name,
        bio: recipient.bio,
        email: recipient.email,
        country: recipient.country || null,
        country_code: recipient.country_code || null,
        phone: recipient.phone || null,
        role: recipient.role || 'user',
        email_verified: recipient.email_verified || false,
        last_login: recipient.last_login || null,
        is_online: recipient.is_online || false,
        last_seen: recipient.last_seen || null,
        status: recipient.status || 'active',
        public_key: recipient.public_key || null,
        private_key: recipient.private_key || null,
        stripe_customer_id: recipient.stripe_customer_id || null,
        is_verified: recipient.is_verified || false,
        verified_at: recipient.verified_at || null,
        created_at: recipient.created_at,
        updated_at: recipient.updated_at,
        deleted_at: recipient.deleted_at || null,
        type: 'direct',
        ...commonMeta,
        isBlocked: !!iBlockedThem,
        hasBlockedMe: !!theyBlockedMe,
        blockedBy: theyBlockedMe ? { id: theyBlockedMe.blocker_id.toString() } : null,
        blockedAt: iBlockedThem?.created_at || null,
        isFriend: !!friendEntry,
        canSendMessages,
        canReceiveMessages,
      };
    
      return res.json({
        messages: dateGroupedMessages,
        chatTarget,
        metadata: {
          offset,
          limit,
          hasMore: messages.length === parseInt(limit),
          messageCount: messages.length,
          isChatLocked,
        },
      });
    }

    return res.status(400).json({ message: 'Provide groupId or recipientId' });
  } catch (error) {
    console.error('Error in getMessages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.markMessagesAsRead = async (req, res) => {
  const { chat_id, chat_type } = req.body;
  const userId = req.user._id;

  try {
    let match = {};

    if (chat_type === 'group') {
      match = { group_id: chat_id };
    } else if (chat_type === 'direct') {
      match = { $or: [ { sender_id: userId, recipient_id: chat_id }, { sender_id: chat_id, recipient_id: userId }]};
    } else {
      return res.status(400).json({ message: 'Invalid chat_type' });
    }

    const unreadStatuses = await MessageStatus.find({
      user_id: userId,
      status: { $ne: 'seen' },
      message_id: { $in: await Message.find(match).distinct('_id') },
    }).lean();

    if (unreadStatuses.length === 0) {
      return res.status(200).json({ message: 'No unread messages.' });
    }

    await MessageStatus.updateMany(
      { message_id: { $in: unreadStatuses.map(s => s.message_id) }, user_id: userId },
      { status: 'seen' }
    );

    const now = new Date();

    for (const status of unreadStatuses) {
      const disappearing = await MessageDisappearing.findOne({ message_id: status.message_id });
      if (!disappearing || !disappearing.enabled || disappearing.expire_at) continue;

      const now = new Date();

      if (disappearing.expire_after_seconds === null) {
        await MessageDisappearing.updateOne(
          { _id: disappearing._id },
          {
            $set: {
              expire_at: now,
              metadata: { 
                ...(disappearing.metadata || {}), 
                immediate_disappear: true 
              }
            }
          }
        );
      } else {
        const expireAt = new Date(now.getTime() + disappearing.expire_after_seconds * 1000);
        await MessageDisappearing.updateOne(
          { _id: disappearing._id },
          { $set: { expire_at: expireAt } }
        );
      }
    }

    await Message.updateMany({ ...match, has_unread_mentions: true },{ has_unread_mentions: false });

    const io = req.app.get('io');
    if (io) {
      if (chat_type === 'group') {
        io.to(`user_${userId}`).emit('messages-read', {
          groupId: chat_id.toString(),
          chatId: chat_id.toString(),
          chatType: 'group',
        });
      } else {
        io.to(`user_${userId}`).emit('messages-read', {
          readerId: chat_id.toString(),
          chatId: chat_id.toString(),
          chatType: 'direct',
        });
      }
    }

    return res.status(200).json({ message: 'Messages marked as read successfully.' });
  } catch (error) {
    console.error('Error in markMessagesAsRead:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.toggleReaction = async (req, res) => {
  const userId = req.user._id;
  const { messageId, emoji } = req.body;

  if (!messageId || !emoji) {
    return res.status(400).json({ message: 'Message Id and Emoji are required' });
  }

  if (typeof emoji !== 'string' || emoji.length > 10) {
    return res.status(400).json({ message: 'Invalid Emoji' });
  }

  try {
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ message: 'Message Not Found.' });

    const isDirect = message.recipient_id && !message.group_id;
    const isGroup = message.group_id;

    if (isDirect && ![message.sender_id.toString(), message.recipient_id.toString()].includes(userId.toString())) {
      return res.status(403).json({ message: 'Access Denied' });
    }

    if (isGroup) {
      const membership = await GroupMember.findOne({ group_id: message.group_id, user_id: userId });
      if (!membership) return res.status(403).json({ message: 'Access Denied' });
    }

    const existingReaction = await MessageReaction.findOne({ message_id: messageId, user_id: userId, emoji });

    let action;
    let reaction;

    if (existingReaction) {
      await existingReaction.deleteOne();
      action = 'removed';
    } else {
      const differentReaction = await MessageReaction.findOne({ message_id: messageId, user_id: userId });

      if (differentReaction) {
        await differentReaction.updateOne({ emoji });
        reaction = differentReaction;
      } else {
        reaction = await MessageReaction.create({ message_id: messageId, user_id: userId, emoji });
      }
      action = 'added';
    }

    const reactionCounts = await getMessageReactionCount(messageId, userId);
    const io = req.app.get('io');

    if (message.group_id) {
      io.to(`group_${message.group_id}`).emit('message-reaction-updated', { messageId, reactions: reactionCounts });
    } else if (message.sender_id && message.recipient_id) {
      io.to(`user_${message.sender_id}`).emit('message-reaction-updated', { messageId, reactions: reactionCounts });
      io.to(`user_${message.recipient_id}`).emit('message-reaction-updated', { messageId, reactions: reactionCounts });
    }

    return res.status(200).json({
      action,
      reaction: reaction ? { id: reaction.id, message_id: messageId, user_id: userId, emoji } : null,
      reactionCounts,
    });
  } catch (error) {
    console.error('Error in toggleReaction:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleStarMessage = async (req, res) => {
  let { messageIds, isStarred } = req.body;
  const currentUserId = req.user._id;
  const io = req.app.get('io');

  try {
    if (!Array.isArray(messageIds)) messageIds = [messageIds];

    const messages = await Message.find({ _id: { $in: messageIds } }).lean({ virtuals: true });
    if (messages.length === 0) {
      return res.status(404).json({ message: 'Messages not found.' });
    }

    for (const msg of messages) {
      if (msg.group_id) {
        const isMember = await GroupMember.findOne({ group_id: msg.group_id, user_id: currentUserId });
        if (!isMember) return res.status(403).json({ message: 'Access Denied - not in group' });
      } else if (msg.sender_id.toString() !== currentUserId.toString() && msg.recipient_id?.toString() !== currentUserId.toString()) {
        return res.status(403).json({ message: 'Access Denied.' });
      }
    }

    const existing = await MessageAction.find({message_id: { $in: messageIds },user_id: currentUserId,action_type: 'star',}).lean();

    const existingIds = existing.map(e => e.message_id.toString());
    let affectedIds = [];

    if (isStarred) {
      const toInsert = messageIds
        .filter(id => !existingIds.includes(id.toString()))
        .map(id => ({ message_id: id, user_id: currentUserId, action_type: 'star' }));

      if (toInsert.length > 0) {
        await MessageAction.insertMany(toInsert);
      }

      affectedIds = toInsert.map(i => i.message_id.toString());
    } else {
      if (existing.length > 0) {
        await MessageAction.deleteMany({message_id: { $in: existingIds },user_id: currentUserId,action_type: 'star',});
      }

      affectedIds = existingIds;
    }

    if (io && affectedIds.length > 0) {
      io.to(`user_${currentUserId}`).emit('message-favorite', {messageId: affectedIds,isStarred,userId: currentUserId,});
    }

    return res.status(200).json({
      action: isStarred ? 'starred' : 'unstarred',
      message: `Messages ${isStarred ? 'starred' : 'un-starred'} successfully`,
      messageIds: affectedIds,
      isStarred,
    });
  } catch (error) {
    console.error('Error in toggleStarMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.editMessage = async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user._id;
  const { content, is_encrypted } = req.body;

  if (!content) {
    return res.status(400).json({ message: 'Content is required' });
  }

  try {
    const messageObjId = new mongoose.Types.ObjectId(messageId);

    const message = await Message.findById(messageObjId).lean();
    if (!message) return res.status(404).json({ message: 'Message not found' });

    if (message.sender_id.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'You are not authorized to edit the message.' });
    }

    if (message.message_type !== 'text') {
      return res.status(400).json({ message: 'Only text messages can be edited' });
    }

    const oldContent = message.content;

    const updateData = { content };
    if (is_encrypted !== undefined) updateData.is_encrypted = is_encrypted;

    await Message.updateOne({ _id: messageObjId }, { $set: updateData });

    const existingAction = await MessageAction.findOne({
      message_id: messageObjId,
      user_id: userId,
      action_type: 'edit',
    });

    if (existingAction) {
      await existingAction.updateOne({details: { old_content: oldContent, new_content: content },});
    } else {
      await MessageAction.create({
        message_id: messageObjId,
        user_id: userId,
        action_type: 'edit',
        details: { old_content: oldContent, new_content: content },
      });
    }

    const updatedMessages = await Message.aggregate([
      { $match: { _id: messageObjId } },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' }},
      { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc' }},
      { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          id: '$_id',
          sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar' },
          recipient: message.recipient_id
            ? {id: '$recipient_doc._id',name: '$recipient_doc.name',avatar: '$recipient_doc.avatar',}
            : null,
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          sender_id: 1,
          recipient_id: 1,
          group_id: 1,
          content: 1,
          message_type: 1,
          file_url: 1,
          file_type: 1,
          mentions: 1,
          has_unread_mentions: 1,
          metadata: 1,
          is_encrypted: 1,
          created_at: 1,
          updated_at: 1,
          deleted_at: 1,
          sender: 1,
          recipient: 1,
        },
      },
    ]);

    const updatedMessage = updatedMessages[0];

    const io = req.app.get('io');

    if (message.group_id) {
      io.to(`group_${message.group_id}`).emit('message-updated', updatedMessage);
    } else if (message.recipient_id) {
      io.to(`user_${message.sender_id}`).emit('message-updated', updatedMessage);
      io.to(`user_${message.recipient_id}`).emit('message-updated', updatedMessage);
    }

    return res.status(200).json({ message: 'Message Edited Successfully' });
  } catch (error) {
    console.error('Error in editMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.forwardMessage = async (req, res) => {
  const senderId = req.user._id;
  let { messageIds, recipients, encryptedContents } = req.body;

  try {
    if (!messageIds || !recipients || recipients.length === 0) {
      return res.status(400).json({ message: 'messageIds and recipients are required.' });
    }

    if (!Array.isArray(messageIds)) messageIds = [messageIds];

    const originalObjIds = messageIds.map(id => new mongoose.Types.ObjectId(id));

    const originals = await Message.find({ _id: { $in: originalObjIds } }).lean();
    if (originals.length === 0) return res.status(404).json({ message: 'Message(s) not found.' });

    const forwardedMessageIds = [];
    const io = req.app.get('io');

    const getFullMessagePipeline = (messageId) => [
      { $match: { _id: messageId } },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
      { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc' } },
      { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' } },
      { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'message_actions', localField: '_id', foreignField: 'message_id', as: 'action_docs' } },
      {
        $addFields: {
          id: '$_id',
          sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar'},
          recipient: {
            $cond: [
              { $ifNull: ['$recipient_id', false] },
              { id: '$recipient_doc._id', name: '$recipient_doc.name', avatar: '$recipient_doc.avatar', }, null,
            ],
          },
          group: {
            $cond: [
              { $ifNull: ['$group_id', false] },
              { id: '$group_doc._id', name: '$group_doc.name', avatar: '$group_doc.avatar' }, null,
            ],
          },
          actions: {
            $map: {
              input: '$action_docs',
              as: 'a',
              in: {
                id: '$$a._id',
                message_id: '$$a.message_id',
                user_id: '$$a.user_id',
                action_type: '$$a.action_type',
                details: '$$a.details',
                createdAt: '$$a.created_at',
                updatedAt: '$$a.updated_at',
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          sender_id: 1,
          recipient_id: 1,
          group_id: 1,
          content: 1,
          message_type: 1,
          file_url: 1,
          file_type: 1,
          mentions: 1,
          has_unread_mentions: 1,
          metadata: 1,
          is_encrypted: 1,
          created_at: 1,
          updated_at: 1,
          deleted_at: 1,
          sender: 1,
          recipient: 1,
          group: 1,
          actions: 1,
        },
      },
    ];

    for (const existing of originals) {
      const fileMetadata = {};
      const fileKeys = [
        'file_size', 'mime_type', 'file_index', 'is_multiple', 'original_filename', 'title', 'redirect_url', 'sent_by_admin', 'announcement_type'
      ];
      if (existing.metadata) {
        fileKeys.forEach(key => { if (existing.metadata[key]) fileMetadata[key] = existing.metadata[key]; });
      }

      for (const rec of recipients) {
        if (!rec?.type || !rec.id) continue;

        const isGroup = rec.type === 'group';
        const recipient_id = isGroup ? null : rec.id;
        const group_id = isGroup ? rec.id : null;

        if (isGroup) {
          const isMember = await GroupMember.findOne({ group_id, user_id: senderId });
          if (!isMember) continue;
        }

        let contentToUse = existing.content;
        let isEncryptedToUse = existing.is_encrypted || false;

        if (encryptedContents && encryptedContents[existing._id.toString()]) {
          const encryptedForRecipient = encryptedContents[existing._id.toString()];
          const settings = await Setting.findOne().lean();
          const e2eEnabled = settings?.e2e_encryption_enabled;

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

        forwardedMessageIds.push(forwardMessage._id);

        if (isGroup) {
          const members = await GroupMember.find({ group_id }).select('user_id').lean();
          await MessageStatus.insertMany(
            members.filter(m => m.user_id.toString() !== senderId.toString())
              .map(m => ({ message_id: forwardMessage._id, user_id: m.user_id, status: 'sent' }))
          );
        } else {
          await MessageStatus.create({ message_id: forwardMessage._id, user_id: recipient_id, status: 'sent' });
        }

        await MessageAction.create({
          message_id: forwardMessage._id,
          user_id: senderId,
          action_type: 'forward',
          details: { original_message_id: existing._id, original_sender_id: existing.sender_id },
        });

        const fullMessages = await Message.aggregate(getFullMessagePipeline(forwardMessage._id));
        const fullMessage = fullMessages[0];

        if (fullMessage && io) {
          const emitData = {
            ...fullMessage,
            isForwarded: true,
            is_encrypted: fullMessage.is_encrypted || false,
          };

          if (isGroup) {
            const members = await GroupMember.find({ group_id }).select('user_id').lean();
            members.forEach(member => {
              io.to(`user_${member.user_id}`).emit('receive-message', emitData);
            });
          } else {
            io.to(`user_${recipient_id}`).emit('receive-message', emitData);
            io.to(`user_${senderId}`).emit('receive-message', emitData);
          }
        }
      }
    }

    const finalMessages = await Message.aggregate([
      { $match: { _id: { $in: forwardedMessageIds.map(id => new mongoose.Types.ObjectId(id)) } } },
      ...getFullMessagePipeline(null),
    ].flat());

    return res.status(200).json({ count: finalMessages.length, messages: finalMessages });
  } catch (error) {
    console.error('Error in forwardMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteMessage = async (req, res) => {
  const userId = req.user._id;
  const { messageIds, deleteType, isBroadcast = false, broadcastId } = req.body;

  try {
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ message: 'Invalid message IDs' });
    }

    const objectIds = messageIds.map(id => new mongoose.Types.ObjectId(id));
    const messages = await Message.find({ _id: { $in: objectIds } }).lean({ virtuals: true });

    if (messages.length === 0) {
      return res.status(404).json({ message: 'Messages not found' });
    }

    const io = req.app.get('io');

    if (isBroadcast && broadcastId) {
      return await handleBroadcastDeletion({ userId, messages, isBroadcast, messageIds, deleteType, broadcastId, io, res,});
    }

    const userMessages = messages.filter(m => m.sender_id.toString() === userId.toString());
    const otherMessages = messages.filter(m => m.sender_id.toString() !== userId.toString());

    const { newPrevMessagesMap } = await getConversationData(messages, messageIds);

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
      deleteActions.length > 0 ? MessageAction.insertMany(deleteActions) : null,
      ...socketEvents.map(event => io.to(event.room).emit('message-deleted', event.payload)),
    ]);

    if (deleteType === 'delete-for-everyone' && userMessages.length > 0) {
      await deleteMessageFiles(userMessages);
    }

    return res.status(200).json({
      message: 'Message deleted successfully.',
      deletedForEveryone: deleteType === 'delete-for-everyone' ? userMessages.length : 0,
      deletedForMe: deleteType === 'delete-for-me' ? messages.length : otherMessages.length,
    });
  } catch (error) {
    console.error('Error in deleteMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleDisappearingMessages = async (req, res) => {
  const userId = req.user._id;
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
      if (!duration || !(duration in DURATION_MAP)) {
        return res.status(400).json({ message: 'Invalid duration value.' });
      }
      expireSeconds = DURATION_MAP[duration];
    }

    if (recipientId) {
      const recipient = await User.findById(recipientId);
      if (!recipient) return res.status(404).json({ message: 'User not found.' });

      const [iBlockedThem, theyBlockedMe] = await Promise.all([
        Block.findOne({ blocker_id: userId, blocked_id: recipientId }),
        Block.findOne({ blocker_id: recipientId, blocked_id: userId }),
      ]);

      if (iBlockedThem || theyBlockedMe) {
        return res.status(403).json({ message: 'Cannot change settings in a blocked chat.' });
      }
    } else if (groupId) {
      const group = await Group.findById(groupId);
      if (!group) return res.status(404).json({ message: 'Group not found.' });

      const membership = await GroupMember.findOne({ group_id: groupId, user_id: userId });
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
        $or: [
          { user_id: userId, recipient_id: recipientId },
          { user_id: recipientId, recipient_id: userId },
        ],
      });
    } else if (groupId) {
      setting = await ChatSetting.findOne({ group_id: groupId });
    }

    if(!enabled && !setting.disappearing_enabled){
      return res.status(400).json({message: 'You already turned off this setting.'})
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
      await setting.updateOne({
        disappearing_enabled: enabled,
        duration: enabled ? duration : null,
        expire_after_seconds: expireSeconds,
      });

      setting = await ChatSetting.findById(setting._id).lean();
    }

    const currentUser = await User.findById(userId).select('id name').lean({ virtuals: true });

    let durationText = '';
    if (enabled) {
      if (duration === 'after_seen') {
        durationText = 'immediately after viewing';
      } else {
        durationText = duration === '24h' ? '24 hours' : duration === '7d' ? '7 days' : '90 days';
      }
    }

    const systemMessageContent = enabled
      ? `${currentUser.name} turned on disappearing messages. Messages will disappear ${durationText}.`
      : `${currentUser.name} turned off disappearing messages.`;

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
          name: currentUser.name,
        },
        previous_state: {
          enabled: wasEnabled,
          duration: oldDuration,
        },
        timestamp: new Date().toISOString(),
      },
    });

    const io = req.app.get('io');

    if (recipientId) {
      io.to(`user_${recipientId}`).emit('receive-message', systemMessage);
      io.to(`user_${userId}`).emit('receive-message', systemMessage);
    } else if (groupId) {
      io.to(`group_${groupId}`).emit('receive-message', systemMessage);
    }

    return res.json({
      message: 'Disappearing messages updated successfully.',
      data: { setting, systemMessage },
    });
  } catch (error) {
    console.error('Error in toggleDisappearingMessages:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchMessages = async (req, res) => {
  const currentUserId = req.user._id;
  const {
    limit = 50,
    recipientId = null,
    groupId = null,
    broadcast_id = null,
    page = 1,
    isAnnouncement = false,
    isBroadcast = false,
  } = req.query;

  try {
    const parsedLimit = parseInt(limit);
    const parsedPage = parseInt(page);
    const offset = (parsedPage - 1) * parsedLimit;

    // Check if E2E encryption is enabled
    const setting = await Setting.findOne()
      .select("e2e_encryption_enabled")
      .lean();
    const e2eEnabled = setting?.e2e_encryption_enabled || false;

    let match = {};
    let contextType = 'direct';

    if (isAnnouncement === 'true' || isAnnouncement === true) {
      match = {
        message_type: 'announcement',
        recipient_id: null,
        group_id: null,
      };
      contextType = 'announcement';
    } else if (isBroadcast === 'true' || isBroadcast === true) {
      if (!broadcast_id) return res.status(400).json({ message: 'broadcast_id is required when isBroadcast=true' });
      
      match = {
        sender_id: currentUserId,
        "metadata.is_broadcast": true,
        "metadata.broadcast_id": broadcast_id,
      };
      contextType = "broadcast";
    } else if (groupId) {
      match = {
        group_id: new mongoose.Types.ObjectId(groupId),
        message_type: "text",
      };
      contextType = "group";
    } else if (recipientId) {
      const recipientObjId = new mongoose.Types.ObjectId(recipientId);
      match = {
        message_type: "text",
        $or: [
          { sender_id: currentUserId, recipient_id: recipientObjId },
          { sender_id: recipientObjId, recipient_id: currentUserId },
        ],
      };
      contextType = 'direct';
    } else {
      return res.status(400).json({ message: 'Must provide one of: recipientId, groupId, broadcast_id with isBroadcast=true, or isAnnouncement=true' });
    }

    const total = await Message.countDocuments(match);

    const pipeline = [
      { $match: match },
      { $sort: { created_at: -1 } },
      { $skip: offset },
      { $limit: parsedLimit },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
      { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' } },
      { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          id: '$_id',
          sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar' },
          group: groupId ? { id: '$group_doc._id', name: '$group_doc.name', avatar: '$group_doc.avatar' } : null,
          announcement: (isAnnouncement === 'true' || isAnnouncement === true) ? {
            id: '$metadata.announcement_id',
            title: '$metadata.title',
            announcement_type: '$metadata.announcement_type',
            action_link: '$metadata.action_link',
            redirect_url: '$metadata.redirect_url',
          } : null,
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          content: 1,
          message_type: 1,
          file_url: 1,
          created_at: 1,
          sender: 1,
          sender_id: 1,
          is_encrypted: 1,
          announcement: 1,
          group: 1,
          broadcast_id: { $ifNull: ["$metadata.broadcast_id", null] },
          is_broadcast: {
            $cond: [{ $eq: ["$metadata.is_broadcast", true] }, true, false],
          },
        },
      },
    ];

    const messages = await Message.aggregate(pipeline);
    const totalPages = Math.ceil(total / parsedLimit);

    const results = messages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      message_type: msg.message_type,
      file_url: msg.file_url,
      created_at: msg.created_at,
      sender: msg.sender || null,
      sender_id: msg.sender_id,
      is_encrypted: msg.is_encrypted,
      announcement: msg.announcement || null,
      group: msg.group || null,
      broadcast_id: msg.broadcast_id,
      is_broadcast: msg.is_broadcast,
    }));

    return res.status(200).json({
      messages: results,
      e2e_enabled: e2eEnabled,
      context: {
        type: contextType,
        recipientId: recipientId || null,
        groupId: groupId || null,
        broadcast_id: broadcast_id || null,
      },
      pagination: {
        currentPage: parsedPage,
        limit: parsedLimit,
        totalMessages: total,
        totalPages,
        hasMore: parsedPage < totalPages,
      },
    });
  } catch (error) {
    console.error('Error in searchMessages:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.togglePinMessage = async (req, res) => {
  const { messageId, duration } = req.body;
  const userId = req.user._id;
  const io = req.app.get('io');

  if (!messageId) {
    return res.status(400).json({ message: 'messageId is required.' });
  }

  try {
    const messageObjId = new mongoose.Types.ObjectId(messageId);
    const message = await Message.findById(messageObjId).lean();
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const existingPin = await MessagePin.findOne({ message_id: messageObjId });
    if (existingPin) {
      await MessagePin.deleteOne({ _id: existingPin._id });

      const payload = { message_id: messageId, isPinned: false };

      if (message.group_id) {
        io.to(`group_${message.group_id}`).emit('message-pin', payload);
      } else if (message.recipient_id) {
        io.to(`user_${message.sender_id}`).emit('message-pin', payload);
        io.to(`user_${message.recipient_id}`).emit('message-pin', payload);
      }

      return res.status(200).json({ pinned: false, message: 'Message unpinned successfully' });
    }

    const durationMap = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    if (!duration || !durationMap[duration]) {
      return res.status(400).json({ message: 'Invalid duration. Use 24h, 7d, or 30d' });
    }

    let pinQuery = {};
    if (message.group_id) {
      pinQuery = { 'message.group_id': message.group_id };
    } else {
      pinQuery = {
        'message.group_id': null,
        $or: [
          { 'message.sender_id': message.sender_id, 'message.recipient_id': message.recipient_id },
          { 'message.sender_id': message.recipient_id, 'message.recipient_id': message.sender_id },
        ],
      };
    }

    const currentPins = await MessagePin.aggregate([
      { $lookup: { from: 'messages', localField: 'message_id', foreignField: '_id', as: 'message' } },
      { $unwind: '$message' },
      { $match: pinQuery },
      { $sort: { created_at: 1 } },
    ]);

    if (currentPins.length >= 3) {
      const oldestPin = currentPins[0];
      const oldMessageId = oldestPin.message_id.toString();

      await MessagePin.deleteOne({ _id: oldestPin._id });

      const unpinPayload = { message_id: oldMessageId, isPinned: false };

      const oldMessage = await Message.findById(oldMessageId).lean();
      if (oldMessage?.group_id) {
        io.to(`group_${oldMessage.group_id}`).emit('message-pin', unpinPayload);
      } else if (oldMessage?.recipient_id) {
        io.to(`user_${oldMessage.sender_id}`).emit('message-pin', unpinPayload);
        io.to(`user_${oldMessage.recipient_id}`).emit('message-pin', unpinPayload);
      }
    }

    const pinnedUntil = new Date(Date.now() + durationMap[duration]);

    await MessagePin.create({ message_id: messageObjId, pinned_by: userId, pinned_until: pinnedUntil });
    const pinningUser = await User.findById(userId).select('name avatar').lean();

    const systemMessage = await Message.create({
      sender_id: userId,
      group_id: message.group_id || null,
      recipient_id: message.recipient_id || null,
      message_type: 'system',
      content: `${pinningUser.name} pinned a message.`,
      metadata: { action: 'pin', pinned_by: userId, original_message_id: messageId },
    });

    const systemMessages = await Message.aggregate([
      { $match: { _id: systemMessage._id } },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
      { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc' } },
      { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' } },
      { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          id: '$_id',
          sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar' },
          recipient: message.recipient_id ? {
            id: '$recipient_doc._id', name: '$recipient_doc.name', avatar: '$recipient_doc.avatar',
          } : null,
          group: message.group_id ? {
            id: '$group_doc._id', name: '$group_doc.name', avatar: '$group_doc.avatar',
          } : null,
        },
      },
      {
        $project: {
          _id: 0,
          id: 1,
          sender_id: 1,
          recipient_id: 1,
          group_id: 1,
          content: 1,
          message_type: 1,
          metadata: 1,
          created_at: 1,
          sender: 1,
          recipient: 1,
          group: 1,
        },
      },
    ]);

    const realtimeMessage = systemMessages[0];

    const payload = {
      message_id: messageId,
      isPinned: true,
      pins: [{ pinned_by: userId.toString(), user: pinningUser }],
    };

    if (message.group_id) {
      io.to(`group_${message.group_id}`).emit('message-pin', payload);
      io.to(`group_${message.group_id}`).emit('receive-message', realtimeMessage);
    } else if (message.recipient_id) {
      io.to(`user_${message.sender_id}`).emit('message-pin', payload);
      io.to(`user_${message.recipient_id}`).emit('message-pin', payload);
      io.to(`user_${message.sender_id}`).emit('receive-message', realtimeMessage);
      io.to(`user_${message.recipient_id}`).emit('receive-message', realtimeMessage);
    }

    return res.status(200).json({ pinned: true, message: 'Message pinned successfully' });
  } catch (error) {
    console.error('Error in togglePinMessage:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.listDocuments = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const { documents, pagination } = await getUserDocuments(currentUserId, { page, limit });
    return res.status(200).json({ documents, ...pagination });
  } catch (error) {
    console.error('Error in listDocuments:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchDocuments = async (req, res) => {
  const currentUserId = req.user._id;
  const search = req.query.search?.trim().toLowerCase() || '';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const { documents, pagination } = await getUserDocuments(currentUserId, { search, page, limit });
    return res.status(200).json({ documents, ...pagination });
  } catch (error) {
    console.error('Error in searchDocuments:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};