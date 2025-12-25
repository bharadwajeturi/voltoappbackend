// debug-models.js
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

async function checkModels() {
    console.log("🔍 Checking available models for your API Key...");
    
    try {
        const response = await fetch(URL);
        const data = await response.json();

        if (data.error) {
            console.error("❌ API Error:", data.error.message);
            return;
        }

        console.log("\n✅ AVAILABLE MODELS:");
        // Filter for "generateContent" models only (the ones we need)
        const chatModels = data.models.filter(m => m.supportedGenerationMethods.includes("generateContent"));
        
        chatModels.forEach(m => {
            console.log(`- ${m.name.replace('models/', '')}`);
        });

        console.log("\n👉 Use one of the names above in your aiClient.js file.");

    } catch (error) {
        console.error("❌ Network Error:", error.message);
    }
}

checkModels();