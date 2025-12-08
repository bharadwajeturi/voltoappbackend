/**
 * VoltPath Backend Entry Point
 * Initializes server and all services
 */

require('dotenv').config();

// Import and start server
const app = require('./server');

// Export for testing
module.exports = app;
