const { Pool } = require('pg');
const config = require('../config/configuration');

class DatabaseManager {
  constructor() {
    this.pool = new Pool(config.db);
  }

  // 🟢 CORE: Data Normalization & Parsing
  // Handles converting DB strings "{CCS2,Type2}" -> JSON Arrays ["CCS2", "Type2"]
  parsePgArray(dbString) {
      if (!dbString) return [];
      if (Array.isArray(dbString)) return dbString; // Already an array
      
      try {
          let clean = dbString.toString();
          
          // Case 1: Handle CSV double-quotes '[""CCS2""]'
          if (clean.includes('""')) clean = clean.replace(/""/g, '"');
          
          // Case 2: Handle Postgres Array Format '{Item1,Item2}'
          if (clean.startsWith('{') && clean.endsWith('}')) {
              return clean.slice(1, -1) // Remove { }
                  .split(',')
                  .map(s => s.trim().replace(/"/g, '')) // Remove quotes
                  .filter(s => s.length > 0);
          }

          // Case 3: Handle JSON Format '["Item1","Item2"]'
          if (clean.startsWith('[') && clean.endsWith(']')) {
              return JSON.parse(clean);
          }

          // Case 4: Single String fallback
          return [clean];

      } catch (e) {
          console.warn("[DB] Array Parse Error:", e.message);
          return [];
      }
  }

  applyBrandHeuristic(station) {
      const BRANDS = ['Tata Power', 'Zeon', 'Statiq', 'Shell', 'Jio-bp', 'Hyundai', 'Mahindra', 'ChargeZone', 'Glida', 'LionCharge', 'BPCL', 'HPCL', 'Ather'];
      
      // 1. FIX: Parse Connectors
      const rawConnectors = station.connectorTypes || station.connectortypes;
      const parsedConnectors = this.parsePgArray(rawConnectors);
      
      // Ensure we always have at least 'Unknown' if empty
      station.connectorTypes = parsedConnectors.length > 0 ? parsedConnectors : ['Unknown'];

      // 2. FIX: Parse Amenities
      // We explicitly parse the amenities column now
      const rawAmenities = station.amenities;
      station.amenities = this.parsePgArray(rawAmenities);

      // 3. Identify Brand
      const isBrand = BRANDS.some(b => 
        (station.operator && station.operator.toLowerCase().includes(b.toLowerCase())) || 
        (station.name && station.name.toLowerCase().includes(b.toLowerCase()))
      );

      // 4. Power Logic
      let power = parseFloat(station.powerkw);
      if (isNaN(power)) power = 0;

      if (power <= 0) {
          if (isBrand) {
              station.powerkw = 30; 
              station.trustscore = 80;
          } else {
              station.powerkw = 7.4; 
              station.trustscore = 60;
          }
      } else {
          station.powerkw = power; 
      }

      return station;
  }

  // 🟢 HELPER: Get Single Station
  async getStationById(id) {
      try {
          const res = await this.pool.query(`SELECT * FROM stationsmaster WHERE id = $1`, [id]);
          if (res.rows.length === 0) return null;
          return this.applyBrandHeuristic(res.rows[0]);
      } catch (e) {
          console.error(`[DB] Error fetching station ${id}:`, e.message);
          return null;
      }
  }

  // 🟢 FIND NEARBY (For NearMe Screen)
  async findNearbyStations(lat, lng, radiusMeters = 5000) {
    try {
      const validKeywords = [
        'charging', 'charger', 'ev', 'electric', 'power', 'station', 'point', 'supply', 'battery', 
        'tesla', 'supercharger', 'ather', 'tata', 'zeon', 'statiq', 'volttic', 'kazam', 'bolt',
        'chargezone', 'glida', 'relux', 'lioncharge', 'jio-bp', 'shell', 'bpcl', 'hpcl'
      ];

      const keywordFilter = validKeywords
        .map(w => `LOWER(s.name) LIKE '%${w}%' OR LOWER(s.operator) LIKE '%${w}%'`)
        .join(' OR ');

      // 🟢 FIX: Selecting s.amenities directly from table
      const query = `
        SELECT 
          s.id, s.name, s.lat, s.lng, s.operator, s.powerkw, 
          s.connectortypes as "connectorTypes", 
          s.amenities, 
          s.trustscore, s.sources, s.address, s.verified_status
        FROM stationsmaster s
        WHERE ST_DWithin(s.geog, ST_Point($1, $2)::geography, $3) 
        AND (
            s.trustscore > 30 
            OR array_length(s.connectortypes, 1) > 0 
            OR (${keywordFilter})
        )
        ORDER BY 
            (s.verified_status = 'Working') DESC,
            ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC
        LIMIT 100
      `;
      const result = await this.pool.query(query, [lng, lat, radiusMeters]);
      
      return result.rows.map(s => {
          const clean = this.applyBrandHeuristic(s);
          
          let badge = 'BRONZE';
          if (s.verified_status === 'Working') badge = 'VERIFIED';
          else if (clean.powerkw >= 50) badge = 'PLATINUM';
          else if (clean.powerkw >= 25) badge = 'GOLD';
          else if (clean.powerkw >= 15) badge = 'SILVER';
          
          return { ...clean, badge };
      });

    } catch (error) {
      console.error('❌ [DB] Nearby Search Error:', error.message);
      return [];
    }
  }

  // 🟢 ADAPTIVE SEARCH (For Route Planner)
  async adaptiveSearch(lat, lng, excludeIds = [], strategy = 'FAST', radiusOverride = null) {
      try {
          let radius = radiusOverride || (strategy === 'FAST' ? 50000 : 30000); 
          const minPower = strategy === 'FAST' ? 15 : 0;       

          const validKeywords = [
            'charging', 'charger', 'ev', 'electric', 'power', 'station', 'point', 'supply', 'battery', 
            'tesla', 'supercharger', 'ather', 'tata', 'zeon', 'statiq', 'volttic', 'kazam', 'bolt',
            'chargezone', 'glida', 'relux', 'lioncharge', 'jio-bp', 'shell', 'bpcl', 'hpcl'
          ];

          const keywordFilter = validKeywords
            .map(w => `LOWER(s.name) LIKE '%${w}%' OR LOWER(s.operator) LIKE '%${w}%'`)
            .join(' OR ');

          const excludeClause = excludeIds.length > 0 
            ? `AND s.id NOT IN (${excludeIds.map(id => `'${id}'`).join(',')})` 
            : '';

          // 🟢 FIX: Selecting s.amenities directly
          const query = `
            SELECT 
                s.id, s.name, s.lat, s.lng, s.operator, 
                s.powerkw, s.trustscore, s.address, s.verified_status,
                s.connectortypes as "connectorTypes",
                s.amenities
            FROM stationsmaster s
            WHERE ST_DWithin(s.geog, ST_Point($1, $2)::geography, $3) 
            AND s.powerkw >= $4 
            ${excludeClause}
            AND (
                s.trustscore > 30                   
                OR array_length(s.connectortypes, 1) > 0  
                OR (${keywordFilter})               
            )
            ORDER BY 
                (s.verified_status = 'Working') DESC,
                s.powerkw DESC,
                ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC
            LIMIT 20
          `;
          
          const result = await this.pool.query(query, [lng, lat, radius, minPower]);

          const stations = result.rows.map(s => {
              const cleanStation = this.applyBrandHeuristic(s);
              
              let badge = 'BRONZE';
              const p = parseFloat(cleanStation.powerkw || 0);
              const t = parseFloat(cleanStation.trustscore || 0);
              
              if (s.verified_status === 'Working') badge = 'VERIFIED';
              else if (p >= 50 && t > 80) badge = 'GOLD';
              else if (p >= 25 && t > 50) badge = 'SILVER';
              
              return { ...cleanStation, badge };
          });
          
          return { stations };

      } catch (e) {
          console.error("❌ [DB] Adaptive Search Failed:", e.message);
          return { stations: [] };
      }
  }
  
  async close() { await this.pool.end(); }
}

module.exports = new DatabaseManager();