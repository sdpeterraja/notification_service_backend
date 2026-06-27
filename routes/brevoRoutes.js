const express = require('express');
const router = express.Router();
const brevoController = require('../controllers/brevoController');
const { authenticateUser } = require('../middleware/auth');

router.use(authenticateUser);

router.post('/test', brevoController.testConnection);
router.post('/connect', brevoController.connect);
router.post('/disconnect', brevoController.disconnect);
router.get('/status', brevoController.getStatus);
router.get('/transactions', brevoController.getTransactions);

module.exports = router;