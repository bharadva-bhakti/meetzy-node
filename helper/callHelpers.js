const { db } = require('../models');
const Message = db.Message;
const User = db.User;
const Call = db.Call;
const Group = db.Group;
const GroupMember = db.GroupMember;
const CallParticipant = db.CallParticipant;
const MessageStatus = db.MessageStatus;
const mongoose = require('mongoose');

async function createCallMessage(call, action, req, userId = null) {
    try {
      let content = '';
      const duration = call.duration || 0;
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      const formattedDuration = duration ? `${minutes}:${seconds.toString().padStart(2, '0')}` : '';
  
      // Get joined participants count for group calls
      let joinedCount = 0;
      if (call.call_mode === 'group' && call.participants) {
        joinedCount = call.participants.filter(p => p.status === 'joined').length;
      } else if (call.call_mode === 'direct') {
        joinedCount = call.participants?.filter(p => p.status === 'joined').length || 0;
      }
  
      switch (action) {
        case 'initiated':
          content = call.call_mode === 'direct'
            ? `📞 ${call.call_type === 'video' ? 'Video' : 'Voice'} call`
            : `${call.initiator?.name || 'Someone'} started a group ${call.call_type === 'video' ? 'video' : 'voice'} call`;
          break;
        case 'accepted':
        case 'ongoing':
          content = call.call_mode === 'group'
            ? `📞 Ongoing call • ${joinedCount} in call`
            : `📞 Ongoing call`;
          break;
        case 'declined':
          content = `❌ Declined call`;
          break;
        case 'ended':
          content = formattedDuration ? `📞 Call ended • Duration: ${formattedDuration}` : `📞 Call ended`;
          break;
        case 'missed':
          content = `📞 Missed call`;
          break;
      }
  
      const metadata = {
        call_id: call.id?.toString() || call._id?.toString(),
        call_type: call.call_type,
        call_mode: call.call_mode,
        action,
        duration: call.duration || 0,
        joined_count: joinedCount,
        accepted_time: call.accepted_time || null,
      };
  
      // Search for existing call message
      const query = {
        message_type: 'call',
        'metadata.call_id': metadata.call_id
      };
  
      if (call.call_mode === 'direct') {
        query.$or = [
          { recipient_id: call.receiver_id },
          { recipient_id: call.initiator_id }
        ];
      } else if (call.group_id) {
        query.group_id = call.group_id;
      }
  
      let message = await Message.findOne(query).lean();
  
      const messageData = {
        content,
        metadata,
        updated_at: new Date()
      };
  
      let fullMessage;
  
      if (message) {
        // Update existing message
        await Message.findByIdAndUpdate(message._id, messageData);
  
        // Fetch updated message with aggregation
        fullMessage = await Message.aggregate([
          { $match: { _id: message._id } },
          {
            $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' }
          },
          { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
          {
            $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc' }
          },
          { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
          {
            $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' }
          },
          { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              id: '$_id',
              sender: {
                id: '$sender_doc._id',
                name: '$sender_doc.name',
                avatar: '$sender_doc.avatar'
              },
              recipient: call.receiver_id ? {
                id: '$recipient_doc._id',
                name: '$recipient_doc.name',
                avatar: '$recipient_doc.avatar'
              } : null,
              group: call.group_id ? {
                id: '$group_doc._id',
                name: '$group_doc.name',
                avatar: '$group_doc.avatar'
              } : null
            }
          },
          {
            $project: {
              _id: 0, id: 1, sender_id: 1, recipient_id: 1, group_id: 1,
              content: 1, message_type: 1, metadata: 1, created_at: 1, updated_at: 1,
              sender: 1, recipient: 1, group: 1
            }
          }
        ]);
  
        fullMessage = fullMessage[0];
      } else {
        // Create new message
        const newMessageData = {
          sender_id: call.initiator_id,
          recipient_id: call.receiver_id || null,
          group_id: call.group_id || null,
          content,
          message_type: 'call',
          metadata,
        };
  
        const newMessage = await Message.create(newMessageData);
  
        // Create MessageStatus for recipients
        let recipients = [];
        if (call.call_mode === 'direct' && call.receiver_id) {
          recipients.push(call.receiver_id);
        } else if (call.group_id) {
          const members = await GroupMember.find({ group_id: call.group_id, user_id: { $ne: call.initiator_id } }).lean();
          recipients = members.map(m => m.user_id);
        }
  
        if (recipients.length > 0) {
          await MessageStatus.insertMany(
            recipients.map(uid => ({
              message_id: newMessage._id,
              user_id: uid,
              status: 'sent'
            }))
          );
        }
  
        // Populate new message
        fullMessage = await Message.aggregate([
          { $match: { _id: newMessage._id } },
          // same lookup pipeline as above
          {
            $lookup: { from: 'users', localField: 'sender_id', foreignField: '_id', as: 'sender_doc' }
          },
          { $unwind: { path: '$sender_doc', preserveNullAndEmptyArrays: true } },
          {
            $lookup: { from: 'users', localField: 'recipient_id', foreignField: '_id', as: 'recipient_doc' }
          },
          { $unwind: { path: '$recipient_doc', preserveNullAndEmptyArrays: true } },
          {
            $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' }
          },
          { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              id: '$_id',
              sender: {
                id: '$sender_doc._id',
                name: '$sender_doc.name',
                avatar: '$sender_doc.avatar'
              },
              recipient: call.receiver_id ? {
                id: '$recipient_doc._id',
                name: '$recipient_doc.name',
                avatar: '$recipient_doc.avatar'
              } : null,
              group: call.group_id ? {
                id: '$group_doc._id',
                name: '$group_doc.name',
                avatar: '$group_doc.avatar'
              } : null
            }
          },
          {
            $project: {
              _id: 0, id: 1, sender_id: 1, recipient_id: 1, group_id: 1,
              content: 1, message_type: 1, metadata: 1, created_at: 1, updated_at: 1,
              sender: 1, recipient: 1, group: 1
            }
          }
        ]);
  
        fullMessage = fullMessage[0];
      }
  
      const io = req.app.get('io');
  
      setTimeout(() => {
        if (call.call_mode === 'direct' && call.receiver_id) {
          io.to(`user_${call.initiator_id}`).emit('receive-message', fullMessage);
          io.to(`user_${call.receiver_id}`).emit('receive-message', fullMessage);
        } else if (call.group_id) {
          const memberIds = call.participants?.map(p => p.user_id?.toString()) || [];
          memberIds.forEach(uid => io.to(`user_${uid}`).emit('receive-message', fullMessage));
        }
      }, 300);
  
      return fullMessage;
    } catch (error) {
      console.error('Error in createCallMessage:', error);
      return null;
    }
}

