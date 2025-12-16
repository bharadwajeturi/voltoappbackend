/**
 * Google Places API Fetcher
 * STATUS: STRICT (No Power Assumptions | Base Trust 70)
 */

const axios = require('axios');
const rateLimiter = require('../utils/rateLimiter');
const config = require('../config/configuration');
const { isRelevantStation } = require('../utils/stationFilter');
const { normalizePower } = require('../utils/normalization'); 

// 🟢 BRAND MAPPING ONLY (No Power Assumptions)
// We only use this to clean up the "Operator Name" for better UI.
const BRAND_INTELLIGENCE = {
    'tata': { operator: 'Tata Power' },
    'tata power': { operator: 'Tata Power' },
    'statiq': { operator: 'Statiq' },
    'zeon': { operator: 'Zeon Charging' },
    'jio-bp': { operator: 'Jio-bp Pulse' },
    'electricfuel': { operator: 'ElectricFuel' },
    'fortum': { operator: 'Fortum Charge & Drive' },
    'charge and drive': { operator: 'Fortum Charge & Drive' },
    'ather': { operator: 'Ather Grid' }, 
    'ola': { operator: 'Ola Hypercharger' }
};

async function fetchStations(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) return [];

  const startTime = Date.now();

  try {
    const response = await rateLimiter.executeWithLimit(async () => {
         return await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { 
             params: {
                location: `${lat},${lng}`,
                radius: Math.min(radiusMeters, 50000),
                type: 'electric_vehicle_charging_station',
                // 🟢 Keep Keyword: Critical for finding brands like Statiq/Tata
                keyword: 'EV Charging Station', 
                key: config.keys.google,
             },
             timeout: 6000 
         });
    }, 100);

    const results = response.data.results || [];

    const stations = results.map(place => {
      let finalName = place.name;
      let finalOperator = 'Google Places';
      
      // 🟢 RULE 1: Power is ALWAYS Unknown (0) for Google Brands
      // Unless explicitly found (rare), we do not guess.
      let estimatedPower = 0; 

      // 🟢 RULE 2: Base Trust is 70
      let detectedTrust = 70;

      // Brand Logic: Only fix the Name and Operator
      const nameLower = finalName.toLowerCase();
      
      for (const [key, info] of Object.entries(BRAND_INTELLIGENCE)) {
          if (nameLower.includes(key)) {
              finalOperator = info.operator;
              
              // Clean up name (e.g. "Tata Power Charging Station" -> "Tata Power")
              if (finalName === 'Electric Vehicle Charging Station') {
                  finalName = `${info.operator} Station`;
              }
              break; 
          }
      }

      // Fallback for generic names using Vicinity
      if (finalName.toLowerCase() === 'electric vehicle charging station' && place.vicinity) {
          const locationPart = place.vicinity.split(',')[0];
          if (locationPart && locationPart.length > 3) {
              finalName = `${locationPart} (EV Station)`;
          }
      }

      return {
        name: finalName || 'Unknown Station',
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        address: place.vicinity || '',
        operator: finalOperator,
        
        // 🟢 STRICT: Normalize to 0 if unknown. 
        // We pass '0' as the fallback so it doesn't default to 15 or 7.4
        powerkw: normalizePower(0, 0), 
        
        // Connectors unknown
        connectorTypes: ['Unknown'], 
        
        // 🟢 STRICT: Always 70
        trustscore: detectedTrust,
        
        amenities: place.types || [],
        externalId: place.place_id,
        source: 'google',
      };
    })
    // ⚠️ CRITICAL: Ensure your 'isRelevantStation' filter allows stations with powerkw = 0
    .filter(station => isRelevantStation(station));

    const duration = Date.now() - startTime;
    if (stations.length > 0) {
        console.log(`[Google] ✅ Found ${stations.length} stations in ${duration}ms`);
    }

    return stations;

  } catch (error) {
    console.error(`[Google] Error: ${error.message}`);
    return [];
  }
}

module.exports = { fetchStations };