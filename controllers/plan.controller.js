const mongoose = require('mongoose');
const { db } = require('../models');
const Plan = db.Plan;

exports.getAllPlans = async (req, res) => {
  const {
    status, search, billing_cycle, is_default, page = 1, limit = 10, sort_by = 'display_order', sort_order = 'DESC',
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const query = {};

  try {
    if (status) query.status = status;
    if (billing_cycle) query.billing_cycle = billing_cycle;
    if (is_default !== undefined) query.is_default = is_default === 'true';

    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: regex },{ description: regex },{ slug: regex }];
    }

    const total = await Plan.countDocuments(query);

    const plans = await Plan.find(query)
    .sort({ [sort_by]: sort_order.toUpperCase() === 'DESC' ? -1 : 1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();
  
    const formattedPlans = plans.map(plan => {
      const obj = { ...plan };
      if (obj.createdAt) obj.created_at = obj.createdAt;
      if (obj.updatedAt) obj.updated_at = obj.updatedAt;
      if(obj._id) obj.id = obj._id.toString();
      delete obj.createdAt;
      delete obj.updatedAt;
      delete obj._id;
      return obj;
    });
  
    return res.status(200).json({
      message: 'Plans retrieved successfully',
      data: {
        plans: formattedPlans,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error in getAllPlans:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getActivePlans = async (req, res) => {
  try {
    const plans = await Plan.find({ status: 'active' }).sort({ display_order: 1 }).select('-createdAt -updatedAt');

    return res.status(200).json({
      message: 'Active plans retrieved successfully',
      data: plans,
    });
  } catch (error) {
    console.error('Error in getActivePlans:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getPlanById = async (req, res) => {
  const { id } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    return res.status(200).json({
      message: 'Plan retrieved successfully',
      data: plan,
    });
  } catch (error) {
    console.error('Error in getPlanById:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getPlanBySlug = async (req, res) => {
  const { slug } = req.params;

  try {
    const plan = await Plan.findOne({ slug });
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    return res.status(200).json({
      message: 'Plan retrieved successfully',
      data: plan,
    });
  } catch (error) {
    console.error('Error in getPlanBySlug:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createPlan = async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      status = 'active',
      price_per_user_per_month = 0,
      price_per_user_per_year = null,
      billing_cycle = 'monthly',
      max_members_per_group = 10,
      max_storage_per_user_mb = 5000,
      max_broadcasts_list = 10,
      max_members_per_broadcasts_list = 10,
      max_status = 10,
      max_groups = 50,
      allows_file_sharing = true,
      features = {},
      display_order = 0,
      is_default = false,
      trial_period_days = 0,
      video_calls_enabled = true,
    } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ message: 'Name and slug are required' });
    }

    const slugTrimmed = slug.trim().toLowerCase();
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slugTrimmed)) {
      return res.status(400).json({
        message: 'Slug can only contain lowercase letters, numbers, and hyphens',
      });
    }

    const existingPlan = await Plan.findOne({ slug: slugTrimmed });
    if (existingPlan) {
      return res.status(409).json({ message: 'Plan with this slug already exists' });
    }

    if (is_default) {
      await Plan.updateMany({ is_default: true }, { is_default: false });
    }

    const newPlan = await Plan.create({
      name: name.trim(),
      slug: slugTrimmed,
      description: description?.trim() || null,
      status,
      price_per_user_per_month: parseFloat(price_per_user_per_month),
      price_per_user_per_year: price_per_user_per_year ? parseFloat(price_per_user_per_year) : null,
      billing_cycle,
      max_members_per_group: parseInt(max_members_per_group),
      max_storage_per_user_mb: parseInt(max_storage_per_user_mb),
      max_broadcasts_list: parseInt(max_broadcasts_list),
      max_members_per_broadcasts_list: parseInt(max_members_per_broadcasts_list),
      max_status: parseInt(max_status),
      max_groups: parseInt(max_groups),
      allows_file_sharing,
      features,
      display_order: parseInt(display_order),
      is_default,
      trial_period_days: parseInt(trial_period_days),
      video_calls_enabled,
    });

    return res.status(201).json({
      message: 'Plan created successfully',
      data: newPlan,
    });
  } catch (error) {
    console.error('Error in createPlan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePlan = async (req, res) => {
  const { id } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    const { name, slug, description, status, price_per_user_per_month, price_per_user_per_year, billing_cycle,
      max_members_per_group, max_storage_per_user_mb, max_groups, allows_file_sharing, features, display_order,
      is_default, trial_period_days, max_members_per_broadcasts_list, max_status, max_broadcasts_list, video_calls_enabled,
    } = req.body;

    if ((name !== undefined && !name.trim()) || (slug !== undefined && !slug.trim())) {
      return res.status(400).json({ message: 'Name and slug cannot be empty' });
    }

    if (slug !== undefined) {
      const slugTrimmed = slug.trim().toLowerCase();
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(slugTrimmed)) {
        return res.status(400).json({message: 'Slug can only contain lowercase letters, numbers, and hyphens',});
      }

      const existingPlan = await Plan.findOne({slug: slugTrimmed,_id: { $ne: id }});
      if (existingPlan) {
        return res.status(409).json({ message: 'Another plan with this slug already exists' });
      }

      plan.slug = slugTrimmed;
    }

    if (is_default === true) {
      await Plan.updateMany({ is_default: true, _id: { $ne: id } },{ is_default: false });
    }

    if (name !== undefined) plan.name = name.trim();
    if (description !== undefined) plan.description = description?.trim() || null;
    if (status !== undefined) plan.status = status;
    if (price_per_user_per_month !== undefined) plan.price_per_user_per_month = parseFloat(price_per_user_per_month);
    if (price_per_user_per_year !== undefined) plan.price_per_user_per_year = price_per_user_per_year ? parseFloat(price_per_user_per_year) : null;
    if (billing_cycle !== undefined) plan.billing_cycle = billing_cycle;
    if (max_members_per_group !== undefined) plan.max_members_per_group = parseInt(max_members_per_group);
    if (max_storage_per_user_mb !== undefined) plan.max_storage_per_user_mb = parseInt(max_storage_per_user_mb);
    if (max_groups !== undefined) plan.max_groups = parseInt(max_groups);
    if (allows_file_sharing !== undefined) plan.allows_file_sharing = allows_file_sharing;
    if (video_calls_enabled !== undefined) plan.video_calls_enabled = video_calls_enabled;
    if (features !== undefined) plan.features = features;
    if (display_order !== undefined) plan.display_order = parseInt(display_order);
    if (is_default !== undefined) plan.is_default = is_default;
    if (trial_period_days !== undefined) plan.trial_period_days = parseInt(trial_period_days);
    if (max_broadcasts_list !== undefined) plan.max_broadcasts_list = parseInt(max_broadcasts_list);
    if (max_members_per_broadcasts_list !== undefined) plan.max_members_per_broadcasts_list = parseInt(max_members_per_broadcasts_list);
    if (max_status !== undefined) plan.max_status = parseInt(max_status);

    await plan.save();

    return res.status(200).json({
      message: 'Plan updated successfully',
      data: plan,
    });
  } catch (error) {
    console.error('Error in updatePlan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePlanStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Valid status (active/inactive) is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const plan = await Plan.findById(id);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    if (plan.is_default && status === 'inactive') {
      return res.status(400).json({
        message: 'Cannot deactivate default plan. Set another plan as default first.',
      });
    }

    plan.status = status;
    await plan.save();

    return res.status(200).json({
      message: 'Plan status updated successfully',
      data: plan,
    });
  } catch (error) {
    console.error('Error in updatePlanStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.setDefaultPlan = async (req, res) => {
  const { id } = req.params;

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid plan ID' });
    }

    const plan = await Plan.findById(id);
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });

    if (plan.status !== 'active') {
      return res.status(400).json({ message: 'Cannot set an inactive plan as default' });
    }

    await Plan.updateMany({ is_default: true }, { is_default: false });
    plan.is_default = true;
    await plan.save();

    return res.status(200).json({
      message: 'Default plan updated successfully',
      default_plan_id: id,
    });
  } catch (error) {
    console.error('Error in setDefaultPlan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deletePlan = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No Plan IDs provided or invalid format' });
    }

    const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== ids.length) {
      return res.status(400).json({ message: 'One or more invalid plan IDs' });
    }

    const basicPlans = await Plan.find({ _id: { $in: validIds }, slug: 'basic' });
    if (basicPlans.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete the basic plan. It is the system default plan for downgraded subscriptions.',
      });
    }

    const defaultPlans = await Plan.find({ _id: { $in: validIds }, is_default: true });
    if (defaultPlans.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete default plans. Set another plan as default first.',
      });
    }

    const result = await Plan.deleteMany({ _id: { $in: validIds } });

    return res.status(200).json({
      message: `Successfully deleted ${result.deletedCount} plan(s)`,
    });
  } catch (error) {
    console.error('Error in deletePlan:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};