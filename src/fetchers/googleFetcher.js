/**
 * Google Places Fetcher (Cost-Optimized v4.3)
 * Strategy: "Cheap Discovery"
 * Use Field Masking to get ID + Location for cheap.
 */

const axios = require('axios');
const rateLimiter = require('../utils/rateLimiter');
const config = require('../config/configuration');
const { isRelevantStation } = require('../utils/stationFilter');

// 🟢 BRAND INTELLIGENCE (For UI Cleanup only)
const BRAND_MAP = {
    'tata': 'Tata Power',
    'statiq': 'Statiq',
    'zeon': 'Zeon Charging',
    'jio-bp': 'Jio-bp Pulse',
    'shell': 'Shell Recharge',
    'ather': 'Ather Grid',
    'ola': 'Ola Hypercharger'
};

async function fetchStations(lat, lng, radiusMeters = 50000) {
  if (!lat || !lng) return [];

  // 🟢 1. Build Text Query (More effective/cheaper than Nearby Search for EV)
  const textQuery = "EV Charging Station";

  try {
    const response = await rateLimiter.executeWithLimit(async () => {
         return await axios.post(
             'https://places.googleapis.com/v1/places:searchText',
             {
                 textQuery: textQuery,
                 // Bias towards the tile center
                 locationBias: {
                     circle: {
                         center: { latitude: lat, longitude: lng },
                         radius: radiusMeters 
                     }
                 }
             },
             {
                 headers: {
                     'Content-Type': 'application/json',
                     'X-Goog-Api-Key': config.keys.google,
                     // 💰 FIELD MASKING: The Money Saver
                     // Only fetch what we need to identify the station.
                     'X-Goog-FieldMask': 'places.id,places.location,places.displayName,places.types'
                 },
                 timeout: 8000
             }
         );
    });

    const results = response.data.places || [];

    const stations = results.map(place => {
      const name = place.displayName?.text || 'Unknown Station';
      
      // 🟢 COST FILTER: Discard 2-Wheeler Stations immediately
      if (name.match(/scooter|bike|2w|two wheeler/i)) return null;

      // Operator Cleanup
      let operator = 'Google Places';
      const lowerName = name.toLowerCase();
      for (const [key, val] of Object.entries(BRAND_MAP)) {
          if (lowerName.includes(key)) operator = val;
      }

      return {
        name: name,
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        address: '', // We don't pay for address in discovery phase
        operator: operator,
        
        // 🟢 Power is 0 for now (Will be fixed by Brand Heuristic in DB)
        powerkw: 0, 
        connectorTypes: ['Unknown'],
        trustscore: 70, // Base Google Trust
        amenities: place.types || [],
        externalId: place.id,
        source: 'google',
      };
    }).filter(s => s !== null && isRelevantStation(s));

    if (stations.length > 0) {
        console.log(`[Google Sniper] 🎯 Discovered ${stations.length} candidates.`);
    }

    return stations;

  } catch (error) {
    console.error(`[Google] Error: ${error.message}`);
    return [];
  }
}

module.exports = { fetchStations };