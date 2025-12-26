const { Op } = require('sequelize');
const { Language } = require('../models');

exports.fetchLanguages = async (req,res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  const whereClause = { };

  try {
    if (search) {
      whereClause[Op.or] = [{ name: { [Op.like]: `%${search}%` } }, { locale: { [Op.like]: `%${search}%` } }];
    }
    const total = await Language.count({ where: whereClause });

    const pages = await Language.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(201).json({
      message: 'Languages retrieved successfully',
      data: {
        pages: pages,
        total: total,
        totalPages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error in fetchLanguages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createLanguage = async (req,res) => {
  const { locale, name, isActive } = req.body

  try {
    if (!locale || !name) {
      return res.status(400).json({ message: 'name, and locale are required' });
    }

    const exists = await Language.findOne({ where: { locale } });
    if (exists) {
      return res.status(400).json({ message: 'Language already exists' });
    }
    let translationJson;
    if (req.file) {
      const fileContent = require('fs').readFileSync(req.file.path, 'utf8');
      try {
        translationJson = JSON.parse(fileContent);
      } catch (e) {
        return res.status(400).json({ message: 'Invalid JSON file for translations' });
      }
      require('fs').unlinkSync(req.file.path);
    }

    const language = await Language.create({
      name: name.trim(),
      locale: locale.trim().toLowerCase(),
      is_active: isActive,
      translation_json: translationJson,
    });

    return res.status(201).json({ message: 'Language created successfully.', language });

  } catch (error) {
    console.error('Error in createLanguage', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateLanguage = async (req, res) => {
  const { id } = req.params;
  const { name, locale, is_active } = req.body;
  
  try {
    const language = await Language.findByPk(id);
    if (!language) {
      return res.status(404).json({ message: 'Language not found' });
    }

    if (locale && locale !== language.locale) {
      const existingLocale = await Language.findOne({ where: { locale, id: { [Op.ne]: id }} });
  
      if (existingLocale) {
        return res.status(400).json({ message: `Language with locale ${locale} already exists`});
      }
    }

    if (req.file) {
      const fileContent = require('fs').readFileSync(req.file.path, 'utf8');
      try {
        newTranslationJson = JSON.parse(fileContent);
      } catch (e) {
        return res.status(400).json({ message: 'Invalid JSON file for translations' });
      }
      require('fs').unlinkSync(req.file.path);
    } else if (translation_json) {
      try {
        newTranslationJson = typeof translation_json === 'string' ? JSON.parse(translation_json) : translation_json;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid translation JSON' });
      }
    }

    await language.update({ name, locale, is_active, translation_json: newTranslationJson ?? language.translation_json });

    res.status(200).json({ message: 'Language updated', language });
  } catch (error) {
    console.error('Error in updateLanguage', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
  
exports.updateLanguageStatus = async (req,res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const language = await Language.findByPk(id);
    if(!language) return res.status(404).json({ message: 'Language not found.'});

    await language.update({is_active: status});

    return res.status(200).json({ message: 'Language status updated successfully.', language});
  } catch (error) {
    console.error('Error in updateLanguageStatus', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteLanguages = async (req,res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No language IDs provided or invalid format' });
    }

    const languages = await Language.findAll({ where: { id: ids, }});
    if (languages.length === 0) {
      return res.status(404).json({ message: 'No languages found for the provided IDs' });
    }

    await Language.destroy({ where: { id: ids } });
    return res.status(200).json({ message: `Successfully deleted ${languages.length} language(s)`});

  } catch (error) {
    console.error('Error in deleteLanguages', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getTranslationFile = async (req, res) => {
  const { locale } = req.params;

  try {
    const language = await Language.findOne({ where: { locale } });
    if (!language || !language.translation_json) {
      return res.status(404).json({ message: 'Translation file not found' });
    }

    res.status(200).json({translation : language});
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};