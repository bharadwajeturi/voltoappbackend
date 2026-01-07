-- 1. Clear Amenities first (Foreign Key dependency)
TRUNCATE TABLE station_amenities CASCADE;

-- 2. Clear Verifications (Foreign Key dependency)
TRUNCATE TABLE station_verifications CASCADE;

-- 3. Clear the Master Station Table
TRUNCATE TABLE stationsmaster CASCADE;

