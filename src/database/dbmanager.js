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

    this.pool.on('error', (err) => {
      console.error('⚠️ Database Unexpected error on idle client', err);
    });
  }

  // RULE 2: Find nearby stations in database
  // Uses ST_DWithin for spatial queries (PostGIS)
  async findNearbyStations(lat, lng, radiusMeters = 5000, verifiedOnly = false) {
    try {
      const query = `
        SELECT 
          id, geohash, name, lat, lng, address, operator, powerkw, connectortypes, 
          trustscore, sources, sourcecount, amenities, verified, verificationcount, 
          lastverfiedat, lastupdatedat, createdat, externalids, rawdata
        FROM stationsmaster 
        WHERE ST_DWithin(
          geog, 
          ST_Point(${lng}, ${lat})::geography, 
          ${radiusMeters}
        ) 
        ${verifiedOnly ? 'AND verified = true' : ''}
        AND (lastupdatedat > NOW() - INTERVAL \'7 days\' OR lastupdatedat IS NULL)
        ORDER BY 
          ST_Distance(geog, ST_Point(${lng}, ${lat})::geography) ASC, 
          trustscore DESC 
        LIMIT 100
      `;
      
      const result = await this.pool.query(query, [lng, lat, radiusMeters]);
      console.log(`Database: Found ${result.rows.length} stations within ${radiusMeters / 1000}km of ${lat},${lng}`);
      return result.rows;
    } catch (error) {
      console.error('Database Error finding nearby stations:', error.message);
      throw error;
    }
  }

  // RULE 2: Save merged stations to database
  // Handles upserts (insert if new, update if exists)
  async saveStations(stations) {
    if (!stations || stations.length === 0) {
      console.log('Database: No stations to save');
      return { inserted: 0, updated: 0 };
    }

    console.log(`Database: Saving ${stations.length} stations...`);
    const client = await this.pool.connect();
    let inserted = 0;
    let updated = 0;

    try {
      await client.query('BEGIN');
      
      for (const station of stations) {
        // Validate station
        if (!station.lat || !station.lng || !station.name) {
          console.warn('Skipping invalid station:', station.name);
          continue;
        }

        // Generate geohash for this station (precision 7 = 150m accuracy)
        const hash = geohash.encode(station.lat, station.lng, 7);

        const query = `
          INSERT INTO stationsmaster (
            id, geohash, name, lat, lng, address, operator, powerkw, connectortypes, 
            trustscore, sources, sourcecount, amenities, verified, verificationcount, 
            lastverfiedat, lastupdatedat, createdat, externalids, rawdata, geog
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
            ST_Point($5, $4)::geography
          )
          ON CONFLICT (id) DO UPDATE SET
            name = COALESCE($3, stationsmaster.name),
            address = COALESCE($6, stationsmaster.address),
            operator = COALESCE($7, stationsmaster.operator),
            powerkw = GREATEST($8, stationsmaster.powerkw),
            connectortypes = ARRAY(
              SELECT DISTINCT UNNEST(ARRAY_CAT($9::text[], stationsmaster.connectortypes))
            ),
            trustscore = GREATEST($10, stationsmaster.trustscore),
            sources = ARRAY(
              SELECT DISTINCT UNNEST(ARRAY_CAT($11::text[], stationsmaster.sources))
            ),
            sourcecount = ARRAY_LENGTH(
              ARRAY(SELECT DISTINCT UNNEST(ARRAY_CAT($11::text[], stationsmaster.sources))), 1
            ),
            amenities = ARRAY(
              SELECT DISTINCT UNNEST(ARRAY_CAT($13::text[], stationsmaster.amenities))
            ),
            lastupdatedat = NOW(),
            externalids = $19 || stationsmaster.externalids,
            rawdata = $20 || stationsmaster.rawdata
          RETURNING xmax = 0 as inserted
        `;

        const values = [
          hash, // $1 id (geohash)
          hash, // $2 geohash
          station.name, // $3
          parseFloat(station.lat), // $4
          parseFloat(station.lng), // $5
          station.address, // $6
          station.operator, // $7
          parseFloat(station.powerkw) || 0, // $8
          station.connectorTypes, // $9
          parseInt(station.trustscore) || 50, // $10
          station.sources, // $11
          station.sourceCount || 1, // $12
          station.amenities, // $13
          false, // $14 verified
          0, // $15 verificationcount
          null, // $16 lastverfiedat
          new Date().toISOString(), // $17 lastupdatedat
          new Date().toISOString(), // $18 createdat
          station.externalIds, // $19
          station.rawData // $20
        ];

        try {
          const result = await client.query(query, values);
          if (result.rows?.[0]?.inserted) {
            inserted++;
            console.log(`✅ Inserted: ${station.name} (${hash})`);
          } else {
            updated++;
            console.log(`🔄 Updated: ${station.name} (${hash})`);
          }
        } catch (err) {
          console.error(`Error saving ${station.name}:`, err.message);
        }
      }
      
      await client.query('COMMIT');
      console.log(`Database: Saved (inserted: ${inserted}, updated: ${updated})`);
      return { inserted, updated };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Database Error in transaction:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  // Adaptive search with expanding radius
  async adaptiveSearch(lat, lng) {
    console.log(`Database: Starting adaptive search from ${lat},${lng}`);
    const radii = [5000, 10000, 20000, 40000]; // meters
    
    let allStations = [];
    for (const radius of radii) {
      const stations = await this.findNearbyStations(lat, lng, radius);
      console.log(`${radius / 1000}km: ${stations.length} stations (total: ${allStations.length + stations.length})`);
      allStations = [...allStations, ...stations];
      
      // If we have decent results, return
      if (stations.length >= 10) {
        console.log(`Found ${stations.length} stations, stopping search`);
        return { stations, radius };
      }
    }
    
    return { stations: allStations, radius: 40000 };
  }

  // Get station by ID (geohash)
  async getStationById(id) {
    try {
      const query = 'SELECT * FROM stationsmaster WHERE id = $1::varchar';
      const result = await this.pool.query(query, [id]);
      
      if (result.rows.length === 0) return null;
      return result.rows[0];
    } catch (error) {
      console.error('Database Error getting station by ID:', error.message);
      throw error;
    }
  }

  // Mark station as verified by user
  async verifyStation(id) {
    try {
      const query = `
        UPDATE stationsmaster 
        SET verified = true, 
            verificationcount = verificationcount + 1, 
            lastverfiedat = NOW() 
        WHERE id = $1::varchar 
        RETURNING *
      `;
      
      const result = await this.pool.query(query, [id]);
      
      if (result.rows.length === 0) {
        throw new Error('Station not found');
      }
      
      console.log(`Database: Verified station ${result.rows[0].name}`);
      return result.rows[0];
    } catch (error) {
      console.error('Database Error verifying station:', error.message);
      throw error;
    }
  }

  // Get database statistics
  async getStats() {
    try {
      const queries = {
        totalStations: 'SELECT COUNT(*) as count FROM stationsmaster',
        verifiedStations: 'SELECT COUNT(*) as count FROM stationsmaster WHERE verified = true',
        bySource: `
          SELECT DISTINCT source, COUNT(*) as count 
          FROM (SELECT UNNEST(sources) as source FROM stationsmaster) t 
          GROUP BY source
        `,
        avgTrustScore: 'SELECT AVG(trustscore) as avg FROM stationsmaster',
        oldestStation: 'SELECT MIN(createdat) as oldest FROM stationsmaster',
        newestStation: 'SELECT MAX(lastupdatedat) as newest FROM stationsmaster'
      };

      const stats = {};
      for (const [key, query] of Object.entries(queries)) {
        const result = await this.pool.query(query);
        stats[key] = result.rows[0];
      }
      
      return stats;
    } catch (error) {
      console.error('Database Error getting stats:', error.message);
      throw error;
    }
  }

  // Clear old data older than 7 days
  async clearOldData() {
    try {
      const query = `
        DELETE FROM stationsmaster 
        WHERE lastupdatedat < NOW() - INTERVAL '7 days' 
        AND verified = false
      `;
      
      const result = await this.pool.query(query);
      console.log(`Database: Cleared ${result.rowCount} old stations`);
      return result.rowCount;
    } catch (error) {
      console.error('Database Error clearing old data:', error.message);
      throw error;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const result = await this.pool.query('SELECT NOW()');
      console.log('Database: Health check passed');
      return true;
    } catch (error) {
      console.error('Database Health check failed:', error.message);
      return false;
    }
  }

  // Close database connection
  async close() {
    await this.pool.end();
    console.log('Database: Connection pool closed');
  }
}

// Create singleton instance
const db = new DatabaseManager();
module.exports = db;
