const { Notification, User, Friend } = require('../models');
const { Op } = require('sequelize');

async function isFriendWith(userId1, userId2) {
    const friendship = await Friend.findOne({
      where: {
        status: 'accepted',
        [Op.or]: [
          { user_id: userId1, friend_id: userId2 },
          { user_id: userId2, friend_id: userId1 }
        ]
      }
    });
    return !!friendship;
};

exports.fetchNotifications = async (req,res) => {
    const currentUserId = req.user?.id;
    const { page = 1, limit = 20} = req.query;
    const offset = (page - 1) * limit;

    try {
        const { count, rows: notifications } = await Notification.findAndCountAll({
            where: { user_id: currentUserId },
            attributes: ['id', 'user_id', 'from_user_id', 'type', 'title', 'message', 'is_read', 'read_at', 'created_at'],
            include: [{
                model: User,
                as: 'from_user',
                attributes: ['id', 'name', 'avatar'],
                required: false
            }],
            order: [['created_at', 'DESC']],
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        const enriched = await Promise.all(
            notifications.map(async (not) => {
                if(not.from_user){
                    const isFriend = await isFriendWith(currentUserId, not.from_user.id);
                    return {
                        ...not.toJSON(),
                        from_user: { ...not.from_user.toJSON(), is_friend: isFriend }
                    };
                }

                return not.toJSON();
            })
        );

        const totalPages = Math.ceil(count / limit);
        const hasMore = page < totalPages;

        res.status(200).json({
            notifications: enriched.filter(n => n.from_user?.is_friend === false),
            currentPage: parseInt(page),
            totalPages,
            totalCount: count,
            hasMore
        })
    } catch (error) {
        console.error('Error in fetchNotifications:', error);
        res.status(500).json({ message: 'Internal Server Error'});
    }
};

exports.getUnreadCount = async (req,res) => {
    const user_id = req.user.id;

    try {
        const count = await Notification.count({ where: { user_id, is_read: false }});

        return res.status(200).json({message: 'Unread count fetch successfully.', count});
    } catch (error) {
        console.error('Error in getUnreadCount:', error);
        res.status(500).json({ message: 'Internal Server Error'});
    }  
};

exports.markAsRead = async (req,res) => {
    const user_id = req.user.id;
    const { id } = req.params;
    
    try {
        const notification = await Notification.findOne({ where: { id, user_id }});
        if(!notification) return res.status(404).json({ message: 'Notification not found.'});

        await notification.update({ is_read: true, read_at: new Date()});

        return res.status(200).json({ message: 'Notification marked as read.'});
    } catch (error) {
        console.error('Error in markAsRead:', error);
        res.status(500).json({ message: 'Internal Server Error'});
    }
};

exports.markAllAsRead = async (req,res) => {
    const user_id = req.user.id;

    try {
        await Notification.update(
            { is_read: true, read_at: new Date()}, 
            { where: { user_id, is_read: false }}
        )

        return res.status(200).json({ message: 'All notification mark as read.'});
    } catch (error) {
        console.error('Error in markAllAsRead:', error);
        res.status(500).json({ message: 'Internal Server Error'});
    }
};

exports.deleteNotification = async (req,res) => {
    const currentUserId = req.user?.id;
    const { notificationId } = req.params;

    try {
        if(!currentUserId)return res.status(403).json({ message: 'Unauthorized!' });

        const notification = await Notification.findByPk(notificationId);
        if(!notification) return res.status(404).json({ message: 'Notification Not Found.' });

        await notification.destroy();
        return res.status(200).json({ message: 'Notification Deleted' })
    } catch (error) {
        console.error('Error in fetchNotifications:', error);
        res.status(500).json({ message: 'Internal Server Error'});
    }
};