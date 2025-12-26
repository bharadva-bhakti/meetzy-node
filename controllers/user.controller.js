const { User, UserSetting } = require('../models');
const { Op, fn, col, where } = require('sequelize');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

exports.getAllUsers = async (req, res) => {
  const { page = 1, limit = 10, search, has_last_login } = req.query;
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const allowedSortFields = ['id', 'name', 'email', 'country', 'country_code', 'phone', 'status', 'role', 'created_at', 'updated_at', 'deleted_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const whereCondition = { role: { [Op.ne]: 'super_admin' } };

    if (search) {
      const searchValue = `%${search.toLowerCase()}%`;
      whereCondition[Op.or] = [
        where(fn('LOWER', col('name')), { [Op.like]: searchValue }), 
        where(fn('LOWER', col('email')), { [Op.like]: searchValue }), 
        where(fn('LOWER', col('country')), { [Op.like]: searchValue }), 
        where(fn('LOWER', col('role')), { [Op.like]: searchValue })
      ];
    }

    if (has_last_login === 'true') {
      whereCondition.last_login = { [Op.not]: null };
    } else if (has_last_login === 'false') {
      whereCondition.last_login = null;
    }

    const { count, rows: users } = await User.findAndCountAll({
      where: whereCondition,
      offset,
      limit: parseInt(limit),
      attributes: ['id', 'avatar', 'name', 'bio', 'email', 'country', 'country_code', 'phone', 'role', 'last_login', 'status', 'created_at'],
      order: [[safeSortField, sortOrder]],
    });

    res.status(200).json({
      total: count,
      totalPages: Math.ceil(count / parseInt(limit)),
      page: parseInt(page),
      limit: parseInt(limit),
      users,
    });
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createUser = async (req, res) => {
  const { name, email, password, country, country_code, phone, role='user', status, } = req.body;

  try {
    if(!email && !phone){
      return res.status(400).json({ message: 'Provide Email or phone number.' });
    }

    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      return res.status(409).json({ message: 'Invalid Email format' });
    }
    const existingEmail = await User.findOne({ where: { email, role } });
    if (existingEmail) return res.status(409).json({ message: 'Email already registered' });
    
    const hashed = await bcrypt.hash(password, 10);

    let avatar;
    if(req.file){
      avatar = req.file.path;
    }
    const user = await User.create({ 
      avatar, name, email, password: hashed, country, country_code, phone, role, status 
    });

    await UserSetting.create({user_id: user.id});

    return res.status(201).json({ message: 'User created successfully'});
  } catch (error) {
    console.error('Error in createUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUser = async (req,res) => {
  const { name, bio, phone, country, country_code, id, remove_avatar } = req.body;

  try {
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

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

    await user.update({ name, bio, phone, country, country_code, avatar });
    res.status(200).json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Error in updateUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUserStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    await user.update({ status });

    const io = req.app.get('io');

    if (status === 'deactive') {
      io.to(`user_${id}`).emit('admin-deactivation', user);
    }

    res.status(200).json({ message: `user ${status} successfully.` });
  } catch (error) {
    console.error('Error in updateStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteUser = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    const users = await User.findAll({ where: { id: ids } });
    if (users.length === 0) return res.status(404).json({ message: 'No users found' });

    const foundIds = users.map((user) => user.id);
    const notFoundIds = ids.filter((id) => !foundIds.includes(id));

    await User.destroy({
      where: { id: foundIds },
      force: true,
    });

    const response = {
      message: `${foundIds.length} user(s) deleted successfully`,
      deletedCount: foundIds.length,
    };

    if (notFoundIds.length > 0) {
      response.notFound = notFoundIds;
      response.message += `, ${notFoundIds.length} user(s) not found`;
    }

    const io = req.app.get('io');
    ids.forEach((member) => {
      io.to(`user_${member}`).emit('admin-deletion');
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};