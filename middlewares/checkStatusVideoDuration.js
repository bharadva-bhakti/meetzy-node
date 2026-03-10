'use strict';

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

process.env.FFMPEG_PATH = ffmpegInstaller.path;
process.env.FFPROBE_PATH = ffprobeInstaller.path;

const MAX_DURATION_SECONDS = 30;
const TOLERANCE = 0.9;

function checkVideoFile(file) {
  return new Promise((resolve, reject) => {
    const isVideo = file.mimetype.startsWith('video/');
    if (!isVideo) return resolve(null);

    ffmpeg.ffprobe(file.path, (err, metadata) => {
      if (err) {
        return reject({ file, message: 'Invalid or corrupted video file. Could not read metadata.' });
      }

      const duration = metadata.format?.duration;
      if (!duration || isNaN(duration)) {
        return reject({ file, message: 'Could not determine video duration. File may be invalid.' });
      }

      if (duration > MAX_DURATION_SECONDS + TOLERANCE) {
        return reject({
          file,
          message: `Video "${file.originalname}" is too long (${Math.floor(duration)}s). Maximum allowed: ${MAX_DURATION_SECONDS} seconds.`,
        });
      }

      resolve(null);
    });
  });
}

const checkStatusVideoDuration = async (req, res, next) => {
  const files = req.files?.length ? req.files : (req.file ? [req.file] : []);
  if (files.length === 0) return next();

  try {
    for (const file of files) {
      await checkVideoFile(file);
    }

    next();
  } catch ({ file, message }) {
    const allFiles = req.files?.length ? req.files : (req.file ? [req.file] : []);
    allFiles.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });

    return res.status(400).json({ message });
  }
};

module.exports = checkStatusVideoDuration;