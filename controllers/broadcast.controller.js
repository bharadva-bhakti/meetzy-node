const { Broadcast, BroadcastMember, User, Block, Message } = require('../models');
const { Op } = require('sequelize');
const { getEffectiveLimits } = require('../utils/userLimits');

exports.createBroadcast = async (req, res) => {
  const creator_id = req.user.id;
  const { name, recipient_ids } = req.body;

  try {
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Broadcast name is required.' });
    }

    if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ message: 'At least one recipient is required.' });
    }

    const limits = await getEffectiveLimits(creator_id, req.user.role);
    const currentCount = await Broadcast.count({ where: { creator_id } });

    if (currentCount >= limits.max_broadcasts_list) {
      return res.status(400).json({
        message: `You can only create ${limits.max_broadcasts_list} broadcast lists.`,
      });
    }

    const validRecipients = await User.findAll({
      where: { id: { [Op.in]: recipient_ids }, status: 'active' },
      attributes: ['id']
    });

    if (validRecipients.length === 0) {
      return res.status(400).json({ message: 'No valid recipients found.' });
    }

    const validRecipientIds = validRecipients.map(u => u.id);

    const blocks = await Block.findAll({
      where: {
        [Op.or]: [
          { blocker_id: creator_id, blocked_id: { [Op.in]: validRecipientIds } },
          { blocker_id: { [Op.in]: validRecipientIds }, blocked_id: creator_id }
        ]
      }
    });

    const blockedUserIds = new Set();
    blocks.forEach(block => {
      const blockedId = block.blocker_id === creator_id ? block.blocked_id : block.blocker_id;
      blockedUserIds.add(blockedId);
    });

    const finalRecipientIds = validRecipientIds.filter(id => !blockedUserIds.has(id));

    if (finalRecipientIds.length === 0) {
      return res.status(400).json({ message: 'All recipients are blocked or invalid.' });
    }

    const broadcast = await Broadcast.create({ creator_id, name: name.trim(),});

    const recipientRecords = finalRecipientIds.map(recipient_id => ({
      broadcast_id: broadcast.id,
      recipient_id
    }));

    await BroadcastMember.bulkCreate(recipientRecords);

    await Message.create({
      sender_id: creator_id,
      recipient_id: null,
      group_id: null,
      content: `You created broadcast ${name} with ${finalRecipientIds.length} recipient(s)`,
      message_type: 'system',
      metadata: {
        system_action: 'broadcast_created',
        is_broadcast: true,
        broadcast_id: broadcast.id,
        broadcast_name: name,
        recipient_count: finalRecipientIds.length,
        visible_to: creator_id
      }
    });

    const fullBroadcast = await Broadcast.findByPk(broadcast.id, {
      include: [{
        model: BroadcastMember,
        as: 'recipients',
        include: [{ model: User, as: 'recipient', attributes: ['id', 'name', 'avatar']}]
      }]
    });

    const io = req.app.get('io');
    io.to(`user_${creator_id}`).emit('broadcast-created', { broadcast: fullBroadcast });

    return res.status(201).json({
      message: 'Broadcast list created successfully.',
      broadcast: {
        id: fullBroadcast.id,
        name: fullBroadcast.name,
        recipient_count: fullBroadcast.recipients.length,
        recipients: fullBroadcast.recipients.map(r => r.recipient),
        created_at: fullBroadcast.created_at
      }
    });
  } catch (error) {
    console.error('Error in createBroadcast:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getMyBroadcasts = async (req, res) => {
  const creator_id = req.user.id;
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const { rows: broadcasts, count: total } = await Broadcast.findAndCountAll({
      where: { creator_id},
      include: [{
        model: BroadcastMember,
        as: 'recipients',
        include: [{ model: User, as: 'recipient', attributes: ['id', 'name', 'avatar']}]
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const formattedBroadcasts = broadcasts.map(broadcast => ({
      id: broadcast.id,
      name: broadcast.name,
      recipient_count: broadcast.recipients.length,
      recipients: broadcast.recipients.map(r => r.recipient),
      created_at: broadcast.created_at,
      updated_at: broadcast.updated_at
    }));

    return res.json({
      message: 'Broadcasts fetched successfully.',
      data: formattedBroadcasts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page < Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in getMyBroadcasts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateBroadcast = async (req, res) => {
  const creator_id = req.user.id;
  const { broadcast_id } = req.params;
  const { name } = req.body;

  try {
    const broadcast = await Broadcast.findOne({ where: { id: broadcast_id, creator_id }});
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    const oldName = broadcast.name;
    const updateData = {};
    if (name) updateData.name = name.trim();

    await broadcast.update(updateData);

    if (name && name !== oldName) {
      await Message.create({
        sender_id: creator_id,
        recipient_id: null,
        group_id: null,
        content: `You renamed broadcast from ${oldName} to ${name}`,
        message_type: 'system',
        metadata: {
          system_action: 'broadcast_updated',
          broadcast_id: broadcast.id,
          old_name: oldName,
          new_name: name,
          visible_to: creator_id
        }
      });

      const io = req.app.get('io');
      io.to(`user_${creator_id}`).emit('broadcast-updated', {
        broadcast_id: broadcast.id,
        name: name
      });
    }

    return res.json({ message: 'Broadcast list updated successfully.', broadcast });
  } catch (error) {
    console.error('Error in updateBroadcast:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteBroadcast = async (req, res) => {
  const creator_id = req.user.id;
  const { broadcast_id } = req.params;

  try {
    const broadcast = await Broadcast.findOne({ where: { id: broadcast_id, creator_id }});
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    await broadcast.destroy();

    const io = req.app.get('io');
    io.to(`user_${creator_id}`).emit('broadcast-deleted', {
      broadcast_id: broadcast.id
    });

    return res.json({ message: 'Broadcast list deleted successfully.'});
  } catch (error) {
    console.error('Error in deleteBroadcast:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.addRecipients = async (req, res) => {
  const creator_id = req.user.id;
  const { broadcast_id } = req.params;
  const { recipient_ids } = req.body;

  try {
    if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ message: 'Recipient IDs are required.' });
    }

    const broadcast = await Broadcast.findOne({ where: { id: broadcast_id, creator_id }});
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    const limits = await getEffectiveLimits(creator_id, req.user.role);
    
    const currentRecipientCount = await BroadcastMember.count({ where: { broadcast_id }});

    const existingRecipients = await BroadcastMember.findAll({
      where: { broadcast_id }, attributes: ['recipient_id']
    });

    const existingIds = new Set(existingRecipients.map(r => r.recipient_id));
    const newRecipientIds = recipient_ids.filter(id => !existingIds.has(id));

    if (newRecipientIds.length === 0) {
      return res.status(400).json({ message: 'All recipients are already in the list.' });
    }

    if (currentRecipientCount + newRecipientIds.length > limits.max_members_per_broadcasts_list) {
      return res.status(400).json({
        message: `Broadcast list member limit exceeded. Maximum allowed: ${limits.max_members_per_broadcasts_list}`,
      });
    }

    const validRecipients = await User.findAll({
      where: { id: { [Op.in]: newRecipientIds }, status: 'active' },
      attributes: ['id', 'name']
    });

    const validIds = validRecipients.map(u => u.id);

    const blocks = await Block.findAll({
      where: {
        [Op.or]: [
          { blocker_id: creator_id, blocked_id: { [Op.in]: validIds } },
          { blocker_id: { [Op.in]: validIds }, blocked_id: creator_id }
        ]
      }
    });

    const blockedUserIds = new Set();
    blocks.forEach(block => {
      const blockedId = block.blocker_id === creator_id ? block.blocked_id : block.blocker_id;
      blockedUserIds.add(blockedId);
    });

    const finalRecipientIds = validIds.filter(id => !blockedUserIds.has(id));

    if (finalRecipientIds.length === 0) {
      return res.status(400).json({ message: 'No valid recipients to add.' });
    }

    const newTotal = currentRecipientCount + finalRecipientIds.length;
    if (newTotal > limits.max_members_per_broadcasts_list) {
      return res.status(400).json({
        message: `Cannot add recipients: would exceed limit of ${limits.max_members_per_broadcasts_list} members per broadcast list.`,
      });
    }

    const recipientRecords = finalRecipientIds.map(recipient_id => ({
      broadcast_id, recipient_id
    }));

    await BroadcastMember.bulkCreate(recipientRecords);

    const addedUsers = validRecipients.filter(u => finalRecipientIds.includes(u.id));
    const addedNames = addedUsers.map(u => u.name).join(', ');

    await Message.create({
      sender_id: creator_id,
      recipient_id: null,
      group_id: null,
      content: `You added ${finalRecipientIds.length} recipient(s) to broadcast ${broadcast.name}`,
      message_type: 'system',
      metadata: {
        system_action: 'broadcast_recipients_added',
        broadcast_id: broadcast.id,
        broadcast_name: broadcast.name,
        added_count: finalRecipientIds.length,
        added_users: addedNames,
        visible_to: creator_id,
        is_broadcast: true
      }
    });

    const updatedBroadcast = await Broadcast.findByPk(broadcast.id, {
      include: [{
        model: BroadcastMember,
        as: 'recipients',
        include: [{ model: User, as: 'recipient', attributes: ['id', 'name', 'avatar']}]
      }]
    });

    const io = req.app.get('io');
    io.to(`user_${creator_id}`).emit('broadcast-recipients-added', {
      broadcast_id: broadcast.id,
      added_count: finalRecipientIds.length,
      recipients: updatedBroadcast.recipients.map(r => r.recipient)
    });

    return res.json({
      message: `${finalRecipientIds.length} recipient(s) added successfully.`,
      added_count: finalRecipientIds.length
    });
  } catch (error) {
    console.error('Error in addRecipients:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.removeRecipients = async (req, res) => {
  const creator_id = req.user.id;
  const { broadcast_id } = req.params;
  const { recipient_ids } = req.body;

  try {
    if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ message: 'Recipient IDs are required.' });
    }

    const broadcast = await Broadcast.findOne({ where: { id: broadcast_id, creator_id }});
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    const removedUsers = await User.findAll({
      where: { id: { [Op.in]: recipient_ids } },
      attributes: ['id', 'name']
    });

    const deletedCount = await BroadcastMember.destroy({
      where: { broadcast_id, recipient_id: { [Op.in]: recipient_ids }}
    });

    if (deletedCount > 0) {
      const removedNames = removedUsers.map(u => u.name).join(', ');

      // Create system message for removing recipients
      await Message.create({
        sender_id: creator_id,
        recipient_id: null,
        group_id: null,
        content: `You removed ${deletedCount} recipient(s) from broadcast ${broadcast.name}`,
        message_type: 'system',
        metadata: {
          system_action: 'broadcast_recipients_removed',
          broadcast_id: broadcast.id,
          broadcast_name: broadcast.name,
          removed_count: deletedCount,
          removed_users: removedNames,
          visible_to: creator_id,
          is_broadcast: true
        }
      });

      const updatedBroadcast = await Broadcast.findByPk(broadcast.id, {
        include: [{
          model: BroadcastMember,
          as: 'recipients',
          include: [{ model: User, as: 'recipient', attributes: ['id', 'name', 'avatar']}]
        }]
      });

      const io = req.app.get('io');
      io.to(`user_${creator_id}`).emit('broadcast-recipients-removed', {
        broadcast_id: broadcast.id,
        removed_count: deletedCount,
        recipients: updatedBroadcast.recipients.map(r => r.recipient)
      });
    }

    return res.json({
      message: `${deletedCount} recipient(s) removed successfully.`,
      removed_count: deletedCount
    });
  } catch (error) {
    console.error('Error in removeRecipients:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};