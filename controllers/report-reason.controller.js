const { ReportReason } = require('../models');
const { Op } = require('sequelize');

exports.fetchAllData = async (req,res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sortField = req.query.sort_by || 'created_at';
    const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        const allowedSortFields = ['id', 'title', 'created_at', 'updated_at'];
        const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

        const where = search 
            ? { [Op.or]: [{ title: { [Op.like]: `%${search}%` } }] } 
            : {};

        const { count, rows: reports } = await ReportReason.findAndCountAll({
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
            reports
        });
    } catch (error) {
        console.error('Error in fetchAllData:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createReportReason = async (req,res) => {
    const { title } = req.body;

    try {
        if(!title) return res.status(400).json({ message: 'Title is required.'});

        const existing = await ReportReason.findOne({where:{title:title}});
        if(existing){
            return res.status(400).json({ message: 'Already exists this title try another.' })
        }

        await ReportReason.create({title});
        return res.status(201).json({ message: 'Report created successfully.' });
    } catch (error) {
        console.error('Error in createReportReason:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateReportReason = async (req,res) => {
    const { id } = req.params;
    const {title } = req.body;

    try {
        if(!id) return res.status(400).json({ message: 'Id is required.' });

        const report = await ReportReason.findByPk(id);
        if(!report) return res.status(404).json({ message: 'Report not found.' });
        
        if(title !== report.title){
            const existing = await ReportReason.findOne({ where: { title:title }});
            if(existing) return res.status(404).json({message:'Report already exist of this title. Try another.'});
        }

        await report.update({ title });

        return res.status(200).json({ message: 'Report updated successfully', report });
    } catch (error) {
        console.error('Error in updateReportReason:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteReportReason = async (req,res) => {
    const { ids } = req.body;
    
    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'Report reason IDs array is required' });
        }

        const reports = await ReportReason.findAll({ where: { id: ids } });
        if(reports.length === 0) return res.status(404).json({ message: 'Report not found.' });

        const foundIds = reports.map((report) => report.id);
        const notFoundIds = ids.filter((id) => !foundIds.includes(id));

        await ReportReason.destroy({
            where: { id: foundIds },
            force: true,
        });

        const response = {
            message: `${foundIds.length} Report reason(s) deleted successfully`,
            deletedCount: foundIds.length,
        };

        if (notFoundIds.length > 0) {
            response.notFound = notFoundIds;
            response.message += `, ${notFoundIds.length} Report reason(s) not found`;
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteReportReason:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};