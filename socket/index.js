'use strict';

const { Op } = require('sequelize');
const { User, Message, MessageStatus, GroupMember, Friend, Call, CallParticipant, UserSetting, ChatSetting, MessageDisappearing, Block } = require('../models');
const { updateUserStatus } = require('../utils/userStatusHelper');

const resetOnlineStatuses = async () => {
  const now = new Date();
  await User.update({ is_online: false, last_seen: now }, { where: { is_online: true }});
};

resetOnlineStatuses();

module.exports = function initSocket(io) {
  const userSockets = new Map();
  const socketUsers = new Map();
  const userCalls = new Map();

  io.on('connection', (socket) => {
    socket.on('join-room', async (userId) => {
      if(!userId) {
        console.error('No user Id provided for join room.');
        return;
      }

      try {
        const user = await User.findByPk(userId, { attributes: [                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          'id'] });
        if (!user) {
          console.error(`Invalid userId: ${userId}`);
          return;
        }

        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }
        
        userSockets.get(userId).add(socket.id);
        socketUsers.set(socket.id, userId);
        socket.userId = userId;

        socket.join(`user_${userId}`);
        console.log(`User ${userId} joined personal room user_${userId} with socket ${socket.id}`);

        try {
          const userGroups = await GroupMember.findAll({
            where: { user_id: userId }, attributes: ['group_id'],
          });    

          for (const gm of userGroups) {
            const isBlocked = await Block.findOne({
              where: {
                blocker_id: userId,
                group_id: gm.group_id,
                block_type: 'group'
              }
            });
          
            if (!isBlocked) {
              socket.join(`group_${gm.group_id}`);
              console.log(`User ${userId} auto-joined group_${gm.group_id}`);
            } else {
              console.log(`User ${userId} did NOT join group_${gm.group_id} (BLOCKED)`);
            }
          }
        } catch (error) {
          console.error(`Error joining user ${userId} to groups:`, error);
        }

        try {
          await updateUserStatus(userId, 'online');

          const allUsersFromDb = await User.findAll({ 
            attributes: ['id', 'is_online', 'last_seen'],
            include: [{
              model: UserSetting,
              as: 'setting',
              attributes: ['last_seen'],
              required: false
            }]
          });

          const allUsers = allUsersFromDb.map((user) => {
            const shouldShowLastSeen = user.setting?.last_seen !== false;
            return {
              userId: user.id,
              status: user.is_online ? 'online' : 'offline',
              lastSeen: shouldShowLastSeen && user.last_seen ? new Date(user.last_seen).toISOString() : null,
            };
          }).filter((u) => u.userId !== userId);

          if (allUsers.length > 0) {
            socket.emit('bulk-user-status-update', allUsers);
          }

          socket.broadcast.emit('user-status-update', { userId, status: 'online', lastSeen: null});
        } catch (error) {
          console.error(`Error updating status for user ${userId}:`, error);
        }

        const undeliveredStatuses = await MessageStatus.findAll({
          where: { user_id: userId, status: 'sent' },
          include: [{ model: Message, as: 'message' }],
        });

        const messageIds = undeliveredStatuses.map((ms) => ms.message_id);
        
        if(messageIds.length > 0){
          await MessageStatus.update(
            { status: 'delivered' },
            { where: { message_id: messageIds, user_id: userId, status: 'sent'}}
            );

          for (const status of undeliveredStatuses) {
            const senderId = status.message.sender_id;
            io.to(`user_${senderId}`).emit('message-status-updated', {
              messageId: status.message_id, userId, status: 'delivered',
            });
          }
        }
      } catch (error) {
        console.error(`Error wile joining room`, error);
        return;
      }
    });

    socket.on('request-status-update', async () => {
      const userId = socket.userId;
      if(!userId){
        console.error('No userId for request-status-update');
        return;
      }

      try {
        const allUsersFromDb = await User.findAll({
          attributes: ['id', 'is_online', 'last_seen'],
          include: [{
            model: UserSetting,
            as: 'setting',
            attributes: ['last_seen'],
            required: false
          }]
        });

        const allUsers = allUsersFromDb.map((user) => {
          const shouldShowLastSeen = !user.setting || user.setting.last_seen !== false;
          return {
            userId: user.id,
            status: user.is_online ? 'online' : 'offline',
            lastSeen: shouldShowLastSeen && user.last_seen ? user.last_seen.toISOString() : null,
          };
        }).filter((u) => u.userId !== userId);

        socket.emit('bulk-user-status-update', allUsers);
        console.log(`Sent status update for user ${userId}`);
      } catch (error) {
        console.error(`Error fetching status update for user ${userId}:`, error);
      }
    });

    socket.on('set-online', async () => {
      const userId = socket.userId;
      if(userId){
        try {
          await updateUserStatus(userId, 'online');

          socket.broadcast.emit('user-status-update', {
            userId, status: 'online', lastSeen: null
          });
        } catch (error) {
          console.error(`Error setting user ${userId} to online`, error);
        }
      }
    });

    socket.on('join-call', async (data) => {
      const { callId, user } = data;
      const userId = socket.userId;

      try {
        await CallParticipant.update(
          { 
            peer_id: socket.id,
            is_video_enabled: user.isVideoEnabled || false,
            is_muted: !user.isAudioEnabled
          },
          { where: { call_id: callId, user_id: userId } }
        );

        userCalls.set(userId, callId);

        const call = await Call.findByPk(callId, { attributes: ['initiator_id'] });
        if (!call) {
          console.error(`Call ${callId} not found`);
          return;
        }

        const participants = await CallParticipant.findAll({
          where: { 
            call_id: callId, 
            status: 'joined',
            user_id: { [Op.ne]: userId }
          },
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }]
        });

        participants.forEach(participant => {
          io.to(`user_${participant.user_id}`).emit('participant-joined', {
            callId,
            userId: parseInt(userId, 10),
            user: { 
              ...user, 
              socketId: socket.id,
              userId: parseInt(userId, 10)
            }
          });
        });

        const whereCondition = {
          call_id: callId, 
          status: 'joined',
          user_id: { [Op.ne]: userId }
        };
        
        if (userId !== call.initiator_id) {
          whereCondition.user_id = { 
            [Op.and]: [
              { [Op.ne]: userId },
              { [Op.ne]: call.initiator_id }
            ]
          };
        }
        
        const allParticipants = await CallParticipant.findAll({
          where: whereCondition,
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar'] }]
        });

        const participantsWithSocket = allParticipants.map(participant => ({
          userId: parseInt(participant.user_id, 10),
          socketId: participant.peer_id,
          name: participant.user.name,
          avatar: participant.user.avatar,
          joinedAt: participant.joined_at,
          isAudioEnabled: !participant.is_muted,
          isVideoEnabled: participant.is_video_enabled,
          isScreenSharing: participant.is_screen_sharing,
        }));

        socket.emit('call-participants-sync', {
          callId,
          participants: participantsWithSocket
        });

        console.log(`User ${userId} joined call ${callId}`);
      } catch (error) {
        console.error('Error in join-call:', error);
      }
    });

    socket.on('decline-call', async (data) => {
      const { callId } = data;
      const userId = socket.userId;

      try {
        await CallParticipant.update(
          { peer_id: socket.id },
          { where: { call_id: callId, user_id: userId } }
        );

        console.log(`User ${userId} socket registered for decline call ${callId}`);
          
      } catch (error) {
        console.error('Error in decline-call socket event:', error);
      }
    });

    socket.on('toggle-audio', async (data) => {
      const { callId, isAudioEnabled } = data;
      const userId = socket.userId;

      try {
        await CallParticipant.update(
          { is_muted: !isAudioEnabled },
          { where: { call_id: callId, user_id: userId } }
        );

        const participants = await CallParticipant.findAll({
          where: { 
            call_id: callId, 
            status: 'joined',
            user_id: { [Op.ne]: userId }
          }
        });

        participants.forEach(participant => {
          io.to(`user_${participant.user_id}`).emit('participant-toggle-audio', {
            callId,
            userId: parseInt(userId, 10),
            isAudioEnabled,
          });
        });
      } catch (error) {
        console.error('Error toggling audio:', error);
      }
    });

    socket.on('toggle-video', async (data) => {
      const { callId, isVideoEnabled } = data;
      const userId = socket.userId;

      try {
        await CallParticipant.update(
          { is_video_enabled: isVideoEnabled },
          { where: { call_id: callId, user_id: userId } }
        );

        const participants = await CallParticipant.findAll({
          where: { 
            call_id: callId, 
            status: 'joined',
            user_id: { [Op.ne]: userId }
          }
        });

        participants.forEach(participant => {
          io.to(`user_${participant.user_id}`).emit('participant-toggle-video', {
            callId,
            userId: parseInt(userId, 10),
            isVideoEnabled,
          });
        });
      } catch (error) {
        console.error('Error toggling video:', error);
      }
    });

    socket.on('leave-call', async (data) => {
      const { callId } = data;
      const userId = socket.userId;

      try {
        await CallParticipant.update(
          { peer_id: null }, { where: { call_id: callId, user_id: userId } }
        );

        userCalls.delete(userId);
        console.log(`User ${userId} left call ${callId}`);
      } catch (error) {
        console.error('Error in leave-call:', error);
      }
    }); 
    
    socket.on('webrtc-offer', (data) => {
      const { callId, targetUserId, offer } = data;
      const fromUserId = socket.userId;
      io.to(`user_${targetUserId}`).emit('webrtc-offer', { 
        callId, 
        fromUserId: parseInt(fromUserId, 10),
        offer 
      });
    });

    socket.on('webrtc-answer', (data) => {
      const { callId, targetUserId, answer } = data;
      const fromUserId = socket.userId;
      io.to(`user_${targetUserId}`).emit('webrtc-answer', { 
        callId, 
        fromUserId: parseInt(fromUserId, 10),
        answer 
      });
    });

    socket.on('ice-candidate', (data) => {
      const { callId, targetUserId, candidate } = data;
      const fromUserId = socket.userId;
      io.to(`user_${targetUserId}`).emit('ice-candidate', { 
        callId, 
        fromUserId: parseInt(fromUserId, 10),
        candidate 
      });
    });

    async function notifyFriends(userId, isOnline) {
      try {
        const friendships = await Friend.findAll({
          where: {
            [Op.or]: [
              { user_id: userId, status: 'accepted' }, { friend_id: userId, status: 'accepted' }
            ]
          }
        });
  
        const userSetting = await UserSetting.findOne({
          where: { user_id: userId },
          attributes: ['last_seen']
        });
        
        const shouldShowLastSeen = !userSetting || userSetting.last_seen !== false;
        
        friendships.forEach(f => {
          const friendId = f.user_id === userId ? f.friend_id : f.user_id;
          io.to(`user_${friendId}`).emit('friendStatusUpdate', {
            userId, 
            isOnline, 
            lastSeen: (isOnline || !shouldShowLastSeen) ? null : new Date()
          });
        });
      } catch (err) {
        console.error('Error notifying friends:', err);
      }
    };

    // ==== General Events ====
    socket.on('typing', async (data) => {
      const userSetting = await UserSetting.findOne({
        where: { user_id: data.userId },
        attributes: ['typing_indicator']
      });
      
      if (userSetting && userSetting.typing_indicator === false) {
        return;
      }
      
      if (data.groupId) {
        socket.to(`group_${data.groupId}`).emit('typing', {
          groupId: data.groupId,
          userId: data.userId,
          userName: data.userName,
          isTyping: data.isTyping,
        });
        console.log(`Typing indicator sent to group_${data.groupId}`);
      } else if (data.recipientId && data.senderId) {
        io.to(`user_${data.recipientId}`).emit('typing', {
          senderId: data.senderId,
          recipientId: data.recipientId,
          userId: data.userId,
          userName: data.userName,
          isTyping: data.isTyping,
        });
        console.log(
          `Direct typing indicator sent from user_${data.senderId} to user_${data.recipientId}`
        );
      }
    });

    socket.on('member-added-to-group', ({ groupId, userIds, group }) => {
      userIds.forEach((userId) => {
        io.to(`user_${userId}`).emit('group-added', group);

        const memberSocketIds = userSockets.get(userId);
        if (memberSocketIds) {
          memberSocketIds.forEach((memberSocketId) => {
            const memberSocket = io.sockets.sockets.get(memberSocketId);
            if (memberSocket) {
              memberSocket.join(`group_${groupId}`);
              console.log(
                `User ${userId} auto-joined group_${groupId} after being added`
              );
            }
          });
        }
      });

      io.to(`group_${groupId}`).emit('member-added-to-group', {
        groupId, newMemberIds: userIds, group,
      });
    });

    socket.on('message-delivered', async ({ messageId, senderId }) => {
      const userId = socket.userId;
      if (!userId || !messageId || !senderId) return;

      try {
        const message = await Message.findOne({
          where: { id: messageId, sender_id: senderId },
          attributes: ['id', 'sender_id', 'recipient_id', 'group_id'],
        });

        if (!message) {
          console.warn(`Message ${messageId} not found or doesn't belong to sender ${senderId}`);
          return;
        }

        const [affectedCount] = await MessageStatus.update(
          { status: 'delivered', updated_at: new Date() },
          { where: { message_id: messageId, user_id: userId, status: 'sent' }}
        );

        if (affectedCount > 0) {
          io.to(`user_${senderId}`).emit('message-status-updated', {
            messageId,
            userId: userId,
            status: 'delivered',
            updated_at: new Date().toISOString(),
          });
        }
      } catch (error) {
        console.error('Error updating message delivered status:', error);
      }
    });

    socket.on('mark-last-message-seen', async ({ lastMessageId, groupId, recipientId }) => {
      if (!lastMessageId || !socket.userId) return; 

      try {
        const lastMessage = await Message.findOne({
          where: { id: lastMessageId },
          attributes: ['id', 'created_at', 'group_id', 'sender_id', 'recipient_id'],
        });

        if (!lastMessage) return;

        let whereCondition = {};
        const created_at = { [Op.lte]: lastMessage.created_at };

        if (groupId) {
          whereCondition = { group_id: groupId, created_at };
        } else if (recipientId) {
          whereCondition = {
            [Op.or]: [
              { sender_id: socket.userId, recipient_id: recipientId, created_at },
              { sender_id: recipientId, recipient_id: socket.userId, created_at },
            ],
          };
        } else {
          if (lastMessage.group_id) {
            whereCondition = { group_id: lastMessage.group_id, created_at };
          } else if (lastMessage.sender_id && lastMessage.recipient_id) {
            whereCondition = {
              [Op.or]: [
                { sender_id: lastMessage.sender_id, recipient_id: lastMessage.recipient_id, created_at },
                { sender_id: lastMessage.recipient_id, recipient_id: lastMessage.sender_id, created_at },
              ],
            };
          }
        }

        const messagesToMark = await Message.findAll({
          where: whereCondition, 
          attributes: ['id', 'sender_id', 'group_id'],
        });

        if (messagesToMark.length === 0) return;

        const messageIds = messagesToMark.map((m) => m.id);

        const [deliveredUpdated] = await MessageStatus.update(
          { status: 'delivered', updated_at: new Date() },
          { 
            where: { 
              message_id: messageIds, 
              user_id: socket.userId, 
              status: 'sent' 
            }
          }
        );

        const [seenUpdated] = await MessageStatus.update(
          { status: 'seen', updated_at: new Date() },
          { 
            where: { 
              message_id: messageIds, 
              user_id: socket.userId, 
              status: { [Op.ne]: 'seen' }
            }
          }
        );

        const now = new Date();

        for (const msg of messagesToMark) {
          const disappearing = await MessageDisappearing.findOne({
            where: { message_id: msg.id }
          });

          if (!disappearing) continue;
          if (!disappearing.enabled) continue;
          if (disappearing.expire_at) continue;

          if (disappearing.expire_after_seconds === null) {
            await disappearing.update({ 
              expire_at: now,
              metadata: { immediate_disappear: true }
            });
          } else {
            const expireAt = new Date(now.getTime() + disappearing.expire_after_seconds * 1000);
            await disappearing.update({ expire_at: expireAt });
          }
        }

        const updatedStatuses = await MessageStatus.findAll({
          where: {
            message_id: messageIds,
            user_id: socket.userId,
          },
          attributes: ['message_id', 'status'],
        });

        messagesToMark.forEach((msg) => {
          if (msg.sender_id !== socket.userId) {
            io.to(`user_${msg.sender_id}`).emit('message-status-updated', {
              messageId: msg.id,
              userId: socket.userId,
              status: 'seen',
              updated_at: new Date().toISOString(),
            });
          }
        });

        if (groupId || lastMessage.group_id) {
          const groupIdToUse = groupId || lastMessage.group_id;
          const groupMembers = await GroupMember.findAll({
            where: { group_id: groupIdToUse, user_id: { [Op.ne]: socket.userId } },
            attributes: ['user_id'],
          });

          groupMembers.forEach((member) => {
            messagesToMark.forEach((msg) => {
              if (msg.sender_id === member.user_id) {
                const statusEntry = updatedStatuses.find((s) => s.message_id === msg.id);
                if (statusEntry) {
                  io.to(`user_${member.user_id}`).emit('message-status-updated', {
                    messageId: msg.id,
                    userId: socket.userId,
                    status: statusEntry.status,
                    updated_at: new Date().toISOString(),
                  });
                }
              }
            });
          });

          if (seenUpdated > 0 || deliveredUpdated > 0) {
            io.to(`user_${socket.userId}`).emit('messages-read', {
              groupId: groupIdToUse,
              readerId: socket.userId,
            });
          }
        } else {
          if ((seenUpdated > 0 || deliveredUpdated > 0) && recipientId) {
            io.to(`user_${socket.userId}`).emit('messages-read', {
              readerId: recipientId,
            });
          }
        }
      } catch (error) {
        console.error('Error updating message seen status:', error);
      }
    });
        
    socket.on('message-seen', async ({ messageIds, userId }) => {
      if (!Array.isArray(messageIds) || !socket.userId || messageIds.length === 0) return;

      try {
        await MessageStatus.update(
          { status: 'delivered', updated_at: new Date() },
          {
            where: {
              message_id: messageIds, user_id: socket.userId, status: 'sent',
            },
          }
        );

        const [affectedCount] = await MessageStatus.update(
          { status: 'seen', updated_at: new Date() },
          {
            where: {
              message_id: messageIds, user_id: socket.userId, status: { [Op.ne]: 'seen' },
            },
          }
        );

        for (const messageId of messageIds) {
          const disappearing = await MessageDisappearing.findOne({ where: { message_id: messageId }});

          if (!disappearing) continue;
          if (!disappearing.enabled) continue;
          if (disappearing.expire_at) continue;

          const expireAt = new Date(Date.now() + disappearing.expire_after_seconds * 1000);
          await disappearing.update({ expire_at: expireAt });
        }

        if (affectedCount > 0) {
          messageIds.forEach((messageId) => {
            io.to(`user_${userId}`).emit('message-status-updated', {
              messageId: messageId,
              userId: socket.userId,
              status: 'seen',
              updated_at: new Date().toISOString(),
            });
          });

          io.to(`user_${userId}`).emit('messages-read', {
            readerId: socket.userId,
          });
        }
      } catch (error) {
        console.error('Error updating message seen status:', error);
      }
    });
  
    socket.on('mark-messages-read', async ({ chatId, type }) => {
        const userId = socket.userId;
      if (!userId) return;

      try {
        if (type === 'group') {
          await MessageStatus.update(
            { status: 'seen' },
            {
              where: { user_id: userId, status: { [Op.ne]: 'seen' }},
              include: [
                { model: Message, as: 'message', where: { group_id: chatId }},
              ],
            }
          );
        } else {
          await MessageStatus.update(
            { status: 'seen' },
            {
              where: { user_id: userId, status: { [Op.ne]: 'seen' }},
              include: [
                {
                  model: Message,
                  as: 'message',
                  where: {[Op.or]: [
                      { sender_id: chatId, recipient_id: userId },
                      { sender_id: userId, recipient_id: chatId },
                  ]},
                },
              ],
            }
          );

          const readMessages = await MessageStatus.findAll({
            where: { user_id: userId, status: 'seen' },
            include: [{ model: Message, as: 'message' }]
          });

          for (const ms of readMessages) {
            const msg = ms.message;

            const disappearing = await MessageDisappearing.findOne({
              where: { message_id: msg.id }
            });

            if (!disappearing) continue;
            if (!disappearing.enabled) continue;
            if (disappearing.expire_at) continue;

            const expireAt = new Date(Date.now() + disappearing.expire_after_seconds * 1000);
            await disappearing.update({ expire_at: expireAt });
          }
        }

        if (type === 'direct') {
          io.to(`user_${chatId}`).emit('messages-read', { readerId: userId });
        } else {
          const groupMembers = await GroupMember.findAll({
            where: { group_id: chatId }, attributes: ['user_id'],
          });

          groupMembers.forEach((member) => {
            if (member.user_id !== userId) {
              io.to(`user_${member.user_id}`).emit('messages-read', {
                groupId: chatId, readerId: userId,
              });
            }
          });
        }
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    });
    
    socket.on('participant-left', (data) => {
      const { callId, userId, user } = data;
      socket.to(`user_${socket.userId}`).emit('participant-left', {
          callId,
          userId,
          user
      });

      console.log(`Broadcasted participant-left: User ${userId} left call ${callId}`);
    });

    socket.on('disconnect', async () => {
      const userId = socketUsers.get(socket.id);
      if (!userId) {
        console.log(`No userId associated with socket ${socket.id} on disconnect`);
        return;
      }

      try {
        const activeCallParticipant = await CallParticipant.findOne({
          where: { 
            user_id: userId, 
            status: 'joined',
            peer_id: socket.id
          },
          include: [{ 
            model: Call, 
            as: 'call', 
            where: { status: 'active' }
          }]
        });

        if (activeCallParticipant) {
          const callId = activeCallParticipant.call_id;
          console.log(`User ${userId} disconnected while in call ${callId}, cleaning up...`);

          await CallParticipant.update(
            { status: 'left', left_at: new Date().toISOString() },
            { where: { call_id: callId, user_id: userId } }
          );

          const remainingParticipants = await CallParticipant.findAll({
            where: { call_id: callId, status: 'joined' }
          });

          const shouldEndCall = remainingParticipants.length < 2;

          if (shouldEndCall) {
            const call = await Call.findByPk(callId);
            const endTime = new Date();
            let duration = 0;

            const realJoiners = remainingParticipants.filter(
              (p) => p.user_id !== call.initiator_id
            );

            if (realJoiners.length > 0) {
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

            const allParticipants = await CallParticipant.findAll({
              where: { call_id: callId }
            });

            allParticipants.forEach(participant => {
              io.to(`user_${participant.user_id}`).emit('call-ended', { 
                callId, 
                reason: 'disconnect', 
                duration: duration 
              });
            });

            console.log(`Call ${callId} ended due to disconnect of user ${userId}`);
          } else {
            remainingParticipants.forEach(participant => {
              if (participant.user_id !== userId) {
                io.to(`user_${participant.user_id}`).emit('participant-left', {
                  callId,
                  userId: parseInt(userId, 10),
                  reason: 'disconnect'
                });
              }
            });
          }
        }
      } catch (error) {
        console.error(`Error cleaning up call for disconnected user ${userId}:`, error);
      }

      if (userSockets.has(userId)) {
        const socketSet = userSockets.get(userId);
        socketSet.delete(socket.id);

        if (socketSet.size === 0) {
          userSockets.delete(userId);
          try {
            await updateUserStatus(userId, 'offline');
            socket.broadcast.emit('user-status-update', {
              userId, status: 'offline', lastSeen: new Date().toISOString(),
            });
            console.log(`User ${userId} went offline`);
          } catch (error) {
            console.error(`Error updating user ${userId} to offline:`, error);
          }
        } else {
          console.log(`User ${userId} still online with ${socketSet.size} active session(s)`);
        }
      }
  
      socketUsers.delete(socket.id);
      notifyFriends(userId, false);
      console.log(`Socket ${socket.id} disconnected for user ${userId}`);
    });
  });
};