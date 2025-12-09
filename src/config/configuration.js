/**
 * Global configuration
 * Loaded once at startup
 */
require('dotenv').config();

module.exports = {
  // Database configuration
  db: {
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'voltpath_db',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
  },

  // External API Keys
  keys: {
    google: process.env.GOOGLE_API_KEY,
    chargeApi: process.env.CHARGE_API_KEY,
    govApi: process.env.GOV_API_KEY,
    googlemapskey: process.env.GOOGLE_MAPS_API_KEY,
    ocm: process.env.OCM_API_KEY,

  },

  // Default search fallback (Hyderabad)
  search: {
    lat: 17.3850,
    lng: 78.4867,
    radius: 5000, // meters (5km)
  }
};
