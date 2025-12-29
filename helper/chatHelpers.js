const { db } = require('../models');
const mongoose = require('mongoose');
const User = db.User;
const UserSetting = db.UserSetting;
const Setting = db.Setting;
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
const ChatSetting = db.ChatSetting;
const MessageStatus = db.MessageStatus;
const Broadcast = db.Broadcast;
const UserDelete = db.UserDelete;
const MessageAction = db.MessageAction;

async function formatLastMessage(message, currentUserId = null) {
  if (!message) return 'No messages yet';

  const { content, message_type, metadata } = message;

  if (message_type === 'system' && metadata?.system_action) {
    if (metadata.system_action === 'member_left' && currentUserId && metadata.user_id?.toString() === currentUserId?.toString()) {
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
}

async function fetchBlockedUsers(userId, { page = 1, limit = 20, search = '' }) {
  const skip = (page - 1) * limit;

  const settings = await Setting.findOne().select('app_name');

  const match = { blocker_id: new mongoose.Types.ObjectId(userId) };

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'blocked_id',
        foreignField: '_id',
        as: 'blocked',
      },
    },
    { $unwind: { path: '$blocked', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'groups',
        localField: 'group_id',
        foreignField: '_id',
        as: 'blockedGroup',
      },
    },
    { $unwind: { path: '$blockedGroup', preserveNullAndEmptyArrays: true } },
    { $sort: { created_at: -1 } },
    { $skip: skip },
    { $limit: limit },
  ];

  const [blockedData, total] = await Promise.all([
    Block.aggregate(pipeline),
    Block.countDocuments(match),
  ]);

  const filtered = search
    ? blockedData.filter(b => {
        if (b.block_type === 'user') {
          const name = b.blocked?.name?.toLowerCase() || '';
          const email = b.blocked?.email?.toLowerCase() || '';
          return name.includes(search.toLowerCase()) || email.includes(search.toLowerCase());
        } else {
          const name = b.blockedGroup?.name?.toLowerCase() || '';
          return name.includes(search.toLowerCase());
        }
      })
    : blockedData;

  return {
    count: total,
    blocked: filtered.map(b => ({
      id: b._id,
      type: b.block_type,
      user: b.blocked ? {
        id: b.blocked._id,
        name: b.blocked.role !== 'user' ? settings.app_name : b.blocked.name,
        avatar: b.blocked.avatar,
        email: b.blocked.email,
        bio: b.blocked.bio || null,
      } : null,
      group: b.blockedGroup || null,
      created_at: b.created_at,
    })),
    hasMore: page * limit < total,
    totalPages: Math.ceil(total / limit),
  };
}

async function resolveChatObject(conv, currentUserId, relations) {
  const { pinnedSet,pinnedTimeMap, mutedMap, blockedUsers, blockedGroups, archivedSet, favoriteSet} = relations;

  let chat = await getLatestMessage( conv, currentUserId, pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, blockedGroups, archivedSet, favoriteSet);

  const systemSettings = await Setting.findOne().select('app_name');

  if (!chat) {
    let info;
    if (conv.type === 'direct' || conv.type === 'announcement') {
      info = await User.findById(conv.id).select('id name bio role email avatar phone is_verified');
    } else {
      info = await Group.findById(conv.id).select('id name avatar');
    }

    if (!info) return null;

    chat = {
      chat_type: conv.type === 'announcement' ? 'direct' : conv.type,
      chat_id: conv.id,
      name: info.role === 'super_admin' ? systemSettings.app_name : info.name,
      email: info.email || null,
      phone: info.phone || null,
      bio: info.bio || null,
      avatar: info.avatar || null,
      is_verified: info.is_verified || false,
      lastMessage: null,
      unreadCount: 0,
    };
  }

  const convKey = `${conv.type}:${conv.id}`;
  chat.isGroup = conv.type === 'group';
  chat.isBlocked = conv.type === 'direct' || conv.type === 'announcement'
    ? blockedUsers.has(conv.id.toString())
    : blockedGroups.has(conv.id.toString());
  chat.isFavorite = favoriteSet.has(convKey);
  chat.isMuted = mutedMap.has(convKey);
  chat.isPinned = pinnedSet.has(convKey);
  chat.pinned_at = pinnedTimeMap.get(convKey) || null;
  chat.isArchived = archivedSet.has(convKey);

  return chat;
}

