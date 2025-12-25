const { generateAIResponse } = require('../../services/ai-engine/aiClient'); // Check this path matches your project
const faqData = require('../../data/faqDetails.json'); // 🟢 Ensure .json extension if it's a JSON file
const { Op } = require('sequelize');
const ChatLog = require('../../model/ChatLog'); 

/**
 * 🟢 STAGE 1: LOCAL SEARCH (The Fastest)
 * Checks your static JSON file for instant answers.
 */
function findLocalMatch(query) {
    if (!query) return null;
    const lowerQuery = query.toLowerCase();
    
    for (const faq of faqData) {
        let matchCount = 0;
        if (faq.keywords) {
            // Count how many keywords match
            faq.keywords.forEach(word => {
                if (lowerQuery.includes(word.toLowerCase())) matchCount++;
            });
        }
        // If 2 or more keywords match, it's a good answer
        if (matchCount >= 2) return faq;
    }
    return null;
}

/**
 * 🟢 STAGE 2: DATABASE SEARCH (The "Memory")
 * Checks if this question was answered successfully for another user before.
 */
async function findAnswerInLogs(userQuery) {
    // Safety check: ensure query exists
    if (!userQuery) return null;

    // 1. Extract keywords (words > 4 chars)
    const keywords = userQuery.split(' ')
        .filter(w => w.length > 4)
        .map(w => ({
            // Explicitly target the 'message' column to prevent Sequelize crash
            message: { [Op.iLike]: `%${w}%` } 
        }));

    if (keywords.length === 0) return null;

    try {
        // 2. Find a previous USER question matching ALL keywords
        const similarQuestion = await ChatLog.findOne({
            where: {
                sender: 'user',
                [Op.and]: keywords // e.g. (message LIKE '%payment%' AND message LIKE '%failed%')
            },
            order: [['createdAt', 'DESC']], // Get most recent match
        });

        if (similarQuestion) {
            // 3. Find the BOT response that followed it
            const botAnswer = await ChatLog.findOne({
                where: {
                    sender: 'bot',
                    userId: similarQuestion.userId,
                    id: { [Op.gt]: similarQuestion.id }
                },
                order: [['id', 'ASC']]
            });

            // 4. Validate answer (ignore error messages)
            if (botAnswer && 
                !botAnswer.message.includes("trouble analyzing") && 
                !botAnswer.message.includes("System error")) {
                 return {
                    answer: botAnswer.message,
                    source: "Community_History"
                };
            }
        }
    } catch (error) {
        console.error("Log Search Error:", error);
    }
    return null;
}

/**
 * 🟢 MAIN BOT FUNCTION
 * Now accepts 'history' for Context Awareness
 */
async function getHelpResponse(userQuery, carDetails = "Unknown EV", imageFile = null, history = "") {
    
    // 🟢 0. SMART ACTIONS (Deep Linking)
    let action = null;
    const lowerQ = userQuery ? userQuery.toLowerCase() : "";

    if (lowerQ.includes("history") || lowerQ.includes("past trips") || lowerQ.includes("receipt")) {
        action = "NAVIGATE_HISTORY";
    } else if (lowerQ.includes("profile") || lowerQ.includes("account") || lowerQ.includes("wallet")) {
        action = "NAVIGATE_PROFILE";
    } else if (lowerQ.includes("map") || lowerQ.includes("find charger") || lowerQ.includes("nearby")) {
        action = "NAVIGATE_MAP";
    }

    // --- STAGE 1 & 2 ONLY RUN FOR TEXT (Images always need AI) ---
    if (!imageFile) {
        if (!userQuery) return { answer: "Please ask a question.", source: "System" };
        
        // 1️⃣ FASTEST: Check Local FAQs (0ms latency)
        const localMatch = findLocalMatch(userQuery);
        if (localMatch) {
            console.log(`✅ Found Local FAQ Match: ${localMatch.id}`);
            return {
                answer: localMatch.answer,
                videoLink: localMatch.videoLink || null,
                relatedQuestion: localMatch.question,
                source: "KnowledgeBase",
                action: action 
            };
        }

        // 2️⃣ FAST: Check Database History (~50ms latency)
        const historyMatch = await findAnswerInLogs(userQuery);
        if (historyMatch) {
            console.log(`✅ Found Match in Chat History`);
            return { ...historyMatch, action: action };
        }
    }

    // --- STAGE 3: ASK AI (Fallback) ---
    console.log(`⚠️ No local match. Asking AI... (Car: ${carDetails})`);
    
    let prompt = "";

    // 📸 Branch A: Vision Prompt (If Image)
    if (imageFile) {
        prompt = `
            You are a technical support bot for "VoltPath".
            CONTEXT: User's Car: ${carDetails}.
            TASK: Analyze the attached image of the EV Charger screen or error.
            USER QUESTION: "${userQuery || "What does this error mean?"}"
            RULES: Identify Error Codes, explain the cause, and provide fix steps specific to the ${carDetails} if applicable.
        `.trim();
    } 
    // 💬 Branch B: Text Prompt (With Context & History)
    else {
        prompt = `
            You are "VoltPath Support", an expert EV assistant.
            
            PREVIOUS CONVERSATION:
            ${history || "No prior context."}
            
            CURRENT CONTEXT:
            - **User's Active Vehicle:** ${carDetails}
            - Question: "${userQuery}"
            
            CRITICAL RULES:
            1. **Vehicle Specificity:** The user is driving a **${carDetails}**. You MUST tailor your answer to this specific car. Do NOT mention Tata Nexon or other cars unless the user explicitly asks about them.
            2. **Discovery Only:** We do not handle payments/start charging directly.
            3. **Redirect:** Tell users to use the **Official App** (Tata, Zeon, etc.) for starting/paying.
            4. **Smart Actions:** If the user asked to see History/Profile/Map, I have already attached a button. Just confirm "Sure, here is the link."
            
            Keep answers concise (2-3 sentences).
        `.trim();
    }

    try {
        const aiAnswer = await generateAIResponse(
            prompt, 
            imageFile ? imageFile.buffer : null, 
            imageFile ? imageFile.mimetype : null
        );

        return {
            answer: aiAnswer ? aiAnswer.trim() : "I'm having trouble analyzing that right now. Please try again.",
            source: "AI_Assistant",
            action: action 
        };
    } catch (error) {
        console.error("AI Generation Failed:", error);
        return {
            answer: "Our support brain is currently offline. Please check the FAQs.",
            source: "System"
        };
    }
}

module.exports = { getHelpResponse };