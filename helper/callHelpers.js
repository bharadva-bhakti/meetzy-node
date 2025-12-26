const { Call, CallParticipant, User, Group, GroupMember, Message, MessageStatus } = require('../models');
const { Op } = require('sequelize');

async function createCallMessage (call, action, req) {
    try {
      let content = '';
      const duration = call.duration || 0;
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      const formattedDuration = duration ? `${minutes}m ${seconds}s` : '';
  
      switch (action) {
        case 'initiated':
          content = call.call_mode === 'direct'
            ? `${call.initiator?.name || 'Someone'} started a call`
            : `${call.initiator?.name || 'Someone'} started a group call`;
          break;
        case 'accepted':
          content = `📞 Call accepted`;
          break;
        case 'declined':
          content = `❌ Declined Call`;
          break;
        case 'ended':
          content = formattedDuration
            ? `📞 Call ended • Duration: ${formattedDuration}` : `📞 Call ended`;
          break;
        case 'missed':
          content = `📞 Missed call`;
          break;
      }
  
      const messageData = {
        sender_id: call.initiator_id,
        recipient_id: call.receiver_id || null,
        group_id: call.group_id || null,
        content,
        message_type: 'call',
        metadata: {
          call_id: call.id,
          call_type: call.call_type,
          call_mode: call.call_mode,
          action,
          duration: call.duration || 0,
        },
      };
  
      const message = await Message.create(messageData);
  
      let recipients = [];
      if (call.call_mode === 'direct' && call.receiver_id) {
        recipients.push(call.receiver_id);
      } else if (call.group_id) {
        const members = await GroupMember.findAll({
          where: { group_id: call.group_id, user_id: { [Op.ne]: call.initiator_id }},
          attributes: ['user_id'],
          raw: true,
        });
        recipients = members.map((m) => m.user_id);
      }
  
      if (recipients.length) {
        const statusData = recipients.map((uid) => ({
          message_id: message.id, user_id: uid, status: 'sent',
        }));
        await MessageStatus.bulkCreate(statusData);
      }
  
      const io = req.app.get('io');
      const fullMessage = await Message.findByPk(message.id, {
        include: [
          { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
          { model: User, as: 'recipient', attributes: ['id', 'name', 'avatar'], required: false },
          { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'], required: false },
        ],
      });
  
      setTimeout(() => {
        if (call.call_mode === 'direct' && call.receiver_id) {
          io.to(`user_${call.initiator_id}`).emit('receive-message', fullMessage);
          io.to(`user_${call.receiver_id}`).emit('receive-message', fullMessage);
        } else if (call.group_id) {
          io.to(`group_${call.group_id}`).emit('receive-message', fullMessage);
        }
      }, 300);
  
      return fullMessage;
    } catch (error) {
      console.error('Error creating call message:', error);
      return null;
    }
};

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
            participant.user_id !== userId && 
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
};

async function processCallsForHistory(calls, userId) {
    return Promise.all(calls.map(async (call) => {
        const callData = call.get({ plain: true });
        
        const callInfo = getCallInfoForUser(callData, userId);
        const duration = formatCallDuration(callData.duration);
        const participantNames = getParticipantNames(callData, userId);
        const isGroupCall = callData.call_mode === 'group';

        return {
            id: callData.id,
            callType: callData.call_type,
            callMode: callData.call_mode,
            duration: duration,
            timestamp: callData.created_at,
            date: callData.created_at,
            status: callInfo.status,
            direction: callInfo.direction,
            isGroupCall: isGroupCall,
            participantNames: participantNames,
            participants: callData.participants,
            initiator: callData.initiator,
            group: callData.group,
            receiver: callData.receiver,
            acceptedTime: callData.accepted_time,
            endedAt: callData.ended_at
        };
    }));
};

function getCallInfoForUser(call, userId) {
    const isInitiator = call.initiator_id === userId;
    let status = 'ended';
    let direction = isInitiator ? 'outgoing' : 'incoming';

    if(!isInitiator) {
        const userParticipant = call.participants?.find(p => p.user_id === userId);
        if (userParticipant && userParticipant.status === 'missed') {
            status = 'missed';
        } else if (userParticipant && userParticipant.status === 'declined') {
            status = 'missed';
        }
    }

    if (call.call_mode === 'group') {
        const userParticipant = call.participants?.find(p => p.user_id === userId);
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
};

function formatCallDuration(duration) {
    if (!duration || duration === 0) return null;
    
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    
    if (minutes > 0) return `${minutes}:${seconds.toString().padStart(2, '0')}`;

    return `${seconds}s`;
};

function getParticipantNames(call, userId) {
    if (call.call_mode === 'direct') {
        return call.initiator_id === userId 
            ? [call.receiver?.name || 'Unknown User'] : [call.initiator?.name || 'Unknown User'];
    } else {
        const otherParticipants = call.participants?.filter(
            p => p.user_id !== userId && p.user
        ).map(p => p.user.name) || [];
        
        return otherParticipants.length > 0 ? otherParticipants : ['Group Call'];
    }
};

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
};

async function getCallSectionCounts(userId, search = '') {
    try {
        let callIds = [];
        
        const initiatedCalls = await Call.findAll({
            where: { initiator_id: userId }, attributes: ['id'], raw: true
        });
        
        const receivedCalls = await Call.findAll({
            where: { receiver_id: userId }, attributes: ['id'], raw: true
        });
        
        const participantCalls = await CallParticipant.findAll({
            where: { user_id: userId }, attributes: ['call_id'], raw: true
        });

        callIds = [
            ...initiatedCalls.map(c => c.id),
            ...receivedCalls.map(c => c.id),
            ...participantCalls.map(c => c.call_id)
        ];
        callIds = [...new Set(callIds)];

        if (callIds.length === 0) {
            return { all: 0, incoming: 0, outgoing: 0, missed: 0 };
        }

        const allCalls = await Call.findAll({
            where: { id: callIds },
            include: [
                { model: User, as: 'initiator', attributes: ['id', 'name', 'email'] },
                { model: User, as: 'receiver', attributes: ['id', 'name', 'email'], required: false },
                { model: Group, as: 'group', attributes: ['id', 'name'], required: false },
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
                    required: false
                }
            ]
        });

        const processedCalls = await processCallsForHistory(allCalls, userId);
        
        let filteredCalls = processedCalls;
        if (search.trim()) {
            filteredCalls = processedCalls.filter(call => 
                matchesSearchCriteria(call, search, userId)
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
};

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