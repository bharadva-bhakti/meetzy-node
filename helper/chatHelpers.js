const { PinnedConversation, Archive, User, Message, Block, Favorite, Group, UserDelete, 
  MutedChat, GroupMember, sequelize, Sequelize, Friend, ChatClear, MessageAction, MessageStatus,
  UserSetting, ChatSetting, Setting, Broadcast, BroadcastMember} = require('../models');
const { Op } = require('sequelize');

async function formatLastMessage (message, currentUserId = null) {
  if (!message) return 'No messages yet';
  
  const { content, message_type, file_url, metadata } = message;
  
  if (message_type === 'system' && metadata) {
    const systemAction = metadata.system_action;
    
    if (systemAction === 'member_left' && currentUserId && metadata.user_id === currentUserId) {
      return 'You left the group';
    }
    
    return content || 'System message';
  }
  
  switch (message_type) {
    case 'text':
      return content || 'Message';
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎵 Audio';
    case 'file':
    case 'document':
      return '📄 Document';
    case 'sticker':
      return '✨ Sticker';
    default:
      return 'Message';
  }
};

async function fetchBlockedUsers(userId, { page = 1, limit = 20, search = '' }) {
  const offset = (page - 1) * limit;

  const settings = await Setting.findOne({ attributes: ['app_name'], raw: true });

  const { count, rows } = await Block.findAndCountAll({
    where: { blocker_id: userId },
    include: [
      { model: User, as: 'blocked', attributes: ['id', 'name', 'role', 'bio', 'avatar', 'email']},
      { model: Group, as: 'blockedGroup', attributes: ['id', 'name', 'avatar']}
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset
  });
  
  const blockedData = rows.map(b => ({
    id: b.id,
    type: b.block_type,
    user: {
      id: b.blocked.id,
      name: b.blocked?.role !== 'user' ? settings.app_name : b.blocked.name,
      avatar: b.blocked.avatar,
      email: b.blocked.email,
      bio: b.blocked.bio || null,
    } || null,
    group: b.blockedGroup || null,
    created_at: b.created_at
  }));

  const filtered = search
    ? blockedData.filter(b => {
        if (b.type === 'user') {
          const name = b.user?.name?.toLowerCase() || '';
          const email = b.user?.email?.toLowerCase() || '';
          return name.includes(search) || email.includes(search);
        } else {
          const name = b.group?.name?.toLowerCase() || '';
          return name.includes(search);
        }
      })
    : blockedData;

  return {
    count,
    blocked: filtered,
    hasMore: page * limit < count,
    totalPages: Math.ceil(count / limit)
  };
}

async function resolveChatObject(conv, currentUserId, relations) {
  const { pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, archivedSet, favoriteSet } = relations;
  
  let chat = await getLatestMessage(
    conv, currentUserId, pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, archivedSet, favoriteSet
  );

  const systemSettings = await Setting.findOne({ attributes:['app_name'], raw: true });
  
  if (!chat) {
    const info =
      conv.type === 'direct'
        ? await User.findByPk(conv.id, { 
            attributes: ['id', 'name', 'bio', 'role', 'email', 'avatar', 'phone', 'is_verified'], 
            include: [
              { model: UserSetting, as: 'setting', attributes: ['hide_phone']}
            ],
            raw: true 
          })
        : await Group.findByPk(conv.id, { attributes: ['id', 'name', 'avatar'], raw: true });
    
    chat = {
      chat_type: conv.type,
      chat_id: conv.id,
      name: info?.role === 'super_admin' ? systemSettings.app_name :  info?.name || null,
      email: info?.email || null,
      phone: info?.phone || null,
      bio: info?.bio || null,
      avatar: info?.avatar || null,
      is_verified: info?.is_verified || false,
      lastMessage: null,
      unreadCount: 0
    };
  }

  const convKey = `${conv.type}:${conv.id}`;
  chat.isGroup    = conv.type === 'group';
  chat.isBlocked  = conv.type === 'direct' ? blockedUsers.has(conv.id) : false;
  chat.isFavorite = favoriteSet.has(convKey);
  chat.isMuted    = mutedMap.has(convKey);
  chat.isPinned   = pinnedSet.has(convKey);
  chat.pinned_at  = pinnedTimeMap.get(convKey) || null;
  chat.isArchived = archivedSet.has(convKey);

  return chat;
};

async function fetchFavoriteData(userId, page = 1, limit = 20) {
  const offset = (page - 1) * limit;

  const { count: totalCount, rows: favorites } = await Favorite.findAndCountAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    limit,
    offset,
    raw: true
  });

  const relations = await getUserRelations(userId);

  const favoriteChats = await Promise.all(
    favorites.map(async (fav) => {
      const conv = {
        type: fav.target_type === 'user' ? 'direct' : fav.target_type,
        id: fav.target_id
      };

      const chat = await resolveChatObject(conv, userId, relations);
      chat.favorite_at = fav.created_at;

      return chat;
    })
  );
  
  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    validFavorites: favoriteChats,
    pagination: { page, limit, totalCount, totalPages, hasMore }
  };
};

