/**
 * Amenity Fetcher
 * STATUS: OPTIMIZED (OSM Only - Saves Google Quota for Stations)
 */

const fetchOSM = require('./osmFetcher');
// const fetchGoogle = require('./googleFetcher'); // 🟢 DISABLE TO SAVE QUOTA
const { filterAmenitiesByETA } = require('../utils/timeBasedAmenities');

async function fetchAmenities(lat, lng, radiusMeters = 5000, etaTime = null) {
  if (!lat || !lng) return { stations: [], amenities: [] };

  try {
    // 🟢 OPTIMIZATION: Only use OSM. 
    // It's faster, free, and doesn't eat into your 50 req/min Google limit.
    const osmAmenities = await fetchOSM(lat, lng, radiusMeters);

    // Filter by time if provided
    let filteredAmenities = osmAmenities;
    if (etaTime) {
      filteredAmenities = filterAmenitiesByETA(osmAmenities, etaTime);
    }

    return {
      amenities: filteredAmenities,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return { stations: [], amenities: [], error: error.message };
  }
}

module.exports = fetchAmenities;