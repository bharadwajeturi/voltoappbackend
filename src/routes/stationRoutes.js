/**
 * VOLTPATH BACKEND - ROUTE ORCHESTRATOR
 * STATUS: FIXED (Uses Advanced Battery Router + Dual Strategy)
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const polyline = require('@mapbox/polyline');
const db = require('../database/dbmanager'); 
const aggregator = require('../../data_aggregator');
const { fetchAmenitiesForPoint } = require('../fetchers/googleAmenityFetcher');
// 🟢 IMPORT THE ADVANCED ROUTER
const { planRoute } = require('../services/batteryRouter'); 
const { validateRequired } = require('../utils/errorHandler');
const { fetchStationSpecs } = require('../fetchers/googleStationEnricher');


// Helper to save premium amenities to DB
async function savePremiumAmenities(stationId, amenities) {
    if (!amenities || amenities.length === 0) return;
    
    const { db: pool } = require('../../data_aggregator');
    
    try {
        for (const a of amenities) {
            await pool.query(`
                INSERT INTO station_amenities (station_id, name, amenity_type, source, distance_m)
                VALUES ($1, $2, $3, 'google', 0)
                ON CONFLICT DO NOTHING
            `, [stationId, a.name, a.type || 'premium']);
        }
    } catch (e) {
        console.error("Amenity save failed:", e.message);
    }
}

// 🟢 Helper to update Station Specs in DB
async function updateStationSpecs(stationId, specs) {
    const { db: pool } = require('../../data_aggregator');
    try {
        const typeStr = `{${specs.connectors.map(c => `"${c}"`).join(',')}}`;
        await pool.query(`
            UPDATE stationsmaster 
            SET powerkw = GREATEST(powerkw, $1), 
                connectortypes = $2::text[],
                lastupdatedat = NOW()
            WHERE id = $3
        `, [specs.powerkw, typeStr, stationId]);
        console.log(`✨ [DB Fix] Updated specs for ${stationId}: ${specs.powerkw}kW`);
    } catch (e) { console.error("Spec update failed:", e.message); }
}

// Autocomplete Proxy
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

// Near Me Endpoint
router.get('/nearby', async (req, res) => {
    try {
        const { lat, lng, r } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

        const radius = parseInt(r) * 1000 || 5000; 

        // 1. Background Update
        const point = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
        aggregator.processRouteTiles([point]).catch(err => console.error("Bg update failed", err.message));

        // 2. Query DB immediately
        const stations = await db.findNearbyStations(point.latitude, point.longitude, radius);
        res.json(stations);

    } catch (error) {
        console.error('[Nearby] Error:', error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Place Details Proxy
router.get('/places/details', async (req, res) => {
    try {
        const { placeId } = req.query;
        if (!placeId) return res.status(400).json({ error: "Missing placeId" });
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${apiKey}`;
        const response = await axios.get(url);
        if (response.data.status !== 'OK') throw new Error(response.data.error_message);
        res.json(response.data.result.geometry.location);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 🟢 THE CORE: Plan Route (Dual Strategy)
router.post('/plan-route', async (req, res) => {
    try {
        // 🟢 1. GET EXACT INPUTS FROM FRONTEND
        const { start, end, currentSOC, minBufferSOC, batteryKwh, realRange, maxChargeKw, strategy } = req.body;
        validateRequired(req.body, ['start', 'end', 'batteryKwh', 'realRange', 'maxChargeKw']);
        
        console.log(`\n🚀 [API] New Trip Request: ${start.name} -> ${end.name}`);
        console.log(`   Specs: ${batteryKwh}kWh | ${currentSOC}% SOC | Range: ${realRange}km`);

        // 🟢 2. RECONSTRUCT CONFIG
        const carConfig = {
            capacity: parseFloat(batteryKwh),
            efficiency: parseFloat(batteryKwh) / parseFloat(realRange),
            maxChargeRate: parseFloat(maxChargeKw) || 30,
            plugType: 'CCS2'
        };

        const startSOCNum = parseFloat(currentSOC) || 100;

        // 3. Polyline
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&mode=driving&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const dirRes = await axios.get(directionsUrl);
        if (!dirRes.data.routes[0]) throw new Error("No route found");
        
        const routeData = dirRes.data.routes[0];
        const overviewPolyline = routeData.overview_polyline.points;
        const totalDistanceMeters = routeData.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
        const decodedPoints = polyline.decode(overviewPolyline).map(p => ({ latitude: p[0], longitude: p[1] }));

        // 4. Aggregator (One scan for both)
        await aggregator.processRouteTiles(decodedPoints);

        // 🟢 5. Run DUAL Strategies in Parallel
        console.log("⚡ Calculating FAST & SLOW routes...");
        
        const [fastResult, slowResult] = await Promise.all([
            planRoute(
                { lat: start.lat, lng: start.lng }, 
                { lat: end.lat, lng: end.lng }, 
                carConfig, 
                startSOCNum, 
                10, // Fast Buffer
                80, 
                decodedPoints, 
                db, 
                'FAST'
            ),
            planRoute(
                { lat: start.lat, lng: start.lng }, 
                { lat: end.lat, lng: end.lng }, 
                carConfig, 
                startSOCNum, 
                25, // Slow Buffer
                80, 
                decodedPoints, 
                db, 
                'SLOW'
            )
        ]);

        // 6. ENRICHMENT (Only needed for the "FAST" result initially to save time, or do both)
        // For speed, let's just send raw data. The frontend can request details on click if needed.
        // OR, we can do a lightweight enrichment for both.
        // Let's prioritize FAST enrichment.
        
        const enrichedFastStops = await enrichStops(fastResult.plannedStops);
        const enrichedSlowStops = await enrichStops(slowResult.plannedStops);

        res.json({
            tripId: `trip_${Date.now()}`,
            meta: {
                routePolyline: overviewPolyline,
                totalDistance: totalDistanceMeters,
                startName: start.name,
                endName: end.name,
            },
            strategies: {
                FAST: { 
                    plannedStops: enrichedFastStops, 
                    allCandidates: fastResult.allCandidates 
                },
                SLOW: { 
                    plannedStops: enrichedSlowStops, 
                    allCandidates: slowResult.allCandidates 
                }
            }
        });

    } catch (error) {
        console.error("❌ Route Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Helper to Enrich Stops (Refactored out to reuse)
async function enrichStops(stops) {
    return Promise.all(stops.map(async (stop) => {
        const station = stop.station;
        // Check for Ghost Specs
        if ((station.source === 'google' || station.powerkw === 0) && station.id) {
            // console.log(`🔍 [Enricher] Checking specs for ${station.name}...`);
            const specs = await fetchStationSpecs(station.id);
            if (specs) {
                station.powerkw = specs.powerkw;
                station.connectorTypes = specs.connectors;
                await updateStationSpecs(station.id, specs);
            }
        }
        // Check for Amenities
        if (!station.amenities || station.amenities.length === 0) {
            try {
                const googleAmenities = await fetchAmenitiesForPoint(station.lat, station.lng);
                const mapped = googleAmenities.map(a => ({ name: a.name, type: a.type }));
                await savePremiumAmenities(station.id, mapped);
                station.amenities = mapped.map(a => a.type.replace('_', ' '));
            } catch (e) { }
        }
        return stop;
    }));
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