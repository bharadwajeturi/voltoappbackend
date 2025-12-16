/**
 * VOLTPATH BACKEND - DATA AGGREGATOR
 * STATUS: OPTIMIZED (Dynamic Resolution + Cost Control + Smart Amenities)
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
const amenityFetcher = require('./src/fetchers/amenityFetcher');
const { linkAmenitiesToStations } = require('./src/utils/proximity'); 

dotenv.config();

// Database Configuration
const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'voltpath_db',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    max: 50, 
    idleTimeoutMillis: 30000,
};

const db = new Pool(dbConfig);

// Constants
const TILE_PRECISION = 5;       // ~5km radius tiles
const CACHE_VALIDITY_DAYS = 7;  // Refresh data weekly
const BATCH_SIZE = 8;           // Parallel tile processing limit

// Helper: Safe Fetch with Timeout
const fetchSafe = (promise, ms) => 
    Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve([]), ms)) 
    ]).catch(e => []);

// Helper: Haversine Distance (km)
function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 🟢 SMART FILTER: Skips tiles based on dynamic distance (skipKm)
function filterRedundantTiles(tiles, skipKm) {
    const unique = [];
    
    for (const tile of tiles) {
        const { latitude: lat, longitude: lon } = geohash.decode(tile);
        
        // Check if this tile is too close (< skipKm) to any tile we've already accepted
        const isRedundant = unique.some(acceptedTile => {
            const { latitude: aLat, longitude: aLon } = geohash.decode(acceptedTile);
            const dist = getDistanceKm(lat, lon, aLat, aLon);
            return dist < skipKm;
        });

        if (!isRedundant) {
            unique.push(tile);
        }
    }
    return unique;
}

/**
 * Main Orchestrator Function
 * @param {Array} points - List of lat/lng points along the route
 * @param {number} skipKm - Resolution (e.g. 3km for city, 15km for highway)
 */
async function processRouteTiles(points, skipKm = 3) {
    if (!points || points.length === 0) return;

    // 1. Generate Raw Geohashes from Route Points
    const rawTiles = new Set();
    points.forEach(p => {
        try {
            const hash = geohash.encode(p.latitude, p.longitude, TILE_PRECISION);
            rawTiles.add(hash);
        } catch (e) {}
    });
    
    const allTiles = Array.from(rawTiles);

    // 2. Apply Dynamic Skip Logic (Reduces scanning load)
    const optimizedTiles = filterRedundantTiles(allTiles, skipKm);
    
    console.log(`[Orchestrator] Optimized: Reduced ${allTiles.length} raw tiles to ${optimizedTiles.length} distinct scans (Resolution: ${skipKm}km).`);

    // 3. Filter Stale Tiles (Don't re-fetch if we have recent data)
    const staleTiles = await filterStaleTiles(optimizedTiles);

    if (staleTiles.length === 0) {
        console.log(`[Orchestrator] ✅ All tiles fresh.`);
        return;
    }

    console.log(`[Orchestrator] 🚀 Updating ${staleTiles.length} tiles in batches of ${BATCH_SIZE}...`);

    // 4. Process Batch by Batch
    for (let i = 0; i < staleTiles.length; i += BATCH_SIZE) {
        const batch = staleTiles.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(tileId => ingestTile(tileId)));
    }
    console.log(`[Orchestrator] ✅ Ingestion complete.`);
}

// Helper: Check DB for existing valid tiles
async function filterStaleTiles(allTiles) {
    if (allTiles.length === 0) return [];
    const query = `SELECT tile_id FROM tile_cache WHERE tile_id = ANY($1) AND (status = 'success' AND last_fetched > NOW() - INTERVAL '${CACHE_VALIDITY_DAYS} days')`;
    try {
        const res = await db.query(query, [allTiles]);
        const freshTiles = new Set(res.rows.map(r => r.tile_id));
        return allTiles.filter(t => !freshTiles.has(t));
    } catch (e) { return allTiles; }
}

