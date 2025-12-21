/**
 * BATTERY ROUTER v5.1 (Debugged & Enhanced)
 * Features: 
 * - Dynamic Physics (Efficiency/Capacity from user)
 * - Non-linear Charging Curve (0-80% fast, 80-100% slow)
 * - "All Candidates" collection for frontend
 * - Verbose Logging for Debugging
 */

const { getDistanceKm } = require('../utils/distance');
const { calculateGreenScore } = require('../utils/scoringEngine');

/**
 * Calculates time (minutes) to charge with Charging Curve & Efficiency
 */
function calculateChargeTime(currentSOC, targetSOC, capacity, stationPowerKW, carMaxKW) {
    if (currentSOC >= targetSOC) return 0;

    // 1. Determine Effective Power
    // The car will pull the lesser of what the station offers or what it can handle.
    let effectivePower = Math.min(parseFloat(stationPowerKW) || 7.2, parseFloat(carMaxKW));
    
    // 2. Efficiency Factor (Heat loss, AC/DC conversion)
    // DC Fast Charging is usually ~90-95% efficient. AC is ~85%.
    const efficiency = effectivePower > 22 ? 0.95 : 0.85; 
    
    let totalMinutes = 0;
    let tempSOC = currentSOC;
    
    // 3. Charging Curve Simulation (Step-wise calculation)
    
    // Zone A: 0% to 80% (Fastest)
    if (tempSOC < 80) {
        const targetForZoneA = Math.min(targetSOC, 80);
        const neededPercent = targetForZoneA - tempSOC;
        const kwhNeeded = (neededPercent / 100) * capacity;
        
        // In the fast zone, we get roughly the full effective power
        // Time = kWh / (Power * Efficiency)
        const timeHours = kwhNeeded / (effectivePower * efficiency);
        totalMinutes += timeHours * 60;
        
        tempSOC = targetForZoneA; // Advance our virtual battery
    }

    // Zone B: 80% to 100% (Tapering)
    if (tempSOC < targetSOC && tempSOC >= 80) {
        const neededPercent = targetSOC - tempSOC;
        const kwhNeeded = (neededPercent / 100) * capacity;
        
        // Power drops significantly after 80%. 
        // We'll use a conservative 40% average factor for the taper zone.
        const taperFactor = 0.4; 
        const averageTaperPower = effectivePower * taperFactor;
        
        const timeHours = kwhNeeded / (averageTaperPower * efficiency);
        totalMinutes += timeHours * 60;
    }

    return Math.round(totalMinutes);
}

/**
 * Accurately finds a coordinate X km along the route polyline
 */
function getPointAtDistance(routePoints, targetDistKm) {
    if (!routePoints || routePoints.length === 0) return { latitude: 0, longitude: 0 };
    if (targetDistKm <= 0) return routePoints[0];

    let accumulatedDist = 0;

    for (let i = 0; i < routePoints.length - 1; i++) {
        const p1 = routePoints[i];
        const p2 = routePoints[i+1];
        const segmentDist = getDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        
        if (accumulatedDist + segmentDist >= targetDistKm) {
            return p2; 
        }
        accumulatedDist += segmentDist;
    }
    return routePoints[routePoints.length - 1];
}

/**
 * MAIN PLANNING FUNCTION
 */
