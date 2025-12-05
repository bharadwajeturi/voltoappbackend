const axios = require('axios');
const config = require('../config/configuration');

async function fetchGoogleStations() {
    console.log("   📡 [Google] Fetching data...");
    const { lat, lng, radius } = config.search;
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=electric_vehicle_charging_station&key=${config.keys.google}`;
    
    try {
        const response = await axios.get(url);
        const results = response.data.results || [];
        
        // Normalize immediately
        return results.map(place => ({
            source: 'google',
            name: place.name,
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
            address: place.vicinity,
            rating: place.rating || 0,
            operator: 'Unknown',
            power_kw: 0, 
            raw_id: place.place_id
        }));
    } catch (error) {
        console.error("   ❌ [Google] Error:", error.message);
        return [];
    }
}

module.exports = fetchGoogleStations;