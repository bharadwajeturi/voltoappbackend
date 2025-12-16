/**
 * Government API Fetcher (Local File Based)
 * STATUS: FIXED (Auto-detects file path + Normalization)
 */
const fs = require('fs');
const path = require('path');
const { getDistanceKm } = require('../utils/distance');
const { normalizePower } = require('../utils/normalization'); // 🟢 Import

function loadGovData() {
    try {
        const pathsToTry = [
            path.join(__dirname, '../data/govt_ev_stations.json'), 
            path.join(__dirname, '../../data/govt_ev_stations.json'),
            path.join(process.cwd(), 'src/data/govt_ev_stations.json')
        ];

        for (const p of pathsToTry) {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                return JSON.parse(raw);
            }
        }
        return [];
    } catch (e) {
        return [];
    }
}

const GOV_DB = loadGovData();

async function fetchStations(lat, lng, radiusMeters = 5000) {
  if (!lat || !lng) return [];

  try {
    const radiusKm = radiusMeters / 1000;

    const stations = GOV_DB
      .filter(station => {
        const sLat = parseFloat(station.latitude || station.lattitude);
        const sLng = parseFloat(station.longitude);
        if (isNaN(sLat) || isNaN(sLng)) return false;
        const dist = getDistanceKm(lat, lng, sLat, sLng);
        return dist <= radiusKm;
      })
      .map(station => ({
        name: station.station_name || station.name || 'Gov Charging Station',
        lat: parseFloat(station.latitude || station.lattitude),
        lng: parseFloat(station.longitude),
        address: station.address || '',
        operator: station.operator || 'EESL/Gov',
        
        // 🟢 FIX: Normalize Power
        powerkw: normalizePower(station.power_kw || station.powerkw, 15),
        
        connectorTypes: station.charger_type ? [station.charger_type] : ['Type 2', 'CCS2'],
        trustscore: 95, 
        amenities: [],
        externalId: `gov_${station.id || Math.random()}`,
        source: 'gov',
        certified: true,
      }));

    if (stations.length > 0) {
        console.log(`[Gov] 🟢 Found ${stations.length} stations`);
    }

    return stations;

  } catch (error) {
    return [];
  }
}

module.exports = { fetchStations };