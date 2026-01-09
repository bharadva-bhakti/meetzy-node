'use strict';

const { db } = require('../models');
const User = db.User;
const Message = db.Message;
const MessageStatus = db.MessageStatus;
const GroupMember = db.GroupMember;
const Friend = db.Friend;
const Call = db.Call;
const CallParticipant = db.CallParticipant;
const UserSetting = db.UserSetting;
const MessageDisappearing = db.MessageDisappearing;
const Block = db.Block;
const mongoose = require('mongoose');
const { updateUserStatus } = require('../utils/userStatusHelper');

const resetOnlineStatuses = async () => {
  const now = new Date();
  await User.updateMany({ is_online: true }, { is_online: false, last_seen: now });
};

resetOnlineStatuses();

module.exports = function initSocket(io) {
  const userSockets = new Map(); 
  const socketUsers = new Map(); 
  const userCalls = new Map();   

  io.on('connection', (socket) => {
    socket.on('join-room', async (userId) => {
      if (!userId) {
        console.error('No user Id provided for join room.');
        return;
      }

      try {
        const user = await User.findById(userId).select('id').lean();
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
          const userGroups = await GroupMember.find({ user_id: userId }).select('group_id').lean();

          for (const gm of userGroups) {
            const isBlocked = await Block.findOne({
              blocker_id: userId,
              group_id: gm.group_id,
              block_type: 'group',
            }).lean();

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

          const allUsersFromDb = await User.aggregate([
            {
              $lookup: {
                from: 'user_settings',
                localField: '_id',
                foreignField: 'user_id',
                as: 'setting',
              },
            },
            { $unwind: { path: '$setting', preserveNullAndEmptyArrays: true } },
            {
              $project: {
                id: '$_id',
                is_online: 1,
                last_seen: 1,
                'setting.last_seen': 1,
              },
            },
          ]).exec();

          const allUsers = allUsersFromDb
            .map((user) => {
              const shouldShowLastSeen = !user.setting || user.setting.last_seen !== false;
              return {
                userId: user.id.toString(),
                status: user.is_online ? 'online' : 'offline',
                lastSeen: shouldShowLastSeen && user.last_seen ? user.last_seen.toISOString() : null,
              };
            })
            .filter((u) => u.userId !== userId.toString());

          if (allUsers.length > 0) {
            socket.emit('bulk-user-status-update', allUsers);
          }

          socket.broadcast.emit('user-status-update', {
            userId: userId.toString(),
            status: 'online',
            lastSeen: null,
          });
        } catch (error) {
          console.error(`Error updating status for user ${userId}:`, error);
        }

        const undeliveredStatuses = await MessageStatus.find({
          user_id: userId,
          status: 'sent',
        })
          .populate({
            path: 'message_id',                    // ← Correct field name
            select: 'sender_id',                   // Only need sender_id
          })
          .lean();
        
        const messageIds = undeliveredStatuses.map((ms) => ms.message_id?._id || ms.message_id);
        
        if (messageIds.length > 0) {
          await MessageStatus.updateMany(
            { message_id: { $in: messageIds }, user_id: userId, status: 'sent' },
            { status: 'delivered' }
          );
        
          for (const status of undeliveredStatuses) {
            // After population, message_id is now the full Message document
            const senderId = status.message_id?.sender_id?.toString();
            
            if (senderId) {
              io.to(`user_${senderId}`).emit('message-status-updated', {
                messageId: status.message_id._id.toString(),  // or status.message_id.id if using virtuals
                userId: userId.toString(),
                status: 'delivered',
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error while joining room`, error);
      }
    });

    socket.on("request-status-update", async () => {
      const userId = socket.userId;
      if (!userId) {
        console.error("No userId for request-status-update");
        return;
      }

      try {
        // Fetch all users with only needed fields
        const allUsersFromDb = await User.find({})
          .select("_id is_online last_seen setting.last_seen") // Use _id instead of id
          .lean();

        const allUsers = allUsersFromDb
          .map((user) => {
            // Safely get userId from _id (handles cases where _id might be missing)
            const userIdStr = user._id ? user._id.toString() : null;

            if (!userIdStr) {
              console.warn(`User document missing _id:`, user);
              return null; // Skip invalid users
            }

            // Check if user has setting and if last_seen is allowed
            const shouldShowLastSeen = !user.setting || user.setting.last_seen !== false;

            return {
              userId: userIdStr,
              status: user.is_online ? "online" : "offline",
              lastSeen: shouldShowLastSeen && user.last_seen ? user.last_seen.toISOString() : null,
            };
          })
          .filter((u) => u !== null && u.userId !== userId.toString()); // Remove nulls and exclude self

        socket.emit("bulk-user-status-update", allUsers);
        console.log(`Sent status update to user ${userId} (${allUsers.length} users)`);
      } catch (error) {
        console.error(`Error fetching status update for user ${userId}:`, error);
        socket.emit("bulk-user-status-update-error", { message: "Failed to fetch user statuses" });
      }
    });

    socket.on('set-online', async () => {
      const userId = socket.userId;
      if (userId) {
        try {
          await updateUserStatus(userId, 'online');

          socket.broadcast.emit('user-status-update', {
            userId: userId.toString(),
            status: 'online',
            lastSeen: null,
          });
        } catch (error) {
          console.error(`Error setting user ${userId} to online`, error);
        }
      }
    });
    
    socket.on('join-call', async (data) => {
      const { callId, user } = data;
      const userId = socket.userId; // string ObjectId
    
      try {
        if (!mongoose.Types.ObjectId.isValid(callId)) {
          console.error(`Invalid callId: ${callId}`);
          return;
        }
    
        // Update peer_id and media states
        await CallParticipant.updateOne(
          {
            call_id: new mongoose.Types.ObjectId(callId),
            user_id: new mongoose.Types.ObjectId(userId)
          },
          {
            $set: {
              peer_id: socket.id,
              is_video_enabled: user.isVideoEnabled || false,
              is_muted: !user.isAudioEnabled
            }
          }
        );
    
        userCalls.set(userId, callId);
    
        // Fetch only needed call fields: initiator_id and call_mode
        const call = await Call.findById(callId)
          .select('initiator_id call_mode')
          .lean();
    
        if (!call) {
          console.error(`Call ${callId} not found`);
          return;
        }
    
        // === Fetch joined participants EXCEPT current user (to notify them) ===
        const participantsForNotify = await CallParticipant.aggregate([
          {
            $match: {
              call_id: new mongoose.Types.ObjectId(callId),
              status: 'joined',
              user_id: { $ne: new mongoose.Types.ObjectId(userId) }
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user_id',
              foreignField: '_id',
              as: 'user',
              pipeline: [{ $project: { _id: 1, name: 1, avatar: 1 } }]
            }
          },
          { $unwind: '$user' },
          { $project: { user_id: 1, user: 1 } }
        ]);
    
        // Notify each other participant
        participantsForNotify.forEach(participant => {
          io.to(`user_${participant.user_id}`).emit('participant-joined', {
            callId,
            userId: userId,
            user: {
              ...user,
              socketId: socket.id,
              userId: userId
            }
          });
        });
    
        // === Build match condition for participants to sync back to joining user ===
        let matchCondition = {
          call_id: new mongoose.Types.ObjectId(callId),
          status: 'joined',
          user_id: { $ne: new mongoose.Types.ObjectId(userId) }
        };
    
        // Special direct call rule: if joiner is not initiator, exclude initiator from sync list
        if (call.call_mode === 'direct' && userId !== call.initiator_id.toString()) {
          matchCondition.user_id = {
            $nin: [
              new mongoose.Types.ObjectId(userId),
              call.initiator_id
            ]
          };
        }
    
        // === Fetch participants for sync using aggregation + lookup ===
        const allParticipants = await CallParticipant.aggregate([
          { $match: matchCondition },
          {
            $lookup: {
              from: 'users',
              localField: 'user_id',
              foreignField: '_id',
              as: 'user',
              pipeline: [{ $project: { name: 1, avatar: 1 } }]
            }
          },
          { $unwind: '$user' },
          {
            $project: {
              user_id: 1,
              peer_id: 1,
              joined_at: 1,
              is_muted: 1,
              is_video_enabled: 1,
              is_screen_sharing: 1,
              'user.name': 1,
              'user.avatar': 1
            }
          }
        ]);
    
        // Map to exact same format as original Sequelize code
        const participantsWithSocket = allParticipants.map(participant => ({
          userId: participant.user_id.toString(),
          socketId: participant.peer_id || null,
          name: participant.user.name,
          avatar: participant.user.avatar,
          joinedAt: participant.joined_at,
          isAudioEnabled: !participant.is_muted,
          isVideoEnabled: participant.is_video_enabled,
          isScreenSharing: participant.is_screen_sharing || false,
        }));
    
        // Send sync to the joining user
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
        await CallParticipant.updateOne(
          { call_id: callId, user_id: userId },
          { peer_id: socket.id }
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
        await CallParticipant.updateOne(
          { call_id: callId, user_id: userId },
          { is_muted: !isAudioEnabled }
        );

        const participants = await CallParticipant.find({
          call_id: callId,
          status: 'joined',
          user_id: { $ne: userId },
        }).lean();

        participants.forEach((participant) => {
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
        await CallParticipant.updateOne(
          { call_id: callId, user_id: userId },
          { is_video_enabled: isVideoEnabled }
        );

        const participants = await CallParticipant.find({
          call_id: callId,
          status: 'joined',
          user_id: { $ne: userId },
        }).lean();

        participants.forEach((participant) => {
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
        await CallParticipant.updateOne(
          { call_id: callId, user_id: userId },
          { peer_id: null }
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
        offer,
      });
    });

    socket.on('webrtc-answer', (data) => {
      const { callId, targetUserId, answer } = data;
      const fromUserId = socket.userId;
      io.to(`user_${targetUserId}`).emit('webrtc-answer', {
        callId,
        fromUserId: parseInt(fromUserId, 10),
        answer,
      });
    });

    socket.on('ice-candidate', (data) => {
      const { callId, targetUserId, candidate } = data;
      const fromUserId = socket.userId;
      io.to(`user_${targetUserId}`).emit('ice-candidate', {
        callId,
        fromUserId: parseInt(fromUserId, 10),
        candidate,
      });
    });

    async function notifyFriends(userId, isOnline) {
      try {
        const friendships = await Friend.find({
          $or: [
            { user_id: userId, status: 'accepted' },
            { friend_id: userId, status: 'accepted' },
          ],
        }).lean();

        const userSetting = await UserSetting.findOne({ user_id: userId }).select('last_seen').lean();

        const shouldShowLastSeen = !userSetting || userSetting.last_seen !== false;

        friendships.forEach((f) => {
          const friendId = f.user_id.toString() === userId.toString() ? f.friend_id : f.user_id;
          io.to(`user_${friendId}`).emit('friendStatusUpdate', {
            userId: userId.toString(),
            isOnline,
            lastSeen: isOnline || !shouldShowLastSeen ? null : new Date(),
          });
        });
      } catch (err) {
        console.error('Error notifying friends:', err);
      }
    }

    // ==== General Events ====
    socket.on('typing', async (data) => {
      const userSetting = await UserSetting.findOne({ user_id: data.userId }).select('typing_indicator').lean();

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
        console.log(`Direct typing indicator sent from user_${data.senderId} to user_${data.recipientId}`);
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
              console.log(`User ${userId} auto-joined group_${groupId} after being added`);
            }
          });
        }
      });

      io.to(`group_${groupId}`).emit('member-added-to-group', {
        groupId,
        newMemberIds: userIds,
        group,
      });
    });

    socket.on('message-delivered', async ({ messageId, senderId }) => {
      const userId = socket.userId;
      if (!userId || !messageId) return;
    
      // Safely extract the actual ID string
      let senderIdStr = senderId;
      if (typeof senderId === 'object' && senderId !== null) {
        senderIdStr = senderId.id || senderId._id || senderId.userId;
      }
    
      // Validate it's a proper ObjectId string
      if (!senderIdStr || !mongoose.Types.ObjectId.isValid(senderIdStr)) {
        console.warn('Invalid or missing senderId in message-delivered:', senderId);
        return;
      }
    
      try {
        const message = await Message.findOne({
          _id: messageId,
          sender_id: senderIdStr,  // now a valid string/ObjectId
        }).select('sender_id recipient_id group_id').lean();
    
        if (!message) {
          console.warn(`Message ${messageId} not found or not sent by ${senderIdStr}`);
          return;
        }
    
        const result = await MessageStatus.updateMany(
          { message_id: messageId, user_id: userId, status: 'sent' },
          { status: 'delivered', updated_at: new Date() }
        );
    
        if (result.modifiedCount > 0) {
          io.to(`user_${senderIdStr}`).emit('message-status-updated', {
            messageId: messageId.toString(),
            userId: userId.toString(),
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
        const lastMessage = await Message.findById(lastMessageId)
          .select('id created_at group_id sender_id recipient_id')
          .lean();

        if (!lastMessage) return;

        let query = {};
        if (groupId) {
          query = { group_id: groupId, created_at: { $lte: lastMessage.created_at } };
        } else if (recipientId) {
          query = {
            $or: [
              { sender_id: socket.userId, recipient_id: recipientId },
              { sender_id: recipientId, recipient_id: socket.userId },
            ],
            created_at: { $lte: lastMessage.created_at },
          };
        } else {
          if (lastMessage.group_id) {
            query = { group_id: lastMessage.group_id, created_at: { $lte: lastMessage.created_at } };
          } else {
            query = {
              $or: [
                { sender_id: lastMessage.sender_id, recipient_id: lastMessage.recipient_id },
                { sender_id: lastMessage.recipient_id, recipient_id: lastMessage.sender_id },
              ],
              created_at: { $lte: lastMessage.created_at },
            };
          }
        }

        const messagesToMark = await Message.find(query).select('id sender_id group_id').lean();

        if (messagesToMark.length === 0) return;

        const messageIds = messagesToMark.map((m) => m._id);

        await MessageStatus.updateMany(
          { message_id: { $in: messageIds }, user_id: socket.userId, status: 'sent' },
          { status: 'delivered', updated_at: new Date() }
        );

        await MessageStatus.updateMany(
          { message_id: { $in: messageIds }, user_id: socket.userId, status: { $ne: 'seen' } },
          { status: 'seen', updated_at: new Date() }
        );

        const now = new Date();

        for (const msg of messagesToMark) {
          const disappearing = await MessageDisappearing.findOne({ message_id: msg._id }).lean();

          if (!disappearing || !disappearing.enabled || disappearing.expire_at) continue;

          if (disappearing.expire_after_seconds === null) {
            await MessageDisappearing.updateOne(
              { message_id: msg._id },
              { expire_at: now, metadata: { immediate_disappear: true } }
            );
          } else {
            const expireAt = new Date(now.getTime() + disappearing.expire_after_seconds * 1000);
            await MessageDisappearing.updateOne(
              { message_id: msg._id },
              { expire_at: expireAt }
            );
          }
        }

        messagesToMark.forEach((msg) => {
          if (msg.sender_id.toString() !== socket.userId.toString()) {
            io.to(`user_${msg.sender_id}`).emit('message-status-updated', {
              messageId: msg._id.toString(),
              userId: socket.userId.toString(),
              status: 'seen',
              updated_at: new Date().toISOString(),
            });
          }
        });

        const targetGroupId = groupId || lastMessage.group_id;
        if (targetGroupId) {
          const groupMembers = await GroupMember.find({ group_id: targetGroupId })
            .select('user_id')
            .lean();

          groupMembers.forEach((member) => {
            if (member.user_id.toString() !== socket.userId.toString()) {
              io.to(`user_${member.user_id}`).emit('messages-read', {
                groupId: targetGroupId.toString(),
                readerId: socket.userId.toString(),
              });
            }
          });
        } else if (recipientId) {
          io.to(`user_${recipientId}`).emit('messages-read', { readerId: socket.userId.toString() });
        }
      } catch (error) {
        console.error('Error updating message seen status:', error);
      }
    });

    socket.on('message-seen', async ({ messageIds, userId }) => {
      if (!Array.isArray(messageIds) || !socket.userId || messageIds.length === 0) return;

      try {
        await MessageStatus.updateMany(
          { message_id: { $in: messageIds }, user_id: socket.userId, status: 'sent' },
          { status: 'delivered', updated_at: new Date() }
        );

        const result = await MessageStatus.updateMany(
          { message_id: { $in: messageIds }, user_id: socket.userId, status: { $ne: 'seen' } },
          { status: 'seen', updated_at: new Date() }
        );

        for (const messageId of messageIds) {
          const disappearing = await MessageDisappearing.findOne({ message_id: messageId }).lean();

          if (disappearing && disappearing.enabled && !disappearing.expire_at) {
            const expireAt = new Date(Date.now() + disappearing.expire_after_seconds * 1000);
            await MessageDisappearing.updateOne(
              { message_id: messageId },
              { expire_at: expireAt }
            );
          }
        }

        if (result.modifiedCount > 0) {
          messageIds.forEach((messageId) => {
            io.to(`user_${userId}`).emit('message-status-updated', {
              messageId: messageId.toString(),
              userId: socket.userId.toString(),
              status: 'seen',
              updated_at: new Date().toISOString(),
            });
          });

          io.to(`user_${userId}`).emit('messages-read', {
            readerId: socket.userId.toString(),
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
        let query = { user_id: userId, status: { $ne: 'seen' } };

        if (type === 'group') {
          query['message.group_id'] = chatId;
        } else {
          query.$or = [
            { 'message.sender_id': chatId, 'message.recipient_id': userId },
            { 'message.sender_id': userId, 'message.recipient_id': chatId },
          ];
        }

        await MessageStatus.updateMany(query, { status: 'seen' });

        if (type === 'direct') {
          io.to(`user_${chatId}`).emit('messages-read', { readerId: userId.toString() });
        } else {
          const groupMembers = await GroupMember.find({ group_id: chatId }).select('user_id').lean();
          groupMembers.forEach((member) => {
            if (member.user_id.toString() !== userId.toString()) {
              io.to(`user_${member.user_id}`).emit('messages-read', {
                groupId: chatId.toString(),
                readerId: userId.toString(),
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
        user,
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
          user_id: userId,
          status: 'joined',
          peer_id: socket.id,
        })
          .populate({
            path: 'call',
            match: { status: 'active' },
          })
          .lean();

        if (activeCallParticipant && activeCallParticipant.call) {
          const callId = activeCallParticipant.call_id.toString();
          console.log(`User ${userId} disconnected while in call ${callId}, cleaning up...`);

          await CallParticipant.updateOne(
            { call_id: callId, user_id: userId },
            { status: 'left', left_at: new Date() }
          );

          const remainingParticipants = await CallParticipant.find({
            call_id: callId,
            status: 'joined',
          }).lean();

          const shouldEndCall = remainingParticipants.length < 2;

          if (shouldEndCall) {
            const call = await Call.findById(callId).lean();
            const endTime = new Date();
            let duration = 0;

            const realJoiners = remainingParticipants.filter((p) => p.user_id.toString() !== call.initiator_id.toString());

            if (realJoiners.length > 0) {
              const startTime = call.accepted_time || call.started_at;
              duration = Math.max(1, Math.floor((endTime - new Date(startTime)) / 1000));
            }

            await Call.updateOne(
              { _id: callId },
              { status: 'ended', ended_at: endTime, duration }
            );

            await CallParticipant.updateMany(
              { call_id: callId, status: 'joined' },
              { status: 'left', left_at: endTime }
            );

            await CallParticipant.updateMany(
              { call_id: callId, status: 'invited' },
              { status: 'missed' }
            );

            const allParticipants = await CallParticipant.find({ call_id: callId }).lean();

            allParticipants.forEach((participant) => {
              io.to(`user_${participant.user_id}`).emit('call-ended', {
                callId,
                reason: 'disconnect',
                duration,
              });
            });

            console.log(`Call ${callId} ended due to disconnect of user ${userId}`);
          } else {
            remainingParticipants.forEach((participant) => {
              if (participant.user_id.toString() !== userId.toString()) {
                io.to(`user_${participant.user_id}`).emit('participant-left', {
                  callId,
                  userId: parseInt(userId, 10),
                  reason: 'disconnect',
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
              userId: userId.toString(),
              status: 'offline',
              lastSeen: new Date().toISOString(),
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
      await notifyFriends(userId, false);
      console.log(`Socket ${socket.id} disconnected for user ${userId}`);
    });
  });
};