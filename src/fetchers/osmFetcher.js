/**
 * OSM Restaurant Fetcher (Robust)
 * -------------------------------
 * Features:
 * 1. Server Rotation: Uses 3 different free mirrors.
 * 2. Failover: If one fails (429/500), it tries the next one instantly.
 * 3. Timeout: Fails fast (4s) so the user doesn't wait.
 * 4. Validation: Prevents 400 Bad Request errors from NaN coords.
 * 5. 🟢 LOGGING: Uses systemLogger for file traces.
 */

const axios = require('axios');
const { systemLogger, logCost } = require('../utils/logger');

// 🟢 LIST OF FREE OVERPASS MIRRORS
const SERVERS = [
    'https://overpass-api.de/api/interpreter',       // Main (Strict)
    'https://overpass.kumi.systems/api/interpreter', // Alternative 1
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter', // Alternative 2
    'https://api.openstreetmap.fr/oapi/interpreter'  // Alternative 3 (France)
];

// Helper: Pause execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchRestaurantsForArea(lat, lng, radiusMeters = 2000) {
  // 🟢 FIX: Strict Input Validation
  const fLat = parseFloat(lat);
  const fLng = parseFloat(lng);

  if (isNaN(fLat) || isNaN(fLng)) {
      if (systemLogger) systemLogger.warn(`[OSM] Invalid Coordinates: ${lat},${lng}. Skipping.`, { label: 'OSM' });
      return [];
  }

  // 🟢 Reduce radius slightly to 1.5km to be lighter on the API
  const radiusKm = 1.5; 
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(fLat * Math.PI / 180));

  // Construct Bounding Box
  const bbox = `${fLat - latDelta},${fLng - lngDelta},${fLat + latDelta},${fLng + lngDelta}`;

  // Simple, efficient query for food
  const query = `[out:json][timeout:4];
    (
      node["amenity"~"restaurant|cafe|fast_food"](${bbox});
      way["amenity"~"restaurant|cafe|fast_food"](${bbox});
    );
    out center;`;

  // Try up to 2 different servers before giving up
  for (let i = 0; i < 2; i++) {
      // Pick a random server to distribute load
      const server = SERVERS[Math.floor(Math.random() * SERVERS.length)];
      
      try {
        if (systemLogger) systemLogger.debug(`Attempt ${i+1}: Fetching from ${new URL(server).hostname}...`, { label: 'OSM' });
        
        const res = await axios.post(
          server,
          `data=${encodeURIComponent(query)}`,
          { 
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              timeout: 5000 // 5s hard timeout
          }
        );

        if (!res.data || !Array.isArray(res.data.elements)) {
          return [];
        }

        const results = res.data.elements
          .map(e => ({
            name: e.tags?.name || 'Local Eatery',
            type: e.tags?.amenity || 'food',
            lat: e.lat || e.center?.lat,
            lng: e.lon || e.center?.lon,
            source: 'osm'
          }))
          .filter(r => r.lat && r.lng);

        if (systemLogger) systemLogger.info(`✅ Success: Found ${results.length} amenities.`, { label: 'OSM' });
        return results;

      } catch (err) {
        if (systemLogger) systemLogger.warn(`⚠️ Failed on ${server}: ${err.message}`, { label: 'OSM' });
        // Wait 200ms before next try
        await sleep(200);
      }
  }

  await logCost(db, 'OPEN_STREET_MAP', 'amenity_search', 0, 'FAIL');
  return [];
}

module.exports = fetchRestaurantsForArea;