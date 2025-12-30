const { db } = require('../models');
const Language = db.Language;
const Setting = db.Setting;
const fs = require('fs');
const mongoose = require('mongoose');

exports.fetchLanguages = async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const match = {};
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: 'i' } },
        { locale: { $regex: search, $options: 'i' } },
      ];
    }

    const settings = await Setting.findOne().select('default_language').lean();
    const defaultLanguage = settings?.default_language;

    const [total, languages] = await Promise.all([
      Language.countDocuments(match),
      Language.find(match).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean({ virtuals: true }),
    ]);

    const formattedLanguages = languages.map(lang => ({
      id: lang._id,
      name: lang.name,
      locale: lang.locale,
      is_active: lang.is_active,
      translation_json: lang.translation_json,
      flag: lang.flag,
      created_at: lang.created_at,
      updated_at: lang.updated_at,
      is_default: lang.locale === defaultLanguage,
    }));

    return res.status(200).json({
      message: 'Languages retrieved successfully',
      data: {
        pages: formattedLanguages,
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error in fetchLanguages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.fetchActiveLanguages = async (req, res) => {
  const { search, page = 1, limit = 10 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  try {
    const match = { is_active: true };
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: 'i' } },
        { locale: { $regex: search, $options: 'i' } },
      ];
    }

    const settings = await Setting.findOne().select('default_language').lean();
    const defaultLanguage = settings?.default_language;

    const [total, languages] = await Promise.all([
      Language.countDocuments(match),
      Language.find(match).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean({ virtuals: true }),
    ]);

    const formattedLanguages = languages.map(lang => ({
      id: lang._id,
      name: lang.name,
      locale: lang.locale,
      is_active: lang.is_active,
      translation_json: lang.translation_json,
      flag: lang.flag,
      created_at: lang.created_at,
      updated_at: lang.updated_at,
      is_default: lang.locale === defaultLanguage,
    }));

    return res.status(200).json({
      message: 'Languages retrieved successfully',
      data: {
        pages: formattedLanguages,
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error('Error in fetchActiveLanguages:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.createLanguage = async (req, res) => {
  const { locale, name, isActive } = req.body;

  try {
    if (!locale || !name) {
      return res.status(400).json({ message: 'name and locale are required' });
    }

    const exists = await Language.findOne({ locale: locale.trim().toLowerCase() });
    if (exists) {
      return res.status(400).json({ message: 'Language already exists' });
    }

    let translationJson = null;
    let metadata = {};
    let flagPath = null;

    if (req.files?.translation?.[0]) {
      const file = req.files.translation[0];
      const fileContent = fs.readFileSync(file.path, 'utf8');

      try {
        translationJson = JSON.parse(fileContent);
      } catch {
        return res.status(400).json({ message: 'Invalid JSON file for translations' });
      }

      metadata.fileName = file.originalname;
    }

    if (req.files?.flag?.[0]) {
      flagPath = req.files.flag[0].path;
    }

    const language = await Language.create({
      name: name.trim(),
      locale: locale.trim().toLowerCase(),
      is_active: isActive ?? true,
      translation_json: translationJson,
      flag: flagPath,
      metadata,
    });

    return res.status(201).json({
      message: 'Language created successfully.',
      language,
    });
  } catch (error) {
    console.error('Error in createLanguage', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateLanguage = async (req, res) => {
  const { id } = req.params;
  const { name, locale, is_active, remove_flag = false } = req.body;

  try {
    const language = await Language.findById(id);
    if (!language) return res.status(404).json({ message: 'Language not found' });

    const settings = await Setting.findOne().select('default_language').lean();
    if (language.locale === settings?.default_language && is_active === false) {
      return res.status(400).json({
        message: 'Default language cannot be disabled. Please change the default language first.',
      });
    }

    if (locale && locale !== language.locale) {
      const exists = await Language.findOne({locale: locale.trim().toLowerCase(),_id: { $ne: id },});
      if (exists) {
        return res.status(400).json({ message: `Language with locale ${locale} already exists` });
      }
    }

    let translationJson = language.translation_json;
    let metadata = language.metadata || {};
    let flagPath = language.flag;

    if (req.files?.translation?.[0]) {
      const file = req.files.translation[0];
      const fileContent = fs.readFileSync(file.path, 'utf8');

      try {
        translationJson = JSON.parse(fileContent);
      } catch {
        return res.status(400).json({ message: 'Invalid JSON file for translations' });
      }

      metadata.fileName = file.originalname;
    }

    if (remove_flag === true || remove_flag === 'true') {
      if (flagPath && fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
      }
      flagPath = null;
    }

    if (req.files?.flag?.[0]) {
      if (flagPath && fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
      }
      flagPath = req.files.flag[0].path;
    }

    await Language.updateOne(
      { _id: id },
      {
        $set: {
          name: name ? name.trim() : language.name,
          locale: locale ? locale.trim().toLowerCase() : language.locale,
          is_active: is_active !== undefined ? is_active : language.is_active,
          translation_json: translationJson,
          flag: flagPath,
          metadata,
        },
      }
    );

    const updatedLanguage = await Language.findById(id).lean({ virtuals: true });

    return res.status(200).json({ message: 'Language updated', language: updatedLanguage });
  } catch (error) {
    console.error('Error in updateLanguage', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateLanguageStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const language = await Language.findById(id);
    if (!language) return res.status(404).json({ message: 'Language not found.' });

    const settings = await Setting.findOne().select('default_language').lean();
    if (language.locale === settings?.default_language && status === false) {
      return res.status(400).json({
        message: 'Default language cannot be disabled. Please change the default language first.',
      });
    }

    await Language.updateOne({ _id: id }, { is_active: status });

    const updatedLanguage = await Language.findById(id);
    return res.status(200).json({
      message: 'Language status updated successfully.',
      language: updatedLanguage,
    });
  } catch (error) {
    console.error('Error in updateLanguageStatus', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteLanguages = async (req, res) => {
  const { ids } = req.body;

  try {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No language IDs provided or invalid format' });
    }

    const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
    const languages = await Language.find({ _id: { $in: objectIds } }).lean({ virtuals: true });

    if (languages.length === 0) {
      return res.status(404).json({ message: 'No languages found for the provided IDs' });
    }

    for (const lang of languages) {
      if (lang.flag && fs.existsSync(lang.flag)) {
        fs.unlinkSync(lang.flag);
      }
    }

    await Language.deleteMany({ _id: { $in: objectIds } });

    return res.status(200).json({
      message: `Successfully deleted ${languages.length} language(s)`,
    });
  } catch (error) {
    console.error('Error in deleteLanguages', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getTranslationFile = async (req, res) => {
  const { locale } = req.params;

  try {
    const language = await Language.findOne({ locale });
    if (!language || !language.translation_json) {
      return res.status(404).json({ message: 'Translation file not found' });
    }

    return res.status(200).json({ translation: language });
  } catch (error) {
    console.error('Error in getTranslationFile:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};