/**
 * Station Filter Utility
 * Filters out "Ghost Stations" (0 kW, Broken, Low Trust)
 * * CRITICAL RULE:
 * - Google Stations are ALLOWED even with 0 kW (because Google often hides power data).
 * - OCM/Other Stations MUST have > 0 kW to be considered valid (prevents spam).
 */

function isRelevantStation(station) {
    if (!station) return false;

    // 🟢 RULE 1: Always allow Google & Government stations
    // Google rarely provides power data, so we can't filter by it.
    // Gov data is manually verified (via your JSON file), so we trust it.
    if (station.source === 'google' || station.source === 'gov') {
        return true;
    }

    // 🟢 RULE 2: For Open Charge Map (OCM) & RapidAPI, be strict.
    // We only want useful chargers.
    const hasPower = parseFloat(station.powerkw) > 0;
    
    // If it has a high trust score (verified by users), we allow it even if power is missing.
    const isTrusted = (station.trustscore || 0) >= 60;

    // Allow if it has power OR is highly trusted
    return hasPower || isTrusted;
}

module.exports = { isRelevantStation };