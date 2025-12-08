const { Client } = require('pg');
const config = require('./src/config/configuration'); // Adjust path if needed

const db = new Client(config.db);

async function resetDatabase() {
    try {
        await db.connect();
        console.log("🔥 Connected to DB. Starting Reset...");

        // 1. Drop the old table
        await db.query(`DROP TABLE IF EXISTS stations_master;`);
        console.log("✅ Dropped old 'stations_master' table.");

        // 2. Recreate it with the correct schema (including 'sources' and 'address')
        await db.query(`
            CREATE TABLE stations_master (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                geog GEOGRAPHY(Point, 4326),
                operator TEXT,
                power_kw NUMERIC,
                trust_score INT,
                sources JSONB DEFAULT '[]',   
                address TEXT,                 
                amenities JSONB DEFAULT '[]', 
                last_updated TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log("✅ Created new 'stations_master' table.");

        // 3. Recreate the index
        await db.query(`CREATE INDEX stations_geog_idx ON stations_master USING GIST (geog);`);
        console.log("✅ Created spatial index.");

    } catch (err) {
        console.error("❌ Error resetting DB:", err);
    } finally {
        await db.end();
        console.log("🏁 Database Reset Complete.");
    }
}

resetDatabase();