const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { validationResult, body } = require('express-validator');
const { ensureInstallAssets, publicPath, basePath } = require('../lib/paths.js');
const { strPrp, strAlPbFls, strFlExs, strFilRM, liSync, migSync, datSync, strSync, scDotPkS, scSpatPkS, imIMgDuy, getC, conF, chWr, iDconF } = require('../lib/helpers.js');
const { validateLicenseBody, validateLicenseWithAdminBody, validateDbBody, getAdminValidators } = require('../validators/index.js');
const { configureDb, connectDb, runMigrations, writeEnv, reloadAndReconnect } = require('../lib/db.js');
const { exec } = require('child_process');

async function getRequirements(req, res) {
  await ensureInstallAssets();
  const c = getC();
  const configurations = { ...c.version, ...c.extensions };
  const configured = conF();
  res.render('strq', { title: 'Requirements', configurations, configured });
}

async function getDirectories(req, res) { return res.redirect('requirements'); }

async function getVerifySetup(req, res) { res.render('stvi', { title: 'Verify' }); }

async function getLicense(req, res) {
  if (!(await getConfigured())) return res.redirect('requirements');

  // Check if license files exist and are valid
  const licPath = publicPath('_log.dic.xml');
  const hasValidLicense = await fs.pathExists(licPath);

  if (hasValidLicense && await liSync()) {
    return res.redirect('database');
  }

  // Clear previous residual license files if they exist but are invalid
  if (hasValidLicense) {
    for (const f of strAlPbFls()) { try { await fs.remove(f); } catch(e) {} }
  }

  res.render('stlic', { title: 'License' });
}

const postLicense = [
  ...validateLicenseBody,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { req.session._errors = mapErrors(errors, true); req.session._old = req.body; return res.redirect('license'); }
    const { license, envato_username } = req.body;

    // Check if we're in development/localhost mode
    const isLocalhost = req.get('host').includes('localhost') || req.get('host').includes('127.0.0.1');
    let verificationSuccess = false;
    if (isLocalhost) {
      verificationSuccess = true;
    } else {
      const resp = await axios.post('https://laravel.pixelstrap.net/verify/api/envato', {
        key: String(license).trim(), envato_username, domain: req.protocol + '://' + req.get('host'), project_id: process.env.APP_ID, server_ip: req.ip
      }).catch(e => e.response);
      verificationSuccess = resp && resp.status === 200;
    }

    if (verificationSuccess) {
      // Create license files
      const pubDir = path.join(basePath(), 'public');
      await fs.ensureDir(pubDir);
      const fzipPath = publicPath('fzip.li.dic');
      await fs.writeFile(fzipPath, Buffer.from(String(license).trim()).toString('base64'));
      const logPath = publicPath('_log.dic.xml');
      const currentUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
      const cleaned = currentUrl.replace('block/license/verify', '').replace('install/license', '').replace('install/verify', '');
      if (!(await fs.pathExists(logPath))) {
        await fs.writeFile(logPath, Buffer.from(cleaned).toString('base64'));
      }
      const ipPath = publicPath('cj7kl89.tmp');
      const serverIp = req.socket?.localAddress || req.ip || '';
      await fs.writeFile(ipPath, Buffer.from(serverIp).toString('base64'));
      req.session.licenseVerified = true;
      return res.redirect('database');
    }

    req.session._errors = { license: 'Verification failed' };
    return res.redirect('license');
  }
];

async function getDatabase(req, res) {
  if (!(await getConfigured())) return res.redirect('requirements');
  if (!(await getDirsConfigured())) return res.redirect('directories');

  if (!(await liSync())) {
    return res.redirect('license');
  }

  if (await datSync()) {
    if (!(await migSync())) await fs.writeFile(publicPath('_migZip.xml'), '');
    return res.redirect('completed');
  }
  res.render('stbat', { title: 'Database' });
}

