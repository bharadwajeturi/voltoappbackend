/**
 * VOLTPATH BACKEND - ROUTE ORCHESTRATOR
 * STATUS: FIXED (Uses Advanced Battery Router + Autocomplete)
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const polyline = require('@mapbox/polyline');
const geohash = require('ngeohash');

// Adjust paths based on your folder structure
const db = require('../database/dbmanager'); 
const aggregator = require('../../data_aggregator');
const { calculateGreenScore } = require('../utils/scoringEngine'); // Ensure this exists
const fetchRestaurantsForArea = require('../fetchers/osmFetcher');
const { fetchAmenitiesForPoint } = require('../fetchers/googleAmenityFetcher'); // 🟢 Import this

// 🟢 IMPORT THE ADVANCED ROUTER
const { planRoute } = require('../services/batteryRouter'); 

// 🟢 NEW: Google Places Autocomplete (Proxied via Backend)
router.get('/places/autocomplete', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Missing query" });

        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode`;
        
        const response = await axios.get(url);
        res.json(response.data);
    } catch (e) {
        console.error("[Autocomplete] Error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// 🟢 NEW ENDPOINT: /nearby
router.get('/nearby', async (req, res) => {
    try {
        const { lat, lng, r } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

        const radius = parseInt(r) * 1000 || 5000; 

        // 1. Background Update (Fire & Forget or Short Wait)
        const point = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
        try {
            await Promise.race([
                aggregator.processRouteTiles([point]), 
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (e) { console.log("Bg update timeout"); }

        // 2. Query DB
        const stations = await db.findNearbyStations(point.latitude, point.longitude, radius);
        
        // 3. Add Green Score
        const scoredStations = stations.map(s => {
             const isRoutable = parseFloat(s.powerkw) > 0;
             return {
                ...s,
                isRoutable,
                greenScore: calculateGreenScore(s)
             };
        }).sort((a, b) => b.greenScore - a.greenScore);

        res.json(scoredStations);

    } catch (error) {
        console.error('[Nearby] Error:', error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post('/plan-route', async (req, res) => {
    try {
        const { start, end, carModel, currentBattery, preferences } = req.body;

        if (!start || !end) {
            return res.status(400).json({ error: 'Start and End coordinates required' });
        }

        console.log(`[Router] Planning route: ${start.latitude},${start.longitude} -> ${end.latitude},${end.longitude} | Bat: ${currentBattery}%`);

        // 1. Get Route Polyline from Google
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&mode=driving&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        
        const dirRes = await axios.get(directionsUrl);
        if (dirRes.data.status !== 'OK') {
            throw new Error(`Directions API Error: ${dirRes.data.status}`);
        }

        const targetArrivalSOC = preferences?.minBuffer || 15;
        const maxRangeKm = preferences?.maxRangeKm || 300; // 🟢 Get User Defined Range

        const routeData = dirRes.data.routes[0];
        const overviewPolyline = routeData.overview_polyline.points;
        const totalDistanceKm = routeData.legs[0].distance.value / 1000;

        const decodedPoints = polyline.decode(overviewPolyline).map(p => ({
            latitude: p[0],
            longitude: p[1]
        }));

        let scanResolutionKm = 3; // Default (City)
        if (totalDistanceKm > 400) {
            scanResolutionKm = 25; // Highway Mode (Super Fast)
        } else if (totalDistanceKm > 100) {
            scanResolutionKm = 10; // Regional Mode
        }

        // 2. SYNC INGESTION (Update DB with fresh stations along route)
        try {
            console.log("[Router] ⏳ Scanning route tiles...");
             await aggregator.processRouteTiles(decodedPoints);
             console.log("[Router] ✅ Data Sync Complete. Calculating Physics...");
        } catch (err) {
            console.error("[Ingest Error]", err.message);
        }

        // 3. 🟢 CALL ADVANCED BATTERY ROUTER
        // This calculates exactly where to stop based on the car's physics
        const tripPlan = await planRoute(
            { lat: start.latitude, lng: start.longitude },
            { lat: end.latitude, lng: end.longitude },
            carModel,
            currentBattery || 100, // Start SOC
            targetArrivalSOC,  // Target Arrival SOC (Buffer)
            80,  // Max Charge Limit
            decodedPoints,
            db ,    // Pass DB instance for the router to find stations
            maxRangeKm  
        );

        // 🟢 4. ENRICH STOPS (The "Premium" Fix)
        // We iterate through the planned stops and fetch live Google data for them.
        const enrichedStops = await Promise.all(tripPlan.plannedStops.map(async (stop) => {
            // If DB didn't have amenities, fetch from Google now
            if (!stop.station.amenities || stop.station.amenities.length === 0) {
                console.log(`[Router] ✨ enriching stop: ${stop.station.name}`);
                const googleAmenities = await fetchAmenitiesForPoint(stop.station.lat, stop.station.lng);
                
                // Map Google format to your simple string array format if needed
                const simpleAmenities = googleAmenities.map(a => a.type.replace('_', ' '));
                
                // Merge back
                stop.station.amenities = simpleAmenities;
            }
            return stop;
        }));

        // 4. Fetch All Nearby Stations (For "View All" feature)
        // We still want to show other stations, not just the recommended stops
        const searchPoints = samplePoints(decodedPoints, 20); // Check every 20km
        let allStations = [];
        const seenIds = new Set();

        for (const point of searchPoints) {
            const stations = await db.findNearbyStations(point.latitude, point.longitude, 15000); // 15km radius
            for (const station of stations) {
                if (!seenIds.has(station.id)) {
                    // Calculate Score
                    station.greenScore = calculateGreenScore(station);
                    seenIds.add(station.id);
                    allStations.push(station);
                }
            }
        }
        
        // Sort by Green Score
        allStations.sort((a, b) => b.greenScore - a.greenScore);

        // 5. Send Response
        res.json({
            success: true,
            tripId: `trip_${Date.now()}`,
            totalDistance: totalDistanceKm,
            routePolyline: overviewPolyline,
            
            // 🟢 The Result from Battery Router
            selectedStops: enrichedStops.map(stop => ({
                ...stop.station, 
                legDistance: stop.legDistance,
                arrivalSOC: stop.charging.arrivalSOC,
                chargeTime: stop.charging.chargeTimeMinutes
            })),
            
            allStations: allStations,
            isPartialData: false 
        });

    } catch (error) {
        console.error('[Router] Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 🟢 NEW: Get Place Details (Lat/Lng) from Place ID
router.get('/places/details', async (req, res) => {
    try {
        const { placeId } = req.query;
        if (!placeId) return res.status(400).json({ error: "Missing placeId" });

        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${apiKey}`;
        
        const response = await axios.get(url);
        
        if (response.data.status !== 'OK') {
            throw new Error(response.data.error_message || 'Failed to fetch details');
        }

        // Return just the location object { lat, lng }
        res.json(response.data.result.geometry.location);
    } catch (e) {
        console.error("[Place Details] Error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// Helper to sample points along the line
function samplePoints(points, intervalKm) {
    if (!points || points.length === 0) return [];
    const result = [points[0]];
    // Simple sampling logic (every Nth point is rough, real logic needs distance calc)
    // For now, returning every 20th point is a safe approximation for 500+ point arrays
    const step = Math.ceil(points.length / 20); 
    for (let i = 1; i < points.length; i += step) {
        result.push(points[i]);
    }
    return result;
}

// --- OSM TEST ROUTE ---
router.get('/test/osm', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

        console.log(`[Test] Calling OSM for ${lat}, ${lng}`);
        const data = await fetchRestaurantsForArea(parseFloat(lat), parseFloat(lng), 5000);
        
        res.json({ count: data.length, results: data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- STATUS ENDPOINTS ---
router.get('/status/tile', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) return res.status(400).send("Missing lat/lng");
        const status = await db.getTileStatus(lat, lng);
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;