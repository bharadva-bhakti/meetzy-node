const { db } = require('../models');
const UserReport = db.UserReport;
const User = db.User;
const Group = db.Group;
const GroupMember = db.GroupMember;
const Message = db.Message;

exports.fetchReports = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const allowedSortFields = [
      'id', 'chat_type', 'reason', 'description', 'status', 'admin_notes', 'resolved_at', 'created_at', 'updated_at',
      'reporter_name', 'reported_user_name', 'group_name', 'resolver_name',
    ];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const query = search
      ? {
          $or: [
            { chat_type: { $regex: search, $options: 'i' } },
            { reason: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { status: { $regex: search, $options: 'i' } },
            { admin_notes: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const sortObj = {};
    if (['reporter_name', 'reported_user_name', 'group_name', 'resolver_name'].includes(safeSortField)) {
      sortObj[safeSortField] = sortOrder;
    } else {
      sortObj[safeSortField] = sortOrder;
    }

    const [userReports, total] = await Promise.all([
      UserReport.find(query)
        .populate('reporter_id', 'id name email avatar')
        .populate('reported_user_id', 'id name email avatar')
        .populate('group_id', 'id name description avatar')
        .populate('resolved_by', 'id name email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      UserReport.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      userReports,
    });
  } catch (error) {
    console.error('Error in fetchReports:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createUserReport = async (req, res) => {
  const { reportedUserId, groupId, reason, description, exitGroup } = req.body;
  const reporterId = req.user._id;
  const io = req.app.get('io');

  try {
    if (!reason) return res.status(400).json({ message: 'Reason is required.' });

    if (reportedUserId && groupId) {
      return res.status(400).json({ message: 'Provide either reportedUserId or groupId.' });
    }

    let chatType = reportedUserId ? 'direct' : groupId ? 'group' : null;
    if (!chatType) return res.status(400).json({ message: 'Either reportedUserId or groupId must be provided' });

    if (reason.toLowerCase() === 'other' && (!description || description.trim().length < 10)) {
      return res.status(400).json({ message: 'Provide a detailed description for Other reason.' });
    }

    let targetId, target;
    if (chatType === 'direct') {
      if (reportedUserId.toString() === reporterId.toString()) {
        return res.status(400).json({ message: 'You cannot report yourself.' });
      }
      targetId = reportedUserId;
      target = await User.findById(targetId);
      if (!target) return res.status(404).json({ message: 'Reported user not found' });
    } else {
      targetId = groupId;
      target = await Group.findById(targetId).select('id name avatar description');
      if (!target) return res.status(404).json({ message: 'Group not found' });

      const member = await GroupMember.findOne({ group_id: groupId, user_id: reporterId });
      if (!member) return res.status(403).json({ message: 'You are not a member of this group.' });
    }

    const report = await UserReport.create({
      reporter_id: reporterId,
      reported_user_id: chatType === 'direct' ? targetId : null,
      group_id: chatType === 'group' ? targetId : null,
      chat_type: chatType,
      reason,
      description,
      exit_group: chatType === 'group' ? Boolean(exitGroup) : false,
    });

    let leftGroup = false;
    let systemMessage = null;

    if (chatType === 'group' && exitGroup === true) {
      const member = await GroupMember.findOne({ group_id: groupId, user_id: reporterId });
      if (member) {
        const wasAdmin = member.role === 'admin';
        await member.deleteOne();

        // Leave socket rooms
        const userRoom = io.sockets.adapter.rooms.get(`user_${reporterId}`);
        if (userRoom) {
          userRoom.forEach((socketId) => {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) socket.leave(`group_${groupId}`);
          });
        }

        leftGroup = true;

        systemMessage = await Message.create({
          sender_id: reporterId,
          group_id: groupId,
          message_type: 'system',
          content: `${req.user.name} left the group`,
          metadata: {
            system_action: 'member_left',
            user_id: reporterId,
            user_name: req.user.name,
            left_after_report: true,
          },
        });

        if (wasAdmin && (await GroupMember.countDocuments({ group_id: groupId })) > 0) {
          const remainingAdmins = await GroupMember.countDocuments({ group_id: groupId, role: 'admin' });
          if (remainingAdmins === 0) {
            const oldestMember = await GroupMember.findOne({ group_id: groupId }).sort({ created_at: 1 });
            if (oldestMember) {
              await oldestMember.updateOne({ role: 'admin' });
              io.to(`group_${groupId}`).emit('member-role-updated', {
                group_id: groupId,
                user_id: oldestMember.user_id,
                new_role: 'admin',
              });
            }
          }
        }

        if (systemMessage) {
          const fullMsg = await Message.findById(systemMessage._id)
            .populate('sender', 'id name avatar')
            .populate('group', 'id name avatar');
          io.to(`user_${reporterId}`).emit('receive-message', fullMsg);
        }

        io.to(`group_${groupId}`).emit('member-left-group', { groupId, userId: reporterId });
        io.to(`user_${reporterId}`).emit('group-left', { groupId, userId: reporterId });
      }
    }

    return res.json({
      message: leftGroup
        ? 'Group reported and you have left the group successfully'
        : `${chatType === 'direct' ? 'User' : 'Group'} reported successfully`,
      report,
      left_group: leftGroup,
      system_message: systemMessage,
    });
  } catch (error) {
    console.error('Error in createUserReport:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUserReport = async (req, res) => {
  const { id } = req.params;
  const { admin_notes, status } = req.body;
  const userId = req.user._id;

  try {
    const userReport = await UserReport.findById(id);
    if (!userReport) return res.status(404).json({ message: 'User report not found' });

    if (['resolved', 'dismissed', 'banned'].includes(userReport.status)) {
      return res.status(400).json({ message: `You cannot update a ${userReport.status} report` });
    }

    await userReport.updateOne({
      admin_notes,
      status,
      resolved_by: userId,
      resolved_at: new Date(),
    });

    if (status === 'banned' && userReport.reported_user_id) {
      await User.updateOne({ _id: userReport.reported_user_id }, { status: 'deactive' });
      const io = req.app.get('io');
      io.to(`user_${userReport.reported_user_id}`).emit('admin-banned-user', { status: 'deactive' });
    }

    return res.status(200).json({ message: 'User report updated successfully.' });
  } catch (error) {
    console.error('Error in updateUserReport:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteUserReport = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'User report IDs array is required' });
    }

    const result = await UserReport.deleteMany({ _id: { $in: ids } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No user reports found.' });
    }

    return res.status(200).json({
      message: `${result.deletedCount} User report(s) deleted successfully`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error in deleteUserReport:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};