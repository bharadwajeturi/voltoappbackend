/**
 * Government API Fetcher
 * Fetches official EV charging stations from government sources
 * (India specific: NITI Aayog, Ministry of Heavy Industries)
 * 
 * UPDATED:
 * - Accepts lat/lng/radius parameters (not hard-coded)
 * - Better error handling
 * - Returns complete station data
 */

const axios = require('axios');
const config = require('../config/configuration');
const { getDistanceKm } = require('../utils/distance');

async function fetchGov(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) {
    console.warn('[Gov] Missing lat/lng, skipping fetch');
    return [];
  }

  console.log(
    `[Gov] Fetching chargers within ${radiusMeters / 1000}km of ${lat},${lng}`
  );

  try {
    // Using NITI Aayog EV Charging Station API
    const radiusKm = radiusMeters / 1000;
    const url = 'https://api.gis.niti.gov.in/api/EVChargingStations/GetByLocation';

    const response = await axios.get(url, {
      params: {
        latitude: lat,
        longitude: lng,
        radius: radiusKm,
        apikey: config.keys.gov,
      },
      timeout: 10000,
    });

    if (!response.data?.data) {
      console.log('[Gov] No results found');
      return [];
    }

    const data = Array.isArray(response.data.data)
      ? response.data.data
      : [response.data.data];
    console.log(`[Gov] Found ${data.length} stations`);

    // Transform to standard format
    const stations = data
      .filter(
        station =>
          station.latitude &&
          station.longitude &&
          getDistanceKm(lat, lng, station.latitude, station.longitude) <=
            radiusKm
      )
      .map(station => ({
        name: station.stationName || station.name || 'Unknown',
        lat: station.latitude,
        lng: station.longitude,
        address: station.address || '',
        operator: station.operatorName || 'Government',
        powerkw: station.powerKW || station.power || 0,
        connectorTypes: station.connectorTypes || station.connectors || [],
        trustscore: 95, // Government sources are most trusted
        amenities: station.amenities || [],
        externalId: `gov_${station.id}`,
        source: 'gov',
        certified: true,
      }));

    console.log(`[Gov] Transformed ${stations.length} stations`);
    return stations;
  } catch (error) {
    console.error(`[Gov] Error: ${error.message}`);
    return [];
  }
}

module.exports = fetchGov;
