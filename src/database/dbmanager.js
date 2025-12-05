const { Client } = require('pg');
const config = require('../config/configuration');

const db = new Client(config.db);

async function connectDB() {
    await db.connect();
    console.log("   🗄️  [DB] Connected to PostgreSQL");
}

async function setupTables() {
    // 1. Stations Table (Updated with 'amenities' column for linked data)
    await db.query(`
        CREATE TABLE IF NOT EXISTS stations_master (
            id TEXT PRIMARY KEY,
            name TEXT,
            geog GEOGRAPHY(Point, 4326),
            operator TEXT,
            power_kw NUMERIC,
            trust_score INT,
            sources JSONB,
            address TEXT,
            amenities JSONB, 
            last_updated TIMESTAMP DEFAULT NOW()
        );
    `);

    // 2. Amenities Table (NEW - For standalone Restaurants/Restrooms)
    await db.query(`
        CREATE TABLE IF NOT EXISTS amenities_master (
            id TEXT PRIMARY KEY,
            name TEXT,
            geog GEOGRAPHY(Point, 4326),
            type TEXT,
            rating NUMERIC,
            address TEXT,
            last_updated TIMESTAMP DEFAULT NOW()
        );
    `);
}

async function saveStations(stations) {
    console.log(`   💾 [DB] Saving ${stations.length} Stations...`);
    let count = 0;
    
    for (const s of stations) {
        // Now includes 'amenities' column ($9)
        const query = `
            INSERT INTO stations_master (id, name, geog, operator, power_kw, trust_score, sources, address, amenities, last_updated)
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (id) DO UPDATE SET
                trust_score = EXCLUDED.trust_score,
                sources = EXCLUDED.sources,
                amenities = EXCLUDED.amenities,
                last_updated = NOW();
        `;
        
        // Ensure amenities is a valid JSON object string. 
        // We check for 'nearby_amenities' (from proximity logic) OR 'amenities' (from merge logic)
        const amenityJson = JSON.stringify(s.nearby_amenities || s.amenities || []);
        const sourcesJson = JSON.stringify(s.sources || []);
        
        // Params: id, name, lng, lat, operator, power, score, sources, address, amenities
        const values = [s.id, s.name, s.lng, s.lat, s.operator, s.power_kw, s.trust_score, sourcesJson, s.address, amenityJson];
        
        try {
            await db.query(query, values);
            count++;
        } catch (e) { 
            console.error(`      ⚠️ Failed Station: ${s.name} - ${e.message}`); 
        }
    }
    console.log(`      ✅ Saved ${count} Stations.`);
}

async function saveAmenities(amenities) {
    console.log(`   💾 [DB] Saving ${amenities.length} Amenities...`);
    let count = 0;
    
    for (const a of amenities) {
        const query = `
            INSERT INTO amenities_master (id, name, geog, type, rating, address, last_updated)
            VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, NOW())
            ON CONFLICT (id) DO UPDATE SET rating = EXCLUDED.rating, last_updated = NOW();
        `;
        try {
            await db.query(query, [a.id, a.name, a.lng, a.lat, a.type, a.rating, a.address]);
            count++;
        } catch (e) { 
            console.error(`      ⚠️ Failed Amenity: ${a.name} - ${e.message}`); 
        }
    }
    console.log(`      ✅ Saved ${count} Amenities.`);
}

async function closeDB() { 
    await db.end(); 
}

module.exports = { connectDB, setupTables, saveStations, saveAmenities, closeDB };