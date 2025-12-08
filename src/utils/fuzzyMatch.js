/**
 * Fuzzy Name Matching using Jaro-Winkler Distance
 * Used for merging duplicate stations from different sources
 * 
 * RULE #3 Implementation: Match stations by geohash first, then verify by name
 */

// Jaro-Winkler distance implementation
function jaroWinklerDistance(str1, str2) {
  const s1 = String(str1).toLowerCase().trim();
  const s2 = String(str2).toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0;

  const len1 = s1.length;
  const len2 = s2.length;
  const matchDistance = Math.max(len1, len2) / 2 - 1;

  if (matchDistance < 0) return 0;

  const matches1 = new Array(len1).fill(false);
  const matches2 = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);

    for (let j = start; j < end; j++) {
      if (matches2[j] || s1[i] !== s2[j]) continue;
      matches1[i] = true;
      matches2[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Find transpositions
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!matches1[i]) continue;
    while (!matches2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) /
    3;

  // Jaro-Winkler
  let commonPrefix = 0;
  const prefixLen = Math.min(4, Math.min(len1, len2));

  for (let i = 0; i < prefixLen; i++) {
    if (s1[i] === s2[i]) commonPrefix++;
    else break;
  }

  return jaro + commonPrefix * 0.1 * (1 - jaro);
}

/**
 * Check if two names are similar (likely same station)
 * @param {string} name1 - First station name
 * @param {string} name2 - Second station name
 * @param {number} threshold - Similarity threshold (0-1), default 0.80
 * @returns {boolean} - True if names are similar
 */
function isSameName(name1, name2, threshold = 0.80) {
  if (!name1 || !name2) return false;

  const distance = jaroWinklerDistance(name1, name2);
  console.log(`  [Fuzzy] "${name1}" vs "${name2}" = ${distance.toFixed(3)} (threshold: ${threshold})`);

  return distance >= threshold;
}

/**
 * Get similarity score (0-1) between two names
 * @param {string} name1 - First station name
 * @param {string} name2 - Second station name
 * @returns {number} - Similarity score
 */
function getSimilarityScore(name1, name2) {
  if (!name1 || !name2) return 0;
  return jaroWinklerDistance(name1, name2);
}

module.exports = {
  isSameName,
  getSimilarityScore,
  jaroWinklerDistance,
};
