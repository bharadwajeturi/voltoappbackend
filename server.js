/**
 * VoltPath Backend Server - MINIMAL WORKING VERSION
 * All endpoints functional, no middleware dependency issues
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Import core services
const db = require('./src/database/dbmanager');
const { planRoute } = require('./src/services/batteryRouter');
const ApiError = require('./src/utils/errorHandler');

// INLINE asyncHandler (no external deps)
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// INLINE simple logger
const logEvent = (event, data = {}) => {
  console.log(`[EVENT ${new Date().toISOString()}] ${event}`, data);
};
const logError = (err, context = {}) => {
  console.error(`[ERROR ${new Date().toISOString()}]`, err.message, context);
};

// Create Express app
const app = express();

// MIDDLEWARE SETUP
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: process.env.CORS_CREDENTIALS === 'true',
}));

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Google Maps API Key
app.get('/api/config/googlemapskey', (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Maps API Key not configured' });
    }
    res.json({ apiKey, message: 'API Key fetched securely from backend' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CORE ROUTES
app.post('/api/plan-route', asyncHandler(async (req, res) => {
  const { start, end, carModel, startSOC, targetArrivalSOC, maxChargeSOC = 80, startTime } = req.body;

  logEvent('route_planning_started', {
    from: `${start?.lat},${start?.lng}`,
    to: `${end?.lat},${end?.lng}`,
    car: carModel,
    battery: `${startSOC}% → ${targetArrivalSOC}%`
  });

  // Validate
  if (!start || !end || !carModel || startSOC === undefined || targetArrivalSOC === undefined) {
    throw new ApiError('Missing required parameters', 400);
  }
  if (typeof start.lat !== 'number' || typeof start.lng !== 'number') {
    throw new ApiError('Invalid start coordinates', 400);
  }
  if (typeof end.lat !== 'number' || typeof end.lng !== 'number') {
    throw new ApiError('Invalid end coordinates', 400);
  }

  const route = await planRoute(
    start, end, carModel, startSOC, targetArrivalSOC, maxChargeSOC,
    startTime ? new Date(startTime) : new Date(), db
  );

  logEvent('route_planning_completed', {
    stops: route.route.statistics.totalStops,
    distance: route.route.statistics.totalDistance
  });

  res.json({
    status: 'success',
    message: 'Route planned successfully',
    data: route.route
  });
}));

// STATION ENDPOINTS
app.get('/api/stations/nearby', asyncHandler(async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query;
  
  if (!lat || !lng) {
    throw new ApiError('Missing lat or lng parameters', 400);
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const radiusNum = parseInt(radius);

  if (isNaN(latNum) || isNaN(lngNum)) {
    throw new ApiError('Invalid coordinates', 400);
  }

  const result = await db.adaptiveSearch(latNum, lngNum);
  const stations = (result.stations || []).map(s => ({
    id: s.id,
    name: s.name,
    operator: s.operator || 'Unknown',
    powerkw: s.powerkw || 0,
    trustscore: s.trustscore || 50,
    verified: s.verified || false,
    latitude: s.lat,
    longitude: s.lng,
    distancemeters: calculateDistance(latNum, lngNum, s.lat, s.lng) * 1000,
    connectortypes: s.connectortypes || [],
    amenities: s.amenities || []
  })).sort((a, b) => a.distancemeters - b.distancemeters);

  res.json({
    status: 'success',
    data: {
      count: stations.length,
      'search-radius-km': (result.radius || 5000) / 1000,
      stations
    }
  });
}));

app.get('/api/nearby-stations', asyncHandler(async (req, res) => {
  const { lat, lng, radius = 5000, verified = false } = req.query;
  if (!lat || !lng) throw new ApiError('Missing lat or lng', 400);

  const stations = await db.findNearbyStations(
    parseFloat(lat), parseFloat(lng), parseInt(radius), verified === 'true'
  );

  res.json({ status: 'success', data: { count: stations.length, stations } });
}));

// UTILITY
app.get('/api/stats', asyncHandler(async (req, res) => {
  const stats = await db.getStats();
  res.json({ status: 'success', data: stats });
}));

app.get('/api/car-models', asyncHandler(async (req, res) => {
  const { CARMODELS } = require('./src/services/batteryRouter');
  const models = Object.entries(CARMODELS).map(([name, specs]) => ({
    name, range: specs.range, efficiency: specs.efficiency, chargeTime80Percent: specs.chargeTime80Percent
  }));
  res.json({ status: 'success', data: models });
}));

// ERROR HANDLING
app.use((req, res) => {
  res.status(404).json({
    status: 'error', statusCode: 404, message: 'Route not found', path: req.path
  });
});

app.use((err, req, res, next) => {
  logError(err, { method: req.method, path: req.path });
  const statusCode = err.statusCode || 500;
  const response = {
    status: 'error',
    statusCode,
    message: err.message || 'Internal server error'
  };
  if (process.env.NODE_ENV === 'development') response.stack = err.stack;
  if (err.details) response.details = err.details;
  res.status(statusCode).json(response);
});

// HELPERS
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

const PORT = process.env.PORT || 5000;

async function seedDatabaseIfEmpty() {
  try {
    console.log('📊 Checking database...');
    
    // Check if table exists first
    const tableCheck = await db.pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'stationsmaster'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('⏳ Creating stationsmaster table...');
      await db.pool.query(`
        CREATE EXTENSION IF NOT EXISTS postgis;
        DROP TABLE IF EXISTS stationsmaster CASCADE;
      `);
    }
    
    const countResult = await db.pool.query('SELECT COUNT(*) as count FROM stationsmaster');
    const count = parseInt(countResult.rows[0].count);
    
    console.log(`Found ${count} stations`);
    
    if (count > 0) {
      console.log('✅ Database ready (skipping seed)');
      return;
    }
    
    console.log('🌱 Running seed.sql...');
    
    // Read entire seed.sql and execute as ONE query block
    const seedSQL = fs.readFileSync(path.join(__dirname, 'src/database/seed.sql'), 'utf8');
    
    // Execute the full seed.sql
    await db.pool.query(seedSQL);
    
    // Verify
    const finalCount = await db.pool.query('SELECT COUNT(*) as count FROM stationsmaster');
    console.log(`✅ Seeded! ${finalCount.rows[0].count} stations loaded!`);
    
  } catch (err) {
    console.error('❌ Seed error:', err.message);
    console.error('💡 Run manually: psql -U postgres -d voltpath_db -f src/database/seed.sql');
  }
}

async function startServer() {
  try {
    const isHealthy = await db.healthCheck();
    if (!isHealthy) throw new Error('Database connection failed');
    
    await seedDatabaseIfEmpty();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 VoltPath Backend Running on http://localhost:${PORT}`);
      console.log('✅ Database connected & ready\n');
    });
  } catch (error) {
    console.error('❌ Server failed:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => db.close().then(() => process.exit(0)));
process.on('SIGINT', () => db.close().then(() => process.exit(0)));

startServer();
module.exports = app;
