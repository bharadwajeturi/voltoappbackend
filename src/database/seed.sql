-- 1. Create a History Table (Stores every single user report)
CREATE TABLE station_verifications (
    id SERIAL PRIMARY KEY,
    station_id TEXT NOT NULL,
    user_id TEXT, -- Optional: If you add login later
    power_kw DECIMAL,
    connector_type TEXT,
    status TEXT, -- 'Working', 'Busy', 'Broken'
    price DECIMAL,
    charge_success BOOLEAN,
    amenities TEXT,
    source TEXT DEFAULT 'user_app',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Update Master Table (To show "Live" status to other users)
ALTER TABLE stationsmaster 
ADD COLUMN last_verified_at TIMESTAMP,
ADD COLUMN verified_status TEXT DEFAULT 'Unknown', -- 'Working', 'Broken'
ADD COLUMN trust_score INT DEFAULT 50; -- Score from 0 to 100