const postDatabaseConfig = [
  // Main handler with combined validation
  async (req, res) => {
    // Validate database data
    const dbValidators = validateDbBody;
    for (const validator of dbValidators) {
      await validator.run(req);
    }
    
    // Check database validation errors
    let allErrors = {};
    const dbErrors = validationResult(req);
    if (!dbErrors.isEmpty()) {
      allErrors = { ...allErrors, ...mapErrors(dbErrors, false) };
    }
    
    // Then validate admin data if it exists
    if (req.body.admin) {
      const adminValidators = getAdminValidators();
      for (const validator of adminValidators) {
        await validator.run(req);
      }
      
      const adminErrors = validationResult(req);
      if (!adminErrors.isEmpty()) {
        const adminErrorMap = mapErrors(adminErrors, false);
        allErrors = { ...allErrors, ...adminErrorMap };
      }
    }
    
    // If there are any errors, redirect back
    if (Object.keys(allErrors).length > 0) {
      req.session._errors = allErrors;
      req.session._old = req.body;
      return res.redirect('database');
    }

    const { database, admin } = req.body;

    try {
      // Save environment variables first
      if (process.env.DOTENV_EDIT === 'true') {
        await writeEnv(database, admin);
      }
      
      // Configure database and run migrations
      await configureDb(database);
      await connectDb();
      await runMigrations();
      
      // After writing the .env file and configuring the database,
      // reload the environment variables and reconnect to ensure
      // the application picks up the new configuration without restart
      const reconnectResult = await reloadAndReconnect();
      if (!reconnectResult.success) {
        console.error('Failed to reconnect to database after configuration:', reconnectResult.error);
        req.session._errors = { 'database.DB_HOST': 'Failed to reconnect to database after configuration' };
        req.session._old = req.body;
        return res.redirect('database');
      }
    } catch (e) {
      const dbFieldErrors = mapDbConnectionError(e);
      req.session._errors = dbFieldErrors;
      req.session._old = req.body;
      return res.redirect('database');
    }

    await fs.writeFile(publicPath('_migZip.xml'), '');
    return res.redirect('completed');
  }
];

async function getCompleted(req, res) {
  if (!(await migSync())) return res.redirect('database');
  const instFile = publicPath('installation.json');
  if (!(await fs.pathExists(instFile))) await fs.writeFile(instFile, '');

  await new Promise(resolve => setTimeout(resolve, 5000));

  const { connectDB } = require('./../../../models');

  if (process.env.MONGODB_URI) {
    try {
      console.log('🔄 Connecting to database...');
      const db = await connectDB();
      console.log('✅ Connection established');

      console.log('⏳ Syncing models. Please wait...');
      console.time('⏳ Sync duration');
      // In MongoDB, models are registered when connecting
      console.timeEnd('⏳ Sync duration');
      console.log('✅ All models synced successfully');

      // Optional delay to let the DB settle
      console.log('⌛ Waiting briefly to ensure all collections are ready...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('✅ Wait complete. Proceeding to seeders');

      return res.redirect('run-seeder');

    } catch (error) {
      console.warn('❌ Database setup failed:', error.message);
      console.warn('⚠️ Running with default settings - you can configure database via /install');
    }
  } else {
    console.warn('⚠️ No database configuration - please visit /install to set up');
  }

  res.render('co', { title: 'Installation Completed' });
}

async function runSeeder(req, res) {

  if (!(await migSync())) return res.redirect('database');
  const instFile = publicPath('installation.json');
  if (!(await fs.pathExists(instFile))) await fs.writeFile(instFile, '');

  if (process.env.MONGODB_URI) {
    // Execute npm run seed command
    const { exec } = require('child_process');
    
    exec('npm run seed', (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Error running seeders:', error);
        return res.status(500).send('Error running seeders');
      }
      
      console.log('✅ Seeders executed successfully');
      console.log('Output:', stdout);
      if (stderr) {
        console.warn('Warnings:', stderr);
      }
      
      return res.redirect('/');
    });
  }
}

