const express = require('express');
const router = express.Router();
const { db, fetchAndSaveExternalData } = require('../../data_aggregator'); 
const { linkRestaurantsToStations } = require('../services/stationAmenityService');
const polyline = require('@mapbox/polyline'); 
const axios = require('axios');

// --- HELPER: Haversine Distance ---
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

// --- HELPER: Variable Interval Sampling ---
function getPointsAlongRoute(encodedPolyline, firstLegKm, regularLegKm) {
    const points = polyline.decode(encodedPolyline);
    const sampledPoints = [];
    
    let accumulatedDist = 0;
    let nextTarget = firstLegKm; 
    let isFirstLegComplete = false;

    // Always include Start Point
    if(points.length > 0) sampledPoints.push({ lat: points[0][0], lng: points[0][1] });

    for (let i = 0; i < points.length - 1; i++) {
        const [lat1, lng1] = points[i];
        const [lat2, lng2] = points[i+1];
        
        const dist = getDistance(lat1, lng1, lat2, lng2);
        accumulatedDist += dist;

        if (accumulatedDist >= nextTarget) {
            sampledPoints.push({ lat: lat2, lng: lng2 });
            accumulatedDist = 0;
            if (!isFirstLegComplete) {
                isFirstLegComplete = true;
                nextTarget = regularLegKm; 
            }
        }
    }
    
    const last = points[points.length - 1];
    sampledPoints.push({ lat: last[0], lng: last[1] });
    
    return sampledPoints;
}

// GET /nearby
router.get('/nearby', async (req, res) => {
    try {
        const { lat, lng, r } = req.query;
        const radius = r ? parseFloat(r) * 1000 : 50000; 

        console.log(`[API] Searching nearby: ${lat}, ${lng} (r=${radius/1000}km)`);

        const query = `
            SELECT 
                id, name, address, operator, powerkw,
                connectortypes as charger_type, 
                trustscore, lat, lng, amenities
            FROM stationsmaster 
            WHERE ST_DWithin(
                ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography, 
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
                $3
            )
        `;

        const result = await db.query(query, [parseFloat(lng), parseFloat(lat), radius]);
        console.log(`[API] Found ${result.rows.length} stations.`);
        res.json(result.rows);
        
        if (result.rows.length > 0) {
            linkRestaurantsToStations(parseFloat(lat), parseFloat(lng));
        }   
    } catch (error) {
        console.error('[API] Nearby Error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- POST /plan-route ---
router.post('/plan-route', async (req, res) => {
    try {
        const { 
            start, end, carModel, 
            maxRangeKm = 300, currentBattery = 100, minBuffer = 20 
        } = req.body;

        console.log(`[API] 🗺️ Planning: ${currentBattery}% Battery -> ${minBuffer}% Buffer`);

        if (!start || !end) return res.status(400).json({ error: "Missing coordinates" });

        // 1. Fetch Route
        const dirUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const dirRes = await axios.get(dirUrl);
        
        if (!dirRes.data.routes || dirRes.data.routes.length === 0) {
            return res.status(400).json({ error: "No route found" });
        }

        const routeData = dirRes.data.routes[0];
        const encodedPolyline = routeData.overview_polyline.points;
        const totalDistKm = routeData.legs[0].distance.value / 1000;

        // 2. Logic: Intervals
        const startBatteryUsable = currentBattery - minBuffer;
        const firstLegRangeKm = startBatteryUsable > 0 ? (maxRangeKm * (startBatteryUsable / 100)) : 20; 
        const regularLegRangeKm = maxRangeKm * ((100 - minBuffer) / 100);

        const firstInterval = firstLegRangeKm * 0.6;
        const regularInterval = regularLegRangeKm * 0.6;

        console.log(`📍 Intervals: First=${Math.round(firstInterval)}km, Regular=${Math.round(regularInterval)}km`);
        
        const searchPoints = getPointsAlongRoute(encodedPolyline, firstInterval, regularInterval);
        
        if(searchPoints.length > 20) {
             const reduced = searchPoints.filter((_, i) => i % 2 === 0);
             searchPoints.length = 0;
             searchPoints.push(...reduced);
        }

        // 3. Process Points (DB Check)
        let apiCallsMade = 0;
        const BATCH_SIZE = 5; 
        for (let i = 0; i < searchPoints.length; i += BATCH_SIZE) {
            const batch = searchPoints.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (point) => {
                const checkQuery = `SELECT 1 FROM stationsmaster WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 15000) LIMIT 1;`;
                const exists = await db.query(checkQuery, [point.lng, point.lat]);
                if (exists.rows.length === 0) {
                    await fetchAndSaveExternalData(point.lat, point.lng);
                    apiCallsMade++;
                }
            }));
        }

        console.log(`[API] 🏁 Stats: ${searchPoints.length} Points | ${apiCallsMade} Calls`);

        // 4. Retrieve Stations
        const lineCoords = searchPoints.map(p => `${p.lng} ${p.lat}`).join(',');
        const wktRoute = `LINESTRING(${lineCoords})`;

        const stationsQuery = `
            SELECT 
                id, name, address, operator, powerkw, 
                connectortypes as charger_type, 
                trustscore, lat, lng, amenities
            FROM stationsmaster 
            WHERE ST_DWithin(
                geog, 
                ST_GeomFromText($1, 4326)::geography, 
                10000 
            )
        `;
        
        const stationsResult = await db.query(stationsQuery, [wktRoute]);
        const stations = stationsResult.rows;

        // 5. Response (FIXED STRUCTURE)
        // We now expose trip_id and total_distance_km at the root level for the frontend.
        res.json({
            status: "success",
            trip_id: `trip_${Date.now()}`,       // ✅ Added back (Frontend needs this)
            total_distance_km: totalDistKm,      // ✅ Added back (Frontend needs this)
            
            start_location: start,
            end_location: end,

            stations_count: stations.length,
            stations: stations,
            stops: stations,                     // ✅ Aliased for safety (Frontend might check 'stops')

            trip_info: {                         // Keeping this for debugging/detailed views
                start_battery: currentBattery,
                min_buffer: minBuffer,
                first_stop_search_km: firstInterval,
                regular_stop_search_km: regularInterval
            },
            
            route_geometry: encodedPolyline
        });

    } catch (error) {
        console.error('[API] Plan Route Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;