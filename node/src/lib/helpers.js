const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { basePath, publicPath } = require('./paths.js');
const { config: cfg } = require('./config.js');
const semver = require('semver');

function strPrp() {
  if (!process.env.APP_ID) throw new Error('Removed APP ID');
  return true;
}

function strAlPbFls() {
  return [
    publicPath('_log.dic.xml'),
    publicPath('fzip.li.dic'),
    publicPath('cj7kl89.tmp'),
    publicPath('_migZip.xml'),
    publicPath('installation.json')
  ];
}

async function strFilRM(filePath) { if (await fs.pathExists(filePath)) await fs.remove(filePath); }
async function strFlExs(filePath) { return fs.pathExists(filePath); }

async function liSync() {
  const licPath = publicPath('_log.dic.xml');
  if (!(await fs.pathExists(licPath))) return false;
  const jD = await fs.readFile(licPath, 'utf8');
  if (!jD) return false;
  
  // Check for localhost like PHP version does
  const currentUrl = process.env.APP_URL || '';
  
  // Decode the saved URL to check for localhost
  const savedUrl = Buffer.from(jD, 'base64').toString('utf8');
  
  if (currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1') || 
      savedUrl.includes('localhost') || savedUrl.includes('127.0.0.1')) {
    return true;
  }
  
  if (!/^(?:f|ht)tps?:\/\//i.test(currentUrl)) {
    // allow non-url values like localhost
  }
  const cHost = tryGetHost(currentUrl);
  const dHost = tryGetHost(Buffer.from(jD, 'base64').toString('utf8'));
  console.log('🌐 Current host:', cHost, 'Saved host:', dHost);
  const ipFile = publicPath('cj7kl89.tmp');
  if (cHost && dHost && (cHost === dHost || cHost === 'www.' + dHost || 'www.' + cHost === dHost)) {
    console.log('✅ Host match found, returning true');
    return true;
  }
  if (await fs.pathExists(ipFile)) {
    const jiP = await fs.readFile(ipFile, 'utf8');
    const savedIp = Buffer.from(jiP, 'base64').toString('utf8');
    const envIp = process.env.SERVER_ADDR || process.env.REMOTE_ADDR || '';
    if (savedIp && (envIp === savedIp)) return true;
  }
  return (cHost === 'localhost' || cHost === '127.0.0.1');
}

function tryGetHost(u) {
  try { return new URL(/^https?:\/\//.test(u) ? u : `http://${u}`).host; } catch { return null; }
}

async function strSync() {
  if (await liSync()) {
    if (await fs.pathExists(publicPath('installation.json'))) return true;
    return (await schSync());
  }
  return false;
}

async function schSync() { return false; }

async function datSync() { return false; }

async function migSync() { return fs.pathExists(publicPath('_migZip.xml')); }

function scDotPkS() { return process.env.DOTENV_EDIT === 'true'; }
function scSpatPkS() { return process.env.SPATIE_ENABLED === 'true'; }

async function imIMgDuy() { return true; }

function getC() {
  const results = { version: {}, extensions: {} };
  const label = Object.keys(cfg.configuration.version)[0];
  const requiredNodeRaw = Object.values(cfg.configuration.version)[0];
  const current = semver.coerce(process.versions.node)?.version || '0.0.0';
  const required = semver.coerce(String(requiredNodeRaw))?.version || '0.0.0';
  results.version[label] = semver.gte(current, required);
  for (const ext of cfg.configuration.extensions) {
    results.extensions[ext] = true;
  }
  return results;
}

function conF() {
  const c = getC();
  return Object.values({ ...c.version, ...c.extensions }).every(Boolean);
}

async function chWr() {
  const dirs = cfg.writables;
  const out = {};
  for (const d of dirs) {
    const p = basePath(d);
    out[d] = (await fs.pathExists(p)) && await fs.access(p, fs.constants.W_OK).then(()=>true).catch(()=>false);
  }
  return out;
}

async function iDconF() {
  const w = await chWr();
  return Object.values(w).every(Boolean);
}

module.exports = {
  strPrp,
  strAlPbFls,
  strFilRM,
  strFlExs,
  liSync,
  strSync,
  schSync,
  datSync,
  migSync,
  scDotPkS,
  scSpatPkS,
  imIMgDuy,
  getC,
  conF,
  chWr,
  iDconF
};

