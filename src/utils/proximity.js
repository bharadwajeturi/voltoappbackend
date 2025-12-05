/**
 * Calculates distance between two coords (Haversine formula)
 * Returns distance in meters.
 */
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Links amenities to stations if they are within 500m.
 * @param {Array} stations - The merged list of EV chargers.
 * @param {Array} amenities - The list of restaurants/hotels (OSM/Google).
 * @returns {Array} - Stations with a new 'nearby_amenities' array.
 */
function linkAmenitiesToStations(stations, amenities) {
    console.log("   📍 [Proximity] Linking amenities to stations (500m radius)...");
    
    let linkCount = 0;

    const enrichedStations = stations.map(station => {
        // Find all amenities close to this station
        const nearby = amenities.filter(amenity => {
            const dist = getDistance(station.lat, station.lng, amenity.lat, amenity.lng);
            // Add exact distance to the amenity object for the UI
            amenity.distance_meters = Math.round(dist); 
            return dist <= 500; // 500 meters threshold
        });

        if (nearby.length > 0) linkCount += nearby.length;

        return {
            ...station,
            // Attach the list. In DB, this will likely be stored in the JSONB column.
            nearby_amenities: nearby 
        };
    });

    console.log(`      🔗 Linked ${linkCount} total amenities across ${stations.length} stations.`);
    return enrichedStations;
}

module.exports = { linkAmenitiesToStations, getDistance };