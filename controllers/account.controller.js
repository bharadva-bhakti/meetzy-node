const bcrypt = require('bcryptjs');
const { User, Message, MessageAction, ChatClear, GroupMember, Group, UserSetting, Status } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

exports.getUserDetails = async (req,res) => {
    try {
        const userId = req.user?.id;
        if(!userId) return res.status(400).json({ message: 'Unauthorized access' });

        const user = await User.findOne({
            where: { id: userId },
            attributes: ['id','name', 'bio', 'avatar','email','role','country','country_code','phone','status', 'is_verified']
        });

        if(!user) return res.status(404).json({ message: 'User Not Found' });
        
        return res.status(200).json({user});
    } catch (err) {
        console.error('Error getUserDetails:',err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.getUserProfile = async (req,res) => {
    const currentUserId = req.user?.id;
    const userId = req.params.id;

    try {
        const user = await User.findByPk(userId, {
            attributes: ['id', 'name', 'bio', 'avatar', 'phone', 'email', 'country_code', 'is_verified'],
            include: [
                { model: UserSetting, as: 'setting', attributes: ['display_bio', 'profile_pic', 'last_seen', 'hide_phone']}
            ]
        });
        if(!user) return res.status(404).json({message: 'User not found.'});

        const bio = user.setting?.display_bio ? user.bio : null;
        const avatar = user.setting?.profile_pic !== false ? user.avatar : null;

        const clearEntry = await ChatClear.findOne({
            where: { user_id: currentUserId, recipient_id: userId}
        });

        const buildWhere = (extra = {}) => {
            const condition = {
              [Op.or]: [
                { sender_id: currentUserId, recipient_id: userId },
                { sender_id: userId, recipient_id: currentUserId }
              ],
              ...extra,
            };
            if (clearEntry) condition.created_at = { [Op.gt]: clearEntry.cleared_at };
      
            return condition;
        };

        const [currentUserGroups, recipientGroups] = await Promise.all([
            GroupMember.findAll({where: { user_id: currentUserId }, attributes: ['group_id']}),
            GroupMember.findAll({where: { user_id: userId }, attributes: ['group_id']}),
        ]);

        const currentUserGroupIds = currentUserGroups.map(g => g.group_id);
        const recipientGroupIds = recipientGroups.map(g => g.group_id);
        const commonGroupIds = currentUserGroupIds.filter(id => recipientGroupIds.includes(id));

        let commonGroups = [];
        if(commonGroupIds.length > 0){
            commonGroups = await Group.findAll({
                where: { id: { [Op.in]: commonGroupIds}},
                attributes: ['id', 'name', 'description', 'avatar', 'created_at'],
                include: [
                    {
                        model: GroupMember,
                        as: 'memberships',
                        attributes: ['user_id'],
                        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar']}],
                    },
                ],
            });
        }

        const sharedDocuments = await Message.findAll({
            where: buildWhere({ message_type: { [Op.in]: ['file'] }}),
            attributes: ['id', 'content', 'file_url', 'file_type', 'created_at', 'metadata'],
            order: [['created_at', 'DESC']],
        });

        const sharedLink = await Message.findAll({
            where: buildWhere({ message_type: 'link' }),
            attributes: ['id', 'content', 'created_at', 'metadata'],
            include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
            order: [['created_at', 'DESC']],
        });
        
        const sharedImages = await Message.findAll({
            where: buildWhere({ message_type: 'image' }),
            attributes: ['id', 'file_url', 'created_at', 'metadata'],
            order: [['created_at', 'DESC']],
        });

        const announcements = await Message.findAll({
            where: {
              sender_id: userId,
              [Op.and]: [{recipient_id: null}, {group_id: null}],
              message_type: 'announcement',
              ...(clearEntry && {created_at: { [Op.gt]: clearEntry.cleared_at }})
            },
            attributes: ['id', 'content', 'file_url', 'file_type', 'created_at', 'metadata'],
            order: [['created_at', 'DESC']],
        });          

        const announcementImages = announcements
        .filter(m => m.file_type?.startsWith('image/'))
        .map(m => ({
            id: m.id,
            url: m.file_url,
            date: m.created_at,
            title: m.metadata?.title || null,
            announcement_type: m.metadata?.announcement_type || null,
        }));

        const starredActions = await MessageAction.findAll({
            where: { user_id: currentUserId, action_type: 'star' },
            include: [
                {
                    model: Message,
                    as: 'Message',
                    required: true,
                    attributes: [
                        'id', 'content', 'file_url', 'file_type', 'message_type', 'created_at', 'metadata', 'sender_id', 'recipient_id', 'group_id'
                    ],
                    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar'] }],
                    where: {
                        [Op.or]: [
                            buildWhere({}),
                            { sender_id: userId, recipient_id: null, group_id: null, message_type: 'announcement'}
                        ]
                    }
                }
            ],
            order: [['created_at', 'DESC']],
            limit: 10
        });

        const commonGroupMemberIds = commonGroups.flatMap(g => 
            (g.memberships || []).map(m => m.user?.id).filter(Boolean)
        );
        const allSenderIds = [
            ...starredActions.map(a => a.Message?.sender?.id).filter(Boolean),
            ...sharedLink.map(msg => msg.sender?.id).filter(Boolean),
            ...commonGroupMemberIds
        ];
        const uniqueSenderIds = [...new Set(allSenderIds)];
        
        const senderSettings = uniqueSenderIds.length > 0 ? await UserSetting.findAll({
            where: { user_id: { [Op.in]: uniqueSenderIds } },
            attributes: ['user_id', 'profile_pic'],
            raw: true
        }) : [];
        
        const senderSettingsMap = new Map(senderSettings.map(s => [s.user_id, s]));
        
        const starredMessages = starredActions
            .map(action => action.Message).filter(Boolean)
            .map(msg => {
                const senderSetting = senderSettingsMap.get(msg.sender.id);
                const senderAvatar = senderSetting && senderSetting.profile_pic === false ? null : (msg.sender.avatar || null);
                return {
                    id: msg.id,
                    content: msg.content,
                    date: msg.created_at,
                    sender: {
                        id: msg.sender.id,
                        name: msg.sender.name,
                        avatar: senderAvatar
                    }
                };
            }
        );

        const userJson = user.toJSON();
        const { avatar: _, bio: __, setting: ___, ...userWithoutSensitive } = userJson;

        res.status(200).json({
            ...userWithoutSensitive,
            bio: bio,
            avatar: avatar,
            userSetting: user.setting ? {
                last_seen: user.setting.last_seen,
                profile_pic: user.setting.profile_pic,
                display_bio: user.setting.display_bio,
                hide_phone: user.setting?.hide_phone
            } : null,
            shared_documents: sharedDocuments.map(doc => ({
                id: doc.id,
                name: doc.metadata?.original_filename || 'Document',
                url: doc.file_url,
                type: doc.file_type,
                size: doc.metadata?.fileSize || null,
                date: doc.created_at
            })),
            shared_images:
                announcementImages.length > 0
                ? announcementImages.map(img => ({
                    id: img.id,
                    url: img.url,
                    date: img.date,
                }))
                : sharedImages.map(img => ({
                    id: img.id,
                    url: img.file_url,
                    date: img.created_at,
            })),
            shared_links: sharedLink.map(msg => {
                const senderSetting = senderSettingsMap.get(msg.sender.id);
                const senderAvatar = senderSetting && senderSetting.profile_pic === false ? null : (msg.sender.avatar || null);
                return {
                    id: msg.id,
                    content: msg.content,
                    date: msg.created_at,
                    sender: {
                        ...msg.sender.toJSON(),
                        avatar: senderAvatar
                    }
                };
            }),
            common_groups: commonGroups.map(g => ({
                id: g.id,
                name: g.name,
                description: g.description,
                avatar: g.avatar,
                created_at: g.created_at,
                member_count: g.memberships?.length || 0,
                members: (g.memberships || []).map(m => {
                    if (!m.user) return null;
                    const memberSetting = senderSettingsMap.get(m.user.id);
                    const memberAvatar = memberSetting && memberSetting.profile_pic === false ? null : (m.user.avatar || null);
                    return {
                        id: m.user.id,
                        name: m.user.name,
                        avatar: memberAvatar
                    };
                }).filter(Boolean),
            })),
            starred_messages: starredMessages,
        });
    } catch (error) {
        console.error('Error getUserProfile:',error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.updateProfile = async (req,res) => {
    try {
        const userId = req.user?.id;
        const { name, bio, phone, country, country_code, remove_avatar } = req.body;

        const user = await User.findOne({ where: { id: userId } });
        if(!user) return res.status(404).json({ message: 'User Not Found' });

        const deleteOldAvatar = () => {
            if(!user.avatar) return;

            const oldAvatarPath = path.join(__dirname, '..', user.avatar);
            if(fs.existsSync(oldAvatarPath)){
                try {
                    fs.unlinkSync(oldAvatarPath);
                } catch (error) {
                    console.error('Error deleting old avatar', error);
                }
            }
        };
        
        let avatar = user.avatar;
        if(remove_avatar === 'true'){
            deleteOldAvatar();
            avatar = null;
        } else if (req.file){
            deleteOldAvatar();
            avatar = req.file.path
        }

        await user.update({
            name: name ?? user.name,
            bio: bio ?? user.bio,
            avatar: avatar,
            phone: phone ?? user.phone,
            country: country ?? user.country,
            country_code: country_code ?? user.country_code
        });

        const updatedUser = await User.findByPk(userId,{
            attributes: ['name', 'bio', 'avatar', 'email', 'country', 'country_code', 'phone' ]
        });

        return res.status(201).json({
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (err) {
        console.error('Error updateProfile:',err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.updatePassword = async (req,res) => {
    try {
        const userId = req.user?.id;
        const { old_password, password} = req.body;

        if(!old_password && password){
            return res.status(400).json({ message: 'Old password and New password are required' });
        }

        const user = await User.findByPk(userId);
        if(!user) return res.status(404).json({ message: 'User not found' });

        const isPasswordValid = await bcrypt.compare(old_password, user.password);
        if(!isPasswordValid) return res.status(400).json({ message: 'Invalid Old Password' })

        const hashedPassword = await bcrypt.hash(password,10);
        await user.update({ password: hashedPassword, updated_at: new Date() });

        const io = req.app.get('io');
        io.to(`user_${userId}`).emit('password-updated', { ...user, token: req.headers.authorization });

        return res.status(200).json({ message: 'Password updated successfully' });

    } catch (err) {
        console.error('Error updatePassword:',err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.deleteAccount = async (req,res) => {
    const userId = req.user.id;
  
    try {
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
  
      if (user.profile_pic) {
        const filePath = path.join(__dirname, '..', user.profile_pic);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
  
      const statuses = await Status.findAll({ where: { user_id: userId } });
      for (const st of statuses) {
        if (st.file_url) {
          const filePath = path.join(__dirname, '..', st.file_url);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }
  
      const messages = await Message.findAll({ 
        where: { sender_id: userId }
      });
  
      for (const msg of messages) {
        if (msg.file_url) {
          const filePath = path.join(__dirname, '..', msg.file_url);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      }
  
      await user.destroy({ force: true });
  
      return res.status(200).json({ message: 'Your account has been permanently deleted.'});
    } catch (error) {
      console.error('Error in deleteAccount:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
};