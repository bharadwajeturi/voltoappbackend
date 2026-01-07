/**
 * Google Amenity Fetcher (Strategic)
 * Fetches high-quality amenities ONLY for confirmed stops.
 */
const axios = require('axios');
const config = require('../config/configuration');

async function fetchAmenitiesForPoint(lat, lng) {
    if (!lat || !lng) return [];

    try {
        const apiKey = config.keys.google;
        const radius = 1000; // 1km radius for highway stops
        const type = 'restaurant|cafe|shopping_mall|convenience_store';
        
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${type}&keyword=restroom&key=${apiKey}`;

        const response = await axios.get(url, { timeout: 5000 });
        
        if (response.data.status !== 'OK') return [];

        return response.data.results.map(place => ({
            name: place.name,
            type: place.types ? place.types[0] : 'unknown',
            rating: place.rating,
            user_ratings_total: place.user_ratings_total,
            lat: place.geometry?.location?.lat, // ✅ ADD THIS
            lng: place.geometry?.location?.lng, // ✅ ADD THIS
            vicinity: place.vicinity,
            source: 'google'
        })).slice(0, 5); // Take top 5 results

    } catch (error) {
        console.error(`[Google Amenities] Error: ${error.message}`);
        return [];
    }
}

module.exports = { fetchAmenitiesForPoint };