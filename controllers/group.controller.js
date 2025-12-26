const { Group, GroupMember, User, GroupSetting, Message, Setting, Favorite, Archive } = require('../models');
const { Op, fn, col, where, literal } = require('sequelize');
const fs = require('fs');
const path = require('path');
const { getEffectiveLimits } = require('../utils/userLimits');

const createSystemMessage = async (req, groupId, action, metadata = {}) => {
    try {
        
      let content = '';
      let systemMetadata = { system_action: action, ...metadata};
  
      switch (action) {
        case 'group_created':
          const group = await Group.findByPk(groupId, {
            include: [{ model: User, as: 'creator', attributes: ['name'] }],
          });
          const creatorName = group?.creator?.name || 'Someone';
          content = `${creatorName} created this group.`;
          break;
    
        case 'member_added':
          const addedUser = await User.findByPk(metadata.added_user_id, { attributes: ['name'] });
          const adderUser = await User.findByPk(metadata.adder_user_id, { attributes: ['name'] });
          content = `${adderUser.name || 'Someone'} added ${addedUser.name || 'a member'}`;
          break;
  
        case 'member_removed':
          const removedUser = await User.findByPk(metadata.removed_user_id, { attributes: ['name'] });
          const removerUser = await User.findByPk(metadata.remover_user_id, { attributes: ['name'] });
          content = `${removerUser.name || 'Someone'} removed ${removedUser.name || 'a member'}`;
          break;
  
        case 'member_left':
          const leftUser = await User.findByPk(metadata.user_id, { attributes: ['name'] });
          content = `${leftUser.name || 'A member'} left the group`;
          break;
  
        case 'group_info_updated':
          const updater = await User.findByPk(metadata.updater_user_id, { attributes: ['name'] });
          
          content = `${updater?.name || 'Someone'} updated the group info.`;
          if (metadata.changes) {
            systemMetadata.changes = metadata.changes;
          }
          break;

        case 'group_settings_updated':
          const settingsUpdater = await User.findByPk(metadata.updater_user_id, { attributes: ['name'] });
          content = `${settingsUpdater?.name || 'Someone'} ${metadata.setting_text || 'update settings'}.`;
          break;
  
        default:
          content = 'System message';
      }
  
      const systemMessage = await Message.create({
        group_id: groupId,
        sender_id: metadata.creator_user_id,
        message_type: 'system',
        content,
        metadata: systemMetadata,
      });
  
      const io = req.app.get('io');
      io.to(`group_${groupId}`).emit('receive-message', systemMessage);
  
      return systemMessage;
    } catch (error) {
      console.error('Error creating system message:', error);
      return null;
    }
};