async function fetchFriendSuggestions(userId, { search = '', page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;

  const friendships = await Friend.find({
    $or: [{ user_id: userId }, { friend_id: userId }],
    status: { $ne: 'rejected' },
  }).lean();

  const friendIds = new Set();
  friendships.forEach(f => {
    if (f.user_id.toString() === userId.toString()) friendIds.add(f.friend_id.toString());
    else friendIds.add(f.user_id.toString());
  });
  friendIds.add(userId.toString());

  const allUserSettings = await UserSetting.find({})
    .select('user_id hide_phone')
    .lean();

  const hidePhoneMap = new Map(allUserSettings.map(s => [s.user_id.toString(), s.hide_phone]));

  const query = {
    _id: { $nin: Array.from(friendIds).map(id => new mongoose.Types.ObjectId(id)) },
    role: 'user',
    status: 'active',
  };

  if (search) {
    const regex = { $regex: search, $options: 'i' };
    query.$or = [
      { name: regex },
      { email: regex },
    ];

    const visiblePhoneUserIds = Array.from(hidePhoneMap.entries())
      .filter(([, hide]) => hide === false)
      .map(([id]) => id);

    if (visiblePhoneUserIds.length > 0) {
      query.$or.push({
        $and: [
          { _id: { $in: visiblePhoneUserIds.map(id => new mongoose.Types.ObjectId(id)) } },
          { phone: regex },
        ],
      });
    }
  }

  const totalCount = await User.countDocuments(query);

  const suggestions = await User.find(query)
    .select('id bio name avatar phone email')
    .sort({ name: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const suggestionIds = suggestions.map(s => s.id);
  const userSettings = await UserSetting.find({ user_id: { $in: suggestionIds } })
    .select('user_id profile_pic hide_phone')
    .lean();

  const settingsMap = new Map(userSettings.map(s => [s.user_id.toString(), s]));

  const suggestionsWithPrivacy = suggestions.map(s => {
    const setting = settingsMap.get(s.id.toString());
    const avatar = setting && setting.profile_pic === false ? null : (s.avatar || null);
    return {
      id: s.id,
      bio: s.bio,
      name: s.name,
      avatar,
      phone: s.phone,
      email: s.email,
    };
  });

  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    suggestions: suggestionsWithPrivacy,
    pagination: { page, limit, totalCount, totalPages, hasMore },
  };
};

async function fetchArchiveChats({ userId, page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  const { rows: archives, count: totalCount } = await Archive.findAndCountAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    limit,
    offset,
    raw: true
  });

  const relations = await getUserRelations(userId);
  
  const archivedChats = await Promise.all(
    archives.map(async archive => {
      const conv = {
        type: archive.target_type === 'user' ? 'direct' : archive.target_type,
        id: archive.target_id
      };

      const chat = await resolveChatObject(conv, userId, relations);
      chat.archived_at = archive.created_at;
      return chat;
    })
  );

  return {
    archivedChats,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasMore: page < Math.ceil(totalCount / limit)
    }
  };
};

function isLockedChat(userSetting, chatType, chatId) {
  if (!userSetting?.chat_lock_enabled || !Array.isArray(userSetting.locked_chat_ids)) {
    return false;
  }
  
  return userSetting.locked_chat_ids.some(
    chat => chat.type === chatType && chat.id === chatId
  );
};

