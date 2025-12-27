const sanitizeHtml = require('sanitize-html');
const { db } = require('../models');
const Page = db.Page;

exports.fetchPages = async (req, res) => {
  const { search, created_by, page = 1, limit = 10 } = req.query;
  const skip = (page - 1) * limit;

  try {
    const query = {};

    if (created_by) query.created_by = created_by;

    if (search) {
      const regex = { $regex: search, $options: 'i' };
      query.$or = [
        { title: regex },
        { content: regex },
        { meta_title: regex },
        { meta_description: regex },
      ];
    }

    const [pages, total] = await Promise.all([
      Page.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Page.countDocuments(query),
    ]);

    res.status(200).json({
      message: 'Pages retrieved successfully',
      data: {
        pages,
        total,
        totalPages: Math.ceil(total / limit),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error in fetchPages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getPageBySlug = async (req, res) => {
  const { slug } = req.params;

  try {
    const page = await Page.findOne({ slug, status: true }).lean();
    if (!page) return res.status(404).json({ message: 'Page not found.' });

    return res.status(200).json({ message: 'Page retrieved successfully.', page });
  } catch (error) {
    console.error('Error in getPageBySlug:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createPage = async (req, res) => {
  const { title, slug, meta_title, meta_description, status, created_by } = req.body;
  let content = req.body.content;

  try {
    if (!title || !slug || !created_by) {
      return res.status(400).json({ message: 'Title, slug, and created_by are required' });
    }

    const existingPage = await Page.findOne({ slug: slug.trim().toLowerCase() });
    if (existingPage) return res.status(409).json({ message: 'Page with this slug already exists' });

    const statusValue = status !== undefined ? Boolean(status) : true;

    content = sanitizeHtml(content || '', {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
      allowedAttributes: {'*': ['style', 'class'], a: ['href', 'target'], img: ['src', 'alt']},
    });

    const newPage = await Page.create({
      title: title.trim(),
      slug: slug.trim().toLowerCase(),
      content: content.trim() || null,
      meta_title: meta_title?.trim() || null,
      meta_description: meta_description?.trim() || null,
      status: statusValue,
      created_by,
    });

    return res.status(201).json({ message: 'Page created successfully.', page: newPage });
  } catch (error) {
    console.error('Error in createPage:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePage = async (req, res) => {
  const { id } = req.params;
  const { title, slug, meta_title, meta_description, status } = req.body;
  let content = req.body.content;

  try {
    const page = await Page.findById(id);
    if (!page) return res.status(404).json({ message: 'Page not found.' });

    if (!title || !slug) return res.status(400).json({ message: 'Title and slug are required.' });

    const existingPage = await Page.findOne({ slug: slug.trim().toLowerCase(), _id: { $ne: id }});
    if (existingPage) return res.status(400).json({ message: 'Page with this slug already exists.' });

    content = sanitizeHtml(content || page.content, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
      allowedAttributes: {'*': ['style', 'class'], a: ['href', 'target'], img: ['src', 'alt']},
    });

    await Page.updateOne(
      { _id: id },
      {
        $set: {
          title: title.trim(),
          slug: slug.trim().toLowerCase(),
          content: content.trim(),
          meta_title: meta_title?.trim() || page.meta_title,
          meta_description: meta_description?.trim() || page.meta_description,
          status: status !== undefined ? Boolean(status) : page.status,
        },
      }
    );

    const updatedPage = await Page.findById(id).lean();
    return res.status(200).json({ message: 'Page updated successfully.', page: updatedPage });
  } catch (error) {
    console.error('Error in updatePage:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updatePageStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const page = await Page.findById(id);
    if (!page) return res.status(404).json({ message: 'Page not found.' });

    await Page.updateOne({ _id: id }, { status: Boolean(status) });

    const updatedPage = await Page.findById(id).lean();
    return res.status(200).json({ message: 'Page status updated successfully.', page: updatedPage });
  } catch (error) {
    console.error('Error in updatePageStatus:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deletePage = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No page IDs provided or invalid format' });
    }

    const result = await Page.deleteMany({ _id: { $in: ids } });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No pages found for the provided IDs' });
    }

    return res.status(200).json({
      message: `Successfully deleted ${result.deletedCount} page(s)`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error in deletePage:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};