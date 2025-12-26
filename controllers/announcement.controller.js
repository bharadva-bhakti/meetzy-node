const { Op } = require('sequelize');
const { User, Message, sequelize, Announcement, Group, UserDelete, ChatClear } = require('../models');

exports.sendAnnouncement = async (req, res) => {
  const adminId = req.user.id;
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

      if (fileType.startsWith('image/')) message_type = 'image';
      else if (fileType.startsWith('video/')) message_type = 'video';
      else if (fileType.startsWith('audio/')) message_type = 'audio';
      else message_type = 'document';
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

    const transaction = await sequelize.transaction();

    try {
      const message = await Message.create({
        sender_id: adminId,
        recipient_id: null,
        group_id: null,
        content,
        message_type: 'announcement',
        file_url: fileUrl,
        file_type: fileType,
        metadata: { 
          sent_by_admin: adminId,
          announcement_type: announcement_type,
          title: title,
          action_link: action_link,
          redirect_url: redirect_url
        },
        is_encrypted: false
      }, { transaction });

      const announcement = await Announcement.create({
        message_id: message.id,
        title: title || null,
        announcement_type,
        action_link: ['get_started', 'learn_more'].includes(announcement_type) ? action_link : null,
        redirect_url: redirect_url ? redirect_url : null
      }, { transaction });

      await transaction.commit();

      await UserDelete.destroy({
        where: {
          target_type: 'user',
          target_id: adminId,
          delete_type: 'hide_chat'
        }
      });

      const users = await User.findAll({ attributes: ['id'], raw: true });
      
      const announcementData = {
        id: message.id,
        content: message.content,
        title: announcement.title,
        announcement_type: announcement.announcement_type,
        action_link: announcement.action_link,
        redirect_url: announcement.redirect_url,
        file_url: message.file_url,
        file_type: message.file_type,
        created_at: message.created_at,
      };

      const fullMessage = await Message.findByPk(message.id, {
        include: [
          { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
          { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'], required: false },
          { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'], required: false },
        ],
      });

      users.forEach(user => {
        io.to(`user_${user.id}`).emit('receive-message', fullMessage);
      });

      return res.status(200).json({ message: 'Announcement sent successfully', data: announcementData});

    } catch (error) {
      throw error;
    }

  } catch (error) {
    console.error('Error in sendAnnouncement:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.editAnnouncement = async (req, res) => {
  const adminId = req.user.id;
  const announcementId = req.params.id;
  const { content, title, announcement_type, action_link, redirect_url } = req.body;

  let fileUrl = null;
  let fileType = null;

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can edit announcements' });
    }

    const announcement = await Announcement.findOne({
      where: { id: announcementId },
      include: [{ model: Message, as: 'message', where: { sender_id: adminId }, required: true }]
    });

    if (!announcement) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    if (announcement_type === 'learn_more' && !action_link) {
      return res.status(400).json({ message: 'action_link is required for learn_more announcements' });
    }

    if (req.file) {
      fileUrl = req.file.path;
      fileType = req.file.mimetype;
    }

    const transaction = await sequelize.transaction();

    try {
      const messageUpdateData = {
        content: content ?? announcement.message.content,
        metadata: {
          title,
          announcement_type,
          action_link,
          redirect_url
        }
      };

      if (req.file) {
        messageUpdateData.file_url = fileUrl;
        messageUpdateData.file_type = fileType;
      }

      await Message.update(messageUpdateData, {
        where: { id: announcement.message_id },
        transaction
      });

      await Announcement.update(
        {
          title: title ?? announcement.title,
          announcement_type: announcement_type ?? announcement.announcement_type,
          action_link: action_link ?? announcement.action_link,
          redirect_url: redirect_url ?? announcement.redirect_url
        },
        { where: { id: announcementId }, transaction }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    const fullMessage = await Message.findByPk(announcement.message_id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'], required: false },
        { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'], required: false }
      ]
    });

    const users = await User.findAll({ attributes: ['id'], raw: true });

    const chatClears = await ChatClear.findAll({
      where: { recipient_id: adminId },
      attributes: ['user_id', 'cleared_at'],
      raw: true
    });

    const clearedMap = new Map(
      chatClears.map(c => [c.user_id, new Date(c.cleared_at)])
    );

    const messageCreatedAt = new Date(fullMessage.created_at);
    const io = req.app.get('io');

    users.forEach(user => {
      const clearedAt = clearedMap.get(user.id);

      if (!clearedAt) {
        io.to(`user_${user.id}`).emit('message-updated', fullMessage);
        return;
      }

      if (messageCreatedAt > clearedAt) {
        io.to(`user_${user.id}`).emit('message-updated', fullMessage);
      }
    });

    return res.status(200).json({
      message: 'Announcement updated successfully',
      data: {
        id: fullMessage.id,
        content: fullMessage.content,
        title,
        announcement_type,
        action_link,
        redirect_url,
        file_url: fullMessage.file_url,
        file_type: fullMessage.file_type,
        created_at: fullMessage.created_at,
        updated_at: fullMessage.updated_at
      }
    });
  } catch (error) {
    console.error('Error editing announcement:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  const adminId = req.user.id;
  const {announcement_ids} = req.body;
  
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can delete announcements' });
    }

    if (!announcement_ids || !Array.isArray(announcement_ids) || announcement_ids.length === 0) {
      return res.status(400).json({ message: 'Announcement IDs array is required' });
    }

    const announcements = await Announcement.findAll({
      where: { id: announcement_ids },
      include: [{ model: Message, as: 'message', where: { sender_id: adminId }, required: true, attributes: ['id']}]
    });

    if (announcements.length === 0) {
      return res.status(404).json({ message: 'Announcement not found' });
    }

    const foundIds = announcements.map(a => a.id);
    const notFoundIds = announcement_ids.filter(id => !foundIds.includes(id));
    const messageIds = announcements.map(a => a.message_id);

    const transaction = await sequelize.transaction();

    try {
      await Announcement.destroy({ where: { id: foundIds }, transaction });

      await transaction.commit();

      const io = req.app.get('io');
      const users = await User.findAll({ attributes: ['id'], raw: true });
      
      users.forEach(user => {
        io.to(`user_${user.id}`).emit('announcement:delete', { id: messageIds, deleted_at: new Date()});
      });

      const response = {
        message: `${foundIds.length} announcement(s) deleted successfully`,
        deletedCount: foundIds.length,
        deletedIds: foundIds
      };
  
      if (notFoundIds.length > 0) {
        response.notFound = notFoundIds;
        response.message += `, ${notFoundIds.length} announcement(s) not found`;
      }
  
      return res.status(200).json(response);

    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error deleting announcement:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getAnnouncements = async (req, res) => {
  const adminId = req.user.id;
  const { page = 1, limit = 20, type, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only admin can view announcements' });
    }

    const announcementWhere = {};
    if (type) announcementWhere.announcement_type = type;

    const messageWhere = { sender_id: adminId, recipient_id: null, group_id: null };

    if (search && search.trim().length >= 2) {
      const searchTerm = search.trim();

      messageWhere[Op.or] = [
        { content: { [Op.like]: `%${searchTerm}%` } },
        { '$Announcement.title$': { [Op.like]: `%${searchTerm}%` } }
      ];
    }

    const { rows: announcements, count } = await Announcement.findAndCountAll({
      where: announcementWhere,
      include: [{ model: Message, as: 'message', where: messageWhere, required: true }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset,
      distinct: true
    });

    const formattedAnnouncements = announcements.map(ann => ({
      id: ann.id,
      message_id: ann.message.id,
      content: ann.message.content,
      title: ann.title,
      announcement_type: ann.announcement_type,
      action_link: ann.action_link,
      is_highlighted: ann.is_highlighted,
      file_url: ann.message.file_url,
      file_type: ann.message.file_type,
      created_at: ann.created_at,
      expires_at: ann.expires_at,
      metadata: ann.message.metadata
    }));

    return res.status(200).json({
      message: 'Announcements fetched',
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      announcements: formattedAnnouncements
    });

  } catch (error) {
    console.error('Error fetching announcements:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};