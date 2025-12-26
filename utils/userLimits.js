const { Subscription, Plan, Setting } = require('../models');
const { Op } = require('sequelize');

async function getEffectiveLimits(userId, userRole = 'user') {
  // Default global limits
  const globalSettings = await Setting.findOne({
    attributes: [
      'max_groups_per_user', 
      'max_group_members', 
      'status_limit', 
      'allow_media_send',
      'max_broadcasts_list',
      'max_members_per_broadcasts_list',],
  });

  const defaults = {
    max_groups_per_user: globalSettings?.max_groups_per_user || 500,
    max_group_members: globalSettings?.max_group_members || 1024,
    max_broadcasts_list: globalSettings?.max_broadcasts_list || 10,
    max_members_per_broadcasts_list: globalSettings?.max_members_per_broadcasts_list || 100,
    status_limit_per_day: globalSettings?.status_limit || 3,
    max_storage_per_user_mb: 5000,
    allow_media_send: globalSettings?.allow_media_send ?? true,
  };

  if (userRole === 'super_admin') {
    return {
      max_groups_per_user: Infinity,
      max_group_members: Infinity,
      max_broadcasts_list: Infinity,
      max_members_per_broadcasts_list: Infinity,
      status_limit_per_day: Infinity,
      max_storage_per_user_mb: Infinity,
      allow_media_send: true,
    };
  }

  const subscription = await Subscription.findOne({
    where: {
      user_id: userId,
      status: { [Op.in]: ['active', 'trialing', 'past_due'] },
      current_period_end: { [Op.gt]: new Date() },
    },
    include: [
      { model: Plan, as: 'plan', where: { status: 'active' }, required: true,},
    ],
    order: [['created_at', 'DESC']],
  });

  if (!subscription || !subscription.plan) {
    return defaults;
  }

  const plan = subscription.plan;

  return {
    max_groups_per_user: plan.max_groups ?? defaults.max_groups_per_user,
    max_group_members: plan.max_members_per_group ?? defaults.max_group_members,
    max_broadcasts_list: plan.max_broadcasts_list ?? defaults.max_broadcasts_list,
    max_members_per_broadcasts_list: plan.max_members_per_broadcasts_list ?? defaults.max_members_per_broadcasts_list,
    status_limit_per_day: plan.max_status ?? defaults.status_limit_per_day,
    max_storage_per_user_mb: plan.max_storage_per_user_mb ?? defaults.max_storage_per_user_mb,
    allow_media_send: plan.allows_file_sharing ?? defaults.allow_media_send,
  };
}

module.exports = { getEffectiveLimits };