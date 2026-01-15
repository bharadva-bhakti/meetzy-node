const { db } = require('../models');
const User = db.User;
const Session = db.Session;
const { generateToken } = require('../utils/jwt');

exports.startImpersonation = async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID is required' });
    }

    const impersonator = req.user;
    if (impersonator.role !== 'super_admin') {
      return res.status(403).json({ message: 'Only super_admin can impersonate users' });
    }

    const targetUser = await User.findById(targetUserId).select('id name email role').lean();
    if (!targetUser) {
      return res.status(404).json({ message: 'Target user not found' });
    }

    if (targetUser.role === 'super_admin') {
      return res.status(400).json({ message: 'Cannot impersonate another super_admin' });
    }

    const impersonationToken = generateToken({
      id: targetUser._id,
      email: targetUser.email,
      role: targetUser.role,
    });

    await Session.create({
      user_id: targetUser._id,
      session_token: impersonationToken,
      device_info: req.headers['user-agent'] || 'unknown',
      ip_address: req.ip,
      agenda: `impersonation_by_${impersonator._id}`,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'active',
    });

    res.cookie('impersonation_token', impersonationToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: 24 * 60 * 60 * 1000,
    });    

    return res.status(200).json({
      message: 'Impersonation started successfully',
      token: impersonationToken,
      targetUser: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      },
      impersonator: {
        id: impersonator.id,
        name: impersonator.name,
        email: impersonator.email,
        role: impersonator.role,
      },
    });
  } catch (error) {
    console.error('Error in startImpersonation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.stopImpersonation = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const session = await Session.findOne({ session_token: token, agenda: { $regex: /^impersonation_by_/ }, status: 'active', });
    if (!session) {
      return res.status(400).json({ message: 'Not currently impersonating anyone' });
    }

    const impersonatorId = session.agenda.replace('impersonation_by_', '');

    const originalUser = await User.findById(impersonatorId).select('id name email role').lean();
    if (!originalUser) {
      return res.status(404).json({ message: 'Original admin not found' });
    }

    const originalToken = generateToken({
      id: originalUser._id,
      email: originalUser.email,
      role: originalUser.role,
    });

    await Session.updateOne({ _id: session._id }, { status: 'inactive' });

    return res.status(200).json({
      message: 'Impersonation stopped successfully',
      token: originalToken,
      originalUser: {
        id: originalUser._id,
        name: originalUser.name,
        email: originalUser.email,
        role: originalUser.role,
      },
    });
  } catch (error) {
    console.error('Stop impersonation error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getImpersonationStatus = async (req, res) => {
  try {
    return res.status(200).json({
      isImpersonating: !!req.isImpersonating,
      impersonator: req.isImpersonating ? { id: req.impersonatorId, } : null,
    });
    
  } catch (error) {
    console.error('Get status error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getAvailableUsersToImpersonate = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const users = await User.find(
      { role: 'user', status: 'active', deleted_at: null, }
    ).select('id name email created_at').sort({ created_at: -1 }).lean();

    const availableUsers = users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      canImpersonate: true,
    }));

    return res.status(200).json({ availableUsers, total: availableUsers.length, });
  } catch (error) {
    console.error('Get available users error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};