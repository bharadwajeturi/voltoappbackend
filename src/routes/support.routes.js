const express = require('express');
const router = express.Router();
const supportController = require('../controllers/support.controller');

// 🟢 GET /api/support/faq
router.get('/faq', supportController.getFAQs);

module.exports = router;