async function getUserRelations(userId) {
  const [mutedChats,pinnedChats, hidden, blocked, archived, friends, favorites  ] = await Promise.all([
    MutedChat.findAll({ where: { user_id: userId }, raw: true }),
    PinnedConversation.findAll({ where: { user_id: userId }, raw: true }),
    UserDelete.findAll({ where: { user_id: userId, delete_type: 'hide_chat' }, raw: true }),
    Block.findAll({ where: { [Op.or]: [{ blocker_id: userId }, { blocked_id: userId }] }, raw: true }),
    Archive.findAll({ where: { user_id: userId }, raw: true }),
    Friend.findAll({
      where: { status: 'accepted', [Op.or]: [{ user_id: userId }, { friend_id: userId }]}, raw: true
    }),
    Favorite.findAll({ where: { user_id: userId }, raw: true })
  ]);

  const mutedMap = new Set(mutedChats.map(m => `${m.target_type}:${m.target_id}`));
  const hiddenSet = new Set(hidden.map(h => `${h.target_type}_${h.target_id}`));
  const archivedSet = new Set(archived.map(a => `${a.target_type}:${a.target_id}`));
  const friendIds = new Set(friends.map(f => f.user_id === userId ? f.friend_id : f.user_id));
  const favoriteSet = new Set(favorites.map(f => `${f.target_type}:${f.target_id}`));

  const pinnedSet = new Set(pinnedChats.map(p => `${p.type}:${p.target_id}`));
  const pinnedTimeMap = new Map(
    pinnedChats.map(p => [`${p.type}:${p.target_id}`, new Date(p.pinned_at).getTime()])
  );
  
  const blockedUsers = new Set();
  blocked.forEach((b) => {
    if (b.blocker_id === userId) {
      blockedUsers.add(b.blocked_id);
    }
  });

  const blockedGroups = new Set();
  blocked.forEach((b) => {
    if (b.blocker_id === userId && b.block_type === 'group') {
      if (b.group_id) blockedGroups.add(b.group_id);
    }
  });

  
  return { hiddenSet, archivedSet, friendIds, blockedUsers, blockedGroups, pinnedSet, pinnedTimeMap, mutedMap, favoriteSet };
};

function buildDirectWhere (userId, friendIds, hiddenSet) {
  const hiddenArray = Array.from(hiddenSet);

  return {
    group_id: null,
    [Op.or]: [
      { sender_id: userId, recipient_id: { [Op.in]: Array.from(friendIds) } },
      { recipient_id: userId, sender_id: { [Op.in]: Array.from(friendIds) } }
    ],
    ...(hiddenSet.size && {
      [Op.and]: [
        sequelize.where(
          sequelize.literal(`CASE 
            WHEN sender_id = ${userId} THEN CONCAT('user_', recipient_id)
            ELSE CONCAT('user_', sender_id)
          END`),
          { [Op.notIn]: hiddenArray }
        )
      ]
    })
  };
};

async function getChatSetting(currentUserId, conv) {
  if (conv.type === 'direct') {
    let setting = await ChatSetting.findOne({
      where: {
        user_id: currentUserId,
        recipient_id: conv.id,
        group_id: null,
      },
      raw: true,
    });

    if (setting) return setting;

    return await ChatSetting.findOne({
      where: {
        user_id: conv.id,
        recipient_id: currentUserId,
        group_id: null,
      },
      raw: true,
    });
  }

  return await ChatSetting.findOne({
    where: { group_id: conv.id, recipient_id: null},
    raw: true,
  });
};

