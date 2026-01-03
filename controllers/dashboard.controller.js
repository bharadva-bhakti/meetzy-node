const { db } = require('../models');
const User = db.User;
const Group = db.Group;
const Message = db.Message;
const Block = db.Block;
const UserReport = db.UserReport;

exports.dashboard = async (req, res) => {
  try {
    const dashboardData = {
      counts: {
        totalUsers: 0,
        totalGroups: 0,
        totalCalls: 0,
        newUsersThisWeek: 0,
        totalFileShared: 0,
        totalMediaShared: 0,
        totalPendingReports: 0,
        totalBlockedUsers: 0,
      },
      charts: {
        userLocationDistribution: [],
        userGrowthMonthly: [],
        reportTypeStats: [],
        messageTypeStats: [],
        messageActivityStats: [],
        messagesByHour: [],
      },
    };

    const now = new Date();

    const [
      totalUsers, totalGroups, totalCallsThisWeek, newUsersThisWeek, totalFiles, totalMedia, pendingReports, totalBlocks,
    ] = await Promise.all([
      User.countDocuments({ status: 'active', role: 'user' }),
      Group.countDocuments({}),
      Message.countDocuments({
        message_type: 'call',
        created_at: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), },
      }),
      User.countDocuments({
        role: { $ne: 'super_admin' },
        created_at: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      }),
      Message.countDocuments({ message_type: 'file' }),
      Message.countDocuments({ message_type: { $in: ['image', 'video', 'audio'] } }),
      UserReport.countDocuments({ status: 'pending' }),
      Block.countDocuments({}),
    ]);

    dashboardData.counts.totalUsers = totalUsers;
    dashboardData.counts.totalGroups = totalGroups;
    dashboardData.counts.totalCalls = totalCallsThisWeek;
    dashboardData.counts.newUsersThisWeek = newUsersThisWeek;
    dashboardData.counts.totalFileShared = totalFiles;
    dashboardData.counts.totalMediaShared = totalMedia;
    dashboardData.counts.totalPendingReports = pendingReports;
    dashboardData.counts.totalBlockedUsers = totalBlocks;

    const locationPipeline = [
      { $match: { status: 'active', country: { $ne: null } } },
      { $group: { _id: { country: '$country', country_code: '$country_code' }, user_count: { $sum: 1 } } },
      { $sort: { user_count: -1 } },
    ];

    const userLocations = await User.aggregate(locationPipeline);
    const totalWithCountry = userLocations.reduce((sum, loc) => sum + loc.user_count, 0);

    dashboardData.charts.userLocationDistribution = userLocations.map(loc => {
      const percentage = totalWithCountry > 0 ? ((loc.user_count / totalWithCountry) * 100).toFixed(2) : 0;
      return {
        country: loc._id.country || 'Unknown',
        country_code: loc._id.country_code || 'UN',
        user_count: loc.user_count,
        percentage: parseFloat(percentage),
      };
    });

    const months = [];
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

      months.push({
        monthKey: `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`,
        start,
        end,
      });
    }

    const growthData = await Promise.all(
      months.map(async ({ monthKey, start, end }) => {
        const [newUsers, totalUsers] = await Promise.all([
          User.countDocuments({ status: 'active', created_at: { $gte: start, $lte: end }}),
          User.countDocuments({ status: 'active', created_at: { $lte: end }}),
        ]);

        return { month: monthKey, new_users: newUsers, total_users: totalUsers};
      })
    );

    dashboardData.charts.userGrowthMonthly = growthData;

    const reportTypeStats = await UserReport.aggregate([
      { $group: { _id: '$reason', count: { $sum: 1 } } },
      { $project: { reason: '$_id', count: 1, _id: 0 } },
    ]);

    dashboardData.charts.reportTypeStats = reportTypeStats;

    const messageTypeStats = await Message.aggregate([
      { $group: { _id: '$message_type', count: { $sum: 1 } } },
      { $project: { message_type: '$_id', count: 1, _id: 0 } },
    ]);

    dashboardData.charts.messageTypeStats = messageTypeStats;

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const messageActivity = await Message.aggregate([
      { $match: { created_at: { $gte: sevenDaysAgo }}},
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, count: { $sum: 1 } }},
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', count: 1, _id: 0 } },
    ]);

    dashboardData.charts.messageActivityStats = messageActivity;

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const hourlyMessages = await Message.aggregate([
      { $match: { created_at: { $gte: todayStart, $lt: tomorrowStart }}},
      { $group: { _id: { $hour: '$created_at' }, count: { $sum: 1 }, active_users: { $addToSet: '$sender_id' }}},
      { $project: { hour: '$_id', count: 1, active_users: { $size: '$active_users' }, _id: 0 }},
      { $sort: { hour: 1 } },
    ]);

    dashboardData.charts.messagesByHour = Array.from({ length: 24 }, (_, i) => {
      const data = hourlyMessages.find(h => h.hour === i);
      return {
        hour: i,
        count: data?.count || 0,
        active_users: data?.active_users || 0,
      };
    });

    return res.status(200).json({ data: dashboardData, message: 'Admin dashboard data fetched successfully', });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return res.status(500).json({ message: 'Internal Server Error', });
  }
};