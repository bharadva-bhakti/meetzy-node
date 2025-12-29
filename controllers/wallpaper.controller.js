const { db } = require('../models');
const Wallpaper = db.Wallpaper;
const fs = require('fs');
const path = require('path');

exports.getAllWallpapers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const allowedSortFields = ['id', 'name', 'status', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const query = search ? { name: { $regex: search, $options: 'i' } } : {};

    const [wallpapers, total] = await Promise.all([
      Wallpaper.find(query)
        .sort({ [safeSortField]: sortOrder })
        .skip(skip)
        .limit(limit),
      Wallpaper.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      wallpapers,
    });
  } catch (error) {
    console.error('Error in getAllWallpapers:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createWallpaper = async (req, res) => {
  const { name, status, isDefault = false } = req.body;
  const file = req.file;

  try {
    if (!file) return res.status(400).json({ message: 'Please provide wallpaper.' });

    if (isDefault === 'true' || isDefault === true) {
      await Wallpaper.updateMany({ is_default: true }, { is_default: false });
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
      status: status !== undefined ? status : true,
      is_default: isDefault === 'true' || isDefault === true,
    });

    return res.status(200).json({ message: 'Wallpaper created successfully.', wallpaper });
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

    const wallpaper = await Wallpaper.findById(id);
    if (!wallpaper) return res.status(404).json({ message: 'Wallpaper not found.' });

    const setDefault = isDefault === 'true' || isDefault === true;
    if (setDefault) {
      await Wallpaper.updateMany({ is_default: true }, { is_default: false });
    }

    const updateData = {
      name,
      status: status !== undefined ? status : wallpaper.status,
      is_default: setDefault,
    };

    if (req.file) {
      updateData.wallpaper = req.file.path;
      updateData.metadata = {
        file_size: req.file.size,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        path: req.file.path,
      };
    }

    await wallpaper.updateOne(updateData);
    const updatedWallpaper = await Wallpaper.findById(id);

    return res.status(200).json({ message: 'Wallpaper updated successfully.', wallpaper: updatedWallpaper });
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

    const wallpaper = await Wallpaper.findById(id);
    if (!wallpaper) return res.status(404).json({ message: 'Wallpaper not found.' });

    const newStatus = status !== undefined ? Boolean(status) : wallpaper.status;
    const newIsDefault = isDefault !== undefined ? Boolean(isDefault) : wallpaper.is_default;

    if (!newStatus && wallpaper.is_default) {
      return res.status(400).json({ message: 'You cannot deactivate the default wallpaper' });
    }

    if (!newIsDefault) {
      const otherDefault = await Wallpaper.findOne({ _id: { $ne: id }, is_default: true });
      if (!otherDefault) {
        return res.status(400).json({ message: 'At least one wallpaper must remain as the default.' });
      }
    }

    if (newIsDefault && !newStatus) {
      return res.status(400).json({ message: 'Inactive wallpaper cannot be set as default.' });
    }

    if (newIsDefault) {
      await Wallpaper.updateMany({ is_default: true }, { is_default: false });
    }

    await wallpaper.updateOne({ status: newStatus, is_default: newIsDefault });

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

    const wallpapers = await Wallpaper.find({ _id: { $in: ids } });
    if (wallpapers.length === 0) {
      return res.status(404).json({ message: 'No wallpaper found' });
    }

    for (const wall of wallpapers) {
      if (wall.wallpaper) {
        const filePath = path.resolve(wall.wallpaper);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.error(`Failed to delete file: ${filePath}`, err);
        }
      }
    }

    const result = await Wallpaper.deleteMany({ _id: { $in: ids } });

    const response = {
      message: `${result.deletedCount} wallpaper(s) deleted successfully`,
      deletedCount: result.deletedCount,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteWallpaper:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};