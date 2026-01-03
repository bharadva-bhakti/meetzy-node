'use strict';

const jwt = require('jsonwebtoken');
const { db } = require('../models');
const User = db.User;
const Session = db.Session;
const GroupMember = db.GroupMember;
const Group = db.Group;

exports.authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token missing or malformed' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid token: user not found' });
    }

    const session = await Session.findOne({
      user_id: user._id,
      session_token: token,
      status: 'active',
    });

    if (!session) {
      return res.status(401).json({ message: 'Session expired or logged out. Please log in again.' });
    }

    if (session.expires_at && new Date() > new Date(session.expires_at)) {
      await Session.updateOne({ _id: session._id }, { $set: { status: 'inactive' } });
      return res.status(401).json({ message: 'Session expired or logged out. Please log in again.' });
    }

    req.user = user;
    req.token = token;

    next();
  } catch (err) {
    console.error('JWT error:', err);
    return res.status(403).json({ message: 'Token is invalid or expired' });
  }
};

exports.authorizeRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions.' });
    }
    next();
  };
};

exports.authorizeGroupRole = (roles = []) => {
  return async (req, res, next) => {
    const userId = req.user._id;
    const groupId = req.params.id || req.body.group_id;

    if (!groupId) {
      return res.status(400).json({ message: 'Group ID is required.' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found.' });
    }

    const member = await GroupMember.findOne({
      user_id: userId,
      group_id: groupId,
    });

    if (!member) {
      return res.status(403).json({ message: 'You are not a member of this group.' });
    }

    if (!roles.includes(member.role)) {
      return res.status(403).json({ message: 'Only admins have permission to do this.' });
    }

    req.groupRole = member.role;
    next();
  };
};