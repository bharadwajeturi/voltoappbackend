/**
 * Open Charge Map Fetcher (v5.1)
 * Strategy: Community Data
 * - Fetches stations by Radius (Discovery)
 * - Fetches specific Station Details (Enrichment)
 * - Uses "Politeness Policy" (Random delays) to avoid Rate Limits.
 */

const axios = require('axios');
const config = require('../config/configuration');
const { isRelevantStation } = require('../utils/stationFilter');
const { normalizePower } = require('../utils/normalization'); 
const { systemLogger, logCost } = require('../utils/logger');
// 🟢 Helper: Pause execution (Politeness Policy)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 1. DISCOVERY: Fetch Stations by Radius
 */
async function fetchStations(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) return [];

  const startTime = Date.now();
  const radiusKm = radiusMeters / 1000;

  try {
    // 🟢 Anti-Burst: Random delay (100-500ms)
    await sleep(Math.floor(Math.random() * 400) + 100);

    const url = 'https://api.openchargemap.io/v3/poi';
    const apiKey = config.keys.ocm || process.env.OCM_API_KEY;

    systemLogger.debug(`Fetching OCM Radius ${radiusKm}km at ${lat},${lng}`, { label: 'FETCHER_OCM' });

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

        // 🟢 Better Address Construction
        const addrParts = [
            poi.AddressInfo?.AddressLine1,
            poi.AddressInfo?.Town,
            poi.AddressInfo?.StateOrProvince
        ].filter(Boolean);
        const fullAddress = addrParts.join(', ');

        return {
          name: poi.AddressInfo?.Title,
          lat: poi.AddressInfo?.Latitude,
          lng: poi.AddressInfo?.Longitude,
          address: fullAddress || '',
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
        systemLogger.info(`Found ${stations.length} stations in ${duration}ms`, { label: 'FETCHER_OCM' });
    }

    return stations;

  } catch (error) {
    // 🟢 Robust Error Handling
    if (error.response && error.response.status === 429) {
    await logCost(db, 'OPEN_CHARGE_MAP', 'radius_search', 0, 'FAIL');        return [];
    }
    if (error.response && error.response.status === 429) {
        systemLogger.warn('Rate Limit (429) - Skipping tile.', { label: 'FETCHER_OCM' });
        return [];
    }
    systemLogger.error(`Fetch Failed: ${error.message}`, { label: 'FETCHER_OCM' });
    return [];
  }
}

/**
 * 2. ENRICHMENT: Fetch Specific Station Details
 * Used by stationRoutes.js to get Technical Specs for Route Stops
 */
async function fetchStationDetails(ocmId) {
    if (!ocmId) return null;
    
    // Clean ID (remove 'ocm_' prefix if present)
    const cleanId = ocmId.toString().replace('ocm_', '');

    try {
        const url = `https://api.openchargemap.io/v3/poi`;
        const apiKey = config.keys.ocm || process.env.OCM_API_KEY;

        const response = await axios.get(url, {
            params: {
                id: cleanId, // Fetch specific station
                key: apiKey,
                output: 'json'
            },
            timeout: 5000
        });

        if (!response.data || response.data.length === 0) return null;
        const poi = response.data[0]; // OCM returns an array even for ID search

        // Extract Tech Specs
        let maxPower = 0;
        let connectors = [];
        
        if (poi.Connections) {
            connectors = poi.Connections.map(c => c.ConnectionType?.Title).filter(Boolean);
            maxPower = Math.max(...poi.Connections.map(c => c.PowerKW || 0));
        }

        return {
            powerkw: normalizePower(maxPower),
            connectors: connectors.length > 0 ? connectors : ['Unknown'],
            status: poi.StatusType?.Title || 'Unknown'
        };

    } catch (error) {
    // 泙 Robust Error Handling
    if (error.response && error.response.status === 429) {
        // 🟢 FIX: Removed 'db' usage to prevent crash. Just log to systemLogger.
        systemLogger.warn('Rate Limit (429) - OCM Radius Search skipped.', { label: 'FETCHER_OCM' });
        return [];
    }
    systemLogger.error(`Fetch Failed: ${error.message}`, { label: 'FETCHER_OCM' });
    return [];
  }
}

module.exports = { fetchStations, fetchStationDetails };