'use strict';

require('dotenv').config();
const http = require('http');
const app = require('./app');
const { connectDB } = require('./models');
const PORT = process.env.PORT || 3000;

const createDefaultAdmin = require('./utils/createDefaultAdmin');
// Cron jobs
// const scheduler = require('./cron/backupScheduler');
// const statusExpiryScheduler = require('./cron/deleteExpiredStatus');
// const expiredMuteChat = require('./cron/expiredMuteChat');
// const { deleteClearedMessages } = require('./cron/deleteClearMessage');
// const deleteExpiredOtp = require('./cron/deleteExpiredOtps');
// const deleteExpiredMessage = require('./cron/deleteExpiredMessage');
// const expiredPinnedMessages = require('./cron/expiredPinnedMessage');

const server = http.createServer(app);
const { Server } = require('socket.io');

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Socket.io CORS blocked: ' + origin));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

connectDB()
  .then(async () => {
    console.log('DB connected');

    await createDefaultAdmin();

    // scheduler.start();
    // statusExpiryScheduler.start();
    // expiredMuteChat(io);
    // expiredPinnedMessages(io);
    // deleteClearedMessages();
    // deleteExpiredOtp.start();
    // deleteExpiredMessage.start(io);

    app.set('io', io);

    // require('./socket')(io);

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Error starting server:', err);
  });