async function fetchFavoriteData(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [totalCount, favorites] = await Promise.all([
    Favorite.countDocuments({ user_id: userId }),
    Favorite.find({ user_id: userId }).sort({ created_at: -1 }).skip(skip).limit(limit),
  ]);

  const relations = await getUserRelations(userId);

  const favoriteChats = await Promise.all(
    favorites.map(async (fav) => {
      const conv = {
        type: fav.target_type === 'user' ? 'direct' : fav.target_type,
        id: fav.target_id,
      };

      const chat = await resolveChatObject(conv, userId, relations);
      if (chat) chat.favorite_at = fav.created_at;

      return chat;
    })
  );

  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    validFavorites: favoriteChats.filter(Boolean),
    pagination: { page, limit, totalCount, totalPages, hasMore },
  };
}

async function fetchFriendSuggestions(userId, { search = '', page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;

  const friendships = await Friend.find({$or: [{ user_id: userId }, { friend_id: userId }],status: { $ne: 'rejected' },});

  const friendIds = new Set();
  friendships.forEach(f => {
    if (f.user_id.toString() === userId.toString()) friendIds.add(f.friend_id.toString());
    else friendIds.add(f.user_id.toString());
  });
  friendIds.add(userId.toString());

  const allUserSettings = await UserSetting.find({}).select('user_id hide_phone');
  const hidePhoneMap = new Map(allUserSettings.map(s => [s.user_id.toString(), s.hide_phone]));

  const query = {
    _id: { $nin: Array.from(friendIds).map(id => new mongoose.Types.ObjectId(id)) },
    role: 'user',
    status: 'active',
  };

  if (search) {
    const regex = { $regex: search, $options: 'i' };
    query.$or = [{ name: regex }, { email: regex }];

    const visiblePhoneUserIds = Array.from(hidePhoneMap.entries()).filter(([, hide]) => hide === false).map(([id]) => id);

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

  const suggestions = await User.find(query).select('id bio name avatar phone email').sort({ name: 1 }).skip(skip).limit(limit);

  const suggestionIds = suggestions.map(s => s.id);
  const userSettings = await UserSetting.find({ user_id: { $in: suggestionIds } }).select('user_id profile_pic hide_phone');

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
}

async function fetchArchiveChats({ userId, page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;

  const [totalCount, archives] = await Promise.all([
    Archive.countDocuments({ user_id: userId }),
    Archive.find({ user_id: userId }).sort({ created_at: -1 }).skip(skip).limit(limit),
  ]);

  const relations = await getUserRelations(userId);

  const archivedChats = await Promise.all(
    archives.map(async archive => {
      const conv = {
        type: archive.target_type === 'user' ? 'direct' : archive.target_type,
        id: archive.target_id,
      };

      const chat = await resolveChatObject(conv, userId, relations);
      if (chat) chat.archived_at = archive.created_at;
      return chat;
    })
  );

  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    archivedChats: archivedChats.filter(Boolean),
    pagination: { page, limit, totalCount, totalPages, hasMore },
  };
}

function isLockedChat(userSetting, chatType, chatId) {
  if (!userSetting?.chat_lock_enabled || !Array.isArray(userSetting.locked_chat_ids)) {
    return false;
  }

  return userSetting.locked_chat_ids.some(
    chat => chat.type === chatType && chat.id.toString() === chatId.toString()
  );
}

async function getUserRelations(userId) {
  const [ mutedChats, pinnedChats, hidden, blocked, archived, friends, favorites,] = await Promise.all([
    MutedChat.find({ user_id: userId }),
    PinnedConversation.find({ user_id: userId }),
    UserDelete.find({ user_id: userId, delete_type: 'hide_chat' }),
    Block.find({ $or: [{ blocker_id: userId }, { blocked_id: userId }],}),
    Archive.find({ user_id: userId }),
    Friend.find({ status: 'accepted', $or: [{ user_id: userId }, { friend_id: userId }],}),
    Favorite.find({ user_id: userId }),
  ]);

  const mutedMap = new Set(mutedChats.map(m => `${m.target_type}:${m.target_id}`));
  const hiddenSet = new Set(hidden.map(h => `${h.target_type}_${h.target_id}`));
  const archivedSet = new Set(archived.map(a => `${a.target_type}:${a.target_id}`));
  const friendIds = new Set(friends.map(f => (f.user_id.toString() === userId.toString() ? f.friend_id : f.user_id).toString()));
  const favoriteSet = new Set(favorites.map(f => `${f.target_type}:${f.target_id}`));

  const pinnedSet = new Set(pinnedChats.map(p => `${p.type}:${p.target_id}`));
  const pinnedTimeMap = new Map(
    pinnedChats.map(p => [`${p.type}:${p.target_id}`, new Date(p.pinned_at).getTime()])
  );

  const blockedUsers = new Set();
  const blockedGroups = new Set();

  blocked.forEach(b => {
    if (b.blocker_id.toString() === userId.toString()) {
      if (b.block_type === 'user') blockedUsers.add(b.blocked_id.toString());
      if (b.block_type === 'group' && b.group_id) blockedGroups.add(b.group_id.toString());
    }
  });

  return { hiddenSet, archivedSet, friendIds, blockedUsers, blockedGroups, pinnedSet, pinnedTimeMap, mutedMap, favoriteSet,};
}

async function getLatestMessage( conv, currentUserId, pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, blockedGroups, archivedSet, favoriteSet ) {
  const isDM = conv.type === 'direct';
  const isAnnouncement = conv.type === 'announcement';
  const isBroadcast = conv.type === 'broadcast';
  const isGroup = conv.type === 'group';

  const currentUserSetting = await UserSetting.findOne({ user_id: currentUserId })
    .select('chat_lock_enabled locked_chat_ids');

  let isLocked = isLockedChat(currentUserSetting, conv.type, conv.id);

  let chatSetting = null;
  if (!isAnnouncement) {
    chatSetting = await ChatSetting.findOne(
      isDM
        ? {
            $or: [
              { user_id: currentUserId, recipient_id: conv.id },
              { user_id: conv.id, recipient_id: currentUserId },
            ],
            group_id: null,
          }
        : { group_id: conv.id, recipient_id: null }
    );
  }

  let userSetting = null;
  if (isDM) {
    userSetting = await UserSetting.findOne({ user_id: conv.id })
      .select('last_seen profile_pic display_bio read_receipts typing_indicator hide_phone');
  }

  let messageMatch = {};

  if (isDM) {
    messageMatch = {
      group_id: null,
      $or: [
        { sender_id: currentUserId, recipient_id: conv.id },
        { sender_id: conv.id, recipient_id: currentUserId },
      ],
      message_type: { $ne: 'system' },
    };
  } else if (isAnnouncement) {
    messageMatch = {
      recipient_id: null,
      group_id: null,
      'metadata.sent_by_admin': '1',
    };
  } else if (isGroup) {
    messageMatch = { group_id: conv.id };
  } else if (isBroadcast) {
    messageMatch = {
      sender_id: currentUserId,
      'metadata.is_broadcast': true,
      'metadata.broadcast_id': conv.id,
    };
  }

  const clearEntry = !isAnnouncement
    ? await ChatClear.findOne(
        isDM
          ? { user_id: currentUserId, recipient_id: conv.id }
          : { user_id: currentUserId, group_id: conv.id }
      )
    : null;

  if (clearEntry) {
    messageMatch.created_at = { $gt: clearEntry.cleared_at };
  }

  // Handle group leave
  if (isGroup) {
    const member = await GroupMember.findOne({ group_id: conv.id, user_id: currentUserId });
    if (!member) {
      const leaveMessage = await Message.findOne({
        group_id: conv.id,
        message_type: 'system',
        'metadata.system_action': 'member_left',
        'metadata.user_id': currentUserId,
      })
        .sort({ created_at: -1 })
        ;

      if (leaveMessage) {
        messageMatch.created_at = { $lte: leaveMessage.created_at };
      } else {
        return null;
      }
    }
  }

  const deletedMessages = await MessageAction.find({
    user_id: currentUserId,
    action_type: 'delete',
    'details.type': 'me',
    'details.is_broadcast_view': false,
  }).select('message_id');

  const deletedIds = deletedMessages.map(d => d.message_id);
  if (deletedIds.length > 0) {
    messageMatch._id = { $nin: deletedIds };
  }

  const latest = await Message.findOne(messageMatch)
    .sort({ created_at: -1 })
    .populate('sender', 'id name avatar phone')
    .populate('recipient', 'id name avatar phone')
    .populate('group', 'id name avatar');

  let groupMentionMap = new Map();

  if (isGroup) {
    const groupMemberShip = await GroupMember.find({ user_id: currentUserId })
      .populate('group', 'id name avatar description created_by created_at');

    const groupIds = groupMemberShip.map(gm => gm.group_id);

    const groupMentions = await Promise.all(
      groupIds.map(async groupId => {
        const unreadCount = await Message.countDocuments({
          group_id: groupId,
          sender_id: { $ne: currentUserId },
          has_unread_mentions: true,
        }).hint({ group_id: 1, has_unread_mentions: 1 });

        const hasSeen = await MessageStatus.countDocuments({
          'message.group_id': groupId,
          user_id: currentUserId,
          status: 'seen',
        });

        return { groupId: groupId.toString(), hasUnreadMentions: unreadCount > hasSeen };
      })
    );

    groupMentions.forEach(({ groupId, hasUnreadMentions }) => {
      groupMentionMap.set(groupId, hasUnreadMentions);
    });
  }

  const systemSettings = await Setting.findOne().select('app_name');

  if (!latest && clearEntry && !isAnnouncement) {
    const info = isDM || isAnnouncement
      ? await User.findById(conv.id).select('id name email bio avatar phone is_verified')
      : await Group.findById(conv.id).select('id name avatar');

    return {
      chat_type: isAnnouncement ? 'direct' : conv.type,
      chat_id: conv.id,
      name: isAnnouncement ? systemSettings.app_name : info?.name,
      phone: info?.phone || null,
      email: info?.email || null,
      bio: info?.bio || null,
      avatar: info?.avatar || null,
      status: info?.status || null,
      is_verified: info?.is_verified || false,
      lastMessage: null,
      userSetting,
      unreadCount: 0,
      isMuted: mutedMap.has(`${conv.type}:${conv.id}`),
      isPinned: pinnedSet.has(`${conv.type}:${conv.id}`),
      isGroup: conv.type === 'group',
      isAnnouncement: conv.type === 'announcement',
      isBroadcast: false,
      isLocked,
      disappearing: {
        enabled: false,
        duration: null,
        expire_after_seconds: null,
      },
    };
  }

  if (!latest) return null;

  const deletedForEveryone = await MessageAction.findOne({
    message_id: latest._id,
    action_type: 'delete',
    'details.type': 'everyone',
  });

  if (deletedForEveryone) {
    latest.content = 'This message was deleted';
  } else if (latest.message_type === 'system') {
    let metadata = latest.metadata || {};
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        metadata = {};
      }
    }

    if (metadata.system_action) {
      if (metadata.system_action === 'member_left' && metadata.user_id?.toString() === currentUserId?.toString()) {
        latest.content = 'You left the group';
      } else if (metadata.system_action === 'group_created' && metadata.creator_user_id?.toString() === currentUserId?.toString()) {
        latest.content = 'You created this group.';
      } else {
        latest.content = latest.content || 'System message';
      }
    }
  }

  const unreadCount = !isAnnouncement
    ? await MessageStatus.countDocuments({
        user_id: currentUserId,
        status: { $ne: 'seen' },
        message_id: latest._id,
      })
    : 0;

  const avatar = isAnnouncement
    ? latest.sender?.avatar
    : (userSetting && userSetting.profile_pic === false ? null : latest.sender?.avatar || null);

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
    chat_type: isAnnouncement ? 'direct' : conv.type,
    chat_id: conv.id,
    name: isAnnouncement ? systemSettings.app_name : latest.sender?.name || latest.group?.name,
    email: latest.sender?.email || null,
    bio: latest.sender?.bio || null,
    phone: latest.sender?.phone || null,
    avatar,
    status: latest.sender?.status || null,
    is_verified: latest.sender?.is_verified || false,
    lastMessage: latest,
    userSetting,
    unreadCount,
    is_unread_mentions: groupMentionMap.get(conv.id?.toString()) || false,
    isArchived: archivedSet.has(`${conv.type}:${conv.id}`),
    isFavorite: favoriteSet.has(favoriteKey),
    isBlocked: false,
    isMuted: mutedMap.has(muteKey),
    isPinned: pinnedSet.has(`${conv.type}:${conv.id}`),
    pinned_at: pinnedTimeMap.get(`${conv.type}:${conv.id}`) || null,
    isGroup,
    isAnnouncement,
    isBroadcast,
    isLocked,
    disappearing,
  };

  result.isBlocked = (isDM || isAnnouncement)
    ? blockedUsers.has(conv.id.toString())
    : blockedGroups.has(conv.id.toString());

  if (result.isBlocked && !isDM) {
    result.unreadCount = 0;
  }

  return result;
}

