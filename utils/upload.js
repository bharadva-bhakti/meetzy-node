'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../models');
const Setting = db.Setting;

const mimeToExtension = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',

  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/m4a': 'm4a',

  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/avi': 'avi',
  'video/mov': 'mov',
  'video/wmv': 'wmv',
  'video/mkv': 'mkv',

  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
};

const getTypePrefix = (mimetype) => {
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (
    mimetype === 'application/pdf' ||
    mimetype.includes('document') ||
    mimetype.includes('text') ||
    mimetype.includes('sheet') ||
    mimetype.includes('presentation')
  ) {
    return 'document';
  }
  return 'file';
};

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const baseUploadDir = './uploads/';
ensureDirExists(baseUploadDir);

let cachedSettings = null;
let cacheTimestamp = null;
const CACHE_DURATION = 60 * 1000;

async function getDynamicSettings() {
  if (cachedSettings && cacheTimestamp && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedSettings;
  }

  try {
    const setting = await Setting.findOne();

    const allowedTypes = setting?.allowed_file_upload_types || [];
    const limits = {
      document: (setting?.document_file_limit || 10) * 1024 * 1024,
      audio: (setting?.audio_file_limit || 10) * 1024 * 1024,
      video: (setting?.video_file_limit || 20) * 1024 * 1024,
      image: (setting?.image_file_limit || 10) * 1024 * 1024,
      file: 25 * 1024 * 1024,
      multiple: setting?.multiple_file_share_limit || 10,
    };

    cachedSettings = { allowedTypes, limits };
    cacheTimestamp = Date.now();
    return cachedSettings;
  } catch (err) {
    console.error('Error fetching upload settings:', err);
    return {
      allowedTypes: [],
      limits: {
        document: 10 * 1024 * 1024,
        audio: 10 * 1024 * 1024,
        video: 20 * 1024 * 1024,
        image: 10 * 1024 * 1024,
        file: 25 * 1024 * 1024,
        multiple: 10,
      },
    };
  }
}

function createUploader(subfolder = '') {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(baseUploadDir, subfolder);
      ensureDirExists(uploadPath);
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const ext = mimeToExtension[file.mimetype] || path.extname(file.originalname) || '.bin';
      const typePrefix = getTypePrefix(file.mimetype);
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 8);
      cb(null, `${typePrefix}-${timestamp}-${randomString}.${ext}`);
    },
  });

  return storage;
}

const asyncFileFilter = async (req, file, cb) => {
  const { allowedTypes } = await getDynamicSettings();
  const ext = (mimeToExtension[file.mimetype] || path.extname(file.originalname).slice(1)).toLowerCase();

  if (allowedTypes.length === 0 || allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${ext}' is not allowed.`), false);
  }
};

const fileFilter = (req, file, cb) => {
  asyncFileFilter(req, file, cb).catch((err) => {
    cb(err || new Error('File validation failed'), false);
  });
};

function uploader(subfolder = '') {
  const dynamicMulter = async (req, res, next) => {
    try {
      const { limits } = await getDynamicSettings();
      const maxGlobalSize = Math.max(...Object.values(limits));

      req._dynamicUploader = multer({
        storage: createUploader(subfolder),
        fileFilter,
        limits: { fileSize: maxGlobalSize, files: limits.multiple },
      });

      next();
    } catch (err) {
      console.error('Error loading upload settings:', err);
      return res.status(500).json({ error: 'Failed to load upload configuration' });
    }
  };

  const checkFileSizes = async (req, res, next) => {
    const { limits } = await getDynamicSettings();
    const files = [];

    if (req.file) files.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) {
        files.push(...req.files);
      } else if (typeof req.files === 'object') {
        Object.values(req.files).forEach((arr) => files.push(...arr));
      }
    }

    for (const file of files) {
      const type = getTypePrefix(file.mimetype);
      const maxSize = limits[type] || limits.file;

      if (file.size > maxSize) {
        fs.unlinkSync(file.path);
        const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
        const actualMB = (file.size / (1024 * 1024)).toFixed(1);
        return res.status(400).json({
          message: `${file.originalname} is too large (${actualMB} MB). Max: ${maxMB} MB for ${type}.`,
        });
      }
    }

    next();
  };

  const handleUpload = (uploadFn) => (req, res, next) => {
    uploadFn(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: 'File too large.' });
        }
      } else if (err) {
        return res.status(400).json({ message: err.message || 'Upload failed' });
      }
      checkFileSizes(req, res, next);
    });
  };

  return {
    single: (fieldName) => [
      dynamicMulter,
      (req, res, next) => handleUpload(req._dynamicUploader.single(fieldName))(req, res, next),
    ],
    array: (fieldName, maxCount) => [
      dynamicMulter,
      (req, res, next) => handleUpload(req._dynamicUploader.array(fieldName, maxCount))(req, res, next),
    ],
    fields: (fieldsArray) => [
      dynamicMulter,
      (req, res, next) => handleUpload(req._dynamicUploader.fields(fieldsArray))(req, res, next),
    ],
  };
}

const uploadFiles = (subfolder = '', fieldName = 'files') => {
  return async (req, res, next) => {
    const { limits } = await getDynamicSettings();
    const upload = multer({
      storage: createUploader(subfolder),
      fileFilter,
      limits: { fileSize: Math.max(...Object.values(limits)), files: limits.multiple },
    }).array(fieldName, limits.multiple);

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message });

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const type = getTypePrefix(file.mimetype);
          const maxSize = limits[type] || limits.file;
          if (file.size > maxSize) {
            fs.unlinkSync(file.path);
            return res.status(400).json({ message: `${file.originalname} exceeds size limit.` });
          }
        }
      }
      next();
    });
  };
};

const uploadSingle = (subfolder = '', fieldName = 'file', isStatus = false) => {
  return async (req, res, next) => {
    const { limits } = await getDynamicSettings();
    const MAX_STATUS_SIZE = 16 * 1024 * 1024;
    const maxSize = isStatus ? MAX_STATUS_SIZE : Math.max(...Object.values(limits));

    const upload = multer({
      storage: createUploader(subfolder),
      fileFilter,
      limits: { fileSize: maxSize, files: 1 },
    }).single(fieldName);

    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ message: err.message });

      if (req.file) {
        const file = req.file;
        const type = getTypePrefix(file.mimetype);
        const allowedSize = isStatus ? MAX_STATUS_SIZE : (limits[type] || limits.file);

        if (file.size > allowedSize) {
          fs.unlinkSync(file.path);
          return res.status(400).json({ message: `${file.originalname} is too large.` });
        }

        if (isStatus && !['image', 'video'].includes(type)) {
          fs.unlinkSync(file.path);
          return res.status(400).json({ message: 'Status only supports image and video.' });
        }
      }

      next();
    });
  };
};

module.exports = {
  mimeToExtension,
  uploadFiles,
  uploadSingle,
  uploader,
  getTypePrefix,
};