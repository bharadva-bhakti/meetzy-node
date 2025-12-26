const { db } = require('../models');
const Sticker = db.Sticker;
const fs = require('fs');
const path = require('path');

exports.getAllSticker = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const allowedSortFields = ['id', 'title', 'status', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const query = search ? { title: { $regex: search, $options: 'i' } } : {};

    const [stickers, total] = await Promise.all([
      Sticker.find(query)
        .sort({ [safeSortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Sticker.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      stickers,
    });
  } catch (error) {
    console.error('Error in getAllSticker:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createSticker = async (req, res) => {
  const { title, status } = req.body;
  const file = req.file;

  try {
    if (!file) return res.status(400).json({ message: 'Sticker is required' });

    const stickerPath = file.path;
    const metadata = {
      file_size: file.size,
      original_name: file.originalname,
      mime_type: file.mimetype,
      path: file.path,
    };

    const created = await Sticker.create({
      title,
      sticker: stickerPath,
      metadata,
      status: status !== undefined ? status : true,
    });

    return res.status(200).json({ message: 'Sticker created successfully.', sticker: created });
  } catch (error) {
    console.error('Error in createSticker:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateSticker = async (req, res) => {
  const { id } = req.params;
  const { title, status } = req.body;

  try {
    if (!id) return res.status(400).json({ message: 'Id is required.' });

    const sticker = await Sticker.findById(id);
    if (!sticker) return res.status(404).json({ message: 'Sticker not found.' });

    const updateData = { title, status };

    if (req.file) {
      updateData.sticker = req.file.path;
      updateData.metadata = {
        file_size: req.file.size,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        path: req.file.path,
      };
    }

    await sticker.updateOne(updateData);
    const updatedSticker = await Sticker.findById(id);

    return res.status(200).json({ message: 'Sticker updated successfully.', sticker: updatedSticker });
  } catch (error) {
    console.error('Error in updateSticker:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateStickerStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    if (!id) return res.status(400).json({ message: 'Id is required.' });

    const sticker = await Sticker.findById(id);
    if (!sticker) return res.status(404).json({ message: 'Sticker not found.' });

    await sticker.updateOne({ status });
    return res.status(200).json({
      message: `Sticker ${status ? 'activated' : 'deactivated'} successfully.`,
      sticker,
    });
  } catch (error) {
    console.error('Error in updateStickerStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteSticker = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Sticker IDs array is required' });
    }

    const stickers = await Sticker.find({ _id: { $in: ids } });

    if (stickers.length === 0) {
      return res.status(404).json({ message: 'No stickers found.' });
    }

    for (const sticker of stickers) {
      if (sticker.sticker) {
        const filePath = path.resolve(sticker.sticker);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (err) {
          console.error(`Failed to delete file: ${filePath}`, err);
        }
      }
    }

    const result = await Sticker.deleteMany({ _id: { $in: ids } });

    const response = {
      message: `${result.deletedCount} sticker(s) deleted successfully`,
      deletedCount: result.deletedCount,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteSticker:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};