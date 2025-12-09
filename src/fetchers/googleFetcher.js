/**
 * Google Places API Fetcher
 * Fetches EV charging stations from Google Places
 * * UPDATED: 
 * - Handles Pagination (Next Page Token) to get >20 results
 * - Uses rate limiter
 * - Adds delay between pages
 */

const axios = require('axios');
const rateLimiter = require('../utils/rateLimiter');
const config = require('../config/configuration');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchStations(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) {
    console.warn('[Google] Missing lat/lng, skipping fetch');
    return [];
  }

  // Google allows max 50km radius
  const validRadius = Math.min(radiusMeters, 50000);
  console.log(`\n[Google] Fetching chargers within ${validRadius/1000}km of ${lat},${lng}`);

  let allResults = [];
  let nextPageToken = null;

  try {
    // Loop up to 3 times (Google limit) to get max 60 results
    for (let i = 0; i < 3; i++) {
        
        // Prepare URL parameters
        const params = {
          location: `${lat},${lng}`,
          radius: validRadius,
          type: 'electric_vehicle_charging_station',
          key: config.keys.google,
        };

        // Add token if this is page 2 or 3
        if (nextPageToken) {
            params.pagetoken = nextPageToken;
            // Google requires ~2s wait before a token becomes valid
            await sleep(2000); 
        }

        // Execute Request (with Rate Limiter)
        const response = await rateLimiter.executeWithLimit(async () => {
             return await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { 
                 params, 
                 timeout: 10000 
             });
        }, 200);

        const data = response.data;
        
        if (data.results && data.results.length > 0) {
            allResults = [...allResults, ...data.results];
            console.log(`[Google] Page ${i+1}: Found ${data.results.length} stations`);
        }

        // Check if there is another page
        nextPageToken = data.next_page_token;
        if (!nextPageToken) break; // Stop if no more pages
    }

    // Transform to standard format
    const stations = allResults.map(place => ({
      name: place.name || 'Unknown',
      lat: place.geometry?.location?.lat || lat,
      lng: place.geometry?.location?.lng || lng,
      address: place.vicinity || place.formatted_address || '',
      operator: 'Google Places',
      powerkw: 0, 
      connectorTypes: [],
      trustscore: 70,
      amenities: place.types || [],
      externalId: place.place_id,
      source: 'google',
      openingHours: place.opening_hours?.weekday_text || [],
    }));

    console.log(`[Google] Total Transformed: ${stations.length} stations`);
    return stations;

  } catch (error) {
    console.error(`[Google] Error: ${error.message}`);
    return [];
  }
}

module.exports = { fetchStations };