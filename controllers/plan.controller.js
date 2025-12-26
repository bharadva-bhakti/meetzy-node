
const { Op } = require('sequelize');
const { Plan } = require('../models');

exports.getAllPlans = async (req,res) => {
    try {
        const { status, search, billing_cycle, is_default, page = 1, limit = 10, sort_by = 'display_order', sort_order = 'DESC'} = req.query;
        const offset = (page - 1) * limit;
        const whereClause = {};
        
    
        if (status) whereClause.status = status;
        if (billing_cycle) whereClause.billing_cycle = billing_cycle;
    
        if (is_default !== undefined) {
          whereClause.is_default = is_default === 'true';
        }
    
        if (search) {
          whereClause[Op.or] = [
            { name: { [Op.like]: `%${search}%` } },
            { description: { [Op.like]: `%${search}%` } },
            { slug: { [Op.like]: `%${search}%` } }
          ];
        }

        const total = await Plan.count({ where: whereClause });
        
        const plans = await Plan.findAll({
          where: whereClause,
          order: [[sort_by, sort_order.toUpperCase()]],
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
    
        return res.status(200).json({
          message: 'Plans retrieved successfully',
          data: {
            plans: plans,
            total: total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
          }
        });
    
    } catch (error) {
        console.error('Error in getAllPlans:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getActivePlans = async (req,res) => {
    try {
        const plans = await Plan.findAll({
            where: { status: 'active' },
            order: [['display_order', 'ASC']],
            attributes: { exclude: ['created_at', 'updated_at', 'deleted_at']}
        });
    
        return res.status(200).json({
            message: 'Active plans retrieved successfully',
            data: plans
        });
    } catch (error) {
        console.error('Error in getActivePlans:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }  
};

exports.getPlanById = async (req, res) => {
    const { id } = req.params;

    try {
        const plan = await Plan.findByPk(id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        return res.status(200).json({
            message: 'Plan retrieved successfully', data: plan
        });
    } catch (error) {
        console.error('Error in getPlanById:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.getPlanBySlug = async (req,res) => {
    try {
        const { slug } = req.params;
    
        const plan = await Plan.findOne({ where: { slug }});
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }
    
        return res.status(200).json({
            message: 'Plan retrieved successfully',
            data: plan
        });
    } catch (error) {
        console.error('Error in getPlanBySlug:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createPlan = async (req,res) => {
    try {
        const { name, slug, description, 
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
            trial_period_days = 0
        } = req.body;
    
        if (!name || !slug) {
            return res.status(400).json({ message: 'Name and slug are required'});
        }
    
        const slugRegex = /^[a-z0-9-]+$/;
        if (!slugRegex.test(slug)) {
          return res.status(400).json({ message: 'Slug can only contain lowercase letters, numbers, and hyphens'});
        }
    
        const existingPlan = await Plan.findOne({ where: { slug: slug.trim() }});
        if (existingPlan) {
            return res.status(409).json({ message: 'Plan with this slug already exists'});
        }
    
        if (is_default) {
            await Plan.update({ is_default: false }, { where: { is_default: true } });
        }
    
        const newPlan = await Plan.create({
            name: name.trim(),
            slug: slug.trim().toLowerCase(),
            description: description?.trim(),
            status,
            price_per_user_per_month: parseFloat(price_per_user_per_month),
            price_per_user_per_year: price_per_user_per_year ? parseFloat(price_per_user_per_year) : null,
            billing_cycle,
            max_members_per_group: parseInt(max_members_per_group),
            max_members_per_broadcasts_list: parseInt(max_members_per_broadcasts_list),
            max_storage_per_user_mb: parseInt(max_storage_per_user_mb),
            max_groups: parseInt(max_groups),
            allows_file_sharing,
            features,
            display_order: parseInt(display_order),
            is_default,
            trial_period_days: parseInt(trial_period_days),
            max_status: parseInt(max_status),
            max_broadcasts_list: parseInt(max_broadcasts_list),
        });
    
        return res.status(201).json({ message: 'Plan created successfully', data: newPlan });
    } catch (error) {
        console.error('Error in createPlan:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
    
};

exports.updatePlan = async (req,res) => {
    try {
        const { id } = req.params;
        const {
          name,
          slug,
          description,
          status,
          price_per_user_per_month,
          price_per_user_per_year,
          billing_cycle,
          max_members_per_group,
          max_storage_per_user_mb,
          max_groups,
          allows_file_sharing,
          features,
          display_order,
          is_default,
          trial_period_days,
          max_members_per_broadcasts_list,
          max_status,
          max_broadcasts_list
        } = req.body;

        const plan = await Plan.findByPk(id);
        if (!plan) {
            return res.status(404).json({ message: 'Plan not found' });
        }

        if ((name !== undefined && !name.trim()) || (slug !== undefined && !slug.trim())) {
            return res.status(400).json({ message: 'Name and slug cannot be empty'});
        }

        if (slug) {
            const slugRegex = /^[a-z0-9-]+$/;
            if (!slugRegex.test(slug)) {
                return res.status(400).json({ message: 'Slug can only contain lowercase letters, numbers, and hyphens'});
            }
        
            const existingPlan = await Plan.findOne({ where: { slug: slug.trim(), id: { [Op.ne]: id }}});
            if (existingPlan) {
                return res.status(409).json({ message: 'Another plan with this slug already exists'});
            }
        }

        if (is_default === true) {
            await Plan.update(
                { is_default: false }, { where: { is_default: true, id: { [Op.ne]: id } } }
            );
        }

        const updateData = {};

        if (name !== undefined) updateData.name = name.trim();
        if (slug !== undefined) updateData.slug = slug.trim().toLowerCase();
        if (description !== undefined) updateData.description = description?.trim();
        if (status !== undefined) updateData.status = status;

        if (price_per_user_per_month !== undefined){
            updateData.price_per_user_per_month = parseFloat(price_per_user_per_month);
        } 
        
        if (price_per_user_per_year !== undefined){
            updateData.price_per_user_per_year = price_per_user_per_year ? parseFloat(price_per_user_per_year) : null;
        } 

        if (billing_cycle !== undefined) updateData.billing_cycle = billing_cycle;
        if (max_members_per_group !== undefined) updateData.max_members_per_group = parseInt(max_members_per_group);
        if (max_storage_per_user_mb !== undefined) updateData.max_storage_per_user_mb = parseInt(max_storage_per_user_mb);
        if (max_groups !== undefined) updateData.max_groups = parseInt(max_groups);
        if (allows_file_sharing !== undefined) updateData.allows_file_sharing = allows_file_sharing;
        if (features !== undefined) updateData.features = features;
        if (display_order !== undefined) updateData.display_order = parseInt(display_order);
        if (is_default !== undefined) updateData.is_default = is_default;
        if (trial_period_days !== undefined) updateData.trial_period_days = parseInt(trial_period_days);
        if (max_broadcasts_list !== undefined) updateData.max_broadcasts_list = parseInt(max_broadcasts_list);
        if (max_members_per_broadcasts_list !== undefined) updateData.max_members_per_broadcasts_list = parseInt(max_members_per_broadcasts_list);
        if (max_status !== undefined) updateData.max_status = parseInt(max_status);

        await plan.update(updateData);

        return res.status(200).json({ message: 'Plan updated successfully', data: plan});

    } catch (error) {
        console.error('Error in updatePlan:', error);
        if (error.name === 'SequelizeValidationError') {
            return res.status(400).json({ message: 'Validation error', errors: error.errors.map(e => e.message)});
        }
        return res.status(500).json({ message: 'Internal server error' });
    }  
};

exports.updatePlanStatus = async (req,res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        if (!status || !['active', 'inactive'].includes(status)) {
            return res.status(400).json({ message: 'Valid status (active/inactive) is required'});
        }

        const plan = await Plan.findByPk(id);
        if (!plan) return res.status(404).json({ message: 'Plan not found' });

        if (plan.is_default && status === 'inactive') {
            return res.status(400).json({
                message: 'Cannot deactivate default plan. Set another plan as default first.'
            });
        }

        await plan.update({ status });

        return res.status(200).json({ message: 'Plan status updated successfully', data: plan });
    } catch (error) {
        console.error('Error in updatePlanStatus:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.setDefaultPlan = async (req,res) => {
    const { id } = req.params;
    
    try {
        const plan = await Plan.findByPk(id);
        if(!plan) return res.status(404).json({ message: 'Plan not found.' });    
        

        if (plan.status !== 'active') {
            return res.status(400).json({ message: 'Cannot set an inactive plan as default' });
        }

        await Plan.update({ is_default: false }, { where: { is_default: true } });
        await plan.update({ is_default: true });

        return res.status(200).json({ message: 'Default plan updated successfully', default_plan_id: id});
    } catch (error) {
        console.error('Error in setDefaultPlan:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deletePlan = async (req,res) => {
    const { ids } = req.body;
    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'No Plan IDs provided or invalid format' });
        }
      
        const basicPlans = await Plan.findAll({where: { id: ids, slug: 'basic'}});
        if (basicPlans.length > 0) {
            return res.status(400).json({
                message: 'Cannot delete the basic plan. It is the system default plan for downgraded subscriptions.'
            });
        }
    
        const defaultPlans = await Plan.findAll({ where: { id: ids, is_default: true }});
        if (defaultPlans.length > 0) {
            return res.status(400).json({
                message: 'Cannot delete default plans. Set another plan as default first.'
            });
        }
      
          const plans = await Plan.findAll({ where: { id: ids, }});
          if (plans.length === 0) {
            return res.status(404).json({ message: 'No plans found for the provided IDs' });
          }
      
          await Plan.destroy({ where: { id: ids }});
      
          return res.status(200).json({
            message: `Successfully deleted ${plans.length} plan(s)`,
          });
    } catch (error) {
        console.error('Error in deletePlan:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }  
};