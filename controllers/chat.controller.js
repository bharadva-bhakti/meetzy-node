const { db } = require('../models');
const User = db.User;
const Message = db.Message;
const Group = db.Group;
const GroupMember = db.GroupMember;
const Block = db.Block;
const Friend = db.Friend;
const Archive = db.Archive;
const Favorite = db.Favorite;
const MutedChat = db.MutedChat;
const PinnedConversation = db.PinnedConversation;
const ChatClear = db.ChatClear;
const Broadcast = db.Broadcast;
const UserDelete = db.UserDelete;
const MessageAction = db.MessageAction;
const mongoose = require('mongoose');
const { fetchBlockedUsers, fetchFavoriteData, fetchArchiveChats, fetchContacts, fetchRecentChat,
  formatDate, formatTime, initials, formatDateForFilename, chatHeader } = require('../helper/chatHelpers');

exports.togglePinConversation = async (req, res) => {
  const userId = req.user._id;
  const { type, targetId } = req.body;

  try {
    const existingPin = await PinnedConversation.findOne({
      user_id: userId,
      type,
      target_id: targetId,
    });

    const io = req.app.get('io');
    const emitPinUpdate = (pinned, pinnedAt = null) => {
      if (!io) return;
      io.to(`user_${userId}`).emit('chat-pin-updated', {
        type, targetId, pinned, pinned_at: pinnedAt,
      });
    };

    if (existingPin) {
      await PinnedConversation.deleteOne({ _id: existingPin._id });
      emitPinUpdate(false, null);
      return res.status(200).json({ message: 'Unpinned successfully', pinned: false });
    }

    const pinnedAt = new Date();
    await PinnedConversation.create({
      user_id: userId,
      type,
      target_id: targetId,
      pinned_at: pinnedAt,
    });

    emitPinUpdate(true, pinnedAt.toISOString());
    return res.status(201).json({ 
      message: 'Pinned successfully', 
      pinned: true, 
      pinned_at: pinnedAt.toISOString() 
    });
  } catch (error) {
    console.error('Error in togglePinConversation:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getArchivedChats = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { archivedChats, pagination } = await fetchArchiveChats({ userId: currentUserId, page, limit });

    res.status(200).json({
      archived: archivedChats, 
      ...pagination
    });
  } catch (error) {
    console.error('Error in getArchivedChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleArchive = async (req, res) => {
  const userId = req.user._id;
  const { targetId, targetType = 'user' } = req.body;

  if (!targetId) return res.status(400).json({ message: 'Target Id is required' });

  try {
    // Validate target exists
    if (targetType === 'user') {
      const user = await User.findById(targetId);
      if (!user) return res.status(404).json({ message: 'User Not Found' });
    } else if (targetType === 'group') {
      const group = await Group.findById(targetId);
      if (!group) return res.status(404).json({ message: 'Group Not Found' });
    } else if (targetType === 'broadcast') {
      const broadcast = await Broadcast.findById(targetId);
      if (!broadcast) return res.status(404).json({ message: 'Broadcast Not Found' });
    }

    const existingArchive = await Archive.findOne({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
    });

    const io = req.app.get('io');
    const emitArchiveUpdate = (isArchived) => {
      if (!io) return;
      const chatType = targetType === 'group' ? 'group' : 'direct';
      io.to(`user_${userId}`).emit('chat-archive-updated', {
        targetId,
        type: chatType,
        isArchived,
      });
    };

    if (existingArchive) {
      await Archive.deleteOne({ _id: existingArchive._id });
      emitArchiveUpdate(false);
      return res.status(200).json({ action: 'unarchive', message: 'Chat Restored From Archive' });
    } else {
      await Archive.create({
        user_id: userId,
        target_id: targetId,
        target_type: targetType,
      });
      emitArchiveUpdate(true);
      return res.status(200).json({ action: 'archive', message: 'Chat Archived Successfully' });
    }
  } catch (error) {
    console.error('Error in toggleArchive:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchArchiveChats = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const search = req.query.search?.toLowerCase() || '';

  try {
    const { archivedChats, pagination } = await fetchArchiveChats({ userId: currentUserId, page, limit });

    const filtered = archivedChats.filter((chat) => {
      const hide_phone = chat.userSetting?.hide_phone; 

      const name = chat?.name?.toLowerCase() || '';
      const email = chat?.email?.toLowerCase() || '';
      const phone = chat?.phone?.toLowerCase() || null;

      if (hide_phone) {
        return name.includes(search) || email.includes(search);
      }

      return name.includes(search) || email.includes(search) || (phone && phone.includes(search));
    });

    res.status(200).json({ archiveChats: filtered, ...pagination });
  } catch (error) {
    console.error('Error in searchArchiveChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.archiveAllChats = async (req, res) => {
  const userId = req.user._id;

  try {
    // Get all direct chat partners
    const directPartners = await Message.aggregate([
      {
        $match: {
          group_id: null,
          $or: [{ sender_id: userId }, { recipient_id: userId }],
        }
      },
      {
        $project: {
          partner_id: {
            $cond: [
              { $eq: ['$sender_id', userId] },
              '$recipient_id',
              '$sender_id'
            ]
          }
        }
      },
      { $group: { _id: '$partner_id' } },
      { $project: { _id: 0, partner_id: '$_id' } }
    ]);

    const directPartnerIds = directPartners.map(p => p.partner_id);

    // Get all groups user is member of
    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(g => g.group_id);

    // Get blocked users
    const blocked = await Block.find({ blocker_id: userId }).select('blocked_id').lean();
    const blockedIds = blocked.map(b => b.blocked_id.toString());

    const finalUserTargets = directPartnerIds.filter(id => !blockedIds.includes(id.toString()));

    const archivePromises = [
      ...finalUserTargets.map(id => 
        Archive.findOneAndUpdate(
          { user_id: userId, target_id: id, target_type: 'user' },
          { user_id: userId, target_id: id, target_type: 'user' },
          { upsert: true, new: true }
        )
      ),
      ...groupIds.map(id => 
        Archive.findOneAndUpdate(
          { user_id: userId, target_id: id, target_type: 'group' },
          { user_id: userId, target_id: id, target_type: 'group' },
          { upsert: true, new: true }
        )
      ),
    ];

    const results = await Promise.all(archivePromises);
    const archivedCount = results.length;

    const io = req.app.get('io');
    if (io) {
      finalUserTargets.forEach((targetId) => {
        io.to(`user_${userId}`).emit('chat-archive-updated', {
          targetId,
          type: 'direct',
          isArchived: true,
        });
      });
      groupIds.forEach((targetId) => {
        io.to(`user_${userId}`).emit('chat-archive-updated', {
          targetId,
          type: 'group',
          isArchived: true,
        });
      });
    }

    return res.status(200).json({
      totalArchived: archivedCount,
      message: `Archived ${archivedCount} chats successfully.`,
    });
  } catch (error) {
    console.error('Error in archiveAllChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getBlockedUsers = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { blocked, totalPages, totalCount, hasMore } = await fetchBlockedUsers(currentUserId, { page, limit });

    res.status(200).json({
      blocked: blocked,
      currentPage: page,
      totalPages,
      totalCount,
      hasMore,
    });
  } catch (error) {
    console.error('Error in getBlockedUsers:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleBlock = async (req, res) => {
  const userId = req.user._id;
  const { targetId, block_type = 'user' } = req.body;

  if (!targetId) {
    return res.status(400).json({ message: 'Target Id is required.' });
  }

  try {
    let query = { blocker_id: userId, block_type };

    if (block_type === 'user') {
      if (userId.toString() === targetId) {
        return res.status(400).json({ message: 'You can not block yourself.' });
      }

      const user = await User.findById(targetId);
      if (!user) return res.status(404).json({ message: 'User Not Found' });

      query.blocked_id = targetId;
    } else if (block_type === 'group') {
      const group = await Group.findById(targetId);
      if (!group) return res.status(404).json({ message: 'Group Not Found' });

      query.group_id = targetId;
    }

    const existingBlock = await Block.findOne(query);

    let action, systemMessage;

    if (existingBlock) {
      await Block.deleteOne({ _id: existingBlock._id });
      action = 'unblock';
      systemMessage = block_type === 'user' ? 'You unblocked this contact.' : 'You unblocked this group.';
    } else {
      const payload = block_type === 'user'
        ? { blocker_id: userId, blocked_id: targetId, block_type: 'user' }
        : { blocker_id: userId, group_id: targetId, block_type: 'group' };

      await Block.create(payload);
      action = 'block';
      systemMessage = block_type === 'user' ? 'You blocked this contact.' : 'You exit from this group.';
    }

    const createdSystemMessage = await Message.create({
      sender_id: userId,
      recipient_id: block_type === 'user' ? targetId : null,
      group_id: block_type === 'group' ? targetId : null,
      message_type: 'system',
      content: systemMessage,
      metadata: { 
        action,
        visible_to: userId,
        system_action: 'block_status_change'
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('block-status-updated', {
        blockType: block_type,
        targetId,
        action,
      });

      // Emit system message
      const fullSystemMessage = await Message.aggregate([
        { $match: { _id: createdSystemMessage._id } },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            id: '$_id',
            sender: {
              id: '$sender_doc._id',
              name: '$sender_doc.name',
              avatar: '$sender_doc.avatar',
            },
          },
        },
        { $project: { _id: 0, id: 1, content: 1, message_type: 1, metadata: 1, created_at: 1, sender: 1 } },
      ]);

      if (fullSystemMessage[0]) {
        io.to(`user_${userId}`).emit('receive-message', fullSystemMessage[0]);
      }
    }

    return res.json({ 
      action, 
      message: block_type === 'user' ? `User ${action}ed successfully` : `Group ${action}ed successfully`, 
    });
  } catch (error) {
    console.error('Error in toggleBlock:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchBlockContact = async (req, res) => {
  const userId = req.user._id;
  const search = req.query.search?.toLowerCase() || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { blocked, totalPages, totalCount, hasMore } = await fetchBlockedUsers(userId, { page, limit, search });
    res.status(200).json({
      blocked,
      currentPage: page,
      totalPages,
      totalCount,
      hasMore,
    });
  } catch (error) {
    console.error('Error in searchBlockContact:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getFavoriteChat = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const { validFavorites, pagination } = await fetchFavoriteData(currentUserId, page, limit);

    res.status(200).json({
      favorites: validFavorites,
      ...pagination,
    });
  } catch (error) {
    console.error('Error in getFavoriteChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleFavorite = async (req, res) => {
  const currentUserId = req.user._id;
  const { targetId, targetType } = req.body;

  try {
    if (targetType === 'user') {
      const user = await User.findById(targetId);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (targetType === 'group') {
      const group = await Group.findById(targetId);
      if (!group) return res.status(404).json({ message: 'Group not found.' });
    }

    const favorite = await Favorite.findOne({
      user_id: currentUserId,
      target_id: targetId,
      target_type: targetType,
    });

    let isFavorite = false;

    if (favorite) {
      await Favorite.deleteOne({ _id: favorite._id });
      isFavorite = false;
    } else {
      await Favorite.create({
        user_id: currentUserId,
        target_id: targetId,
        target_type: targetType,
      });
      isFavorite = true;
    }

    res.status(200).json({
      isFavorite,
      message: isFavorite ? 'Added to favorites' : 'Removed from favorites',
    });
  } catch (error) {
    console.error('Error in toggleFavorite:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchFavorites = async (req, res) => {
  try {
    const userId = req.user._id;
    const search = req.query.search?.toLowerCase() || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const { validFavorites, pagination } = await fetchFavoriteData(userId, page, limit);

    const filteredFavorites = validFavorites.filter((fav) => {
      const hide_phone = fav.userSetting?.hide_phone; 
      
      if (fav.chat_type === 'direct') {
        if (hide_phone) {
          return fav.name?.toLowerCase().includes(search) || fav.email?.toLowerCase().includes(search)
        }
  
        return fav.name?.toLowerCase().includes(search) || fav.email?.toLowerCase().includes(search) || fav.phone?.toLowerCase().includes(search);
      } else if (fav.chat_type === 'group') {
        return fav.name?.toLowerCase().includes(search);
      }
      return false;
    });

    res.status(200).json({
      favorites: filteredFavorites,
      page,
      limit,
      totalCount: filteredFavorites.length,
      totalPages: Math.ceil(filteredFavorites.length / limit),
      hasMore: page < Math.ceil(filteredFavorites.length / limit),
    });
  } catch (err) {
    console.error('Error in searchFavorites:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.muteChat = async (req, res) => {
  const { target_id, target_type = 'user', duration } = req.body;
  const userId = req.user._id;

  try {
    if (!target_id) return res.status(400).json({ message: 'Recipient Id is required.' });

    if (target_type === 'user') {
      const user = await User.findById(target_id);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (target_type === 'group') {
      const group = await Group.findById(target_id);
      if (!group) return res.status(404).json({ message: 'Group not found.' });
    }
    
    let mutedUntil = null;
    const now = new Date();

    switch (duration) {
      case '1h':
        mutedUntil = new Date(now.getTime() + 1 * 60 * 60 * 1000);
        break;
      case '8h':
        mutedUntil = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        break;
      case '1w':
        mutedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'forever':
        mutedUntil = new Date('2100-01-01T00:00:00Z');
        break;
      default:
        return res.status(400).json({ message: 'Invalid mute duration.' });
    }

    await MutedChat.findOneAndUpdate(
      { user_id: userId, target_id, target_type },
      { user_id: userId, target_id, target_type, muted_until: mutedUntil },
      { upsert: true, new: true }
    );

    const io = req.app.get('io');
    io.to(`user_${userId}`).emit('chat_muted', {
      userId,
      targetId: target_id,
      targetType: target_type,
      mutedUntil: mutedUntil,
    });

    res.status(200).json({ message: 'Chat muted successfully.' });
  } catch (error) {
    console.error('Error in muteChat:', error);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};

exports.unmuteChat = async (req, res) => {
  const { target_id, target_type } = req.body;
  const userId = req.user._id;

  try {
    if (!target_id) return res.status(400).json({ message: 'Recipient Id is required.' });

    if (target_type === 'user') {
      const user = await User.findById(target_id);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (target_type === 'group') {
      const group = await Group.findById(target_id);
      if (!group) return res.status(404).json({ message: 'Group not found.' });
    }

    await MutedChat.deleteOne({ user_id: userId, target_id, target_type });

    const io = req.app.get('io');
    io.to(`user_${userId}`).emit('chat_unmuted', {
      userId,
      targetId: target_id,
      targetType: target_type,
    });

    res.status(200).json({ message: 'Chat unmute Successfully.' });
  } catch (error) {
    console.error('Error in unmuteChat:', error);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};

exports.getRecentChats = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { messages, pagination } = await fetchRecentChat(currentUserId, page, limit, { paginate: true });

    res.status(200).json({
      chats: messages, 
      pagination
    });
  } catch (err) {
    console.error('getRecentChats error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.searchRecentChat = async (req, res) => {
  const currentUserId = req.user._id;
  const searchTerm = req.query.search?.trim().toLowerCase() || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { messages } = await fetchRecentChat(currentUserId, page, limit, { paginate: true });

    const filteredChat = messages.filter(ch => {
      const name =
        ch.chat_type === 'direct'
          ? ch.lastMessage.recipient?.name?.toLowerCase()
          : ch.lastMessage.group?.name?.toLowerCase() || ch.info?.name?.toLowerCase();
          

      const phone = ch.chat_type === 'direct' ? ch.lastMessage.recipient?.phone?.toLowerCase() : null;
      
      return (
        (name && name.includes(searchTerm)) ||
        (phone && phone.includes(searchTerm))
      );
    });

    const totalCount = filteredChat.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIndex = (page - 1) * limit;
    const paginatedChats = filteredChat.slice(startIndex, startIndex + limit);

    res.status(200).json({
      success: true,
      chats: paginatedChats,
      pagination: {
        page, limit, totalCount, totalPages, hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error in searchRecentChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getContacts = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { contacts, pagination } = await fetchContacts(currentUserId, { page, limit });

    res.status(200).json({ contacts, ...pagination });
  } catch (error) {
    console.error('Error in getContacts:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.searchContacts = async (req, res) => {
  const currentUserId = req.user._id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const search = req.query.search?.toLowerCase() || '';

  try {
    const { contacts, pagination } = await fetchContacts(currentUserId, { search, page, limit });

    res.status(200).json({ contacts, ...pagination });
  } catch (error) {
    console.error('Error in searchContacts:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteChat = async (req, res) => {
  const userId = req.user._id;
  const { targetId, targetType = 'user', deleteType = 'hide_chat' } = req.body;

  if (!targetId) {
    return res.status(400).json({ message: 'Target Id is required.' });
  }

  try {
    if (targetType === 'user') {
      const user = await User.findById(targetId);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (targetType === 'group') {
      const group = await Group.findById(targetId);
      if (!group) return res.status(404).json({ message: 'Group not found.' });
    }

    const existing = await UserDelete.findOne({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
    });

    if (existing) {
      return res.status(400).json({ message: 'Chat already deleted.' });
    }

    await UserDelete.create({
      user_id: userId,
      target_id: targetId,
      target_type: targetType,
      delete_type: deleteType,
    });

    const clearData = { user_id: userId, cleared_at: new Date() };

    if (targetType === 'user') {
      clearData.recipient_id = targetId;
    } else if (targetType === 'group') {
      clearData.group_id = targetId;
    }

    await ChatClear.findOneAndUpdate(
      clearData,
      clearData,
      { upsert: true }
    );

    res.status(200).json({ message: `${targetType} Chat Deleted Successfully` });
  } catch (error) {
    console.error('Error in deleteChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteAllChats = async (req, res) => {
  const userId = req.user._id;

  try {
    // Get direct chat partners
    const directPartners = await Message.aggregate([
      {
        $match: {
          group_id: null,
          $or: [{ sender_id: userId }, { recipient_id: userId }],
        }
      },
      {
        $project: {
          partner_id: {
            $cond: [{ $eq: ['$sender_id', userId] }, '$recipient_id', '$sender_id']
          }
        }
      },
      { $group: { _id: '$partner_id' } }
    ]);

    const directPartnerIds = directPartners.map(p => p._id).filter(Boolean);

    // Get group memberships
    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(g => g.group_id);

    const deletePayloads = [
      ...directPartnerIds.map(id => ({
        user_id: userId,
        target_id: id,
        target_type: 'user',
        delete_type: 'hide_chat',
      })),
      ...groupIds.map(id => ({
        user_id: userId,
        target_id: id,
        target_type: 'group',
        delete_type: 'hide_chat',
      })),
    ];

    if (deletePayloads.length > 0) {
      await UserDelete.insertMany(deletePayloads, { ordered: false }).catch(() => {}); // ignore duplicates
    }

    const clearPayload = [
      ...directPartnerIds.map(id => ({
        user_id: userId,
        recipient_id: id,
        cleared_at: new Date(),
      })),
      ...groupIds.map(id => ({
        user_id: userId,
        group_id: id,
        cleared_at: new Date(),
      })),
    ];

    for (const data of clearPayload) {
      await ChatClear.findOneAndUpdate(data, data, { upsert: true });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('chats-deleted-all', {
        userId,
        deletedCount: deletePayloads.length,
      });
    }

    return res.status(200).json({
      totalDeleted: deletePayloads.length,
      message: `Deleted ${deletePayloads.length} chats successfully.`,
    });
  } catch (error) {
    console.error('Error in deleteAllChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.exportChat = async (req, res) => {
  const userId = req.user._id;
  const { recipientId, groupId } = req.query;

  try {
    if ((!recipientId && !groupId) || (recipientId && groupId)) {
      return res.status(400).json({ message: 'Provide either recipientId or groupId, not both.' });
    }

    let messages = [];
    let filename = '';
    let textContent = '';

    if (groupId) {
      const group = await Group.findById(groupId);
      if (!group) return res.status(400).json({ message: 'Group not found.' });

      const member = await GroupMember.findOne({ group_id: groupId, user_id: userId });
      if (!member) return res.status(403).json({ message: 'You are not member of this group.' });

      const clearEntry = await ChatClear.findOne({ user_id: userId, group_id: groupId });

      const match = { group_id: groupId, content: { $ne: null } };
      if (clearEntry) {
        match.created_at = { $gt: clearEntry.cleared_at };
      }

      messages = await Message.find(match)
        .populate('sender', 'name')
        .sort({ created_at: 1 })
        .lean();

      textContent += chatHeader(`Group: ${group.name}`);
      filename = `group_${initials(group.name)}_${formatDateForFilename(new Date())}.txt`;
    } else if (recipientId) {
      const currentUser = await User.findById(userId);
      const recipient = await User.findById(recipientId);
      if (!recipient) return res.status(400).json({ message: 'recipient user not found.' });

      const isBlocked = await Block.findOne({ blocker_id: userId, blocked_id: recipientId });
      if (isBlocked) return res.status(403).json({ error: 'Cannot export chat with blocked user' });

      const clearEntry = await ChatClear.findOne({ user_id: userId, recipient_id: recipientId });

      const match = {
        $or: [
          { sender_id: userId, recipient_id: recipientId },
          { sender_id: recipientId, recipient_id: userId },
        ],
        message_type: 'text',
        content: { $ne: null },
      };

      if (clearEntry) {
        match.created_at = { $gt: clearEntry.cleared_at };
      }

      messages = await Message.find(match)
        .populate('sender', 'name')
        .sort({ created_at: 1 })
        .lean();

      textContent += chatHeader(`Participants: ${currentUser.name} ↔ ${recipient.name}`);
      filename = `chat_${initials(currentUser.name)}_${initials(recipient.name)}_${formatDateForFilename(new Date())}.txt`;
    }

    if (messages.length === 0) {
      textContent += 'No messages are available for this conversation.';
    } else {
      messages.forEach((msg) => {
        const msgDate = new Date(msg.created_at);
        const dateStr = formatDate(msgDate);
        const timeStr = formatTime(msgDate);
        const senderName = msg.sender?.name || 'Unknown';

        textContent += `${dateStr}, ${timeStr} - ${senderName}: ${msg.content}\n`;
      });
    }

    textContent += `\n================================================\nEnd of conversation\n================================================\n`;

    res.setHeader('Content-Disposition', `attachment; filename='${filename}'`);
    res.setHeader('Content-Type', 'text/plain');

    return res.status(200).send(textContent);
  } catch (error) {
    console.error('Error in exportChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.clearChat = async (req, res) => {
  const userId = req.user._id;
  const { recipientId, groupId, broadcastId } = req.body;

  try {
    const targets = [recipientId, groupId, broadcastId].filter(Boolean);
    if (targets.length !== 1) {
      return res.status(400).json({ 
        message: 'Provide exactly one of: recipientId, groupId, or broadcastId.' 
      });
    }

    const data = { 
      user_id: userId, 
      cleared_at: new Date() 
    };

    if (recipientId) data.recipient_id = recipientId;
    if (groupId) data.group_id = groupId;
    if (broadcastId) data.broadcast_id = broadcastId;

    await ChatClear.findOneAndUpdate(data, data, { upsert: true });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('chat-cleared', {
        userId,
        recipientId: recipientId || null,
        groupId: groupId || null,
        broadcastId: broadcastId || null,
        clearedAt: data.cleared_at,
      });
    }

    return res.status(200).json({ message: 'Chat cleared successfully.' });
  } catch (error) {
    console.error('Error in clearChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.clearAllChats = async (req, res) => {
  const userId = req.user._id;

  try {
    // Get direct chat partners
    const directPartners = await Message.aggregate([
      {
        $match: {
          group_id: null,
          $or: [{ sender_id: userId }, { recipient_id: userId }],
        }
      },
      {
        $project: {
          partner_id: {
            $cond: [{ $eq: ['$sender_id', userId] }, '$recipient_id', '$sender_id']
          }
        }
      },
      { $group: { _id: '$partner_id' } }
    ]);

    const directPartnerIds = directPartners.map(p => p._id);

    // Get group memberships
    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(g => g.group_id);

    const now = new Date();
    const clearEntries = [];

    // Check each direct chat
    for (const partnerId of directPartnerIds) {
      const existingClear = await ChatClear.findOne({ user_id: userId, recipient_id: partnerId });

      const match = {
        $or: [
          { sender_id: userId, recipient_id: partnerId },
          { sender_id: partnerId, recipient_id: userId },
        ],
      };

      if (existingClear?.cleared_at) {
        match.created_at = { $gt: existingClear.cleared_at };
      }

      const count = await Message.countDocuments(match);
      if (count > 0) {
        clearEntries.push({
          user_id: userId,
          recipient_id: partnerId,
          cleared_at: now,
        });
      }
    }

    // Check each group
    for (const groupId of groupIds) {
      const existingClear = await ChatClear.findOne({ user_id: userId, group_id: groupId });

      const match = { group_id: groupId };
      if (existingClear?.cleared_at) {
        match.created_at = { $gt: existingClear.cleared_at };
      }

      const count = await Message.countDocuments(match);
      if (count > 0) {
        clearEntries.push({
          user_id: userId,
          group_id: groupId,
          cleared_at: now,
        });
      }
    }

    if (clearEntries.length > 0) {
      await Promise.all(clearEntries.map(entry => ChatClear.findOneAndUpdate(entry, entry, { upsert: true })));
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('chats-cleared-all', {
        userId,
        clearedCount: clearEntries.length,
      });
    }

    return res.status(200).json({
      message:
        clearEntries.length > 0
          ? `${clearEntries.length} chats cleared successfully.`
          : 'No chats with new messages to clear.',
    });
  } catch (error) {
    console.error('Error in clearAllChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};