/**
 * VOLTPATH AGGREGATOR (v6.1 - 7 Day Cache & Corridor Optimization)
 * Strategy: 
 * - Check DB first (Freshness = 7 Days).
 * - Scan Corridor every 50km (Optimal for long routes).
 * - Saves $$$ on Google/OCM calls.
 */

const { Pool } = require('pg'); 
const dotenv = require('dotenv');
const geohash = require('ngeohash'); 
const mergeData = require('./src/merger/engine');

// Import Fetchers
const googleFetcher = require('./src/fetchers/googleFetcher'); 
const ocmFetcher = require('./src/fetchers/ocmFetcher');
const govFetcher = require('./src/fetchers/govFetcher');
const rapidFetcher = require('./src/fetchers/rapidApiFetcher');

// Import Amenity Service
const { linkRestaurantsToStations } = require('./src/services/stationAmenityService');

dotenv.config();

const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20
});

const fetchSafe = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r([]), ms))]).catch(() => []);

// --- 🟢 SMART CACHE CHECK (7 Days) ---
// Returns TRUE if we have good data for this sector
async function isSectorFresh(lat, lng, client) {
    try {
        // Rule: If > 5 stations exist and were updated in the last 7 DAYS
        const result = await client.query(`
            SELECT count(*) as count 
            FROM stationsmaster 
            WHERE ST_DWithin(geog, ST_MakePoint($1, $2)::geography, 50000)
            AND lastupdatedat > NOW() - INTERVAL '7 days'
        `, [lng, lat]); // PostGIS uses [lng, lat]

        const count = parseInt(result.rows[0].count);
        return count >= 5; // "Fresh" if we have data
    } catch (e) {
        console.warn(`[Cache Check Failed] ${e.message}`);
        return false; // Fail safe: Fetch data
    }
}

async function processRouteTiles(points) {
    if (!points || points.length === 0) return;

    // 🟢 ROUTE SEGMENTATION LOGIC
    // For >400km routes, 50km intervals with 50km radius creates a 
    // robust "Corridor Search" that covers 100% of the highway + detours.
    // Reducing this interval would spike costs without adding coverage.
    const targets = sampleRoutePoints(points, 50);
    console.log(`[Aggregator] 🎯 Analyzing ${targets.length} sectors (7-Day Cache Rule)...`);

    const client = await db.connect();
    
    try {
        let fetchCount = 0;
        let cacheCount = 0;

        for (const point of targets) {
            // 🟢 STEP 1: CHECK CACHE (7 Days)
            const fresh = await isSectorFresh(point.latitude, point.longitude, client);
            
            if (fresh) {
                // console.log(`[Aggregator] ⏩ Sector ${point.latitude.toFixed(2)},${point.longitude.toFixed(2)} is fresh. Skipping API.`);
                cacheCount++;
                continue; 
            }

            // 🟢 STEP 2: FETCH ONLY IF STALE
            // console.log(`[Aggregator] 🔄 Sector stale. Fetching live data...`);
            fetchCount++;
            await ingestSector(point);
        }
        
        console.log(`[Aggregator] ✅ Scan Complete. Fetched: ${fetchCount} | Cached: ${cacheCount}`);

    } catch (e) {
        console.error("[Aggregator] Critical Error:", e.message);
    } finally {
        client.release();
    }
}

async function ingestSector(point) {
    const { latitude: lat, longitude: lng } = point;
    const SEARCH_RADIUS = 50000; 

    try {
        // 1. Fetch Stations (Parallel)
        const [googleData, ocmData, govData, rapidData] = await Promise.all([
            fetchSafe(googleFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 8000),
            fetchSafe(ocmFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 8000),
            fetchSafe(govFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 2000),
            fetchSafe(rapidFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 5000)
        ]);

        const mergedStations = mergeData(googleData, ocmData, govData, [], rapidData);

        if (mergedStations.length > 0) {
            await saveStations(mergedStations);
            // Link Amenities after fresh fetch
            await linkRestaurantsToStations(lat, lng, db); 
        }

    } catch (e) {
        console.error(`[Sector Error] ${lat},${lng}:`, e.message);
    }
}

async function saveStations(stations) {
    if (stations.length === 0) return;
    
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        let savedCount = 0;

        for (const s of stations) {
             const safePower = parseFloat(s.powerkw) || 0;
             const toPgArray = (arr) => arr && arr.length > 0 ? `{${arr.map(i => `"${(i || '').toString().replace(/"/g, '\\"')}"`).join(',')}}` : '{}';
             
             const sLat = parseFloat(s.lat);
             const sLng = parseFloat(s.lng);
             if (isNaN(sLat) || isNaN(sLng)) continue; 

             const sGeohash = geohash.encode(sLat, sLng, 7);
             const sAddress = s.address || '';

             const result = await client.query(`
                INSERT INTO stationsmaster 
                (id, name, lat, lng, geog, geohash, address, operator, powerkw, connectortypes, trustscore, sources, lastupdatedat)
                VALUES ($1, $2, $3::numeric, $4::numeric, ST_SetSRID(ST_MakePoint($4::numeric, $3::numeric), 4326), $5, $6, $7, $8, $9, $10, $11, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    trustscore = GREATEST(stationsmaster.trustscore, EXCLUDED.trustscore),
                    powerkw = GREATEST(stationsmaster.powerkw, EXCLUDED.powerkw),
                    connectortypes = CASE 
                        WHEN array_length(stationsmaster.connectortypes, 1) IS NULL THEN EXCLUDED.connectortypes
                        ELSE stationsmaster.connectortypes 
                    END,
                    address = COALESCE(NULLIF(EXCLUDED.address, ''), stationsmaster.address),
                    operator = COALESCE(NULLIF(EXCLUDED.operator, 'Google Places'), stationsmaster.operator),
                    geohash = EXCLUDED.geohash,
                    lastupdatedat = NOW()
                RETURNING id;
             `, [
                 s.id, s.name, sLat, sLng, sGeohash, sAddress, s.operator, safePower, 
                 toPgArray(s.connectorTypes), s.trustscore, toPgArray(s.sources)
             ]);
             
             if (result.rowCount > 0) savedCount++;
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ [DB Error] Transaction Failed: ${e.message}`);
    } finally {
        client.release();
    }
}

// Helper: Haversine
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const p = 0.017453292519943295;    
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p)/2 + c(lat1 * p) * c(lat2 * p) * (1 - c((lon2 - lon1) * p))/2;
    return 12742 * Math.asin(Math.sqrt(a)); 
}

function sampleRoutePoints(points, intervalKm) {
    if (!points || points.length === 0) return [];
    const sampled = [points[0]];
    let lastPoint = points[0];
    for (let i = 1; i < points.length; i++) {
        const dist = getDistanceKm(lastPoint.latitude, lastPoint.longitude, points[i].latitude, points[i].longitude);
        if (dist >= intervalKm) {
            sampled.push(points[i]);
            lastPoint = points[i];
        }
    }
    return sampled;
}

module.exports = { processRouteTiles, db };