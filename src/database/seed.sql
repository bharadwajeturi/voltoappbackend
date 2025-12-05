-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Required for UUID generation

-- 2. Create the stations_master table
DROP TABLE IF EXISTS stations_master;

CREATE TABLE stations_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- Slide 4: UUID Support
    name VARCHAR(255) NOT NULL,
    operator VARCHAR(100),
    power_kw INTEGER, 
    trust_score NUMERIC(2, 1) DEFAULT 0.0,
    
    -- Traceability (Slide 4): Know which API provided the data
    data_source VARCHAR(50) DEFAULT 'MANUAL', -- e.g., 'GOVT', 'GOOGLE', 'OPEN_CHARGE', 'MERGED'
    external_id VARCHAR(255), -- ID from the original API (e.g., Google Place ID)
    
    -- Flexibility (Slide 4): Store extra details like connector types
    amenities JSONB DEFAULT '[]', 
    raw_data JSONB DEFAULT '{}', -- Store original API response for debugging

    -- Spatial Data
    geog GEOGRAPHY(POINT, 4326),
    geohash VARCHAR(12) GENERATED ALWAYS AS (ST_GeoHash(geog::geometry, 10)) STORED -- Auto-generated Geohash for Slide 3 logic
);

-- 3. Insert Mock Data (Simulating Phase 1 Data Merge)
-- These represent "Super Cards" (Slide 3) that would result from your aggregation worker.

INSERT INTO stations_master (name, operator, power_kw, trust_score, amenities, data_source, geog)
VALUES 
    (
        'Charminar Fast Charge', 
        'Tata Power', 
        50, 
        4.5, 
        '["Cafe", "Restroom", "Shopping"]', 
        'GOVT_MERGE', -- Example of a merged data point
        ST_SetSRID(ST_MakePoint(78.4747, 17.3616), 4326)
    ),
    (
        'Gachibowli Green Hub', 
        'Zeon Charging', 
        150, 
        4.8, 
        '["Wifi", "Restaurant", "Lounge"]', 
        'CHARGE_API',
        ST_SetSRID(ST_MakePoint(78.3725, 17.4401), 4326)
    ),
    (
        'Banjara Hills EV Stop', 
        'Fortum', 
        60, 
        4.2, 
        '["Coffee", "Park"]', 
        'GOOGLE_PLACES',
        ST_SetSRID(ST_MakePoint(78.4485, 17.4132), 4326)
    ),
    (
        'Hitech City Supercharger', 
        'Tesla (Mock)', 
        250, 
        5.0, 
        '["Mall", "Cinema", "Food Court"]', 
        'MANUAL',
        ST_SetSRID(ST_MakePoint(78.3802, 17.4483), 4326)
    ),
    (
        'Secunderabad Junction Point', 
        'Statiq', 
        30, 
        3.9, 
        '["Restroom", "ATM"]', 
        'GOVT_API',
        ST_SetSRID(ST_MakePoint(78.5000, 17.4399), 4326)
    ),
    (
        'Jubilee Hills Checkpost', 
        'Ather Grid', 
        22, 
        4.6, 
        '["Cafe", "Gym", "Wifi"]', 
        'GOOGLE_PLACES',
        ST_SetSRID(ST_MakePoint(78.4111, 17.4265), 4326)
    ),
    (
        'RGIA Airport Zone', 
        'Relux Electric', 
        120, 
        4.7, 
        '["Lounge", "24/7 Access", "Restroom"]', 
        'CHARGE_API',
        ST_SetSRID(ST_MakePoint(78.4294, 17.2403), 4326)
    ),
    (
        'Kukatpally Metro Station', 
        'Tata Power', 
        25, 
        4.1, 
        '["Snacks", "Metro Access"]', 
        'GOVT_API',
        ST_SetSRID(ST_MakePoint(78.3990, 17.4933), 4326)
    );

-- 4. Create Indices for Performance (Slide 4: "Speed")
CREATE INDEX stations_geog_idx ON stations_master USING GIST (geog);
CREATE INDEX stations_geohash_idx ON stations_master (geohash); -- Fast lookups for your merge logic