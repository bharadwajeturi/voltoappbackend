const { Pool } = require('pg');
const config = require('../config/configuration');
const geohash = require('ngeohash');

class DatabaseManager {
  constructor() {
    this.pool = new Pool({
      user: config.db.user,
      password: config.db.password,
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
    });
  }

  // Find Nearby (Reads from Normalized DB)
  async findNearbyStations(lat, lng, radiusMeters = 5000, verifiedOnly = false) {
    try {
      const query = `
        SELECT 
          s.id, s.geohash, s.name, s.lat, s.lng, s.address, s.operator, s.powerkw, s.connectortypes, 
          s.trustscore, s.sources, s.verified, s.lastupdatedat,
          array_remove(array_agg(DISTINCT sa.amenity_type), NULL) as amenities
        FROM stationsmaster s
        LEFT JOIN station_amenities sa ON s.id = sa.station_id
        WHERE ST_DWithin(
          s.geog, 
          ST_Point($1, $2)::geography, 
          $3
        ) 
        ${verifiedOnly ? 'AND s.verified = true' : ''}
        GROUP BY s.id
        ORDER BY 
          ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC, 
          s.trustscore DESC 
        LIMIT 100
      `;
      
      const result = await this.pool.query(query, [lng, lat, radiusMeters]);
      return result.rows;
    } catch (error) {
      console.error('Database Error:', error.message);
      throw error;
    }
  }

  // 🟢 Helper for Tile Status (Frontend Monitoring)
  async getTileStatus(lat, lng, precision = 5) {
      const tileId = geohash.encode(lat, lng, precision);
      const res = await this.pool.query(
          `SELECT * FROM tile_cache WHERE tile_id = $1`, 
          [tileId]
      );
      return res.rows[0] || { status: 'unknown' };
  }

 

// Add this inside the DatabaseManager class in src/database/dbmanager.js

  // 🟢 NEW: Logic for Battery Router to find the "Best" stop
  // src/database/dbmanager.js

  // 🟢 UPDATED: Accepts 'excludeIds' array to prevent loops
  // src/database/dbmanager.js

 async adaptiveSearch(lat, lng, excludeIds = [], strategy = 'QUALITY') {
    try {
      const excludeClause = excludeIds.length > 0 
        ? `AND s.id NOT IN (${excludeIds.map(id => `'${id}'`).join(',')})` 
        : '';

      const baseQuery = `
        SELECT 
            s.id, s.name, s.lat, s.lng, s.operator, s.powerkw, s.trustscore, s.address,
            array_remove(array_agg(DISTINCT sa.amenity_type), NULL) as amenities
        FROM stationsmaster s
        LEFT JOIN station_amenities sa ON s.id = sa.station_id
      `;

      let orderBy = '';
      let whereClause = '';

      if (strategy === 'DISTANCE') {
          // Panic Mode: Find closest working charger (Power > 0)
          whereClause = `AND s.powerkw > 0`; 
          orderBy = `ORDER BY ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC`;
      } else {
          // Cruise Mode: Prioritize High Power & Trust
          whereClause = `AND s.powerkw >= 25`;
          orderBy = `ORDER BY s.powerkw DESC, s.trustscore DESC, ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC`;
      }

      // Query 1: Try strict filter
      let query = `
        ${baseQuery}
        WHERE ST_DWithin(s.geog, ST_Point($1, $2)::geography, 30000)
        ${whereClause}
        ${excludeClause}
        GROUP BY s.id
        ${orderBy}
        LIMIT 5
      `;
      let result = await this.pool.query(query, [lng, lat]);

      // Query 2: Fallback (Widen search, loosen power reqs)
      if (result.rows.length === 0) {
         query = `
            ${baseQuery}
            WHERE ST_DWithin(s.geog, ST_Point($1, $2)::geography, 50000)
            AND (s.powerkw > 0 OR s.trustscore >= 70)
            ${excludeClause}
            GROUP BY s.id
            ORDER BY ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC
            LIMIT 5
         `;
         result = await this.pool.query(query, [lng, lat]);
      }

      return { stations: result.rows };
    } catch (error) {
      console.error('[DB] Adaptive Search Failed:', error.message);
      return { stations: [] };
    }
  }
   async close() {
    await this.pool.end();
  }
}

const db = new DatabaseManager();
module.exports = db;