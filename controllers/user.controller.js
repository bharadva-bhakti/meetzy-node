const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { db } = require('../models');
const { mongoose } = require('mongoose');

const User = db.User;
const UserSetting = db.UserSetting;

exports.getAllUsers = async (req, res) => {
  const { page = 1, limit = 10, search, has_last_login } = req.query;
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const allowedSortFields = ['id', 'name', 'email', 'country', 'country_code', 'phone', 'status', 'role', 'created_at', 'updated_at', 'deleted_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const query = { role: { $ne: 'super_admin' } };

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { country: searchRegex },
        { role: searchRegex },
      ];
    }

    if (has_last_login === 'true') {
      query.last_login = { $ne: null };
    } else if (has_last_login === 'false') {
      query.last_login = null;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('id avatar name bio email is_verified country country_code phone role last_login status created_at')
        .sort({ [safeSortField]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit)),

      User.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
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
  const { name, email, password, country, country_code, phone, role = 'user', status } = req.body;

  try {
    if (!email && !phone) {
      return res.status(400).json({ message: 'Provide Email or phone number.' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid Email format' });
    }

    if (email) {
      const existingEmail = await User.findOne({ email, role });
      if (existingEmail) {
        return res.status(409).json({ message: 'Email already registered' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);

    let avatar = null;
    if (req.file) {
      avatar = req.file.path;
    }

    const user = await User.create({ avatar, name, email, password: hashed, country, country_code, phone, role, status });

    await UserSetting.create({ user_id: user._id });

    return res.status(201).json({ message: 'User created successfully' });
  } catch (error) {
    console.error('Error in createUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUser = async (req, res) => {
  const { name, bio, phone, country, country_code, id, remove_avatar } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const deleteOldAvatar = () => {
      if (!user.avatar) return;

      const oldAvatarPath = path.join(__dirname, '..', user.avatar);
      if (fs.existsSync(oldAvatarPath)) {
        try {
          fs.unlinkSync(oldAvatarPath);
        } catch (err) {
          console.error('Error deleting old avatar:', err);
        }
      }
    };

    let avatar = user.avatar;

    if (remove_avatar === 'true') {
      deleteOldAvatar();
      avatar = null;
    } else if (req.file) {
      deleteOldAvatar();
      avatar = req.file.path;
    }

    await User.updateOne(
      { _id: id },
      { $set: { name, bio, phone, country, country_code, avatar }}
    );

    const updatedUser = await User.findById(id)
      .select('id avatar name bio email country country_code phone role status');

    res.status(200).json({ message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    console.error('Error in updateUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateUserStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    await User.updateOne({ _id: id }, { $set: { status } });

    const io = req.app.get('io');

    if (status === 'deactive') {
      io.to(`user_${id}`).emit('admin-deactivation', { id, status });
    }

    res.status(200).json({ message: `User ${status} successfully.` });
  } catch (error) {
    console.error('Error in updateUserStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteUser = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }

    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));

    const result = await User.deleteMany({ _id: { $in: objectIds } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No users found' });
    }

    const response = {
      message: `${result.deletedCount} user(s) deleted successfully`,
      deletedCount: result.deletedCount,
    };

    const io = req.app.get('io');
    ids.forEach((userId) => {
      io.to(`user_${userId}`).emit('admin-deletion');
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteUser:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};