const axios = require('axios');
const config = require('../config/configuration');
const { getDistanceKm } = require('../utils/distance');

/**
 * OCM Fetcher - Fetch chargers from Open Charge Map API
 * 
 * RULE #1: Rate limiting applied at global level
 * Uses dynamic lat/lng parameters (no hard-coded coordinates)
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusMeters - Search radius (default 5000m)
 * @returns {Array} - Array of transformed stations
 */
async function fetchOCM(lat, lng, radiusMeters = 5000) {
  // Validate input
  if (!lat || !lng) {
    console.warn('[OCM] Missing lat/lng, skipping fetch');
    return [];
  }

  console.log(
    `[OCM] Fetching chargers within ${radiusMeters / 1000}km of ${lat},${lng}`
  );

  try {
    const radiusKm = radiusMeters / 1000;
    const url = 'https://api.openchargemap.io/v3/poi';

    // Fetch from OCM API with dynamic parameters
    const response = await axios.get(url, {
      params: {
        latitude: lat,
        longitude: lng,
        distance: radiusKm,
        distanceunit: 'KM',
        maxresults: 100,
        key: config.keys.ocm,
      },
      timeout: 10000,
    });

    // Validate response
    if (!response.data || !Array.isArray(response.data)) {
      console.log('[OCM] No results found');
      return [];
    }

    console.log(`[OCM] Found ${response.data.length} stations`);

    // Transform to standard format
    const stations = response.data
      .filter(
        poi =>
          poi.AddressInfo &&
          poi.AddressInfo.Latitude &&
          poi.AddressInfo.Longitude
      )
      .map(poi => ({
        name: poi.AddressInfo?.Title || 'Unknown',
        lat: poi.AddressInfo.Latitude,
        lng: poi.AddressInfo.Longitude,
        address: poi.AddressInfo?.AddressLine1 || '',
        operator: poi.OperatorInfo?.OperatorName || 'Unknown',
        // FIX #1: Proper safe access to PowerKW
        powerkw: poi.Connections && poi.Connections.length > 0 
          ? poi.Connections.PowerKW 
          : 0,
        // FIX #2: Safe array mapping with filter
        connectorTypes: poi.Connections 
          ? poi.Connections.map(c => c.ConnectionType?.FormalName).filter(Boolean) 
          : [],
        trustscore: 85, // OCM is well-maintained
        amenities: [],
        externalId: `ocm_${poi.ID}`,
        source: 'ocm',
        numberOfPoints: poi.NumberOfPoints || 1,
      }));

    console.log(`[OCM] Transformed ${stations.length} stations`);
    return stations;
  } catch (error) {
    console.error(`[OCM] Error: ${error.message}`);
    return [];
  }
}

module.exports = fetchOCM;
