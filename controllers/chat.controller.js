const { PinnedConversation, Archive, User, Message, Block, Favorite, Group,
  UserDelete, MutedChat, GroupMember, Sequelize, ChatClear, Broadcast, BroadcastMember } = require('../models');
const { Op } = require('sequelize');
const { fetchBlockedUsers, fetchFavoriteData, fetchArchiveChats, fetchContacts, fetchRecentChat,
  formatDate, formatTime, initials, formatDateForFilename, chatHeader } = require('../helper/chatHelpers');

exports.togglePinConversation = async (req, res) => {
  const userId = req.user.id;
  const { type, targetId } = req.body;

  try {
    const existingPin = await PinnedConversation.findOne({
      where: { user_id: userId, type, target_id: targetId },
    });

    const io = req.app.get('io');
    const emitPinUpdate = (pinned, pinnedAt = null) => {
      if (!io) return;
      io.to(`user_${userId}`).emit('chat-pin-updated', {
        type,
        targetId,
        pinned,
        pinned_at: pinnedAt,
      });
    };

    if (existingPin) {
      await existingPin.destroy();
      emitPinUpdate(false, null);
      return res.status(200).json({
        message: 'Unpinned successfully',
        pinned: false,
      });
    }

    const pinnedAt = new Date();
    await PinnedConversation.create({
      user_id: userId,
      type,
      target_id: targetId,
      pinned_at: pinnedAt,
    });

    emitPinUpdate(true, pinnedAt.toISOString());
    return res.status(201).json({ message: 'Pinned successfully', pinned: true, pinned_at: pinnedAt.toISOString() });
  } catch (error) {
    console.error('Error in togglePinConversation:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getArchivedChats = async (req, res) => {
  const currentUserId = req.user.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { archivedChats, pagination } = await fetchArchiveChats({ userId: currentUserId, page, limit });

    res.status(200).json({
      archived: archivedChats, ...pagination
    });
  } catch (error) {
    console.error('Error in getArchivedChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.toggleArchive = async (req, res) => {
  const userId = req.user.id;
  const { targetId, targetType = 'user' } = req.body;

  if (!targetId) return res.status(400).json({ message: 'Target Id is required' });

  try {
    if (targetType === 'user') {
      const user = await User.findByPk(targetId);
      if (!user) return res.status(404).json({ message: 'User Not Found' });
    } else if (targetType === 'group') {
      const group = await Group.findByPk(targetId);
      if (!group) return res.status(404).json({ message: 'Group Not Found' });
    } else if (targetType === 'broadcast') {
      const broadcast = await Broadcast.findByPk(targetId);
      if (!broadcast) return res.status(404).json({ message: 'Broadcast Not Found' });
    }
    const existingArchive = await Archive.findOne({
      where: {
        user_id: userId,
        target_id: targetId,
        target_type: targetType,
      },
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
      await existingArchive.destroy();
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
  const currentUserId = req.user.id;
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

      return name.includes(search) || email.includes(search) || phone.includes(search);
    });

    res.status(200).json({ archiveChats: filtered, ...pagination });
  } catch (error) {
    console.error('Error in searchArchiveChats:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.archiveAllChats = async (req, res) => {
  const userId = req.user.id;

  try {
    const directResults = await Message.findAll({
      where: {
        group_id: null,
        [Op.and]: [
          { [Op.or]: [{ sender_id: userId }, { recipient_id: userId }] },
          { sender_id: { [Op.ne]: Sequelize.col('recipient_id') } },
        ],
      },
      attributes: [
        [Sequelize.literal(`CASE WHEN sender_id=${userId} THEN recipient_id ELSE sender_id END`), 'partner_id'],
      ],
      group: ['partner_id'],
      raw: true,
    });

    const directPartnerIds = directResults.map((r) => r.partner_id).filter(Boolean);

    const groupResults = await GroupMember.findAll({
      where: { user_id: userId },
      attributes: ['group_id'],
      raw: true,
    });
    const groupIds = groupResults.map((g) => g.group_id);

    const blocked = await Block.findAll({
      where: { blocker_id: userId },
      attributes: ['blocked_id'],
      raw: true,
    });
    const blockedIds = blocked.map((b) => b.blocked_id);
    const finalUserTargets = directPartnerIds.filter((id) => !blockedIds.includes(id));

    const createArchiveRecord = (targetId, targetType) =>
      Archive.findOrCreate({
        where: { user_id: userId, target_id: targetId, target_type: targetType },
        defaults: { user_id: userId, target_id: targetId, target_type: targetType },
      });

    const archivePromises = [
      ...finalUserTargets.map((id) => createArchiveRecord(id, 'user')),
      ...groupIds.map((id) => createArchiveRecord(id, 'group')),
    ];

    const results = await Promise.all(archivePromises);
    const archivedCount = results.filter(([record, created]) => created).length;

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
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getBlockedUsers = async (req, res) => {
  const currentUserId = req.user.id;
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
  const userId = req.user.id;
  const { targetId, block_type = 'user' } = req.body;

  if (!targetId){
    return res.status(400).json({ message: 'Target Id is required.' });
  } 

  try {
    let whereCondition = { blocker_id: userId, block_type };

    if(block_type === 'user'){
      if (userId === parseInt(targetId)) {
        return res.status(400).json({ message: 'You can not block yourself.' });
      }

      const user = await User.findByPk(targetId);
      if (!user) return res.status(404).json({ message: 'User Not Found' });

      whereCondition.blocked_id = targetId;

    } else if(block_type === 'group'){
      const group = await Group.findByPk(targetId);
      if(!group) return res.status(404).json({ message: 'Group Not Found' });

      whereCondition.group_id = targetId;
    }
    
    const existingBlock = await Block.findOne({ where: whereCondition });

    let action, systemMessage;

    if (existingBlock) {
      await existingBlock.destroy();
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
        targetId: Number(targetId),
        action,
      });

      const fullSystemMessage = await Message.findByPk(createdSystemMessage.id, {
        include: [
          { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
          block_type === 'group'
            ? { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] }
            : { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'] },
        ],
      });
      if (fullSystemMessage) {
        io.to(`user_${userId}`).emit('receive-message', fullSystemMessage);
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
  const userId = req.user.id;
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
  const currentUserId = req.user.id;
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
  const currentUserId = req.user.id;
  const { targetId, targetType } = req.body;

  try {
    if (targetType === 'user') {
      const user = await User.findByPk(targetId);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (targetType === 'group') {
      const group = await Group.findByPk(targetId);
      if (!group) return res.status(404).json({ message: 'Group not found.' });
    }

    const favorite = await Favorite.findOne({
      where: {
        user_id: currentUserId,
        target_id: targetId,
        target_type: targetType,
      },
    });

    let isFavorite = false;

    if (favorite) {
      await favorite.destroy();
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
    const userId = req.user.id;
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
  const userId = req.user.id;

  try {
    if (!target_id) return res.status(400).json({ message: 'Recipient Id is required.' });

    if (target_type === 'user') {
      const user = await User.findByPk(target_id);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (target_type === 'group') {
      const group = await Group.findByPk(target_id);
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

    await MutedChat.upsert({
      user_id: userId,
      target_id,
      target_type,
      muted_until: mutedUntil,
    });

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
  const userId = req.user.id;

  try {
    if (!target_id) return res.status(400).json({ message: 'Recipient Id is required.' });

    if (target_type === 'user') {
      const user = await User.findByPk(target_id);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (target_type === 'group') {
      const group = await Group.findByPk(target_id);
      if (!group) return res.status(404).json({ message: 'Group not found.' });
    }

    await MutedChat.destroy({
      where: { user_id: userId, target_id, target_type },
    });

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
  const currentUserId = req.user.id;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const { messages, pagination } = await fetchRecentChat(currentUserId, page, limit, { paginate: true });

    res.status(200).json({
      chats: messages, pagination
    });
  } catch (err) {
    console.error('getRecentChats error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.searchRecentChat = async (req, res) => {
  const currentUserId = req.user.id;
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
        page,limit, totalCount, totalPages, hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error in searchRecentChat:', error);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
};

exports.getContacts = async (req, res) => {
  const currentUserId = req.user.id;
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
  const currentUserId = req.user.id;
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
  const userId = req.user.id;
  const { targetId, targetType = 'user', deleteType = 'hide_chat' } = req.body;

  if (!targetId) {
    return res.status(400).json({ message: 'Target Id is required.' });
  }

  try {
    if (targetType === 'user') {
      const user = await User.findByPk(targetId);
      if (!user) return res.status(404).json({ message: 'User not found.' });
    } else if (targetType === 'group') {
      await Group.findByPk(targetId);
    }

    const existing = await UserDelete.findOne({
      where: {
        user_id: userId,
        target_id: targetId,
        target_type: targetType,
      },
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

    await ChatClear.upsert(clearData);

    res.status(200).json({ message: `${targetType} Chat Deleted Successfully` });
  } catch (error) {
    console.error('Error in deleteChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteAllChats = async (req, res) => {
  const userId = req.user.id;

  try {
    const directResults = await Message.findAll({
      where: {
        group_id: null,
        [Op.or]: [{ sender_id: userId }, { recipient_id: userId }],
        sender_id: { [Op.ne]: Sequelize.col('recipient_id') },
      },
      attributes: [
        [Sequelize.literal(`CASE WHEN sender_id=${userId} THEN recipient_id ELSE sender_id END`), 'partner_id'],
      ],
      group: ['partner_id'],
      raw: true,
    });

    const directPartnerIds = directResults.map((r) => r.partner_id).filter(Boolean);

    const groupIds = await GroupMember.findAll({
      where: { user_id: userId },
      attributes: ['group_id'],
      raw: true,
    }).then((groups) => groups.map((g) => g.group_id));

    const deletePayloads = [
      ...directPartnerIds.map((id) => ({
        user_id: userId,
        target_id: id,
        target_type: 'user',
        delete_type: 'hide_chat',
      })),
      ...groupIds.map((id) => ({
        user_id: userId,
        target_id: id,
        target_type: 'group',
        delete_type: 'hide_chat',
      })),
    ];

    if (deletePayloads.length > 0) {
      await UserDelete.bulkCreate(deletePayloads, { ignoreDuplicates: true });
    }

    const clearPayload = [
      ...directPartnerIds.map((id) => ({
        user_id: userId,
        recipient_id: id,
        cleared_at: new Date(),
      })),
      ...groupIds.map((id) => ({
        user_id: userId,
        group_id: id,
        cleared_at: new Date(),
      })),
    ];

    for (const data of clearPayload) {
      await ChatClear.upsert(data);
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
  const userId = req.user.id;
  const { recipientId, groupId } = req.query;

  try {
    if ((!recipientId && !groupId) || (recipientId && groupId)) {
      return res.status(400).json({ message: 'Provide either recipientId or groupId, not both.' });
    }

    let messages = [];
    let filename = '';
    let textContent = '';
    let clearEntry = null;

    if (groupId) {
      const group = await Group.findByPk(groupId);
      if (!group) return res.status(400).json({ message: 'Group not found.' });

      const member = await GroupMember.findOne({ where: { group_id: groupId, user_id: userId } });
      if (!member) return res.status(403).json({ message: 'You are not member of this group.' });

      clearEntry = await ChatClear.findOne({ where: { user_id: userId, group_id: groupId } });

      const whereCondition = { [Op.and]: [{ group_id: groupId }, { content: { [Op.ne]: null } }] };

      if (clearEntry) {
        whereCondition[Op.and].push({ created_at: { [Op.gt]: clearEntry.cleared_at } });
      }

      messages = await Message.findAll({
        where: whereCondition,
        include: [{ model: User, as: 'sender', attributes: ['id', 'name'] }],
        order: [['created_at', 'ASC']],
      });

      textContent += chatHeader(`Group: ${group.name}`);
      filename = `group_${initials(group.name)}_${formatDateForFilename(new Date())}.txt`;
    } else if (recipientId) {
      const user = await User.findByPk(userId);

      const recipient = await User.findByPk(recipientId);
      if (!recipient) return res.status(400).json({ message: 'recipient user not found.' });

      const isBlocked = await Block.findOne({ where: { blocker_id: userId, blocked_id: recipientId } });
      if (isBlocked) return res.status(403).json({ error: 'Cannot export chat with blocked user' });

      clearEntry = await ChatClear.findOne({
        where: { user_id: userId, recipient_id: recipientId },
      });

      const whereCondition = {
        [Op.and]: [
          {
            [Op.or]: [
              { sender_id: userId, recipient_id: recipientId },
              { sender_id: recipientId, recipient_id: userId },
            ],
          },
          { message_type: 'text' },
          { content: { [Op.ne]: null } },
        ],
      };

      if (clearEntry) {
        whereCondition[Op.and].push({ created_at: { [Op.gt]: clearEntry.cleared_at } });
      }

      messages = await Message.findAll({
        where: whereCondition,
        include: [{ model: User, as: 'sender', attributes: ['id', 'name'] }],
        order: [['created_at', 'ASC']],
      });

      textContent += chatHeader(`Participants: ${user.name} ↔ ${recipient.name}`);
      filename = `chat_${initials(user.name)}_${initials(recipient.name)}_${formatDateForFilename(new Date())}.txt`;
    }

    if (messages.length === 0) {
      textContent += 'No messages are available for this conversation.';
    } else {
      messages.forEach((msg) => {
        const msgDate = new Date(msg.created_at);
        const dateStr = formatDate(msgDate);
        const timeStr = formatTime(msgDate);
        const senderName = msg.sender.name;

        textContent += `${dateStr}, ${timeStr} - ${senderName}: ${msg.content}\n`;
      });
    }

    textContent += `\n================================================\n
      End of conversation\n================================================\n`;

    res.setHeader('Content-Disposition', `attachment; filename='${filename}'`);
    res.setHeader('Content-Type', 'text/plain');

    return res.status(200).send(textContent);
  } catch (error) {
    console.error('Error in exportChat:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.clearChat = async (req, res) => {
  const userId = req.user.id;
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

    await ChatClear.upsert(data, {
      conflictFields: ['user_id', 'recipient_id', 'group_id', 'broadcast_id']
    });

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
  const userId = req.user.id;

  try {
    const directChats = await Message.findAll({
      attributes: [
        [
          Sequelize.literal(`CASE WHEN sender_id = ${userId} THEN recipient_id ELSE sender_id END`),
          'chatUserId',
        ],
      ],
      where: {
        [Op.or]: [{ sender_id: userId }, { recipient_id: userId }],
        deleted_at: null,
      },
      group: ['chatUserId'],
      having: Sequelize.literal('chatUserId IS NOT NULL'),
    });

    const groupChats = await GroupMember.findAll({
      attributes: ['group_id'],
      where: { user_id: userId },
    });

    const now = new Date();
    const clearEntries = [];

    for (const chat of directChats) {
      const chatUserId = chat.get('chatUserId');
      if (!chatUserId) continue;

      const existingClear = await ChatClear.findOne({
        where: { user_id: userId, recipient_id: chatUserId },
      });

      const msgWhere = {
        deleted_at: null,
        [Op.or]: [
          { sender_id: userId, recipient_id: chatUserId },
          { sender_id: chatUserId, recipient_id: userId },
        ],
      };

      if (existingClear && existingClear.cleared_at) {
        msgWhere.created_at = { [Op.gt]: existingClear.cleared_at };
      }

      const newMessageCount = await Message.count({ where: msgWhere });

      if (newMessageCount > 0) {
        clearEntries.push({
          user_id: userId,
          recipient_id: chatUserId,
          cleared_at: now,
        });
      }
    }

    for (const g of groupChats) {
      const groupId = g.group_id;

      const existingClear = await ChatClear.findOne({
        where: { user_id: userId, group_id: groupId },
      });

      const groupMsgWhere = { group_id: groupId, deleted_at: null };
      if (existingClear && existingClear.cleared_at) {
        groupMsgWhere.created_at = { [Op.gt]: existingClear.cleared_at };
      }

      const newGroupMessageCount = await Message.count({ where: groupMsgWhere });
      if (newGroupMessageCount > 0) {
        clearEntries.push({ user_id: userId, group_id: groupId, cleared_at: now });
      }
    }

    if (clearEntries.length > 0) {
      await Promise.all(clearEntries.map((entry) => ChatClear.upsert(entry)));
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