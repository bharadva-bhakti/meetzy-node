const { Wallpaper } = require('../models');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');

exports.getAllWallpapers = async (req,res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  try {
    const allowedSortFields = ['id', 'name', 'status', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';
    const where = search ? { [Op.or]: [{ Name: { [Op.like]: `%${search}%` } }] } : { };

    const { count, rows: wallpapers } = await Wallpaper.findAndCountAll({
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
      wallpapers,
    });
  } catch (error) {
    console.error('Error in getAllWallpapers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createWallpaper = async (req, res) => {
  const { name, status, isDefault=false } = req.body;
  const file = req.file;

  try {
    if (!file) return res.status(400).json({ message: 'Please provide wallpaper.' });

    if (isDefault) {
      await Wallpaper.update({ is_default: false }, { where: { is_default: true } });
    }

    const filePath = file.path;
    const metadata = {
      file_size: file.size,
      original_name: file.originalname,
      mime_type: file.mimetype,
      path: file.path,
    };

    const wallpaper = await Wallpaper.create({
      name,
      wallpaper: filePath,
      metadata,
      status,
      is_default: isDefault
    });

    return res.status(200).json({ message: 'wallpaper created successfully.', wallpaper });
  } catch (error) {
    console.error('Error in createWallpaper:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateWallpaper = async (req, res) => {
  const { id } = req.params;
  const { name, status, isDefault } = req.body;

  try {
    if (!id) return res.status(400).json({ message: 'Id is required.' });

    const wallpaper = await Wallpaper.findByPk(id);
    if (!wallpaper) return res.status(404).json({ message: 'Wallpaper not found.' });
    
    if (Boolean(isDefault)) {
      await Wallpaper.update({ is_default: false }, { where: { is_default: true } });
    }

    const updated = { name, status, is_default: Boolean(isDefault) || false };

    if (req.file) {
      const file = req.file;
      updated.wallpaper = file.path;
      updated.metadata = {
        file_size: file.size,
        original_name: file.originalname,
        mime_type: file.mimetype,
        path: file.path,
      };
    }

    await wallpaper.update(updated);
    return res.status(200).json({ message: 'Wallpaper updated successfully.', wallpaper });
  } catch (error) {
    console.error('Error in updateWallpaper:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateWallpaperStatus = async (req, res) => {
  const { id } = req.params;
  const { status, isDefault } = req.body;
  
  try {
    if (!id) return res.status(400).json({ message: 'Id is required.' });

    const wallpaper = await Wallpaper.findByPk(id);
    if (!wallpaper) return res.status(404).json({ message: 'Wallpaper not found.' });
    
    if(status !== 'undefined' && (status === false && wallpaper.is_default)){
      return res.status(400).json({message: 'You can not deactive default wallpaper'})
    }
    
    if (Boolean(isDefault) === false) {
      const defaultWallpaper = await Wallpaper.findOne({ where: { id: { [Op.ne] : id }, is_default: true }});
      if (!defaultWallpaper) {
        return res.status(400).json({ message: 'At least one wallpaper must remain as the default.' });
      }
    }

    if(Boolean(isDefault) && wallpaper.status === false){
      return res.status(400).json({ message: 'Inactive wallpaper can not set as default.' });
    }
    
    if (Boolean(isDefault)) {
      await Wallpaper.update({ is_default: false }, { where: { is_default: true } });
    }

    await wallpaper.update({ status, is_default: isDefault || false });

    return res.status(200).json({ message: 'Wallpaper status updated successfully.', wallpaper });
  } catch (error) {
    console.error('Error in updateWallpaperStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteWallpaper = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Wallpaper IDs array is required' });
    }

    const wallpaper = await Wallpaper.findAll({ where: { id: ids } });
    if (wallpaper.length === 0) return res.status(404).json({ message: 'No wallpaper found' });

    const foundIds = wallpaper.map((wall) => wall.id);
    const notFoundIds = ids.filter((id) => !foundIds.includes(id));

    for (const wall of wallpaper) {
      if (wall.wallpaper) {
        const filePath = path.resolve(wall.wallpaper);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          } else {
            console.warn(`Wallpaper file not found: ${filePath}`);
          }
        } catch (err) {
          console.error(`Failed to delete wallpaper file: ${filePath}`, err);
        }
      }
    }

    await Wallpaper.destroy({ where: { id: foundIds }, force: true });

    const response = {
      message: `${foundIds.length} wallpaper(s) deleted successfully`,
      deletedCount: foundIds.length,
    };

    if (notFoundIds.length > 0) {
      response.notFound = notFoundIds;
      response.message += `, ${notFoundIds.length} wallpaper(s) not found`;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteWallpaper:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
