/**
 * VOLTPATH AGGREGATOR (v6.6 - Safe Logging & Stability)
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

// 🟢 NEW: Logging System (Import SystemLogger safely)
const { systemLogger, logCost } = require('./src/utils/logger'); 

dotenv.config();

// Create Database Pool
const db = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20
});

// Helper for timeouts to prevent one API from hanging the whole batch
const fetchSafe = (promise, ms) => Promise.race([
    promise, 
    new Promise(r => setTimeout(() => r([]), ms))
]).catch(() => []);

// --- 🟢 SMART CACHE CHECK (7 Days) ---
async function isSectorFresh(lat, lng, client) {
    if (typeof systemLogger !== 'undefined' && systemLogger) {
        systemLogger.debug(`Checking Freshness Sector ${lat},${lng}`, { label: 'AGGREGATOR' });
    }

    try {
        // Query: Do we have > 5 stations in this 50km radius updated recently?
        const result = await client.query(`
            SELECT count(*) as count 
            FROM stationsmaster 
            WHERE ST_DWithin(geog, ST_MakePoint($1, $2)::geography, 50000)
            AND lastupdatedat > NOW() - INTERVAL '7 days'
        `, [lng, lat]); 

        const count = parseInt(result.rows[0].count);
        return count >= 5; 

    } catch (e) {
        const msg = `Cache Check Failed: ${e.message}`;
        if (typeof systemLogger !== 'undefined' && systemLogger) {
            systemLogger.warn(msg, { label: 'AGGREGATOR' });
        } else {
            console.warn(`[AGGREGATOR_FALLBACK] ${msg}`);
        }
        return false; // Fail safe: Assume stale, fetch new data
    }
}

// --- MAIN LOOP ---
async function processRouteTiles(points) {
    if (!points || points.length === 0) return;

    // Sample points every 50km
    const targets = sampleRoutePoints(points, 50);
    
    if (typeof systemLogger !== 'undefined' && systemLogger) {
        systemLogger.info(`Analyzing ${targets.length} sectors (7-Day Cache Rule)...`, { label: 'AGGREGATOR' });
    } else {
        console.log(`[AGGREGATOR] Analyzing ${targets.length} sectors...`);
    }

    const client = await db.connect();
    
    try {
        let fetchCount = 0;
        let cacheCount = 0;

        for (const point of targets) {
            const fresh = await isSectorFresh(point.latitude, point.longitude, client);
            if (fresh) {
                cacheCount++;
                continue; // Skip API calls
            }
            fetchCount++;
            await ingestSector(point);
        }
        
        if (typeof systemLogger !== 'undefined' && systemLogger) {
            systemLogger.info(`Scan Complete. Fetched: ${fetchCount} | Cached: ${cacheCount}`, { label: 'AGGREGATOR' });
        }

    } catch (e) {
        const msg = `Critical Error: ${e.message}`;
        if (typeof systemLogger !== 'undefined' && systemLogger) {
            systemLogger.error(msg, { label: 'AGGREGATOR' });
        } else {
            console.error(`[AGGREGATOR_FALLBACK] ${msg}`);
        }
    } finally {
        client.release();
    }
}

// --- FETCHER ORCHESTRATOR ---
async function ingestSector(point) {
    const { latitude: lat, longitude: lng } = point;
    const SEARCH_RADIUS = 50000; 

    try {
        // Parallel Fetching with Timeouts
        const [googleData, ocmData, govData, rapidData] = await Promise.all([
            fetchSafe(googleFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 8000),
            fetchSafe(ocmFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 8000),
            fetchSafe(govFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 2000),
            fetchSafe(rapidFetcher.fetchStations(lat, lng, SEARCH_RADIUS), 5000)
        ]);

        // Merge Data Logic
        const mergedStations = mergeData(googleData, ocmData, govData, [], rapidData);

        if (mergedStations.length > 0) {
            await saveStations(mergedStations);
            await linkRestaurantsToStations(lat, lng, db); 
            
            if (typeof systemLogger !== 'undefined' && systemLogger) {
                systemLogger.info(`Sector ${lat.toFixed(2)},${lng.toFixed(2)} - Saved ${mergedStations.length} stations.`, { label: 'AGGREGATOR' });
            }
        } else {
            if (typeof systemLogger !== 'undefined' && systemLogger) {
                systemLogger.debug(`Sector ${lat.toFixed(2)},${lng.toFixed(2)} - No stations found.`, { label: 'AGGREGATOR' });
            }
        }

    } catch (e) {
        const msg = `Sector Error ${lat},${lng}: ${e.message}`;
        // 🟢 SAFE LOGGING: Prevents "systemLogger is not defined" crash
        if (typeof systemLogger !== 'undefined' && systemLogger) {
            systemLogger.error(msg, { label: 'AGGREGATOR' });
        } else {
            console.error(`[AGGREGATOR_FALLBACK] ${msg}`);
        }
    }
}

// --- DATABASE SAVER ---
async function saveStations(stations) {
    if (stations.length === 0) return;
    
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        let savedCount = 0;

        for (const s of stations) {
             
             const safePower = parseFloat(s.powerkw) || 0;
             // Ensure 'Unknown' isn't hardcoded if we have real data
             const connectors = (s.connectorTypes && s.connectorTypes.length > 0) ? s.connectorTypes : ['Unknown'];
             
             // Helper for Postgres Arrays
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

             // UPSERT QUERY
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
        const msg = `DB Transaction Failed: ${e.message}`;
        if (typeof systemLogger !== 'undefined' && systemLogger) {
            systemLogger.error(msg, { label: 'DB_WRITE' });
        } else {
            console.error(`[DB_WRITE_FALLBACK] ${msg}`);
        }
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

// Helper: Point Sampling
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