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
    let db = null;
    try {
      const models = require("./models");
      // Attempt to connect to MongoDB if URI is available
      if (process.env.MONGODB_URI) {
        db = await models.connectDB();
      }
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
    if (db) {
      try {
        // MongoDB connection is already established via connectDB()
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
      if (!db) {
        console.log(`📋 Please visit http://localhost:${PORT}/install to complete setup`);
      }
    });
  } catch (err) {
    console.error("❌ Startup error:", err);
    process.exit(1);
  }
})();