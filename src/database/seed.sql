-- -- ============================================================
-- -- VoltPath Database Schema with Indices for Performance
-- -- ============================================================

-- -- Create PostGIS extension
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- -- ============================================================
-- -- Main Stations Table
-- -- ============================================================

-- CREATE TABLE IF NOT EXISTS stations_master (
--   id VARCHAR(255) PRIMARY KEY,
--   geohash VARCHAR(20) NOT NULL,
--   name VARCHAR(255) NOT NULL,
--   lat DOUBLE PRECISION NOT NULL,
--   lng DOUBLE PRECISION NOT NULL,
--   address TEXT,
--   operator VARCHAR(255),
--   powerkw INTEGER DEFAULT 0,
--   connectortypes TEXT[] DEFAULT ARRAY[]::TEXT[],
--   numberOfPoints INTEGER DEFAULT 1,
--   trustscore INTEGER DEFAULT 50 CHECK (trustscore >= 0 AND trustscore <= 100),
--   sources TEXT[] DEFAULT ARRAY[]::TEXT[],
--   sourcecount INTEGER DEFAULT 1,
--   amenities TEXT[] DEFAULT ARRAY[]::TEXT[],
--   verified BOOLEAN DEFAULT FALSE,
--   verificationcount INTEGER DEFAULT 0,
--   lastverfiedat TIMESTAMP,
--   lastupdatedat TIMESTAMP DEFAULT NOW(),
--   createdat TIMESTAMP DEFAULT NOW(),
--   externalids JSONB DEFAULT '{}'::JSONB,
--   rawdata JSONB[] DEFAULT ARRAY[]::JSONB[],
--   geog GEOGRAPHY(POINT, 4326),
--   UNIQUE(geohash, name)
-- );

