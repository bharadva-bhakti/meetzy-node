const { db } = require('../models');
const ReportReason = db.ReportReason;

exports.fetchAllData = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const allowedSortFields = ['id', 'title', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';
    const query = search ? { title: { $regex: search, $options: 'i' } } : {};

    const [reports, total] = await Promise.all([
      ReportReason.find(query)
        .sort({ [safeSortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReportReason.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      reports,
    });
  } catch (error) {
    console.error('Error in fetchAllData:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createReportReason = async (req, res) => {
  const { title } = req.body;

  try {
    if (!title) return res.status(400).json({ message: 'Title is required.' });

    const trimmedTitle = title.trim();
    const existing = await ReportReason.findOne({ title: trimmedTitle });
    if (existing) {
      return res.status(400).json({ message: 'Already exists this title try another.' });
    }

    await ReportReason.create({ title: trimmedTitle });
    return res.status(201).json({ message: 'Report reason created successfully.' });
  } catch (error) {
    console.error('Error in createReportReason:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateReportReason = async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  try {
    if (!id) return res.status(400).json({ message: 'Id is required.' });

    const report = await ReportReason.findById(id);
    if (!report) return res.status(404).json({ message: 'Report not found.' });

    const trimmedTitle = title?.trim();
    if (trimmedTitle && trimmedTitle !== report.title) {
      const existing = await ReportReason.findOne({ title: trimmedTitle });
      if (existing) {
        return res.status(409).json({ message: 'Report already exists with this title. Try another.' });
      }
      report.title = trimmedTitle;
    }

    await report.save();
    return res.status(200).json({ message: 'Report updated successfully', report });
  } catch (error) {
    console.error('Error in updateReportReason:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteReportReason = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Report reason IDs array is required' });
    }

    const result = await ReportReason.deleteMany({ _id: { $in: ids } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No report reasons found.' });
    }

    const response = {
      message: `${result.deletedCount} Report reason(s) deleted successfully`,
      deletedCount: result.deletedCount,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteReportReason:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};