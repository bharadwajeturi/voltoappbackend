/**
 * OSM Restaurant Fetcher (Robust)
 * -------------------------------
 * Features:
 * 1. Server Rotation: Uses 3 different free mirrors.
 * 2. Failover: If one fails (429/500), it tries the next one instantly.
 * 3. Timeout: Fails fast (4s) so the user doesn't wait.
 */

const axios = require('axios');

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
  if (!lat || !lng) return [];

  // 🟢 Reduce radius slightly to 1.5km to be lighter on the API
  const radiusKm = 1.5; 
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const bbox = `
    ${lat - latDelta},
    ${lng - lngDelta},
    ${lat + latDelta},
    ${lng + lngDelta}
  `;

  // Optimized Query: Only essential data
  const query = `
    [out:json][timeout:5];
    (
      node["amenity"~"restaurant|cafe|fast_food|food_court"]( ${bbox} );
      way["amenity"~"restaurant|cafe|fast_food|food_court"]( ${bbox} );
    );
    out center tags;
  `;

  // 🟢 ROTATION LOGIC
  // Try up to 2 different servers before giving up
  for (let i = 0; i < 2; i++) {
      // Pick a random server to distribute load
      const server = SERVERS[Math.floor(Math.random() * SERVERS.length)];
      
      try {
        console.log(`[OSM] Attempt ${i+1}: Fetching from ${new URL(server).hostname}...`);
        
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

        console.log(`[OSM] ✅ Success: Found ${results.length} amenities.`);
        return results;

      } catch (err) {
        console.warn(`[OSM] ⚠️ Failed on ${server}: ${err.message}`);
        // If it's the last attempt, return empty. Otherwise loop continues.
        if (i === 1) return [];
        await sleep(500); // Wait 0.5s before retrying next server
      }
  }
  
  return [];
}

module.exports = fetchRestaurantsForArea;