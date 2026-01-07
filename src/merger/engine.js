/**
 * Data Merge Engine
 * STATUS: FIXED (Smart Merging of Address, Power, Connectors & Amenities + Detailed Logs)
 */

const geohash = require('ngeohash');
const { isSameName } = require('../utils/fuzzyMatch');
const { systemLogger } = require('../utils/logger'); // 🟢 IMPORT LOGGER

// 🟢 JUNK TAGS TO REMOVE FROM AMENITIES
const IGNORED_AMENITIES = [
    'electric_vehicle_charging_station', 
    'point_of_interest', 
    'establishment', 
    'premise', 
    'parking',
    'location',
    'store' // Too generic, prefer specific store types
];

function cleanAmenities(amenityList) {
    if (!amenityList || !Array.isArray(amenityList)) return [];
    // Remove underscores and filter out junk
    return amenityList
        .map(a => a.replace(/_/g, ' ').toLowerCase())
        .filter(a => !IGNORED_AMENITIES.includes(a.replace(/ /g, '_')));
}

function mergeData(googleData = [], ocmData = [], govData = [], hotelStations = [], rapidData = []) {
  
  // 🟢 FIX: Allow Google & Gov stations even if power is 0/Unknown
  // We need them to exist so we can merge OCM data into them later
  const isValidStation = (s) => {
      if (s.source === 'google' || s.source === 'gov') return true;
      
      const p = parseFloat(s.powerkw);
      return !isNaN(p) && p > 0;
  };

  // Apply the filter
  const validGoogle = googleData.filter(isValidStation);
  const validOCM = ocmData.filter(isValidStation);
  const validGov = govData.filter(isValidStation);
  const validHotels = hotelStations.filter(isValidStation);
  const validRapid = rapidData.filter(isValidStation);

  if (systemLogger) {
      systemLogger.debug(`Merge Inputs: Google(${validGoogle.length}), OCM(${validOCM.length}), Gov(${validGov.length}), Rapid(${validRapid.length})`, { label: 'MERGER' });
  }

  // Priority helps sort the bucket, but our merge logic below handles field-level updates regardless of order.
  const sourcePriority = { 
      gov: 0, 
      ocm: 1, 
      rapidapi: 2, 
      google: 3, 
      hotel: 4 
  };

  const allData = [
    ...validGoogle.map(s => ({ ...s, source: 'google' })),
    ...validOCM.map(s => ({ ...s, source: 'ocm' })),
    ...validGov.map(s => ({ ...s, source: 'gov' })),
    ...validHotels.map(s => ({ ...s, source: 'hotel' })),
    ...validRapid.map(s => ({ ...s, source: 'rapidapi' }))
  ];

  const geohashBuckets = new Map();
  for (const item of allData) {
    if (!item.lat || !item.lng) continue;
    const hash = geohash.encode(item.lat, item.lng, 6); 
    if (!geohashBuckets.has(hash)) geohashBuckets.set(hash, []);
    geohashBuckets.get(hash).push(item);
  }

  const goldenRecords = [];

  for (const [hash, bucket] of geohashBuckets.entries()) {
    if (bucket.length === 0) continue;
    
    // Sort by priority so high-quality sources are processed first in the loop
    bucket.sort((a, b) => sourcePriority[a.source] - sourcePriority[b.source]);

    const bucketGoldenRecords = [];

    for (const candidate of bucket) {
        let merged = false;

        for (const record of bucketGoldenRecords) {
            const isMatch = isSameName(record.name, candidate.name, 0.85);
            
            if (isMatch) {
                merged = true;
                
                // 🟢 1. Update Trust Score
                record.trustscore = Math.max(record.trustscore, candidate.trustscore || 50);
                if (!record.sources.includes(candidate.source)) {
                    record.sources.push(candidate.source);
                    record.sourceCount = record.sources.length;
                    record.trustscore = Math.min(100, record.trustscore + 5); 
                }

                // 🟢 2. Power Update (Max Wins)
                // If candidate has real power and record has 0 (from Google), take candidate's
                const oldPower = parseFloat(record.powerkw);
                const newPower = parseFloat(candidate.powerkw);
                
                if (newPower > oldPower) {
                    record.powerkw = newPower;
                }
                
                // 🟢 3. Operator Update (Fill if missing)
                if (!record.operator && candidate.operator) {
                    record.operator = candidate.operator;
                }

                // 🟢 4. Address Update (Longest String Wins)
                // Google often gives short addresses. OCM/Gov often give full ones.
                if (!record.address || (candidate.address && candidate.address.length > record.address.length)) {
                    if (candidate.address) { // Only update if candidate actually has an address
                        record.address = candidate.address;
                    }
                }

                // 🟢 5. Connectors Merge (Union + Normalize)
                const combinedConnectors = [...(record.connectorTypes || []), ...(candidate.connectorTypes || [])];
                const uniqueConnectors = [...new Set(combinedConnectors.map(c => {
                    if (!c) return null;
                    const s = String(c).toUpperCase();
                    if (s.includes('CCS')) return 'CCS2'; // Standardize
                    if (s.includes('TYPE 2') || s.includes('TYPE2')) return 'Type 2';
                    if (s.includes('CHADEMO')) return 'CHAdeMO';
                    return c; // Keep original if specific
                }).filter(c => c !== 'Unknown'))]; // Filter out unknowns during merge

                if (uniqueConnectors.length > 0) {
                     // If we have known connectors, replace 'Unknown' or merge
                     record.connectorTypes = uniqueConnectors;
                }

                // 🟢 6. Amenities Merge (Clean & Union)
                const cleanCandidateAmenities = cleanAmenities(candidate.amenities);
                if (cleanCandidateAmenities.length > 0) {
                    const combinedAmenities = [...(record.amenities || []), ...cleanCandidateAmenities];
                    record.amenities = [...new Set(combinedAmenities)];
                }

                break; 
            }
        }

        if (!merged) {
            let stableId = candidate.externalId;
            if (!stableId) {
                const cleanName = (candidate.name || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
                stableId = `${candidate.source}_${hash}_${cleanName}`;
            }

            bucketGoldenRecords.push({
                id: stableId,
                geohash: hash,
                name: candidate.name || 'Unknown',
                lat: parseFloat(candidate.lat),
                lng: parseFloat(candidate.lng),
                address: candidate.address || '',
                operator: candidate.operator || '',
                // Ensure power is numeric, even if 0
                powerkw: parseFloat(candidate.powerkw) || 0,
                connectorTypes: candidate.connectorTypes || [],
                trustscore: candidate.trustscore || 50,
                sources: [candidate.source],
                sourceCount: 1,
                amenities: cleanAmenities(candidate.amenities), // Clean initial amenities
                lastupdatedat: new Date().toISOString()
            });
        }
    }
    goldenRecords.push(...bucketGoldenRecords);
  }

  if (systemLogger) {
      systemLogger.info(`Merge Complete. Created ${goldenRecords.length} Golden Records.`, { label: 'MERGER' });
  }

  return goldenRecords;
}

module.exports = mergeData;