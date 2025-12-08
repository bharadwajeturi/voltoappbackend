const ApiError = require('../utils/errorHandler');

// UTILITY FUNCTIONS (EMBEDDED - NO EXTERNAL DEPENDENCIES)
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getEstimatedTravelTimeMinutes(distanceKm) {
  return Math.round(distanceKm / 60 * 60); // 60 km/h average speed (mixed highway/city)
}

function filterAmenitiesByETA(amenities, arrivalTime) {
  const hour = arrivalTime.getHours();
  
  // Filter amenities by time of day
  if (hour >= 6 && hour < 11) {
    return amenities.filter(a => a.includes('breakfast') || a.includes('coffee'));
  }
  if (hour >= 11 && hour < 16) {
    return amenities.filter(a => a.includes('lunch') || a.includes('coffee'));
  }
  if (hour >= 16 && hour >= 19) {
    return amenities.filter(a => a.includes('coffee') || a.includes('snack'));
  }
  if (hour >= 19 && hour < 23) {
    return amenities.filter(a => a.includes('dinner'));
  }
  return amenities.filter(a => a.includes('coffee') || a.includes('restroom'));
}

const CARMODELS = {
  'Tata Nexon EV': { range: 437, efficiency: 4.16, maxChargeRate: 7.2, chargeTime80Percent: 60 },
  'Mahindra XUV400': { range: 456, efficiency: 6.0, maxChargeRate: 6.6, chargeTime80Percent: 50 },
  'Hyundai Kona Electric': { range: 452, efficiency: 5.8, maxChargeRate: 7.2, chargeTime80Percent: 55 },
  'MG ZS EV': { range: 461, efficiency: 5.5, maxChargeRate: 6.6, chargeTime80Percent: 60 },
  'BMW i4': { range: 590, efficiency: 5.9, maxChargeRate: 11.0, chargeTime80Percent: 35 },
  'Tesla Model 3': { range: 629, efficiency: 6.3, maxChargeRate: 15.0, chargeTime80Percent: 30 }
};

function validateBatteryParams(startSOC, targetArrivalSOC, maxChargeSOC) {
  if (startSOC < 0 || startSOC > 100) {
    throw new ApiError('Start SOC must be 0-100%', 400);
  }
  if (targetArrivalSOC < 0 || targetArrivalSOC > 100) {
    throw new ApiError('Target arrival SOC must be 0-100%', 400);
  }
  if (maxChargeSOC < 0 || maxChargeSOC > 100) {
    throw new ApiError('Max charge SOC must be 0-100%', 400);
  }
  if (targetArrivalSOC >= startSOC) {
    throw new ApiError('Target arrival SOC must be less than start SOC', 400);
  }
  if (maxChargeSOC <= targetArrivalSOC) {
    throw new ApiError('Max charge SOC must be higher than target arrival SOC', 400);
  }
  return true;
}

