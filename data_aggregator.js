/**
 * VOLTPATH BACKEND - DATA AGGREGATOR ENGINE
 */

const { Pool } = require('pg'); 
const dotenv = require('dotenv');
const geohash = require('geohash'); 
const mergeData = require('./src/merger/engine');
const axios = require('axios'); // Ensure axios is imported

dotenv.config();

const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'voltpath_db',
    password: process.env.DB_PASSWORD || 'password123',
    port: process.env.DB_PORT || 5432,
    max: 10, 
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

// Ensure these paths match where you placed the files
const googleFetcher = require('./src/fetchers/googleFetcher'); 
const ocmFetcher = require('./src/fetchers/ocmFetcher');
const govFetcher = require('./src/fetchers/govFetcher');
const osmFetcher = require('./src/fetchers/osmFetcher');

const db = new Pool(dbConfig);

function normalizeStation(rawData, source) {
    const lat = parseFloat(rawData.lat);
    const lng = parseFloat(rawData.lng);

    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;

    let geohashValue;
    try {
        geohashValue = geohash.encode(lat, lng, 9);
    } catch (err) {
        return null;
    }

    return {
        id: `${source}-${geohashValue}`,
        geohash: geohashValue,
        name: rawData.name || 'Unknown Station',
        lat: lat,
        lng: lng,
        operator: rawData.operator || source,
        powerkw: rawData.power_kw || 0, // Mapped to DB column powerkw
        connectortypes: rawData.charger_type || 'Unknown', // Mapped to connectortypes
        address: rawData.address || 'N/A',
        source: source,
        amenities: rawData.amenities || {}
    };
}

 // --- HELPER: Delay function (Required for Google Next Page Token) ---
// Google requires a short delay (2 sec) before the next_page_token becomes valid
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchGoogleRawWithPagination(lat, lng, radius) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    let allResults = [];
    let nextPageToken = null;
    
    // Initial URL
    let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=point_of_interest&keyword=EV%20Charging%20Station&key=${apiKey}`;

    do {
        if (nextPageToken) {
            // ⚠️ CRITICAL: Google requires a 2-second delay before the token is valid
            await new Promise(resolve => setTimeout(resolve, 2000));
            url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${apiKey}`;
        }

        try {
            const response = await axios.get(url);
            const data = response.data;
            
            if (data.results && data.results.length > 0) {
                allResults = [...allResults, ...data.results];
            }

            // Check if there is another page
            nextPageToken = data.next_page_token;

        } catch (err) {
            console.error('[Google Loop] Error:', err.message);
            break; 
        }
    } while (nextPageToken);

    return allResults;
}

async function fetchAndSaveExternalData(startLat, startLng, endLat, endLng) {
    console.log(`[Data Engine] 🌐 Checking for external updates...`);
    //let externalData = []; // Call APIs here in prod
    //let mockGovData = [];
   // const mergedResults = mergeData([], [], mockGovData, []);
    console.log(`Dataaggregator📍 Region: (${startLat},${startLng}) to (${endLat},${endLng})`);
    console.log('[Data Engine] 🔑 Checking Keys:', {
        Google: process.env.GOOGLE_MAPS_API_KEY ? '✅ Present' : '❌ Missing',
        OCM: process.env.OCM_API_KEY ? '✅ Present' : '❌ Missing',
        Gov: process.env.GOV_API_KEY ? '✅ Present' : '❌ Missing'
    });

    const searchRadius = 50000; // 60km
    try {
        const [googleData, ocmData, govData] = await Promise.all([

            // Google: Used custom paginated fetcher to get ALL results (Page 1, 2, 3)
            fetchGoogleRawWithPagination(startLat, startLng, searchRadius),

            // Google Fetcher
            googleFetcher.fetchStations(startLat, startLng, searchRadius)
                .catch(err => { console.error('❌ Google API Failed:', err.message); return []; }),
            
            // OCM Fetcher
            ocmFetcher.fetchStations(startLat, startLng, searchRadius)
                .catch(err => { console.error('❌ OCM API Failed:', err.message); return []; }),

            // Gov Fetcher
            govFetcher.fetchStations(startLat, startLng, searchRadius)
                .catch(err => { console.error('❌ Gov API Failed:', err.message); return []; })
        ]);

        console.log(`\n[Data Engine] 📥 RAW DATA RECEIVED:`);
        console.log(`   - Google: ${googleData.length}`);
        console.log(`   - OCM:    ${ocmData.length}`);
        console.log(`   - Gov:    ${govData.length}`);

        // 4. MERGE DATA
        // Pass the REAL data arrays to the merger
        const mergedResults = mergeData(googleData, ocmData, govData, []);

        // 5. NORMALIZE FOR DB
        const dbStations = mergedResults.map(s => ({
            id: s.id,
            geohash: s.geohash,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            address: s.address || '',
            operator: s.operator || '',
            powerkw: s.powerkw || 0,
            connectortypes: JSON.stringify(s.connectorTypes || []),
            trustscore: s.trustscore || 50,
            sources: s.sources,
            amenities: s.amenities || [],
            externalIds: s.externalIds,
            rawData: s.rawData
        }));
        
        console.log(`[Data Engine] 🌐 Fetched and normalized ${dbStations.length} external stations.`)  ;
        if (dbStations.length > 0) {
            await saveToDatabase(dbStations); 
        console.log(`[Data Engine] ✅ Database Update Complete.`);
            } else {
                console.warn(`[Data Engine] ⚠️ No stations to save.`);
              } 
    } catch (error) {
        console.error('[Data Engine] ❌ Critical Fetch Error:', error);
    }
}

const toPgArray = (input) => {
    // 1. Handle null/undefined
    if (!input) return '{}';
    
    // 2. Force into array if it's a single item (string/number)
    const arr = Array.isArray(input) ? input : [input];
    
    // 3. Handle empty array
    if (arr.length === 0) return '{}'; 

    // 4. Map and Escape
    const items = arr.map(item => {
        if (item === null || item === undefined) return 'NULL';
        return `"${item.toString().replace(/"/g, '\\"')}"`;
    });
    
    return `{${items.join(',')}}`;
};

async function saveToDatabase(finalStations) {
    if (finalStations.length === 0) return;

    // 🔴 FIX: Updated INSERT to match 'stationsmaster' schema
    const INSERT_QUERY = `
        INSERT INTO stationsmaster (
            id, geohash, name, lat, lng, 
            geog, address, operator, powerkw, 
            connectortypes, trustscore, sources, amenities, lastupdatedat
        )
        VALUES (
            $1, $2, $3, $4::numeric, $5::numeric,
            ST_SetSRID(ST_MakePoint($5::numeric, $4::numeric), 4326), $6, $7, $8, 
            $9, $10, $11, $12, NOW()
        )
        ON CONFLICT (id) DO NOTHING;
    `;

    for (const station of finalStations) {
        try {
            await db.query(INSERT_QUERY, [
                station.id,
                station.geohash,
                station.name,
                station.lat, 
                station.lng,
                // $6 starts here (address)
                station.address,
                station.operator,
                station.powerkw,
                toPgArray(station.connectortypes || []),
                station.trustscore || 50, // Default trustscore
                toPgArray(station.sources || []), // sources
                toPgArray(station.amenities || [])
            ]);
        } catch (error) {
            console.error(`[Data Engine] DB Save Error (${station.name}):`, error.message);
        }
    }
}

module.exports = {
    fetchAndSaveExternalData,
    db 
};