/**
 * Google Places Fetcher (Cost-Optimized v5.1)
 * Strategy: "Sniper Discovery"
 * 1. Use Field Masking to get minimal data (ID + Location).
 * 2. Aggressive Filtering: Blocks 2-wheelers & known low-power hubs.
 * 3. NO Rich Amenities here (Saved for Lazy Load).
 * 4. Normalizes Connector Types (CCS2, Type 2, etc.)
 */

const axios = require('axios');
const rateLimiter = require('../utils/rateLimiter');
const config = require('../config/configuration');
const { isRelevantStation } = require('../utils/stationFilter');
const { logCost, systemLogger } = require('../utils/logger');
const { db } = require('../../data_aggregator'); // For DB logging 

// 🟢 BRAND INTELLIGENCE (For UI Cleanup only)
const BRAND_MAP = {
    'tata': 'Tata Power',
    'statiq': 'Statiq',
    'zeon': 'Zeon Charging',
    'jio-bp': 'Jio-bp Pulse',
    'shell': 'Shell Recharge',
    'chargezone': 'ChargeZone',
    'glida': 'Glida',
    'relux': 'Relux Electric'
};

// 🟢 CONNECTOR NAME MAPPING
const CONNECTOR_MAP = {
    'EV_CONNECTOR_TYPE_CCS_COMBO_2': 'CCS2',
    'EV_CONNECTOR_TYPE_CCS_COMBO_1': 'CCS1',
    'EV_CONNECTOR_TYPE_TYPE_2': 'Type 2',
    'EV_CONNECTOR_TYPE_CHADEMO': 'CHAdeMO',
    'EV_CONNECTOR_TYPE_J1772': 'Type 1',
    'EV_CONNECTOR_TYPE_TESLA': 'Tesla',
    'EV_CONNECTOR_TYPE_UNSPECIFIED': 'Unknown'
};

function normalizeConnector(rawType) {
    if (!rawType) return 'Unknown';
    return CONNECTOR_MAP[rawType] || rawType.replace('EV_CONNECTOR_TYPE_', '').replace(/_/g, ' ');
}

// 🚫 BLOCKLIST: Aggressively filter out 2-Wheeler & Slow Charging Contexts
const BLOCK_KEYWORDS = [
    'ather', 'ola hypercharger', 'hero electric', 'vida', 
    'scooter', 'bike', '2w', 'two wheeler', 
    'e-rickshaw', 'swap station', 'battery swapping',
    'apartments', 'residency', 'private', 'staff only'
];

async function fetchStations(lat, lng, radiusMeters = 50000) {
  if (!lat || !lng) return [];

  // 1. Build Text Query
  const textQuery = "EV Charging Station";

  try {
    const response = await rateLimiter.executeWithLimit(async () => {
         // Log the "Attempt" cost (1 Unit)
         await logCost(db, 'GOOGLE_PLACES', 'searchText', 1, 'ATTEMPT');

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
                     // We ONLY ask for ID, Name, Address, Location, and basic Types.
                     // We DO NOT ask for photos, reviews, or phone numbers here.
                     'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.evChargeOptions,places.types'
                 },
                 timeout: 8000
             }
         );
    });

    const results = response.data.places || [];

    const stations = results.map(place => {
      const name = place.displayName?.text || 'Unknown Station';
      const address = place.formattedAddress || "Address Unavailable";
      
      // 🟢 ROBUST FILTERING LOGIC
      const lowerName = name.toLowerCase();
      const lowerAddress = address.toLowerCase();

      // 1. Check against Blocklist
      if (BLOCK_KEYWORDS.some(k => lowerName.includes(k) || lowerAddress.includes(k))) {
          return null; 
      }

      // 2. Operator Cleanup
      let operator = 'Google Places';
      for (const [key, val] of Object.entries(BRAND_MAP)) {
          if (lowerName.includes(key)) operator = val;
      }

      // 3. Extract Connectors (If Google gives them cheaply)
      // Note: Google's "evChargeOptions" is often empty in the search response, 
      // but if it exists, we grab it to help the "isRelevantStation" filter.
      let connectors = ['Unknown'];
      let power = 0;

      if (place.evChargeOptions && place.evChargeOptions.connectorAggregation) {
          // 🟢 Fix: Map raw types to readable names
          connectors = place.evChargeOptions.connectorAggregation.map(c => normalizeConnector(c.type));
          power = place.evChargeOptions.connectorAggregation.reduce((max, c) => Math.max(max, parseFloat(c.maxChargeRateKw) || 0), 0);
      }

      return {
        name: name,
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        address: address,    
        operator: operator,
        
        powerkw: power, // 0 if unknown (DB will fix this via Brand Logic)
        connectorTypes: connectors,
        trustscore: 70, // Base Google Trust
        amenities: place.types || [], // Just basic tags, NO expensive amenity search
        externalId: place.id,
        source: 'google',
      };
    }).filter(s => s !== null && isRelevantStation(s));

    systemLogger.info(`Google valid stations: ${stations.length}`, { label: 'GOOGLE_FILTER' });

    // Log Success
    await logCost(db, 'GOOGLE_PLACES', 'searchText', 1, 'SUCCESS');

    if (stations.length > 0) {
        systemLogger.debug(`[Google Sniper] Discovered ${stations.length} candidates`, { label: 'FETCHER_GOOGLE' });
                console.log(`[Google Sniper] 🎯 Discovered ${stations.length} candidates.`);

    }

    return stations;

  } catch (error) {
    systemLogger.error(`Google Fetch Failed: ${error.message}`, { label: 'FETCHER_GOOGLE' });
    await logCost(db, 'GOOGLE_PLACES', 'searchText', 0, 'FAIL');
    return [];
  }
}

module.exports = { fetchStations };