async function planRoute(start, end, carModel, startSOC, targetArrivalSOC, maxChargeSOC = 80, startTime = new Date(), db) {
  console.log('🔋 BATTERY ROUTER: Starting route planning');
  console.log(`🚗 Car: ${carModel}, Battery: ${startSOC}% → ${targetArrivalSOC}%`);

  // Validate
  validateBatteryParams(startSOC, targetArrivalSOC, maxChargeSOC);
  
  if (!CARMODELS[carModel]) {
    throw new ApiError(`Unknown car model ${carModel}`, 400, {
      availableModels: Object.keys(CARMODELS)
    });
  }

  const car = CARMODELS[carModel];
  const directDistanceKm = getDistanceKm(start.lat, start.lng, end.lat, end.lng);
  const maxRangeKm = (startSOC / 100 - targetArrivalSOC / 100) * car.efficiency * 100;

  console.log(`📏 Distance: ${directDistanceKm.toFixed(1)}km, Range: ${maxRangeKm.toFixed(1)}km`);

  // No stops needed?
  if (directDistanceKm <= maxRangeKm * 0.9) {
    console.log('✅ Direct route possible - no charging needed');
    return createNoStopsRoute(start, end, carModel, startSOC, targetArrivalSOC, directDistanceKm);
  }

  // Plan stops
  const stops = [];
  let currentLat = start.lat;
  let currentLng = start.lng;
  let currentSOC = startSOC;
  let currentTime = new Date(startTime);

  // Max 5 stops
  for (let i = 0; i < 5; i++) {
    const remainingDistance = getDistanceKm(currentLat, currentLng, end.lat, end.lng);
    const remainingRange = (currentSOC / 100 - targetArrivalSOC / 100) * car.efficiency * 100;
    
    if (remainingDistance <= remainingRange * 0.8) break; // Can reach destination

    // Find stations (RULE 2: DB FIRST)
    const dbResult = await db.adaptiveSearch(currentLat, currentLng);
    const stations = dbResult.stations;
    
    if (stations.length === 0) break; // No stations, end planning

    const bestStation = selectBestStation(stations, currentLat, currentLng, end.lat, end.lng);

    // Leg to station
    const legDistance = getDistanceKm(currentLat, currentLng, bestStation.lat, bestStation.lng);
    const arrivalSOC = currentSOC - (legDistance / car.efficiency);
    
    if (arrivalSOC < 10) break; // Too risky

    // Charging
    const chargeToSOC = Math.min(maxChargeSOC, 100);
    const chargeTime = calculateChargeTime(arrivalSOC, chargeToSOC, car);
    const travelTime = getEstimatedTravelTimeMinutes(legDistance);
    const arrivalTime = new Date(currentTime.getTime() + travelTime * 60000);
    const departureTime = new Date(arrivalTime.getTime() + chargeTime * 60000);

    stops.push({
      stopNumber: stops.length + 1,
      station: bestStation,
      leg: { distanceKm: legDistance.toFixed(1), durationMinutes: travelTime },
      charging: {
        arrivalSOC: Math.round(arrivalSOC),
        departureSOC: chargeToSOC,
        chargeTimeMinutes: chargeTime
      },
      eta: arrivalTime.toISOString(),
      amenities: filterAmenitiesByETA(bestStation.amenities || [], arrivalTime)
    });

    currentLat = bestStation.lat;
    currentLng = bestStation.lng;
    currentSOC = chargeToSOC;
    currentTime = departureTime;
  }

  // Final leg
  const finalDistance = getDistanceKm(currentLat, currentLng, end.lat, end.lng);
  const finalSOC = currentSOC - (finalDistance / car.efficiency);
  const finalTravelTime = getEstimatedTravelTimeMinutes(finalDistance);
  const finalETA = new Date(currentTime.getTime() + finalTravelTime * 60000);

  const totalDistance = directDistanceKm;

  console.log(`✅ ROUTE COMPLETE: ${stops.length} stops, final SOC: ${finalSOC.toFixed(1)}%`);

  return {
    status: 'success',
    route: {
      startPoint: { lat: start.lat, lng: start.lng },
      endPoint: { lat: end.lat, lng: end.lng },
      carModel,
      statistics: {
        totalDistance: totalDistance.toFixed(1),
        totalStops: stops.length,
        totalTime: getEstimatedTravelTimeMinutes(totalDistance),
        finalSOC: Math.round(finalSOC)
      },
      finalLeg: {
        distanceKm: finalDistance.toFixed(1),
        arrivalSOC: Math.round(finalSOC)
      }
    },
    plannedStops: stops
  };
}

function createNoStopsRoute(start, end, carModel, startSOC, targetArrivalSOC, distanceKm) {
  const car = CARMODELS[carModel];
  const finalSOC = startSOC - (distanceKm / car.efficiency);
  const travelTime = getEstimatedTravelTimeMinutes(distanceKm);
  const eta = new Date(Date.now() + travelTime * 60000);

  return {
    status: 'success',
    route: {
      startPoint: { lat: start.lat, lng: start.lng },
      endPoint: { lat: end.lat, lng: end.lng },
      carModel,
      statistics: {
        totalDistance: distanceKm.toFixed(1),
        totalStops: 0,
        totalTime: travelTime,
        finalSOC: Math.round(finalSOC)
      },
      finalLeg: {
        distanceKm: distanceKm.toFixed(1),
        arrivalSOC: Math.round(finalSOC)
      }
    },
    plannedStops: []
  };
}

function selectBestStation(stations, currentLat, currentLng, destLat, destLng) {
  const scored = stations.map(station => {
    const distToStation = getDistanceKm(currentLat, currentLng, station.lat, station.lng);
    const distToDest = getDistanceKm(station.lat, station.lng, destLat, destLng);
    
    const score = 
      ((station.trustscore || 50) / 100) * 0.4 +
      ((station.powerkw || 7) / 100) * 0.3 +
      (1 / (distToStation + 1)) * 0.2 +
      (1 / (distToStation + 1)) * 0.1;
    
    return { ...station, score, distToStation };
  });
  
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

function calculateChargeTime(fromSOC, toSOC, car) {
  const pct = toSOC - fromSOC;
  return Math.round((pct / 80) * car.chargeTime80Percent);
}

module.exports = { planRoute, CARMODELS };