async function getBlockSetup(req, res) { res.render('stbl', { title: 'Verify' }); }

const postUnblockVerify = postLicense;

async function getErase(req, res) {
  if (req.params.project_id !== process.env.APP_ID) return res.status(400).json({ error: 'Invalid Project ID' });
  await fs.remove(path.join(basePath(), '.vite.js'));
  for (const file of strAlPbFls()) await fs.remove(file).catch(() => {});
  return res.json({ success: true });
}

async function getUnblock(req, res) {
  // pHUnBlic(): remove block flag
  await fs.remove(path.join(basePath(), '.vite.js'));
  return res.json({ success: true });
}

async function postResetLicense(req, res) {
  try {
    // Clear all license files like PHP version does
    for (const f of strAlPbFls()) {
      try {
        await fs.remove(f);
      } catch(e) {
        console.log('Error removing file:', f, e.message);
      }
    }

    // Also try to reset via API if license file exists
    const fp = path.join(basePath(), 'fzip.li.dic');
    if (await fs.pathExists(fp)) {
      const key = await fs.readFile(fp, 'utf8');
      const rp = await axios.post('https://laravel.pixelstrap.net/verify/api/reset/license', { key }).catch(e => e.response);
      return res.status(rp?.status || 200).json({
        success: true,
        message: 'License reset successfully',
        ...rp?.data
      });
    }

    return res.status(200).json({
      success: true,
      message: 'License files cleared successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getBlockProject(req, res) {
  if (req.params.project_id !== process.env.APP_ID) return res.status(400).json({ error: 'Invalid Project ID' });
  const vite = path.join(basePath(), '.vite.js');
  if (!(await fs.pathExists(vite))) await fs.writeFile(vite, '');
  for (const f of strAlPbFls()) { try { await fs.remove(f); } catch(e) {} }
  return res.json({ success: true });
}

function mapErrors(result, firstOnly = false) {
  const out = {};
  const arr = firstOnly ? result.array({ onlyFirstError: true }) : result.array();
  for (const e of arr) out[e.path] = e.msg;
  return out;
}

function mapDbConnectionError(err) {
  const out = {};
  const code = err?.code || '';
  const message = (err?.message || '').toString();
  
  // MongoDB specific error patterns
  if (message.match(/ECONNREFUSED|failed to connect|connection/)) {
    out['database.DB_HOST'] = 'Failed to connect to database';
    out['database.DB_PORT'] = 'Check host and port';
    return out;
  }
  
  if (message.match(/Authentication failed|auth|authenticate|EAUTH/i)) {
    out['database.DB_USERNAME'] = 'Authentication failed: invalid username or password';
    out['database.DB_PASSWORD'] = 'Authentication failed: invalid username or password';
    return out;
  }
  
  if (message.match(/getaddrinfo ENOTFOUND|ENOTFOUND|EAI_AGAIN|ENODATA/i)) {
    out['database.DB_HOST'] = 'Unable to resolve host - check your hostname';
    return out;
  }
  
  if (message.match(/wrong password|incorrect password|Authentication failed/i)) {
    out['database.DB_PASSWORD'] = 'Incorrect password';
    return out;
  }
  
  if (message.match(/invalid username|user not found|Authentication failed/i)) {
    out['database.DB_USERNAME'] = 'Invalid username';
    return out;
  }
  
  // Default generic mapping
  out['database.DB_HOST'] = message || 'Database connection error';
  return out;
}

async function getConfigured() { return true; }
async function getDirsConfigured() { return true; }

module.exports = {
  getRequirements,
  getDirectories,
  getVerifySetup,
  getLicense,
  postLicense,
  getDatabase,
  postDatabaseConfig,
  getCompleted,
  runSeeder,
  getBlockSetup,
  postUnblockVerify,
  getErase,
  getUnblock,
  postResetLicense,
  getBlockProject
};
