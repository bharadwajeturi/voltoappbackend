/**
 * Google Places API Fetcher
 * Fetches EV charging stations from Google Places
 * 
 * UPDATED: 
 * - Accepts lat/lng/radius parameters (not hard-coded)
 * - Uses rate limiter (max 50 calls/min)
 * - Adds 200ms delay between calls
 * - Returns complete station data
 */

const axios = require('axios');
const rateLimiter = require('../utils/rateLimiter');
const { getDistanceKm } = require('../utils/distance');
const config = require('../config/configuration');

async function fetchGoogle(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) {
    console.warn('[Google] Missing lat/lng, skipping fetch');
    return [];
  }

  console.log(
    `\n[Google] Fetching chargers within ${radiusMeters / 1000}km of ${lat},${lng}`
  );

  try {
    // Apply rate limiting (RULE #1)
    const results = await rateLimiter.executeWithLimit(async () => {
      const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

      const response = await axios.get(url, {
        params: {
          location: `${lat},${lng}`,
          radius: Math.min(radiusMeters, 50000), // Google max is 50km
          type: 'electric_vehicle_charging_station',
          key: config.keys.google,
        },
        timeout: 10000,
      });

      if (!response.data.results) {
        console.log('[Google] No results found');
        return [];
      }

      console.log(`[Google] Found ${response.data.results.length} stations`);
      return response.data.results;
    }, 200); // 200ms delay between calls

    // Transform to standard format
    const stations = results.map(place => ({
      name: place.name || 'Unknown',
      lat: place.geometry?.location?.lat || lat,
      lng: place.geometry?.location?.lng || lng,
      address: place.vicinity || place.formatted_address || '',
      operator: 'Google Places',
      powerkw: 0, // Google doesn't provide power info
      connectorTypes: [],
      trustscore: 70,
      amenities: place.types || [],
      externalId: place.place_id,
      source: 'google',
      openingHours: place.opening_hours?.weekday_text || [],
    }));

    console.log(`[Google] Transformed ${stations.length} stations`);
    return stations;
  } catch (error) {
    console.error(`[Google] Error: ${error.message}`);
    if (error.response?.status === 429) {
      console.error('[Google] Rate limited by API');
    }
    return [];
  }
}

module.exports = fetchGoogle;
