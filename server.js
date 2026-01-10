"use strict";

require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    // Load app FIRST (it handles DB connection gracefully)
    const app = await require("./app");

    // Try to load models, but don't fail if not available
    let sequelize = null;
    try {
      const models = require("./models");
      sequelize = models.sequelize;
    } catch (error) {
      console.warn("⚠️ Models not loaded - will be available after installation");
    }

    // Create HTTP server
    const server = http.createServer(app);

    // Setup Socket.IO
    const io = new Server(server, {
      cors: {
        origin: (origin, callback) => {
          // Read the allowed origins from the environment variable
          const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

          if (!origin) return callback(null, true);

          if (allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error("Socket.io CORS blocked: " + origin));
          }
        },
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    app.set("io", io);

    // Only setup socket handlers and cron if database is connected
    if (sequelize) {
      try {
        await sequelize.authenticate();
        console.log("✅ DB connected");

        // Initialize socket handlers
        require("./socket")(io);

        const scheduler = require('./cron/backupScheduler');
        const statusExpiryScheduler = require('./cron/deleteExpiredStatus');
        const expiredMuteChat = require('./cron/expiredMuteChat');
        const deleteClearedMessages = require('./cron/deleteClearMessage');
        const deleteExpiredOtp = require('./cron/deleteExpiredOtps');
        const deleteExpiredMessage = require('./cron/deleteExpiredMessage');
        const expiredPinnedMessages = require('./cron/expiredPinnedMessage');


        scheduler.start();
        statusExpiryScheduler.start();
        expiredMuteChat(io);
        deleteClearedMessages();
        deleteExpiredOtp.start();
        deleteExpiredOtp.start();
        deleteExpiredMessage.start(io);

        console.log("✅ Cron jobs started");
      } catch (err) {
        console.warn("⚠️ Running without database features - visit /install to configure");
      }
    } else {
      console.warn("⚠️ Database not configured - visit /install to set up");
    }

    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
      if (!sequelize) {
        console.log(`📋 Please visit http://localhost:${PORT}/install to complete setup`);
      }
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
})();

// 'use strict';

// require('dotenv').config();
// const http = require('http');
// const app = require('./app');
// const { connectDB } = require('./models');
// const PORT = process.env.PORT || 3000;

// const createDefaultAdmin = require('./utils/createDefaultAdmin');
// // Cron jobs
// const scheduler = require('./cron/backupScheduler');
// const statusExpiryScheduler = require('./cron/deleteExpiredStatus');
// const expiredMuteChat = require('./cron/expiredMuteChat');
// const { deleteClearedMessages } = require('./cron/deleteClearMessage');
// const deleteExpiredOtp = require('./cron/deleteExpiredOtps');
// const deleteExpiredMessage = require('./cron/deleteExpiredMessage');
// const expiredPinnedMessages = require('./cron/expiredPinnedMessage');

// const server = http.createServer(app);
// const { Server } = require('socket.io');

// const io = new Server(server, {
//   cors: {
//     origin: (origin, callback) => {
//       const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
//       if (!origin || allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error('Socket.io CORS blocked: ' + origin));
//       }
//     },
//     methods: ['GET', 'POST'],
//     credentials: true,
//   },
// });

// connectDB().then(async () => {
//   console.log('DB connected');

//   await createDefaultAdmin();

//   scheduler.start();
//   statusExpiryScheduler.start();
//   expiredMuteChat(io);
//   expiredPinnedMessages(io);
//   deleteClearedMessages();
//   deleteExpiredOtp.start();
//   deleteExpiredMessage.start(io);

//   app.set('io', io);

//   require('./socket')(io);

//   server.listen(PORT, () => {
//     console.log(`Server running at http://localhost:${PORT}`);
//   });
// })
// .catch((err) => {
//   console.error('Error starting server:', err);
// });