function matchesSearchCriteria(call, searchTerm, userId) {
    const searchLower = searchTerm.toLowerCase();
  
    if (call.initiator && 
        (call.initiator.name?.toLowerCase().includes(searchLower) || 
         call.initiator.email?.toLowerCase().includes(searchLower))) {
      return true;
    }
  
    if (call.receiver && 
        (call.receiver.name?.toLowerCase().includes(searchLower) || 
         call.receiver.email?.toLowerCase().includes(searchLower))) {
      return true;
    }
  
    if (call.group && call.group.name?.toLowerCase().includes(searchLower)) {
      return true;
    }
  
    if (call.participants) {
      const matchingParticipant = call.participants.find(participant => 
        participant.user_id?.toString() !== userId.toString() && 
        participant.user && 
        (participant.user.name?.toLowerCase().includes(searchLower) || 
         participant.user.email?.toLowerCase().includes(searchLower))
      );
      if (matchingParticipant) return true;
    }
  
    if (call.participantNames && Array.isArray(call.participantNames)) {
      const matchingName = call.participantNames.find(name => 
        name.toLowerCase().includes(searchLower)
      );
      if (matchingName) return true;
    }
  
    return false;
}
  
async function processCallsForHistory(calls, userId) {
    return Promise.all(calls.map(async (call) => {
        const callInfo = getCallInfoForUser(call, userId.toString());
        const duration = formatCallDuration(call.duration);
        const participantNames = getParticipantNames(call, userId.toString());
        const isGroupCall = call.call_mode === 'group';
        
        return {
        id: call.id.toString(),
        callType: call.call_type,
        callMode: call.call_mode,
        duration: duration,
        timestamp: call.created_at,
        date: call.created_at,
        status: callInfo.status,
        direction: callInfo.direction,
        isGroupCall: isGroupCall,
        participantNames: participantNames,
        participants: call.participants || [],
        initiator: call.initiator,
        group: call.group,
        receiver: call.receiver,
        acceptedTime: call.accepted_time,
        endedAt: call.ended_at
        };
    }));
}
  
function getCallInfoForUser(call, userId) {
    const isInitiator = call.initiator_id?.toString() === userId;
    let status = 'ended';
    let direction = isInitiator ? 'outgoing' : 'incoming';
  
    if (!isInitiator) {
      const userParticipant = call.participants?.find(p => p.user_id?.toString() === userId);
      if (userParticipant) {
        if (userParticipant.status === 'missed' || userParticipant.status === 'declined') {
          status = 'missed';
        }
      }
    }
  
    if (call.call_mode === 'group') {
      const userParticipant = call.participants?.find(p => p.user_id?.toString() === userId);
      if (userParticipant) {
        if (userParticipant.status === 'joined' || userParticipant.status === 'left') {
          status = 'ended';
        } else if (userParticipant.status === 'missed' || userParticipant.status === 'declined') {
          status = 'missed';
          direction = 'incoming';
        }
      }
    }
  
    return { status, direction };
}
  
