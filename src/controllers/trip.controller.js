const batteryRouter = require('../services/ai-engine/batteryRoute');
const tripNarrator = require('../services/ai-engine/tripNarrator'); 

exports.planTrip = async (req, res) => {
    try {
        const { start, end, carConfig, userStrategy } = req.body;

        console.log(`🚀 Planning trip: ${start.name} -> ${end.name}`);

        // 1. Run Math Router
        const routeResult = await batteryRouter.planRoute(
            start, 
            end, 
            waypoints || [], // <--- FIX: Use the actual waypoints
            carConfig, 
            100, 15, 80, [], req.db, userStrategy
        );

        // 2. Run AI Narrator (With Default Fallback)
        let aiSummary = "Trip calculated successfully. Check the stops below."; // 🟢 Default
        try {
             // Check if narrator exists to prevent crash
             if (tripNarrator && tripNarrator.narrateTrip) {
                 const generated = await tripNarrator.narrateTrip(
                    start.name || "Start", 
                    end.name || "Destination", 
                    routeResult.plannedStops, 
                    carConfig.model || "EV"
                );
                if (generated && generated.length > 5) aiSummary = generated;
             }
        } catch (e) {
            console.error("⚠️ AI Narrator failed:", e.message);
            aiSummary = "AI could not generate a summary, but your route is ready. Drive safe!";
        }

        console.log(`🤖 AI Message Generated: "${aiSummary.substring(0, 30)}..."`);

        // 3. Send Response
        res.json({
            success: true,
            route: routeResult.plannedStops,
            stats: routeResult.summary,
            ai_message: aiSummary // 🟢 Ensure this key matches Frontend
        });

    } catch (error) {
        console.error("❌ Planning Error:", error);
        res.status(500).json({ success: false, message: "Planning failed" });
    }
};