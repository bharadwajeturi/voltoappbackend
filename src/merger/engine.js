/**
 * Data Merge Engine
 * Combines station data from multiple sources (Google, OCM, Gov, Hotels)
 * * RULE #3 Implementation:
 * - Primary key: Geohash (represents ~20m area)
 * - Secondary: Fuzzy name matching (if names similar)
 * - Tertiary: Source priority (Gov > OCM > Google > Hotel)
 * * Result: One "Golden Record" per location (or multiple if distinct stations exist at same spot)
 */

const geohash = require('ngeohash');
const { isSameName, getSimilarityScore } = require('../utils/fuzzyMatch');

/**
 * Main merge function
 * @param {Array} googleData - Stations from Google
 * @param {Array} ocmData - Stations from OCM
 * @param {Array} govData - Stations from Government
 * @param {Array} hotelStations - Hotel charging stations
 * @returns {Array} - Merged "Golden Records"
 */
function mergeData(googleData = [], ocmData = [], govData = [], hotelStations = []) {
  console.log('\n🔀 MERGE ENGINE: Starting Data Merge');
  console.log(`Input counts: Google=${googleData.length}, OCM=${ocmData.length}, Gov=${govData.length}, Hotels=${hotelStations.length}`);

  // SOURCE PRIORITY (Lower number = higher priority)
  const sourcePriority = {
    gov: 0,        // Government = most trusted
    ocm: 1,        // OCM = well-maintained
    google: 2,     // Google = user-generated
    hotel: 3,      // Hotels = lowest priority
  };

  // STEP 1: Normalize all data to include source field
  const allData = [
    ...googleData.map(s => ({ ...s, source: s.source || 'google' })),
    ...ocmData.map(s => ({ ...s, source: s.source || 'ocm' })),
    ...govData.map(s => ({ ...s, source: s.source || 'gov' })),
    ...hotelStations.map(s => ({ ...s, source: s.source || 'hotel' })),
  ];

  console.log(`\n📊 Total records to process: ${allData.length}`);

  // STEP 2: Create geohash buckets (RULE #3 - Lat/Lng primary)
  const geohashBuckets = new Map();
  let skippedCount = 0;

  for (const item of allData) {
    // Validate coordinates
    if (
      !item.lat ||
      !item.lng ||
      isNaN(parseFloat(item.lat)) ||
      isNaN(parseFloat(item.lng))
    ) {
      console.warn(`  ⚠️  Skipping: Invalid coordinates for "${item.name}"`);
      skippedCount++;
      continue;
    }

    // Create geohash with 7-char precision (~150m accuracy)
    // We use 7 chars to group close neighbors, then use Name Matching to separate them
    const hash = geohash.encode(item.lat, item.lng, 7);

    if (!geohashBuckets.has(hash)) {
      geohashBuckets.set(hash, []);
    }

    geohashBuckets.get(hash).push(item);
  }

  console.log(`\n🗺️  Geohash Buckets: ${geohashBuckets.size} unique locations (skipped ${skippedCount})`);

  // STEP 3: Merge within each geohash bucket
  const goldenRecords = [];
  let mergeCount = 0;
  let newCount = 0;

  for (const [hash, bucket] of geohashBuckets.entries()) {
    if (bucket.length === 0) continue;

    // Sort by source priority (gov first)
    bucket.sort((a, b) => sourcePriority[a.source] - sourcePriority[b.source]);

    // This list holds the confirmed unique stations for THIS bucket
    const bucketGoldenRecords = [];

    // Iterate through every candidate in this location bucket
    for (const candidate of bucket) {
        let merged = false;

        // Try to match this candidate against existing Golden Records in this bucket
        for (const record of bucketGoldenRecords) {
            const isMatch = isSameName(record.name, candidate.name, 0.80);
            
            if (isMatch) {
                // --- MERGE LOGIC: Combine Data ---
                // console.log(`    + Merging ${candidate.name} into ${record.name}`);
                merged = true;
                mergeCount++;

                // 1. Update Trust Score & Sources
                if (!record.sources.includes(candidate.source)) {
                    record.sources.push(candidate.source);
                    record.sourceCount = record.sources.length;
                    record.trustscore = Math.min(100, record.trustscore + 10);
                }

                // 2. Merge Amenities (Union of sets)
                if (candidate.amenities && Array.isArray(candidate.amenities)) {
                    record.amenities = [...new Set([...record.amenities, ...candidate.amenities])];
                }

                // 3. Update Technical Specs (Prioritize High Power / Known Operators)
                // If candidate has more power, upgrade the record
                if (parseFloat(candidate.powerkw) > parseFloat(record.powerkw)) {
                    record.powerkw = parseFloat(candidate.powerkw);
                }
                // If record lacks operator but candidate has one
                if (!record.operator && candidate.operator) {
                    record.operator = candidate.operator;
                }
                // Merge connectors
                if (candidate.connectorTypes && candidate.connectorTypes.length > 0) {
                    record.connectorTypes = [...new Set([...record.connectorTypes, ...candidate.connectorTypes])];
                }

                // 4. Store External ID & Raw Data
                record.externalIds[candidate.source] = candidate.externalId;
                record.rawData.push(candidate);
                
                break; // Stop checking other records, we found the match
            }
        }

        // --- NEW STATION LOGIC ---
        // If it didn't match ANY existing record in this bucket, it is a DISTINCT station
        if (!merged) {
            // Create a new Golden Record
            newCount++;
            
            // Generate a unique ID (Hash + Index) to prevent collision in same bucket
            const uniqueId = bucketGoldenRecords.length === 0 ? hash : `${hash}_${bucketGoldenRecords.length}`;

            bucketGoldenRecords.push({
                // Identity
                id: uniqueId,
                geohash: hash,
                name: candidate.name || 'Unknown',
                lat: parseFloat(candidate.lat),
                lng: parseFloat(candidate.lng),
                address: candidate.address || '',

                // Technical Specs
                operator: candidate.operator || '',
                powerkw: parseFloat(candidate.powerkw) || 0,
                connectorTypes: candidate.connectorTypes || [],
                numberOfPoints: candidate.numberOfPoints || 1,

                // Metadata
                trustscore: getTrustScore(candidate.source),
                sources: [candidate.source],
                sourceCount: 1,
                externalIds: { [candidate.source]: candidate.externalId },

                // Amenities
                amenities: candidate.amenities ? [...new Set(candidate.amenities)] : [],

                // Time tracking
                createdAt: new Date().toISOString(),
                lastUpdatedAt: new Date().toISOString(),
                lastVerifiedAt: new Date().toISOString(),

                // Raw data
                rawData: [candidate],
            });
        }
    }

    // Add all distinct stations found in this bucket to the main list
    goldenRecords.push(...bucketGoldenRecords);
  }

  // STEP 4: Summary statistics
  const avgTrust = goldenRecords.length > 0 
    ? (goldenRecords.reduce((sum, s) => sum + s.trustscore, 0) / goldenRecords.length).toFixed(1) 
    : 0;

  console.log(`\n✅ Merge Complete:`);
  console.log(`   • Golden Records Created: ${goldenRecords.length}`);
  console.log(`   • Records Merged: ${mergeCount}`);
  // Note: "New Unique Stations" is essentially total golden records created
  console.log(`   • Avg Trust Score: ${avgTrust}/100`);
  console.log(
    `   • Multi-Source Stations: ${goldenRecords.filter(s => s.sourceCount > 1).length}`
  );
  
  return goldenRecords;
}

/**
 * Get base trust score for a source
 * @param {string} source - Source name (gov, ocm, google, hotel)
 * @returns {number} - Initial trust score (50-95)
 */
function getTrustScore(source) {
  const scores = {
    gov: 95,      // Government is most reliable
    ocm: 85,      // OCM is well-maintained community data
    google: 70,   // Google has variety but user-generated
    hotel: 50,    // Hotel data is basic/limited
  };
  return scores[source] || 50;
}

/**
 * Validate merged record
 * @param {Object} record - Golden record to validate
 * @returns {boolean} - True if valid
 */
function validateGoldenRecord(record) {
  const required = ['id', 'name', 'lat', 'lng', 'source', 'sources'];
  for (const field of required) {
    if (!record[field]) {
      console.warn(`Invalid record: missing ${field}`);
      return false;
    }
  }

  if (isNaN(record.lat) || isNaN(record.lng)) {
    console.warn('Invalid record: invalid coordinates');
    return false;
  }

  if (record.lat < -90 || record.lat > 90 || record.lng < -180 || record.lng > 180) {
    console.warn('Invalid record: out of bounds coordinates');
    return false;
  }

  return true;
}

module.exports = mergeData;