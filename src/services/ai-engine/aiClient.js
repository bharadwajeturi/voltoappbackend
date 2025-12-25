// src/services/ai-engine/aiClient.js
const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config(); // Load environment variables

// 1. Initialize the Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. Select the Model (Flash is the fast, cheap one)
const model = genAI.getGenerativeModel({ 
    model: "gemini-flash-latest",
    generationConfig: {
        maxOutputTokens: 1350, // Keep answers concise to save money
        temperature: 0.7,     // Creative enough to be friendly, but accurate
    }
});

// 3. Export a reusable function
async function generateAIResponse(promptText, imageBuffer = null, mimeType = null) {
    try {
        let contentParts = [promptText];
        if (imageBuffer) {
            const imagePart = {
                inlineData: {
                    data: imageBuffer.toString("base64"),
                    mimeType: mimeType || "image/jpeg"
                },
            };
            // Gemini expects an array: [Text, Image]
            contentParts = [promptText, imagePart]; 
        }
        const result = await model.generateContent(promptText);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("❌ AI Generation Error:", error.message);
        return null; // Handle fallback gracefully
    }
}

module.exports = { generateAIResponse };