/**
 * Google Places Fetcher (Cost-Optimized v4.4)
 * Strategy: "Cheap Discovery"
 * Use Field Masking to get ID + Location for cheap.
 * 🟢 UPDATE: Blocks 2-Wheeler Stations (Ather, Ola, Hero)
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
    // Removed Ather/Ola from map because we filter them out anyway
};

async function fetchStations(lat, lng, radiusMeters = 50000) {
  if (!lat || !lng) return [];

  // 1. Build Text Query
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
                     'X-Goog-FieldMask': 'places.id,places.location,places.displayName,places.types,places.formattedAddress'
                 },
                 timeout: 8000
             }
         );
    });

    const results = response.data.places || [];

    const stations = results.map(place => {
      const name = place.displayName?.text || 'Unknown Station';
      const address = place.formattedAddress || "";
      const types = place.types || [];

      // 🟢 COST FILTER: Discard 2-Wheeler Stations immediately
      // This prevents us from saving useless data or routing cars to scooter plugs.
      if (name.match(/ather|ola hypercharger|hero electric|vida|scooter|bike|2w|two wheeler/i)) return null;
      if (address.match(/ather|ola hypercharger|hero electric|vida|scooter|bike|2w|two wheeler/i)) return null;

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
        address: address || "Address Unavailable",    
        operator: operator,
        
        // 🟢 Power is 0 for now (Will be fixed by Brand Heuristic in DB)
        powerkw: 0, 
        connectorTypes: ['Unknown'],
        trustscore: 70, // Base Google Trust
        amenities: types,
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