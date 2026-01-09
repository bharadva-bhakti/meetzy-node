const { db } = require('../models');
const User = db.User;
const Call = db.Call;
const Group = db.Group;
const GroupMember = db.GroupMember;
const CallParticipant = db.CallParticipant;
const Setting = db.Setting;
const mongoose = require('mongoose');
const { getCallSectionCounts, groupCallsByDate, createCallMessage, processCallsForHistory, matchesSearchCriteria } = require('../helper/callHelpers');

const getFullCallData = async (callId) => {
  const objectId = callId instanceof mongoose.Types.ObjectId ? callId : new mongoose.Types.ObjectId(callId);

  return await Call.aggregate([
    { $match: { _id: objectId } },
    { $lookup: { from: 'users', localField: 'initiator_id', foreignField: '_id', as: 'initiator_doc' }},
    { $unwind: { path: '$initiator_doc', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'receiver_id', foreignField: '_id', as: 'receiver_doc' }},
    { $unwind: { path: '$receiver_doc', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' }},
    { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'callparticipants', localField: '_id', foreignField: 'call_id', as: 'participants' }},
    { $lookup: { from: 'users', localField: 'participants.user_id', foreignField: '_id', as: 'participant_users' }},
    {
      $addFields: {
        participants: {
          $map: {
            input: '$participants',
            as: 'p',
            in: {
              $mergeObjects: [
                '$$p',
                {
                  user: {
                    $arrayElemAt: [ { $filter: { input: '$participant_users', cond: { $eq: ['$$this._id', '$$p.user_id'] }}}, 0],
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        initiator: { id: '$initiator_doc._id', name: '$initiator_doc.name', avatar: '$initiator_doc.avatar' },
        receiver: {
          $cond: [
            { $ifNull: ['$receiver_doc', false] }, 
            { id: '$receiver_doc._id', name: '$receiver_doc.name', avatar: '$receiver_doc.avatar' }, null
          ],
        },
        group: {
          $cond: [
            { $ifNull: ['$group_doc', false] }, 
            { id: '$group_doc._id', name: '$group_doc.name' }, null
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        initiator_id: 1,
        receiver_id: 1,
        group_id: 1,
        call_type: 1,
        call_mode: 1,
        status: 1,
        started_at: 1,
        accepted_time: 1,
        ended_at: 1,
        duration: 1,
        created_at: 1,
        updated_at: 1,
        initiator: 1,
        receiver: 1,
        group: 1,
        participants: {
          call_id: 1,
          user_id: 1,
          status: 1,
          joined_at: 1,
          left_at: 1,
          is_muted: 1,
          is_video_enabled: 1,
          user: { id: 1, name: 1, avatar: 1 },
        },
      },
    },
  ]);
};

exports.initiateCall = async (req, res) => {
  const { callType = 'audio', chatType, chatId } = req.body;
  const initiatorId = req.user._id;
  const io = req.app.get('io');

  try {
    if (!chatType || !['direct', 'group'].includes(chatType)) {
      return res.status(400).json({ message: 'Invalid chat type (direct | group) required' });
    }
    if (!chatId) return res.status(400).json({ message: 'chatId is required' });

    const initiatorBusy = await CallParticipant.findOne({ user_id: initiatorId, status: { $in: ['joined', 'invited'] }, });

    if (initiatorBusy) {
      const activeCall = await Call.findOne({ _id: initiatorBusy.call_id, status: 'active' });
      if (activeCall) {
        io.to(`user_${initiatorId}`).emit('call-busy', { userId: initiatorId.toString() });
        return res.status(409).json({ message: 'You are already in another active call.' });
      }
    }

    let targetUserIds = [];
    if (chatType === 'direct') {
      targetUserIds = [chatId];
    } else {
      const members = await GroupMember.find({ group_id: chatId }).select('user_id').lean();
      targetUserIds = members.map((m) => m.user_id.toString()).filter((id) => id !== initiatorId.toString());
    }

    const busyUsers = await CallParticipant.find({
      user_id: { $in: targetUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
      status: { $in: ['joined', 'invited'] },
    });

    const busyCallIds = busyUsers.map((p) => p.call_id);
    const activeBusyCalls = await Call.find({ _id: { $in: busyCallIds }, status: 'active' });

    if (activeBusyCalls.length > 0) {
      const busyIds = busyUsers.map((u) => u.user_id.toString());
      console.log(`User(s) busy but we are allowing the call anyway:`, busyIds);
    }

    const setting = await Setting.findOne().select('call_timeout_seconds').lean();
    const UNANSWERED_TIMEOUT = (setting?.call_timeout_seconds || 20) * 1000;

    const call = await Call.create({
      initiator_id: initiatorId,
      receiver_id: chatType === 'direct' ? chatId : null,
      group_id: chatType === 'group' ? chatId : null,
      call_type: callType,
      call_mode: chatType,
      status: 'active',
      started_at: new Date(),
    });

    let participants = [];
    if (chatType === 'direct') {
      participants = [
        { call_id: call._id, user_id: initiatorId, status: 'joined', joined_at: new Date() },
        { call_id: call._id, user_id: chatId, status: 'invited' },
      ];
    } else {
      const members = await GroupMember.find({ group_id: chatId }).lean();
      participants = members.map((m) => ({
        call_id: call._id,
        user_id: m.user_id,
        status: m.user_id.toString() === initiatorId.toString() ? 'joined' : 'invited',
        joined_at: m.user_id.toString() === initiatorId.toString() ? new Date() : null,
      }));
    }

    await CallParticipant.insertMany(participants);

    const fullCall = await getFullCallData(call._id);
    const callData = fullCall[0];

    await createCallMessage(callData, 'initiated', req, null);

    if (chatType === 'direct') {
      io.to(`user_${chatId}`).emit('incoming-call', callData);
    } else {
      participants .filter((p) => p.user_id.toString() !== initiatorId.toString()) .forEach((p) => {
        io.to(`user_${p.user_id}`).emit('incoming-call', callData);
      });
    }

    setTimeout(async () => {
      try {
        const activeCall = await Call.findById(call._id).lean();

        if (!activeCall || activeCall.status !== 'active') return;

        const answeredParticipants = await CallParticipant.find({
          call_id: call._id,
          status: 'joined',
          user_id: { $ne: initiatorId },
        }).lean();

        if (answeredParticipants.length === 0) {
          await Call.findByIdAndUpdate(call._id, { status: 'ended', ended_at: new Date(), duration: 0, });
          await CallParticipant.updateMany({ call_id: call._id, status: 'invited' }, { status: 'missed' });

          const missedCall = await getFullCallData(call._id);

          await createCallMessage(missedCall[0], 'missed', req);

          const participantIds = participants.map((p) => p.user_id.toString());
          participantIds.forEach((uid) => {
            io.to(`user_${uid}`).emit('call-ended', { callId: call._id.toString(), reason: 'no_answer' });
          });
        }
      } catch (err) {
        console.error('Error in unanswered call timeout:', err);
      }
    }, UNANSWERED_TIMEOUT);

    res.status(201).json({ message: 'Call initiated successfully.', call: callData });
  } catch (error) {
    console.error('Error in initiateCall:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.answerCall = async (req, res) => {
  const { callId } = req.body;
  const userId = req.user.id;
  const io = req.app.get('io');

  try {
    if (!callId) return res.status(400).json({ message: 'callId is required' });

    if (!mongoose.Types.ObjectId.isValid(callId)) {
      return res.status(400).json({ message: 'Invalid callId' });
    }

    const fetchCallWithDetails = async (id) => {
      const result = await Call.aggregate([
        { $match: { _id: new mongoose.Types.ObjectId(id) } },
        {
          $lookup: {
            from: 'users',
            localField: 'initiator_id',
            foreignField: '_id',
            as: 'initiator',
            pipeline: [{ $project: { id: '$_id', _id: 0, name: 1, avatar: 1 } }]
          }
        },
        { $unwind: { path: '$initiator', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'users',
            localField: 'receiver_id',
            foreignField: '_id',
            as: 'receiver',
            pipeline: [{ $project: { id: '$_id', _id: 0, name: 1, avatar: 1 } }]
          }
        },
        { $unwind: { path: '$receiver', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'groups',
            localField: 'group_id',
            foreignField: '_id',
            as: 'group',
            pipeline: [{ $project: { id: '$_id', _id: 0, name: 1 } }]
          }
        },
        { $unwind: { path: '$group', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'call_participants', localField: '_id', foreignField: 'call_id', as: 'participants' } },
        { $unwind: { path: '$participants', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'users',
            localField: 'participants.user_id',
            foreignField: '_id',
            as: 'participants.user',
            pipeline: [{ $project: { id: '$_id', _id: 0, name: 1, avatar: 1 } }]
          }
        },
        { $unwind: { path: '$participants.user', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$_id', doc: { $first: '$$ROOT' }, participants: { $push: '$participants' }}},
        { $replaceRoot: { newRoot: { $mergeObjects: [ '$doc', { participants: '$participants' }]}}}
      ]);

      return result[0] || null;
    };

    const call = await fetchCallWithDetails(callId);
    if (!call) return res.status(404).json({ message: 'Call not found.' });

    if (call.status !== 'active') {
      return res.status(400).json({ message: 'Call has already ended' });
    }

    const participant = call.participants.find( p => p.user_id.toString() === userId );

    if (!participant) {
      return res.status(404).json({ message: 'You are not invited to this call.' });
    }

    if (participant.status === 'joined') {
      return res.status(400).json({ message: 'You have already joined this call.' });
    }

    if (participant.status === 'declined' && call.status === 'active') {
      console.log(`User ${userId} rejoining call ${callId} after declining`);
    } else if (participant.status === 'declined' && call.status !== 'active') {
      return res.status(400).json({ message: 'Call has already ended.' });
    }

      // Check if user is in another active call
    const userBusy = await CallParticipant.findOne({
      user_id: new mongoose.Types.ObjectId(userId),
      status: { $in: ['joined', 'invited'] },
      call_id: { $ne: new mongoose.Types.ObjectId(callId) }
    }).lean();

    if (userBusy) {
      const busyCall = await Call.findOne({ _id: userBusy.call_id, status: 'active' }).lean();

      if (busyCall) {
        io.to(`user_${call.initiator_id}`).emit('call-busy', { userId });
        return res.status(409).json({ message: 'You are already in another active call.' });
      }
    }

    const currentJoinedParticipants = call.participants.filter(p =>
      p.status === 'joined' && p.user_id.toString() !== call.initiator_id.toString()
    ).length;

    const isFirstAcceptance = currentJoinedParticipants === 0;

    await CallParticipant.updateOne(
      {
        call_id: new mongoose.Types.ObjectId(callId),
        user_id: new mongoose.Types.ObjectId(userId)
      },
      { $set: { status: 'joined', joined_at: new Date(), is_muted: false, is_video_enabled: call.call_type === 'video' }}
    );

    let callForMessage;

    if (isFirstAcceptance) {
      await Call.updateOne(
        { _id: new mongoose.Types.ObjectId(callId) },
        { $set: { accepted_time: new Date() } }
      );

      callForMessage = await fetchCallWithDetails(callId);
      await createCallMessage(callForMessage, 'ongoing', req, userId);
    } else {
      callForMessage = await fetchCallWithDetails(callId);
      await createCallMessage(callForMessage, 'ongoing', req, userId);
    }

    const updatedCall = callForMessage;
    const callData = updatedCall;

    const userData = {
      userId: req.user.id,
      name: req.user.name,
      avatar: req.user.avatar,
      isAudioEnabled: true,
      isVideoEnabled: call.call_type === 'video',
      socketId: null
    };

    const joinedParticipants = callData.participants.filter(p =>
      p.status === 'joined' && p.user_id.toString() !== userId
    );

    joinedParticipants.forEach(participant => {
      io.to(`user_${participant.user_id}`).emit('call-accepted', {
        callId,
        userId: req.user.id,
        user: userData
      });
    });

      // Sync participants to the joining user (exclude self + special direct call rule)
    const participantsForSync = callData.participants
      .filter(p => {
        if (p.status !== 'joined' || p.user_id.toString() === userId) return false;
        if (call.call_mode === 'direct' && userId !== call.initiator_id.toString() && p.user_id.toString() === call.initiator_id.toString()) {
          return false;
        }
        return true;
      })
      .map(participant => ({
        userId: participant.user_id.toString(),
        socketId: null,
        name: participant.user.name,
        avatar: participant.user.avatar,
        joinedAt: participant.joined_at,
        isAudioEnabled: !participant.is_muted,
        isVideoEnabled: participant.is_video_enabled,
        isScreenSharing: participant.is_screen_sharing || false,
      }));

    io.to(`user_${userId}`).emit('call-participants-sync', {
      callId,
      participants: participantsForSync
    });

    console.log(`User ${userId} accepted call ${callId} (first acceptance: ${isFirstAcceptance})`);

    res.json({ message: 'Call answered successfully', call: callData });
  } catch (error) {
      console.error('Error in answerCall:', error);
      res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.declineCall = async (req, res) => {
  const { callId } = req.body;
  const userId = req.user._id;
  const io = req.app.get('io');

  try {
    if (!callId) return res.status(400).json({ message: 'callId is required' });

    const callAggregation = await getFullCallData(callId);
    const call = callAggregation[0];
    if (!call) return res.status(404).json({ message: 'Call not found' });

    if (call.status !== 'active') {
      return res.status(400).json({ message: 'Call has already ended' });
    }

    const participant = await CallParticipant.findOne({ call_id: call.id, user_id: userId, }).lean();
    if (!participant) {
      return res.status(404).json({ message: 'You are not invited to this call' });
    }

    if (participant.status === 'joined') {
      return res.status(400).json({ message: 'You have already joined this call' });
    }

    if (participant.status === 'declined') {
      return res.status(400).json({ message: 'You have already declined this call' });
    }

    await CallParticipant.findOneAndUpdate({ call_id: call.id, user_id: userId }, { status: 'declined' });

    await createCallMessage(call, 'declined', req);

    if (call.call_mode === 'direct') {
      await Call.findByIdAndUpdate(call.id, { status: 'ended', ended_at: new Date(), duration: 0, });
      await CallParticipant.findOneAndUpdate({ call_id: call.id, user_id: call.initiator_id }, { status: 'left' });

      io.to(`user_${call.initiator_id}`).emit('call-declined', { callId: call.id.toString(), userId: userId.toString() });
      io.to(`user_${call.initiator_id}`).emit('call-ended', { callId: call.id.toString(), reason: 'declined' });
      io.to(`user_${userId}`).emit('call-ended', { callId: call.id.toString(), reason: 'declined' });
    } else {
      io.to(`user_${call.initiator_id}`).emit('call-declined', { callId: call.id.toString(), userId: userId.toString() });

      const remaining = await CallParticipant.find({
        call_id: call.id,
        status: { $in: ['invited', 'joined'] },
        user_id: { $ne: userId },
      }).lean();

      const hasActive = remaining.some((p) => p.status === 'joined' && p.user_id.toString() !== call.initiator_id.toString());
      const hasInvited = remaining.some((p) => p.status === 'invited');

      if (!hasActive && !hasInvited) {
        await Call.findByIdAndUpdate(call.id, { status: 'ended', ended_at: new Date(), duration: 0, });

        await CallParticipant.updateMany({ call_id: call.id, status: 'joined' }, { status: 'left' });
        await CallParticipant.updateMany({ call_id: call.id, status: 'invited' }, { status: 'missed' });

        call.participants.forEach((p) => {
          io.to(`user_${p.user_id}`).emit('call-ended', { callId: call.id.toString(), reason: 'no_participants' });
        });
      } else {
        const joined = call.participants.filter((p) => p.status === 'joined' && p.user_id.toString() !== userId.toString());
        joined.forEach((p) => {
          io.to(`user_${p.user_id}`).emit('participant-declined', { callId: call.id.toString(), userId: userId.toString() });
        });
      }
    }

    res.json({ message: 'Call declined successfully', call });
  } catch (error) {
    console.error('Error in declineCall:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.endCall = async (req, res) => {
  const { callId } = req.body;
  const userId = req.user._id;
  const io = req.app.get('io');

  try {
    if (!callId) return res.status(400).json({ message: 'callId is required' });

    const callAggregation = await getFullCallData(callId);
    const call = callAggregation[0];
    if (!call) return res.status(404).json({ message: 'Call not found' });

    const participant = await CallParticipant.findOne({ call_id: call.id, user_id: userId, }).lean();
    if (!participant) {
      return res.status(403).json({ message: 'You are not part of this call' });
    }

    if (call.status === 'ended') {
      return res.json({ message: 'Call already ended', callEnded: true, duration: call.duration || 0, });
    }

    await CallParticipant.findOneAndUpdate({ call_id: call.id, user_id: userId }, { status: 'left', left_at: new Date() });

    const remainingJoined = await CallParticipant.find({ call_id: call.id, status: 'joined', }).lean();
    const shouldEndCall = remainingJoined.length < 2;

    let duration = 0;
    if (shouldEndCall) {
      let endTime;
      if (call.accepted_time) {
        endTime = new Date();
        duration = Math.max(1, Math.floor((endTime - new Date(call.accepted_time)) / 1000));
      } else {
        duration = 0;
      }

      await Call.findByIdAndUpdate(call.id, { status: 'ended', ended_at: new Date(), duration, });

      await CallParticipant.updateMany({ call_id: call.id, status: 'joined' }, { status: 'left', left_at: endTime });
      await CallParticipant.updateMany({ call_id: call.id, status: 'invited' }, { status: 'missed' });

      const finalCallAggregation = await getFullCallData(callId);
      const finalCall = finalCallAggregation[0];

      await createCallMessage(finalCall, 'ended', req, userId.toString());

      const participants = await CallParticipant.find({ call_id: call.id }).select('user_id').lean();
      const participantIds = participants.map((p) => p.user_id.toString());

      participantIds.forEach((uid) => {
        io.to(`user_${uid}`).emit('call-ended', { callId: call.id.toString(), reason: 'ended', duration, });
      });
    } else {
      const leftUser = await User.findById(userId).select('id name avatar').lean();

      remainingJoined.forEach((p) => {
        if (p.user_id.toString() !== userId.toString()) {
          io.to(`user_${p.user_id}`).emit('participant-left', {
            callId: call.id.toString(),
            userId: userId.toString(),
            user: { userId: userId.toString(), name: leftUser?.name || 'Unknown', avatar: leftUser?.avatar || null, },
          });
        }
      });

      await createCallMessage(call, 'ongoing', req, userId.toString());
    }

    res.json({
      message: shouldEndCall ? 'Call ended successfully' : 'Left call successfully',
      callEnded: shouldEndCall,
      duration: duration,
    });
  } catch (error) {
    console.error('Error in endCall:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getCallHistory = async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, filter = 'all', search = '' } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const [initiated, received, participated] = await Promise.all([
      Call.find({ initiator_id: userId }).select('_id').lean(),
      Call.find({ receiver_id: userId }).select('_id').lean(),
      CallParticipant.find({ user_id: userId }).select('call_id').lean(),
    ]);

    const callIds = [
      ...initiated.map((c) => c._id),
      ...received.map((c) => c._id),
      ...participated.map((p) => p.call_id),
    ];

    const uniqueCallIds = [...new Set(callIds.map((id) => id.toString()))].map((id) => new mongoose.Types.ObjectId(id));
    if (uniqueCallIds.length === 0) {
      return res.json({
        calls: {},
        sectionCounts: { all: 0, incoming: 0, outgoing: 0, missed: 0 },
        pagination: { currentPage: parseInt(page), totalPages: 0, totalCalls: 0, hasNext: false, hasPrev: false },
      });
    }

    let filteredCallIds = uniqueCallIds;
    if (filter === 'incoming') {
      const incoming = await Call.find({ _id: { $in: uniqueCallIds }, initiator_id: { $ne: userId } })
        .select('_id').lean();
        
      filteredCallIds = incoming.map((c) => c._id);
    } else if (filter === 'outgoing') {
      const outgoing = await Call.find({ _id: { $in: uniqueCallIds }, initiator_id: userId }).select('_id').lean();
      filteredCallIds = outgoing.map((c) => c._id);
      
    } else if (filter === 'missed') {
      const missed = await CallParticipant.find(
        { call_id: { $in: uniqueCallIds }, user_id: userId, status: 'missed', }
      ).select('call_id').lean();
      filteredCallIds = missed.map((p) => p.call_id);
    }

    if (filteredCallIds.length === 0) {
      return res.json({
        calls: {},
        sectionCounts: await getCallSectionCounts(userId),
        pagination: { currentPage: parseInt(page), totalPages: 0, totalCalls: 0, hasNext: false, hasPrev: false },
      });
    }

    const totalCount = filteredCallIds.length;
    const paginatedCallIds = filteredCallIds.sort((a, b) => b - a).slice(skip, skip + parseInt(limit));

    const calls = await Call.aggregate([
      { $match: { _id: { $in: paginatedCallIds } } },
      { $sort: { created_at: -1 } },
      { $lookup: { from: 'users', localField: 'initiator_id', foreignField: '_id', as: 'initiator_doc' } },
      { $unwind: { path: '$initiator_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'receiver_id', foreignField: '_id', as: 'receiver_doc' } },
      { $unwind: { path: '$receiver_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' } },
      { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'call_participants', localField: '_id', foreignField: 'call_id', as: 'participants' } },
      { $lookup: { from: 'users', localField: 'participants.user_id', foreignField: '_id', as: 'participant_users' } },
      {
        $addFields: {
          participants: {
            $map: {
              input: '$participants',
              as: 'p',
              in: {
                id: { $toString: '$$p._id' },
                call_id: '$$p.call_id',
                user_id: '$$p.user_id',
                status: '$$p.status',
                joined_at: '$$p.joined_at',
                left_at: '$$p.left_at',
                is_muted: '$$p.is_muted',
                is_screen_sharing: '$$p.is_screen_sharing',
                is_video_enabled: '$$p.is_video_enabled',
                video_status: '$$p.video_status',
                peer_id: '$$p.peer_id',
                created_at: '$$p.created_at',
                updated_at: '$$p.updated_at',
                user: {
                  $let: {
                    vars: {
                      u: {
                        $arrayElemAt: [{ $filter: { input: '$participant_users', cond: { $eq: ['$$this._id', '$$p.user_id']}}}, 0 ]
                      }
                    },
                    in: { id: { $toString: '$$u._id' }, name: '$$u.name', avatar: '$$u.avatar', email: '$$u.email', bio: '$$u.bio' }
                  }
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          initiator: { id: '$initiator_doc._id', name: '$initiator_doc.name', avatar: '$initiator_doc.avatar', email: '$initiator_doc.email' },
          receiver: {
            $cond: [
              { $ifNull: ['$receiver_doc', false] },
              { id: '$receiver_doc._id', name: '$receiver_doc.name', avatar: '$receiver_doc.avatar', email: '$receiver_doc.email' },
              null
            ]
          },
          group: {
            $cond: [
              { $ifNull: ['$group_doc', false] }, { id: '$group_doc._id', name: '$group_doc.name', avatar: '$group_doc.avatar' }, null
            ]
          }
        }
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          initiator_id: 1,
          receiver_id: 1,
          group_id: 1,
          call_type: 1,
          call_mode: 1,
          status: 1,
          started_at: 1,
          accepted_time: 1,
          ended_at: 1,
          duration: 1,
          created_at: 1,
          updated_at: 1,
          initiator: 1,
          receiver: 1,
          group: 1,
          participants:1
        }
      }
    ]);

    const processedCalls = await processCallsForHistory(calls, userId.toString());

    let finalCalls = processedCalls;
    if (search.trim()) {
      finalCalls = processedCalls.filter((call) => matchesSearchCriteria(call, search, userId.toString()) );
    }

    const groupedCalls = groupCallsByDate(finalCalls);
    const sectionCounts = await getCallSectionCounts(userId);

    res.json({
      calls: groupedCalls,
      sectionCounts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / limit),
        totalCalls: totalCount,
        hasNext: skip + calls.length < totalCount,
        hasPrev: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error('Error in getCallHistory:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};