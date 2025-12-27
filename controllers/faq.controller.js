const { db } = require('../models');
const Faq = db.Faq;

exports.getAllFaqs = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 1 : -1;

  try {
    const allowedSortFields = ['id', 'title', 'description', 'status', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const query = search
      ? {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ],
        }
      : {};

    const [faqs, total] = await Promise.all([
      Faq.find(query).sort({ [safeSortField]: sortOrder }).skip(skip).limit(limit).lean(),
      Faq.countDocuments(query),
    ]);

    res.status(200).json({
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      faqs,
    });
  } catch (error) {
    console.error('Error in getAllFaqs:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createFaq = async (req, res) => {
  const { title, description, status } = req.body;

  try {
    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required.' });
    }

    const trimmedTitle = title.trim();

    const faq = await Faq.create({
      title: trimmedTitle,
      description: description.trim(),
      status: status !== undefined ? status : true,
    });

    res.status(201).json({ message: 'FAQ created successfully', faq });
  } catch (error) {
    console.error('Error in createFaq:', error);

    if (error.code === 11000) {
      return res.status(400).json({ 
        message: 'FAQ with this title already exists.' 
      });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateFaq = async (req, res) => {
  const { id } = req.params;
  const { title, description, status } = req.body;

  try {
    if (!id) {
      return res.status(400).json({ message: 'FAQ ID is required.' });
    }

    const faq = await Faq.findById(id);
    if (!faq) {
      return res.status(404).json({ message: 'FAQ not found.' });
    }

    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required.' });
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle !== faq.title) {
      const existingFaq = await Faq.findOne({
        title: { $regex: `^${trimmedTitle}$`, $options: 'i' },
        _id: { $ne: id },
      });

      if (existingFaq) {
        return res.status(409).json({ message: 'FAQ with this title already exists.' });
      }
    }

    await Faq.updateOne(
      { _id: id },
      {
        $set: {
          title: trimmedTitle,
          description: description.trim(),
          status: status !== undefined ? Boolean(status) : faq.status,
        },
      }
    );

    const updatedFaq = await Faq.findById(id).lean();

    return res.status(200).json({
      message: 'FAQ updated successfully',
      faq: updatedFaq,
    });
  } catch (error) {
    console.error('Error in updateFaq:', error);

    if (error.code === 11000) {
      return res.status(409).json({ message: 'FAQ with this title already exists.' });
    }

    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateFaqStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    if (!id) return res.status(400).json({ message: 'Id is required.' });

    const faq = await Faq.findById(id);
    if (!faq) return res.status(404).json({ message: 'Faq not found.' });

    await faq.updateOne({ status });
    res.status(200).json({ message: `FAQ ${status ? 'activated' : 'deactivated'} successfully.` });
  } catch (error) {
    console.error('Error in updateFaqStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteFaq = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Faq IDs array is required' });
    }

    const result = await Faq.deleteMany({ _id: { $in: ids } });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No FAQs found.' });
    }

    const response = {
      message: `${result.deletedCount} faq(s) deleted successfully`,
      deletedCount: result.deletedCount,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteFaq:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};