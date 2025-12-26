const { Sticker } = require('../models');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

exports.getAllSticker = async (req,res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const sortField = req.query.sort_by || 'created_at';
    const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        const allowedSortFields = ['id', 'title', 'status', 'created_at', 'updated_at'];
        const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

        const where = search ? { [Op.or]: [{ title: { [Op.like]: `%${search}%` } }]} : {};

        const { count, rows: stickers } = await Sticker.findAndCountAll({
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
            stickers
        });
    } catch (error) {
        console.error('Error in getAllSticker:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.createSticker = async (req,res) => {
    const { title, status } = req.body;
    const file = req.file;

    try {
        if(!file) return res.status(400).json({ message: 'Sticker is required'});
        
        const sticker = file.path;
        const metadata = {
            file_size: file.size,
            original_name: file.originalname,
            mime_type: file.mimetype,
            path: file.path
        }
    
        const created = await Sticker.create({ title, sticker, metadata, status });
        
        return res.status(200).json({ message: 'Sticker created successfully.' , sticker: created});   
    } catch (error) {
        console.error('Error in createSticker:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateSticker = async (req,res) => {
    const { id } = req.params;
    const { title, status } = req.body;

    try {
        if(!id) return res.status(400).json({ message: 'Id is required.'});
        
        const sticker = await Sticker.findByPk(id);
        if(!sticker) return res.status(404).json({ message: 'Sticker not found.'});

        const updated = { title, status };

        if(req.file){
            const file = req.file;
            updated.sticker = file.path;
            updated.metadata = {
                file_size: file.size,
                original_name: file.originalname,
                mime_type: file.mimetype,
                path: file.path
            }
        }

        await sticker.update(updated);
        return res.status(200).json({ message: 'Sticker updated successfully.', sticker})
    } catch (error) {
        console.error('Error in updateSticker:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateStickerStatus = async (req,res) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        if(!id) return res.status(400).json({ message: 'Id is required.' });

        const sticker = await Sticker.findByPk(id);
        if(!sticker) return res.status(404).json({ message: 'Sticker not found.' });

        await sticker.update({ status });
        return res.status(200).json({ message: `Sticker ${status ? 'active' : 'de-active'} successfully.`,sticker});
    } catch (error) {
        console.error('Error in updateStickerStatus:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteSticker = async (req,res) => {
    const { ids } = req.body;
    
    try {
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'Sticker IDs array is required' });
        }

        const stickers = await Sticker.findAll({ where: { id: ids }});
        if(stickers.length === 0) return res.status(400).json({ message: 'No stickers found.' });

        const foundIds = stickers.map((sticker) => sticker.id);
        const notFoundIds = ids.filter((id) => !foundIds.includes(id));

        for (const sticker of stickers) {
            if (sticker.sticker) {
                const filePath = path.resolve(sticker.sticker);
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    } else {
                        console.warn(`Sticker file not found: ${filePath}`);
                    }
                } catch (err) {
                    console.error(`Failed to delete sticker file: ${filePath}`, err);
                }
            }
        }

        await Sticker.destroy({
            where: { id: foundIds },
            force: true,
        });

        const response = {
            message: `${foundIds.length} sticker(s) deleted successfully`,
            deletedCount: foundIds.length,
        };

        if (notFoundIds.length > 0) {
            response.notFound = notFoundIds;
            response.message += `, ${notFoundIds.length} sticker(s) not found`;
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error('Error in deleteSticker:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};