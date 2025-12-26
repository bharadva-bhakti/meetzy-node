const { Op, QueryTypes } = require('sequelize');
const { User, Group, Message, Block, UserReport, sequelize } = require('../models');

exports.dashboard = async (req,res) => {
    try {
        const dashboardData = {
            counts: {
                totalUsers: 0,
                totalGroups: 0,
                totalCalls:0,
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
            }
        };

        const now = new Date();
        const currentWeekStart = new Date(now);
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        currentWeekStart.setHours(0, 0, 0, 0);

        const currentWeekEnd = new Date(now);
        currentWeekEnd.setHours(23, 59, 59, 999);

        dashboardData.counts.totalUsers = await User.count({ where: { status: 'active', role: 'user' }});

        dashboardData.counts.totalGroups = await Group.count();

        const currentCalls = await Message.count({
            where: {
              message_type: 'call',
              created_at: { [Op.between]: [currentWeekStart, currentWeekEnd] },
            },
        });

        dashboardData.counts.totalCalls = currentCalls || 0;

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        dashboardData.counts.newUsersThisWeek = await User.count({
            where: {
                role: { [Op.ne]: 'admin'},
                created_at: {[Op.gte]: weekAgo}
            }
        }) || 0;

        dashboardData.counts.totalFileShared = await Message.count({
            where: { message_type: {[Op.in]: ['file']} }
        }) || 0;

        dashboardData.counts.totalMediaShared = await Message.count({
            where: {
                message_type: {[Op.in]: ['image', 'video', 'audio']}
            }
        }) || 0;

        dashboardData.counts.totalPendingReports = await UserReport.count({
            where: { status: 'pending'}
        }) || 0;

        dashboardData.counts.totalBlockedUsers = await Block.count() || 0;

        const userLocationData = await sequelize.query(
            `
              SELECT 
                country,
                country_code,
                COUNT(*) as user_count
              FROM users 
              WHERE status = 'active'
                AND country IS NOT NULL
              GROUP BY country, country_code
              ORDER BY user_count DESC
            `,
            { type: QueryTypes.SELECT, }
        );
      
        const totalUsersWithCountry = userLocationData.reduce((total, location) => total + parseInt(location.user_count), 0);
    
        dashboardData.charts.userLocationDistribution = userLocationData.map((location) => {
            const percentage = totalUsersWithCountry > 0 ? ((parseInt(location.user_count) / totalUsersWithCountry) * 100).toFixed(2) : 0;
        
            return {
                country: location.country || 'Unknown',
                country_code: location.country_code || 'UN',
                user_count: parseInt(location.user_count),
                percentage: parseFloat(percentage),
            };
        });

        const months = [];
        for (let i = 11; i >= 0; i--){
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                start: new Date(date.getFullYear(), date.getMonth(), 1),
                end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
            });
        };

        const userGrowthPromises = months.map(async (month) => {
            const newUsers = await User.count({
              where: {
                status: 'active',
                created_at: { [Op.between]: [month.start, month.end] },
              },
            });
      
            const totalUsers = await User.count({
              where: {
                status: 'active',
                created_at: { [Op.lte]: month.end },
              },
            });
      
            return {
              month: `${month.year}-${month.month.toString().padStart(2, '0')}`,
              new_users: newUsers,
              total_users: totalUsers,
            };
        });

        dashboardData.charts.userGrowthMonthly = await Promise.all(userGrowthPromises);

        dashboardData.charts.reportTypeStats = await UserReport.findAll({
            attributes: [
                'reason',
                [sequelize.fn('COUNT', sequelize.col('reason')), 'count']
            ],
            group: ['reason'],
            raw: true
        }) || [];

        dashboardData.charts.messageTypeStats = await Message.findAll({
            attributes: [
                'message_type',
                [sequelize.fn('COUNT', sequelize.col('message_type')), 'count']
            ],
            group: ['message_type'],
            raw: true
        }) || [];

        dashboardData.charts.messageActivityStats = await sequelize.query(`
            SELECT 
            DATE(created_at) as date,
            COUNT(*) as count
            FROM messages 
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date ASC `,

            { type: sequelize.QueryTypes.SELECT}
        ) || [];

        const hourlyMessages = await sequelize.query(`
            SELECT 
              HOUR(created_at) AS hour,
              COUNT(*) AS count,
              COUNT(DISTINCT sender_id) AS active_users
            FROM messages 
            WHERE created_at >= CURDATE()
            AND created_at < CURDATE() + INTERVAL 1 DAY
            GROUP BY hour
            ORDER BY hour ASC
          `, {
            type: sequelize.QueryTypes.SELECT
        });

        dashboardData.charts.messagesByHour = Array.from({ length: 24 }, (_, i) => {
            const data = hourlyMessages.find(h => h.hour === i);
            
            return {
                hour: i,
                count: data?.count || 0,
                active_users: data?.active_users || 0
            }
        });

        res.status(200).json({
            success: true,
            data: dashboardData,
            message: 'Admin dashboard data fetched successfully',
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message,
        });
    }
};