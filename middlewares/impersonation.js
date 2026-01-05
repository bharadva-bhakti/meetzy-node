const jwt = require('jsonwebtoken');
const { User, TeamMember } = require('../models');
const { generateToken } = require('../utils/jwt');

/**
 * Middleware to allow super_admin to impersonate team admins
 * and team admins to impersonate team members
 */
exports.impersonateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authorization token missing or malformed' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // First, verify the original token to get the impersonator
    let originalDecoded;
    try {
      originalDecoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    
    // Check if impersonation data is in the token
    const impersonatorId = originalDecoded.impersonatorId || originalDecoded.id;
    const originalRole = originalDecoded.originalRole || originalDecoded.role;
    
    // Find the original impersonator user
    const impersonator = await User.findByPk(impersonatorId);
    if (!impersonator) {
      return res.status(401).json({ message: 'Impersonator not found' });
    }
    
    const targetUserId = req.body.targetUserId || req.params.userId;
    if (!targetUserId) {
      return res.status(400).json({ message: 'Target user ID is required for impersonation' });
    }
    
    // Get target user
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: 'Target user not found' });
    }
    
    // Super admin can impersonate anyone, regardless of team membership
    if (impersonator.role === 'super_admin') {
      // Get target user's team membership info (if any)
      const targetTeamMemberships = await TeamMember.findAll({
        where: { user_id: targetUserId }
      });
      
      // Super admin can impersonate even if target user has no team memberships
      let teamId = null;
      let targetRole = null;
      
      if (targetTeamMemberships.length > 0) {
        teamId = targetTeamMemberships[0].team_id;
        targetRole = targetTeamMemberships[0].role;
      }
      
      // Generate impersonation token
      const impersonationToken = generateToken({
        id: targetUser.id,
        email: targetUser.email,
        role: targetUser.role,
        // Add impersonation metadata
        isImpersonated: true,
        impersonatorId: impersonatorId,
        impersonatorRole: originalRole,
        originalRole: originalRole,
        impersonatedAt: new Date().toISOString()
      });
      
      req.impersonation = {
        token: impersonationToken,
        targetUser: targetUser,
        impersonator: impersonator,
        teamId: teamId,
        targetRole: targetRole
      };
      
      return next();
    }
    
    // For team admins, check if target user is in any team where impersonator has permission
    const targetTeamMemberships = await TeamMember.findAll({
      where: { user_id: targetUserId }
    });
    
    if (targetTeamMemberships.length === 0) {
      return res.status(403).json({ message: 'Target user is not part of any team' });
    }
    
    let hasPermission = false;
    let teamId = null;
    let targetRole = null;
    
    // Check if impersonator has permission to impersonate target user
    for (const targetMembership of targetTeamMemberships) {
      // Find if impersonator is in the same team
      const impersonatorMembership = await TeamMember.findOne({
        where: {
          team_id: targetMembership.team_id,
          user_id: impersonatorId
        }
      });
      
      if (impersonatorMembership) {
        teamId = targetMembership.team_id;
        targetRole = targetMembership.role;
        
        // Team admin can impersonate team members
        if (impersonatorMembership.role === 'admin' && targetMembership.role === 'member') {
          hasPermission = true;
          break;
        }
      }
    }
    
    if (!hasPermission) {
      return res.status(403).json({ 
        message: 'Insufficient permissions for impersonation',
        allowed: {
          super_admin: 'Can impersonate team admins and members',
          team_admin: 'Can impersonate team members only'
        }
      });
    }
    
    // Generate impersonation token for team admin
    const impersonationToken = generateToken({
      id: targetUser.id,
      email: targetUser.email,
      role: targetUser.role,
      // Add impersonation metadata
      isImpersonated: true,
      impersonatorId: impersonatorId,
      impersonatorRole: originalRole,
      originalRole: originalRole,
      impersonatedAt: new Date().toISOString()
    });
    
    req.impersonation = {
      token: impersonationToken,
      targetUser: targetUser,
      impersonator: impersonator,
      teamId: teamId,
      targetRole: targetRole
    };
    
    next();
  } catch (error) {
    console.error('Impersonation middleware error:', error);
    return res.status(500).json({ message: 'Internal server error during impersonation' });
  }
};

/**
 * Middleware to check if user is currently impersonating
 */
exports.checkImpersonationStatus = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.isImpersonating = false;
    return next();
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.isImpersonating = !!decoded.isImpersonated;
    req.impersonatorId = decoded.impersonatorId;
    req.originalRole = decoded.originalRole;
  } catch (err) {
    req.isImpersonating = false;
  }
  
  next();
};

/**
 * Middleware to restrict certain actions during impersonation
 */
exports.restrictImpersonationActions = (req, res, next) => {
  // If user is impersonating, block only specific sensitive actions
  if (req.isImpersonating) {
    // Block sending messages
    if (req.originalUrl.includes('/message') && req.method === 'POST') {
      return res.status(403).json({ 
        message: 'Sending messages is not allowed during impersonation' 
      });
    }
    
    // Block updating messages
    if (req.originalUrl.includes('/message') && req.method === 'POST' && req.originalUrl.includes('/update')) {
      return res.status(403).json({ 
        message: 'Updating messages is not allowed during impersonation' 
      });
    }
    
    // Block sensitive account actions
    const sensitiveAccountActions = [
      '/user/change-password',
      '/user/update',
      '/user/profile',
      '/user/delete',
      '/user/change-email'
    ];
    
    const isSensitiveAccountAction = sensitiveAccountActions.some(action => 
      req.originalUrl.includes(action)
    );
    
    if (isSensitiveAccountAction && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      return res.status(403).json({ 
        message: 'Account modification is not allowed during impersonation' 
      });
    }
    
    // Block payment and subscription actions
    if (req.originalUrl.includes('/payment') || req.originalUrl.includes('/subscription')) {
      return res.status(403).json({ 
        message: 'Payment and subscription actions are not allowed during impersonation' 
      });
    }
    
    // Block admin user management actions
    if (req.originalUrl.includes('/admin') && req.originalUrl.includes('/user') && 
        (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')) {
      return res.status(403).json({ 
        message: 'Admin user management actions are not allowed during impersonation' 
      });
    }
    
    // Block other sensitive message actions like pin, reaction, mute, etc.
    if (req.originalUrl.includes('/message') && req.method === 'POST' && 
        (req.originalUrl.includes('/pin') || req.originalUrl.includes('/reaction') || 
         req.originalUrl.includes('/mute') || req.originalUrl.includes('/favorite') ||
         req.originalUrl.includes('/unpin') || req.originalUrl.includes('/unfavorite') ||
         req.originalUrl.includes('/unmute'))) {
      return res.status(403).json({ 
        message: 'Message actions like pin, reaction, mute, favorite are not allowed during impersonation' 
      });
    }
    
    // Allow message deletion but block other DELETE operations
    // Actually, we want to allow message deletion, so no need to block DELETE for messages
  }

  next();
};