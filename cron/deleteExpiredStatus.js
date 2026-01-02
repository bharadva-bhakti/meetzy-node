const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { db } = require('../models');
const Status = db.Status;

function start() {
  cron.schedule('0 * * * *', async () => {
    const now = new Date();

    try {
      const expired = await Status.find({
        expires_at: { $lte: now },
        sponsored: false
      }).lean();

      for (const s of expired) {
        if (s.file_url) {
          const filePath = path.join(__dirname, '../', s.file_url);
          fs.unlink(filePath, err => {
            if (err && err.code !== 'ENOENT') console.error(err);
          });
        }

        await Status.deleteOne({ _id: s._id });
      }

      console.log(`Deleted ${expired.length} expired statuses.`);
    } catch (error) {
      console.error('Error deleting expired statuses:', error);
    }
  });
}

module.exports = { start };