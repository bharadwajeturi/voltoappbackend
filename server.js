require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
// Ensure your .env file has: DB_USER, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'voltpath',
  password: process.env.DB_PASSWORD || 'password', // REPLACE WITH YOUR DB PASSWORD
  port: process.env.DB_PORT || 5432,
});

// Test DB Connection on Startup
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  console.log('✅ Connected to PostgreSQL Database (PostGIS Enabled)');
  release();
});

// --- API ROUTES ---

// 1. Health Check
app.get('/', (req, res) => {
  res.send('⚡ VoltPath Intelligence Core is Online');
});

/**
 * 2. GET /api/stations
 * Returns stations within a specific radius of the user's location.
 * Usage: GET /api/stations?lat=17.44&lng=78.38&radius=5000
 */
app.get('/api/stations', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Latitude and Longitude are required" });
    }

    // Default search radius: 5km (5000 meters) if not specified
    const searchRadius = radius || 5000;

    // --- SPATIAL QUERY ---
    // ST_DWithin: Finds points within X meters (uses the spatial index we created)
    // ST_Distance: Calculates the exact distance in meters for display
    const query = `
      SELECT 
        id, 
        name, 
        operator, 
        power_kw, 
        trust_score, 
        amenities, 
        data_source,
        ST_Y(geog::geometry) as latitude,
        ST_X(geog::geometry) as longitude,
        ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as distance_meters
      FROM stations_master
      WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)
      ORDER BY distance_meters ASC
      LIMIT 20;
    `;

    // Note: PostGIS expects (longitude, latitude) order in arguments
    const result = await pool.query(query, [lng, lat, searchRadius]);

    res.json({
      count: result.rowCount,
      stations: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});