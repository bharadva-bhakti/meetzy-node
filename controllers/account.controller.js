const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { db } = require('../models');
const User = db.User;
const UserSetting = db.UserSetting;
const Message = db.Message;
const MessageAction = db.MessageAction;
const ChatClear = db.ChatClear;
const GroupMember = db.GroupMember;
const Group = db.Group;
const Status = db.Status;
const mongoose = require('mongoose');

exports.getUserDetails = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(400).json({ message: 'Unauthorized access' });

    const user = await User.findById(userId)
      .select('id name bio avatar email role country country_code phone status is_verified');

    if (!user) return res.status(404).json({ message: 'User Not Found' });

    return res.status(200).json({ user });
  } catch (err) {
    console.error('Error getUserDetails:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getUserProfile = async (req, res) => {
  const currentUserId = req.user?._id;
  const userId = req.params.id;

  try {
    const user = await User.findById(userId)
      .select('id name bio avatar phone email country_code is_verified');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const userSetting = await UserSetting.findOne({ user_id: userId })
      .select('display_bio profile_pic last_seen hide_phone');

    const bio = userSetting?.display_bio ? user.bio : null;
    const avatar = userSetting?.profile_pic !== false ? user.avatar : null;

    const clearEntry = await ChatClear.findOne({
      user_id: currentUserId, recipient_id: userId,
    });

    const buildMatch = (extra = {}) => {
      const match = {
        $or: [
          { sender_id: currentUserId, recipient_id: userId },
          { sender_id: userId, recipient_id: currentUserId },
        ],
        ...extra,
      };
      if (clearEntry) match.created_at = { $gt: clearEntry.cleared_at };
      return match;
    };

    const [currentUserMemberships, targetUserMemberships] = await Promise.all([
      GroupMember.find({ user_id: currentUserId }).select('group_id'),
      GroupMember.find({ user_id: userId }).select('group_id'),
    ]);

    const currentGroupIds = currentUserMemberships.map(m => m.group_id.toString());
    const targetGroupIds = targetUserMemberships.map(m => m.group_id.toString());
    const commonGroupIds = currentGroupIds.filter(id => targetGroupIds.includes(id));

    let commonGroups = [];
    if (commonGroupIds.length > 0) {
      commonGroups = await Group.aggregate([
        { $match: { _id: { $in: commonGroupIds.map(id => new mongoose.Types.ObjectId(id)) } } },
        { $lookup: { from: 'group_members', localField: '_id', foreignField: 'group_id', as: 'memberships',}},
        { $lookup: { from: 'users', localField: 'memberships.user_id', foreignField: '_id', as: 'memberUsers'}},
        {
          $addFields: {
            memberships: {
              $map: {
                input: '$memberships',
                as: 'member',
                in: {
                  role: '$$member.role',
                  user: {
                    $arrayElemAt: [{ $filter: { input: '$memberUsers', as: 'u', cond: { $eq: ['$$u._id', '$$member.user_id'] }}},0],
                  },
                },
              },
            },
          },
        },
        {
          $project: {
            id: '$_id',
            _id: 0,
            name: 1,
            description: 1,
            avatar: 1,
            created_at: 1,
            memberships: { role: 1, user: { id: 1, name: 1, avatar: 1}},
          },
        },
      ]);
    }

    const sharedDocuments = await Message.find(buildMatch({ message_type: 'file' }))
      .select('id content file_url file_type created_at metadata').sort({ created_at: -1 });

    const sharedLinks = await Message.find(buildMatch({ message_type: 'link' }))
      .select('id content created_at metadata sender_id').populate('sender_id', 'id name avatar').sort({ created_at: -1 });

    const sharedImages = await Message.find(buildMatch({ message_type: 'image' }))
      .select('id file_url created_at metadata').sort({ created_at: -1 });

    const announcementsMatch = {sender_id: userId,recipient_id: null,group_id: null,message_type: 'announcement'};

    if (clearEntry) announcementsMatch.created_at = { $gt: clearEntry.cleared_at };

    const announcements = await Message.find(announcementsMatch)
      .select('id content file_url file_type created_at metadata').sort({ created_at: -1 });

    const announcementImages = announcements
      .filter(m => m.file_type?.startsWith('image/'))
      .map(m => ({
        id: m.id,
        url: m.file_url,
        date: m.created_at,
        title: m.metadata?.title || null,
        announcement_type: m.metadata?.announcement_type || null,
      }));

    const starredActions = await MessageAction.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(currentUserId), action_type: 'star', }, },
      {
        $lookup: {
          from: 'messages',
          let: { messageId: '$message_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$messageId'] } } },
            {
              $match: {
                $or: [
                  {
                    $and: [
                      {
                        $or: [
                          { sender_id: new mongoose.Types.ObjectId(currentUserId), recipient_id: new mongoose.Types.ObjectId(userId) },
                          { sender_id: new mongoose.Types.ObjectId(userId), recipient_id: new mongoose.Types.ObjectId(currentUserId) },
                        ],
                      },
                      clearEntry
                        ? { created_at: { $gt: clearEntry.cleared_at } }
                        : { $expr: { $cond: [false, false, true] } },
                    ],
                  },
                  {
                    sender_id: new mongoose.Types.ObjectId(userId),
                    recipient_id: null,
                    group_id: null,
                    message_type: 'announcement',
                    ...(clearEntry && { created_at: { $gt: clearEntry.cleared_at } }),
                  },
                ],
              },
            },
            {
              $lookup: {
                from: 'users',
                localField: 'sender_id',
                foreignField: '_id',
                as: 'sender',
                pipeline: [{ $project: { id: '$_id', _id: 0, name: 1, avatar: 1 } }],
              },
            },
            { $unwind: { path: '$sender', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                id: '$_id',
                _id: 0,
                content: 1,
                file_url: 1,
                file_type: 1,
                message_type: 1,
                created_at: 1,
                metadata: 1,
                sender_id: 1,
                recipient_id: 1,
                group_id: 1,
                sender: 1,
              },
            },
          ],
          as: 'message',
        },
      },
      { $unwind: { path: '$message', preserveNullAndEmptyArrays: true } },
      { $match: { message: { $ne: null } } },
      { $sort: { created_at: -1 } },
      { $limit: 10 },
      { $project: { message: 1, }, },
    ]);

    const starredMessages = starredActions.map(item => {
      const msg = item.message;
      return {
        id: msg.id,
        content: msg.content,
        date: msg.created_at,
        sender: {
          id: msg.sender.id,
          name: msg.sender.name,
          avatar: msg.sender.avatar, 
        },
      };
    });

    const senderIds = [
      ...starredMessages.map(m => m.sender.id),
      ...sharedLinks.map(m => m.sender_id?._id?.toString()),
      ...commonGroups.flatMap(g => g.memberships.filter(m => m.user?._id).map(m => m.user._id.toString())),
    ].filter(Boolean);

    const uniqueSenderIds = [...new Set(senderIds)];

    const senderSettings = uniqueSenderIds.length > 0
      ? await UserSetting.find({ user_id: { $in: uniqueSenderIds.map(id => new mongoose.Types.ObjectId(id)) } })
          .select('user_id profile_pic')
      : [];

    const senderSettingsMap = new Map(
      senderSettings.map(s => [s.user_id.toString(), s.profile_pic])
    );

    starredMessages.forEach(msg => {
      const hideAvatar = senderSettingsMap.get(msg.sender.id.toString()) === false;
      if (hideAvatar) msg.sender.avatar = null;
    });

    sharedLinks.forEach(msg => {
      const hideAvatar = senderSettingsMap.get(msg.sender_id._id.toString()) === false;
      if (hideAvatar) msg.sender_id.avatar = null;
    });

    commonGroups.forEach(group => {
      group.memberships.forEach(membership => {
        if (membership.user?._id) {
          const hideAvatar = senderSettingsMap.get(membership.user._id.toString()) === false;
          if (hideAvatar) membership.user.avatar = null;
        }
      });
    });

    const userWithoutSensitive = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      country_code: user.country_code,
      is_verified: user.is_verified,
    };

    return res.status(200).json({
      ...userWithoutSensitive,
      bio,
      avatar,
      userSetting: userSetting ? {
        last_seen: userSetting.last_seen,
        profile_pic: userSetting.profile_pic,
        display_bio: userSetting.display_bio,
        hide_phone: userSetting.hide_phone,
      } : null,
      shared_documents: sharedDocuments.map(doc => ({
        id: doc.id,
        name: doc.metadata?.original_filename || 'Document',
        url: doc.file_url,
        type: doc.file_type,
        size: doc.metadata?.fileSize || null,
        date: doc.created_at,
      })),
      shared_images: announcementImages.length > 0
        ? announcementImages
        : sharedImages.map(img => ({
            id: img.id,
            url: img.file_url,
            date: img.created_at,
          })),
      shared_links: sharedLinks.map(msg => ({
        id: msg.id,
        content: msg.content,
        date: msg.created_at,
        sender: {
          id: msg.sender_id.id,
          name: msg.sender_id.name,
          avatar: msg.sender_id.avatar,
        },
      })),
      common_groups: commonGroups.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        avatar: g.avatar,
        created_at: g.created_at,
        member_count: g.memberships.length,
        members: g.memberships
          .filter(m => m.user).map(m => ({ id: m.user.id, name: m.user.name, avatar: m.user.avatar })),
      })),
      starred_messages: starredMessages,
    });
  } catch (error) {
    console.error('Error getUserProfile:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { name, bio, phone, country, country_code, remove_avatar } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User Not Found' });

    const deleteOldAvatar = () => {
      if (!user.avatar) return;
      const oldAvatarPath = path.join(process.cwd(), user.avatar);
      if (fs.existsSync(oldAvatarPath)) {
        try {
          fs.unlinkSync(oldAvatarPath);
        } catch (error) {
          console.error('Error deleting old avatar', error);
        }
      }
    };

    let avatar = user.avatar;
    if (remove_avatar === 'true') {
      deleteOldAvatar();
      avatar = null;
    } else if (req.file) {
      deleteOldAvatar();
      avatar = req.file.path;
    }

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          name: name || user.name,
          bio: bio || user.bio,
          avatar,
          phone: phone || user.phone,
          country: country || user.country,
          country_code: country_code || user.country_code,
        },
      }
    );

    const updatedUser = await User.findById(userId).select('id name bio avatar email country country_code phone');

    return res.status(201).json({
      message: 'Profile updated successfully',
      user: updatedUser,
    });
  } catch (err) {
    console.error('Error updateProfile:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { old_password, password } = req.body;

    if (!old_password || !password) {
      return res.status(400).json({ message: 'Old password and New password are required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isPasswordValid = await bcrypt.compare(old_password, user.password);
    if (!isPasswordValid) return res.status(400).json({ message: 'Invalid Old Password' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await User.updateOne({ _id: userId }, { password: hashedPassword });

    const io = req.app.get('io');
    io.to(`user_${userId}`).emit('password-updated', { token: req.headers.authorization });

    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Error updatePassword:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteAccount = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.avatar) {
      const filePath = path.join(process.cwd(), user.avatar);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    const statuses = await Status.find({ user_id: userId });
    for (const st of statuses) {
      if (st.file_url) {
        const filePath = path.join(process.cwd(), st.file_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    const messages = await Message.find({ sender_id: userId });
    for (const msg of messages) {
      if (msg.file_url) {
        const filePath = path.join(process.cwd(), msg.file_url);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    await User.deleteOne({ _id: userId });

    return res.status(200).json({ message: 'Your account has been permanently deleted.' });
  } catch (error) {
    console.error('Error in deleteAccount:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};