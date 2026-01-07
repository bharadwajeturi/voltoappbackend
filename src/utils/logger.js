/**
 * VOLTPATH 3-TIER LOGGING SYSTEM
 * 1. Analytics (Business Growth) -> logs/analytics-DATE.log
 * 2. Cost (Money Spent) -> logs/cost-DATE.log
 * 3. System (Debugging) -> logs/app-debug-DATE.log
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');

// Ensure logs directory exists
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

// --- 1. ANALYTICS LOGGER (User Behavior) ---
const analyticsLogger = winston.createLogger({
  levels: { search: 0, click: 1, view: 2 },
  transports: [
    new DailyRotateFile({
      filename: 'logs/analytics-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json() // JSON for easy parsing (Heatmaps)
      )
    })
  ]
});

// --- 2. COST LOGGER (API Auditing) ---
const costLogger = winston.createLogger({
  transports: [
    new DailyRotateFile({
      filename: 'logs/cost-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '60d',
      format: winston.format.printf(({ timestamp, service, endpoint, units, status, costEst }) => {
        // PIPE SEPARATED (Easy for Excel)
        return `${timestamp} | ${service} | ${endpoint} | ${units} | ${status} | ${costEst || '0.00'}`;
      })
    })
  ]
});

// --- 3. SYSTEM LOGGER (Debug & Crashes) ---
const systemLogger = winston.createLogger({
  level: 'debug',
  transports: [
    new DailyRotateFile({
      filename: 'logs/app-debug-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '7d',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, reqId, label }) => {
          // LINE-BY-LINE TRACE
          return `[${timestamp}] [${reqId || 'SYSTEM'}] [${level.toUpperCase()}] [${label || 'GEN'}] ${message}`;
        })
      )
    }),
    new winston.transports.Console({
        format: winston.format.printf(({ level, message, label }) => `[${level.toUpperCase()}] [${label || 'GEN'}] ${message}`)
    })
  ]
});

// --- HELPER FUNCTIONS ---

async function logAnalytics(pool, userId, event, screen, meta = {}) {
    // File Log
    analyticsLogger.log('search', { timestamp: new Date(), userId, event, screen, meta });
    
    // DB Log (Fire & Forget)
    if(pool) {
        pool.query(
            `INSERT INTO user_analytics (user_id, event_type, screen_name, meta_data) VALUES ($1, $2, $3, $4)`,
            [userId || 'guest', event, screen, JSON.stringify(meta)]
        ).catch(() => {});
    }
}

async function logCost(pool, service, endpoint, units, status = 'SUCCESS') {
    // Estimated Costs (USD)
    const RATES = { 'GOOGLE_PLACES': 0.03, 'GEMINI_AI': 0.001, 'DB_WRITE': 0.0001 };
    const cost = (RATES[service] || 0) * units;

    // File Log
    costLogger.info({ 
        timestamp: new Date().toISOString(), 
        service, endpoint, units, status, costEst: cost.toFixed(4) 
    });

    // DB Log
    if(pool) {
        pool.query(
            `INSERT INTO cost_logs (service_name, endpoint, units_used, status) VALUES ($1, $2, $3, $4)`,
            [service, endpoint, units, status]
        ).catch(() => {});
    }
}

module.exports = { systemLogger, logAnalytics, logCost };