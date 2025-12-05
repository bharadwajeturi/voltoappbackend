const geohash = require('ngeohash'); // Changed from 'geohash' to 'ngeohash'

// Now accepts any number of lists (Google, OCM, Gov, Hotels...)
function mergeData(...dataLists) {
    console.log("   🔄 [Merger] De-duplicating records...");
    const mergedMap = new Map();

    const processList = (list) => {
        if (!list) return;
        list.forEach(item => {
            // Check for valid coordinates before encoding
            if (!item.lat || !item.lng) return;

            const hash = geohash.encode(item.lat, item.lng, 8); // ~19m precision
            
            if (!mergedMap.has(hash)) {
                mergedMap.set(hash, {
                    id: hash,
                    name: item.name,
                    lat: item.lat,
                    lng: item.lng,
                    address: item.address,
                    operator: item.operator,
                    power_kw: item.power_kw,
                    sources: [item.source],
                    trust_score: item.trust_score || 30,
                    amenities: item.amenities || null // Store hotel metadata here
                });
            } else {
                const existing = mergedMap.get(hash);
                
                if (!existing.sources.includes(item.source)) {
                    existing.sources.push(item.source);
                    existing.trust_score += 20; 
                }

                // If OCM or Gov has better power data, update it
                if (item.power_kw > existing.power_kw) {
                    existing.power_kw = item.power_kw;
                    existing.operator = item.operator;
                }
                
                // If the new item has amenities (e.g. Hotel details), keep them
                if (item.amenities && !existing.amenities) {
                    existing.amenities = item.amenities;
                }

                mergedMap.set(hash, existing);
            }
        });
    };

    // Process every list passed to the function
    dataLists.forEach(list => processList(list));

    return Array.from(mergedMap.values());
}

module.exports = mergeData;