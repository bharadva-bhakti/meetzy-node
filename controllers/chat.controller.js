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
    const existingPin = await PinnedConversation.findOne({ user_id: userId, type, target_id: targetId, });

    const io = req.app.get('io');
    const emitPinUpdate = (pinned, pinnedAt = null) => {
      if (!io) return;
      io.to(`user_${userId}`).emit('chat-pin-updated', { type, targetId, pinned, pinned_at: pinnedAt, });
    };

    if (existingPin) {
      await PinnedConversation.deleteOne({ _id: existingPin._id });
      emitPinUpdate(false, null);
      return res.status(200).json({ message: 'Unpinned successfully', pinned: false });
    }

    const pinnedAt = new Date();
    await PinnedConversation.create({ user_id: userId, type, target_id: targetId, pinned_at: pinnedAt, });

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

    res.status(200).json({ archived: archivedChats,  ...pagination });
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

    const existingArchive = await Archive.findOne({ user_id: userId, target_id: targetId, target_type: targetType, });

    const io = req.app.get('io');
    const emitArchiveUpdate = (isArchived) => {
      if (!io) return;
      const chatType = targetType === 'group' ? 'group' : 'direct';
      io.to(`user_${userId}`).emit('chat-archive-updated', { targetId, type: chatType, isArchived, });
    };

    if (existingArchive) {
      await Archive.deleteOne({ _id: existingArchive._id });
      emitArchiveUpdate(false);
      return res.status(200).json({ action: 'unarchive', message: 'Chat Restored From Archive' });

    } else {
      await Archive.create({ user_id: userId, target_id: targetId, target_type: targetType, });
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
    const directPartners = await Message.aggregate([
      { $match: { group_id: null, $or: [{ sender_id: userId }, { recipient_id: userId }] }},
      { $project: { partner_id: { $cond: [{ $eq: ['$sender_id', userId] }, '$recipient_id', '$sender_id'] }}},
      { $match: { partner_id: { $ne: null } }},
      { $group: { _id: '$partner_id' } },
      { $project: { _id: 0, partner_id: '$_id' } }
    ]);

    const directPartnerIds = directPartners.map(p => p.partner_id);
    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(g => g.group_id);

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
        io.to(`user_${userId}`).emit('chat-archive-updated', { targetId, type: 'direct', isArchived: true, });
      });
      groupIds.forEach((targetId) => {
        io.to(`user_${userId}`).emit('chat-archive-updated', { targetId, type: 'group', isArchived: true, });
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
      io.to(`user_${userId}`).emit('block-status-updated', { blockType: block_type, targetId, action, });

      const fullSystemMessage = await Message.aggregate([
        { $match: { _id: createdSystemMessage._id } },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' } },
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $addFields: { id: '$_id', sender: { id: '$sender_doc._id', name: '$sender_doc.name', avatar: '$sender_doc.avatar' }}},
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

    res.status(200).json({ favorites: validFavorites, ...pagination, });
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

    const favorite = await Favorite.findOne({ user_id: currentUserId, target_id: targetId, target_type: targetType, });

    let isFavorite = false;

    if (favorite) {
      await Favorite.deleteOne({ _id: favorite._id });
      isFavorite = false;
    } else {
      await Favorite.create({ user_id: currentUserId, target_id: targetId, target_type: targetType, });
      isFavorite = true;
    }

    res.status(200).json({ isFavorite, message: isFavorite ? 'Added to favorites' : 'Removed from favorites', });
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
    io.to(`user_${userId}`).emit('chat_unmuted', { userId, targetId: target_id, targetType: target_type, });

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

    res.status(200).json({ chats: messages,  pagination });
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
      if (!ch.lastMessage) {
        const name = (ch.name || '').toLowerCase();
        return name.includes(searchTerm);
      }
    
      let name = '';
      let phone = null;
    
      if (ch.chat_type === 'direct') {
        name = ch.lastMessage.recipient?.name || ch.name || '';
        phone = ch.lastMessage.recipient?.phone || ch.phone;
      } else if (ch.chat_type === 'group') {
        name = ch.lastMessage.group?.name || ch.name || '';
      } else if (ch.chat_type === 'broadcast') {
        name = ch.name || ''; // broadcasts have .name directly
      } else if (ch.chat_type === 'announcement') {
        name = ch.name || 'Announcements';
      }
    
      return (
        name.toLowerCase().includes(searchTerm) ||
        (phone && phone.toLowerCase().includes(searchTerm))
      );
    });

    const totalCount = filteredChat.length;
    const totalPages = Math.ceil(totalCount / limit);
    const startIndex = (page - 1) * limit;
    const paginatedChats = filteredChat.slice(startIndex, startIndex + limit);

    res.status(200).json({
      success: true,
      chats: paginatedChats,
      pagination: { page, limit, totalCount, totalPages, hasMore: page < totalPages }
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

    const existing = await UserDelete.findOne({ user_id: userId, target_id: targetId, target_type: targetType });
    if (existing) {
      return res.status(400).json({ message: 'Chat already deleted.' });
    }

    await UserDelete.create({ user_id: userId, target_id: targetId, target_type: targetType, delete_type: deleteType });
    const clearData = { user_id: userId, cleared_at: new Date() };

    if (targetType === 'user') {
      clearData.recipient_id = targetId;
    } else if (targetType === 'group') {
      clearData.group_id = targetId;
    }

    const filter = { user_id: userId };
    if (targetType === 'user') {
      filter.recipient_id = targetId;
    } else if (targetType === 'group') {
      filter.group_id = targetId;
    }

    await ChatClear.findOneAndUpdate(filter, { $set: { cleared_at: new Date() } }, { upsert: true });

    res.status(200).json({ message: `${targetType} Chat Deleted Successfully` });
  } catch (error) {
    console.error('Error in deleteChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteAllChats = async (req, res) => {
  const userId = req.user._id;

  try {
    const directPartners = await Message.aggregate([
      { $match: { group_id: null, $or: [{ sender_id: userId }, { recipient_id: userId }] }},
      { $project: { partner_id: { $cond: [{ $eq: ['$sender_id', userId] }, '$recipient_id', '$sender_id']} }},
      { $group: { _id: '$partner_id' } },
      { $match: { _id: { $ne: null } } },
    ]);

    const directPartnerIds = directPartners.map(p => p._id);

    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(g => g.group_id).filter(id => id != null);

    const deletePayloads = [
      ...directPartnerIds.map(id => ({ user_id: userId, target_id: id, target_type: 'user', delete_type: 'hide_chat'})),
      ...groupIds.map(id => ({ user_id: userId, target_id: id, target_type: 'group', delete_type: 'hide_chat', })),
    ];

    if (deletePayloads.length > 0) {
      await UserDelete.insertMany(deletePayloads, { ordered: false }).catch(() => {});
    }

    const clearPromises = [];

    for (const recipientId of directPartnerIds) {
      clearPromises.push(
        ChatClear.updateOne(
          { user_id: userId, recipient_id: recipientId }, { $set: { cleared_at: new Date() } }, { upsert: true }
        )
      );
    }

    for (const groupId of groupIds) {
      clearPromises.push(
        ChatClear.updateOne(
          { user_id: userId, group_id: groupId }, { $set: { cleared_at: new Date() } }, { upsert: true }
        )
      );
    }

    if (clearPromises.length > 0) {
      await Promise.all(clearPromises);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('chats-deleted-all', { userId: userId.toString(), deletedCount: deletePayloads.length });
    }

    return res.status(200).json({
      totalDeleted: deletePayloads.length,
      message: `Successfully deleted ${deletePayloads.length} chats.`,
    });
  } catch (error) {
    console.error('Error in deleteAllChats:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
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
      const groupObjId = new mongoose.Types.ObjectId(groupId);
      const group = await Group.findById(groupObjId).lean();
      if (!group) return res.status(400).json({ message: 'Group not found.' });

      const member = await GroupMember.findOne({ group_id: groupObjId, user_id: userId }).lean();
      if (!member) return res.status(403).json({ message: 'You are not a member of this group.' });

      const clearEntry = await ChatClear.findOne({ user_id: userId, group_id: groupObjId }).lean();

      const pipeline = [
        { $match: { group_id: groupObjId, content: { $ne: null } } },
        ...(clearEntry ? [{ $match: { created_at: { $gt: clearEntry.cleared_at } } }] : []),
        { $sort: { created_at: 1 } },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' }},
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $addFields: { sender_name: { $ifNull: ['$sender_doc.name', 'Unknown User'] }}},
        { $project: { content: 1, created_at: 1, sender_name: 1 }},
      ];

      messages = await Message.aggregate(pipeline);

      textContent += chatHeader(`Group: ${group.name}`);
      filename = `group_${initials(group.name)}_${formatDateForFilename(new Date())}.txt`;
    } else if (recipientId) {
      const recipientObjId = new mongoose.Types.ObjectId(recipientId);
      const currentUser = await User.findById(userId).lean();

      const recipient = await User.findById(recipientObjId).lean();
      if (!recipient) return res.status(400).json({ message: 'Recipient user not found.' });

      const isBlocked = await Block.findOne({ blocker_id: userId, blocked_id: recipientObjId }).lean();
      if (isBlocked) return res.status(403).json({ message: 'Cannot export chat with blocked user' });

      const clearEntry = await ChatClear.findOne({ user_id: userId, recipient_id: recipientObjId }).lean();

      const pipeline = [
        {
          $match: {
            $or: [
              { sender_id: userId, recipient_id: recipientObjId },
              { sender_id: recipientObjId, recipient_id: userId },
            ],
            message_type: 'text',
            content: { $ne: null },
          },
        },
        ...(clearEntry ? [{ $match: { created_at: { $gt: clearEntry.cleared_at } } }] : []),
        { $sort: { created_at: 1 } },
        { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' }},
        { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
        { $addFields: { sender_name: { $ifNull: ['$sender_doc.name', 'Unknown User'] }}},
        { $project: { content: 1, created_at: 1, sender_name: 1 }},
      ];

      messages = await Message.aggregate(pipeline);

      textContent += chatHeader(`Participants: ${currentUser.name} ↔ ${recipient.name}`);
      filename = `chat_${initials(currentUser.name)}_${initials(recipient.name)}_${formatDateForFilename(new Date())}.txt`;
    }

    if (messages.length === 0) {
      textContent += 'No messages are available for this conversation.\n';
    } else {
      messages.forEach((msg) => {
        const msgDate = new Date(msg.created_at);
        const dateStr = formatDate(msgDate);
        const timeStr = formatTime(msgDate);
        const senderName = msg.sender_name || 'Unknown User';

        textContent += `${dateStr}, ${timeStr} - ${senderName}: ${msg.content}\n`;
      });
    }

    textContent += `\n================================================\nEnd of conversation\n================================================\n`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    return res.status(200).send(textContent);
  } catch (error) {
    console.error('Error in exportChat:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.clearChat = async (req, res) => {
  const userId = req.user._id;
  const { recipientId, groupId, broadcastId } = req.body;

  try {
    const targets = [recipientId, groupId, broadcastId].filter(Boolean);
    if (targets.length !== 1) {
      return res.status(400).json({ message: 'Provide exactly one of: recipientId, groupId, or broadcastId.' });
    }

    const filter = { user_id: userId };
    const update = { $set: { cleared_at: new Date() } };

    if (recipientId) {
      filter.recipient_id = recipientId;
    } else if (groupId) {
      filter.group_id = groupId;
    } else if (broadcastId) {
      filter.broadcast_id = broadcastId;
    }

    await ChatClear.updateOne(filter, update, { upsert: true });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('chat-cleared', {
        userId: userId.toString(),
        recipientId: recipientId || null,
        groupId: groupId || null,
        broadcastId: broadcastId || null,
        clearedAt: new Date(),
      });
    }

    return res.status(200).json({ message: 'Chat cleared successfully.' });
  } catch (error) {
    console.error('Error in clearChat:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.clearAllChats = async (req, res) => {
  const userId = req.user._id;

  try {
    const directPartners = await Message.aggregate([
      { $match: { group_id: null, $or: [{ sender_id: userId }, { recipient_id: userId }]}},
      { $project: { partner_id: { $cond: [{ $eq: ['$sender_id', userId] }, '$recipient_id', '$sender_id']} }},
      { $group: { _id: '$partner_id' } },
      { $match: { _id: { $ne: null } } },
    ]);

    const directPartnerIds = directPartners.map(p => p._id);

    const groupMembers = await GroupMember.find({ user_id: userId }).select('group_id').lean();
    const groupIds = groupMembers.map(g => g.group_id).filter(id => id != null);

    const deletePayloads = [
      ...directPartnerIds.map(id => ({ user_id: userId, target_id: id, target_type: 'user', delete_type: 'hide_chat', })),
      ...groupIds.map(id => ({ user_id: userId, target_id: id, target_type: 'group', delete_type: 'hide_chat' })),
    ];

    if (deletePayloads.length > 0) {
      await UserDelete.insertMany(deletePayloads, { ordered: false }).catch(() => {});
    }

    const now = new Date();
    const clearPromises = [];

    for (const recipientId of directPartnerIds) {
      clearPromises.push(
        ChatClear.updateOne(
          { user_id: userId, recipient_id: recipientId }, { $set: { cleared_at: now } }, { upsert: true }
        )
      );
    }

    for (const groupId of groupIds) {
      clearPromises.push( ChatClear.updateOne( { user_id: userId, group_id: groupId }, { $set: { cleared_at: now } }, { upsert: true }));
    }

    if (clearPromises.length > 0) {
      await Promise.all(clearPromises);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('chats-cleared-all', { userId: userId.toString(), clearedCount: deletePayloads.length, });
    }

    return res.status(200).json({
      totalCleared: deletePayloads.length,
      message: deletePayloads.length > 0
        ? `${deletePayloads.length} chats cleared successfully.`
        : 'No chats with new messages to clear.',
    });
  } catch (error) {
    console.error('Error in clearAllChats:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};