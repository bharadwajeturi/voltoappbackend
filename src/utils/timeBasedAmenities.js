/**
 * Time-Based Amenity Filtering
 * Status: UPDATED (Type Normalization)
 */

/**
 * TIME-BASED AMENITY FILTER
 * Suggests amenities based on time of day (e.g., Coffee in AM, Dinner in PM).
 */

function filterAmenitiesByETA(amenities, etaDate) {
    if (!amenities || amenities.length === 0) return [];
    
    const arrivalHour = new Date(etaDate).getHours();
    
    // Simple Heuristic
    const isMorning = arrivalHour >= 5 && arrivalHour < 11; // Coffee/Breakfast
    const isLunch = arrivalHour >= 11 && arrivalHour < 15;  // Restaurants
    const isDinner = arrivalHour >= 18 && arrivalHour < 22; // Restaurants
    const isLate = arrivalHour >= 22 || arrivalHour < 5;    // 24/7 or Hotels

    return amenities.map(a => {
        let relevance = 1;
        const type = (a.type || '').toLowerCase();

        if (isMorning && type.includes('cafe')) relevance = 2;
        if ((isLunch || isDinner) && type.includes('restaurant')) relevance = 2;
        if (isLate && (type.includes('hotel') || type.includes('lodging'))) relevance = 2;

        return { ...a, relevance };
    }).sort((a, b) => b.relevance - a.relevance);
}

module.exports = { filterAmenitiesByETA };
