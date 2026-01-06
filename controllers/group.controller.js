const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose')
const { db } = require('../models');
const Group = db.Group;
const GroupMember = db.GroupMember;
const User = db.User;
const GroupSetting = db.GroupSetting;
const Message = db.Message;
const Archive = db.Archive;
const Favorite = db.Favorite;
const Setting = db.Setting;
const { getEffectiveLimits } = require('../utils/userLimits');

const createSystemMessage = async (req, groupId, action, metadata = {}) => {
  try {
    let content = '';
    let systemMetadata = { system_action: action, ...metadata };

    const senderId = metadata.creator_user_id || metadata.updater_user_id || req.user._id;
    if (!senderId) {
      throw new Error('Sender ID is required to create a system message');
    }

    switch (action) {
      case 'group_created':
        const groupCreated = await Group.findById(groupId).populate('created_by', 'name');
        const creatorName = groupCreated?.created_by?.name || 'Someone';
        content = `${creatorName} created this group.`;
        break;
      case 'member_added':
        const addedUser = await User.findById(metadata.added_user_id).select('name');
        const adderUser = await User.findById(metadata.adder_user_id).select('name');
        content = `${adderUser?.name || 'Someone'} added ${addedUser?.name || 'a member'}`;
        break;
      case 'member_removed':
        const removedUser = await User.findById(metadata.removed_user_id).select('name');
        const removerUser = await User.findById(metadata.remover_user_id).select('name');
        content = `${removerUser?.name || 'Someone'} removed ${removedUser?.name || 'a member'}`;
        break;
      case 'member_left':
        const leftUser = await User.findById(metadata.user_id).select('name');
        content = `${leftUser?.name || 'A member'} left the group`;
        break;
      case 'group_info_updated':
        const updater = await User.findById(metadata.updater_user_id).select('name');
        content = `${updater?.name || 'Someone'} updated the group info.`;
        if (metadata.changes) systemMetadata.changes = metadata.changes;
        break;
      case 'group_settings_updated':
        const settingsUpdater = await User.findById(metadata.updater_user_id).select('name');
        content = `${settingsUpdater?.name || 'Someone'} ${metadata.setting_text || 'updated settings'}.`;
        break;
      default:
        content = 'System message';
    }

    const systemMessage = await Message.create({
      group_id: groupId,
      sender_id: senderId,
      message_type: 'system',
      content,
      metadata: systemMetadata,
    });

    const populatedMessage = await Message.findById(systemMessage._id)
      .populate('sender_id', 'id name avatar')
      .populate('group_id', 'id name avatar')
      .lean({ virtuals: true });

    const transformedMessage = {
      id: populatedMessage._id,
      content: populatedMessage.content,
      message_type: populatedMessage.message_type,
      file_url: populatedMessage.file_url,
      file_type: populatedMessage.file_type,
      mentions: populatedMessage.mentions,
      has_unread_mentions: populatedMessage.has_unread_mentions,
      metadata: populatedMessage.metadata,
      is_encrypted: populatedMessage.is_encrypted,
      created_at: populatedMessage.created_at,
      updated_at: populatedMessage.updated_at,
      deleted_at: populatedMessage.deleted_at,
      sender: populatedMessage.sender_id
        ? {
            id: populatedMessage.sender_id.id || populatedMessage.sender_id._id,
            name: populatedMessage.sender_id.name,
            avatar: populatedMessage.sender_id.avatar,
          }
        : null,
      group: populatedMessage.group_id
        ? {
            id: populatedMessage.group_id.id || populatedMessage.group_id._id,
            name: populatedMessage.group_id.name,
            avatar: populatedMessage.group_id.avatar,
          }
        : null,
      group_id: populatedMessage.group_id
        ? (populatedMessage.group_id.id || populatedMessage.group_id._id)
        : null,
      recipient_id: populatedMessage.recipient_id || null,
      parent_id: populatedMessage.parent_id || null,
    };
    const io = req.app.get('io');
    io.to(`group_${groupId}`).emit('receive-message', transformedMessage);

    return systemMessage;
  } catch (error) {
    console.error('Error creating system message:', error);
    return null;
  }
};

