const axios = require('axios');
const config = require('../config/configuration');
const { isRelevantStation } = require('../utils/stationFilter');
const { normalizePower } = require('../utils/normalization'); 

// 🟢 Helper: Pause execution (Politeness Policy)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchStations(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) return [];

  const startTime = Date.now();
  const radiusKm = radiusMeters / 1000;

  try {
    // 🟢 1. Add random delay to prevent burst rate-limiting (100-500ms)
    await sleep(Math.floor(Math.random() * 400) + 100);

    const url = 'https://api.openchargemap.io/v3/poi';
    const apiKey = config.keys.ocm || process.env.OCM_API_KEY;

    const response = await axios.get(url, {
      params: {
        output: 'json', // Strict compliance
        latitude: lat,
        longitude: lng,
        distance: radiusKm,
        distanceunit: 'KM',
        maxresults: 100,
        key: apiKey,
        compact: true, 
        verbose: false,
      },
      headers: {
        'User-Agent': 'VoltPath/1.0',
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (!response.data || !Array.isArray(response.data)) return [];

    const stations = response.data.map(poi => {
        let rawPower = 0;
        if (poi.Connections) {
            rawPower = Math.max(...poi.Connections.map(c => c.PowerKW || 0));
        }

        // Use Normalizer
        const power = normalizePower(rawPower, 3.3);

        return {
          name: poi.AddressInfo?.Title,
          lat: poi.AddressInfo?.Latitude,
          lng: poi.AddressInfo?.Longitude,
          address: poi.AddressInfo?.AddressLine1 || '',
          operator: poi.OperatorInfo?.Title || 'OCM',
          powerkw: power,
          connectorTypes: (poi.Connections || [])
            .map(c => c.ConnectionType?.Title)
            .filter(Boolean),
          trustscore: 85,
          source: 'ocm',
          externalId: `ocm_${poi.ID}`
        };
      })
      .filter(station => isRelevantStation(station));

    const duration = Date.now() - startTime;
    if (stations.length > 0) {
        console.log(`[OCM] ✅ Found ${stations.length} stations in ${duration}ms`);
    }

    return stations;

  } catch (error) {
    // 🟢 2. Robust Error Handling
    if (error.response && error.response.status === 429) {
        console.warn('[OCM] Rate Limit (429) - Skipping tile.');
        return [];
    }
    // Silent fail for timeouts/network issues to keep flow moving, but log it
    // console.error(`[OCM] Error: ${error.message}`);
    return [];
  }
}

module.exports = { fetchStations };