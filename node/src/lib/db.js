const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs-extra');

let dbConnection = null;
let User = null;

async function configureDb(cfg) {
  // Construct MongoDB URI
  const dbPort = cfg.DB_PORT || 27017;
  let mongoUri;
  
  // Build connection string based on whether credentials are provided
  if (cfg.DB_USERNAME && cfg.DB_PASSWORD) {
    // Include authentication credentials
    const authString = `${encodeURIComponent(cfg.DB_USERNAME)}:${encodeURIComponent(cfg.DB_PASSWORD)}@`;
    mongoUri = `mongodb://${authString}${cfg.DB_HOST}:${dbPort}/${cfg.DB_DATABASE}`;
  } else {
    // No authentication needed
    mongoUri = `mongodb://${cfg.DB_HOST}:${dbPort}/${cfg.DB_DATABASE}`;
  }
  
  // Store the config for later use
  process.env.MONGODB_URI = mongoUri;
  
  // Connect to MongoDB
  dbConnection = await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
}

async function connectDb() {
  if (!dbConnection) throw new Error('DB not configured');
  // In Mongoose, connection happens in configureDb, so we check connection state
  // Wait a bit for the connection to establish
  await new Promise(resolve => setTimeout(resolve, 500));
  
  if (dbConnection.connection.readyState !== 1) {
    // Try to get more specific error information
    const error = dbConnection.connection.readyState === 0 
      ? 'Failed to connect to MongoDB' 
      : (dbConnection.connection.readyState === 3 
        ? 'MongoDB connection disconnected' 
        : 'MongoDB connection failed');
    throw new Error(error);
  }
}

async function runMigrations() {
  // In MongoDB, migrations are typically handled differently
  // For now, we'll just return to maintain compatibility
  // Actual model registration happens via mongoose
  return Promise.resolve();
}

async function writeEnv(cfg, admin) {
  try {
    // Read existing .env file
    let existingContent = '';
    if (await fs.pathExists('.env')) {
      existingContent = await fs.readFile('.env', 'utf8');
    }
    
    // Parse existing environment variables
    const existingVars = {};
    existingContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        existingVars[key.trim()] = valueParts.join('=').trim();
      }
    });
    
    // Merge with new database configuration
    const mergedVars = {
      ...existingVars,
      DB_HOST: cfg.DB_HOST,
      DB_PORT: cfg.DB_PORT,
      DB_DATABASE: cfg.DB_DATABASE,
      DB_USERNAME: cfg.DB_USERNAME || '', // Store even if empty
      DB_PASSWORD: cfg.DB_PASSWORD || '', // Store even if empty
      MONGODB_URI: cfg.DB_USERNAME && cfg.DB_PASSWORD 
        ? `mongodb://${encodeURIComponent(cfg.DB_USERNAME)}:${encodeURIComponent(cfg.DB_PASSWORD)}@${cfg.DB_HOST}:${cfg.DB_PORT || 27017}/${cfg.DB_DATABASE}`
        : `mongodb://${cfg.DB_HOST}:${cfg.DB_PORT || 27017}/${cfg.DB_DATABASE}`,
      ADMIN_NAME: `${admin.first_name} ${admin.last_name}`,
      ADMIN_EMAIL: admin.email,
      ADMIN_PASSWORD: admin.password
    };
    
    // Write merged configuration back to .env
    const newContent = Object.entries(mergedVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';
    
    await fs.writeFile('.env', newContent);
  } catch (error) {
    console.error('Error writing .env file:', error);
    // Fallback to append mode if merge fails
    const authString = cfg.DB_USERNAME && cfg.DB_PASSWORD 
      ? `${encodeURIComponent(cfg.DB_USERNAME)}:${encodeURIComponent(cfg.DB_PASSWORD)}@` 
      : '';
    const mongoUri = `mongodb://${authString}${cfg.DB_HOST}:${cfg.DB_PORT || 27017}/${cfg.DB_DATABASE}`;
    
    const lines = [
      `DB_HOST=${cfg.DB_HOST}`,
      `DB_PORT=${cfg.DB_PORT}`,
      `DB_DATABASE=${cfg.DB_DATABASE}`,
      `DB_USERNAME=${cfg.DB_USERNAME || ''}`,
      `DB_PASSWORD=${cfg.DB_PASSWORD || ''}`,
      `MONGODB_URI=${mongoUri}`,
      `ADMIN_NAME=${admin.first_name.trim()} ${admin.last_name.trim()}`,
      `ADMIN_EMAIL=${admin.email}`,
      `ADMIN_PASSWORD=${admin.password}`
    ];
    await fs.appendFile('.env', '\n' + lines.join('\n') + '\n');
  }
}

// MongoDB doesn't need explicit database creation like SQL databases
// The database will be created when first document is inserted
async function ensureDatabase(cfg) {
  // This function is kept for compatibility with the installation flow
  // MongoDB doesn't require explicit database creation
  return Promise.resolve();
}

module.exports = {
  configureDb,
  connectDb,
  runMigrations,
  writeEnv
};