async function getLatestMessage(conv, currentUserId, pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, blockedGroups, archivedSet, favoriteSet) {
  const isDM = conv.type === 'direct';
  const isAnnouncement = conv.type === 'announcement';
  const isBroadcast = conv.type === 'broadcast';
  
  if (isBroadcast) {
    const broadcast = await Broadcast.findByPk(conv.id, {
      include: [{
        model: BroadcastMember,
        as: 'recipients',
        include: [{ model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'] }]
      }]
    });

    if (!broadcast) return null;

    const clearEntry = await ChatClear.findOne({ where: { user_id: currentUserId, broadcast_id: conv.id }});

    const latestWhere = {
      sender_id: currentUserId,
      [Op.and]: [
        sequelize.literal(`JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.is_broadcast')) = 'true'`),
        sequelize.literal(`JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.broadcast_id')) = '${conv.id}'`)
      ]
    };
    
    if (clearEntry) {
      latestWhere.created_at = { [Op.gt]: clearEntry.cleared_at };
    }

    const latest = await Message.findOne({
      where: latestWhere,
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
      order: [['created_at', 'DESC']],
      raw: true,
      nest: true
    });

    const recipientIds = broadcast.recipients.map(r => r.recipient_id);
    const unreadCount = await MessageStatus.count({
      where: {
        user_id: currentUserId,
        status: { [Op.ne]: 'seen' }
      },
      include: [{
        model: Message,
        as: 'message',
        where: {
          sender_id: { [Op.in]: recipientIds },
          recipient_id: currentUserId
        },
        required: true
      }]
    });

    const favoriteKey = `broadcast:${conv.id}`;
    const muteKey = `broadcast:${conv.id}`;

    const currentUserSetting = await UserSetting.findOne({
      where: { user_id: currentUserId },
      attributes: ['chat_lock_enabled', 'locked_chat_ids'],
      raw: true
    });

    return {
      chat_type: 'broadcast',
      chat_id: conv.id,
      name: broadcast.name,
      avatar: null,
      lastMessage: latest,
      recipient_count: broadcast.recipients.length,
      recipients: broadcast.recipients.map(r => r.recipient),
      unreadCount: unreadCount || 0,
      isArchived: archivedSet.has(`broadcast:${conv.id}`),
      isFavorite: favoriteSet?.has(favoriteKey),
      isMuted: mutedMap.has(muteKey),
      isPinned: pinnedSet.has(`broadcast:${conv.id}`),
      pinned_at: pinnedTimeMap.get(`broadcast:${conv.id}`) || null,
      isBroadcast: true,
      isGroup: false,
      isAnnouncement: false,
      isLocked: isLockedChat(currentUserSetting, 'broadcast', conv.id),
      created_at: broadcast.created_at
    };
  }

  const chatSetting = !isAnnouncement ? await getChatSetting(currentUserId, conv) : null;

  let userSetting = null;
  let currentUserSetting = null;
  if (isDM) {
    userSetting = await UserSetting.findOne({
      where: { user_id: conv.id },
      attributes: ['last_seen', 'profile_pic', 'display_bio', 'read_receipts', 'typing_indicator', 'hide_phone'],
      raw: true
    });
  }

  currentUserSetting = await UserSetting.findOne({
    where: { user_id: currentUserId },
    attributes: ['chat_lock_enabled', 'locked_chat_ids'],
    raw: true,
  });

  let isLocked = false;
  if (isDM) {
    isLocked = isLockedChat(currentUserSetting, 'user', conv.id);
  } else if (isAnnouncement) {
    isLocked = isLockedChat(currentUserSetting, 'announcement', conv.id);
  } else {
    isLocked = isLockedChat(currentUserSetting, 'group', conv.id);
  }

  let messageWhere = {};

  if(isDM){
    messageWhere = {
      group_id: null,
      [Op.or]: [
        { sender_id: currentUserId, recipient_id: conv.id },
        { sender_id: conv.id, recipient_id: currentUserId }
      ],
      message_type: { [Op.ne]: 'system' }
    }
  } else if(isAnnouncement){
    messageWhere = { recipient_id: null, group_id: null };

    messageWhere[Op.and] = [
      sequelize.literal(`JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sent_by_admin')) = '1'`)
    ];
  } else {
    messageWhere = { group_id: conv.id };
  }
  
  messageWhere[Op.and] = messageWhere[Op.and] || [];

  if (!isAnnouncement && !isDM && blockedGroups.has(conv.id)) {
    messageWhere[Op.and].push(
      sequelize.literal(`
        (
          message_type = 'system'
          AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.visible_to')) IS NOT NULL
          AND CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.visible_to')) AS UNSIGNED) = ${currentUserId}
        )
      `)
    );
  } else if(!isAnnouncement) {
    messageWhere[Op.and].push(
      sequelize.literal(`
        (
          message_type != 'system'
          OR JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.visible_to')) IS NULL
          OR CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.visible_to')) AS UNSIGNED) = ${currentUserId}
        )
      `)
    );
  }    

  let chatClear;
  if(!isAnnouncement){
    const clearWhere = isDM
      ? { user_id: currentUserId, recipient_id: conv.id }
      : { user_id: currentUserId, group_id: conv.id };

    chatClear = await ChatClear.findOne({ where: clearWhere });
    if (chatClear) messageWhere.created_at = { [Op.gt]: chatClear.cleared_at };
  }
  
  const deletedMessages = await MessageAction.findAll({
    where: { 
      user_id: currentUserId,
      action_type: 'delete', 
      details: { 
        type: 'me',
        is_broadcast_view: false
      }},
    attributes: ['message_id'],
    raw: true,
  });

  const deletedIds = deletedMessages.map((d) => d.message_id);
  if (deletedIds.length) messageWhere.id = { [Op.notIn]: deletedIds };

  let chatInfo = null;
  if (isDM || isAnnouncement) {
    chatInfo = await User.findByPk(conv.id, { 
      attributes: ['id', 'name', 'email', 'bio', 'avatar', 'phone', 'is_verified'], 
      raw: true 
    });
  } else {
    chatInfo = await Group.findByPk(conv.id, { 
      attributes: ['id', 'name', 'avatar'], 
      raw: true 
    });
    
    if (!chatInfo) {
      return null;
    }
  }

  let leftAt = null;
  if (!isDM && !isAnnouncement) {
    const member = await GroupMember.findOne({
      where: { group_id: conv.id, user_id: currentUserId },
    });
    
    if (!member) {
      const leaveMessage = await Message.findOne({
        where: {
          group_id: conv.id,
          message_type: 'system',
          [Op.and]: [
            Sequelize.where(Sequelize.json('metadata.system_action'), 'member_left'),
            Sequelize.where(Sequelize.json('metadata.user_id'), currentUserId)
          ]
        },
        order: [['created_at', 'DESC']],
        limit: 1
      });
      
      if (leaveMessage) {
        leftAt = leaveMessage.created_at;
      } else {
        const userMessage = await Message.findOne({
          where: { group_id: conv.id, sender_id: currentUserId }, limit: 1
        });
        
        if (!userMessage) return null;
      }
    }
  }

  if (!isAnnouncement && (chatClear || leftAt)) {
    const conditions = [];
    if (chatClear) {
      conditions.push({ [Op.gt]: chatClear.cleared_at });
    }
    if (leftAt) {
      conditions.push({ [Op.lte]: leftAt });
    }
    
    if (conditions.length === 1) {
      messageWhere.created_at = conditions[0];
    } else {
      messageWhere.created_at = { [Op.and]: conditions };
    }
  }
  
  const include = [];

  if (isDM) {
    include.push(
      { model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'phone'] },
      { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar', 'phone'] }
    );
  } else if (isAnnouncement) {
    include.push({ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'phone'] });
  } else {
    include.push(
      { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] },
      { model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'phone'] }
    );
  }

  if (!isAnnouncement) {
    include.push({
      model: MessageStatus,
      as: 'statuses',
      attributes: ['user_id', 'status', 'updated_at'],
      where: { user_id: { [Op.ne]: currentUserId } },
      required: false,
    });
  }

  const latest = await Message.findOne({
    where: messageWhere,
    order: [['created_at', 'DESC']],
    include: include,
    raw: true,
    nest: true,
  });

  let groupMentionMap = new Map();

  if(!isAnnouncement && !isDM) {
    const groupMemberShip = await GroupMember.findAll({
      where: { user_id: currentUserId },
      include: [{
        model: Group,
        attributes: ['id', 'name', 'avatar','description', 'created_by', 'created_at'],
        required: true,
      }]
    })
  
    const groupIds = groupMemberShip.map((gm) => gm.group_id);

    const groupMentions = await Promise.all(
      groupIds.map(async (groupId) => {
        const hasUnreadMentions = await Message.count({
          where: {
            group_id: groupId,
            [Op.not]: { sender_id: currentUserId },
            has_unread_mentions: true,
          },
          include: [
            {
              model: MessageStatus,
              as: 'statuses',
              where: { user_id: currentUserId, status: { [Op.ne]: 'seen' } },
              required: true,
            },
          ],
        });
        
        return { groupId, hasUnreadMentions: hasUnreadMentions > 0 };
      })
    );

    groupMentions.forEach(({ groupId, hasUnreadMentions }) => {
      groupMentionMap.set(groupId, hasUnreadMentions);
    });
  }

  const systemSettings = await Setting.findOne({ attributes: ['app_name'], raw: true });
  if (!latest && chatClear && !isAnnouncement) {
    const baseData = {
      chat_type: conv.type === 'announcement' ? 'direct' : conv.type,
      chat_id: conv.id,
      name: isAnnouncement ? systemSettings.app_name : chatInfo?.name,
      phone: chatInfo?.phone || null,
      email: chatInfo?.email || null,
      bio: chatInfo?.bio || null,
      avatar: chatInfo?.avatar || null,
      status: chatInfo?.status || null,
      is_verified: chatInfo?.is_verified || false,
      lastMessage: null,
      userSetting,
      unreadCount: 0,
      isMuted: mutedMap.has(`${conv.type}:${conv.id}`),
      isPinned: pinnedSet.has(`${conv.type}:${conv.id}`),
      isGroup: conv.type === 'group',
      isAnnouncement: conv.type === 'announcement',
      isBroadcast: false,
      isLocked
    };

    if (isDM) baseData.isBlocked = blockedUsers.has(conv.id);
    return baseData;
  }

  if (!latest) return null;
  
  const deletedForEveryone = await MessageAction.findOne({
    where: {
      message_id: latest.id, action_type: 'delete', details: { type: 'everyone' },
    },
    raw: true,
  });

  if (deletedForEveryone) {
    latest.content = 'This message was deleted';
  } else if (latest.message_type === 'system') {
    let metadata = latest.metadata;
    if (metadata && typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        metadata = {};
      }
    }
    
    if (metadata && metadata.system_action) {
      const systemAction = metadata.system_action;
      
      if (systemAction === 'member_left' && metadata.user_id === currentUserId) {
        latest.content = 'You left the group';
      }
      else if (systemAction === 'group_created' && metadata.creator_user_id === currentUserId) {
        latest.content = 'You created this group.';
      }
      else if (systemAction === 'group_created') {
        latest.content = latest.content || 'Group created';
      }
      else {
        latest.content = latest.content || 'System message';
      }
    } else {
      latest.content = latest.content || 'System message';
    }
  }
  
  const unreadCount = !isAnnouncement ? await MessageStatus.count({
    where: {
      user_id: currentUserId,
      status: { [Op.ne]: 'seen' },
      message_id: {
        [Op.in]: sequelize.literal(`(
          SELECT id FROM messages WHERE ${
            isDM ? `(sender_id = ${conv.id} AND recipient_id = ${currentUserId})`
              : `group_id = ${conv.id}`
          }
        )`),
      },
    },
  }) : 0;

  const avatar = isAnnouncement ? chatInfo?.avatar : (userSetting && userSetting.profile_pic === false ? null : (chatInfo?.avatar || null));
  const favoriteKey = isDM ? `user:${conv.id}` : `${conv.type}:${conv.id}`;
  const muteKey = isDM ? `user:${conv.id}` : `${conv.type}:${conv.id}`;

  const disappearing = isAnnouncement 
  ? { enabled: false, duration: null, expire_after_seconds: null }
  : {
    enabled: chatSetting?.disappearing_enabled || false,
    duration: chatSetting?.duration || null,
    expire_after_seconds: chatSetting?.expire_after_seconds || null,
  };
  
  const result = {
    chat_type: conv.type === 'announcement' ? 'direct' : conv.type,
    chat_id: conv.id,
    name: isAnnouncement ? systemSettings.app_name : chatInfo?.name,
    email: chatInfo?.email || null,
    bio: chatInfo?.bio || null,
    phone: chatInfo?.phone || null,
    avatar: avatar,
    status: chatInfo?.status || null,
    is_verified: chatInfo?.is_verified || false,
    lastMessage: latest,
    userSetting,
    unreadCount: unreadCount || 0,
    is_unread_mentions: groupMentionMap.get(conv.id) || false,
    isArchived: archivedSet.has(`${conv.type}:${conv.id}`),
    isFavorite: favoriteSet?.has(favoriteKey),
    isBlocked: false,
    isMuted: mutedMap.has(muteKey),
    isPinned: pinnedSet.has(`${conv.type}:${conv.id}`),
    pinned_at: pinnedTimeMap.get(`${conv.type}:${conv.id}`) || null,
    isGroup: conv.type === 'group',
    isAnnouncement: conv.type === 'announcement',
    isBroadcast: false,
    isLocked,
    disappearing,
  };
  
  result.isBlocked = isDM || isAnnouncement ? blockedUsers.has(conv.id) : blockedGroups.has(conv.id);
  if (!isDM && blockedGroups.has(conv.id)) {
    result.unreadCount = 0;
  }
  
  return result;
};

