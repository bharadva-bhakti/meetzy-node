const { db } = require('../models');
const ContactInquiry = db.ContactInquiry;

exports.getAllInquiries = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const allowedSortFields = ['id', 'name', 'email', 'subject', 'message', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const query = search
      ? {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { subject: { $regex: search, $options: 'i' } },
            { message: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const [inquiries, total] = await Promise.all([
      ContactInquiry.find(query)
        .sort({ [safeSortField]: sortOrder })
        .skip(skip)
        .limit(limit),
      ContactInquiry.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      inquiries,
    });
  } catch (error) {
    console.error('Error in getAllInquiries:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createInquiry = async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    await ContactInquiry.create({ name, email, subject, message });
    return res.status(200).json({ message: 'Contact inquiry created successfully' });
  } catch (error) {
    console.error('Error in createInquiry:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteInquiry = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Inquiry IDs array is required' });
    }

    const result = await ContactInquiry.deleteMany({ _id: { $in: ids } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No inquiries found.' });
    }

    const response = {
      message: `${result.deletedCount} Contact inquiries deleted successfully`,
      deletedCount: result.deletedCount,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteInquiry:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};