exports.getGroupInfo = async (req, res) => {
  const groupId = req.params.id;
  const userId = req.user?._id;

  try {
    const group = await Group.findById(groupId).populate('created_by', 'id name');
    if (!group) {
      return res.status(404).json({ message: 'Group not Found.' });
    }

    const members = await GroupMember.find({ group_id: groupId }).populate('user_id', 'id name avatar');

    let myRole = null;
    if (userId) {
      const me = members.find(m => m.user_id?.id === userId.toString());
      myRole = me?.role || null;
    }

    const groupJson = group.toObject();
    const groupSettings = await GroupSetting.findOne({ group_id: groupId });
    groupJson.setting = groupSettings;

    groupJson.members = members.map(m => ({ ...m.user_id.toObject(), role: m.role, }));

    if (myRole) {
      groupJson.myRole = myRole;
    }

    return res.status(200).json({ group: groupJson });
  } catch (error) {
    console.error('Error in getGroupInfo:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getUserGroup = async (req, res) => {
  const user_id = req.user._id;
  const search = req.query.search || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  try {
    const [archived, favorites] = await Promise.all([
      Archive.find({ user_id, target_type: 'group' }).select('target_id'),
      Favorite.find({ user_id, target_type: 'group' }).select('target_id'),
    ]);
      

    const archivedSet = new Set(archived.map(a => a.target_id.toString()));
    const favoriteSet = new Set(favorites.map(f => f.target_id.toString()));

    const memberships = await GroupMember.find({ user_id }).select('group_id');
    const groupIds = memberships.map(m => m.group_id);

    if (groupIds.length === 0) {
      return res.status(200).json({
        groups: [],
        pagination: { page, limit, totalCount: 0, totalPages: 0, hasMore: false, },
      });
    }

    const groupQuery = { _id: { $in: groupIds }, ...(search && { name: { $regex: search, $options: 'i' } }), };
    const [totalCount, groups] = await Promise.all([
      Group.countDocuments(groupQuery),
      Group.find(groupQuery).populate('created_by', 'id name email').sort({ updated_at: -1 }).skip(skip).limit(limit),
    ]);

    const updatedGroups = groups.map(g => {
      const group = g.toObject();
      return {
        ...group,
        isArchived: archivedSet.has(group.id.toString()),
        isFavorite: favoriteSet.has(group.id.toString()),
      };
    });

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    return res.status(200).json({
      groups: updatedGroups,
      pagination: { page, limit, totalCount, totalPages, hasMore, },
    });
  } catch (error) {
    console.error('Error in getUserGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getGroupMembers = async (req, res) => {
  const { page = 1, limit = 10, search, group_id, sort_by, sort_order = 'DESC' } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const orderDirection = sort_order.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    if (!group_id) return res.status(400).json({ message: 'group_id is required' });

    const group = await Group.findById(group_id);
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    const baseMatch = { group_id: new mongoose.Types.ObjectId(group_id) };
    const match = { ...baseMatch };

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      match.$or = [ { 'user.name': regex }, { 'user.email': regex }];
    }

    const sortObj = { created_at: -1 };
    if (['name', 'email'].includes(sort_by)) {
      sortObj[`user.${sort_by}`] = orderDirection;
    }

    const totalMemberCount = await GroupMember.countDocuments(baseMatch);

    const members = await GroupMember.aggregate([
      { $match: match },
      { $lookup: { from: 'users', localField: 'user_id', foreignField: '_id', as: 'user'}},
      { $unwind: '$user' },
      { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'Group'},},
      { $unwind: '$Group' },
      { $sort: sortObj },
      { $skip: skip },
      { $limit: parseInt(limit) },
      { $project: {
        id: '$user._id', name: '$user.name', email: '$user.email', avatar: '$user.avatar', group_role: '$role',
        joined_at: '$created_at', updated_at: '$updated_at',
      }},
    ]);

    return res.status(200).json({
      group_id: group._id,
      group_name: group.name,
      group_avatar: group.avatar,
      members,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(members.length / parseInt(limit)),
      total_members: totalMemberCount,
    });
  } catch (error) {
    console.error('Error in getGroupMembers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.addMembersToGroup = async (req, res) => {
  const { group_id, members } = req.body;
  const requestingUserId = req.user._id;

  try {
    if (!group_id || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ message: 'Group ID and members array are required' });
    }

    const group = await Group.findById(group_id);
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    const groupSetting = await GroupSetting.findOne({ group_id });

    const limits = await getEffectiveLimits(group.created_by);

    const currentCount = await GroupMember.countDocuments({ group_id });
    if (currentCount + members.length > limits.max_group_members) {
      return res.status(400).json({ message: `This group cannot exceed ${limits.max_group_members} members.`, });
    }

    const requester = await GroupMember.findOne({ group_id, user_id: requestingUserId });
    if (!requester) return res.status(404).json({ message: 'You are not a member of this group.' });

    const canAddMember = !groupSetting || groupSetting.allow_add_member === 'everyone' || requester.role === 'admin';
    if (!canAddMember) return res.status(403).json({ message: 'Only admins can add members.' });

    const added = [];
    const skipped = [];

    const uniqueUserIds = [...new Set(members.map(m => m.user_id))];
    const existingMembers = await GroupMember.find({ group_id, user_id: { $in: uniqueUserIds } });
    const existingIds = new Set(existingMembers.map(m => m.user_id.toString()));

    for (const member of members) {
      const { user_id, role = 'member' } = member;
      const userIdStr = user_id.toString();

      if (existingIds.has(userIdStr)) {
        skipped.push(user_id);
        continue;
      }

      await GroupMember.create({ group_id, user_id, role });
      added.push({ user_id, role });

      await createSystemMessage(req, group_id, 'member_added', {
        adder_user_id: requestingUserId,
        added_user_id: user_id,
        creator_user_id: requestingUserId,
      });
    }

    if (added.length > 0) {
      const io = req.app.get('io');
      const updatedMembers = await GroupMember.find({ group_id }).populate('user', 'id name avatar email');  // Populate the 'user' field

      const groupPayload = {
        id: group._id,
        name: group.name,
        description: group.description,
        avatar: group.avatar,
        created_by: group.created_by,
        created_at: group.created_at,
        updated_at: group.updated_at,
        members: updatedMembers,
      };

      io.to(`group_${group_id}`).emit('group-member-added', {
        groupId: group_id,
        addedBy: requestingUserId,
        addedMembers: added.map(m => m.user_id),
        group: groupPayload,
      });

      added.forEach(member => {
        io.to(`user_${member.user_id}`).emit('group-added', groupPayload);
        if (member.role === 'admin') {
          io.to(`group_${group_id}`).emit('member-role-updated', { groupId: group_id, userId: member.user_id, newRole: 'admin', });
        }
      });
    }

    return res.status(200).json({
      message: 'Members added successfully',
      added,
      skipped,
      summary: {
        totalRequested: members.length,
        added: added.length,
        skipped: skipped.length,
      },
    });
  } catch (error) {
    console.error('Error in addMembersToGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.removeMemberFromGroup = async (req, res) => {
  const { group_id, user_ids } = req.body;
  const requestingUserId = req.user._id;
  const requestingUserRole = req.user.role;

  try {
    if (!group_id || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: 'group_id and user_ids array are required' });
    }

    if (requestingUserRole !== 'super_admin') {
      const requester = await GroupMember.findOne({ group_id, user_id: requestingUserId });
      if (!requester || requester.role !== 'admin') {
        return res.status(403).json({ message: 'Only group admins can remove members.' });
      }
    }

    const removedUserIds = [];

    for (const targetUserId of user_ids) {
      if (targetUserId.toString() === requestingUserId.toString()) {
        continue;
      }

      const member = await GroupMember.findOne({ group_id, user_id: targetUserId });
      if (!member) continue;

      if (requestingUserRole === 'super_admin' && member.role === 'admin') {
        const adminCount = await GroupMember.countDocuments({ group_id, role: 'admin' });
        if (adminCount <= 1) continue;
      }

      await member.deleteOne();

      await createSystemMessage(req, group_id, 'member_removed', {
        remover_user_id: requestingUserId,
        removed_user_id: targetUserId,
        creator_user_id: requestingUserId,
      });

      removedUserIds.push(targetUserId);
    }

    const io = req.app.get('io');
    removedUserIds.forEach(uid => {
      io.to(`user_${uid}`).emit('group-member-removed', { groupId: group_id, userId: uid });
      io.to(`group_${group_id}`).emit('group-member-removed', { groupId: group_id, userId: uid });
    });

    return res.status(200).json({
      message: removedUserIds.length > 0 ? 'Members removed successfully' : 'No members were removed',
      removed: removedUserIds,
    });
  } catch (error) {
    console.error('Error in removeMemberFromGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.changeMemberRole = async (req, res) => {
  const { group_id, user_id, new_role } = req.body;
  const requestingUserId = req.user._id;
  const requestingUserRole = req.user.role;

  try {
    if (!group_id || !user_id || !['admin', 'member'].includes(new_role)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    if (requestingUserRole !== 'super_admin') {
      const requester = await GroupMember.findOne({ group_id, user_id: requestingUserId });
      if (!requester || requester.role !== 'admin') {
        return res.status(403).json({ message: 'Only admins can change roles' });
      }
    }

    if (user_id.toString() === requestingUserId.toString()) {
      return res.status(400).json({ message: 'Cannot change your own role' });
    }

    const targetMember = await GroupMember.findOne({ group_id, user_id });
    if (!targetMember) return res.status(404).json({ message: 'Member not found' });

    if (requestingUserRole === 'super_admin' && new_role === 'member' && targetMember.role === 'admin') {
      const adminCount = await GroupMember.countDocuments({ group_id, role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot remove the last admin' });
      }
    }

    await targetMember.updateOne({ role: new_role });

    const io = req.app.get('io');
    io.to(`group_${group_id}`).emit('member-role-updated', {
      groupId: group_id, userId: user_id, newRole: new_role,
    });

    res.status(200).json({ message: 'Role updated successfully' });
  } catch (error) {
    console.error('Error in changeMemberRole:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createGroup = async (req, res) => {
  const { name, description, members = [] } = req.body;
  const userId = req.user._id;
  const avatar = req.file ? req.file.path : null;

  try {
    if (!name) return res.status(400).json({ message: 'Group name is required.' });

    const limits = await getEffectiveLimits(userId, req.user.role);

    if (req.user.role !== 'super_admin') {
      const userGroupCount = await GroupMember.countDocuments({ user_id: userId });
      if (userGroupCount >= limits.max_groups_per_user) {
        return res.status(400).json({ message: `You can only be in ${limits.max_groups_per_user} groups.`, });
      }
    }

    const group = await Group.create({ name, description, avatar, created_by: userId, });

    const membersToAdd = [
      { group_id: group._id, user_id: userId, role: 'admin' },
      ...members.map(uid => ({ group_id: group._id, user_id: uid, role: 'member' })),
    ];

    await GroupMember.insertMany(membersToAdd);
    await GroupSetting.create({ group_id: group._id });

    const systemMessage = await createSystemMessage(req, group._id, 'group_created', {
      creator_user_id: userId,
    });

    const allMembers = new Set([...members, userId.toString()]);
    const io = req.app.get('io');

    if (systemMessage && io) {
      const fullSystemMessage = await Message.findById(systemMessage._id)
        .populate('sender_id', 'id name avatar').populate('group_id', 'id name avatar');

      allMembers.forEach(memberId => {
        io.to(`user_${memberId}`).emit('receive-message', fullSystemMessage);
        const userRoom = io.sockets.adapter.rooms.get(`user_${memberId}`);
        if (userRoom) {
          userRoom.forEach(socketId => {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.join(`group_${group._id}`);
          });
        }
      });
    }

    allMembers.forEach(memberId => io.to(`user_${memberId}`).emit('new-group', group));

    return res.status(201).json({ message: 'Group created successfully.', group });
  } catch (error) {
    console.error('Error in createGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateGroup = async (req, res) => {
  const requestingUserId = req.user._id;
  const { name, description, remove_avatar, group_id } = req.body;

  try {
    const group = await Group.findById(group_id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const groupSetting = await GroupSetting.findOne({ group_id });
    const isSuperAdmin = req.user.role === 'super_admin';

    const groupMember = await GroupMember.findOne({ group_id, user_id: requestingUserId,});

    if (!isSuperAdmin && !groupMember) {
      return res.status(403).json({ message: 'You are not a member of the group.' });
    }

    const canEditInfo = isSuperAdmin || !groupSetting || groupSetting.allow_edit_info === 'everyone' || groupMember?.role === 'admin';
    if (!canEditInfo) {
      return res.status(403).json({ message: 'Only admins can edit group info.' });
    }

    const updateData = {};
    const changes = {};

    if (name && name.trim() !== group.name) {
      updateData.name = name.trim();
      changes.name = { old: group.name, new: name.trim() };
    }

    if (description !== undefined && description?.trim() !== group.description) {
      updateData.description = description.trim();
      changes.description = { old: group.description, new: description.trim() };
    }

    if (remove_avatar === 'true') {
      if (group.avatar) {
        const oldPath = path.join(process.cwd(), group.avatar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      updateData.avatar = null;
      changes.avatar = { old: group.avatar, new: null };
    } else if (req.file) {
      if (group.avatar) {
        const oldPath = path.join(process.cwd(), group.avatar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      updateData.avatar = req.file.path;
      changes.avatar = { old: group.avatar, new: req.file.path };
    }

    if (Object.keys(updateData).length > 0) {
      await Group.updateOne({ _id: group_id }, updateData);
    }

    if (Object.keys(changes).length > 0) {
      await createSystemMessage(req, group_id, 'group_info_updated', {
        updater_user_id: requestingUserId,
        creator_user_id: requestingUserId,
        changes,
      });
    }

    const updatedGroup = await Group.findById(group_id);

    return res.status(200).json({ message: 'Group updated successfully.', data: updatedGroup, });
  } catch (error) {
    console.error('Error in updateGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateGroupSetting = async (req, res) => {
  const user_id = req.user._id;
  const { group_id, allow_edit_info, allow_send_message, allow_add_member, allow_mentions } = req.body;

  try {
    if (!group_id) return res.status(400).json({ message: 'Group id is required.' });

    const group = await Group.findById(group_id);
    if (!group) return res.status(400).json({ message: 'Group not found.' });
    
    const groupSetting = await GroupSetting.findOne({ group_id });
    if (!groupSetting) return res.status(400).json({ message: 'Group settings not found.' });
    
    const member = await GroupMember.findOne({ group_id, user_id });
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ message: 'Only admins can update group settings.' });
    }

    const updateData = {};
    if (['admin', 'everyone'].includes(allow_edit_info)) updateData.allow_edit_info = allow_edit_info;
    if (['admin', 'everyone'].includes(allow_send_message)) updateData.allow_send_message = allow_send_message;
    if (['admin', 'everyone'].includes(allow_add_member)) updateData.allow_add_member = allow_add_member;
    if (['admin', 'everyone'].includes(allow_mentions)) updateData.allow_mentions = allow_mentions;
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No valid settings provided.' });
    }
    await groupSetting.updateOne(updateData);
    

    const updatedSetting = await GroupSetting.findOne({ group_id });

    if (updateData.allow_send_message) {
      const updater = await User.findById(user_id).select('name');
      const settingText = updateData.allow_send_message === 'admin'
        ? 'allowed only admins to send messages'
        : 'allowed everyone to send messages';
      await createSystemMessage(req, group_id, 'group_settings_updated', { updater_user_id: user_id, setting_text: settingText, });
    }
    const io = req.app.get('io');
    if (io) {
      io.to(`group_${group_id}`).emit('group-settings-updated', { groupId: group_id, settings: updatedSetting, });
    }

    return res.status(200).json({ message: 'Group settings updated successfully.', data: updatedSetting, });
  } catch (error) {
    console.error('Error in updateGroupSetting:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteGroup = async (req, res) => {
  const { ids } = req.body;
  const requestingUserId = req.user._id;

  try {
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'An array of group IDs is required.' });
    }

    const groups = await Group.find({ _id: { $in: ids } });
    if (groups.length === 0) {
      return res.status(404).json({ message: 'No groups found' });
    }

    if (req.user.role !== 'super_admin') {
      const adminGroups = await GroupMember.find({group_id: { $in: ids },user_id: requestingUserId,role: 'admin'});
      const adminGroupIds = adminGroups.map(m => m.group_id.toString());
      const unauthorized = ids.filter(id => !adminGroupIds.includes(id.toString()));
      if (unauthorized.length > 0) {
        return res.status(403).json({ message: 'Not authorized to delete some groups' });
      }
    }

    const members = await GroupMember.find({ group_id: { $in: ids } });
    const membersByGroup = members.reduce((acc, m) => {
      const gid = m.group_id.toString();
      if (!acc[gid]) acc[gid] = [];
      acc[gid].push(m.user_id.toString());
      return acc;
    }, {});

    await Promise.all([
      GroupMember.deleteMany({ group_id: { $in: ids } }),
      GroupSetting.deleteMany({ group_id: { $in: ids } }),
      Message.deleteMany({ group_id: { $in: ids } }),
      Group.deleteMany({ _id: { $in: ids } }),
    ]);

    const io = req.app.get('io');
    groups.forEach(group => {
      const memberIds = membersByGroup[group._id.toString()] || [];
      memberIds.forEach(userId => {
        io.to(`user_${userId}`).emit('group-deleted', { id: group._id, name: group.name });
      });
    });

    return res.status(200).json({ message: 'Groups deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.leaveGroup = async (req, res) => {
  const user_id = req.user._id;
  const { group_id } = req.body;

  if (!group_id) {
    return res.status(400).json({ message: 'group_id is required.' });
  }

  try {
    const group = await Group.findById(group_id);
    if (!group) return res.status(404).json({ message: 'Group not found.' });

    const member = await GroupMember.findOne({ group_id, user_id });
    if (!member) return res.status(404).json({ message: 'You are not a member of this group.' });

    // === FIX: Clean up user's favorite/archive for this group ===
    await Favorite.deleteOne({ 
      user_id, 
      target_id: group_id, 
      target_type: 'group' 
    });

    await Archive.deleteOne({ 
      user_id, 
      target_id: group_id, 
      target_type: 'group' 
    });
    // === END FIX ===

    const remainingMembers = await GroupMember.countDocuments({ group_id });

    const io = req.app.get('io');

    if (remainingMembers === 1) {
      // User is the last member → delete the group
      await GroupMember.deleteOne({ group_id, user_id }); // remove member record
      await group.deleteOne();

      io.to(`user_${user_id}`).emit('group-deleted', { 
        id: group_id, 
        name: group.name 
      });

      return res.status(200).json({ 
        message: 'Group deleted as you were the last member.' 
      });
    }

    // Remove the member
    await member.deleteOne();

    // Leave the group room
    const userRoom = io.sockets.adapter.rooms.get(`user_${user_id}`);
    if (userRoom) {
      userRoom.forEach(socketId => {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) socket.leave(`group_${group_id}`);
      });
    }

    // Handle admin promotion if needed
    let newAdminPromoted = null;
    if (member.role === 'admin') {
      const adminsLeft = await GroupMember.countDocuments({ group_id, role: 'admin' });
      if (adminsLeft === 0) {
        const oldestMember = await GroupMember.findOne({ group_id })
          .sort({ created_at: 1 })
          .lean();

        if (oldestMember) {
          await GroupMember.updateOne(
            { _id: oldestMember._id },
            { role: 'admin' }
          );
          newAdminPromoted = oldestMember.user_id.toString();
        }
      }
    }

    // Send system message: "You left the group" or "X left"
    await createSystemMessage(req, group_id, 'member_left', { user_id });

    // Notify group members
    io.to(`group_${group_id}`).emit('member-left-group', { 
      groupId: group_id, 
      userId: user_id 
    });

    if (newAdminPromoted) {
      io.to(`group_${group_id}`).emit('member-role-updated', { 
        groupId: group_id, 
        userId: newAdminPromoted, 
        newRole: 'admin' 
      });
    }

    // Notify the user who left
    io.to(`user_${user_id}`).emit('group-left', { groupId: group_id });

    return res.status(200).json({ 
      message: 'You have left the group successfully.' 
    });

  } catch (error) {
    console.error('Error in leaveGroup:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getAllGroups = async (req, res) => {
  const { page = 1, limit = 10, search, sort_by = 'created_at', sort_order } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const orderDirection = sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const query = search ? {
      $or: [{ name: { $regex: search, $options: 'i' } },{ description: { $regex: search, $options: 'i' } }],
    } : {};

    const sortObj = {};
    sortObj[sort_by] = orderDirection;

    const [total, groups] = await Promise.all([
      Group.countDocuments(query),
      Group.find(query).populate('created_by', 'id name email avatar') .sort(sortObj) .skip(skip) .limit(parseInt(limit)) ,
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      page: parseInt(page),
      limit: parseInt(limit),
      groups,
    });
  } catch (error) {
    console.error('Error in getAllGroups:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};