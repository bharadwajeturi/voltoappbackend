const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { exec } = require('child_process');

// 1. IMPORT DB & ROUTES
const { db } = require('./data_aggregator'); 
const stationRoutes = require('./src/routes/stationRoutes');
const vehicleRoutes = require('./src/routes/vehicleRoutes'); // 🟢 Imported
const rateLimiter = require('./src/utils/rateLimiter');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 2. RATE LIMITER MIDDLEWARE
app.use('/api', async (req, res, next) => {
    try {
        const status = rateLimiter.getStatus();
        if (status.remaining <= 0) {
            return res.status(429).json({ error: 'Too many requests' });
        }
        await rateLimiter.wait();
        next();
    } catch (error) {
        console.error("Rate Limiter Error:", error);
        next(); 
    }
});

const startServer = async () => {
    try {
        // 3. DATABASE CONNECTION CHECK
        if (db.connect && typeof db.connect === 'function') {
            await db.connect();
            console.log('✅ Connected to PostgreSQL Database (Single Client Mode)');
        } else {
            await db.query('SELECT NOW()');
            console.log('✅ Connected to PostgreSQL Database (Pool Verified)');
        }

        // 4. API CONFIGURATION
        app.get('/api/config', (req, res) => {
            res.json({
                googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY, 
            });
        });

        // 5. MOUNT ROUTES (Grouped together for clarity)
        
        // 🟢 Vehicle Routes (Specific route first)
        app.use('/api/vehicles', vehicleRoutes);
        console.log('✅ Vehicle Routes mounted at /api/vehicles');

        // Station Routes (General route)
        app.use('/api', stationRoutes);
        console.log('✅ Station Routes mounted at /api');

        // Root Endpoint
        app.get('/', (req, res) => {
            res.send('VoltPath Backend Engine is Running 🚀');
        });

        // 6. START LISTENER
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 SERVER RUNNING on http://0.0.0.0:${PORT}`);
            // Note: The IP below is for your reference; it doesn't affect the code.
            console.log(`   - Network Access: http://192.168.0.136:${PORT}`); 
        });

    } catch (err) {
        console.error('❌ CRITICAL ERROR: Could not start server', err);
        process.exit(1);
    }
};

// 7. AUTOMATIC UPDATE: Run every Sunday at 3:00 AM
cron.schedule('0 3 * * 0', () => {
  console.log('[Cron] Triggering weekly Gov Data update...');
  exec('node scripts/refreshGovData.js', (error, stdout, stderr) => {
    if (error) console.error(`[Cron] Update Error: ${error.message}`);
    else console.log(`[Cron] Output: ${stdout}`);
  });
});

// Start the engine
startServer();