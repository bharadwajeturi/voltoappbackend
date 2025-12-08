/**
 * Amenity Fetcher
 * Combines amenities from multiple sources
 * Filters by time of day and relevance
 * 
 * UPDATED:
 * - Accepts lat/lng/radius parameters
 * - Time-based filtering (breakfast, lunch, snack, dinner, late-night)
 * - Links amenities to nearby stations
 */

const fetchOSM = require('./osmFetcher');
const fetchGoogle = require('./googleFetcher');
const rateLimiter = require('../utils/rateLimiter');
const { filterAmenitiesByETA } = require('../utils/timeBasedAmenities');
const { getDistanceKm } = require('../utils/distance');

async function fetchAmenities(lat, lng, radiusMeters = 5000, etaTime = null) {
  if (!lat || !lng) {
    console.warn('[Amenities] Missing lat/lng, skipping fetch');
    return { stations: [], amenities: [] };
  }

  console.log(
    `[Amenities] Fetching amenities within ${radiusMeters / 1000}km of ${lat},${lng}`
  );

  try {
    // Get amenities from multiple sources
    const [osmAmenities, googlePlaces] = await Promise.all([
      fetchOSM(lat, lng, radiusMeters, true),
      fetchGooglePlaces(lat, lng, radiusMeters, rateLimiter),
    ]);

    // Combine and deduplicate
    const allAmenities = [...osmAmenities, ...googlePlaces];
    const uniqueAmenities = deduplicateAmenities(allAmenities);

    // Filter by time if provided
    let filteredAmenities = uniqueAmenities;
    if (etaTime) {
      filteredAmenities = filterAmenitiesByETA(uniqueAmenities, etaTime);
    }

    console.log(`[Amenities] Total: ${allAmenities.length}, Unique: ${uniqueAmenities.length}, Filtered: ${filteredAmenities.length}`);

    return {
      stations: [],
      amenities: filteredAmenities,
      timeFiltered: !!etaTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Amenities] Error: ${error.message}`);
    return { stations: [], amenities: [], error: error.message };
  }
}

/**
 * Fetch Google Places amenities with rate limiting
 */
async function fetchGooglePlaces(lat, lng, radiusMeters, rateLimiter) {
  try {
    return await rateLimiter.executeWithLimit(async () => {
      const axios = require('axios');
      const config = require('../config/configuration');

      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        {
          params: {
            location: `${lat},${lng}`,
            radius: Math.min(radiusMeters, 50000),
            type: 'restaurant',
            key: config.keys.google,
          },
          timeout: 10000,
        }
      );

      return (response.data.results || []).map(place => ({
        name: place.name,
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        type: 'Restaurant',
        cuisineType: place.types?.join(',') || '',
        openingHours: place.opening_hours?.weekday_text?.join('; ') || '',
        source: 'google',
        externalId: `google_${place.place_id}`,
      }));
    }, 200);
  } catch (error) {
    console.warn(`[Amenities] Google fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Deduplicate amenities from multiple sources
 * Considers same name + similar location as duplicate
 */
function deduplicateAmenities(amenities) {
  const seen = new Map();
  const unique = [];

  for (const amenity of amenities) {
    if (!amenity.name || !amenity.lat || !amenity.lng) continue;

    // Create key based on name and location (with 100m tolerance)
    const key = `${amenity.name}_${Math.round(amenity.lat * 1000)}_${Math.round(amenity.lng * 1000)}`;

    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(amenity);
    }
  }

  return unique;
}

module.exports = fetchAmenities;
