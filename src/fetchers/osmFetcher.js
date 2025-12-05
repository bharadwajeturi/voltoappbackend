const axios = require('axios');
const config = require('../config/configuration');

async function fetchOSMAmenities() {
    console.log("   🌍 [OSM] Connecting to Overpass API...");
    
    const { lat, lng, radius } = config.search;
    
    // Overpass QL Query: Find restaurants, cafes, and hotels within radius
    const query = `
        [out:json];
        (
          node["amenity"="restaurant"](around:${radius},${lat},${lng});
          node["amenity"="cafe"](around:${radius},${lat},${lng});
          node["tourism"="hotel"](around:${radius},${lat},${lng});
        );
        out body;
    `;

    try {
        // Use a public Overpass instance
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        const response = await axios.get(url);
        const elements = response.data.elements || [];

        console.log(`      ✅ [OSM] Found ${elements.length} raw amenities.`);

        return elements.map(item => ({
            id: `osm_${item.id}`,
            name: item.tags.name || 'Unknown Place',
            lat: item.lat,
            lng: item.lon,
            type: item.tags.amenity === 'restaurant' || item.tags.amenity === 'cafe' ? 'Restaurant' : 'Hotel',
            // OSM rarely has ratings, so we default to 0 or check if 'stars' tag exists
            rating: item.tags.stars || 0, 
            address: item.tags['addr:street'] || 'Address not available',
            source: 'osm'
        })).filter(item => item.name !== 'Unknown Place'); // Filter out unnamed spots

    } catch (error) {
        console.error("      ❌ [OSM] Error:", error.message);
        return [];
    }
}

module.exports = fetchOSMAmenities;