async function planRoute(start, end, carConfig, startSOC, bufferSOC, maxCharge, routePoints, db, userStrategy = 'FAST') {
    
    console.log(`\n🧠 [Router] STARTING SIMULATION`);
    console.log(`   - Car: ${carConfig.capacity}kWh | Eff: ${carConfig.efficiency.toFixed(3)} kWh/km | MaxCharge: ${carConfig.maxChargeRate}kW`);
    console.log(`   - Trip: SOC ${startSOC}% -> Buffer ${bufferSOC}%`);

    const stops = [];
    const visitedStationIds = new Set(); 
    
    // Collection for "Alternative Stations" (Map to prevent duplicates)
    const allScannedStations = new Map(); 

    let currentSOC = parseFloat(startSOC);
    let currentLoc = { lat: start.lat || start.latitude, lng: start.lng || start.longitude };
    let distanceCursor = 0; 

    // Strategy Config
    const STRATEGIES = {
        FAST: { minBuffer: 10, searchRadius: 200, powerWeight: 2.0 },
        SLOW: { minBuffer: 25, searchRadius: 100, powerWeight: 0.5 }
    };
    const config = STRATEGIES[userStrategy] || STRATEGIES.FAST;
    const safetyBuffer = parseFloat(bufferSOC) || config.minBuffer;

    for (let leg = 0; leg < 15; leg++) { 
        console.log(`   📍 [Leg ${leg}] Dist: ${distanceCursor.toFixed(1)}km | SOC: ${currentSOC.toFixed(1)}%`);

        // A. Check Distance to Destination
        const distToEnd = getDistanceKm(currentLoc.lat, currentLoc.lng, end.lat || end.latitude, end.lng || end.longitude);
        const kwhRemaining = (currentSOC * carConfig.capacity) / 100;
        const rangeKm = kwhRemaining / carConfig.efficiency;

        console.log(`      - Range: ${rangeKm.toFixed(1)}km | Dist to End: ${distToEnd.toFixed(1)}km`);

        if (rangeKm > distToEnd + 20) { 
            console.log("✅ Destination reachable! Ending simulation.");
            break;
        }

        // B. Calculate Search Window
        const usablePercent = currentSOC - safetyBuffer;
        const usableKwh = (usablePercent * carConfig.capacity) / 100;
        const usableRangeKm = usableKwh / carConfig.efficiency;

        if (usableRangeKm <= 0) {
            console.warn("      ⚠️ CRITICAL: SOC below buffer! Searching immediately.");
        }

        // Look ahead: Search at 90% of usable range
        const searchDistOffset = Math.max(usableRangeKm * 0.9, 10); 
        const targetSearchDist = distanceCursor + searchDistOffset;
        const idealPoint = getPointAtDistance(routePoints, targetSearchDist);
        
        console.log(`      🔎 Searching near KM ${targetSearchDist.toFixed(1)} (${searchDistOffset.toFixed(1)}km ahead)...`);

        // C. Query DB
        const candidates = await db.adaptiveSearch(
            idealPoint.latitude, 
            idealPoint.longitude, 
            Array.from(visitedStationIds), 
            userStrategy
        );

        if (!candidates.stations || candidates.stations.length === 0) {
            console.warn("      ❌ No chargers found in this leg. Simulation halted.");
            break; 
        }

        console.log(`      👉 Found ${candidates.stations.length} candidates.`);

        // Collect candidates for Frontend
        // 🟢 NEW: Calculate SOC for EVERY candidate relative to this leg start
        candidates.stations.forEach(s => {
            if (!visitedStationIds.has(s.id)) {
                // Physics calculation for this specific station
                const legDist = getDistanceKm(currentLoc.lat, currentLoc.lng, s.lat, s.lng);
                const kwhUsed = legDist * carConfig.efficiency;
                const socDrop = (kwhUsed / carConfig.capacity) * 100;
                const arrival = Math.max(0, Math.round(currentSOC - socDrop));
                
                // Add physics data to the station object
                s.arrivalSOC = arrival;
                s.legDistance = legDist;
                
                // Store in global map (prevent duplicates, keep best SOC if seen twice)
                if (!allScannedStations.has(s.id) || allScannedStations.get(s.id).arrivalSOC < arrival) {
                    allScannedStations.set(s.id, s);
                }
            }
        });

        // D. Ranking Logic
        let bestStation = null;
        let bestScore = -Infinity;

        const candidatesForLeg = candidates.stations;

        // Night Mode Calc
        const etaHours = (targetSearchDist / 80); 
        const arrivalHour = (new Date().getHours() + etaHours) % 24;
        const isNight = arrivalHour > 22 || arrivalHour < 6;

        for (const s of candidatesForLeg) {
            if (isNight && (s.badge === 'BRONZE' || !s.badge)) continue;

            let score = calculateGreenScore(s); 

            if (userStrategy === 'FAST') {
                score += (parseFloat(s.powerkw || 0) * config.powerWeight); 
            } else {
                if (s.badge === 'SILVER' || s.badge === 'GOLD') score += 20;
            }

            const distFromIdeal = getDistanceKm(s.lat, s.lng, idealPoint.latitude, idealPoint.longitude);
            score -= (distFromIdeal * 0.5); 

            // Hard Constraint: Must arrive with buffer
            if (s.arrivalSOC < safetyBuffer) score -= 1000;

            if (score > bestScore) {
                bestScore = score;
                bestStation = s;
            }
        }

        if (bestStation && bestScore > -500) {
            console.log(`      🏆 Winner: ${bestStation.name} (${bestStation.powerkw}kW) - Score: ${bestScore.toFixed(1)}`);
            visitedStationIds.add(bestStation.id);

            // E. Calculate Leg Stats
            const legDist = getDistanceKm(currentLoc.lat, currentLoc.lng, bestStation.lat, bestStation.lng);
            const kwhConsumed = legDist * carConfig.efficiency;
            const percentConsumed = (kwhConsumed / carConfig.capacity) * 100;
            const arrivalSOC = Math.max(0, Math.round(currentSOC - percentConsumed));

            // Charging Stats
            const targetChargeSOC = parseFloat(maxCharge) || 80;
            const chargeMinutes = calculateChargeTime(
                bestStation.arrivalSOC, 
                targetChargeSOC, 
                carConfig.capacity, 
                parseFloat(bestStation.powerkw), 
                carConfig.maxChargeRate
            );

            stops.push({
                station: bestStation,
                legDistance: bestStation.legDistance,
                arrivalSOC: bestStation.arrivalSOC,
                targetSOC: targetChargeSOC,
                chargeTime: chargeMinutes,
                isNightStop: isNight
            });

            currentLoc = { lat: bestStation.lat, lng: bestStation.lng };
            currentSOC = targetChargeSOC;
            distanceCursor += bestStation.legDistance; 
            
        } else {
            console.warn("      ⚠️ Stations found but all filtered out (Night mode / Low Score).");
            break;
        }
    }

    console.log(`🧠 [Router] Finished. Planned ${stops.length} stops.`);

    return { 
        plannedStops: stops,
        allCandidates: Array.from(allScannedStations.values()) 
    };
}

module.exports = { planRoute };