-- -- ============================================================
-- -- CRITICAL INDICES FOR PERFORMANCE (RULE #2)
-- -- ============================================================

-- -- 1. Geohash index (for DB-first searches)
-- CREATE INDEX IF NOT EXISTS idx_stations_geohash 
--   ON stations_master (geohash);

-- -- 2. Spatial index (PostGIS) - for ST_DWithin queries
-- CREATE INDEX IF NOT EXISTS idx_stations_geog_gist 
--   ON stations_master USING GIST (geog);

-- -- 3. Source tracking index (for API call logging)
-- CREATE INDEX IF NOT EXISTS idx_stations_sources 
--   ON stations_master USING GIN (sources);

-- -- 4. Trust score index (for filtering verified stations)
-- CREATE INDEX IF NOT EXISTS idx_stations_trustscore 
--   ON stations_master (trustscore DESC);

-- -- 5. Operator index (for brand prioritization)
-- CREATE INDEX IF NOT EXISTS idx_stations_operator 
--   ON stations_master (operator);

-- -- 6. Verified index (for user-verified stations)
-- CREATE INDEX IF NOT EXISTS idx_stations_verified 
--   ON stations_master (verified);

-- -- 7. Last updated index (for 7-day cache expiration)
-- CREATE INDEX IF NOT EXISTS idx_stations_lastupdated 
--   ON stations_master (lastupdatedat DESC);

-- -- 8. Combined index for adaptive search
-- CREATE INDEX IF NOT EXISTS idx_stations_search 
--   ON stations_master (operator, trustscore DESC, powerkw DESC);

-- -- ============================================================
-- -- Data Fetch Log Table (Track API calls - RULE #1)
-- -- ============================================================

-- CREATE TABLE IF NOT EXISTS datafetchlog (
--   id SERIAL PRIMARY KEY,
--   source VARCHAR(50) NOT NULL,
--   lat DOUBLE PRECISION,
--   lng DOUBLE PRECISION,
--   radiusmeters INTEGER,
--   resultcount INTEGER,
--   fetchedtime TIMESTAMP DEFAULT NOW(),
--   responsetime_ms INTEGER,
--   status VARCHAR(20) DEFAULT 'success',
--   errormessage TEXT
-- );

-- -- Indices for fetch logging
-- CREATE INDEX IF NOT EXISTS idx_fetchlog_source 
--   ON datafetchlog (source, fetchedtime DESC);

-- CREATE INDEX IF NOT EXISTS idx_fetchlog_status 
--   ON datafetchlog (status);

-- -- ============================================================
-- -- Verification History Table (Community trust - RULE #5)
-- -- ============================================================

-- CREATE TABLE IF NOT EXISTS verification_history (
--   id SERIAL PRIMARY KEY,
--   stationid VARCHAR(255) NOT NULL REFERENCES stations_master(id) ON DELETE CASCADE,
--   userid VARCHAR(255),
--   verifiedtime TIMESTAMP DEFAULT NOW(),
--   carmodel VARCHAR(255),
--   workingstatus BOOLEAN,
--   comment TEXT,
--   rating INTEGER CHECK (rating >= 1 AND rating <= 5)
-- );

-- CREATE INDEX IF NOT EXISTS idx_verification_station 
--   ON verification_history (stationid);

-- CREATE INDEX IF NOT EXISTS idx_verification_time 
--   ON verification_history (verifiedtime DESC);

-- -- ============================================================
-- -- Route Cache Table (Offline persistence - RULE #6)
-- -- ============================================================

-- CREATE TABLE IF NOT EXISTS route_cache (
--   id SERIAL PRIMARY KEY,
--   userid VARCHAR(255),
--   routejson JSONB NOT NULL,
--   startlat DOUBLE PRECISION,
--   startlng DOUBLE PRECISION,
--   endlat DOUBLE PRECISION,
--   endlng DOUBLE PRECISION,
--   carmodel VARCHAR(255),
--   startsoc INTEGER,
--   targetarrivalsoc INTEGER,
--   createdtime TIMESTAMP DEFAULT NOW(),
--   expirytime TIMESTAMP,
--   offline BOOLEAN DEFAULT TRUE
-- );

-- CREATE INDEX IF NOT EXISTS idx_routecache_user 
--   ON route_cache (userid, createdtime DESC);

-- CREATE INDEX IF NOT EXISTS idx_routecache_expiry 
--   ON route_cache (expirytime);

-- -- ============================================================
-- -- Settings Table
-- -- ============================================================

-- CREATE TABLE IF NOT EXISTS settings (
--   key VARCHAR(255) PRIMARY KEY,
--   value VARCHAR(255),
--   lastupdated TIMESTAMP DEFAULT NOW()
-- );

-- INSERT INTO settings (key, value) VALUES
--   ('api_rate_limit_google', '50'),
--   ('api_rate_limit_ocm', '100'),
--   ('api_rate_limit_gov', '100'),
--   ('cache_expiry_days', '7'),
--   ('adaptive_search_radii', '5000,10000,20000,40000'),
--   ('fuzzy_match_threshold', '0.80'),
--   ('min_trust_score', '50')
-- ON CONFLICT (key) DO UPDATE SET lastupdated = NOW();

-- -- ============================================================
-- -- Grant Permissions (if needed)
-- -- ============================================================

-- GRANT SELECT, INSERT, UPDATE, DELETE ON stations_master TO "postgres";
-- GRANT SELECT, INSERT ON datafetchlog TO "postgres";
-- GRANT SELECT, INSERT ON verification_history TO "postgres";
-- GRANT SELECT, INSERT ON route_cache TO "postgres";
-- GRANT SELECT ON settings TO "postgres";

-- -- ============================================================
-- -- Analytics Views (for debugging & monitoring)
-- -- ============================================================

-- CREATE OR REPLACE VIEW v_station_summary AS
-- SELECT 
--   COUNT(*) as total_stations,
--   COUNT(CASE WHEN verified THEN 1 END) as verified_count,
--   AVG(trustscore) as avg_trust_score,
--   MAX(trustscore) as max_trust_score,
--   MIN(trustscore) as min_trust_score
-- FROM stations_master;

-- CREATE OR REPLACE VIEW v_stations_by_source AS
-- SELECT 
--   UNNEST(sources) as source,
--   COUNT(*) as count,
--   AVG(trustscore) as avg_trust_score
-- FROM stations_master
-- GROUP BY source
-- ORDER BY count DESC;

-- CREATE OR REPLACE VIEW v_fetch_statistics AS
-- SELECT 
--   source,
--   COUNT(*) as total_fetches,
--   AVG(resultcount) as avg_results,
--   AVG(responsetime_ms) as avg_response_ms,
--   COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count
-- FROM datafetchlog
-- WHERE fetchedtime > NOW() - INTERVAL '7 days'
-- GROUP BY source;

-- VoltPath EV Stations Database Schema
-- PostGIS enabled for spatial queries

-- Enable PostGIS extension (run once)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop table if exists (for clean seeding)
DROP TABLE IF EXISTS stationsmaster CASCADE;

-- Main stations table with spatial index
CREATE TABLE stationsmaster (
  id VARCHAR(20) PRIMARY KEY,
  geohash VARCHAR(20) NOT NULL,
  name VARCHAR(255) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  address TEXT,
  operator VARCHAR(100),
  powerkw DECIMAL(6,2) DEFAULT 0,
  connectortypes TEXT[],
  trustscore INTEGER DEFAULT 50 CHECK (trustscore >= 0 AND trustscore <= 100),
  sources TEXT[],
  sourcecount INTEGER DEFAULT 1,
  amenities TEXT[],
  verified BOOLEAN DEFAULT FALSE,
  verificationcount INTEGER DEFAULT 0,
  lastverfiedat TIMESTAMP,
  lastupdatedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  externalids JSONB DEFAULT '[]'::jsonb,
  rawdata JSONB DEFAULT '{}'::jsonb,
  
  -- PostGIS geography column for spatial queries
  geog GEOGRAPHY(POINT,4326)
);

-- Create spatial index (CRITICAL for performance)
CREATE INDEX idx_stations_geog ON stationsmaster USING GIST (geog);
CREATE INDEX idx_stations_geohash ON stationsmaster (geohash);
CREATE INDEX idx_stations_trustscore ON stationsmaster (trustscore DESC);
CREATE INDEX idx_stations_verified ON stationsmaster (verified);
CREATE INDEX idx_stations_lastupdated ON stationsmaster (lastupdatedat);

-- Sample data (Hyderabad area)
INSERT INTO stationsmaster (id, geohash, name, lat, lng, operator, powerkw, connectortypes, trustscore, sources, amenities) VALUES
('w4rpuz6mb', 'w4rpuz6mb', 'Tata Power - Gachibowli', 17.4485, 78.3782, 'Tata Power', 60, ARRAY['CCS2','Type2'], 92, ARRAY['tata','google'], ARRAY['coffee','restroom']),
('w4rpuz6jf', 'w4rpuz6jf', 'Zeon Charging - Hitech City', 17.4420, 78.3800, 'Zeon', 50, ARRAY['Type2'], 88, ARRAY['zeon','ocm'], ARRAY['food','wifi']),
('w4rpuz6mk', 'w4rpuz6mk', 'Magenta ChargePoint - Madhapur', 17.4450, 78.3950, 'Magenta', 120, ARRAY['CCS2','CHAdeMO'], 95, ARRAY['magenta','gov'], ARRAY['coffee','restroom','food']),
('w4rpuz6nq', 'w4rpuz6nq', 'ChargePoint Supercharger', 17.4500, 78.4100, 'ChargePoint', 150, ARRAY['CCS2'], 90, ARRAY['chargepoint','google'], ARRAY['restroom','wifi']),
('w4rpuz6pf', 'w4rpuz6pf', 'EVgo Fast Charger - Kondapur', 17.4550, 78.3850, 'EVgo', 75, ARRAY['Type2','CCS2'], 87, ARRAY['evgo','osm'], ARRAY['coffee']),
('w4rpuz6qb', 'w4rpuz6qb', 'Tata Power Express - Raidurg', 17.4400, 78.4050, 'Tata Power', 100, ARRAY['CCS2'], 93, ARRAY['tata','ocm'], ARRAY['food','restroom']),
('w4rpuz6sf', 'w4rpuz6sf', 'Blink Network - Jubilee Hills', 17.4350, 78.4150, 'Blink', 50, ARRAY['Type2'], 85, ARRAY['blink','google'], ARRAY['wifi']),
('w4rpuz6tg', 'w4rpuz6tg', 'Fortum Charge - Banjara Hills', 17.4300, 78.4250, 'Fortum', 60, ARRAY['CCS2'], 91, ARRAY['fortum','gov'], ARRAY['coffee','restroom']);

-- Verify table created
SELECT COUNT(*) as total_stations FROM stationsmaster;
