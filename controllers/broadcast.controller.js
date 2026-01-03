const { db } = require('../models');
const Broadcast = db.Broadcast;
const BroadcastMember = db.BroadcastMember;
const User = db.User;
const Block = db.Block;
const Message = db.Message;
const mongoose = require('mongoose');
const { getEffectiveLimits } = require('../utils/userLimits');

const fetchBroadcastWithRecipients = async (broadcastId) => {
  const result = await Broadcast.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(broadcastId) } },
    { $lookup: { from: 'broadcast_members', localField: '_id', foreignField: 'broadcast_id', as: 'recipients'},},
    { $lookup: { from: User.collection.name, localField: 'recipients.recipient_id', foreignField: '_id', as: 'recipientUsers',},},
    {
      $addFields: {
        recipients: {
          $map: {
            input: '$recipients',
            as: 'member',
            in: {
              $let: {
                vars: {
                  matchedUser: {
                    $arrayElemAt: [
                      { $filter: { input: '$recipientUsers', as: 'u', cond: { $eq: ['$$u._id', '$$member.recipient_id'] }}},
                      0,
                    ],
                  },
                },
                in: { id: '$$matchedUser._id', name: '$$matchedUser.name', avatar: '$$matchedUser.avatar' },
              },
            },
          },
        },
      },
    },
    { $project: { id: '$_id', _id: 0, name: 1, created_at: 1, updated_at: 1, recipients: 1, }},
  ]);

  return result[0] || null;
};

