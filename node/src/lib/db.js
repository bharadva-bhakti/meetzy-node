const { Sequelize, DataTypes } = require('sequelize');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs-extra');

let sequelize = null;
let User = null;

async function configureDb(cfg) {
  await ensureDatabase(cfg);
  sequelize = new Sequelize(cfg.DB_DATABASE, cfg.DB_USERNAME, cfg.DB_PASSWORD, {
    host: cfg.DB_HOST,
    port: Number(cfg.DB_PORT || 3306),
    dialect: 'mysql',
    logging: false
  });

}

async function connectDb() {
  if (!sequelize) throw new Error('DB not configured');
  await sequelize.authenticate();
}

async function runMigrations() {
  if (!sequelize) throw new Error('DB not configured');
  await sequelize.sync();
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
      DB_USERNAME: cfg.DB_USERNAME,
      DB_PASSWORD: cfg.DB_PASSWORD,
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
    const lines = [
      `DB_HOST=${cfg.DB_HOST}`,
      `DB_PORT=${cfg.DB_PORT}`,
      `DB_DATABASE=${cfg.DB_DATABASE}`,
      `DB_USERNAME=${cfg.DB_USERNAME}`,
      `DB_PASSWORD=${cfg.DB_PASSWORD}`,
      `ADMIN_NAME=${admin.first_name.trim()} ${admin.last_name.trim()}`,
      `ADMIN_EMAIL=${admin.email}`,
      `ADMIN_PASSWORD=${admin.password}`
    ];
    await fs.appendFile('.env', '\n' + lines.join('\n') + '\n');
  }
}

async function ensureDatabase(cfg) {
  const connection = await mysql.createConnection({
    host: cfg.DB_HOST,
    port: Number(cfg.DB_PORT || 3306),
    user: cfg.DB_USERNAME,
    password: cfg.DB_PASSWORD
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.DB_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;`);
  } finally {
    await connection.end();
  }
}

module.exports = {
  configureDb,
  connectDb,
  runMigrations,
  writeEnv
};

