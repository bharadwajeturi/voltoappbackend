/**
 * Proximity Utilities
 * Status: UPDATED (Geohash Optimization for O(N) Performance)
 */

const geohash = require('ngeohash');

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // meters
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
 * Links amenities to stations efficiently using Geohash Buckets
 * ✅ IMPROVEMENT: O(N) Complexity instead of O(N*M)
 */
function linkAmenitiesToStations(stations, amenities) {
    console.log("   📍 [Proximity] Linking amenities (Geohash Optimized)...");
    
    // 1. Bucket Amenities by Geohash (Precision 6 ~1.2km)
    // This allows us to only search nearby amenities, not ALL amenities
    const amenityBuckets = new Map();
    const PRECISION = 6;

    amenities.forEach(a => {
        try {
            const hash = geohash.encode(a.lat, a.lng, PRECISION);
            if (!amenityBuckets.has(hash)) amenityBuckets.set(hash, []);
            amenityBuckets.get(hash).push(a);
        } catch (e) {}
    });

    let linkCount = 0;

    // 2. Scan stations against neighbor buckets only
    const enrichedStations = stations.map(station => {
        const centerHash = geohash.encode(station.lat, station.lng, PRECISION);
        const neighbors = geohash.neighbors(centerHash);
        neighbors.push(centerHash); // Include center tile

        let nearby = [];

        // Only look at amenities in the 9 surrounding grid cells
        neighbors.forEach(hash => {
            if (amenityBuckets.has(hash)) {
                const candidates = amenityBuckets.get(hash);
                candidates.forEach(amenity => {
                    const dist = getDistance(station.lat, station.lng, amenity.lat, amenity.lng);
                    if (dist <= 500) { // 500m logic
                        // Clone to add distance info without mutating original
                        nearby.push({ ...amenity, distance_meters: Math.round(dist) });
                    }
                });
            }
        });

        if (nearby.length > 0) linkCount += nearby.length;

        return {
            ...station,
            nearby_amenities: nearby 
        };
    });

    console.log(`      🔗 Linked ${linkCount} amenities efficiently.`);
    return enrichedStations;
}

module.exports = { linkAmenitiesToStations, getDistance };