exports.createBroadcast = async (req, res) => {
  const creator_id = req.user._id;
  const { name, recipient_ids } = req.body;

  try {
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Broadcast name is required.' });
    }

    if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ message: 'At least one recipient is required.' });
    }

    const limits = await getEffectiveLimits(creator_id, req.user.role);
    const currentCount = await Broadcast.countDocuments({ creator_id });

    if (currentCount >= limits.max_broadcasts_list) {
      return res.status(400).json({
        message: `You can only create ${limits.max_broadcasts_list} broadcast lists.`,
      });
    }

    const recipientObjectIds = recipient_ids.map(id => new mongoose.Types.ObjectId(id));

    const validRecipients = await User.find({ _id: { $in: recipientObjectIds }, status: 'active'}).select('_id').lean();
    if (validRecipients.length === 0) {
      return res.status(400).json({ message: 'No valid recipients found.' });
    }

    const validRecipientIds = validRecipients.map(u => u._id);

    const blocks = await Block.find({
      $or: [
        { blocker_id: creator_id, blocked_id: { $in: validRecipientIds } },
        { blocker_id: { $in: validRecipientIds }, blocked_id: creator_id },
      ],
    }).lean();

    const blockedUserIds = new Set();
    blocks.forEach(block => {
      const blockedId = block.blocker_id.toString() === creator_id.toString()
        ? block.blocked_id
        : block.blocker_id;
      blockedUserIds.add(blockedId.toString());
    });

    const finalRecipientIds = validRecipientIds.filter(id => !blockedUserIds.has(id.toString()));

    if (finalRecipientIds.length === 0) {
      return res.status(400).json({ message: 'All recipients are blocked or invalid.' });
    }

    const broadcast = await Broadcast.create({ creator_id, name: name.trim() });

    const recipientRecords = finalRecipientIds.map(recipient_id => ({
      broadcast_id: broadcast._id,
      recipient_id,
    }));

    await BroadcastMember.insertMany(recipientRecords);

    await Message.create({
      sender_id: creator_id,
      recipient_id: null,
      group_id: null,
      content: `You created broadcast ${name} with ${finalRecipientIds.length} recipient(s)`,
      message_type: 'system',
      metadata: {
        system_action: 'broadcast_created',
        is_broadcast: true,
        broadcast_id: broadcast._id,
        broadcast_name: name,
        recipient_count: finalRecipientIds.length,
        visible_to: creator_id,
      },
    });

    const fullBroadcast = await fetchBroadcastWithRecipients(broadcast._id);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${creator_id}`).emit('broadcast-created', { broadcast: fullBroadcast });
    }

    return res.status(201).json({
      message: 'Broadcast list created successfully.',
      broadcast: {
        id: fullBroadcast.id,
        name: fullBroadcast.name,
        recipient_count: fullBroadcast.recipients.length,
        recipients: fullBroadcast.recipients,
        created_at: fullBroadcast.created_at,
      },
    });
  } catch (error) {
    console.error('Error in createBroadcast:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getMyBroadcasts = async (req, res) => {
  const creator_id = req.user._id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  try {
    const [total, broadcasts] = await Promise.all([
      Broadcast.countDocuments({ creator_id }),
      Broadcast.aggregate([
        { $match: { creator_id } },
        { $sort: { created_at: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $lookup: { from: 'broadcast_members', localField: '_id', foreignField: 'broadcast_id', as: 'recipients' } },
        { $lookup: {from: User.collection.name,localField: 'recipients.recipient_id',foreignField: '_id',as: 'recipientUsers',}},
        {
          $addFields: {
            recipients: {
              $map: {
                input: '$recipients',
                as: 'member',
                in: {
                  $let: {
                    vars: {
                      matchedUser: {
                        $arrayElemAt: [
                          { $filter: {input: '$recipientUsers',as: 'u',cond: { $eq: ['$$u._id', '$$member.recipient_id'] }}},
                          0,
                        ],
                      },
                    },
                    in: {
                      id: '$$matchedUser._id',
                      name: '$$matchedUser.name',
                      avatar: '$$matchedUser.avatar',
                    },
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
            created_at: 1,
            updated_at: 1,
            recipients: 1,
          },
        },
      ]),
    ]);

    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    return res.json({
      message: 'Broadcasts fetched successfully.',
      data: broadcasts,
      pagination: { page, limit, total, totalPages, hasMore },
    });
  } catch (error) {
    console.error('Error in getMyBroadcasts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateBroadcast = async (req, res) => {
  const creator_id = req.user._id;
  const { broadcast_id } = req.params;
  const { name } = req.body;

  try {
    const broadcast = await Broadcast.findOne({ _id: broadcast_id, creator_id });
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    const oldName = broadcast.name;
    if (name && name.trim() !== oldName) {
      broadcast.name = name.trim();
      await broadcast.save();

      await Message.create({
        sender_id: creator_id,
        recipient_id: null,
        group_id: null,
        content: `You renamed broadcast from ${oldName} to ${name}`,
        message_type: 'system',
        metadata: {
          system_action: 'broadcast_updated',
          broadcast_id: broadcast._id,
          old_name: oldName,
          new_name: name,
          visible_to: creator_id,
        },
      });

      const io = req.app.get('io');
      if (io) {
        io.to(`user_${creator_id}`).emit('broadcast-updated', {
          broadcast_id: broadcast._id,
          name: name,
        });
      }
    }

    return res.json({ message: 'Broadcast list updated successfully.', broadcast });
  } catch (error) {
    console.error('Error in updateBroadcast:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteBroadcast = async (req, res) => {
  const creator_id = req.user._id;
  const { broadcast_id } = req.params;

  try {
    const broadcast = await Broadcast.findOne({ _id: broadcast_id, creator_id });
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    await BroadcastMember.deleteMany({ broadcast_id: broadcast._id });
    await Broadcast.deleteOne({ _id: broadcast_id });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${creator_id}`).emit('broadcast-deleted', {
        broadcast_id: broadcast._id,
      });
    }

    return res.json({ message: 'Broadcast list deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteBroadcast:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.addRecipients = async (req, res) => {
  const creator_id = req.user._id;
  const { broadcast_id } = req.params;
  const { recipient_ids } = req.body;

  try {
    if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ message: 'Recipient IDs are required.' });
    }

    const broadcast = await Broadcast.findOne({ _id: broadcast_id, creator_id });
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    const limits = await getEffectiveLimits(creator_id, req.user.role);
    const currentRecipientCount = await BroadcastMember.countDocuments({ broadcast_id });

    const existingMembers = await BroadcastMember.find({ broadcast_id }).select('recipient_id').lean();
    const existingIds = new Set(existingMembers.map(m => m.recipient_id.toString()));

    const newRecipientIds = recipient_ids.filter(id => !existingIds.has(id.toString()));

    if (newRecipientIds.length === 0) {
      return res.status(400).json({ message: 'All recipients are already in the list.' });
    }

    if (currentRecipientCount + newRecipientIds.length > limits.max_members_per_broadcasts_list) {
      return res.status(400).json({
        message: `Broadcast list member limit exceeded. Maximum allowed: ${limits.max_members_per_broadcasts_list}`,
      });
    }

    const recipientObjectIds = newRecipientIds.map(id => new mongoose.Types.ObjectId(id));

    const validRecipients = await User.find({ _id: { $in: recipientObjectIds }, status: 'active', }).select('_id name').lean();
    const validIds = validRecipients.map(u => u._id);

    const blocks = await Block.find({
      $or: [
        { blocker_id: creator_id, blocked_id: { $in: validIds } },
        { blocker_id: { $in: validIds }, blocked_id: creator_id },
      ],
    }).lean();

    const blockedUserIds = new Set();
    blocks.forEach(block => {
      const blockedId = block.blocker_id.toString() === creator_id.toString()
        ? block.blocked_id
        : block.blocker_id;
      blockedUserIds.add(blockedId.toString());
    });

    const finalRecipientIds = validIds.filter(id => !blockedUserIds.has(id.toString()));
    if (finalRecipientIds.length === 0) {
      return res.status(400).json({ message: 'No valid recipients to add.' });
    }

    const recipientRecords = finalRecipientIds.map(recipient_id => ({
      broadcast_id: broadcast._id,
      recipient_id,
    }));

    await BroadcastMember.insertMany(recipientRecords);

    const addedUsers = validRecipients.filter(u => finalRecipientIds.includes(u._id));
    const addedNames = addedUsers.map(u => u.name).join(', ');

    await Message.create({
      sender_id: creator_id,
      recipient_id: null,
      group_id: null,
      content: `You added ${finalRecipientIds.length} recipient(s) to broadcast ${broadcast.name}`,
      message_type: 'system',
      metadata: {
        system_action: 'broadcast_recipients_added',
        broadcast_id: broadcast._id,
        broadcast_name: broadcast.name,
        added_count: finalRecipientIds.length,
        added_users: addedNames,
        visible_to: creator_id,
        is_broadcast: true,
      },
    });

    const updatedBroadcast = await fetchBroadcastWithRecipients(broadcast._id);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${creator_id}`).emit('broadcast-recipients-added', {
        broadcast_id: broadcast._id,
        added_count: finalRecipientIds.length,
        recipients: updatedBroadcast.recipients,
      });
    }

    return res.json({
      message: `${finalRecipientIds.length} recipient(s) added successfully.`,
      added_count: finalRecipientIds.length,
    });
  } catch (error) {
    console.error('Error in addRecipients:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.removeRecipients = async (req, res) => {
  const creator_id = req.user._id;
  const { broadcast_id } = req.params;
  const { recipient_ids } = req.body;

  try {
    if (!recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return res.status(400).json({ message: 'Recipient IDs are required.' });
    }

    const broadcast = await Broadcast.findOne({ _id: broadcast_id, creator_id });
    if (!broadcast) {
      return res.status(404).json({ message: 'Broadcast list not found.' });
    }

    const recipientObjectIds = recipient_ids.map(id => new mongoose.Types.ObjectId(id));
    const removedUsers = await User.find({ _id: { $in: recipientObjectIds }}).select('_id name').lean();

    const { deletedCount } = await BroadcastMember.deleteMany({
      broadcast_id: broadcast._id,
      recipient_id: { $in: recipientObjectIds },
    });

    if (deletedCount > 0) {
      const removedNames = removedUsers.map(u => u.name).join(', ');

      await Message.create({
        sender_id: creator_id,
        recipient_id: null,
        group_id: null,
        content: `You removed ${deletedCount} recipient(s) from broadcast ${broadcast.name}`,
        message_type: 'system',
        metadata: {
          system_action: 'broadcast_recipients_removed',
          broadcast_id: broadcast._id,
          broadcast_name: broadcast.name,
          removed_count: deletedCount,
          removed_users: removedNames,
          visible_to: creator_id,
          is_broadcast: true,
        },
      });

      const updatedBroadcast = await fetchBroadcastWithRecipients(broadcast._id);

      const io = req.app.get('io');
      if (io) {
        io.to(`user_${creator_id}`).emit('broadcast-recipients-removed', {
          broadcast_id: broadcast._id,
          removed_count: deletedCount,
          recipients: updatedBroadcast.recipients,
        });
      }
    }

    return res.json({
      message: `${deletedCount} recipient(s) removed successfully.`,
      removed_count: deletedCount,
    });
  } catch (error) {
    console.error('Error in removeRecipients:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};