async function fetchRecentChat(currentUserId, page = 1, limit = 20, options = {}) {
  const { 
    hiddenSet, archivedSet, friendIds, blockedUsers, blockedGroups, pinnedSet, pinnedTimeMap, mutedMap, favoriteSet 
  } = await getUserRelations(currentUserId);
  const directWhere = buildDirectWhere(currentUserId, friendIds, hiddenSet);
  
  const directConvos = await Message.findAll({
    attributes: [
      [Sequelize.literal(`CASE WHEN sender_id=${currentUserId} THEN recipient_id ELSE sender_id END`), 'partner_id'],
      [Sequelize.fn('MAX', Sequelize.col('created_at')), 'last_activity']
    ],
    where: directWhere,
    group: ['partner_id'],
    order: [[Sequelize.fn('MAX', sequelize.col('created_at')), 'DESC']],
    raw: true
  });
  
  const directList = directConvos.filter(dc => {
    const hiddenKey = `user_${dc.partner_id}`;
    const archivedKey = `user:${dc.partner_id}`;
    
    return !hiddenSet.has(hiddenKey) && !archivedSet.has(archivedKey);
  });
  
  const groupExcludeIds = [
    ...Array.from(hiddenSet)
      .filter(x => x.startsWith('group_'))
      .map(x => +x.replace('group_', '')),
    ...Array.from(archivedSet)
      .filter(x => x.startsWith('group:'))
      .map(x => +x.replace('group:', ''))
  ];
  
  const membershipGroupIds = (
    await GroupMember.findAll({
      where: { user_id: currentUserId },
      attributes: ['group_id'],
      raw: true
    })
  ).map(g => g.group_id);

  const messageGroupIds = (
    await Message.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('group_id')), 'group_id']],
      where: { group_id: { [Op.ne]: null }, sender_id: currentUserId },
      raw: true,
    })
  ).map(m => m.group_id);

  const statusGroupIds = (
    await MessageStatus.findAll({
      attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('message.group_id')), 'group_id']],
      include: [
        {
          model: Message,
          as: 'message',
          attributes: [],
          where: { group_id: { [Op.ne]: null } },
          required: true,
        },
      ],
      where: { user_id: currentUserId },
      raw: true,
    })
  ).map((m) => m.group_id);

  const allGroupIds = Array.from(
    new Set([...membershipGroupIds, ...messageGroupIds, ...statusGroupIds].filter(Boolean))
  );

  const groupIdsFiltered = allGroupIds.filter(
    (id) => !groupExcludeIds.includes(id)
  );

  const groupConvos = groupIdsFiltered.length
    ? await Message.findAll({
        attributes: [
          'group_id',
          [Sequelize.fn('MAX', Sequelize.col('created_at')), 'last_activity']
        ],
        where: {
          group_id: { [Op.in]: groupIdsFiltered }
        },
        group: ['group_id'],
        order: [[Sequelize.fn('MAX', sequelize.col('created_at')), 'DESC']],
        raw: true
      })
    : [];
  
  const announcementData = await sequelize.query(`
    SELECT
    sender_id AS admin_id,
    MAX(created_at) AS last_activity,
    COUNT(id) AS announcement_count
    FROM messages
    WHERE
      recipient_id IS NULL
      AND group_id IS NULL
      AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.sent_by_admin')) = '1'
    GROUP BY sender_id
  `, { 
    type: sequelize.QueryTypes.SELECT,
  });

  const broadcastExcludeIds = [
    ...Array.from(hiddenSet).filter(x => x.startsWith('broadcast_')).map(x => +x.replace('broadcast_', '')),
  ];

  const userBroadcasts = await Broadcast.findAll({
    where: { 
      creator_id: currentUserId,
      id: {[Op.notIn]: broadcastExcludeIds}
    },
    attributes: ['id'],
    raw: true
  });

  const broadcastIds = userBroadcasts.map(b => b.id);
  
  const broadcastConvos = broadcastIds.length
    ? await sequelize.query(`
      SELECT 
        CAST(JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.broadcast_id')) AS UNSIGNED) AS broadcast_id,
        MAX(m.created_at) AS last_activity
      FROM messages m
      WHERE 
        m.sender_id = :userId
        AND JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.system_action')) = 'broadcast_created'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.broadcast_id')) AS UNSIGNED) IN (:broadcastIds)
      GROUP BY 
        CAST(JSON_UNQUOTE(JSON_EXTRACT(m.metadata, '$.broadcast_id')) AS UNSIGNED)
    `, {
      replacements: {
        userId: currentUserId,
        broadcastIds
      },
      type: sequelize.QueryTypes.SELECT
    })
    : [];

  const allConvos = [
    ...directList.map(dc => ({ type: 'direct', id: dc.partner_id })),
    ...groupConvos.map(gc => ({ type: 'group', id: gc.group_id })),
    ...broadcastConvos.map(bc => ({ type: 'broadcast', id: parseInt(bc.broadcast_id) }))
  ];
  
  announcementData.forEach(row => {
    const hiddenKey = `user${row.admin_id}`;

    if (hiddenSet.has(hiddenKey)) return;
    
    allConvos.push({
      type: 'announcement',
      id: row.admin_id,
      last_activity: row.last_activity,
      announcement_count: row.announcement_count
    });
  });

  const messages = (
    await Promise.all(allConvos.map(conv =>
      getLatestMessage(conv, currentUserId, pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, blockedGroups, archivedSet, favoriteSet)
    ))
  ).filter(Boolean);
  
  messages.sort((a, b) => {
    if (a.isPinned && b.isPinned) {
      return b.pinned_at - a.pinned_at;
    }

    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    const aTime = a.lastMessage ? new Date(a.lastMessage.created_at).getTime() : 0;
    const bTime = b.lastMessage ? new Date(b.lastMessage.created_at).getTime() : 0;
 
    return bTime - aTime;
  });

  const totalCount = messages.length;
  const totalPages = Math.ceil(totalCount / limit);
  const startIndex = (page - 1) * limit;
  const paginated = options.paginate ? messages.slice(startIndex, startIndex + limit) : messages;

  return {
    messages: paginated,
    pagination: {
      page, limit, totalCount, totalPages, hasMore: page < totalPages
    }
  };
};

