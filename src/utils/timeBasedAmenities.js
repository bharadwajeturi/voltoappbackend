/**
 * Time-Based Amenity Filtering
 * 
 * RULE #5 Implementation: Filter amenities based on arrival time at station
 * NOT trip start time
 * 
 * Times:
 * - 6-11 AM: Breakfast (Tiffin, Idli, Dosa, Samosa)
 * - 11 AM-4 PM: Lunch (Biryani, Thali, Curry)
 * - 4-6 PM: Coffee/Snack (Cafe, Chai)
 * - 6-11 PM: Dinner (Pizza, Chinese, Fast Food)
 * - 11 PM-6 AM: Late Night (24-hour only)
 */

/**
 * Filter amenities based on time of day
 * @param {Array} amenities - List of amenities from API
 * @param {Date} etaTime - Estimated arrival time at this station
 * @returns {Array} - Filtered amenities relevant to the time
 */
function filterAmenitiesByETA(amenities, etaTime) {
  if (!amenities || amenities.length === 0) {
    return [];
  }

  if (!etaTime) {
    return amenities;
  }

  const hour = new Date(etaTime).getHours();
  const dayOfWeek = new Date(etaTime).getDay();

  console.log(`[Amenities] Filtering for ${hour}:00 (${getDayName(dayOfWeek)})`);

  // 6-11 AM: BREAKFAST
  if (hour >= 6 && hour < 11) {
    console.log(`  → Time: BREAKFAST (6-11 AM)`);
    return amenities.filter(a =>
      a.type === 'Restaurant' &&
      a.cuisineType &&
      a.cuisineType.match(/breakfast|tiffin|idli|dosa|poha|upma|samosa|paratha/i)
    );
  }

  // 11 AM - 4 PM: LUNCH
  if (hour >= 11 && hour < 16) {
    console.log(`  → Time: LUNCH (11 AM - 4 PM)`);
    return amenities.filter(a =>
      a.type === 'Restaurant' &&
      a.cuisineType &&
      a.cuisineType.match(/lunch|biryani|thali|curry|meal|south indian|north indian|rice/i)
    );
  }

  // 4 PM - 6 PM: COFFEE/SNACK
  if (hour >= 16 && hour < 18) {
    console.log(`  → Time: COFFEE/SNACK (4-6 PM)`);
    return amenities.filter(a =>
      (a.type === 'Cafe' || a.type === 'Restaurant') &&
      a.cuisineType &&
      a.cuisineType.match(/coffee|tea|snack|pastry|chai|juice|smoothie/i)
    );
  }

  // 6 PM - 11 PM: DINNER
  if (hour >= 18 && hour < 23) {
    console.log(`  → Time: DINNER (6-11 PM)`);
    return amenities.filter(a =>
      a.type === 'Restaurant' &&
      a.cuisineType &&
      a.cuisineType.match(/dinner|pizza|chinese|fast food|burger|kebab|grilled/i)
    );
  }

  // 11 PM - 6 AM: LATE NIGHT (24-hour only)
  if (hour >= 23 || hour < 6) {
    console.log(`  → Time: LATE NIGHT (11 PM - 6 AM - 24-hour only)`);
    return amenities.filter(a =>
      (a.type === 'Restaurant' || a.type === 'Cafe' || a.type === 'FastFood') &&
      (a.openingHours?.includes('24') || a.openingHours?.includes('Open 24'))
    );
  }

  // Fallback: return all restaurants
  console.log(`  → Time: DEFAULT (all restaurants)`);
  return amenities.filter(a => a.type === 'Restaurant');
}

/**
 * Get readable day name
 * @param {number} dayOfWeek - 0=Sunday, 1=Monday, etc.
 * @returns {string} - Day name
 */
function getDayName(dayOfWeek) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek] || 'Unknown';
}

/**
 * Get time period name
 * @param {Date} time - Time to check
 * @returns {string} - Period name (breakfast, lunch, snack, dinner, late-night)
 */
function getTimePeriod(time) {
  const hour = new Date(time).getHours();

  if (hour >= 6 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 18) return 'snack';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'late-night';
}

module.exports = {
  filterAmenitiesByETA,
  getTimePeriod,
  getDayName,
};

