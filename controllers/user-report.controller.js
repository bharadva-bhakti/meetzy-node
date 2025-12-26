const { UserReport, User, Group, GroupMember, Message } = require('../models');
const { Op } = require('sequelize');

exports.fetchReports = async (req,res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sortField = req.query.sort_by || 'created_at';
    const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        const allowedSortFields = [
            'id', 
            'chat_type', 
            'reason',
            'description', 
            'status', 
            'admin_notes', 
            'resolved_at', 
            'created_at', 
            'updated_at',
            'reporter_name',
            'reported_user_name',
            'group_name',
            'resolver_name'
        ];
        const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

        const where = search ? { 
            [Op.or]: [
                { chat_type: { [Op.like]: `%${search}%` } }, 
                { reason: { [Op.like]: `%${search}%` } }, 
                { description: { [Op.like]: `%${search}%` } },
                { status: { [Op.like]: `%${search}%` } },
                { admin_notes: { [Op.like]: `%${search}%` } },

                { '$reporter.name$': { [Op.like]: `%${search}%`}},
                { '$reporter.email$': { [Op.like]: `%${search}%`}},

                { '$reported_user.name$': { [Op.like]: `%${search}%`}},
                { '$reported_user.email$': { [Op.like]: `%${search}%`}},

                { '$group.name$': { [Op.like]: `%${search}%`}},
                { '$group.description$': { [Op.like]: `%${search}%`}},

                { '$resolver.name$': { [Op.like]: `%${search}%`}},
                { '$resolver.email$': { [Op.like]: `%${search}%`}}
            ] 
        } : {};
        
        let order = [];

        switch (safeSortField) {
            case 'reporter_name':
                order = [[{ model: User, as: 'reporter'}, 'name', sortOrder]];
                break;
            case 'reported_user_name':
                order = [[{ model: User, as: 'reported_user'}, 'name', sortOrder]];
                break;
            case 'group_name':
                order = [[{ model: Group, as: 'group'}, 'name', sortOrder]];
                break;
            case 'resolver_name':
                order = [[{ model: User, as: 'resolver'}, 'name', sortOrder]];
                break;
            default:
                order = [[safeSortField, sortOrder]];
                break;
        }

        const { count, rows: userReports } = await UserReport.findAndCountAll({
            where,
            include: [
                { model: User, as: 'reporter', attributes: ['id', 'name', 'email', 'avatar']},
                { model: User, as: 'reported_user', attributes: ['id', 'name', 'email', 'avatar']},
                { model: Group, as: 'group', attributes: ['id', 'name', 'description', 'avatar']},
                { model: User, as: 'resolver', attributes: ['id', 'name', 'email']}
            ],
            order,
            limit,
            offset,
        });

        res.status(200).json({
            total: count,
            totalPages: Math.ceil(count / parseInt(limit)),
            page: parseInt(page),
            limit: parseInt(limit),
            userReports
        });
    } catch (error) {
        console.error('Error in fetchReports:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createUserReport = async (req, res) => {
    const { reportedUserId, groupId, reason, description, exitGroup } = req.body;
    const reporterId = req.user.id;
    
    try {
        if (!reason) return res.status(400).json({ message: 'Reason is required.' });

        if (reportedUserId && groupId) {
            return res.status(400).json({ message: 'Provide either reportedUserId or groupId.' });
        } 
        
        let chatType;
        if (reportedUserId) chatType = 'direct';
        else if (groupId) chatType = 'group';
        else return res.status(400).json({ message: 'Either reportedUserId or groupId must be provided' });

        if (reason.toLowerCase() === 'other' && (!description || description.trim().length < 10)) {
            return res.status(400).json({ error: 'Provide a detailed description for Other reason.' });
        }

        let targetId, targetType, target;
        const io = req.app.get('io');

        if (chatType === 'direct') {
            if (parseInt(reportedUserId) === parseInt(reporterId)) {
                return res.status(400).json({ message: 'You cannot report yourself.' });
            }

            targetId = reportedUserId;
            targetType = 'reported_user_id';
            
            target = await User.findByPk(targetId);
            if (!target) return res.status(404).json({ message: 'Reported user not found' });
            
        } else {
            targetId = groupId;
            targetType = 'group_id';
            
            target = await Group.findByPk(targetId, {
                attributes: ['id', 'name', 'avatar', 'description']
            });
            if (!target) return res.status(404).json({ message: 'Group not found' });

            const member = await GroupMember.findOne({ where: { group_id: groupId, user_id: reporterId }});
            if (!member) {
                return res.status(403).json({ message: 'You are not member of this group.' });
            }
        }

        const reportData = {
            reporter_id: reporterId,
            chat_type: chatType,
            reason,
            description,
            exit_group: chatType === 'group' ? Boolean(exitGroup) : false
        };
        reportData[targetType] = targetId;

        const report = await UserReport.create(reportData);

        let leftGroup = false;
        let systemMessage = null;

        if (chatType === 'group' && exitGroup === true) {
            const member = await GroupMember.findOne({ where: { group_id: groupId, user_id: reporterId }});

            if (member) {
                const wasAdmin = member.role === 'admin';
                
                await member.destroy();
                const userRoom = io.sockets.adapter.rooms.get(`user_${reporterId}`);
                if (userRoom) {
                    userRoom.forEach((socketId) => {
                        const socket = io.sockets.sockets.get(socketId);
                        if (socket) {
                            socket.leave(`group_${groupId}`);
                            console.log(`User ${reporterId} left group_${groupId} socket room`);
                        }
                    });
                }

                leftGroup = true;

                systemMessage = await Message.create({
                    sender_id: reporterId,
                    group_id: groupId,
                    message_type: 'system',
                    content: `${req.user.name} left the group`,
                    metadata: {
                        system_action: 'member_left',
                        user_id: reporterId,
                        user_name: req.user.name,
                        left_after_report: true,
                        timestamp: new Date().toISOString()
                    }
                });

                if (wasAdmin) {
                    const remainingMembers = await GroupMember.count({ where: { group_id: groupId }});

                    if (remainingMembers > 0) {
                        const remainingAdmins = await GroupMember.count({ where: { group_id: groupId, role: 'admin' }});

                        if (remainingAdmins === 0) {
                            const oldestMember = await GroupMember.findOne({
                                where: { group_id: groupId },
                                order: [['created_at', 'ASC']]
                            });

                            if (oldestMember) {
                                await oldestMember.update({ role: 'admin' });

                                io.to(`group_${groupId}`).emit('member-role-updated', {
                                    group_id: groupId, user_id: oldestMember.user_id, new_role: 'admin',
                                });
                            }
                        }
                    }
                }

                if (systemMessage) {
                    const fullSystemMessage = await Message.findByPk(systemMessage.id, {
                        include: [
                            { model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] },
                            { model: Group, as: 'group', attributes: ['id', 'name', 'avatar'] },
                        ],
                    });
                    if (fullSystemMessage) {
                        io.to(`user_${reporterId}`).emit('receive-message', fullSystemMessage);
                    }
                }

               io.to(`group_${groupId}`).emit('member-left-group', {
                    groupId: groupId, userId: reporterId,
                });

                io.to(`user_${reporterId}`).emit('group-left', { groupId: groupId, userId: reporterId });
            }
        }
    
        return res.json({ 
            message: leftGroup 
                ? 'Group reported and you have left the group successfully'
                : `${chatType === 'direct' ? 'User' : 'Group'} reported successfully`,
            report,
            left_group: leftGroup,
            system_message: systemMessage
        });
    } catch (error) {
        console.error('Error in createUserReport:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateUserReport = async (req,res) => {
    const { id } = req.params;
    const {admin_notes, status}  = req.body;
    const userId = req.user.id;

    try {
        const userReport = await UserReport.findByPk(id);
        if(!userReport) return res.status(404).json({ message: 'User report not found' });

        if(['resolved','dismissed','banned'].includes(userReport.status)){
            return res.status(400).json({message: `You can not update ${userReport.status} to ${status}`});
        }
        await userReport.update({
            admin_notes,
            status,
            resolved_by: userId || null,
            resolved_at: new Date()
        });

        let user;
        if (status === 'banned' && userReport.reported_user_id) {
             user = await User.findByPk(userReport.reported_user_id);
            if (user) {
              await user.update({ status: 'deactive' });
            }
        }

        const io = req.app.get('io');
        io.to(`user_${userReport.reported_user_id}`).emit('admin-banned-user',user)

        return res.status(200).json({ message: 'User report updated successfully.' })
    } catch (error) {
        console.error('Error in updateUserReport:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteUserReport = async (req,res) => {
    const { ids } = req.body;

    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'User report IDs array is required' });
        }

        const userReports = await UserReport.findAll({ where: { id: ids } });
        if(userReports.length === 0) return res.status(404).json({ message: 'User report not found.'});

        const foundIds = userReports.map((report) => report.id);
        const notFoundIds = ids.filter((id) => !foundIds.includes(id));

        await UserReport.destroy({ where: { id: foundIds }, force: true });

        const response = {
            message: `${foundIds.length} User report(s) deleted successfully`,
            deletedCount: foundIds.length,
        };

        if (notFoundIds.length > 0) {
            response.notFound = notFoundIds;
            response.message += `, ${notFoundIds.length} User report(s) not found`;
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteUserReport:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};