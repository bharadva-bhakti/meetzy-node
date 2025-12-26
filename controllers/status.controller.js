const { User, Status, Message, MessageStatus, StatusView, Friend, Block, MutedStatus, UserSetting, Setting, Group, sequelize } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const { getEffectiveLimits } = require('../utils/userLimits');

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 },
  ];
  for (const i of intervals) {
    const count = Math.floor(seconds / i.seconds);
    if (count >= 1) return `${count} ${i.label}${count > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

exports.getStatusFeed = async (req, res) => {
  const user_id = req.user.id;
  const now = new Date();

  try {
    const friends = await Friend.findAll({
      where: {
        [Op.or]: [
          { user_id, status: 'accepted' },
          { friend_id: user_id, status: 'accepted' },
        ],
      },
      attributes: ['user_id', 'friend_id'],
    });

    const friendIds = friends.map((f) => (f.user_id === user_id ? f.friend_id : f.user_id));

    const blocks = await Block.findAll({
      where: { [Op.or]: [{ blocker_id: user_id }, { blocked_id: user_id }] },
      attributes: ['blocker_id', 'blocked_id'],
    });
    const blockedIds = blocks.map((b) => (b.blocker_id === user_id ? b.blocked_id : b.blocker_id));

    const visibleFriendIds = friendIds.filter((id) => !blockedIds.includes(id));

    const settings = await UserSetting.findAll({
      where: {
        user_id: { [Op.in]: [user_id, ...visibleFriendIds] },
      },
      attributes: ['user_id', 'status_privacy', 'shared_with'],
    });

    const systemSettings = await Setting.findOne({ attributes: ['app_name'], raw: true });

    const privacyMap = {};
    for (const s of settings) {
      let shared = s.shared_with;

      if (typeof shared === 'string') {
        try {
          shared = JSON.parse(shared);
        } catch (e) {
          shared = [];
        }
      }
      if (!Array.isArray(shared)) shared = [];

      privacyMap[s.user_id] = {
        status_privacy: s.status_privacy,
        shared_with: shared,
      };
    }

    const mutedUsers = await MutedStatus.findAll({
      where: { user_id },
      attributes: ['target_id'],
    });
    const mutedIds = mutedUsers.map((m) => m.target_id);

    const statuses = await Status.findAll({
      where: {
        expires_at: { [Op.gt]: now },
      },
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'avatar'] },
        {
          model: StatusView,
          as: 'views',
          include: [{ model: User, as: 'viewer', attributes: ['id', 'name', 'avatar'] }],
        },
      ],
      order: [['created_at', 'ASC']],
    });

    const feed = {};
    for (const status of statuses) {
      const ownerId = status.user.id;
      const isSponsored = Boolean(status.sponsored);

      if (!isSponsored) {
        if (blockedIds.includes(ownerId)) continue;

        const { status_privacy, shared_with } = privacyMap[ownerId] || {
          status_privacy: 'my_contacts',
          shared_with: [],
        };

        if (ownerId !== user_id) {
          if (status_privacy === 'my_contacts' && !friendIds.includes(ownerId)) continue;
          if (status_privacy === 'only_share_with' && !shared_with.includes(user_id)) continue;
        }
      }

      if (mutedIds.includes(ownerId)) continue;

      if (!feed[ownerId]) {
        feed[ownerId] = {
          user: {
            id: status.user.id,
            name: isSponsored ? systemSettings.app_name : status.user.name,
            avatar: status.user.avatar
          },
          statuses: [],
          is_sponsored: isSponsored,
          isMutedStatus: mutedIds.includes(ownerId),
        };
      }

      const views = status.views.map((v) => ({
        id: v.viewer.id,
        name: v.viewer.name,
        avatar: v.viewer.avatar,
        viewed_at: v.viewer_at,
        viewed_ago: timeAgo(v.viewer_at),
      }));

      feed[ownerId].statuses.push({
        id: status.id,
        type: status.type,
        file_url: status.file_url,
        caption: status.caption,
        sponsored: isSponsored,
        created_at: status.created_at,
        expires_at: status.expires_at,
        view_count: status.views?.length || 0,
        views,
      });
    }

    const sortedFeed = Object.values(feed).sort((a, b) => {
      if (a.is_sponsored !== b.is_sponsored) return b.is_sponsored - a.is_sponsored;

      if (a.user.id === user_id) return -1;
      if (b.user.id === user_id) return 1;

      const lastA = a.statuses[a.statuses.length - 1]?.created_at;
      const lastB = b.statuses[b.statuses.length - 1]?.created_at;

      if (lastA && lastB) return new Date(lastB) - new Date(lastA);
      if (lastA) return -1;
      if (lastB) return 1;
      return 0;
    });

    return res.status(200).json({ message: 'Status fetch successfully.', data: sortedFeed });
  } catch (error) {
    console.error('Error in getStatusFeed:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getMutedStatuses = async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, search = '' } = req.query;
  const offset = (page - 1) * limit;

  try {
    const whereUser = {};
    if (search.trim()) {
      whereUser.name = { [Op.like]: `%${search.trim()}%` };
    }

    const { rows: mutes, count: totalCount } = await MutedStatus.findAndCountAll({
      where: { user_id: userId },
      include: [{ model: User, as: 'mutedUser', attributes: ['id', 'name', 'avatar'], where: whereUser }],
      order: [['created_at', 'DESC']],
      limit: Number(limit),
      offset: Number(offset),
    });

    const now = new Date();

    const mutedStatuses = (
      await Promise.all(
        mutes.filter((m) => m.mutedUser).map(async (mute) => {
          const statuses = await Status.findAll({
            where: {
              user_id: mute.target_id,
              expires_at: { [Op.gt]: now },
            },
            order: [['created_at', 'ASC']],
            attributes: ['id', 'file_url', 'type', 'caption', 'created_at', 'expires_at'],
          });

          if (!statuses.length) return null;

          return {
            muted_user: {
              id: mute.mutedUser.id,
              name: mute.mutedUser.name,
              avatar: mute.mutedUser.avatar,
            },
            muted_at: mute.created_at,
            statuses: statuses.map((s) => ({
              id: s.id,
              type: s.type,
              file_url: s.file_url,
              caption: s.caption,
              created_at: s.created_at,
              expires_at: s.expires_at,
            })),
          };
        })
      )
    ).filter(Boolean);

    return res.status(200).json({
      message: 'Muted status fetched successfully.',
      data: mutedStatuses,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page < Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching muted statuses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getSponsoredStatuses = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const search = req.query.search || '';
    const sortField = req.query.sort_by || 'created_at';
    const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const allowedSortFields = ['id', 'caption', 'sponsored', 'created_at', 'updated_at', 'expires_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const whereClause = {
      user_id: req.user.id,
      sponsored: true
    };

    if (search) {
      whereClause[Op.or] = [
        { caption: { [Op.like]: `%${search}%` } },
        { '$user.name$': { [Op.like]: `%${search}%` } },
        { '$user.email$': { [Op.like]: `%${search}%` } }
      ];
    }

    const total = await Status.count({
      where: whereClause,
      include: [{ model: User, as: 'user', attributes: [] }],
    });

    const statuses = await Status.findAll({
      where: whereClause,
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar'] }],
      order: [[safeSortField, sortOrder]],
      limit,
      offset,
    });

    const now = new Date();

    const formattedStatuses = statuses.map(status => {
      const expiresAt = status.expires_at;
      const isExpired = expiresAt ? new Date(expiresAt) < now : false;

      return {
        ...status.toJSON(),
        isExpired
      };
    });

    return res.status(200).json({
      message: 'Sponsored statuses fetched successfully.',
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      statuses: formattedStatuses,
    });
  } catch (error) {
    console.error('Error fetching sponsored statuses:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createStatus = async (req, res) => {
  const user_id = req.user.id;

  try {
    const { type, caption, isSponsored } = req.body;
    const allowedTypes = ['text', 'image', 'video'];

    const setting = await Setting.findOne({ attributes: ['status_expiry_time', 'status_limit'], raw: true });
    const hour = setting.status_expiry_time ? Number(setting.status_expiry_time) : 24;
    const expires_at = new Date(Date.now() + hour * 60 * 60 * 1000);

    const user = await User.findByPk(user_id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (Boolean(isSponsored) && user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can upload sponsored status.' });
    }

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ message: 'Status type must be image, video or text.' });
    }

    let content_url = null;
    if (['image', 'video'].includes(type)) {
      if (!req.file) {
        return res.status(400).json({ message: 'File required for image and video status type.' });
      }
      content_url = req.file.path;
    }

    const limits = await getEffectiveLimits(user_id, user.role);
    if (user.role === 'user') {
      const statusCount = await Status.count({
        where: {
          user_id,
          created_at: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });

      if (statusCount >= limits.status_limit_per_day) {
        return res.status(429).json({ message: `You can only upload ${limits.status_limit_per_day} statuses per day.` });
      }
    }

    const status = await Status.create({
      user_id,
      type,
      file_url: content_url,
      caption,
      sponsored: Boolean(isSponsored) || false,
      expires_at,
    });

    const statusData = {
      status: {
        id: status.id,
        user_id: status.user_id,
        type: status.type,
        file_url: status.file_url,
        caption: status.caption,
        is_sponsored: status.sponsored,
        created_at: status.created_at,
        expires_at: status.expires_at,
        view_count: 0,
        views: [],
      },
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
      },
    };

    const io = req.app.get('io');

    if (Boolean(isSponsored)) {
      const allUsers = await User.findAll({ attributes: ['id'] });
      allUsers.forEach((user) => {
        io.to(`user_${user.id}`).emit('status-uploaded', statusData);
      });
    } else {
      const friends = await Friend.findAll({
        where: {
          [Op.or]: [
            { user_id, status: 'accepted' },
            { friend_id: user_id, status: 'accepted' },
          ],
        },
        attributes: ['user_id', 'friend_id'],
      });

      const friendIds = friends.map((f) => (f.user_id === user_id ? f.friend_id : f.user_id));

      const blocks = await Block.findAll({
        where: { [Op.or]: [{ blocker_id: user_id }, { blocked_id: user_id }] },
        attributes: ['blocker_id', 'blocked_id'],
      });
      const blockedIds = blocks.map((b) => (b.blocker_id === user_id ? b.blocked_id : b.blocker_id));
      const visibleFriendIds = friendIds.filter((id) => !blockedIds.includes(id));

      const settings = await UserSetting.findOne({
        where: { user_id },
        attributes: ['status_privacy', 'shared_with'],
      });

      let notifyUserIds = [];

      if (!settings || settings.status_privacy === 'my_contacts') {
        notifyUserIds = visibleFriendIds;
      } else if (settings.status_privacy === 'only_share_with') {
        let sharedWith = settings.shared_with;
        if (typeof sharedWith === 'string') {
          try {
            sharedWith = JSON.parse(sharedWith);
          } catch (e) {
            sharedWith = [];
          }
        }
        notifyUserIds = Array.isArray(sharedWith) ? sharedWith.filter((id) => visibleFriendIds.includes(id)) : [];
      }

      io.to(`user_${user_id}`).emit('status-uploaded', statusData);

      notifyUserIds.forEach((friendId) => {
        io.to(`user_${friendId}`).emit('status-uploaded', statusData);
      });
    }

    return res.status(201).json({ message: 'Status uploaded successfully.', status: statusData });
  } catch (error) {
    console.error('Error in createStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.viewStatus = async (req, res) => {
  const viewer_id = req.user.id;
  const { status_id } = req.body;

  try {
    const status = await Status.findOne({
      where: { id: status_id, expires_at: { [Op.gt]: new Date() } },
      attributes: ['id', 'user_id'],
      include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    });

    if (!status) return res.status(404).json({ message: 'Status not found or expired.' });

    if (status.user_id === viewer_id) {
      return res.status(200).json({ message: 'It is your own status' });
    }

    const existingView = await StatusView.findOne({
      where: { status_id, viewer_id },
    });

    if (existingView) {
      return res.status(200).json({
        message: 'Status already viewed.',
        viewed_at: existingView.viewer_at,
      });
    }

    const statusView = await StatusView.create({
      status_id,
      viewer_id,
      viewer_at: new Date(),
    });

    const io = req.app.get('io');
    const ownerRoom = `user_${status.user_id}`;
    io.to(ownerRoom).emit('status-viewed', {
      status_id,
      viewer_id,
      viewer_name: req.user.name,
      viewed_at: statusView.viewer_at,
      view_count: await StatusView.count({ where: { status_id } }),
    });

    return res.status(201).json({
      message: 'Status viewed successfully.',
      data: statusView,
    });
  } catch (error) {
    console.error('Error in viewStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteStatus = async (req, res) => {
  const user_id = req.user.id;
  const { status_ids } = req.body;

  try {
    if (!status_ids || !Array.isArray(status_ids) || status_ids.length === 0) {
      return res.status(400).json({ message: 'Status IDs array is required' });
    }

    const statuses = await Status.findAll({ where: { id: status_ids, user_id } });
    if (statuses.length === 0) {
      return res.status(404).json({
        message: 'Status not found. or You are not authorized to delete it.',
      });
    }

    const deletedStatusIds = [];

    for (let status of statuses) {
      if (status.file_url) {
        const filePath = path.join(__dirname, '../', status.file_url);
        fs.unlink(filePath, (err) => {
          if (err && err.code !== 'ENOENT') console.error('Error deleting file', err);
        });
      }

      await status.destroy();
      deletedStatusIds.push(status.id);
    }

    const friends = await Friend.findAll({
      where: {
        [Op.or]: [
          { user_id, status: 'accepted' },
          { friend_id: user_id, status: 'accepted' },
        ],
      },
      attributes: ['user_id', 'friend_id'],
    });

    const friendIds = friends.map((f) => (f.user_id === user_id ? f.friend_id : f.user_id));

    const blocks = await Block.findAll({
      where: { [Op.or]: [{ blocker_id: user_id }, { blocked_id: user_id }] },
      attributes: ['blocker_id', 'blocked_id'],
    });

    const blockedIds = blocks.map((b) => (b.blocker_id === user_id ? b.blocked_id : b.blocker_id));
    const visibleFriendIds = friendIds.filter((id) => !blockedIds.includes(id));

    const io = req.app.get('io');

    deletedStatusIds.forEach(async (status_id) => {
      const isSponsored = Boolean(statuses.find((s) => s.id === status_id).sponsored);

      if (isSponsored) {
        const allUsers = await User.findAll({ attributes: ['id'] });
        allUsers.forEach((u) => {
          io.to(`user_${u.id}`).emit('status-deleted', { status_id, user_id, sponsored: isSponsored });
        });
      } else {
        visibleFriendIds.forEach((friend) => {
          io.to(`user_${friend}`).emit('status-deleted', {
            status_id: status_id,
            user_id: user_id,
            sponsored: isSponsored,
          });
        });
        io.to(user_id).emit('status-deleted', {
          status_id: status_id,
          user_id: user_id,
          sponsored: isSponsored,
        });
      }
    });

    return res.status(200).json({ message: `${deletedStatusIds.length} status(s) deleted successfully.` });
  } catch (error) {
    console.error('Error in deleteStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.toggleMuteStatus = async (req, res) => {
  const user_id = req.user.id;
  const { target_id } = req.body;

  try {
    if (!target_id) {
      return res.status(400).json({ message: 'target_id is required.' });
    }

    if (user_id === target_id) {
      return res.status(400).json({ message: 'You cannot mute your own status.' });
    }

    const existing = await MutedStatus.findOne({ where: { user_id, target_id } });

    if (existing) {
      await existing.destroy();
      return res.status(200).json({ message: 'User unmuted successfully', muted: false, target_id });
    }

    await MutedStatus.create({ user_id, target_id });
    return res.status(200).json({ message: 'User muted successfully', muted: true, target_id });
  } catch (error) {
    console.error('Error in toggleMuteStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.replyToStatus = async (req,res) => {
  const sender_id = req.user.id;
  const { status_id, message } = req.body;

  try {
    if (!status_id || !message || !message.trim()) {
      return res.status(400).json({ message: 'Status ID and message are required.' });
    }

    const status = await Status.findOne({
      where: { id: status_id, expires_at: { [Op.gt]: new Date() }},
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }]
    });

    if (!status) {
      return res.status(404).json({ message: 'Status not found or expired.' });
    }

    const receiver_id = status.user_id;

    if (sender_id === receiver_id) {
      return res.status(400).json({ message: 'You cannot reply to your own status.' });
    }

    const blockExists = await Block.findOne({
      where: {
        [Op.or]: [
          { blocker_id: sender_id, blocked_id: receiver_id },
          { blocker_id: receiver_id, blocked_id: sender_id }
        ]
      }
    });
    if (blockExists) {
      return res.status(403).json({ message: 'You cannot reply to this status.' });
    }

    if (!status.sponsored) {
      const friendship = await Friend.findOne({
        where: {
          [Op.or]: [
            { user_id: sender_id, friend_id: receiver_id, status: 'accepted' },
            { user_id: receiver_id, friend_id: sender_id, status: 'accepted' }
          ]
        }
      });

      if (!friendship) {
        return res.status(403).json({ message: 'You can only reply to statuses from your contacts.' });
      }
    }

    if(status.sponsored){
      return res.status(403).json({ message: 'You can not reply to sponsored status.'});
    }

    const statusReplyMessage = await Message.create({
      sender_id,
      recipient_id: receiver_id,
      content: message.trim(),
      message_type: 'text',
      metadata: {
        is_status_reply: true,
        status_id: status.id,
        status_type: status.type,
        status_file_url: status.file_url,
        status_caption: status.caption,
        status_created_at: status.created_at,
        status_owner_id: status.user_id,
        status_owner_name: status.user.name
      }
    });

    await MessageStatus.create({ message_id: statusReplyMessage.id, user_id: receiver_id, status: 'sent'});

    const fullMessage = await Message.findByPk(statusReplyMessage.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'avatar']},
        { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar']},
        { model: Group, as: 'group', attributes: ['id', 'name', 'avatar']},
      ]
    });  

    const io = req.app.get('io');
    // Emit to both sender and receiver for real-time updates
    io.to(`user_${sender_id}`).emit('receive-message', fullMessage);
    io.to(`user_${receiver_id}`).emit('receive-message', fullMessage);

    return res.status(201).json({ message: 'Reply sent successfully.', fullMessage:fullMessage });

  } catch (error) {
    console.error('Error in replyToStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getStatusReplyConversations = async (req, res) => {
  const user_id = req.user.id;

  try {
    const replyMessages = await Message.findAll({
      where: {
        recipient_id: user_id,
        message_type: 'text',
        [Op.and]: [{ 'metadata.is_status_reply': true }]
      },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
        { model: MessageStatus, as: 'statuses', where: { user_id: user_id }}
      ],
      order: [['created_at', 'DESC']]
    });

    const conversationsMap = {};

    for (const msg of replyMessages) {
      const senderId = msg.sender_id;

      if (!conversationsMap[senderId]) {
        conversationsMap[senderId] = {
          user: {
            id: msg.sender.id,
            name: msg.sender.name,
            avatar: msg.sender.avatar
          },
          last_reply: msg.content,
          last_reply_time: msg.created_at,
          unread_count: 0,
          total_replies: 0
        };
      }

      conversationsMap[senderId].total_replies++;

      const messageStatus = msg.statuses.find(s => s.user_id === user_id);
      if (messageStatus && ['sent', 'delivered'].includes(messageStatus.status)) {
        conversationsMap[senderId].unread_count++;
      }
    }

    const conversations = Object.values(conversationsMap).sort((a, b) => 
      new Date(b.last_reply_time) - new Date(a.last_reply_time)
    );

    return res.status(200).json({
      message: 'Status reply conversations fetched successfully.',
      data: conversations
    });
  } catch (error) {
    console.error('Error in getStatusReplyConversations:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};