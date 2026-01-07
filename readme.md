# VoltPath Backend - Smart EV Route Planning

Complete backend implementation with all rules applied.

## Features

✅ **User-Controlled Battery** (RULE #4)
- Start SOC, Target Arrival SOC, Max Charge SOC
- Not hard-coded to 60% or 80%

✅ **Time-Based Amenities** (RULE #5)
- Breakfast (6-11 AM): Idli, Dosa, Tiffin
- Lunch (11 AM-4 PM): Biryani, Thali, Curry
- Snack (4-6 PM): Coffee, Tea, Pastry
- Dinner (6-11 PM): Pizza, Burger, Chinese
- Late Night (11 PM-6 AM): 24-hour restaurants

✅ **Database-First Caching** (RULE #2)
- Check DB before API
- 7-day cache expiration
- Adaptive search (5→10→20→40km)

✅ **Rate Limiting** (RULE #1)
- Google: 50 calls/minute
- OCM: 100 calls/minute
- Gov: 100 calls/minute

✅ **Merge by Lat/Lng** (RULE #3)
- Geohash-based deduplication
- Fuzzy name matching

## Setup

### 1. Prerequisites

- Node.js 14+
- PostgreSQL 12+
- PostGIS extension

### 2. Install Dependencies

```bash
npm install


SELECT 
    service_name, 
    SUM(units_used) as total_units, 
    CASE 
        WHEN service_name = 'GOOGLE_PLACES' THEN SUM(units_used) * 0.030 
        WHEN service_name = 'GEMINI_AI' THEN SUM(units_used) * 0.0001
        ELSE 0 
    END as estimated_cost_usd
FROM cost_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY service_name;


-- Add a hidden flag
ALTER TABLE stationsmaster ADD COLUMN is_blacklisted BOOLEAN DEFAULT FALSE;

-- Query to ban a station
UPDATE stationsmaster SET is_blacklisted = TRUE WHERE id = 'ocm_12345';

-- Update your dbmanager.js query to always include:
-- WHERE is_blacklisted = FALSE
