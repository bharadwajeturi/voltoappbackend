/**
 * SCORING ENGINE (Updated)
 * - Night Mode Awareness
 * - Specific Amenity Bonuses
 */

function calculateGreenScore(station) {
    let score = station.trustscore || 50;

    // 1. Power Bonus
    const power = parseFloat(station.powerkw) || 0;
    if (power >= 50) score += 20;
    else if (power >= 25) score += 10;
    else if (power > 0) score += 5;

    // 2. Source Bonus
    if (station.source === 'gov') score += 5;

    // 3. Amenity Bonus (Specific Weights)
    const amenities = (station.amenities || []).join(' ').toLowerCase();
    
    if (amenities.includes('mall') || amenities.includes('shopping')) score += 8;
    if (amenities.includes('restaurant') || amenities.includes('food')) score += 5;
    if (amenities.includes('toilet') || amenities.includes('restroom')) score += 5;
    if (amenities.includes('hotel') || amenities.includes('lodging')) score += 5;
    
    // Generic amenity boost if specific ones not found but count is high
    if (station.amenities && station.amenities.length > 3) score += 3;

    // 4. Time-of-Day Logic (Night Mode)
    // If it's night (10PM - 6AM), penalize low-trust stations (likely isolated)
    const hour = new Date().getHours();
    const isNight = hour >= 22 || hour <= 6;
    
    if (isNight) {
        // If it's not a verified Gov/Tata/Shell station, penalize
        const isTrustedBrand = ['tata', 'shell', 'gov', 'zeon', 'jio'].some(b => 
            (station.operator || '').toLowerCase().includes(b)
        );
        
        if (!isTrustedBrand && score < 70) {
            score -= 15; // Penalize unknown/isolated chargers at night
        }
    }

    // 5. Ghost Station Penalty
    if (power === 0) score -= 30;

    return Math.min(100, Math.max(0, Math.round(score)));
}

module.exports = { calculateGreenScore };