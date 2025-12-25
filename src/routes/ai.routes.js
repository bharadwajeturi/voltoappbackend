const express = require('express');
const router = express.Router();
const aiController = require('../controllers/ai.controller');

// Log to confirm this file loads
console.log("✅ AI Routes Loaded"); 

router.get('/faq-options', aiController.getFaqOptions);

// ✅ MAKE SURE THIS IS ABOVE module.exports
router.post('/summarize-trip', aiController.summarizeTrip);

// In src/routes/ai.routes.js
router.post('/ask', aiController.uploadMiddleware, aiController.askAi);

// src/routes/ai.routes.js
router.get('/history/:userId', aiController.getChatHistory);

router.delete('/history/:userId', aiController.clearChatHistory);

router.put('/feedback', aiController.handleFeedback);

module.exports = router;