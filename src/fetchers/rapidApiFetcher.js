/**
 * RapidAPI EV Stations Fetcher
 * Source: ev-charging-stations.p.rapidapi.com
 * STATUS: NEW (Integrated)
 */

const axios = require('axios');
const config = require('../config/configuration');
const { getDistanceKm } = require('../utils/distance');
const { normalizePower } = require('../utils/normalization');

async function fetchStations(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) return [];

  // console.log(`[RapidAPI] Fetching near ${lat},${lng}...`);

  try {
    const response = await axios.get('https://ev-charging-stations.p.rapidapi.com/get_stations_10km', {
      params: {
        latitude: lat,
        longitude: lng,
       // region: 'in', // Requesting India region
      },
      headers: {
        'x-rapidapi-key': config.keys.rapidapi,
        'x-rapidapi-host': 'ev-charge-finder.p.rapidapi.com'
      },
      timeout: 8000 // 8s timeout
    });

    const data = response.data;
    if (!Array.isArray(data)) return [];

    const radiusKm = radiusMeters / 1000;

    // Transform to VoltPath Standard Format
    const stations = data.map(item => {
        // Safe coordinate parsing
        const sLat = parseFloat(item.latitude);
        const sLng = parseFloat(item.longitude);
        
        if (isNaN(sLat) || isNaN(sLng)) return null;

        // Strict Radius Filter (API returns fixed 10km, we might want less)
        const dist = getDistanceKm(lat, lng, sLat, sLng);
        if (dist > radiusKm) return null;

        // Parse Power (Handle various formats like "22kW", "22", etc.)
        let rawPower = item.power || item.power_kw || 0;
        if (typeof rawPower === 'string') rawPower = rawPower.replace('kW', '').trim();
        
        // Use Normalizer (Default 7.4kW for RapidAPI sources if unknown)
        const power = normalizePower(rawPower, 7.4);

        return {
          name: item.station_name || item.name || 'EV Charging Station',
          lat: sLat,
          lng: sLng,
          address: item.address || item.formatted_address || '',
          operator: item.operator || item.network || 'RapidAPI Source',
          powerkw: power,
          connectorTypes: item.connectors || ['Unknown'],
          trustscore: 80, // Good trust level
          amenities: [],
          externalId: `rapid_${item.id || item.station_id || Math.random()}`,
          source: 'rapidapi',
        };
      })
      .filter(s => s !== null);

    if (stations.length > 0) {
        console.log(`[RapidAPI] 🟢 Found ${stations.length} stations`);
    }

    return stations;

  } catch (error) {
    // console.error(`[RapidAPI] Error: ${error.message}`);
    return [];
  }
}

module.exports = { fetchStations };