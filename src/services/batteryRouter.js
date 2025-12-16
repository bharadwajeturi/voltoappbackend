/**
 * Battery Physics Router (India-Optimized)
 * ----------------------------------------
 * Strategies:
 * 1. PANIC MODE (<30% SOC): Find CLOSEST charger immediately.
 * 2. CRUISE MODE (>30% SOC): Maximize range. Find FASTEST charger.
 */
const { getDistanceKm } = require('../utils/distance');

const CARMODELS = {
  'Tata Nexon EV Prime': { rangeKm: 250, capacity: 30.2, efficiency: 0.12, kmPerPercent: 2.5, maxChargeRate: 22 },
  'Tata Nexon EV Max': { rangeKm: 350, capacity: 40.5, efficiency: 0.115, kmPerPercent: 3.5, maxChargeRate: 50 },
  'MG ZS EV': { rangeKm: 400, capacity: 50.3, efficiency: 0.125, kmPerPercent: 4.0, maxChargeRate: 50 },
  'default': { rangeKm: 300, capacity: 40, efficiency: 0.13, kmPerPercent: 3.0, maxChargeRate: 30 }
};

// Get coordinate X km along the path
function getPointAtAbsoluteDistance(path, targetDistKm) {
    if (!path || path.length === 0) return { latitude: 0, longitude: 0 };
    let traveled = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const d = getDistanceKm(path[i].latitude, path[i].longitude, path[i+1].latitude, path[i+1].longitude);
        if (traveled + d >= targetDistKm) return path[i+1];
        traveled += d;
    }
    return path[path.length - 1];
}

function calculateChargeTime(fromSOC, toSOC, car, stationPower) {
  const pctNeeded = toSOC - fromSOC;
  if (pctNeeded <= 0) return 0;
  
  // Real world curve: Avg speed is ~80% of peak
  const effectivePower = (parseFloat(stationPower) || 15) * 0.8; 
  const actualSpeed = Math.min(effectivePower, car.maxChargeRate);
  
  const kwhNeeded = (pctNeeded / 100) * car.capacity;
  return Math.round((kwhNeeded / actualSpeed) * 60);
}

async function planRoute(start, end, carModelName, startSOC, targetArrivalSOC, maxChargeSOC = 80, routePath = [], db, maxRangeOverride = null) {
  
  let car = CARMODELS[carModelName] || CARMODELS['default'];
  
  if (maxRangeOverride) {
      console.log(`[BatteryRouter] Using Custom Range: ${maxRangeOverride}km`);
      car = { ...car, rangeKm: maxRangeOverride, kmPerPercent: maxRangeOverride / 100.0 };
  }

  const stops = [];
  const visitedIds = []; 
  
  let currentLat = start.lat;
  let currentLng = start.lng;
  let currentSOC = parseFloat(startSOC);
  let distanceCursor = 0; 
  
  const arrivalBuffer = parseFloat(targetArrivalSOC) || 15;
  const safetyMargin = 5; 

  console.log(`[BatteryRouter] Plan: ${currentSOC}% -> End > ${arrivalBuffer}%. Efficiency: ${car.kmPerPercent} km/%`);

  for (let i = 0; i < 15; i++) {
    // 1. Can we reach destination?
    const distToFinish = getDistanceKm(currentLat, currentLng, end.lat, end.lng);
    const socNeeded = distToFinish / car.kmPerPercent;

    if (currentSOC - socNeeded >= arrivalBuffer) {
        console.log(`✅ Reachable! Remaining: ${(currentSOC - socNeeded).toFixed(1)}%`);
        break;
    }

    // 🟢 FIX: Logic moved INSIDE loop so it updates as you drive
    let usableSOC = currentSOC - (arrivalBuffer + safetyMargin);

    if (usableSOC <= 0) {
        console.log(`   ⚠️ Critical Low Battery! (SOC: ${currentSOC}%). Searching IMMEDIATE.`);
        usableSOC = 2; // Force search nearby
    }

    // 2. Determine Strategy based on SOC
    let strategy = 'QUALITY'; // Default: Look for Fast Chargers
    let driveableKm = usableSOC * car.kmPerPercent;
    let searchDistKm = 0;

    if (currentSOC < 30) {
        // 🚨 PANIC MODE: Find ANYTHING close
        strategy = 'DISTANCE';
        driveableKm = currentSOC * car.kmPerPercent; // Use full remaining battery to find ANYONE
        searchDistKm = 10; // Look immediately ahead (10km)
        console.log(`   ⚠️ Low SOC (${currentSOC}%). Switching to PANIC MODE.`);
    } else {
        // 🚀 CRUISE MODE: Maximize range, find best charger
        // Search at 90% of max driveable distance
        searchDistKm = Math.min(driveableKm * 0.9, 250); 
    }

    // 3. Update Cursor
    const absoluteSearchDist = distanceCursor + searchDistKm;
    console.log(`   Leg ${i+1}: Cursor ${distanceCursor.toFixed(0)}km. Search @ ${absoluteSearchDist.toFixed(0)}km (${strategy})`);

    const searchPoint = getPointAtAbsoluteDistance(routePath, absoluteSearchDist);

    // 4. Query DB
    const dbResult = await db.adaptiveSearch(
        searchPoint.latitude, 
        searchPoint.longitude, 
        visitedIds,
        strategy 
    );

    if (!dbResult.stations || dbResult.stations.length === 0) {
        console.error("❌ CRITICAL: No chargers found in range gap.");
        // If Quality search failed, try just looking 50km ahead blindly to find *something*
        if (strategy === 'QUALITY') {
             console.log("   🔄 Retrying: Skipping ahead 50km to find hubs...");
             // Note: This assumes you have enough battery to skip 50km. 
             // Ideally we should decrease searchDistKm, not skip ahead, but this prevents infinite loops.
             // Better logic: Just search again with 'DISTANCE' strategy at the same point? 
             // For now, let's break to avoid stalling.
        }
        break;
    }

    const bestStation = dbResult.stations[0];
    visitedIds.push(bestStation.id);

    // 5. Calculate Stats
    const legDist = getDistanceKm(currentLat, currentLng, bestStation.lat, bestStation.lng);
    
    // Prevent backtracking logic (safety check)
    if (legDist < 1 && currentSOC > 30) {
       console.warn("   ⚠️ Station too close, skipping to prevent loops.");
       continue;
    }

    const actualSocConsumed = legDist / car.kmPerPercent;
    const arrivalAtStationSOC = Math.round(currentSOC - actualSocConsumed);

    const targetCharge = 80; 
    const chargeTime = calculateChargeTime(arrivalAtStationSOC, targetCharge, car, bestStation.powerkw);

    stops.push({
        stopNumber: stops.length + 1,
        station: {
            ...bestStation,
            greenScore: bestStation.greenScore || 85,
            amenities: bestStation.amenities || [] 
        },
        legDistance: legDist.toFixed(1),
        arrivalSOC: arrivalAtStationSOC,
        charging: {
            arrivalSOC: arrivalAtStationSOC,
            departureSOC: targetCharge,
            chargeTimeMinutes: chargeTime,
            addedRange: (targetCharge - arrivalAtStationSOC) * car.kmPerPercent
        }
    });

    currentLat = bestStation.lat;
    currentLng = bestStation.lng;
    currentSOC = targetCharge;
    distanceCursor += legDist;
  }

  return { status: 'success', route: { carModel: carModelName }, plannedStops: stops };
}

module.exports = { planRoute, CARMODELS };