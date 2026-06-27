const express = require('express');
const router = express.Router();
const canvaController = require('../controllers/canvaController');
const { authenticateUser } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateUser);

router.get('/config', canvaController.getConfig);
router.post('/config', canvaController.saveConfig);
router.get('/auth/url', canvaController.getAuthUrl);
router.post('/auth/token', canvaController.handleCallback);
router.post('/auth/disconnect', canvaController.disconnect);
router.get('/profile', canvaController.getProfile);
router.get('/brand-templates', canvaController.listBrandTemplates);
router.get('/brand-templates/:id/dataset', canvaController.getTemplateDataset);
router.post('/autofill', canvaController.autofillAndExport);
router.get('/designs', canvaController.listDesigns);
router.post('/export', canvaController.exportDesign);

module.exports = router;