async function fetchContacts(currentUserId, { search = '', page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  const friendRecords = await Friend.findAll({
    attributes: [
      [sequelize.literal(`CASE WHEN user_id = ${currentUserId} THEN friend_id ELSE user_id END`), 'friend_id']
    ],
    where: { status: 'accepted', [Op.or]: [{ user_id: currentUserId }, { friend_id: currentUserId }] },
    raw: true
  });

  const friendIds = [...new Set(friendRecords.map(f => f.friend_id))];
  if (!friendIds.length) return { contacts: [], pagination: { page, limit, totalCount: 0, totalPages: 0, hasMore: false } };

  const whereClause = { id: { [Op.in]: friendIds } };
  if (search) {
    whereClause[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
    ];

    const hidePhoneUsers = await UserSetting.findAll({
      where: { user_id: { [Op.in]: friendIds } },
      attributes: ['user_id', 'hide_phone'],
      raw: true
    });
  
    const hidePhoneMap = new Map(hidePhoneUsers.map(u => [u.user_id, u.hide_phone]));
    const visiblePhoneUserIds = Array.from(hidePhoneMap.entries()).filter(([id, hide]) => hide === false).map(([id]) => id);
  
    if (visiblePhoneUserIds.length > 0) {
      whereClause[Op.or].push({
        [Op.and]: [
          { id: { [Op.in]: visiblePhoneUserIds } },
          { phone: { [Op.like]: `%${search}%` } }
        ]
      });
    }
  }

  const totalCount = await User.count({ where: whereClause });

  const contacts = await User.findAll({
    where: whereClause,
    attributes: ['id', 'name', 'phone', 'avatar', 'email'],
    include: [{ model: UserSetting, as: 'setting', attributes: ['profile_pic'] }],
    order: [['name', 'ASC']],
    offset,
    limit
  });
  
  const relations = await getUserRelations(currentUserId);

  const contactChats = await Promise.all(
    contacts.map(async c => {
      const conv = { type: 'direct', id: c.id };
      const chat = await resolveChatObject(conv, currentUserId, relations);
      
      return chat;
    })
  );

  return {
    contacts: contactChats,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      hasMore: page < Math.ceil(totalCount / limit)
    }
  };
};

function initials(name) {
  return name.split(' ').map(n => n[0]).join('').toLowerCase();
};

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}-${month}-${year}`
};

function formatTime(date) {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;

  return `${hours}:${minutes} ${ampm}`;
};

function formatDateForFilename(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}${month}${day}_${hours}${minutes}`;
};

function chatHeader(title) {
  let text = `================= Chat Export =================\n`;
  text += `${title}\n`;
  text += `Exported on: ${formatDate(new Date())}\n`;
  text += `================================================\n\n`;
  return text;
};

module.exports = {
  formatLastMessage,
  fetchBlockedUsers,
  fetchFavoriteData,
  fetchFriendSuggestions,
  fetchArchiveChats,
  fetchRecentChat,
  fetchContacts,
  formatDate,
  formatTime,
  initials,
  chatHeader,
  formatDateForFilename
};