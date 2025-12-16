/**
 * Station Amenity Service
 * -----------------------
 * Responsible for:
 * - Fetching restaurants ONCE per area
 * - Matching them to ALL nearby stations
 * - Saving relationships in station_amenities table
 */

const fetchRestaurantsForArea = require('../fetchers/osmFetcher');
// FIX: Import db correctly from the root data_aggregator
const { db } = require('../../data_aggregator'); 

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

async function linkRestaurantsToStations(areaLat, areaLng) {
  console.log('[AmenityService] Starting amenity enrichment');

  try {
    // ✅ 1. Get stations from DB (2km area)
    const stations = await db.query(
        `SELECT id, lat, lng FROM stationsmaster 
        WHERE ST_DWithin(
        geog, 
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
        2000
        )`,
        [areaLng, areaLat]
    );

    if (stations.rows.length === 0) {
        console.log('[AmenityService] No stations found in area');
        return;
    }

    // ✅ 2. Fetch restaurants ONCE
    const restaurants = await fetchRestaurantsForArea(areaLat, areaLng, 2000);

    if (restaurants.length === 0) {
        console.log('[AmenityService] No restaurants found');
        return;
    }

    // ✅ 3. Save relationships
    // Note: If using 'db.pool', use that. If 'db' is the pool, use 'db'.
    // data_aggregator exports 'db' which is a Pool.
    const client = await db.connect(); 
    try {
        await client.query('BEGIN');

        for (const station of stations.rows) {
        for (const r of restaurants) {
            const dist = distanceMeters(
            station.lat,
            station.lng,
            r.lat,
            r.lng
            );

            // ✅ Your rule: 500 meters
            if (dist <= 500) {
            await client.query(
                `
                INSERT INTO station_amenities
                (station_id, name, type, lat, lng, distance_m, source)
                VALUES
                ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING
                `,
                [
                station.id,
                r.name,
                r.type,
                r.lat,
                r.lng,
                Math.round(dist),
                r.source || 'osm'
                ]
            );
            }
        }
        }
        
        await client.query('COMMIT');
        console.log(`[AmenityService] Linked amenities for ${stations.rows.length} stations`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('[AmenityService] Transaction failed:', e);
    } finally {
        client.release();
    }
  } catch (error) {
      console.error('[AmenityService] Error:', error);
  }
}

module.exports = { linkRestaurantsToStations };