const { db } = require('../models');
const Message = db.Message;
const Announcement = db.Announcement;
const User = db.User;
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

exports.sendAnnouncement = async (req, res) => {
  const adminId = req.user._id;
  let { content, title, announcement_type, action_link, redirect_url } = req.body;
  let fileUrl = null;
  let fileType = null;

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(400).json({ message: 'Only admin can send announcements' });
    }

    const io = req.app.get('io');

    if (req.file) {
      fileUrl = req.file.path;
      fileType = req.file.mimetype;
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'content is required for text messages' });
    }

    if (announcement_type === 'learn_more' && !action_link) {
      return res.status(400).json({ message: 'action_link is required for learn_more announcements' });
    }

    if (announcement_type === 'get_started' && !redirect_url) {
      return res.status(400).json({ message: 'redirect_url is required for get_started announcements' });
    }

    const message = await Message.create({
      sender_id: adminId,
      recipient_id: null,
      group_id: null,
      content: content.trim(),
      message_type: 'announcement',
      file_url: fileUrl,
      file_type: fileType,
      metadata: {
        sent_by_admin: adminId,
        announcement_type,
        title,
        action_link,
        redirect_url,
      },
      is_encrypted: false,
    });

    const announcement = await Announcement.create({
      message_id: message._id,
      title: title || null,
      announcement_type,
      action_link: ['get_started', 'learn_more'].includes(announcement_type) ? action_link : null,
      redirect_url: redirect_url || null,
    });

    const fullMessageResult = await Message.aggregate([
      { $match: { _id: message._id } },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender',}},
      { $unwind: '$sender' },
      {
        $project: {
          id: '$_id',
          _id: 0,
          sender_id: 1,
          content: 1,
          message_type: 1,
          file_url: 1,
          file_type: 1,
          metadata: 1,
          created_at: 1,
          updated_at: 1,
          sender: {id: '$sender._id',name: '$sender.name',avatar: '$sender.avatar',},
        },
      },
    ]);

    const fullMessage = fullMessageResult[0];

    const users = await User.find().select('id').lean({ virtuals: true });
    users.forEach(user => {
      io.to(`user_${user.id}`).emit('receive-message', fullMessage);
    });

    const announcementData = {
      id: announcement.id,
      content: message.content,
      title: announcement.title,
      announcement_type: announcement.announcement_type,
      action_link: announcement.action_link,
      redirect_url: announcement.redirect_url,
      file_url: message.file_url,
      file_type: message.file_type,
      created_at: message.created_at,
    };

    return res.status(200).json({
      message: 'Announcement sent successfully',
      data: announcementData,
    });
  } catch (error) {
    console.error('Error in sendAnnouncement:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.editAnnouncement = async (req, res) => {
  const adminId = req.user._id;
  const announcementId = req.params.id;
  const { content, title, announcement_type, action_link, redirect_url } = req.body;

  let fileUrl = null;
  let fileType = null;

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can edit announcements' });
    }

    if (req.file) {
      fileUrl = req.file.path;
      fileType = req.file.mimetype;
    }

    if (announcement_type === 'learn_more' && !action_link) {
      return res.status(400).json({ message: 'action_link is required for learn_more announcements' });
    }

    const announcementResult = await Announcement.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(announcementId) } },
      { $lookup: { from: 'messages', localField: 'message_id', foreignField: '_id', as: 'message',}},
      { $unwind: '$message' },
      { $match: { 'message.sender_id': adminId } },
      {
        $project: {
          _id: 1,
          message_id: '$message._id',
          title: 1,
          announcement_type: 1,
          action_link: 1,
          redirect_url: 1,
          message: { content: 1, file_url: 1, file_type: 1, metadata: 1, },
        },
      },
    ]);

    const announcementData = announcementResult[0];

    if (!announcementData) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    const messageUpdate = {
      content: content ?? announcementData.message.content,
      metadata: {
        ...announcementData.message.metadata,
        title,
        announcement_type,
        action_link,
        redirect_url,
      },
    };

    if (fileUrl) {
      messageUpdate.file_url = fileUrl;
      messageUpdate.file_type = fileType;
    }

    await Message.updateOne( { _id: announcementData.message_id }, { $set: messageUpdate });
    await Announcement.updateOne(
      { _id: announcementId },
      {
        $set: {
          title: title ?? announcementData.title,
          announcement_type: announcement_type ?? announcementData.announcement_type,
          action_link: action_link ?? announcementData.action_link,
          redirect_url: redirect_url ?? announcementData.redirect_url,
        },
      }
    );

    const fullMessageResult = await Message.aggregate([
      { $match: { _id: announcementData.message_id } },
      { $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender',}},
      { $unwind: '$sender' },
      {
        $project: {
          id: '$_id',
          _id: 0,
          content: 1,
          message_type: 1,
          file_url: 1,
          file_type: 1,
          metadata: 1,
          created_at: 1,
          updated_at: 1,
          sender: { id: '$sender._id', name: '$sender.name', avatar: '$sender.avatar',},
        },
      },
    ]);

    const fullMessage = fullMessageResult[0];

    const users = await User.find().select('id').lean({ virtuals: true });

    const io = req.app.get('io');
    if (io) {
      users.forEach(user => {
        io.to(`user_${user.id}`).emit('message-updated', fullMessage);
      });
    }

    return res.status(200).json({
      message: 'Announcement updated successfully',
      data: {
        id: fullMessage.id,
        content: fullMessage.content,
        title: title ?? announcementData.title,
        announcement_type: announcement_type ?? announcementData.announcement_type,
        action_link: action_link ?? announcementData.action_link,
        redirect_url: redirect_url ?? announcementData.redirect_url,
        file_url: fullMessage.file_url,
        file_type: fullMessage.file_type,
        created_at: fullMessage.created_at,
        updated_at: fullMessage.updated_at,
      },
    });
  } catch (error) {
    console.error('Error editing announcement:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  const adminId = req.user._id;
  const { announcement_ids } = req.body;

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can delete announcements' });
    }

    if (!announcement_ids || !Array.isArray(announcement_ids) || announcement_ids.length === 0) {
      return res.status(400).json({ message: 'Announcement IDs array is required' });
    }

    const objectIds = announcement_ids.map(id => new mongoose.Types.ObjectId(id));

    const announcementsResult = await Announcement.aggregate([
      { $match: { _id: { $in: objectIds } } },
      { $lookup: { from: 'messages', localField: 'message_id', foreignField: '_id', as: 'message'}},
      { $unwind: '$message' },
      { $match: { 'message.sender_id': adminId } },
      { $project: { id: '$_id', _id: 0, announcement_id: '$_id', message_id: '$message._id'}},
    ]);

    if (announcementsResult.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    const foundIds = announcementsResult.map(a => a.id.toString());
    const messageIds = announcementsResult.map(a => a.message_id);
    const notFoundIds = announcement_ids.filter(id => !foundIds.includes(id));

    await Announcement.deleteMany({ _id: { $in: announcementsResult.map(a => a.announcement_id) } });
    await Message.deleteMany({ _id: { $in: messageIds } });

    const io = req.app.get('io');
    const users = await User.find().select('id').lean({ virtuals: true });

    users.forEach(user => {
      io.to(`user_${user.id}`).emit('announcement:delete', {
        id: messageIds.map(id => id.toString()), deleted_at: new Date(),
      });
    });

    const response = {
      message: `${foundIds.length} announcement(s) deleted successfully`,
      deletedCount: foundIds.length,
      deletedIds: foundIds,
    };

    if (notFoundIds.length > 0) {
      response.notFound = notFoundIds;
      response.message += `, ${notFoundIds.length} announcement(s) not found`;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error deleting announcement:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getAnnouncements = async (req, res) => {
  const adminId = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const type = req.query.type;
  const search = req.query.search?.trim();

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can view announcements' });
    }

    const pipeline = [
      { $lookup: { from: 'messages', localField: 'message_id', foreignField: '_id', as: 'message'}},
      { $unwind: { path: '$message', preserveNullAndEmptyArrays: false } },
      { $match: { 'message.sender_id': adminId, 'message.recipient_id': null, 'message.group_id': null}},
    ];

    if (type) pipeline.push({ $match: { announcement_type: type } });

    if (search && search.length >= 2) {
      pipeline.push({
        $match: {
          $or: [
            { 'message.content': { $regex: search, $options: 'i' } },
            { title: { $regex: search, $options: 'i' } },
          ],
        },
      });
    }

    pipeline.push(
      { $sort: { created_at: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          id: '$_id',
          _id: 0,
          message_id: '$message._id',
          content: '$message.content',
          title: 1,
          announcement_type: 1,
          action_link: 1,
          is_highlighted: 1,
          file_url: '$message.file_url',
          file_type: '$message.file_type',
          created_at: 1,
          expires_at: 1,
          metadata: '$message.metadata',
        },
      }
    );

    const countPipeline = pipeline.slice(0, -4);
    countPipeline.push({ $count: 'total' });

    const [announcements, countResult] = await Promise.all([
      Announcement.aggregate(pipeline),
      Announcement.aggregate(countPipeline),
    ]);

    const total = countResult[0]?.total || 0;

    return res.status(200).json({
      message: 'Announcements fetched',
      total,
      page,
      limit,
      announcements,
    });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};