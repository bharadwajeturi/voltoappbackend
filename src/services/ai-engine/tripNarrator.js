const { generateAIResponse } = require('./aiClient');

/**
 * 🗣️ TRIP NARRATOR (Real AI Version)
 * Takes the calculated route and asks Gemini to summarize it.
 */
async function narrateTrip(startName, endName, stops, carModel) {
    
    // 1. Filter checks
    if (!stops || stops.length === 0) return null;

    // 2. Prepare Data for AI (Simplify to save tokens/latency)
    const chargerStops = stops.filter(s => s.type === 'CHARGER');
    const stopDetails = chargerStops.map((s, i) => 
        `Stop ${i+1}: ${s.station.name} (${s.station.powerkw}kW). Arrive with ${s.arrivalSOC}%.`
    ).join('\n');

    // 3. The Prompt
    const prompt = `
        You are a friendly EV Co-Pilot.
        User drives a ${carModel}.
        Route: ${startName} to ${endName}.
        Total Distance: ${Math.round(stops[stops.length-1].legDistance)} km (approx).
        
        Charging Plan:
        ${stopDetails}

        TASK:
        Write a very short, encouraging summary (max 2 sentences) for the driver.
        Mention if the chargers are fast. 
        Example output: "I've found a fast route with 2 reliable stops. Your first charge is at Zeon, which is excellent!"
    `.trim();

    try {
        console.log("🧠 [Narrator] Asking Gemini...");
        const narration = await generateAIResponse(prompt);
        return narration ? narration.trim() : null;
    } catch (error) {
        console.error("AI Narration Failed:", error);
        return null;
    }
}

module.exports = { narrateTrip };