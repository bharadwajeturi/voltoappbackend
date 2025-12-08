/**
 * Distance calculations for route planning
 * Haversine formula for great-circle distance between two points on Earth
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Calculate distance between two lat/lng points using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lng1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lng2 - Longitude of point 2
 * @returns {number} - Distance in kilometers
 */
function getDistanceKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) {
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

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} - Angle in radians
 */
function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate estimated travel time between two points
 * Assumes average speed of 100 km/h (typical highway speed)
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} avgSpeedKmh - Average speed in km/h (default 100)
 * @returns {number} - Time in minutes
 */
function getEstimatedTravelTimeMinutes(distanceKm, avgSpeedKmh = 100) {
  if (!distanceKm || distanceKm <= 0) return 0;
  return Math.round((distanceKm / avgSpeedKmh) * 60);
}

/**
 * Calculate battery consumption for a distance
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} efficiencyKmPerPercent - Km per 1% battery (e.g., 3 km/%)
 * @returns {number} - Battery percentage consumed
 */
function getBatteryConsumption(distanceKm, efficiencyKmPerPercent = 3) {
  if (!distanceKm || !efficiencyKmPerPercent) return 0;
  return parseFloat((distanceKm / efficiencyKmPerPercent).toFixed(2));
}

module.exports = {
  getDistanceKm,
  getEstimatedTravelTimeMinutes,
  getBatteryConsumption,
  EARTH_RADIUS_KM,
};
