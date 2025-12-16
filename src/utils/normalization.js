/**
 * Data Normalization Utilities
 * Ensures consistent data formats across all fetchers
 */

/**
 * Normalize Power Rating
 * - Converts strings to floats
 * - Handles NaNs/Nulls
 * - Applies a default fallback if value is invalid or <= 0
 * * @param {string|number} value - The raw power value
 * @param {number} fallback - Default kW to use if invalid (default: 15)
 * @returns {number} - Valid power in kW
 */
function normalizePower(value, fallback = 15) {
    const p = parseFloat(value);
    // If p is a valid number greater than 0, return it.
    // Otherwise, return the fallback.
    return (!isNaN(p) && p > 0) ? p : fallback;
}

module.exports = { normalizePower };