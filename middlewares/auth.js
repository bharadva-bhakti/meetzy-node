'use strict';

const jwt = require('jsonwebtoken');
const { User, Session, GroupMember, Group } = require('../models');

exports.authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token missing or malformed' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);

    if (!user) {
      return res.status(401).json({ message: 'Invalid token: user not found' });
    }

    const session = await Session.findOne({
      where: { user_id: user.id, session_token: token, status: 'active' },
    });

    if (!session) {
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
    if(!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden: insufficient permissions.'});
    }
    next();
  };
};

exports.authorizeGroupRole = (roles = []) => {
  return async (req,res,next) => {
    const userId = req.user.id;
    const groupId = req.params.id || req.body.group_id;

    const group = await Group.findByPk(groupId);
    if(!group) return res.status(403).json({ message: 'Group not found.'});
    
    const member = await GroupMember.findOne({ where:{ user_id: userId, group_id: groupId }});
    if(!member) return res.status(403).json({ message: 'You are not member of the group.'});

    if(!roles.includes(member.role)){
      return res.status(403).json({ message: 'Only admins have permission to do this.'});
    }

    req.groupRole = member.role;
    next();
  };
};