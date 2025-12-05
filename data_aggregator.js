/**
 * VOLTPATH BACKEND - PHASE 1: DATA AGGREGATION WORKER
 * * This script is the core of the "reliability" goal. It simulates fetching data 
 * from multiple sources (APIs), normalizing it, de-duplicating it using 
 * Geohashing, and saving the merged "Golden Record" to the PostgreSQL DB.
 * * NOTE: For security, API keys and DB credentials must be stored in a .env file.
 */

// --- 1. SETUP & IMPORTS ---
const { Client } = require('pg');
const axios = require('axios');
const dotenv = require('dotenv');
const geohash = require('geohash');

// Load environment variables from .env file
dotenv.config();

// --- 2. CONFIGURATION (Placeholder Values) ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'YOUR_GOOGLE_API_KEY';
const CHARGE_API_KEY = process.env.CHARGE_API_KEY || 'YOUR_CHARGE_API_KEY';
const GOV_API_KEY    = process.env.GOV_API_KEY    || 'YOUR_GOV_API_KEY';

// Database connection details (using environment variables)
const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'voltpath_db',
    password: process.env.DB_PASSWORD || 'password123', // Your installed password
    port: process.env.DB_PORT || 5432,
};

// Initialize DB Client
const db = new Client(dbConfig);

// --- 3. CORE LOGIC FUNCTIONS ---

/**
 * Creates the necessary 'stations_master' table with PostGIS geometry.
 */
async function setupDatabase() {
    console.log("-> Checking Database Schema...");
    const CREATE_TABLE_QUERY = `
        CREATE TABLE IF NOT EXISTS stations_master (
            id TEXT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            geog GEOGRAPHY(Point, 4326) NOT NULL,
            address TEXT,
            operator VARCHAR(50),
            power_kw INT,
            charger_type VARCHAR(50),
            trust_score INT,
            source_apis JSONB,
            amenities JSONB,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `;
    await db.query(CREATE_TABLE_QUERY);
    console.log("-> Database setup complete.");
}

/**
 * Normalizes an incoming station object into our standardized schema.
 * @param {object} rawData - Data from any external API.
 * @param {string} source - 'google', 'gov', or 'charge'.
 * @returns {object} - Standardized VoltPath station object.
 */
function normalizeStation(rawData, source) {
    // This function must be highly detailed for real project.
    // Simulating normalization using a static template:
    const lat = rawData.lat || 0;
    const lng = rawData.lng || 0;
    const geohashValue = geohash.encode(lat, lng, 9); // Geohash precision of ~5m

    return {
        // Unique ID based on Geohash and source
        id: `${source}-${geohashValue}`,
        geohash: geohashValue,
        name: rawData.name || 'Unknown Station',
        lat: lat,
        lng: lng,
        operator: rawData.operator || source,
        power_kw: rawData.power_kw || 0,
        charger_type: rawData.charger_type || 'Unknown',
        address: rawData.address || 'N/A',
        source: source,
    };
}

/**
 * Simulated fetch from external APIs. In production, this uses axios.
 * This simulates data for Hyderabad area.
 */
async function fetchAllData() {
    console.log("-> Fetching data from external sources (Simulated).");
    
    // Simulate GOV API data (High Trust, Specific Specs)
    const govData = [{
        name: 'TSSPDCL EV Charging Station', lat: 17.41202, lng: 78.45082, operator: 'TSSPDCL', power_kw: 60, charger_type: 'DC', address: 'Road No 1, Banjara Hills',
    }];
    
    // Simulate CHARGE API data (Mid Trust, Availability)
    const chargeData = [{
        name: 'TSSPDCL EV Charging Station (Banjara)', lat: 17.41200, lng: 78.45080, operator: 'TSSPDCL', power_kw: 60, charger_type: 'DC', address: 'Road No 1, Banjara Hills',
    }, {
        name: 'Zeon Hub - Gachibowli', lat: 17.44265, lng: 78.37500, operator: 'Zeon', power_kw: 50, charger_type: 'DC Fast', address: 'Near Wipro Circle',
    }];

    // Simulate GOOGLE API data (Low Trust, Rich Amenity Data)
    const googleData = [{
        name: 'EV Station near Banjara Hills', lat: 17.41205, lng: 78.45085, operator: 'Unknown', power_kw: 0, charger_type: 'Type 2', address: 'Road No 1, Banjara Hills, Next to Hotel', amenities: { rating: 4.5, food: 'Vivanta Grill' }
    }, {
        name: 'Starbucks Charger', lat: 17.44270, lng: 78.37510, operator: 'Starbucks', power_kw: 7, charger_type: 'AC Slow', address: 'Gachibowli High Street', amenities: { rating: 4.8, food: 'Cafe', restroom: 'clean' }
    }];

    let normalizedData = [];
    govData.forEach(d => normalizedData.push(normalizeStation(d, 'gov')));
    chargeData.forEach(d => normalizedData.push(normalizeStation(d, 'charge')));
    googleData.forEach(d => normalizedData.push(normalizeStation(d, 'google')));

    return normalizedData;
}