function formatCallDuration(duration) {
    if (!duration || duration === 0) return null;
  
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
  
    if (minutes > 0) return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  
    return `${seconds}s`;
}
  
function getParticipantNames(call, userId) {
  if (call.call_mode === 'direct') {
    const other = call.initiator_id?.toString() === userId 
      ? call.receiver 
      : call.initiator;
    return other ? [other.name || 'Unknown User'] : ['Unknown User'];
  }

  const names = (call.participants || [])
    .filter(p => {
      const pid = p.user_id?.toString();
      return pid && pid !== userId && p.user && p.user.name;
    })
    .map(p => p.user.name)
    .filter(Boolean);

  return names.length > 0 ? names : ['Group Call'];
}
  
function groupCallsByDate(calls) {
    const groups = {};
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
  
    calls.forEach(call => {
      const callDate = new Date(call.timestamp);
      let dateLabel;
  
      const callDateOnly = new Date(callDate.getFullYear(), callDate.getMonth(), callDate.getDate());
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  
      if (callDateOnly.getTime() === todayOnly.getTime()) {
        dateLabel = 'Today';
      } else if (callDateOnly.getTime() === yesterdayOnly.getTime()) {
        dateLabel = 'Yesterday';
      } else {
        dateLabel = callDate.toLocaleDateString('en-US', {
          day: 'numeric', month: 'long', year: 'numeric'
        });
      }
  
      if (!groups[dateLabel]) groups[dateLabel] = [];
      groups[dateLabel].push(call);
    });
  
    return groups;
}
  
async function getCallSectionCounts(userId, search = '') {
  try {
    const [initiated, received, participated] = await Promise.all([
      Call.find({ initiator_id: userId }).select('_id').lean(),
      Call.find({ receiver_id: userId }).select('_id').lean(),
      CallParticipant.find({ user_id: userId }).select('call_id').lean(),
    ]);

    const callIds = [
      ...initiated.map(c => c._id),
      ...received.map(c => c._id),
      ...participated.map(p => p.call_id),
    ];

    const uniqueCallIds = [...new Set(callIds.map(id => id.toString()))]
      .map(id => new mongoose.Types.ObjectId(id));

    if (uniqueCallIds.length === 0) {
      return { all: 0, incoming: 0, outgoing: 0, missed: 0 };
    }

    const allCalls = await Call.aggregate([
      { $match: { _id: { $in: uniqueCallIds } } },
      { $lookup: { from: 'users', localField: 'initiator_id', foreignField: '_id', as: 'initiator_doc' } },
      { $unwind: { path: '$initiator_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'receiver_id', foreignField: '_id', as: 'receiver_doc' } },
      { $unwind: { path: '$receiver_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'groups', localField: 'group_id', foreignField: '_id', as: 'group_doc' } },
      { $unwind: { path: '$group_doc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'callparticipants', localField: '_id', foreignField: 'call_id', as: 'participants' } },
      { $lookup: { from: 'users', localField: 'participants.user_id', foreignField: '_id', as: 'participant_users' } },
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
                      $arrayElemAt: [ { $filter: { input: '$participant_users', cond: { $eq: ['$$this._id', '$$p.user_id']}}}, 0 ]
                    }
                  }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          initiator: { id: '$initiator_doc._id', name: '$initiator_doc.name', email: '$initiator_doc.email' },
          receiver: {
            $cond: [
              { $ifNull: ['$receiver_doc', false] },
              { id: '$receiver_doc._id', name: '$receiver_doc.name', email: '$receiver_doc.email' },
              null
            ]
          },
          group: {$cond: [ { $ifNull: ['$group_doc', false] }, { id: '$group_doc._id', name: '$group_doc.name' }, null ]}
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
          duration: 1,
          created_at: 1,
          initiator: 1,
          receiver: 1,
          group: 1,
          participants: { user_id: 1, status: 1, user: { name: 1, email: 1 }}
        }
      }
    ]);

    const processedCalls = await processCallsForHistory(allCalls, userId.toString());

    let filteredCalls = processedCalls;
    if (search.trim()) {
      filteredCalls = processedCalls.filter(call =>
        matchesSearchCriteria(call, search, userId.toString())
      );
    }

    const allCount = filteredCalls.length;
    const outgoingCount = filteredCalls.filter(call => call.direction === 'outgoing').length;
    const incomingCount = filteredCalls.filter(call => call.direction === 'incoming').length;
    const missedCount = filteredCalls.filter(call => call.status === 'missed').length;

    return {
      all: allCount,
      incoming: incomingCount,
      outgoing: outgoingCount,
      missed: missedCount
    };
  } catch (error) {
    console.error('Error getting call section counts:', error);
    return { all: 0, incoming: 0, outgoing: 0, missed: 0 };
  }
}
  
module.exports = {
createCallMessage,
matchesSearchCriteria,
processCallsForHistory,
getCallInfoForUser,
formatCallDuration,
getParticipantNames,
groupCallsByDate,
getCallSectionCounts
};