exports.getGroupInfo = async (req,res) => {
    const groupId = req.params.id;
    const userId = req.user?.id;
    const attributes = ['id', 'name', 'avatar']

    try {
        const group = await Group.findByPk(groupId, {
            include: [
                { model: User, as: 'creator', attributes },
                { model: User, through: { attributes: ['role'] }, attributes },
                { model: GroupSetting, as: 'setting' },
            ]
        });

        if(!group) return res.status(404).json({ message: 'Group not Found.' });

        let myRole = null;
        if (userId) {
            const membership = await GroupMember.findOne({
                where: { group_id: groupId, user_id: userId },
                attributes: ['role'],
            });
            myRole = membership?.role || null;
        }

        const groupJson = group.toJSON();
        if (myRole) {
            groupJson.myRole = myRole;
        }

        return res.status(200).json({ group: groupJson });
    } catch (error) {
        console.error('Error in getGroupInfo:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getUserGroup = async (req,res) => {
    const user_id = req.user.id;
    const search = req.query.search || '';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    try {
        const [archived, favorites] = await Promise.all([
            Archive.findAll({
                where: { user_id, target_type: 'group' },
                attributes: ['target_id']
            }),
            Favorite.findAll({
                where: { user_id, target_type: 'group' },
                attributes: ['target_id']
            })
        ]);

        const archivedSet = new Set(archived.map(a => a.target_id));
        const favoriteSet = new Set(favorites.map(f => f.target_id));

        const where = {};

        if (search) where.name = { [Op.like]: `%${search}%` };

        const totalCount = await Group.count({
            include: [
              { model: GroupMember, as: 'memberships', where: { user_id }, attributes: []},
            ],
            where,
            distinct: true,
        });

        const groups = await Group.findAll({
            include: [
                { model: GroupMember, as: 'memberships', where: { user_id }, attributes: []},
                { model: User, as: 'creator', attributes: ['id', 'name', 'email']}
            ],
            where,
            order: [['updated_at', 'DESC']],
            limit,
            offset
        });

        const updatedGroups = groups.map(g => ({
            ...g.toJSON(),
            isArchived: archivedSet.has(g.id),
            isFavorite: favoriteSet.has(g.id)
        }));

        const totalPages = Math.ceil(totalCount / limit);
        const hasMore = page < totalPages;

        return res.status(200).json({ 
            groups: updatedGroups,
            pagination: { page, limit, totalCount, totalPages, hasMore }
        });
    } catch (error) {
        console.error('Error in getUserGroup:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getGroupMembers = async (req,res) => {
    const {
        page = 1, limit = 10, search, group_id, sort_by, sort_order = 'DESC'
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const validSortOrders = ['ASC', 'DESC'];
    const orderDirection = validSortOrders.includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

    try {
        if(!group_id) return res.status(400).json({ message: 'group_id is required' });

        const group = await Group.findByPk(parseInt(group_id));
        if(!group) return res.status(404).json({ message: 'Group not found.' });

        const baseWhere = { group_id: parseInt(group_id) };
        const where = { ...baseWhere };

        if(search){
            where[Op.or] = [
                { '$user.name$': { [Op.like]: `%${search}%` } },
                { '$user.email$': { [Op.like]: `%${search}%` } },
            ];
        }

        const allowedSortFields = ['created_at', 'name', 'email'];
        let order = [['created_at', 'DESC']];

        if (allowedSortFields.includes(sort_by)) {
            switch (sort_by) {
                case 'name':
                    order = [['user', 'name', orderDirection]];
                    break;
                case 'email':
                    order = [['user', 'email', orderDirection]];
                    break;
                default:
                    order = [[sort_by, orderDirection]];
                    break;
            }

            if (sort_by !== 'created_at') {
                order.push(['created_at', 'DESC']);
            }
        }
        const totalMemberCount = await GroupMember.count({ where: baseWhere });

        const { count, rows: members } = await GroupMember.findAndCountAll({
            where,
            include: [
                { model: User, attributes: ['id', 'name', 'bio', 'email', 'avatar'], as: 'user'},
                { model: Group, attributes: ['id', 'name'], as: 'Group'}
            ],
            order,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const formattedMembers = members.map((member) => ({
            id: member.user.id,
            name: member.user.name,
            email: member.user.email,
            avatar: member.user.avatar,
            group_role: member.role,
            joined_at: member.created_at,
            updated_at: member.updated_at
        }));

        return res.status(200).json({
            group_id: group.id,
            group_name: group.name,
            group_avatar: group.avatar,
            members: formattedMembers,
            page: parseInt(page),
            limit: parseInt(limit),
            total_pages: Math.ceil(count / parseInt(limit)),
            total_members: totalMemberCount,
        });
    } catch (error) {
        console.error('Error in getGroupMembers:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.addMembersToGroup = async (req,res) => {
    const { group_id, members } = req.body;
    const requestingUserId = req.user.id;

    try {
        if (!group_id || !Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ message: 'Group ID and members array are required' });
        }

        for (const member of members) {
            if (!member.user_id) return res.status(400).json({ message: 'Each member must have user_id' });
        }

        const group = await Group.findByPk(group_id, {
            include: [{ model: GroupSetting, as: 'setting' }],
        });
        if(!group) return res.status(404).json({ message: 'Group not found.' });

        const limits = await getEffectiveLimits(group.created_by);

        const currentCount = await GroupMember.count({ where: { group_id }});
        if (currentCount + members.length > limits.max_group_members) {
            return res.status(400).json({
                message: `This group cannot exceed ${limits.max_group_members} members.`,
            });
        }
        
        const user = await GroupMember.findOne({ where: { group_id, user_id:requestingUserId }});
        if(!user) return res.status(404).json({ message: 'You are not a member of this group.' });

        const canAddMember = !group.setting || group.setting.allow_add_member === 'everyone' || user.role === 'admin';
        if(!canAddMember) return res.status(403).json({ message: 'Only admins can add members.' });

        const added = [];
        const skipped = [];
        const failed = [];

        const uniqueUserId = [...new Set(members.map((m) => parseInt(m.user_id)))];
        const existingMembers = await GroupMember.findAll({
            where: { group_id, user_id: uniqueUserId },
        });
        
        const existingIds = new Set(existingMembers.map((m) => m.user_id));

        for(const member of members) {
            const { user_id, role = 'member'} = member;

            if (existingIds.has(parseInt(user_id))) {
                skipped.push(user_id);
                continue;
            }

            try {
                await GroupMember.create({ group_id, user_id, role });
                added.push({ user_id, role});

                if (typeof createSystemMessage === 'function') {
                    await createSystemMessage(req, group_id, 'member_added', {
                      adder_user_id: requestingUserId,
                      added_user_id: user_id,
                      creator_user_id: requestingUserId,
                    });
                }
            } catch (error) {
                console.error(`Error adding user ${user_id}:`, error);
                failed.push({ user_id, reason: 'Database error' });
            }
        }

        if (added.length > 0) {
            const io = req.app.get('io');

            if(io){
                const updatedMembers = await GroupMember.findAll({
                    where: { group_id },
                    include: [
                      { model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'email']},
                    ],
                });

                const groupPayload = {
                    id: group.id,
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
                    addedMembers: added.map((m) => m.user_id),
                    group: groupPayload,
                });

                for (const member of added) {
                    io.to(`user_${member.user_id}`).emit('group-added', groupPayload);
        
                    if (member.role === 'admin') {
                      io.to(`group_${group_id}`).emit('member-role-updated', {
                        groupId: group_id,
                        userId: member.user_id,
                        newRole: 'admin',
                      });
                    }
                }
            }
        }

        return res.status(200).json({
            message: 'Member added successfully',
            added,
            skipped,
            failed,
            summary: {
                totalRequested: members.length,
                added: added.length,
                skipped: skipped.length,
                failed: failed.length
            },
        });
    } catch (error) {
        console.error('Error in addMembersToGroup:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.removeMemberFromGroup = async (req,res) => {
    const { group_id, user_ids} = req.body;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;

    try {
        if(!group_id) return res.status(400).json({ message: 'Group id is required.'});

        if(!Array.isArray(user_ids) || user_ids.length === 0){
            return res.status(400).json({ message: 'user_ids must be a non-empty array.' });
        }

        if (requestingUserRole !== 'super_admin') {
            const requester = await GroupMember.findOne({
                where: { group_id, user_id: requestingUserId }
            });

            if (!requester) {
                return res.status(400).json({ message: 'You are not a member of this group.' });
            }

            if (requester.role !== 'admin') {
                return res.status(400).json({ message: 'Only group admins can remove members.' });
            }
        }

        const removedUserIds = [];
        const messages = [];

        for (const targetUserId of user_ids) {
            if(targetUserId === requestingUserId){
                messages.push('You cannot remove yourself from the group.');
                continue;
            }

            const member = await GroupMember.findOne({ where: { group_id, user_id: targetUserId }});
            if(!member){
                messages.push(`User ${targetUserId} is not part of the group.`);
                continue;
            }

            if (requestingUserRole === 'super_admin') {
                if (member.role === 'admin') {
                    const adminCount = await GroupMember.count({ where: { group_id, role: 'admin' }});

                    if (adminCount <= 1) {
                        messages.push(`You cannot remove the last admin (User ${targetUserId}). A group must always have at least one admin.`);
                        continue;
                    }
                }
            } else {
                if (member.role === 'admin') {
                    messages.push(`You cannot remove another admin (User ${targetUserId}).`);
                    continue;
                }
            }

            await GroupMember.destroy({ where: { group_id, user_id: targetUserId }});

            await createSystemMessage(req, group_id, 'member_removed', {
                remover_user_id: requestingUserId,
                removed_user_id: targetUserId,
                creator_user_id: requestingUserId
            });

            removedUserIds.push(targetUserId);
        }

        const io = req.app.get('io');
        removedUserIds.forEach((uid) => {
            io.to(`user_${uid}`).emit('group-member-removed', {
                groupId: group_id, userId: uid,
            });

            io.to(`group_${group_id}`).emit('group-member-removed', {
                groupId: group_id, userId: uid,
            });
        });

        if (removedUserIds.length === 0) {
            return res.status(400).json({ message: 'No members were removed.', details: messages });
        }

        let message = removedUserIds.length > 1
            ? `${removedUserIds.length} members removed from group.` : 'Member removed from group.';
        
        return res.status(200).json({ message, removed: removedUserIds, details: messages.length > 0 ? messages : undefined });
    } catch (error) {
        console.error('Error in removeMemberFromGroup:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.changeMemberRole = async (req,res) => {
    const { group_id, user_id, new_role } = req.body;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;

    try {
        if (!group_id || !user_id) {
            return res.status(400).json({ message: 'group_id and user_id are required' });
        }
        
        if (!['admin', 'member'].includes(new_role)) return res.status(400).json({ message: 'Invalid role' });

        const group = await Group.findByPk(group_id);
        if (!group) return res.status(404).json({ message: 'Group not found' });

        if (requestingUserRole !== 'super_admin') {
            const requestingMember = await GroupMember.findOne({
                where: { group_id, user_id: requestingUserId },
            });
            if (!requestingMember) return res.status(403).json({ message: 'You are not a member of this group.' });

            if (requestingMember.role !== 'admin') {
                return res.status(403).json({ message: 'Only admins can change member roles.' });
            }
        }

        if (parseInt(user_id) === requestingUserId) {
            return res.status(400).json({ message: 'You cannot change your own role.' });
        }

        const targetMember = await GroupMember.findOne({ where: { group_id, user_id }});
        if (!targetMember) {
            return res.status(404).json({ message: 'Target user is not a member of this group.' });
        }

        if (requestingUserRole === 'super_admin' && new_role === 'member' && targetMember.role === 'admin') {
            const adminCount = await GroupMember.count({
                where: { group_id, role: 'admin' },
            });

            if (adminCount <= 1) {
                return res.status(400).json({
                    message: 'A group must always have at least one admin. You cannot remove the last admin.',
                });
            }
        }

        await targetMember.update({ role: new_role });

        const io = req.app.get('io');
        io.to(`group_${group_id}`).emit('member-role-updated', {
            groupId: group_id, userId: user_id, newRole: new_role,
        });

        res.status(200).json({
            message: 'Role updated successfully',
            data: { user_id, group_id, new_role},
        });
    } catch (error) {
        console.error('Error in changeMemberRole:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createGroup = async (req,res) => {
    const { name, description, members=[] } = req.body;
    const userId = req.user.id;
    const avatar = req.file ? req.file.path : null;
    
    try {
        if(!name) return res.status(400).json({ message: 'Group name is required.'});

        const limits = await getEffectiveLimits(userId, req.user.role);

        if(req.user.role !== 'super_admin') {
            const userGroupCount = await GroupMember.count({ where: { user_id: userId }});

            if (userGroupCount >= limits.max_groups_per_user) {
                return res.status(400).json({
                    message: `You can only be in ${limits.max_groups_per_user} groups. Upgrade your plan for more.`
                });
            }
        }

        const group = await Group.create({ name, description, avatar, created_by: userId });

        const membersToAdd = [
            { group_id: group.id, user_id: userId, role: 'admin' },
            ...members.map((uid) => ({ group_id: group.id, user_id: uid, role: 'member' }))
        ];

        await GroupMember.bulkCreate(membersToAdd, { ignoreDuplicates: true });
        await GroupSetting.create({ group_id: group.id });

        const result = await Group.findByPk(group.id, {
            include: [{ model: User, as: 'creator', attributes: ['id', 'name']}]
        });

        const allMembers = [...new Set(members), userId];
        const uniqueMembers = [...new Set(members)].filter((id) => id !== userId);
        for (const id of uniqueMembers) {
        await GroupMember.findOrCreate({
            where: { group_id: group.id, user_id: id }, defaults: { role: 'member' },
        });
        }

        const systemMessage = await createSystemMessage(req, group.id, 'group_created', {
            creator_user_id: userId,
        });

        const io = req.app.get('io');
        
        if (systemMessage && io) {
            const fullSystemMessage = await Message.findByPk(systemMessage.id, {
                include: [
                    { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
                    { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] },
                ],
            });
            
            if (fullSystemMessage) {
                allMembers.forEach((member) => {
                    io.to(`user_${member}`).emit('receive-message', fullSystemMessage);
                });
                
                allMembers.forEach((memberId) => {
                    const userRoom = io.sockets.adapter.rooms.get(`user_${memberId}`);
                    if (userRoom) {
                        userRoom.forEach((socketId) => {
                            const socket = io.sockets.sockets.get(socketId);
                            if (socket) {
                                socket.join(`group_${group.id}`);
                                console.log(`User ${memberId} joined group_${group.id} after group creation`);
                            }
                        });
                    }
                });
            }
        }

        allMembers.forEach((member) => io.to(`user_${member}`).emit('new-group', group));

        return res.status(201).json({ message: 'Group created successfully.', group:result});
    } catch (error) {
        console.error('Error in createGroup:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateGroup = async (req,res) => {
    const requestingUserId = req.user.id;
    const { name, description, remove_avatar, group_id } = req.body;

    try {
        const group = await Group.findByPk(group_id, {
            include: [{ model: GroupSetting, as: 'setting' }],
        });
        if(!group) return res.status(404).json({ message: 'Group not found' });

        const isSuperAdmin = req.user.role === 'super_admin';
        
        const groupMember = await GroupMember.findOne({
            where: { group_id, user_id: requestingUserId },
        });
        if (!isSuperAdmin) {
            
            if (!groupMember) return res.status(404).json({ 
                message: 'You are not a member of the group.' 
            });
        }

        const setting = group.setting;
        let canEditInfo = false;

        if (isSuperAdmin) {
            canEditInfo = true;
        } else {
            canEditInfo = !setting || setting.allow_edit_info === 'everyone' || groupMember.role === 'admin';
        }

        if (!canEditInfo) return res.status(403).json({ message: 'Only admins can edit group info.'});

        const updateData = {};
        const changes = {};

        if (name && name.trim() !== group.name){
            updateData.name = name.trim();
            changes.name = { old: group.name, new: name.trim()};
        } 
        if (description && description.trim() !== group.description){
            updateData.description = description.trim();
            changes.description = { old: group.description, new: description.trim()};
        } 

        if (remove_avatar === 'true') {
            if (group.avatar) {
              const oldPath = path.join(__dirname, '../', group.avatar);
              fs.unlink(oldPath, err => {
                if (err && err.code !== 'ENOENT') console.error('Error deleting old avatar:', err);
              });
            }
            
            updateData.avatar = null;
            changes.avatar = { old: group.avatar, new: null};

        } else if (req.file) {
            if (group.avatar) {
              const oldPath = path.join(__dirname, '../', group.avatar);
              fs.unlink(oldPath, err => {
                if (err && err.code !== 'ENOENT') console.error('Error deleting old avatar:', err);
              });
            }

            updateData.avatar = req.file.path;
            changes.avatar = { old: group.avatar, new: req.file.path};
        }
        
        await group.update(updateData);

        if(Object.keys(changes).length > 0){
            await createSystemMessage(req, group_id, 'group_info_updated', 
                { updater_user_id: requestingUserId, creator_user_id: requestingUserId, changes }
            );
        }

        return res.status(200).json({ message: 'Group updated successfully.', data: group });
    } catch (error) {
        console.error('Error in updateGroup:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateGroupSetting = async (req,res) => {
    const user_id = req.user.id;
    const { group_id, allow_edit_info, allow_send_message, allow_add_member,allow_mentions } = req.body;

    try {
        if(!group_id) return res.status(400).json({ message: 'Group id is required.'});

        const group = await Group.findByPk(group_id, {
            include: [{ model: GroupSetting, as: 'setting'}]
        });
        if(!group) return res.status(400).json({ message: 'Group not found.'});

        const member = await GroupMember.findOne({ where: { group_id, user_id }});
        if(!member) return res.status(403).json({ message: 'You are not a member of this group.' });

        if (member.role !== 'admin') {
            return res.status(403).json({ message: 'Only admins can update group settings.' });
        }

        const updateData = {};
        if (allow_edit_info && ['admin', 'everyone'].includes(allow_edit_info)) {
            updateData.allow_edit_info = allow_edit_info;
        }
        if (allow_send_message && ['admin', 'everyone'].includes(allow_send_message)) {
            updateData.allow_send_message = allow_send_message;
        }
        if (allow_add_member && ['admin', 'everyone'].includes(allow_add_member)) {
            updateData.allow_add_member = allow_add_member;
        }
        if (allow_mentions && ['admin', 'everyone'].includes(allow_mentions)) {
            updateData.allow_mentions = allow_mentions;
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ message: 'No valid settings provided.' });
        }

        let setting = group.setting;
        const oldSetting = setting ? setting.toJSON() : null;
        if (setting) await setting.update(updateData);
        else setting = await GroupSetting.create({ group_id, ...updateData });
        
        // Create system message for send message setting change
        if (updateData.allow_send_message) {
            const updater = await User.findByPk(user_id, { attributes: ['name'] });
            const settingText = updateData.allow_send_message === 'admin' 
                ? 'allowed only admins to send messages to this group'
                : 'allowed everyone to send messages to this group';
            await createSystemMessage(req, group_id, 'group_settings_updated', {
                creator_user_id: user_id,
                updater_user_id: user_id,
                setting_type: 'allow_send_message',
                setting_value: updateData.allow_send_message,
                setting_text: settingText,
            });
        }
        
        // Emit socket event to all group members for real-time updates
        const io = req.app.get('io');
        if (io) {
            const updatedSetting = setting.toJSON();
            io.to(`group_${group_id}`).emit('group-settings-updated', {
                groupId: group_id,
                settings: updatedSetting,
            });
        }
        
        return res.status(200).json({
            message: 'Group settings updated successfully.',
            data: setting,
        });
    } catch (error) {
        console.error('Error in updateGroupSetting:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteGroup = async (req,res) => {
    const { ids } = req.body;
    const requestingUserId = req.user.id;

    if(!Array.isArray(ids) || ids.length === 0){
        return res.status(400).json({ message: 'An array of group Id is required.'});
    }

    try {
        const user = await User.findByPk(requestingUserId);
        if(!user) return res.status(404).json({ message: 'User not found.'});

        const groups = await Group.findAll({ where: { id: ids } });
        const foundIds = groups.map(g => g.id);
        const missingIds = ids.filter(id => !foundIds.includes(id));

        if (missingIds.length > 0) {
            return res.status(404).json({ message: `Groups not found: ${missingIds.join(', ')}`});
        }

        if (user.role !== 'super_admin') {
            const adminGroups = await GroupMember.findAll({
              where: { group_id: ids, user_id: requestingUserId, role: 'admin' },
            });
      
            const adminGroupIds = adminGroups.map(m => m.group_id);
            const nonAdminGroupIds = ids.filter(id => !adminGroupIds.includes(id));
      
            if (nonAdminGroupIds.length > 0) {
              return res.status(403).json({
                message: `You are not authorized to delete these groups: ${nonAdminGroupIds.join(', ')}`,
              });
            }
        }

        const members = await GroupMember.findAll({
            where: { group_id: ids }, attributes: ['user_id', 'group_id'],
        });

        const membersByGroup = members.reduce((acc, m) => {
            if (!acc[m.group_id]) acc[m.group_id] = [];
            acc[m.group_id].push(m.user_id);
            return acc;
        }, {});

        await GroupMember.destroy({ where: { group_id: ids } });
        await GroupSetting.destroy({ where: { group_id: ids } });
        await Message.destroy({ where: { group_id: ids } });
        await Group.destroy({ where: { id: ids } });

        const io = req.app.get('io');
        groups.forEach(group => {
            const payload = { id: group.id, name: group.name };
            const groupMemberIds = membersByGroup[group.id] || [];

            groupMemberIds.forEach(userId => {
                io.to(`user_${userId}`).emit('group-deleted', payload);
            });
        });

        return res.status(200).json({ message: 'Groups deleted successfully.' });
    } catch (error) {
        console.error('Error in deleteGroup:', error);
        return res.status(500).json({ message: 'Internal server error' }); 
    }
};

exports.leaveGroup = async (req,res) => {
    const user_id = req.user.id;
    const { group_id } = req.body;

    try {
        const group = await Group.findByPk(group_id);
        if (!group) return res.status(404).json({ message: 'Group not found.' });
        
        const member = await GroupMember.findOne({ where: { group_id, user_id } });
        if (!member) return res.status(404).json({ message: 'You are not a member of this group.' });
        
        const remainingMembers = await GroupMember.count({ where: { group_id } });
        if (remainingMembers === 1){
            const allMembers = await GroupMember.findAll({
                where: { group_id },
                attributes: ['user_id'],
                raw: true
            });
            const memberIds = allMembers.map(m => m.user_id);
            
            await group.destroy();
            
            const io = req.app.get('io');
            const payload = { id: group_id, name: group.name };
            memberIds.forEach(userId => {
                io.to(`user_${userId}`).emit('group-deleted', payload);
            });
            
            return res.status(200).json({ message: 'You cannot leave this group because you are the only member. The group has been deleted.' });
        } 

        await member.destroy();
        
        const io = req.app.get('io');
        const userRoom = io.sockets.adapter.rooms.get(`user_${user_id}`);
        if (userRoom) {
            userRoom.forEach((socketId) => {
                const socket = io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(`group_${group_id}`);
                    console.log(`User ${user_id} left group_${group_id} socket room`);
                }
            });
        }

        let newAdminPromoted = null;
        if(member.role === 'admin') {
            const adminsLeft = await GroupMember.count({
                where: { group_id, role: 'admin'}
            });

            if(adminsLeft === 0){
                const oldestMember = await GroupMember.findOne({
                    where: { group_id }, order: [['created_at', 'ASC']]
                });

                if (oldestMember){
                    await oldestMember.update({ role: 'admin' });
                    newAdminPromoted = { userId: oldestMember.user_id, newRole: 'admin' };
                } 
            }
        }

        const systemMessage = await createSystemMessage(req, group_id, 'member_left', { user_id, creator_user_id: user_id, });
        if (systemMessage) {
            const fullSystemMessage = await Message.findByPk(systemMessage.id, {
                include: [
                    { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
                    { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] },
                ],
            });
            if (fullSystemMessage) {
                io.to(`user_${user_id}`).emit('receive-message', fullSystemMessage);
            }
        }
    
        io.to(`group_${group_id}`).emit('member-left-group', {
            groupId: group_id, userId: user_id,
        });

        if (newAdminPromoted) {
            io.to(`group_${group_id}`).emit('member-role-updated', {
              groupId: group_id,
              userId: newAdminPromoted.userId,
              newRole: newAdminPromoted.newRole,
            });
        }
        
        io.to(`user_${user_id}`).emit('group-left', { groupId: group_id, userId: user_id });

        return res.status(200).json({ message: 'You have left the group successfully.'});
    } catch (error) {
        console.error('Error in leaveGroup:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getAllGroups = async (req, res) => {
    const { page = 1, limit = 10, search, sort_by = 'created_at', sort_order } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const orderDirection = sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  
    try {
      const allowedSortFields = {
        name: ['name'],
        description: ['description'],
        created_at: ['created_at'],
        updated_at: ['updated_at'],
        creator_name: [ { model: User, as: 'creator' }, 'name' ],
        creator_email: [ { model: User, as: 'creator' }, 'email' ],
        member_count: [literal('member_count')],
      };
  
      const safeSortField = allowedSortFields[sort_by] || ['created_at'];
      const whereCondition = {};
  
      if (search) {
        const searchValue = `%${search.toLowerCase()}%`;
        whereCondition[Op.or] = [
          where(fn('LOWER', col('Group.name')), { [Op.like]: searchValue }),
          where(fn('LOWER', col('Group.description')), { [Op.like]: searchValue }),
          where(fn('LOWER', col('creator.name')), { [Op.like]: searchValue }),
          where(fn('LOWER', col('creator.email')), { [Op.like]: searchValue }),
        ];
      }
  
      const { count, rows: groups } = await Group.findAndCountAll({
        where: whereCondition,
        include: [
          { model: User, as: 'creator', attributes: ['id', 'name', 'email', 'avatar'] },
          { model: GroupMember, as: 'memberships', attributes: [] },
        ],
        attributes: [
          'id',
          'name',
          'description',
          'avatar',
          'created_by',
          'created_at',
          [fn('COUNT', col('memberships.user_id')), 'member_count'],
        ],
        group: ['Group.id', 'creator.id'],
        order: sort_by === 'member_count'
          ? [[literal('member_count'), orderDirection]] : [[...safeSortField, orderDirection]],
        limit: parseInt(limit),
        offset,
        subQuery: false,
      });
  
      res.status(200).json({
        total: Array.isArray(count) ? count.length : count,
        totalPages: Math.ceil((Array.isArray(count) ? count.length : count) / parseInt(limit)),
        page: parseInt(page),
        limit: parseInt(limit),
        groups,
      });
    } catch (error) {
      console.error('Error in getAllGroups:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
};