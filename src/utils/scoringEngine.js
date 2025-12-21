/**
 * SCORING ENGINE (v4.3)
 */

function calculateGreenScore(station) {
    let score = station.trustscore || 50;

    // 1. Power Bonus (Only for FAST chargers)
    const power = parseFloat(station.powerkw) || 0;
    if (power >= 50) score += 20;
    else if (power >= 25) score += 10;
    else if (power > 0) score += 5;

    // 2. Brand/Gov Bonus
    if (station.source === 'gov') score += 5;
    if (['Tata Power', 'Zeon', 'Shell'].some(b => (station.operator||'').includes(b))) score += 10;

    // 3. Amenity Bonus
    const amenities = (station.amenities || []).join(' ').toLowerCase();
    if (amenities.includes('mall') || amenities.includes('shopping')) score += 8;
    if (amenities.includes('food') || amenities.includes('restaurant')) score += 5;
    if (amenities.includes('toilet') || amenities.includes('restroom')) score += 5;

    // 4. Night Mode Safety Check (10PM - 6AM)
    const hour = new Date().getHours();
    const isNight = hour >= 22 || hour <= 6;
    
    if (isNight) {
        // Penalize "Bronze" (likely unverified/isolated) stations
        if (station.badge === 'BRONZE') {
            score -= 30; // Heavy penalty
        }
    }

    return Math.min(100, Math.max(0, Math.round(score)));
}

module.exports = { calculateGreenScore };