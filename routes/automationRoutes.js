// routes/automationRoutes.js
const express = require('express');
const router = express.Router();
const automationController = require('../controllers/automationController');
const { authenticateUser } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateUser);

router.get('/', automationController.getAutomations);
router.get('/:id', automationController.getAutomation);
router.post('/', automationController.createAutomation);
router.put('/:id', automationController.updateAutomation);
router.delete('/:id', automationController.deleteAutomation);

module.exports = router;
