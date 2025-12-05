const axios = require('axios');
const config = require('../config/configuration');

// Helper to fetch from Google
async function fetchGoogleType(type, keyword = '') {
    const { lat, lng, radius } = config.search;
    let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&key=${config.keys.google}`;
    if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;

    try {
        const response = await axios.get(url);
        return response.data.results || [];
    } catch (error) {
        console.error(`      ❌ [Google ${type}] Failed: ${error.message}`);
        return [];
    }
}

async function fetchAmenities() {
    console.log("   Build  [Amenities] Scanning for Hotels & Food...");

    // 1. Fetch Hotels WITH EV Chargers (Treat as Stations)
    const hotels = await fetchGoogleType('lodging', 'EV charging');
    const hotelStations = hotels.map(h => ({
        source: 'google_hotel',
        name: h.name,
        lat: h.geometry.location.lat,
        lng: h.geometry.location.lng,
        address: h.vicinity,
        operator: 'Hotel Charger', // Generic operator
        power_kw: 0, // Unknown power
        trust_score: 40,
        amenities: { type: 'Hotel', name: h.name, rating: h.rating }
    }));

    // 2. Fetch Restaurants (Treat as Amenities)
    const restaurants = await fetchGoogleType('restaurant');
    const restaurantAmenities = restaurants.map(r => ({
        id: r.place_id,
        name: r.name,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        type: 'Restaurant',
        rating: r.rating || 0,
        address: r.vicinity
    }));

    console.log(`      ✅ Found ${hotelStations.length} Hotels with Chargers`);
    console.log(`      ✅ Found ${restaurantAmenities.length} Restaurants`);

    return { stations: hotelStations, amenities: restaurantAmenities };
}

module.exports = fetchAmenities;