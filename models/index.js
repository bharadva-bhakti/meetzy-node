// models/index.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

const env = process.env.NODE_ENV || 'development';
const mongoUri = config[env].mongoUri;

const basename = path.basename(__filename);
const db = {};

fs.readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file));
    const modelName = path.basename(file, '.js').replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
      .replace(/^\w/, c => c.toUpperCase());
    db[model.modelName] = model;
  });

db.mongoose = mongoose;

const connectDB = async () => {
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');

    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

module.exports = { db, connectDB, mongoose };