const { Faq } = require('../models');
const { Op } = require('sequelize');

exports.getAllFaqs = async (req,res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';  
    const sortField = req.query.sort_by || 'created_at';
    const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        const allowedSortFields = ['id', 'title','description', 'status', 'created_at', 'updated_at'];
        const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

        const where = search 
            ? { [Op.or]: [
                { title: { [Op.like]: `%${search}%` } }, 
                { description: { [Op.like]: `%${search}%` } }
              ]}
            : {};

        const { count, rows: faqs } = await Faq.findAndCountAll({
            where,
            order: [[safeSortField, sortOrder]],
            limit,
            offset,
        });

        res.status(200).json({
            total: count,
            totalPages: Math.ceil(count / parseInt(limit)),
            page: parseInt(page),
            limit: parseInt(limit),
            faqs
        });
    } catch (error) {
        console.error('Error in getAllFaqs:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createFaq = async (req,res) => {
    const {title,description, status} = req.body;

    try {
        if(!title || !description){
            return res.status(400).json({ message: 'Title and description are required.'});
        }

        const existing = await Faq.findOne({
            where: { title : { [Op.like]: title.trim() }}
        });
        if(existing) return res.status(400).json({ message: 'FAQ with this title already exists.'})
        
        const faq = await Faq.create({ 
            title: title.trim(),
            description: description.trim(),
            status 
        });
        
        res.status(201).json({ message: 'FAQ created successfully', faq});
    } catch (error) {
        console.error('Error in getAllFaqs:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateFaq = async (req,res) => {
    const { id } = req.params;
    const {title,description, status } = req.body;

    try {
        if(!id) return res.status(400).json({ message: 'Id is required.' });

        const faq = await Faq.findByPk(id);
        if(!faq) return res.status(404).json({ message: 'Faq not found.' });

        if(!title || !description){
            return res.status(400).json({ message: 'Title and description is required.' });
        }
        
        const existingFaq = await Faq.findOne({
            where: {
              title: { [Op.like]: title.trim() },
              id: { [Op.ne]: id }
            }
        });
        if (existingFaq) {
            return res.status(409).json({ message: 'FAQ with this question already exists'});
        }

        await faq.update({
            title: title.trim(), 
            description: description.trim(), 
            status
        });

        return res.status(200).json({ message: 'FAQ updated successfully', faq });
    } catch (error) {
        console.error('Error in updateFaq:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateFaqStatus = async (req,res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        if(!id) return res.status(400).json({ message: 'Id is required.' });

        const faq = await Faq.findByPk(id);
        if(!faq) return res.status(404).json({ message: 'Faq not found.' });

        await faq.update({status});
        
        res.status(200).json({ message: `FAQ ${status? 'active' : 'de-active'} successfully.`});
    } catch (error) {
        console.error('Error in updateFaqStatus:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteFaq = async (req,res) => {
    const { ids } = req.body;

    try {
        if(!ids || !Array.isArray(ids) || ids.length === 0){
            return res.status(400).json({ message: 'Faq IDs array is required' });
        }
        const faqs = await Faq.findAll({ where: { id: ids }});
        if(faqs.length === 0) return res.status(404).json({ message: 'Faq not found.' });
        
        const foundIds = faqs.map((faq) => faq.id);
        const notFoundIds = ids.filter((id) => !foundIds.includes(id));

        await Faq.destroy({
            where: { id: foundIds },
            force: true
        });

        const response = {
            message: `${foundIds.length} faq(s) deleted successfully`,
            deletedCount: foundIds.length,
        };

        if (notFoundIds.length > 0) {
            response.notFound = notFoundIds;
            response.message += `, ${notFoundIds.length} faq(s) not found`;
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteFaq:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};