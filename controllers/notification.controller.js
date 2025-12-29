const { db } = require('../models');
const Notification = db.Notification;
const User = db.User;
const Friend = db.Friend;

async function isFriendWith(userId1, userId2) {
  const friendship = await Friend.findOne({
    status: 'accepted',
    $or: [ { user_id: userId1, friend_id: userId2 }, { user_id: userId2, friend_id: userId1 }],
  });
  return !!friendship;
};

exports.fetchNotifications = async (req, res) => {
  const currentUserId = req.user?._id;
  const { page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;

  try {
    const [notifications, total] = await Promise.all([
      Notification.find({ user_id: currentUserId })
        .populate('from_user', 'id name avatar').sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)),
      Notification.countDocuments({ user_id: currentUserId }),
    ]);

    const enriched = await Promise.all(
      notifications.map(async (not) => {
        if (not.from_user) {
          const isFriend = await isFriendWith(currentUserId, not.from_user.id);
          return { ...not, from_user: { ...not.from_user, is_friend: isFriend },};
        }
        return not;
      })
    );

    const totalPages = Math.ceil(total / limit);
    const hasMore = page < totalPages;

    res.status(200).json({
      notifications: enriched.filter(n => n.from_user?.is_friend === false),
      currentPage: parseInt(page),
      totalPages,
      totalCount: total,
      hasMore,
    });
  } catch (error) {
    console.error('Error in fetchNotifications:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getUnreadCount = async (req, res) => {
  const user_id = req.user._id;

  try {
    const count = await Notification.countDocuments({ user_id, is_read: false });
    return res.status(200).json({ message: 'Unread count fetch successfully.', count });
  } catch (error) {
    console.error('Error in getUnreadCount:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.markAsRead = async (req, res) => {
  const user_id = req.user._id;
  const { id } = req.params;

  try {
    const notification = await Notification.findOne({ _id: id, user_id });
    if (!notification) return res.status(404).json({ message: 'Notification not found.' });

    await Notification.updateOne(
      { _id: id },
      { is_read: true, read_at: new Date() }
    );

    return res.status(200).json({ message: 'Notification marked as read.' });
  } catch (error) {
    console.error('Error in markAsRead:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.markAllAsRead = async (req, res) => {
  const user_id = req.user._id;

  try {
    await Notification.updateMany( { user_id, is_read: false }, { is_read: true, read_at: new Date() });

    return res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (error) {
    console.error('Error in markAllAsRead:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.deleteNotification = async (req, res) => {
  const currentUserId = req.user?._id;
  const { notificationId } = req.params;

  try {
    if (!currentUserId) return res.status(403).json({ message: 'Unauthorized!' });

    const notification = await Notification.findOne({ _id: notificationId, user_id: currentUserId });
    if (!notification) return res.status(404).json({ message: 'Notification Not Found.' });

    await notification.deleteOne();
    return res.status(200).json({ message: 'Notification Deleted' });
  } catch (error) {
    console.error('Error in deleteNotification:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};