// src/config/database.js
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('voltpath_db', 'postgres', 'Bharadwaj@1940', {
  host: 'localhost',
  dialect: 'postgres',
  logging: false, // Set to true if you want to see SQL queries in console
  
  // 🟢 CRITICAL FIX: Connection Pooling
  pool: {
    max: 10,      // Max connections allowed (Prevents overloading)
    min: 0,       // Min connections to keep open
    acquire: 30000, // Max time (ms) to wait for a connection before error
    idle: 10000   // Max time (ms) a connection can sit idle before closing
  }
});

// Test the connection immediately on startup
sequelize.authenticate()
  .then(() => console.log('✅ Connected to PostgreSQL Database (Pool Mode)'))
  .catch(err => console.error('❌ Database Connection Error:', err));

module.exports = sequelize;