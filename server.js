const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const compression = require('compression'); 
const helmet = require('helmet'); 

// 1. IMPORT DB & ROUTES
const { systemLogger } = require('./src/utils/logger'); 
const { db } = require('./data_aggregator'); 
const stationRoutes = require('./src/routes/stationRoutes');
const vehicleRoutes = require('./src/routes/vehicleRoutes');
const aiRoutes = require('./src/routes/ai.routes');
const supportRoutes = require('./src/routes/support.routes');
const rateLimiter = require('./src/utils/rateLimiter');

dotenv.config();

const app = express();  
const PORT = process.env.PORT || 3000;

// ==========================================
// 2. GLOBAL MIDDLEWARE (ORDER MATTERS!)
// ==========================================

// A. Security & Performance (Must come first)
app.use(helmet()); 
app.use(compression());
app.use(cors());
app.use(express.json());

// B. Trace ID Middleware (So every request gets an ID)
app.use((req, res, next) => {
    req.reqId = uuidv4().slice(0, 8); // e.g. "a1b2c3d4"
    systemLogger.info(`Incoming ${req.method} ${req.url}`, { reqId: req.reqId, label: 'API_GATEWAY' });
    next();
});

// C. Rate Limiter (Apply to all /api routes)
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

// ==========================================
// 3. MOUNT ROUTES
// ==========================================

// API Routes
app.use('/api/ai', aiRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api', stationRoutes); // General station routes

// System Routes
app.get('/api/config', (req, res) => {
    res.json({ googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
});

app.get('/health', async (req, res) => {
    try {
        const start = Date.now();
        await db.query('SELECT 1'); // Check DB
        const dbTime = Date.now() - start;
        const memory = process.memoryUsage();
        
        res.json({
            status: 'OK',
            db_latency_ms: dbTime,
            uptime_seconds: process.uptime(),
            memory_usage_mb: Math.round(memory.heapUsed / 1024 / 1024)
        });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', error: e.message });
    }
});

app.get('/', (req, res) => {
    res.send('VoltPath Backend Engine is Running 🚀');
});

// ==========================================
// 4. ERROR HANDLING (MUST BE LAST)
// ==========================================
app.use((err, req, res, next) => {
    systemLogger.error(`CRASH: ${err.message}`, { reqId: req.reqId, label: 'CRASH_HANDLER', stack: err.stack });
    // Don't expose stack trace to public
    res.status(500).json({ error: "Internal System Error", reqId: req.reqId });
});

// ==========================================
// 5. SERVER STARTUP
// ==========================================
const startServer = async () => {
    try {
        // DB Connection Check
        if (db.connect && typeof db.connect === 'function') {
            await db.connect();
            console.log('✅ Connected to PostgreSQL Database (Single Client Mode)');
        } else {
            await db.query('SELECT NOW()');
            console.log('✅ Connected to PostgreSQL Database (Pool Verified)');
        }

        // Start Listener
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 SERVER RUNNING on http://0.0.0.0:${PORT}`);
            console.log(`   - Network Access: http://192.168.0.136:${PORT}`); 
        });

    } catch (err) {
        console.error('❌ CRITICAL ERROR: Could not start server', err);
        process.exit(1);
    }
};

// ==========================================
// 6. CRON JOBS
// ==========================================

// Update Gov Data (Sunday 3 AM)
cron.schedule('0 3 * * 0', () => {
  console.log('[Cron] Triggering weekly Gov Data update...');
  exec('node scripts/refreshGovData.js', (error, stdout, stderr) => {
    if (error) console.error(`[Cron] Update Error: ${error.message}`);
    else console.log(`[Cron] Output: ${stdout}`);
  });
});

// Cleanup Logs (Sunday 4 AM)
cron.schedule('0 4 * * 0', async () => {
    console.log('🧹 [Maintenance] Starting Weekly Log Cleanup...');
    try {
        const client = await db.connect();
        
        const res1 = await client.query("DELETE FROM user_analytics WHERE created_at < NOW() - INTERVAL '60 days'");
        console.log(`   - Deleted ${res1.rowCount} old analytic records.`);

        const res2 = await client.query("DELETE FROM cost_logs WHERE created_at < NOW() - INTERVAL '60 days'");
        console.log(`   - Deleted ${res2.rowCount} old cost records.`);

        const res3 = await client.query("DELETE FROM route_cache WHERE expirytime < NOW()");
        console.log(`   - Deleted ${res3.rowCount} expired routes.`);

        await client.query("VACUUM ANALYZE user_analytics");
        await client.query("VACUUM ANALYZE cost_logs");
        
        client.release();
        console.log('✅ [Maintenance] Cleanup Complete.');
    } catch (err) {
        console.error('❌ [Maintenance] Cleanup Failed:', err.message);
    }
});

// Init
startServer();