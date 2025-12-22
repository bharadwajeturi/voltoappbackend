const { Pool } = require('pg');
const config = require('../config/configuration');

class DatabaseManager {
  constructor() {
    this.pool = new Pool(config.db);
  }

  // 🟢 CORE: Data Normalization & Brand Logic
  applyBrandHeuristic(station) {
      const BRANDS = ['Tata Power', 'Zeon', 'Statiq', 'Shell', 'Jio-bp', 'Hyundai', 'Mahindra', 'ChargeZone', 'Glida', 'LionCharge', 'BPCL', 'HPCL', 'Ather'];
      
      // 1. FIX: Handle CSV Double-Escaped JSON (e.g., "[""CCS2""]")
      let connectors = station.connectorTypes || station.connectortypes; 
      
      if (typeof connectors === 'string') {
          try {
              // Step A: Fix CSV double quotes ("" -> ")
              let cleanStr = connectors.replace(/""/g, '"');
              
              // Step B: Remove surrounding quote artifacts if present
              // Sometimes CSV import leaves a wrapping quote like '"["CCS2"]"'
              if (cleanStr.startsWith('"') && cleanStr.endsWith('"')) {
                  cleanStr = cleanStr.slice(1, -1);
              }

              // Step C: Try parsing clean JSON
              const parsed = JSON.parse(cleanStr);
              connectors = Array.isArray(parsed) ? parsed : [parsed];

          } catch (e) {
              // Step D: Fallback - Regex extraction if JSON breaks
              // Extracts words like "CCS2", "Type 2" ignoring brackets/quotes
              const matches = connectors.match(/[a-zA-Z0-9\s-]+/g);
              connectors = matches ? matches.filter(w => w.trim().length > 1) : [];
          }
      }
      
      // Normalize to Array (ensure no nulls)
      station.connectorTypes = Array.isArray(connectors) && connectors.length > 0 
          ? connectors 
          : [];

      // 2. Identify Brand
      const isBrand = BRANDS.some(b => 
        (station.operator && station.operator.toLowerCase().includes(b.toLowerCase())) || 
        (station.name && station.name.toLowerCase().includes(b.toLowerCase()))
      );

      // 3. Power Logic: ONLY update if missing (0 or null)
      let power = parseFloat(station.powerkw);
      if (isNaN(power)) power = 0;

      if (power <= 0) {
          if (isBrand) {
              station.powerkw = 30; // Brand Rescue: Assume decent speed
              station.badge = 'SILVER'; 
              station.trustscore = 80;
              // 🟢 STRICT RULE: We do NOT add dummy connectors here anymore.
          } else {
              station.powerkw = 7.4; // Generic Fallback
              station.badge = 'BRONZE';
              station.trustscore = 60;
          }
      } else {
          // Real data exists -> Keep it!
          station.powerkw = power; 
          station.badge = power >= 50 ? 'PLATINUM' : 'GOLD';
      }

      // 4. Connector Fallback: If empty, mark as "Unknown" (No Dummy Data)
      if (station.connectorTypes.length === 0) {
          station.connectorTypes = ['Unknown'];
      }

      return station;
  }

  // Find Nearby (NearMe Screen)
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

      const query = `
        SELECT 
          s.id, s.name, s.lat, s.lng, s.operator, s.powerkw, 
          s.connectortypes as "connectorTypes", 
          s.trustscore, s.sources, s.address,
          array_remove(array_agg(DISTINCT sa.amenity_type), NULL) as amenities
        FROM stationsmaster s
        LEFT JOIN station_amenities sa ON s.id = sa.station_id
        WHERE ST_DWithin(s.geog, ST_Point($1, $2)::geography, $3) 
        AND (
            s.trustscore > 30 
            OR array_length(s.connectortypes, 1) > 0 
            OR (${keywordFilter})
        )
        GROUP BY s.id
        ORDER BY ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC
        LIMIT 100
      `;
      const result = await this.pool.query(query, [lng, lat, radiusMeters]);
      return result.rows.map(s => this.applyBrandHeuristic(s));
    } catch (error) {
      console.error('Database Error:', error.message);
      return [];
    }
  }

  /**
   * 🟢 ADAPTIVE SEARCH (v7.0)
   * Finds the best stations near a point, filtering by strategy & keywords.
   * Handles: Radius, Power Requirements, Keyword Filtering, and Badging.
   */

  // 🟢 CORE: Adaptive Search (Route Planner)
  /**
   * 🟢 ADAPTIVE SEARCH (v9.5 - Dynamic Radius Support)
   * Now accepts 'radiusOverride' to support Deep Scans.
   */
  async adaptiveSearch(lat, lng, excludeIds = [], strategy = 'FAST', radiusOverride = null) {
      try {
          // 🟢 FIX: Allow Router to override radius (e.g., 100km for Deep Scan)
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

          const query = `
            SELECT 
                s.id, s.name, s.lat, s.lng, s.operator, 
                s.powerkw, s.trustscore, s.address,
                s.connectortypes as "connectorTypes",
                array_remove(array_agg(DISTINCT sa.amenity_type), NULL) as amenities
            FROM stationsmaster s
            LEFT JOIN station_amenities sa ON s.id = sa.station_id
            WHERE ST_DWithin(s.geog, ST_Point($1, $2)::geography, $3) 
            AND s.powerkw >= $4 
            ${excludeClause}
            AND (
                s.trustscore > 30                   
                OR array_length(s.connectortypes, 1) > 0  
                OR (${keywordFilter})               
            )
            GROUP BY s.id
            ORDER BY 
                ST_Distance(s.geog, ST_Point($1, $2)::geography) ASC -- Closest first for routing
            LIMIT 20
          `;
          
          const result = await this.pool.query(query, [lng, lat, radius, minPower]);

          const stations = result.rows.map(s => {
              const cleanStation = this.applyBrandHeuristic ? this.applyBrandHeuristic(s) : s;
              let badge = 'BRONZE';
              const p = parseFloat(cleanStation.powerkw || 0);
              const t = parseFloat(cleanStation.trustscore || 0);
              if (p >= 50 && t > 80) badge = 'GOLD';
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