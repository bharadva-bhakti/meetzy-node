const { ContactInquiry } = require('../models');
const { Op } = require('sequelize');

exports.getAllInquiries = async (req,res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const sortField = req.query.sort_by || 'created_at';
  const sortOrder = req.query.sort_order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  try {
    const allowedSortFields = ['id', 'name','email', 'subject', 'message', 'created_at', 'updated_at'];
    const safeSortField = allowedSortFields.includes(sortField) ? sortField : 'created_at';

    const where = search 
      ? { 
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } }, 
            { email: { [Op.like]: `%${search}%` } },
            { subject: { [Op.like]: `%${search}%` } },
            { message: { [Op.like]: `%${search}%` } }
          ] 
        } 
      : {};

    const { count, rows: inquiries } = await ContactInquiry.findAndCountAll({
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
      inquiries
    });
  } catch (error) {
    console.error('Error in getAllInquiries:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createInquiry = async (req,res) => {
  const { name, email, subject, message } = req.body;
  
  if(!name || !email || !subject || !message) return res.status(400).json('All fields are required');

  try {
    await ContactInquiry.create({ name, email, subject, message, created_at: new Date()});
    return res.status(200).json({ message: 'Contact inquiry created successfully' });
  
  } catch (error) {
    console.error('Error in createInquiry:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteInquiry = async (req,res) => {
  const { ids } = req.body;
  
  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Inquiry IDs array is required' });
    }

    const inquiries = await ContactInquiry.findAll({ where: { id: ids } });
    if(inquiries.length === 0) return res.status(404).json({ message: 'Inquiry not found.' });

    const foundIds = inquiries.map((inquiry) => inquiry.id);
    const notFoundIds = ids.filter((id) => !foundIds.includes(id));

    await ContactInquiry.destroy({
      where: { id: foundIds },
      force: true,
    });

    const response = {
      message: `${foundIds.length} Contact inquiries deleted successfully`,
      deletedCount: foundIds.length,
    };

    if (notFoundIds.length > 0) {
      response.notFound = notFoundIds;
      response.message += `, ${notFoundIds.length} Contact inquiries not found`;
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error in deleteInquiry:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }  
};