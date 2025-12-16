/**
 * Distance & Battery Math Utilities
 * Status: UPDATED (Fixed 0-coord bug, Standardized Battery Model)
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Calculate distance between two lat/lng points using Haversine formula
 */
function getDistanceKm(lat1, lng1, lat2, lng2) {
  // ✅ FIX: Check for undefined specifically, allowing valid '0' coordinates
  if (
    lat1 === undefined || lng1 === undefined ||
    lat2 === undefined || lng2 === undefined
  ) {
    return 0;
  }

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceKm = EARTH_RADIUS_KM * c;

  return parseFloat(distanceKm.toFixed(2));
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function getEstimatedTravelTimeMinutes(distanceKm, avgSpeedKmh = 100) {
  if (!distanceKm || distanceKm <= 0) return 0;
  return Math.round((distanceKm / avgSpeedKmh) * 60);
}

/**
 * Calculate battery consumption (SOC %)
 * ✅ IMPROVEMENT: Canonical Model (kWh/km / Capacity)
 * @param {number} distanceKm - Distance to travel
 * @param {number} efficiencyKWhPerKm - Car efficiency (e.g., 0.12 kWh/km)
 * @param {number} batteryCapacityKWh - Total Battery Capacity (e.g., 30.2 kWh)
 * @returns {number} - Percentage of battery consumed
 */
function calculateSOCConsumption(distanceKm, efficiencyKWhPerKm, batteryCapacityKWh) {
    if (!distanceKm || !efficiencyKWhPerKm || !batteryCapacityKWh) return 0;
    
    // Formula: (Energy Needed / Total Capacity) * 100
    const energyNeeded = distanceKm * efficiencyKWhPerKm;
    const socConsumed = (energyNeeded / batteryCapacityKWh) * 100;
    
    return parseFloat(socConsumed.toFixed(2));
}

module.exports = {
  getDistanceKm,
  getEstimatedTravelTimeMinutes,
  calculateSOCConsumption,
  EARTH_RADIUS_KM,
};