/**
 * PHASE 1 CORE: Handles the de-duplication and merging of data.
 * @param {Array} stations - Array of normalized station objects.
 * @returns {Array} - Array of final merged station objects.
 */
function mergeStations(stations) {
    const mergedMap = new Map();

    stations.forEach(station => {
        // Use geohash as the key for identifying duplicates (~5m precision)
        const key = station.geohash;

        if (!mergedMap.has(key)) {
            // First time seeing this location: initialize the merged record
            mergedMap.set(key, {
                ...station,
                source_apis: [station.source],
                trust_score: (station.source === 'gov' ? 50 : 30), // Initial score
            });
        } else {
            // Duplicate found: perform the merge/priority logic
            let existing = mergedMap.get(key);

            // 1. Prioritize technical specs from Gov/Charge APIs
            if (station.power_kw > existing.power_kw) {
                existing.power_kw = station.power_kw;
                existing.charger_type = station.charger_type;
            }

            // 2. Aggregate sources and increase score
            if (!existing.source_apis.includes(station.source)) {
                existing.source_apis.push(station.source);
                existing.trust_score += 20; // Bonus for multi-source verification
            }

            // 3. Keep richer amenity data (usually from Google)
            if (station.amenities && !existing.amenities) {
                 existing.amenities = station.amenities;
            }

            // Update the map with the refined record
            mergedMap.set(key, existing);
        }
    });
    
    // Convert Map values back to an array
    return Array.from(mergedMap.values());
}


/**
 * Inserts the final merged data into the PostgreSQL table.
 */
async function saveToDatabase(finalStations) {
    console.log(`-> Saving ${finalStations.length} merged records to PostGIS.`);
    const INSERT_QUERY = `
        INSERT INTO stations_master (id, name, geog, address, operator, power_kw, charger_type, trust_score, source_apis, amenities, last_updated)
        VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            geog = EXCLUDED.geog,
            power_kw = EXCLUDED.power_kw,
            charger_type = EXCLUDED.charger_type,
            trust_score = EXCLUDED.trust_score,
            source_apis = EXCLUDED.source_apis,
            amenities = EXCLUDED.amenities,
            last_updated = NOW();
    `;

    for (const station of finalStations) {
        try {
            await db.query(INSERT_QUERY, [
                station.geohash, // Using geohash as unique ID
                station.name,
                station.lng, 
                station.lat, 
                station.address,
                station.operator,
                station.power_kw,
                station.charger_type,
                station.trust_score,
                JSON.stringify(station.source_apis),
                JSON.stringify(station.amenities || {})
            ]);
        } catch (error) {
            console.error(`Error saving station ${station.name}:`, error.message);
        }
    }
    console.log("-> Data synchronization complete.");
}


// --- 4. MAIN EXECUTION FLOW ---
async function runAggregation() {
    try {
        console.log("--- Starting VoltPath Aggregation Engine ---");
        await db.connect();
        await setupDatabase();

        // 1. Fetch data from all sources (Simulated)
        const rawStations = await fetchAllData();
        console.log(`-> Fetched ${rawStations.length} raw records.`);
        
        // 2. Run the core merge logic
        const finalStations = mergeStations(rawStations);
        console.log(`-> Merged into ${finalStations.length} unique records (Golden Records).`);

        // 3. Save to PostGIS Database
        await saveToDatabase(finalStations);

    } catch (error) {
        console.error("CRITICAL ERROR during aggregation:", error.message);
    } finally {
        await db.end();
        console.log("--- Aggregation Engine Finished ---");
    }
}

// To run this, the developer must first create a .env file with DB details.
runAggregation();