/**
 * Data Merge Engine
 * Combines station data from multiple sources (Google, OCM, Gov, Hotels)
 * 
 * RULE #3 Implementation:
 * - Primary key: Geohash (represents ~20m area)
 * - Secondary: Fuzzy name matching (if names similar)
 * - Tertiary: Source priority (Gov > OCM > Google > Hotel)
 * 
 * Result: One "Golden Record" per location
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

    // Create geohash with 10-char precision (~20m accuracy)
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

    // PRIMARY RECORD: Take the highest-priority source
    const primary = bucket;

    console.log(`\n  📌 Geohash: ${hash.substring(0, 6)}... (${bucket.length} source${bucket.length > 1 ? 's' : ''})`);

    // Create golden record
    const goldenRecord = {
      // Identity
      id: hash,
      geohash: hash,
      name: primary.name || 'Unknown',
      lat: parseFloat(primary.lat),
      lng: parseFloat(primary.lng),
      address: primary.address || '',

      // Technical Specs (from highest priority source)
      operator: primary.operator || '',
      powerkw: parseFloat(primary.powerkw) || 0,
      connectorTypes: primary.connectorTypes || [],
      numberOfPoints: primary.numberOfPoints || 1,

      // Metadata
      trustscore: getTrustScore(primary.source),
      sources: [primary.source],
      sourceCount: 1,
      externalIds: { [primary.source]: primary.externalId },

      // Amenities (collected from all sources)
      amenities: primary.amenities ? [...new Set(primary.amenities)] : [],

      // Time tracking
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),

      // Raw data for debugging
      rawData: [primary],
    };

    // MERGE LOGIC: Process remaining sources in bucket
    if (bucket.length > 1) {
      console.log(`    ✓ Primary (${primary.source}): "${primary.name}"`);

      for (let i = 1; i < bucket.length; i++) {
        const candidate = bucket[i];
        const similarity = isSameName(goldenRecord.name, candidate.name, 0.80)
          ? 'MATCH'
          : `${getSimilarityScore(goldenRecord.name, candidate.name).toFixed(2)}`;

        if (similarity === 'MATCH') {
          console.log(
            `    + Merged (${candidate.source}): "${candidate.name}" [Exact Match]`
          );

          // STRATEGY: Take tech specs from Gov/OCM (higher priority)
          if (['gov', 'ocm'].includes(candidate.source)) {
            if (candidate.powerkw && candidate.powerkw > goldenRecord.powerkw) {
              goldenRecord.powerkw = candidate.powerkw;
              console.log(
                `      → Updated power: ${goldenRecord.powerkw}kW (from ${candidate.source})`
              );
            }

            if (candidate.operator && !goldenRecord.operator) {
              goldenRecord.operator = candidate.operator;
            }

            if (candidate.connectorTypes?.length > 0) {
              goldenRecord.connectorTypes = [
                ...new Set([
                  ...goldenRecord.connectorTypes,
                  ...candidate.connectorTypes,
                ]),
              ];
            }
          }

          // AMENITIES: Collect from all sources
          if (candidate.amenities && Array.isArray(candidate.amenities)) {
            goldenRecord.amenities = [
              ...new Set([...goldenRecord.amenities, ...candidate.amenities]),
            ];
          }

          // TRACKING: Record merged source
          if (!goldenRecord.sources.includes(candidate.source)) {
            goldenRecord.sources.push(candidate.source);
            goldenRecord.sourceCount = goldenRecord.sources.length;
            goldenRecord.trustscore = Math.min(
              100,
              goldenRecord.trustscore + 10
            );
          }

          goldenRecord.externalIds[candidate.source] = candidate.externalId;
          goldenRecord.rawData.push(candidate);
          mergeCount++;
        } else {
          // Different station at same location
          console.log(
            `    - Different (${candidate.source}): "${candidate.name}" [${similarity}% similarity]`
          );
        }
      }
    } else {
      newCount++;
    }

    goldenRecords.push(goldenRecord);
  }

  // STEP 4: Summary statistics
  console.log(`\n✅ Merge Complete:`);
  console.log(`   • Golden Records Created: ${goldenRecords.length}`);
  console.log(`   • Records Merged: ${mergeCount}`);
  console.log(`   • New Unique Stations: ${newCount}`);
  console.log(`   • Avg Trust Score: ${(goldenRecords.reduce((sum, s) => sum + s.trustscore, 0) / goldenRecords.length).toFixed(1)}/100`);
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
