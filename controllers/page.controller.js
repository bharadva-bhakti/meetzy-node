const { Op } = require('sequelize');
const { Page } = require('../models');
const sanitizeHtml = require('sanitize-html');

exports.fetchPages = async (req,res) => {
  const { search, created_by, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  const whereClause = { };

  try {
    if(created_by) whereClause.created_by = created_by;

    if (search) {
      whereClause[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { content: { [Op.like]: `%${search}%` } },
        { meta_title: { [Op.like]: `%${search}%` } },
        { meta_description: { [Op.like]: `%${search}%` } }
      ];
    }
    const total = await Page.count({ where: whereClause });

    const pages = await Page.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(201).json({
      message: 'Pages retrieved successfully',
      data: {
        pages: pages,
        total: total,
        totalPages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error in fetchPages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getPageBySlug = async (req,res) => {
  const { slug } = req.params;

  try {
    const page = await Page.findOne({ where: { slug, status:true }});
    if(!page) return res.status(404).json({ message: 'Page not found.' });

    return res.status(200).json({ message: 'Page retrieved successfully.', page });
  } catch (error) {
    console.error('Error in getPageBySlug', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createPage = async (req,res) => {
  const { title, slug, meta_title, meta_description, status, created_by} = req.body
  let content = req.body.content;

  try {
    if (!title || !slug || !created_by) {
      return res.status(400).json({ message: 'Title, slug, and created_by are required' });
    }

    const existingPage = await Page.findOne({ where:{ slug: slug.trim().toLowerCase()}});
    if(existingPage) return res.status(409).json({ message: 'Page with this slug already exists'});

    let statusValue = true;
    if (typeof status === 'boolean') {
      statusValue = status;
    } else if (typeof status === 'string') {
      if (status.toLowerCase() === 'false') statusValue = false;
      else statusValue = true;
    }

    content = sanitizeHtml(content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
      allowedAttributes: {
        '*': ['style', 'class'],
        a: ['href', 'target'],
        img: ['src', 'alt'],
      },
    });

    const newPage = await Page.create({
      title: title.trim(),
      slug: slug.trim().toLowerCase(),
      content: content ? content.trim() : null,
      meta_title: meta_title ? meta_title.trim() : null,
      meta_description: meta_description ? meta_description.trim() : null,
      status: statusValue,
      created_by
    });

    return res.status(201).json({ message: 'Page created successfully.', page: newPage });

  } catch (error) {
    console.error('Error in createPage', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePage = async (req, res) => {
  const { id } = req.params;
  const { title, slug, meta_title, meta_description, status } = req.body;
  let content = req.body.content;
  
  try {
    const page = await Page.findByPk(id);
    if(!page) return res.status(404).json({ message: 'Page not found.' });

    if(!title || !slug) return res.status(400).json({ message: 'Title and slug are required.'});

    const existingPage = await Page.findOne({
      where: { slug: slug.trim().toLowerCase(), id: { [Op.ne]: id }}
    });
    if (existingPage) return res.status(400).json({ message: 'Page with this slug already exists.'});
    
    content = sanitizeHtml(content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
      allowedAttributes: {
        '*': ['style', 'class'],
        a: ['href', 'target'],
        img: ['src', 'alt'],
      },
    });

    await page.update({
      title: title.trim(),
      slug: slug.trim(),
      content: content ? content.trim() : page.content,
      meta_title: meta_title ? meta_title.trim() : page.meta_title,
      meta_description: meta_description ? meta_description.trim() : page.meta_description,
      status: status !== undefined ? status : page.status
    });

    return res.status(200).json({ message: 'Page updated successfully.', page});
  } catch (error) {
    console.error('Error in updatePages', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePageStatus = async (req,res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const page = await Page.findByPk(id);
    if(!page) return res.status(404).json({ message: 'Page not found.'});

    await page.update({status});

    return res.status(200).json({ message: 'Page status updated successfully.', page});
  } catch (error) {
    console.error('Error in updatePageStatus', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deletePage = async (req,res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No page IDs provided or invalid format' });
    }

    const pages = await Page.findAll({ where: { id: ids, }});
    if (pages.length === 0) {
      return res.status(404).json({ message: 'No pages found for the provided IDs' });
    }

    await Page.destroy({ where: { id: ids } });
    return res.status(200).json({ message: `Successfully deleted ${pages.length} page(s)`});

  } catch (error) {
    console.error('Error in deletePage', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};