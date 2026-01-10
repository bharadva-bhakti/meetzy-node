/**
 * BladeLib Node - Installation Wizard Package
 * Main entry point for the npm package
 */

const InstallWizard = require('./lib/install.js');
const { UserModel, syncUserModel, checkUserModelCompatibility } = require('./lib/models.js');
const { configureDb, connectDb, runMigrations } = require('./node/src/lib/db.js');

// Re-export commonly used utilities
const { 
  strPrp, 
  strAlPbFls, 
  strFlExs, 
  strFilRM, 
  liSync, 
  migSync, 
  datSync, 
  strSync, 
  scDotPkS, 
  scSpatPkS, 
  imIMgDuy, 
  getC, 
  conF, 
  chWr, 
  iDconF 
} = require('./node/src/lib/helpers.js');

// Version info
const version = '1.0.0';

module.exports = {
  InstallWizard,
  UserModel,
  syncUserModel,
  checkUserModelCompatibility,
  configureDb,
  connectDb,
  runMigrations,
  strPrp, 
  strAlPbFls, 
  strFlExs, 
  strFilRM, 
  liSync, 
  migSync, 
  datSync, 
  strSync, 
  scDotPkS, 
  scSpatPkS, 
  imIMgDuy, 
  getC, 
  conF, 
  chWr, 
  iDconF,
  version
};