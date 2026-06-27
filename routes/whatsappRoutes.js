const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const { authenticateUser } = require('../middleware/auth');

// Public Webhook Handlers (No Auth required)
router.get('/webhook', whatsappController.getWebhook);
router.post('/webhook', whatsappController.postWebhook);

// Protected API endpoints (Auth required)
router.use(authenticateUser);

// Config
router.get('/config', whatsappController.getConfig);
router.post('/config', whatsappController.saveConfig);

// Templates
router.get('/templates', whatsappController.getTemplates);
router.post('/templates', whatsappController.createTemplate);
router.delete('/templates/:id', whatsappController.deleteTemplate);

// Campaigns
router.get('/campaigns', whatsappController.getCampaigns);
router.post('/campaigns', whatsappController.createCampaign);
router.delete('/campaigns/:id', whatsappController.deleteCampaign);
router.patch('/campaigns/:id', whatsappController.patchCampaign);

// Webhook logs
router.get('/webhook-logs', whatsappController.getWebhookLogs);
router.delete('/webhook-logs', whatsappController.deleteWebhookLogs);

// Simulation triggers
router.post('/webhook/simulate-reply', whatsappController.simulateReply);
router.post('/webhook/simulate', whatsappController.simulateStatus);

module.exports = router;
