'use strict';

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const checkStatusVideoDuration = (req, res, next) => {
  if (!req.file) return next();

  const file = req.file;
  const isVideo = file.mimetype.startsWith('video/');
  const MAX_DURATION_SECONDS = 30;
  const TOLERANCE = 0.9;

  if (!isVideo) return next();

  ffmpeg.ffprobe(file.path, (err, metadata) => {
    if (err) {
      console.error('Error reading video metadata');
      fs.unlinkSync(file.path);
      return res.status(400).json({ message: 'Invalid video file.' });
    }

    const duration = metadata.format.duration;

    if (duration > MAX_DURATION_SECONDS + TOLERANCE) {
      fs.unlinkSync(file.path);
      return res.status(400).json({ message: 'Video is too long. Upload a video shorter than 30 seconds.' });
    }

    next();
  });
};

module.exports = checkStatusVideoDuration;