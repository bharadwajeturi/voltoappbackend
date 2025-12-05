const axios = require('axios');
const config = require('../config/configuration');

async function fetchOCMStations() {
    console.log("   📡 [OCM] Fetching data...");
    const { lat, lng, radius } = config.search;
    // OCM uses KM, so divide radius by 1000
    const url = `https://api.openchargemap.io/v3/poi/?output=json&latitude=${lat}&longitude=${lng}&distance=${radius/1000}&distanceunit=KM&key=${config.keys.chargeApi}`;

    try {
        const response = await axios.get(url);
        const results = response.data || [];

        return results.map(poi => ({
            source: 'charge_api',
            name: poi.AddressInfo.Title,
            lat: poi.AddressInfo.Latitude,
            lng: poi.AddressInfo.Longitude,
            address: poi.AddressInfo.AddressLine1,
            operator: poi.OperatorInfo ? poi.OperatorInfo.Title : 'Unknown',
            power_kw: poi.Connections && poi.Connections.length > 0 ? poi.Connections[0].PowerKW : 0,
            raw_id: poi.ID
        }));
    } catch (error) {
        console.error("   ❌ [OCM] Error:", error.message);
        return [];
    }
}

module.exports = fetchOCMStations;