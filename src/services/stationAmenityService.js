/**
 * Station Amenity Service
 * STATUS: FIXED (Column Names & Deadlock Prevention)
 */

const fetchRestaurantsForArea = require('../fetchers/osmFetcher');

// Haversine distance in METERS
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function linkRestaurantsToStations(areaLat, areaLng, dbClient) {
  // console.log('[AmenityService] Starting amenity enrichment');

  try {
    // 1. Get stations from DB (2km area)
    const stations = await dbClient.query(
      `SELECT id, lat, lng FROM stationsmaster 
       WHERE ST_DWithin(geog, ST_MakePoint($1, $2)::geography, 2000)`,
      [areaLng, areaLat]
    );

    if (stations.rows.length === 0) return;

    // 2. Fetch from OSM
    const restaurants = await fetchRestaurantsForArea(areaLat, areaLng);
    if (!restaurants || restaurants.length === 0) return;

    // 3. Match & Save
    // 🟢 Deadlock Fix: Jitter the start time slightly
    await new Promise(r => setTimeout(r, Math.random() * 200));

    for (const station of stations.rows) {
      for (const r of restaurants) {
        const dist = distanceMeters(station.lat, station.lng, r.lat, r.lng);

        if (dist <= 500) {
          await dbClient.query(
            `
            INSERT INTO station_amenities
            (station_id, name, amenity_type, lat, lng, distance_m, source) 
            VALUES
            ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (station_id, name) DO NOTHING
            `,
            [
              station.id,
              r.name,
              r.type || 'unknown', // 🟢 Fix: Ensure 'amenity_type' is never null
              r.lat,
              r.lng,
              Math.round(dist),
              r.source || 'osm'
            ]
          );
        }
      }
    }
    
    // console.log(`[AmenityService] Linked amenities for ${stations.rows.length} stations`);
  } catch (e) {
    if (e.code === '40P01') { // Deadlock code
        console.warn('[AmenityService] Deadlock detected, skipping this batch.');
    } else {
        console.error('[AmenityService] Error:', e.message);
    }
  }
}

module.exports = { linkRestaurantsToStations };