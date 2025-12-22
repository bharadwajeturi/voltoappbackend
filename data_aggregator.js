/**
 * VOLTPATH AGGREGATOR (v6.3 - Final Stable)
 * Strategy: 
 * - Check DB first (Freshness = 7 Days).
 * - Scan Corridor every 50km.
 * - Saves Context (Mall, Hotel) to DB.
 * - Handles 'Unknown' overwrites smartly.
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
async function isSectorFresh(lat, lng, client) {
    try {
        const result = await client.query(`
            SELECT count(*) as count 
            FROM stationsmaster 
            WHERE ST_DWithin(geog, ST_MakePoint($1, $2)::geography, 50000)
            AND lastupdatedat > NOW() - INTERVAL '7 days'
        `, [lng, lat]); 

        const count = parseInt(result.rows[0].count);
        return count >= 5; 
    } catch (e) {
        console.warn(`[Cache Check Failed] ${e.message}`);
        return false; 
    }
}

async function processRouteTiles(points) {
    if (!points || points.length === 0) return;

    const targets = sampleRoutePoints(points, 50);
    console.log(`[Aggregator] 🎯 Analyzing ${targets.length} sectors (7-Day Cache Rule)...`);

    const client = await db.connect();
    
    try {
        let fetchCount = 0;
        let cacheCount = 0;

        for (const point of targets) {
            const fresh = await isSectorFresh(point.latitude, point.longitude, client);
            if (fresh) {
                cacheCount++;
                continue; 
            }
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
        const [googleData, ocmData, govData, rapidData] = await Promise.all([
            fetchSafe(googleFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 8000),
            fetchSafe(ocmFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 8000),
            fetchSafe(govFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 2000),
            fetchSafe(rapidFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 5000)
        ]);

        const mergedStations = mergeData(googleData, ocmData, govData, [], rapidData);

        if (mergedStations.length > 0) {
            await saveStations(mergedStations);
            await linkRestaurantsToStations(lat, lng, db); 
            console.log(`[Sector] 🌐 ${lat.toFixed(2)},${lng.toFixed(2)} - Saved ${mergedStations.length} stations.`);
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
             // 🟢 FIX: Ensure 'Unknown' isn't hardcoded if we have real data
             const connectors = (s.connectorTypes && s.connectorTypes.length > 0) ? s.connectorTypes : ['Unknown'];
             const toPgArray = (arr) => arr && arr.length > 0 ? `{${arr.map(i => `"${(i || '').toString().replace(/"/g, '\\"')}"`).join(',')}}` : '{}';
             
             const sLat = parseFloat(s.lat);
             const sLng = parseFloat(s.lng);
             if (isNaN(sLat) || isNaN(sLng)) continue; 

             const sGeohash = geohash.encode(sLat, sLng, 7);
             
             // 🟢 FIX: Robust Address Fallback
             let sAddress = s.address;
             if (!sAddress || sAddress === 'Address Unavailable' || sAddress.trim() === '') {
                 sAddress = `${s.name}, ${sLat.toFixed(4)}, ${sLng.toFixed(4)}`;
             }

             // 🟢 DEBUG LOG: Verify Context
             const contextTags = (s.amenities || []).filter(t => ['shopping_mall', 'hotel', 'lodging', 'restaurant', 'parking'].includes(t));
             if (contextTags.length > 0 && Math.random() > 0.9) {
                 console.log(`   📍 Context Found: ${s.name} is at [${contextTags.join(', ')}]`);
             }

             const result = await client.query(`
                INSERT INTO stationsmaster 
                (id, name, lat, lng, geog, geohash, address, operator, powerkw, connectortypes, trustscore, sources, amenities, lastupdatedat)
                VALUES ($1, $2, $3::numeric, $4::numeric, ST_SetSRID(ST_MakePoint($4::numeric, $3::numeric), 4326), $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    trustscore = GREATEST(stationsmaster.trustscore, EXCLUDED.trustscore),
                    powerkw = GREATEST(stationsmaster.powerkw, EXCLUDED.powerkw),
                    connectortypes = CASE 
                        WHEN array_length(stationsmaster.connectortypes, 1) IS NULL OR stationsmaster.connectortypes = '{Unknown}' 
                        THEN EXCLUDED.connectortypes
                        ELSE stationsmaster.connectortypes 
                    END,
                    amenities = CASE
                        WHEN array_length(stationsmaster.amenities, 1) IS NULL THEN EXCLUDED.amenities
                        ELSE stationsmaster.amenities
                    END,
                    address = COALESCE(NULLIF(EXCLUDED.address, ''), NULLIF(EXCLUDED.address, 'Address Unavailable'), stationsmaster.address),
                    operator = COALESCE(NULLIF(EXCLUDED.operator, 'Google Places'), stationsmaster.operator),
                    geohash = EXCLUDED.geohash,
                    lastupdatedat = NOW()
                RETURNING id;
             `, [
                 s.id, s.name, sLat, sLng, sGeohash, sAddress, s.operator, safePower, 
                 toPgArray(connectors), s.trustscore, toPgArray(s.sources), toPgArray(s.amenities)
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