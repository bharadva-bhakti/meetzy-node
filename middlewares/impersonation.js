const jwt = require('jsonwebtoken');
const { db } = require('../models');
const Session = db.Session;

exports.checkImpersonationStatus = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  req.isImpersonating = false;

  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.isImpersonated) {
      req.isImpersonating = true;
      req.impersonatorId = decoded.impersonatorId;
      req.originalRole = decoded.originalRole || decoded.role;
      return next();
    }

    const session = await Session.findOne({
      session_token: token,
      agenda: { $regex: /^impersonation_by_/ },
      status: 'active',
    }).lean();

    if (session) {
      req.isImpersonating = true;
      req.impersonatorId = session.agenda.replace('impersonation_by_', '');
    }
  } catch (err) {
    // Invalid token → treat as not impersonating
  }

  next();
};

exports.restrictImpersonationActions = (req, res, next) => {
  if (!req.isImpersonating) {
    return next();
  }

  const url = req.originalUrl.toLowerCase();
  const method = req.method;

  if (url.includes('/message') && (method === 'POST' || (method === 'PUT' && url.includes('/update')))) {
    return res.status(403).json({ message: 'Sending or updating messages is not allowed during impersonation' });
  }

  const sensitivePaths = [
    '/account', '/setting', '/subscription', '/verification', '/broadcast', '/status', '/call', '/group', '/friend', '/user-setting',
    '/inquiry/create', '/group', '/notification', '/user-report'
  ];

  if (sensitivePaths.some(path => url.includes(path)) && ['POST', 'PUT', 'DELETE'].includes(method)) {
    return res.status(403).json({ message: 'Modifications are not allowed during impersonation' });
  }

  if (url.includes('/subscription') || url.includes('/plan') || url.includes('/payment')) {
    return res.status(403).json({ message: 'Payment actions are not allowed during impersonation' });
  }

  const blockedMessageActions = ['/pin', '/reaction', '/mute', '/favorite', '/unpin', '/unfavorite', '/unmute'];
  const isBlocked = blockedMessageActions.some(act => {
    return url.includes(act);
  })

  if (url.includes('/message') && method === 'POST' && isBlocked) {
    return res.status(403).json({ message: 'This message action is not allowed during impersonation' });
  }

  const blockedChatActions = ['/pin', '/toggle-archive', '/archive/all', '/toggle-block', '/toggle-favorite', 
    '/mute', '/unmute', '/delete', '/delete/all', '/clear', '/clear/all'];
  if (url.includes('/chat') && method === 'POST' && blockedChatActions.some(act => {
    return url.includes(act);
  })) {
    return res.status(403).json({ message: 'This chat action is not allowed during impersonation' });
  }
  

  next();
};