async function fetchRecentChat(currentUserId, page = 1, limit = 20, options = {}) {
  const relations = await getUserRelations(currentUserId);
  const { hiddenSet, archivedSet, friendIds, blockedUsers, blockedGroups, pinnedSet, pinnedTimeMap, mutedMap, favoriteSet,} = relations;

  const directConvos = await Message.aggregate([
    {
      $match: {
        group_id: null,
        $or: [
          { sender_id: currentUserId, recipient_id: { $in: Array.from(friendIds) } },
          { recipient_id: currentUserId, sender_id: { $in: Array.from(friendIds) } },
        ],
      },
    },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ['$sender_id', currentUserId] },
            '$recipient_id',
            '$sender_id',
          ],
        },
        last_activity: { $max: '$created_at' },
      },
    },
    { $sort: { last_activity: -1 } },
  ]);

  const directList = directConvos.filter(dc => {
    const hiddenKey = `user_${dc._id}`;
    const archivedKey = `user:${dc._id}`;
    return !hiddenSet.has(hiddenKey) && !archivedSet.has(archivedKey);
  });

  // Groups
  const membershipGroupIds = await GroupMember.find({ user_id: currentUserId })
    .distinct('group_id')
    ;

  const groupMessageIds = await Message.distinct('group_id', { sender_id: currentUserId, group_id: { $ne: null } });
  const groupStatusIds = await MessageStatus.distinct('message.group_id', { user_id: currentUserId });

  const allGroupIds = [...new Set([...membershipGroupIds, ...groupMessageIds, ...groupStatusIds])];

  const groupExcludeIds = [
    ...Array.from(hiddenSet).filter(x => x.startsWith('group_')).map(x => x.replace('group_', '')),
    ...Array.from(archivedSet).filter(x => x.startsWith('group:')).map(x => x.replace('group:', '')),
  ];

  const groupIdsFiltered = allGroupIds.filter(id => !groupExcludeIds.includes(id.toString()));

  const groupConvos = groupIdsFiltered.length
    ? await Message.aggregate([
        { $match: { group_id: { $in: groupIdsFiltered } } },
        {
          $group: {
            _id: '$group_id',
            last_activity: { $max: '$created_at' },
          },
        },
        { $sort: { last_activity: -1 } },
      ])
    : [];

  // Broadcasts
  const userBroadcasts = await Broadcast.find({ creator_id: currentUserId });
  const broadcastIds = userBroadcasts.map(b => b._id);

  const broadcastConvos = broadcastIds.length
    ? await Message.aggregate([
        {
          $match: {
            sender_id: currentUserId,
            'metadata.system_action': 'broadcast_created',
            'metadata.broadcast_id': { $in: broadcastIds.map(id => id.toString()) },
          },
        },
        {
          $group: {
            _id: '$metadata.broadcast_id',
            last_activity: { $max: '$created_at' },
          },
        },
      ])
    : [];

  // Announcements
  const announcementData = await Message.aggregate([
    {
      $match: {
        recipient_id: null,
        group_id: null,
        'metadata.sent_by_admin': '1',
      },
    },
    {
      $group: {
        _id: '$sender_id',
        last_activity: { $max: '$created_at' },
        announcement_count: { $sum: 1 },
      },
    },
  ]);

  const allConvos = [
    ...directList.map(dc => ({ type: 'direct', id: dc._id })),
    ...groupConvos.map(gc => ({ type: 'group', id: gc._id })),
    ...broadcastConvos.map(bc => ({ type: 'broadcast', id: bc._id })),
  ];

  announcementData.forEach(row => {
    const hiddenKey = `user${row._id}`;
    if (!hiddenSet.has(hiddenKey)) {
      allConvos.push({
        type: 'announcement',
        id: row._id,
        last_activity: row.last_activity,
        announcement_count: row.announcement_count,
      });
    }
  });

  const messages = (
    await Promise.all(
      allConvos.map(conv =>
        getLatestMessage(conv, currentUserId, pinnedSet, pinnedTimeMap, mutedMap, blockedUsers, blockedGroups, archivedSet, favoriteSet)
      )
    )
  ).filter(Boolean);

  messages.sort((a, b) => {
    if (a.isPinned && b.isPinned) {
      return (b.pinned_at || 0) - (a.pinned_at || 0);
    }
    if (a.isPinned) return -1;
    if (b.isPinned) return 1;

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
      page,
      limit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

async function fetchContacts(currentUserId, { search = '', page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;

  const friends = await Friend.find({
    status: 'accepted',
    $or: [{ user_id: currentUserId }, { friend_id: currentUserId }],
  });

  const friendIds = friends.map(f =>
    f.user_id.toString() === currentUserId.toString() ? f.friend_id : f.user_id
  );

  if (friendIds.length === 0) {
    return {
      contacts: [],
      pagination: { page, limit, totalCount: 0, totalPages: 0, hasMore: false },
    };
  }

  let query = { _id: { $in: friendIds } };

  if (search) {
    const regex = { $regex: search, $options: 'i' };
    query.$or = [{ name: regex }, { email: regex }];

    const hidePhoneUsers = await UserSetting.find({ user_id: { $in: friendIds } })
      .select('user_id hide_phone');

    const hidePhoneMap = new Map(hidePhoneUsers.map(u => [u.user_id.toString(), u.hide_phone]));
    const visiblePhoneUserIds = Array.from(hidePhoneMap.entries())
      .filter(([, hide]) => hide === false)
      .map(([id]) => new mongoose.Types.ObjectId(id));

    if (visiblePhoneUserIds.length > 0) {
      query.$or.push({
        $and: [{ _id: { $in: visiblePhoneUserIds } }, { phone: regex }],
      });
    }
  }

  const totalCount = await User.countDocuments(query);

  const contacts = await User.find(query)
    .select('id name phone avatar email').populate('setting', 'profile_pic').sort({ name: 1 }).skip(skip).limit(limit);

  const relations = await getUserRelations(currentUserId);

  const contactChats = await Promise.all(
    contacts.map(async c => {
      const conv = { type: 'direct', id: c._id };
      return await resolveChatObject(conv, currentUserId, relations);
    })
  );

  const totalPages = Math.ceil(totalCount / limit);
  const hasMore = page < totalPages;

  return {
    contacts: contactChats,
    pagination: { page, limit, totalCount, totalPages, hasMore },
  };
}

function initials(name) {
  return name.split(' ').map(n => n[0]).join('').toLowerCase();
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatTime(date) {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

function formatDateForFilename(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}`;
}

function chatHeader(title) {
  let text = `================= Chat Export =================\n`;
  text += `${title}\n`;
  text += `Exported on: ${formatDate(new Date())}\n`;
  text += `================================================\n\n`;
  return text;
}

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
  formatDateForFilename,
};