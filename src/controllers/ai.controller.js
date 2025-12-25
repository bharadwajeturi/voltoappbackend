const helpBot = require('../services/ai-engine/helpBot');
const faqData = require('../data/faqDetails.json'); 
const tripNarrator = require('../services/ai-engine/tripNarrator'); 
const multer = require('multer');
const ChatLog = require('../model/ChatLog'); // Sequelize Model
const { Op } = require('sequelize'); // Required for database operations

// Configure Multer to store file in RAM (Memory)
const upload = multer({ storage: multer.memoryStorage() });

// 🟢 1. GET HISTORY
exports.getChatHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Fetch last 50 messages, oldest first
        const history = await ChatLog.findAll({
            where: { userId: userId },
            order: [['createdAt', 'ASC']], 
            limit: 50
        });

        // Format for Frontend
        const formattedHistory = history.map(log => ({
            id: log.id,
            text: log.message,
            sender: log.sender,
            isAi: log.isAi,
            action: null, // History logs don't trigger actions again
            feedback: log.feedback // 🟢 Send feedback status to UI
        }));

        return res.status(200).json({ success: true, history: formattedHistory });
    } catch (error) {
        console.error("Fetch History Error:", error);
        return res.status(500).json({ success: false, message: "Could not load history" });
    }
};

// 🟢 2. HANDLE FEEDBACK (New Feature)
exports.handleFeedback = async (req, res) => {
    try {
        const { messageId, type } = req.body; // type = 'up' or 'down'
        
        // Update the specific message in the database
        await ChatLog.update(
            { feedback: type },
            { where: { id: messageId } }
        );

        return res.status(200).json({ success: true, message: "Feedback recorded" });
    } catch (error) {
        console.error("Feedback Error:", error);
        return res.status(500).json({ success: false, message: "Error saving feedback" });
    }
};

// 🟢 3. CLEAR HISTORY
exports.clearChatHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        await ChatLog.destroy({ where: { userId } });
        return res.status(200).json({ success: true, message: "Chat history cleared" });
    } catch (error) {
        console.error("Clear Chat Error:", error);
        return res.status(500).json({ success: false, message: "Error clearing chat" });
    }
};

// 🟢 4. ASK AI (With Context & Memory)
exports.askAi = async (req, res) => {
    try {
        const { query, userId, carDetails } = req.body; 
        const imageFile = req.file; // Captured by Multer

        // 1. Validation
        if (!query && !imageFile) {
            return res.status(400).json({ success: false, message: "Query or Image is required" });
        }

        // 2. Save User Query to Postgres
        await ChatLog.create({ 
            userId: userId, 
            message: query ? query : "[Sent an Image]", 
            sender: 'user' 
        });

        // 🟢 3. CONTEXT AWARENESS: Fetch last 3 messages
        // This gives the AI "Memory" of the recent conversation
        const historyLogs = await ChatLog.findAll({
            where: { userId },
            order: [['createdAt', 'DESC']], // Get newest first
            limit: 3, // Look back 3 messages
        });

        // Format history for the AI (Reverse to make it chronological: Oldest -> Newest)
        const conversationHistory = historyLogs.reverse().map(log => 
            `${log.sender === 'user' ? 'User' : 'Bot'}: ${log.message}`
        ).join('\n');

        // 4. Call AI Service (Pass History!)
        const result = await helpBot.getHelpResponse(query, carDetails, imageFile, conversationHistory);

        // 5. Save Bot Response to Postgres
        const botLog = await ChatLog.create({ 
            userId: userId, 
            message: result.answer, 
            sender: 'bot', 
            isAi: result.source === 'AI_Assistant' 
        });

        // 🟢 6. OPTIMIZATION: Auto-Cleanup (Max 50 messages)
        const MAX_HISTORY = 50;
        const currentCount = await ChatLog.count({ where: { userId } });

        if (currentCount > MAX_HISTORY) {
            const messagesToDelete = currentCount - MAX_HISTORY;
            
            const oldMessages = await ChatLog.findAll({
                where: { userId },
                order: [['createdAt', 'ASC']], // Oldest first
                limit: messagesToDelete,
                attributes: ['id']
            });

            const idsToDelete = oldMessages.map(m => m.id);
            if (idsToDelete.length > 0) {
                await ChatLog.destroy({ where: { id: idsToDelete } });
                console.log(`🧹 Cleaned up ${idsToDelete.length} old messages for ${userId}`);
            }
        }
        
        // 7. Return Response with ID (for Feedback) and Action
        return res.status(200).json({ 
            success: true, 
            data: { 
                ...result, 
                messageId: botLog.id // 👈 Required for Thumbs Up/Down
            } 
        });

    } catch (error) {
        console.error("AI Controller Error:", error);
        return res.status(500).json({ success: false, message: "AI Service Error" });
    }
};

// Export middleware
exports.uploadMiddleware = upload.single('image');

// 🟢 5. FAQ Options
exports.getFaqOptions = (req, res) => {
    try {
        const suggestions = faqData.map(item => ({
            id: item.id,
            question: item.question,
            category: item.category
        }));
        return res.status(200).json({ success: true, questions: suggestions });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Could not load FAQs" });
    }
};

// 🟢 6. Trip Summary
exports.summarizeTrip = async (req, res) => {
    try {
        const { routeData } = req.body; 

        if (!routeData) {
            return res.status(400).json({ success: false, message: "No route data provided" });
        }

        const summary = await tripNarrator.summarizeTrip(routeData);

        return res.status(200).json({
            success: true,
            summary: summary
        });

    } catch (error) {
        console.error("❌ Trip Summary Error:", error);
        return res.status(500).json({ success: false, message: "Could not generate summary." });
    }
};