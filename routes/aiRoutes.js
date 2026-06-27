// routes/aiRoutes.js
const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { authenticateUser } = require('../middleware/auth');

// Protected AI generator endpoints
router.post('/generate-template', authenticateUser, aiController.generateTemplate);

module.exports = router;
