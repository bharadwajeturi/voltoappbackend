/**
 * VOLTPATH BACKEND - ROUTE ORCHESTRATOR
 * STATUS: FIXED (Polyline Map + Lazy Loading + Optimization)
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const polyline = require('@mapbox/polyline');
const db = require('../database/dbmanager'); 
const aggregator = require('../../data_aggregator');
const { fetchAmenitiesForPoint } = require('../fetchers/googleAmenityFetcher');
const { filterAmenitiesByETA } = require('../utils/timeBasedAmenities'); 
const { planRoute } = require('../services/batteryRouter'); 
const { validateRequired } = require('../utils/errorHandler');
const { fetchStationSpecs } = require('../fetchers/googleStationEnricher');

// 🟢 NEW: Dedicated Endpoint for Lazy Loading Amenities
// Call this when user clicks a station marker
router.get('/station/amenities', async (req, res) => {
    try {
        const { stationId, lat, lng } = req.query;
        
        // 🟢 STRICT GUARD: Stop User Waypoints from hitting DB
        if (!stationId || stationId.startsWith('wp_') || stationId.startsWith('trip_')) {
            return res.json([]); 
        }

        if (!lat || !lng) return res.status(400).json({ error: "Missing params" });

        // 1. Check DB First
        const dbResult = await db.pool.query(`
            SELECT name, amenity_type as type, distance_m 
            FROM station_amenities 
            WHERE station_id = $1
        `, [stationId]);
        
        let amenities = dbResult.rows;

        // 2. If Empty, Fetch Live
        if (amenities.length === 0) {
            console.log(`⚡ [Lazy Load] Fetching amenities for ${stationId}...`);
            try {
                const fetched = await fetchAmenitiesForPoint(parseFloat(lat), parseFloat(lng));
                if (fetched.length > 0) {
                    await savePremiumAmenities(stationId, fetched, 'lazy_load');
                    amenities = fetched; // Use fetched data
                }
            } catch (e) {
                console.error("Lazy fetch failed:", e.message);
            }
        }

        // 3. Apply Time Filter
        const eta = new Date(); 
        const sorted = filterAmenitiesByETA(amenities, eta);

        res.json(sorted);

    } catch (e) {
        console.error("Amenity API Error:", e.message);
        res.status(500).json([]);
    }
});

// Helper to save premium amenities to DB
async function savePremiumAmenities(stationId, amenities, source) {
    if (!amenities || amenities.length === 0) return;
    if (stationId.toString().startsWith('wp_') || stationId.toString().startsWith('trip_')) return; 
    if (source === 'user') return;

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

// 🟢 BRAND STANDARDS
function applyBrandLogic(stationName, specs) {
    const name = (stationName || "").toLowerCase();
    
    let newPower = specs.powerkw || 0;
    let newConnectors = [...(specs.connectors || [])];

    if (name.includes('tata') || name.includes('ez charge')) {
        if (newPower === 0) newPower = 30; 
        if (newConnectors.length === 0) newConnectors.push('CCS2');
    }
    else if (name.includes('zeon') || name.includes('statiq') || name.includes('bpcl') || name.includes('shell')) {
        if (newPower === 0) newPower = 30;
        if (newConnectors.length === 0) newConnectors.push('CCS2');
    }
    else if (name.includes('ather') || name.includes('ola') || name.includes('grid')) {
        if (newPower === 0) newPower = 3.3; 
        if (newConnectors.length === 0) newConnectors.push('Type 2'); 
    }

    return { powerkw: newPower, connectors: newConnectors };
}

// 🟢 Helper to update Station Specs
async function updateStationSpecs(stationId, specs, stationName) {
    const { db: pool } = require('../../data_aggregator');
    const enhancedSpecs = applyBrandLogic(stationName, specs);
    const validConnectors = (enhancedSpecs.connectors || [])
        .filter(c => c && c !== 'Unknown' && c.trim() !== '' && c !== '{Unknown}');

    if (enhancedSpecs.powerkw <= 0 && validConnectors.length === 0) return;

    try {
        const typeStr = `{${validConnectors.map(c => `"${c}"`).join(',')}}`;
        console.log(`✨ [Enricher] Updating ${stationName} -> ${enhancedSpecs.powerkw}kW`);

        await pool.query(`
            UPDATE stationsmaster 
            SET powerkw = GREATEST(powerkw, $1), 
                connectortypes = $2::text[], 
                lastupdatedat = NOW()
            WHERE id = $3
        `, [enhancedSpecs.powerkw, typeStr, stationId]);
        
    } catch (e) { console.error("Spec update failed:", e.message); }
}

// ... [Autocomplete, Nearby, Places Details Routes] ...
router.get('/places/autocomplete', async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) return res.status(400).json({ error: "Missing query" });
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&types=geocode`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/nearby', async (req, res) => {
    try {
        const { lat, lng, r } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
        const radius = parseInt(r) * 1000 || 5000; 
        const point = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
        aggregator.processRouteTiles([point]).catch(err => console.error("Bg update failed", err.message));
        const stations = await db.findNearbyStations(point.latitude, point.longitude, radius);
        res.json(stations);
    } catch (error) { res.status(500).json({ error: "Internal Server Error" }); }
});

router.get('/places/details', async (req, res) => {
    try {
        const { placeId } = req.query;
        if (!placeId) return res.status(400).json({ error: "Missing placeId" });
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry&key=${apiKey}`;
        const response = await axios.get(url);
        if (response.data.status !== 'OK') throw new Error(response.data.error_message);
        res.json(response.data.result.geometry.location);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 🟢 THE CORE: Plan Route
router.post('/plan-route', async (req, res) => {
    try {
        const { 
            start, end, waypoints = [], 
            currentSOC, minBufferSOC, batteryKwh, realRange, maxChargeKw, 
            strategy, isDestinationChargerAvailable = false,
            departureTime 
        } = req.body;

        validateRequired(req.body, ['start', 'end', 'batteryKwh', 'realRange', 'maxChargeKw']);
        
        console.log(`\n🚀 [API] New Trip Request: ${start.name} -> ${end.name}`);

        // 1. Parse Departure Time
        let tripStartTime = new Date(); 
        if (departureTime) {
            const timeParts = departureTime.match(/(\d+):(\d+)\s?(AM|PM)/i);
            if (timeParts) {
                let hours = parseInt(timeParts[1]);
                const minutes = parseInt(timeParts[2]);
                const meridian = timeParts[3].toUpperCase();
                if (meridian === 'PM' && hours < 12) hours += 12;
                if (meridian === 'AM' && hours === 12) hours = 0;
                tripStartTime.setHours(hours, minutes, 0, 0);
                if (tripStartTime < new Date()) tripStartTime.setDate(tripStartTime.getDate() + 1);
            }
        }

        const carConfig = {
            capacity: parseFloat(batteryKwh),
            efficiency: parseFloat(batteryKwh) / parseFloat(realRange),
            maxChargeRate: parseFloat(maxChargeKw) || 30,
            plugType: 'CCS2'
        };
        const startSOCNum = parseFloat(currentSOC) || 100;

        // 2. Google Directions Call
        let waypointsParam = "";
        if (waypoints && waypoints.length > 0) {
            const pointsStr = waypoints.map(w => `${w.lat},${w.lng}`).join('|');
            waypointsParam = `&waypoints=${pointsStr}`;
        }

        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}${waypointsParam}&mode=driving&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        
        const dirRes = await axios.get(directionsUrl);
        if (!dirRes.data.routes[0]) throw new Error("No route found on Google Maps");
        
        const routeData = dirRes.data.routes[0];
        const overviewPolyline = routeData.overview_polyline.points; // Encoded String
        const totalDistanceMeters = routeData.legs.reduce((sum, leg) => sum + leg.distance.value, 0);
        
        // 🟢 FIX 1: Decode Polyline for Frontend
        // Use mapbox/polyline to convert string -> array of {latitude, longitude}
        const decodedPoints = polyline.decode(overviewPolyline).map(p => ({ latitude: p[0], longitude: p[1] }));

        // 3. Extract Real Road Data (Distance & Speed)
        const legConfigs = routeData.legs.map(leg => {
            const distKm = leg.distance.value / 1000;
            const durationHour = leg.duration.value / 3600;
            return {
                distKm: distKm,
                speedKmh: durationHour > 0 ? (distKm / durationHour) : 60 
            };
        });

        await aggregator.processRouteTiles(decodedPoints);

        console.log(`⚡ Calculating FAST & SLOW routes starting at ${tripStartTime.toLocaleTimeString()}...`);

        // 4. Pass Time & Leg Configs to Router
        const [fastResult, slowResult] = await Promise.all([
            planRoute(
                { lat: start.lat, lng: start.lng }, { lat: end.lat, lng: end.lng }, waypoints, 
                carConfig, startSOCNum, 10, 80, decodedPoints, db, 'FAST', 
                isDestinationChargerAvailable, legConfigs, tripStartTime
            ),
            planRoute(
                { lat: start.lat, lng: start.lng }, { lat: end.lat, lng: end.lng }, waypoints, 
                carConfig, startSOCNum, 25, 80, decodedPoints, db, 'SLOW', 
                isDestinationChargerAvailable, legConfigs, tripStartTime
            )
        ]);

        // Enrich with Amenities (Optimized)
        const enrichedFastStops = await enrichStops(fastResult.plannedStops, tripStartTime);
        const enrichedSlowStops = await enrichStops(slowResult.plannedStops, tripStartTime);

        res.json({
            tripId: `trip_${Date.now()}`,
            meta: {
                routePolyline: overviewPolyline, // Encoded String (Backup)
                routePath: decodedPoints,        // 🟢 CRITICAL: This was missing in your response!
                totalDistance: totalDistanceMeters,
                startName: start.name,
                endName: end.name,
                startTime: tripStartTime.toISOString()
            },
            strategies: {
                FAST: { plannedStops: enrichedFastStops, allCandidates: fastResult.allCandidates },
                SLOW: { plannedStops: enrichedSlowStops, allCandidates: slowResult.allCandidates }
            }
        });

    } catch (error) {
        console.error("❌ Route Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// 🟢 FIX 2: Optimized Enricher (Checks DB First)
async function enrichStops(stops, startTime) {
    if (!stops || stops.length === 0) return [];

    return Promise.all(stops.map(async (stop) => {
        const stationId = stop.station.id || "";
        const isRealStation = stationId && 
                              !stationId.toString().startsWith('wp_') && 
                              !stationId.toString().startsWith('trip_');

        if (isRealStation) {
            try {
                // Check DB for Amenities First
                const dbRes = await db.pool.query(
                    `SELECT count(*) FROM station_amenities WHERE station_id = $1`, 
                    [stationId]
                );
                
                // Only Fetch from Google if DB is empty
                if (parseInt(dbRes.rows[0].count) === 0) {
                    fetchAmenitiesForPoint(stop.station.lat, stop.station.lng, stationId)
                        .then(fetched => {
                            if(fetched.length > 0) savePremiumAmenities(stationId, fetched, 'lazy');
                        })
                        .catch(() => {});
                } 
            } catch (e) {}
        }

        const arrivalDate = new Date(stop.arrivalTime);
        const diffMs = arrivalDate - startTime;
        const diffMins = Math.round(diffMs / 60000);

        return {
            ...stop,
            etaString: diffMins > 0 ? `+${Math.floor(diffMins/60)}h ${diffMins%60}m` : "Now"
        };
    }));
}

// ... [Test Routes & Verification Logic] ...
router.get('/test/osm', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });
        const data = await fetchRestaurantsForArea(parseFloat(lat), parseFloat(lng), 5000);
        res.json({ count: data.length, results: data });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/status/tile', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        if (!lat || !lng) return res.status(400).send("Missing lat/lng");
        const status = await db.getTileStatus(lat, lng);
        res.json(status);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/verify', async (req, res) => {
    try {
        const { stationId, power, type, status, price, chargeSuccess, amenities, timestamp } = req.body;
        
        if (!stationId) return res.status(400).json({ error: "Station ID required" });

        // 1. Save Raw Report
        await db.pool.query(`
            INSERT INTO station_verifications 
            (station_id, power_kw, connector_type, status, price, charge_success, amenities, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
        `, [
            stationId, parseFloat(power) || null, type, status, parseFloat(price) || null, 
            chargeSuccess, amenities, timestamp
        ]);

        // 2. Immediate Feedback
        const trustChange = chargeSuccess ? 5 : -5;
        await db.pool.query(`
            UPDATE stationsmaster 
            SET powerkw = COALESCE($1, powerkw),
                last_verified_at = NOW(),
                trust_score = LEAST(100, GREATEST(0, trust_score + $2)) 
            WHERE id = $3
        `, [parseFloat(power) || null, trustChange, stationId]);

        // 3. User Note
        if (amenities && amenities.length > 3) {
            await db.pool.query(`
                INSERT INTO station_amenities (station_id, name, amenity_type, source, distance_m)
                VALUES ($1, $2, 'user_note', 'user', 0)
                ON CONFLICT DO NOTHING
            `, [stationId, amenities]);
        }

        // 4. Consensus
        const THRESHOLD = 3; 
        const historyRes = await db.pool.query(`
            SELECT status FROM station_verifications 
            WHERE station_id = $1 AND created_at > NOW() - INTERVAL '7 days'
        `, [stationId]);

        const reports = historyRes.rows;
        const workingCount = reports.filter(r => r.status === 'Working').length;
        const brokenCount = reports.filter(r => r.status === 'Broken').length;

        if (workingCount >= THRESHOLD) {
            console.log(`🏆 [Consensus] Station ${stationId} is CONFIRMED WORKING`);
            await db.pool.query(`UPDATE stationsmaster SET verified_status = 'Working', trust_score = 95 WHERE id = $1`, [stationId]);
        } 
        else if (brokenCount >= THRESHOLD) {
            console.log(`⚠️ [Consensus] Station ${stationId} is CONFIRMED BROKEN`);
            await db.pool.query(`UPDATE stationsmaster SET verified_status = 'Broken', trust_score = 10 WHERE id = $1`, [stationId]);
        }

        console.log(`✅ [Verify] Station ${stationId} updated (Reports: ${reports.length})`);
        res.json({ success: true, message: "Verification saved & consensus checked" });

    } catch (e) {
        console.error("Verification Save Failed:", e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;