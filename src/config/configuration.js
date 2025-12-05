require('dotenv').config();

module.exports = {
    // Database Config
    db: {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'voltpath_db',
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT || 5432,
    },
    // API Keys
    keys: {
        google: process.env.GOOGLE_API_KEY,
        chargeApi: process.env.CHARGE_API_KEY,
        govApi: process.env.GOV_API_KEY
    },
    // Search Settings
    search: {
        lat: 17.3850, // Hyderabad
        lng: 78.4867,
        radius: 5000  // 5km
    }
};