const { Call, CallParticipant, User, Group, GroupMember, Setting } = require('../models');
const { Op } = require('sequelize');
const { getCallSectionCounts, groupCallsByDate, createCallMessage, 
    processCallsForHistory, matchesSearchCriteria } = require('../helper/callHelpers');

exports.initiateCall = async (req, res) => {
    const { callType = 'audio', chatType, chatId } = req.body;
    const initiatorId = req.user.id;
    const io = req.app.get('io');

    try {
        const setting = await Setting.findOne({ attributes: ['call_timeout_seconds']});

        if (!chatType || !['direct', 'group'].includes(chatType)) {
            return res.status(400).json({ message: 'Invalid chat type (direct | group) required' });
        }

        if (!chatId) return res.status(400).json({ message: 'chatId is required' });
        const initiatorBusy = await CallParticipant.findOne({
            where: { user_id: initiatorId, status: { [Op.in]: ['joined', 'invited'] }},
            include: [{ model: Call, as: 'call', where: { status: 'active' } }],
        });

        if (initiatorBusy) {
            io.to(`user_${initiatorId}`).emit('call-busy', { userId: initiatorId });
            return res.status(409).json({ message: 'You are already in another active call.' });
        }

        let targetUserIds = [];
        if (chatType === 'direct') {
            targetUserIds = [chatId];
        } else {
            const members = await GroupMember.findAll({ 
                where: { group_id: chatId }, attributes: ['user_id'] 
            });
            targetUserIds = members.map((m) => m.user_id).filter((id) => id !== initiatorId);
        }

        const busyUsers = await CallParticipant.findAll({
        where: { 
            user_id: { [Op.in]: targetUserIds }, 
            status: { [Op.in]: ['joined', 'invited'] }
        },
        include: [{ model: Call, as: 'call', where: { status: 'active' } }],
        });

        if (busyUsers.length > 0) {
        const busyIds = busyUsers.map(u => u.user_id);
        console.log(`User(s) busy but we are allowing the call anyway:`, busyIds);
        }

        const call = await Call.create({
            initiator_id: initiatorId,
            receiver_id: chatType === 'direct' ? chatId : null,
            group_id: chatType === 'group' ? chatId : null,
            call_type: callType,
            call_mode: chatType,
            status: 'active',
            started_at: new Date().toISOString(),
        });

        let participants = [];
        if (chatType === 'direct') {
            participants = [
                { call_id: call.id, user_id: initiatorId, status: 'joined', joined_at: new Date().toISOString() },
                { call_id: call.id, user_id: chatId, status: 'invited' },
            ];
        } else {
            const members = await GroupMember.findAll({ where: { group_id: chatId }, attributes: ['user_id'] });
            participants = members.map((m) => ({
                call_id: call.id,
                user_id: m.user_id,
                status: m.user_id === initiatorId ? 'joined' : 'invited',
                joined_at: m.user_id === initiatorId ? new Date().toISOString() : null,
            }));
        }

        await CallParticipant.bulkCreate(participants);

        const fullCall = await Call.findByPk(call.id, {
            include: [
                { model: User, as: 'initiator', attributes: ['id', 'name', 'avatar'] },
                { model: User, as: 'receiver', attributes: ['id', 'name', 'avatar'], required: false },
                { model: Group, as: 'group', required: false, attributes: ['id', 'name'] },
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
                },
            ]
        });

        const callData = fullCall.get({ plain: true });

        if (chatType === 'direct') {
            io.to(`user_${chatId}`).emit('incoming-call', callData);
        } else {
            participants.filter((p) => p.user_id !== initiatorId).forEach((p) => {
                io.to(`user_${p.user_id}`).emit('incoming-call', callData);
            });
        }
        
        const UNANSWERED_TIMEOUT = setting.call_timeout_seconds * 1000 || 20000;

        setTimeout(async () => {
            try {
                const activeCall = await Call.findByPk(call.id, {
                    include: [{ model: CallParticipant, as: 'participants' }],
                });
                if (!activeCall || activeCall.status !== 'active') return;

                const hasAnswer = activeCall.participants.filter((p) => 
                    p.status === 'joined' && p.user_id !== initiatorId
                ).length > 0;

                if (!hasAnswer) {
                    console.log(`Call ${call.id} unanswered — ending now.`);

                    await Call.update({ status: 'ended', ended_at: new Date().toISOString(), duration: 0 }, { where: { id: call.id } });
                    await CallParticipant.update(
                        { status: 'missed' }, { where: { call_id: call.id, status: 'invited' }}
                    );

                    const fullMissedCall = await Call.findByPk(call.id, {
                        include: [
                            { model: User, as: 'initiator', attributes: ['id', 'name', 'avatar'] },
                            { model: User, as: 'receiver', attributes: ['id', 'name', 'avatar'], required: false },
                            { model: Group, as: 'group', required: false, attributes: ['id', 'name'] },
                        ],
                    });
                    
                    await createCallMessage(fullMissedCall, 'missed', req);

                    if (chatType === 'direct') {
                        io.to(`user_${initiatorId}`).emit('call-ended', { callId: call.id, reason: 'no_answer' });
                        io.to(`user_${chatId}`).emit('call-ended', { callId: call.id, reason: 'no_answer' });
                    } else {
                        participants.forEach((p) => {
                            io.to(`user_${p.user_id}`).emit('call-ended', { callId: call.id, reason: 'no_answer' });
                        });
                    }
                }
            } catch (error) {
                console.error('Error handling unanswered call timeout:', error);
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

        const call = await Call.findByPk(callId, {
            include: [
                { model: User, as: 'initiator', attributes: ['id', 'name', 'avatar'] },
                { model: User, as: 'receiver', attributes: ['id', 'name', 'avatar'], required: false },
                { model: Group, as: 'group', required: false, attributes: ['id', 'name'] },
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
                },
            ]
        });

        if (!call) return res.status(404).json({ message: 'Call not found.' });

        if (call.status !== 'active') {
            return res.status(400).json({ message: 'Call has already ended' });
        }

        const participant = await CallParticipant.findOne({
            where: { call_id: callId, user_id: parseInt(userId, 10) },
        });
        
        if (!participant) {
            return res.status(404).json({ message: 'You are not invited to this call.' });
        }

        if (participant.status === 'joined') {
            return res.status(400).json({ message: 'You have already joined this call.' });
        }

        if (participant.status === 'declined') {
            return res.status(400).json({ message: 'You have already declined this call.' });
        }

        const userBusy = await CallParticipant.findOne({
            where: {
                user_id: userId,
                status: { [Op.in]: ['joined', 'invited'] },
                call_id: { [Op.ne]: callId }
            },
            include: [{ model: Call, as: 'call', where: { status: 'active' } }],
        });

        if (userBusy) {
            io.to(`user_${call.initiator_id}`).emit('call-busy', { userId: parseInt(userId, 10) });
            return res.status(409).json({ message: 'You are already in another active call.' });
        }

        const currentJoinedParticipants = await CallParticipant.count({
            where: { 
                call_id: callId, 
                status: 'joined', 
                user_id: { [Op.ne]: call.initiator_id }
            }
        });

        const isFirstAcceptance = currentJoinedParticipants === 0;

        await CallParticipant.update(
            {
                status: 'joined',
                joined_at: new Date().toISOString(),
                is_muted: false,
                is_video_enabled: call.call_type === 'video'
            },
            { where: { call_id: callId, user_id: parseInt(userId, 10) } }
        );

        if (isFirstAcceptance) {
            await Call.update(
                { accepted_time: new Date().toISOString() }, 
                { where: { id: callId } }
            );
        }

        const updatedCall = await Call.findByPk(callId, {
            include: [
                { model: User, as: 'initiator', attributes: ['id', 'name', 'avatar'] },
                { model: User, as: 'receiver', attributes: ['id', 'name', 'avatar'], required: false },
                { model: Group, as: 'group', required: false, attributes: ['id', 'name'] },
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
                },
            ]
        });

        const callData = updatedCall.get({ plain: true });

        const userData = {
            userId: req.user.id,
            name: req.user.name,
            avatar: req.user.avatar,
            isAudioEnabled: true,
            isVideoEnabled: call.call_type === 'video',
            socketId: null
        };

        const joinedParticipants = callData.participants.filter(p => 
            p.status === 'joined' && p.user_id !== parseInt(userId, 10)
        );

        joinedParticipants.forEach(participant => {
            io.to(`user_${participant.user_id}`).emit('call-accepted', {
                callId, 
                userId: parseInt(req.user.id, 10),
                user: userData
            });
        });

        const participantsForSync = callData.participants
            .filter(p => {
                if (p.status !== 'joined' || p.user_id === parseInt(userId, 10)) return false;
                if (parseInt(userId, 10) !== call.initiator_id && p.user_id === call.initiator_id) return false;
                return true;
            })
            .map(participant => ({
                userId: parseInt(participant.user_id, 10),
                socketId: null,
                name: participant.user.name,
                avatar: participant.user.avatar,
                joinedAt: participant.joined_at,
                isAudioEnabled: !participant.is_muted,
                isVideoEnabled: participant.is_video_enabled,
                isScreenSharing: participant.is_screen_sharing || false,
            }));

        io.to(`user_${parseInt(userId, 10)}`).emit('call-participants-sync', {
            callId, 
            participants: participantsForSync
        });

        console.log(`User ${parseInt(userId, 10)} accepted call ${callId} (first acceptance: ${isFirstAcceptance})`);

        res.json({ message: 'Call answered successfully', call: callData });
    } catch (error) {
        console.error('Error in answerCall:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.declineCall = async (req, res) => {
    const { callId } = req.body;
    const userId = req.user.id;
    const io = req.app.get('io');

    try {
        if (!callId) return res.status(400).json({ message: 'callId is required' });

        const call = await Call.findByPk(callId, {
            include: [
                { model: User, as: 'initiator', attributes: ['id', 'name', 'avatar']},
                { model: User, as: 'receiver', attributes: ['id', 'name', 'avatar'], required: false },
                { model: Group, as: 'group', required: false, attributes: ['id', 'name']},
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }],
                },
            ]
        });

        if (!call) return res.status(404).json({ message: 'Call not found' });

        if (call.status !== 'active') {
            return res.status(400).json({ message: 'Call has already ended' });
        }

        const participant = await CallParticipant.findOne({
            where: { call_id: callId, user_id: userId },
        });

        if (!participant){
            return res.status(404).json({ message: 'You are not invited to this call' });
        } 

        if (participant.status === 'joined') {
            return res.status(400).json({ error: 'You have already joined this call' });
        }

        if (participant.status === 'declined') {
            return res.status(400).json({ error: 'You have already declined this call' });
        }

        await CallParticipant.update({ status: 'declined' }, { 
            where: { call_id: callId, user_id: userId } 
        });

        await createCallMessage(call, 'declined', req);
        const callData = call.get({ plain: true });

        if (call.call_mode === 'direct') {
            
            await Call.update(
                { status: 'ended', ended_at: new Date().toISOString(), duration: 0}, { where: { id: callId } }
            );

            await CallParticipant.update({ status: 'left' }, { 
                where: { call_id: callId, user_id: call.initiator_id } 
            });

            io.to(`user_${call.initiator_id}`).emit('call-declined', { callId, userId });
            io.to(`user_${call.initiator_id}`).emit('call-ended', { callId, reason: 'declined'});
            io.to(`user_${userId}`).emit('call-ended', { callId, reason: 'declined' });

            console.log(`Direct call ${callId} ended - declined by ${userId}`);
        } else {
            io.to(`user_${call.initiator_id}`).emit('call-declined', {callId, userId });

            const remainingParticipants = await CallParticipant.findAll({
                where: { 
                    call_id: callId, 
                    status: { [Op.in]: ['invited', 'joined'] }, 
                    user_id: { [Op.ne]: userId }
                }
            });

            const hasActiveParticipants = remainingParticipants.some(p => 
                p.status === 'joined' && p.user_id !== call.initiator_id
            );

            const hasInvitedUsers = remainingParticipants.some(p => p.status === 'invited');
            const shouldEndCall = !hasActiveParticipants && !hasInvitedUsers;

            if(shouldEndCall) {
                console.log(`All invited users declined call ${callId}, ending call`);

                await Call.update(
                    { status: 'ended', ended_at: new Date().toISOString(), duration: 0 }, { where: { id: callId } }
                );

                await CallParticipant.update(
                    { status: 'left' }, { where: { call_id: callId, status: 'joined' } }
                );

                await CallParticipant.update(
                    { status: 'missed' }, { where: { call_id: callId, status: 'invited' } }
                );

                call.participants.forEach(participant => {
                    io.to(`user_${participant.user_id}`).emit('call-ended', { 
                        callId, reason: 'no_participants' 
                    });
                });
            } else {
                const joinedParticipants = call.participants.filter(p => 
                    p.status === 'joined' && p.user_id !== userId
                );

                joinedParticipants.forEach(participant => {
                    io.to(`user_${participant.user_id}`).emit('participant-declined', {
                        callId, userId,
                    });
                });
            }
        }

        res.json({ message: 'Call declined successfully', call: callData });
    } catch (error) {
        console.error('Error in declineCall:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.endCall = async (req,res) => {
    const { callId } = req.body;
    const userId = req.user.id;
    const io = req.app.get('io');
    const attributes = ['id', 'name', 'avatar'];

    try {
        if (!callId) {
            return res.status(400).json({ message: 'callId is required' });
        }

        const call = await Call.findByPk(callId, {
            include: [
                { model: User, as: 'initiator', attributes },
                { model: User, as: 'receiver', attributes, required: false },
                { model: Group, as: 'group', required: false, attributes: ['id', 'name']},
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes}],
                },
            ]
        });
        if(!call) return res.status(404).json({ message: 'Call not found' });

        const userParticipant = await CallParticipant.findOne({
            where: { call_id: callId, user_id: userId }
        });

        if (!userParticipant) {
            return res.status(403).json({ message: 'You are not part of this call' });
        }

        if (call.status === 'ended') {
            return res.json({
                message: 'Call already ended (timeout/no answer).',
                callEnded: true,
                duration: call.duration || 0
            });
        }

        if (call.status !== 'active') {
        return res.json({ message: 'Call already ended', callEnded: true });
        }

        await CallParticipant.update(
            { status: 'left', left_at: new Date().toISOString() },
            { where: { call_id: callId, user_id: userId } }
        );

        const remainingParticipants = await CallParticipant.findAll({
            where: { call_id: callId, status: 'joined' }
        });

        const shouldEndCall = remainingParticipants.length < 2;
        let duration = null;

        if(shouldEndCall){
            const endTime = new Date();
           let duration = 0;
           const realJoiners = remainingParticipants.filter((p) => p.user_id !== call.initiator_id);

           if (realJoiners.length === 0) {
             duration = 0;
           } else {
             const startTime = call.accepted_time || call.started_at;
             duration = Math.max(1, Math.floor((endTime - new Date(startTime)) / 1000));
           }
            
            await Call.update(
                { status: 'ended', ended_at: endTime, duration: duration },
                { where: { id: callId } }
            );

            await CallParticipant.update(
                { status: 'left', left_at: endTime },
                { where: { call_id: callId, status: 'joined' } }
            );

            await CallParticipant.update(
                { status: 'missed' },
                { where: { call_id: callId, status: 'invited' } }
            );

            const finalCall = await Call.findByPk(callId, {
                include: [
                    { model: User, as: 'initiator', attributes },
                    { model: User, as: 'receiver', attributes, required: false },
                    { model: Group, as: 'group', required: false, attributes: ['id', 'name'] },
                    {
                        model: CallParticipant,
                        as: 'participants',
                        where: { status: { [Op.in]: ['joined', 'left'] } },
                        required: false
                    },
                ]
            });

            await createCallMessage(finalCall, 'ended', req);

            const allParticipants = await CallParticipant.findAll({
                where: { call_id: callId },
                include: [{ model: User, as: 'user' }]
            });

            allParticipants.forEach(participant => {
                io.to(`user_${participant.user_id}`).emit('call-ended', { 
                    callId, reason: 'ended', duration: duration
                });
            });

            const invitedUsers = await CallParticipant.findAll({
                where: { call_id: callId, status: 'missed' }
            });

            invitedUsers.forEach(participant => {
                io.to(`user_${participant.user_id}`).emit('call-ended', { 
                    callId, reason: 'ended' 
                });
            });

            console.log(`Call ${callId} completely ended by ${userId}`);
        } else {
            const leftUser = await User.findByPk(userId, { attributes: ['id', 'name', 'avatar'] });

            remainingParticipants.forEach(participant => {
                if (participant.user_id !== userId) {
                    io.to(`user_${participant.user_id}`).emit('participant-left', {
                        callId,
                        userId: parseInt(userId, 10),
                        user: {
                            userId: parseInt(userId, 10),
                            name: leftUser?.name || 'Unknown',
                            avatar: leftUser?.avatar || null,
                        }
                    });
                }
            });

            console.log(`User ${userId} left call ${callId}, ${remainingParticipants.length} still in call`);
        }

        res.json({ 
            message: shouldEndCall ? 'Call ended successfully' : 'Left call successfully',
            callEnded: shouldEndCall,
            duration: shouldEndCall ? duration : null
        });
    } catch (error) {
        console.error('Error in endCall:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getCallHistory = async (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 20, filter = 'all', search='' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const attributes = ['id', 'name', 'avatar', 'email'];

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
            return res.json({
                calls: {},
                sectionCounts: { all: 0, incoming: 0, outgoing: 0, missed: 0 },
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: 0,
                    totalCalls: 0,
                    hasNext: false,
                    hasPrev: false
                }
            });
        }

        let filteredCallIds = callIds;
        switch (filter) {
            case 'incoming':
                const incomingCalls = await Call.findAll({
                    where: { id: callIds, initiator_id: { [Op.ne]: userId }},
                    attributes: ['id'],
                    raw: true
                });
                filteredCallIds = incomingCalls.map(c => c.id);
                break;
                
            case 'outgoing':
                const outgoingCalls = await Call.findAll({
                    where: { id: callIds, initiator_id: userId },
                    attributes: ['id'],
                    raw: true
                });
                filteredCallIds = outgoingCalls.map(c => c.id);
                break;
                
            case 'missed':
                const missedCalls = await CallParticipant.findAll({
                    where: { call_id: callIds, user_id: userId, status: 'missed' },
                    attributes: ['call_id'],
                    raw: true
                });
                filteredCallIds = missedCalls.map(c => c.call_id);
                break;
        }

        if (filteredCallIds.length === 0) {
            return res.json({
                calls: {},
                sectionCounts: await getCallSectionCounts(userId),
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: 0,
                    totalCalls: 0,
                    hasNext: false,
                    hasPrev: false
                }
            });
        }

        const { count, rows: calls } = await Call.findAndCountAll({
            where: { 
                [Op.and]: [
                    {id: filteredCallIds },
                ],
            },
            include: [
                { model: User, as: 'initiator', attributes },
                { model: User, as: 'receiver', attributes, required: false },
                { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'], required: false },
                {
                    model: CallParticipant,
                    as: 'participants',
                    include: [{ model: User, as: 'user', attributes }],
                    required: false
                }
            ],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: offset,
            distinct: true
        });

        const processedCalls = await processCallsForHistory(calls, userId);

        let finalProcessedCalls = processedCalls;
        if (search.trim()) {
            finalProcessedCalls = processedCalls.filter(call => 
                matchesSearchCriteria(call, search, userId)
            );
        }

        const groupedCalls = groupCallsByDate(finalProcessedCalls);
        const sectionCounts = await getCallSectionCounts(userId);

        let missedCount = 0;

        if (filter === 'all' || filter === 'outgoing') {
            const missedOutgoingCalls = await CallParticipant.findAll({
                where: { call_id: filteredCallIds, status: 'missed', user_id: { [Op.ne]: userId } },
                attributes: ['call_id'],
                raw: true
            });

            missedCount = missedOutgoingCalls.length;
        }

        if (filter === 'all' || filter === 'incoming') {
            const missedIncomingCalls = await CallParticipant.findAll({
                where: { call_id: filteredCallIds, status: 'missed', user_id: userId },
                attributes: ['call_id'],
                raw: true
            });
            missedCount += missedIncomingCalls.length;
        }

        sectionCounts.missed = missedCount;
        
        res.json({
            calls: groupedCalls,
            sectionCounts,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(count / limit),
                totalCalls: count,
                hasNext: offset + calls.length < count,
                hasPrev: parseInt(page) > 1
            }
        });
    } catch (error) {
        console.error('Error in getCallHistory:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};