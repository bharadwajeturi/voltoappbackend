/**
 * Data Merge Engine
 * STATUS: FIXED (Allows Google/Gov with 0 Power)
 */

const geohash = require('ngeohash');
const { isSameName } = require('../utils/fuzzyMatch');

function mergeData(googleData = [], ocmData = [], govData = [], hotelStations = [], rapidData = []) {
  
  // 🟢 FIX: Allow Google & Gov stations even if power is 0/Unknown
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

  console.log(`\n🔀 MERGE: Inputs: Google(${validGoogle.length}), OCM(${validOCM.length}), Gov(${validGov.length}), Rapid(${validRapid.length})`);

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
    bucket.sort((a, b) => sourcePriority[a.source] - sourcePriority[b.source]);

    const bucketGoldenRecords = [];

    for (const candidate of bucket) {
        let merged = false;

        for (const record of bucketGoldenRecords) {
            const isMatch = isSameName(record.name, candidate.name, 0.85);
            
            if (isMatch) {
                merged = true;
                record.trustscore = Math.max(record.trustscore, candidate.trustscore || 50);
                
                if (!record.sources.includes(candidate.source)) {
                    record.sources.push(candidate.source);
                    record.sourceCount = record.sources.length;
                    record.trustscore = Math.min(100, record.trustscore + 5); 
                }

                if (parseFloat(candidate.powerkw) > parseFloat(record.powerkw)) {
                    record.powerkw = parseFloat(candidate.powerkw);
                }
                
                if (!record.operator && candidate.operator) {
                    record.operator = candidate.operator;
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
                amenities: candidate.amenities || [],
                lastupdatedat: new Date().toISOString()
            });
        }
    }
    goldenRecords.push(...bucketGoldenRecords);
  }

  console.log(`✅ Merge Complete. ${goldenRecords.length} unique stations ready.`);
  return goldenRecords;
}

module.exports = mergeData;