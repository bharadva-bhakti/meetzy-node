const { Router } = require('express');
const InstallController = require('../src/controllers/InstallController.js');

const router = Router();

const setRouteName = (name) => (req, res, next) => { 
  req.app.locals.currentRouteName = name; 
  next(); 
};

router.get('/unblock/:project_id', setRouteName('install.unblock.show'), InstallController.getUnblock);
router.get('/block/:project_id', setRouteName('install.block.api'), InstallController.getBlockProject);
router.post('/resetLicense', setRouteName('install.resetLicense'), InstallController.postResetLicense);
router.get('/resetLicense', setRouteName('install.resetLicense.get'), InstallController.postResetLicense);
router.get('/erase/:project_id', setRouteName('install.erase'), InstallController.getErase);

router.post('/block/license/verify', setRouteName('install.unblock'), ...[].concat(InstallController.postUnblockVerify));
router.get('/block', setRouteName('install.block.setup'), InstallController.getBlockSetup);

// Main installation routes (when mounted at /install, these become /install/, /install/requirements, etc.)
router.get('/', setRouteName('install.requirements'), InstallController.getRequirements);
router.get('/requirements', setRouteName('install.requirements'), InstallController.getRequirements);
router.get('/directories', setRouteName('install.directories'), InstallController.getDirectories);
router.get('/database', setRouteName('install.database'), InstallController.getDatabase);
router.get('/verify', setRouteName('install.verify.setup'), InstallController.getVerifySetup);
router.post('/verify', setRouteName('install.verify'), ...(InstallController.postVerify || []));
router.get('/license', setRouteName('install.license'), InstallController.getLicense);
router.post('/license', setRouteName('install.license.setup'), ...[].concat(InstallController.postLicense));
router.post('/database', setRouteName('install.database.config'), ...[].concat(InstallController.postDatabaseConfig));
router.get('/completed', setRouteName('install.completed'), InstallController.getCompleted);
router.get('/run-seeder', setRouteName('install.completed'), InstallController.runSeeder);

module.exports = router;