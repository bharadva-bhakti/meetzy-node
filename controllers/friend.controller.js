const { User, Friend, Message, Archive, Favorite, Block, sequelize, Notification, UserSetting } = require('../models');
const { Op } = require('sequelize');
const { fetchFriendSuggestions } = require('../helper/chatHelpers');

exports.getFriendSuggestions = async (req,res) => {
    const currentUserId = req.user?.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;    

    try {
        const {suggestions, pagination} = await fetchFriendSuggestions(currentUserId, { page, limit });
        
        res.status(200).json({ suggestions, ...pagination});
    } catch (error) {
        console.error('Error in getFriendSuggestions:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getPendingRequests = async (req, res) => {
    const currentUserId = req.user?.id;

    try {
        const pendingRequests = await Friend.findAll({
            where: {
                friend_id: currentUserId,
                status: 'pending'
            },
            include: [
                {
                    model: User,
                    as: 'requested',
                    attributes: ['id', 'bio', 'name', 'avatar', 'email']
                }
            ],
            order: [['created_at', 'DESC']]
        });

        const requestedUserIds = pendingRequests.map(req => req.requested?.id).filter(Boolean);
        const userSettings = await UserSetting.findAll({
            where: { user_id: { [Op.in]: requestedUserIds } },
            attributes: ['user_id', 'profile_pic'],
            raw: true
        });
        
        const settingsMap = new Map(userSettings.map(s => [s.user_id, s]));
        
        const requestsWithPrivacy = pendingRequests.map(req => {
            const requestedUser = req.requested;
            if (!requestedUser) return req.toJSON();
            
            const setting = settingsMap.get(requestedUser.id);
            const avatar = setting && setting.profile_pic === false ? null : (requestedUser.avatar || null);
            
            return {
                ...req.toJSON(),
                requested: {
                    ...requestedUser.toJSON(),
                    avatar: avatar
                }
            };
        });

        res.json({ requests: requestsWithPrivacy });

    } catch (error) {
        console.error('Error getting pending requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load pending requests'
        });
    }
};

exports.sendFriendRequest = async (req,res) => {
    const currentUserId = req.user?.id;
    const { friendId } = req.body;

    try {
        const user = await User.findByPk(friendId);
        if (!user) return res.status(404).json({ message: 'User Not Found.' });

        const existingFriendship = await Friend.findOne({
            where: {
                [Op.or]: [
                    { user_id: currentUserId, friend_id: friendId },
                    { user_id: friendId, friend_id: currentUserId }
                ],
            }
        });

        if (existingFriendship) {
            if (existingFriendship.status === 'pending') {
                return res.status(409).json({ message: 'Friend request already exists' });
            }
            
            if (existingFriendship.status === 'accepted') {
                return res.status(409).json({ message: 'You are already friends' });
            }
            
            if(existingFriendship.status === 'rejected') {
                await existingFriendship.destroy();
            }
        }
        await Friend.create({
            user_id: currentUserId,
            friend_id: friendId,
            status: 'pending',
            requested_by: currentUserId
        });

        const currentUser = await User.findByPk(currentUserId, {
            attributes: ['name', 'bio', 'avatar']
        });

        const notification = await Notification.create({
            user_id: friendId,
            from_user_id: currentUserId,
            type: 'friend_request',
            title: 'New Friend Request',
            message: `${currentUser.name} sent you a friend request.`,
            data: {
                friend_id: currentUserId,
                friend_name: currentUser.name,
                friend_avatar: currentUser.avatar
            }
        });

        const io = req.app.get('io');

        if (io) {
            io.to(`user_${friendId}`).emit('newNotification', {
                id: notification.id,
                type: 'friend_request',
                title: notification.title,
                message: notification.message,
                from_user: {
                    id: currentUserId,
                    name: currentUser.name,
                    avatar: currentUser.avatar
                },
                data: {
                    friend_id: currentUserId,
                    friend_name: currentUser.name,
                    friend_avatar: currentUser.avatar
                },
                created_at: notification.created_at
            });
        }

        res.status(201).json({ message: 'Friend Request Sent Successfully.' });
    } catch (error) {
        console.error('Error in sendFriendRequest:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.respondToFriendRequest = async (req,res) => {
    const currentUserId = req.user?.id;
    const { requestId, action } = req.body;

    try {
        const friendRequest = await Friend.findOne({
            where: { requested_by: requestId, friend_id: currentUserId, status: 'pending'},
            include: [{ model: User, as: 'requested', attributes: ['id', 'name', 'bio', 'avatar']}]
        });
        
        if(!friendRequest){
            return res.status(404).json({ message: 'Friend request not found.'});
        }

        const newStatus = action === 'accept' ? 'accepted' : 'rejected';
        await friendRequest.update({ status: newStatus });

        if(action === 'reject'){
            await Notification.update(
                {
                    type: 'friend_rejected',
                    title: 'You rejected a friend request',
                    message: `You rejected ${friendRequest.requested.name}'s friend request.`,
                    is_read: true,
                    read_at: new Date()
                },
                { 
                    where : {
                        user_id: currentUserId,
                        from_user_id: friendRequest.user_id,
                        type: 'friend_request'
                    }
                }
            );
        }

        if(action === 'accept'){
            await Friend.create({
                user_id: currentUserId,
                friend_id: friendRequest.user_id,
                status: 'accepted',
                requested_by: friendRequest.user_id
            });
        }

        const currentUser = await User.findByPk(currentUserId, {
            attributes: ['name', 'bio', 'avatar']
        });

        const notificationType = action === 'accept' ? 'friend_accepted' : 'friend_rejected';
        const notificationMessage = action === 'accept'
            ? `${currentUser.name} accepted your friend request`
            : `${currentUser.name} rejected your friend request`;

        const notification = await Notification.create({
            user_id: friendRequest.user_id,
            from_user_id: currentUserId,
            type: notificationType,
            title: action === 'accept' ? 'Friend Request Accepted' : 'Friend Request Rejected',
            message: notificationMessage,
            data: {
                friend_id: currentUserId,
                friend_name: currentUser.name,
                friend_avatar: currentUser.avatar
            }
        });

        const io = req.app.get('io');

        if (io) {
            io.to(`user_${friendRequest.user_id}`).emit('newNotification', {
                id: notification.id,
                type: notificationType,
                title: notification.title,
                message: notification.message,
                from_user: {
                    id: currentUserId,
                    name: currentUser.name,
                    avatar: currentUser.avatar
                },
                data: {
                    friend_id: currentUserId,
                    friend_name: currentUser.name,
                    friend_avatar: currentUser.avatar
                },
                created_at: notification.created_at
            });

            if (action === 'accept') {
                io.to(`user_${friendRequest.user_id}`).emit('friendListUpdated');
                io.to(`user_${currentUserId}`).emit('friendListUpdated');
            }
        }

        res.status(201).json({ message: `Friend request ${action}ed successfully`});
    } catch (error) {
        console.error('Error in respondToFriendRequest:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.searchFriendSuggestions = async (req,res) => {
    const currentUserId = req.user.id;
    const search = req.query.search?.toLowerCase() || '';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    try {
        const { suggestions, pagination } = await fetchFriendSuggestions(currentUserId, {
            search, page, limit
        });
      
        res.status(200).json({ suggestions, ...pagination });
    } catch (err) {
        console.error('Error in searchFriendSuggestions', err);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.unFriend = async (req,res) => {
    const userId = req.user.id;
    const { targetId, targetType } = req.body;

    try {
        if(!targetId || !targetType){
            return res.status(400).json({ message: 'Target Id and Type are required' });
        }

        if(targetType !== 'user'){
            return res.status(400).json({ message: 'Invalid Target Type. Only user unfriending is supported.'});
        }

        const friendship = await Friend.findOne({
            where: {
                [Op.or]: [
                    { user_id: userId, friend_id: targetId },
                    { user_id: targetId, friend_id: userId }
                ],
                status: 'accepted'
            }
        });

        if(!friendship){
            return res.status(404).json({message: 'Friendship not found or already removed'});
        }

        const friendConditions = [
            { user_id: userId, friend_id: targetId },
            { user_id: targetId, friend_id: userId }
        ];
  
        const messageConditions = [
            { sender_id: userId, recipient_id: targetId },
            { sender_id: targetId, recipient_id: userId }
        ];
    
        const favoriteArchiveConditions = [
            { user_id: userId, target_id: targetId, target_type: 'user' },
            { user_id: targetId, target_id: userId, target_type: 'user' }
        ];
  
        const blockConditions = [
            { blocker_id: userId, blocked_id: targetId },
            { blocker_id: targetId, blocked_id: userId }
        ];

        await sequelize.transaction(async (transaction) => {
            await Promise.all([
                Friend.destroy({ where: { [Op.or]: friendConditions }, transaction }),
                Message.destroy({ where: { [Op.or]: messageConditions }, transaction }),
                Favorite.destroy({ where: { [Op.or]: favoriteArchiveConditions }, transaction }),
                Archive.destroy({ where: { [Op.or]: favoriteArchiveConditions }, transaction }),
                Block.destroy({ where: { [Op.or]: blockConditions }, transaction }),
            ]);
        });

        const io = req.app.get('io');
        io.to(`user_${targetId}`).emit('friend_removed', {userId,targetId});

        res.status(200).json({ action: 'unfriend', message: 'Friend Removed Successfully' });
    } catch (error) {
        console.error('Error in unFriend:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};