// 🔵 WORKER: Process a Single Tile
async function ingestTile(tileId) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // Advisory Lock to prevent duplicate processing
        const lockRes = await client.query(`SELECT pg_try_advisory_xact_lock(hashtext($1)) as locked`, [tileId]);
        if (!lockRes.rows[0].locked) { await client.query('ROLLBACK'); return; }

        const { latitude: lat, longitude: lng } = geohash.decode(tileId);
        const searchRadius = 5000; 

        // 🟢 STEP 1: Fetch Stations (Parallel)
        // Note: Google Fetcher is disabled to save costs. Uncomment if budget allows.
        const [ocmData, govData, rapidData] = await Promise.all([
            fetchSafe(ocmFetcher.fetchStations(lat, lng, searchRadius), 8000),
            fetchSafe(govFetcher.fetchStations(lat, lng, searchRadius), 2000),
            // fetchSafe(googleFetcher.fetchStations(lat, lng, searchRadius), 8000), // 💰 UNCOMMENT TO ENABLE GOOGLE ($$$)
            fetchSafe(rapidFetcher.fetchStations(lat, lng, searchRadius), 8000)
        ]);

        // Merge Results (Google passed as empty array [])
        let mergedStations = mergeData([], ocmData, govData, [], rapidData);

        // 🟢 STEP 2: Conditional Amenity Fetching
        // Only fetch amenities if we actually found chargers. Saves OSM quota.
        if (mergedStations.length > 0) {
            // console.log(`[Aggregator] Found ${mergedStations.length} stations. Fetching amenities...`);
            
            // 4s Timeout for OSM
            const amenityResult = await fetchSafe(amenityFetcher(lat, lng, searchRadius), 4000);
            
            if (amenityResult.amenities?.length > 0) {
                mergedStations = linkAmenitiesToStations(mergedStations, amenityResult.amenities);
            }
        } else {
            // console.log(`[Aggregator] No stations found in tile. Skipping amenity fetch.`);
        }

        // 🟢 STEP 3: Save to Database
        await saveStationsTransactional(client, mergedStations);
        
        // Update Cache Status
        await client.query(`INSERT INTO tile_cache (tile_id, last_fetched, status) VALUES ($1, NOW(), 'success') ON CONFLICT (tile_id) DO UPDATE SET last_fetched = NOW(), status = 'success'`, [tileId]);
        await client.query('COMMIT');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[Ingest] ❌ Error tile ${tileId}:`, e.message);
    } finally { client.release(); }
}

// Helper: Convert array to PostgreSQL text array format
const toPgArray = (arr) => arr && arr.length > 0 ? `{${arr.map(i => `"${(i || '').toString().replace(/"/g, '\\"')}"`).join(',')}}` : '{}';

// Transactional Save
async function saveStationsTransactional(client, stations) {
    if (stations.length === 0) return;
    for (const s of stations) {
        const safePower = isNaN(parseFloat(s.powerkw)) ? 0 : parseFloat(s.powerkw);

        // Upsert Station
        await client.query(`
            INSERT INTO stationsmaster (id, geohash, name, lat, lng, geog, address, operator, powerkw, connectortypes, trustscore, sources, lastupdatedat) 
            VALUES ($1, $2, $3, $4::numeric, $5::numeric, ST_SetSRID(ST_MakePoint($5::numeric, $4::numeric), 4326), $6, $7, $8, $9, $10, $11, NOW())
            ON CONFLICT (id) DO UPDATE SET trustscore = GREATEST($10, stationsmaster.trustscore), powerkw = GREATEST($8, stationsmaster.powerkw), lastupdatedat = NOW()
        `, [s.id, s.geohash, s.name, parseFloat(s.lat), parseFloat(s.lng), s.address, s.operator, safePower, toPgArray(s.connectorTypes), s.trustscore, toPgArray(s.sources)]);
        
        // Save Amenities (if linked)
        if (s.nearby_amenities) {
            for (const am of s.nearby_amenities) {
                await client.query(`INSERT INTO station_amenities (station_id, name, amenity_type, distance_m) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [s.id, am.name, (am.type || 'unknown').toLowerCase(), am.distance_meters || 0]);
            }
        }
    }
}

module.exports = { processRouteTiles, db };