/**
 * BATTERY ROUTER v9.7 (Scoring Rescue Fix)
 * Updates:
 * - 🟢 SCORE RESCUE: Disables strict power penalties when in Fallback/Rescue mode.
 * - 🟢 Ensures FAST routes can successfully pick a 3.3kW charger in a gap.
 * - 🟢 Retains all previous logic (Geometry, Dest Toggle, 3-Stage Search).
 */

const { getDistanceKm } = require('../utils/distance');
const { calculateGreenScore } = require('../utils/scoringEngine');

const AVG_SPEED_KMH = 70; 

// --- Helpers ---

function findClosestPolylineIndex(routePoints, lat, lng) {
    let minDidst = Infinity;
    let closestIndex = 0;
    for (let i = 0; i < routePoints.length; i++) {
        const d = getDistanceKm(lat, lng, routePoints[i].latitude, routePoints[i].longitude);
        if (d < minDidst) { minDidst = d; closestIndex = i; }
    }
    return closestIndex;
}

function getPointAhead(routePoints, startIndex, kmToAdvance) {
    if (!routePoints || routePoints.length === 0) return { latitude: 0, longitude: 0 };
    let accumulated = 0;
    for (let i = startIndex; i < routePoints.length - 1; i++) {
        const p1 = routePoints[i];
        const p2 = routePoints[i+1];
        const segDist = getDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        if (accumulated + segDist >= kmToAdvance) return p2; 
        accumulated += segDist;
    }
    return routePoints[routePoints.length - 1]; 
}

function calculateChargeTime(currentSOC, targetSOC, capacity, stationPowerKW, carMaxKW) {
    if (currentSOC >= targetSOC) return 0;
    let effectivePower = Math.min(parseFloat(stationPowerKW) || 7.2, parseFloat(carMaxKW));
    const efficiency = effectivePower > 22 ? 0.95 : 0.85; 
    let totalMinutes = 0;
    let tempSOC = currentSOC;
    
    if (tempSOC < 80) {
        const targetForZoneA = Math.min(targetSOC, 80);
        const neededPercent = targetForZoneA - tempSOC;
        const kwhNeeded = (neededPercent / 100) * capacity;
        totalMinutes += (kwhNeeded / (effectivePower * efficiency)) * 60;
        tempSOC = targetForZoneA;
    }
    if (tempSOC < targetSOC && tempSOC >= 80) {
        const neededPercent = targetSOC - tempSOC;
        const kwhNeeded = (neededPercent / 100) * capacity;
        const averageTaperPower = effectivePower * 0.4; 
        totalMinutes += (kwhNeeded / (averageTaperPower * efficiency)) * 60;
    }
    return Math.round(totalMinutes);
}

// 🟢 MAIN ROUTER
async function planRoute(start, end, waypoints = [], carConfig, startSOC, bufferSOC, maxCharge, routePoints, db, userStrategy = 'FAST', isDestinationChargerAvailable = false, legDistances = []) {
    
    console.log(`\n🧠 [Router] STARTING SIMULATION (v9.7 Scoring Rescue)`);
    console.log(`   - Route: Start -> ${waypoints.length} Stops -> End`);
    
    const visitedStationIds = new Set(); 
    const allScannedStations = new Map(); 

    let currentSOC = parseFloat(startSOC);
    let currentLoc = { lat: start.lat || start.latitude, lng: start.lng || start.longitude };
    let accumulatedTimeMin = 0;
    let totalDistanceTraveled = 0;

    const tripStartTime = new Date();

    const STRATEGIES = {
        FAST: { minBuffer: 10, searchRadius: 200, powerWeight: 2.0 },
        SLOW: { minBuffer: 25, searchRadius: 100, powerWeight: 0.5 }
    };
    const config = STRATEGIES[userStrategy] || STRATEGIES.FAST;
    const safetyBuffer = parseFloat(bufferSOC) || config.minBuffer;

    let destRequiredBuffer = safetyBuffer; 
    if (!isDestinationChargerAvailable) destRequiredBuffer = safetyBuffer + 15; 

    // Target Queue
    const waypointRequiredBuffer = isDestinationChargerAvailable ? safetyBuffer : (safetyBuffer + 5);
    const targetQueue = [
        ...waypoints.map((w, i) => ({ ...w, type: 'WAYPOINT', label: `Stop #${i+1}`, reqBuffer: waypointRequiredBuffer })),
        { ...end, type: 'DESTINATION', label: 'Destination', reqBuffer: destRequiredBuffer }
    ];
    let currentTargetIndex = 0;

    const fullItinerary = [{
        type: 'START',
        station: {
            id: 'trip_start', name: start.name || 'Start',
            lat: currentLoc.lat, lng: currentLoc.lng, address: start.address,
            powerkw: 0, connectorTypes: [], source: 'user' 
        },
        legDistance: 0, distanceFromLast: 0, arrivalSOC: currentSOC, targetSOC: currentSOC,
        chargeTime: 0, driveTime: 0, arrivalTime: tripStartTime.toISOString(), isNightStop: false
    }];

    // --- MAIN LOOP ---
    for (let leg = 0; leg < 35; leg++) { 
        if (currentTargetIndex >= targetQueue.length) break; 
        const target = targetQueue[currentTargetIndex];

        const currentHour = new Date(tripStartTime.getTime() + (accumulatedTimeMin * 60000)).getHours();
        const isNight = currentHour > 22 || currentHour < 6;

        // A. Check Reachability
        const distToTarget = getDistanceKm(currentLoc.lat, currentLoc.lng, target.lat, target.lng);
        const kwhToTarget = distToTarget * carConfig.efficiency;
        const dropToTarget = (kwhToTarget / carConfig.capacity) * 100;
        const projectedSOC = currentSOC - dropToTarget;

        if (projectedSOC >= target.reqBuffer) {
            console.log(`✅ Reached ${target.label} (${projectedSOC.toFixed(1)}%)`);
            
            const exactRoadDistKm = legDistances[currentTargetIndex] || distToTarget;
            const driveTimeMin = Math.round((exactRoadDistKm / AVG_SPEED_KMH) * 60);
            accumulatedTimeMin += driveTimeMin;
            
            let finalTargetSOC = Math.round(projectedSOC);
            let finalChargeTime = 0;

            if (isDestinationChargerAvailable) {
                if (target.type === 'DESTINATION' && projectedSOC < 70) {
                    finalTargetSOC = 70;
                    finalChargeTime = calculateChargeTime(projectedSOC, 70, carConfig.capacity, 7.2, carConfig.maxChargeRate);
                    console.log(`   ⚡ Charging at Dest: ${Math.round(projectedSOC)}% -> 70%`);
                } else if (target.type === 'WAYPOINT') {
                    const limit = parseFloat(maxCharge) || 80;
                    if (projectedSOC < limit) {
                        finalTargetSOC = limit;
                        finalChargeTime = calculateChargeTime(projectedSOC, limit, carConfig.capacity, 30, carConfig.maxChargeRate);
                        console.log(`   ⚡ Charging at Waypoint: ${Math.round(projectedSOC)}% -> ${limit}%`);
                    }
                }
                accumulatedTimeMin += finalChargeTime;
            }

            const arrivalDate = new Date(tripStartTime.getTime() + (accumulatedTimeMin * 60000));

            fullItinerary.push({
                type: target.type, 
                station: {
                    id: target.place_id || `wp_${currentTargetIndex}`, 
                    name: target.name || target.label,
                    lat: target.lat, lng: target.lng, address: target.address || target.label,
                    powerkw: 0, connectorTypes: [], source: 'user'
                },
                legDistance: exactRoadDistKm,
                distanceFromLast: exactRoadDistKm,
                arrivalSOC: Math.round(projectedSOC),
                targetSOC: finalTargetSOC, 
                driveTime: driveTimeMin,
                chargeTime: finalChargeTime, 
                arrivalTime: arrivalDate.toISOString(),
                isNightStop: isNight
            });

            currentLoc = { lat: target.lat, lng: target.lng };
            currentSOC = finalTargetSOC; 
            totalDistanceTraveled += exactRoadDistKm;
            currentTargetIndex++;
            continue; 
        }

        // B. Find Charger
        const usablePercent = currentSOC - safetyBuffer;
        const usableKwh = (usablePercent * carConfig.capacity) / 100;
        const usableRangeKm = usableKwh / carConfig.efficiency;
        
        const currentPolyIndex = findClosestPolylineIndex(routePoints, currentLoc.lat, currentLoc.lng);
        const offsetKm = Math.max(usableRangeKm * 0.9, 10); 
        const idealPoint = getPointAhead(routePoints, currentPolyIndex, offsetKm);
        
        // 🟢 SEARCH VARIABLES
        let isFallbackMode = false; // Tracks if we downgraded to SLOW
        let isDeepScanMode = false; // Tracks if we used 100km radius

        // 1. Primary Search
        let candidates = await db.adaptiveSearch(
            idealPoint.latitude, idealPoint.longitude, Array.from(visitedStationIds), userStrategy
        );

        // 2. Fallback Search (FAST -> SLOW)
        if ((!candidates.stations || candidates.stations.length === 0) && userStrategy === 'FAST') {
            console.warn(`   ⚠️ Gap in FAST coverage. Trying SLOW chargers...`);
            candidates = await db.adaptiveSearch(
                idealPoint.latitude, idealPoint.longitude, Array.from(visitedStationIds), 'SLOW'
            );
            isFallbackMode = true; // 🟢 MARK AS FALLBACK
        }

        // 3. Deep Scan (100km)
        if (!candidates.stations || candidates.stations.length === 0) {
            console.warn(`   ⚠️ Still no chargers. Attempting DEEP SCAN (100km)...`);
            candidates = await db.adaptiveSearch(
                idealPoint.latitude, idealPoint.longitude, Array.from(visitedStationIds), 'SLOW', 100000 
            );
            isDeepScanMode = true; // 🟢 MARK AS DEEP SCAN
        }

        if (!candidates.stations || candidates.stations.length === 0) {
            console.warn(`❌ CRITICAL: No chargers found even after Deep Scan.`);
            break; 
        }

        // 4. Filtering (Corridor)
        let allowedDeviation = userStrategy === 'FAST' ? 10.0 : 40.0; 
        let validCandidates = candidates.stations.filter(stat => {
            const distFromIdeal = getDistanceKm(idealPoint.latitude, idealPoint.longitude, stat.lat, stat.lng);
            return distFromIdeal < allowedDeviation;
        });

        // 5. Emergency Rescue (Disable Filter)
        if (validCandidates.length === 0 && candidates.stations.length > 0) {
            console.warn("   🚨 Filter too strict! Enabling Emergency Rescue.");
            validCandidates = candidates.stations; 
            isDeepScanMode = true; // Treat rescue like deep scan (relax scoring)
        }

        // Save All Candidates for UI
        candidates.stations.forEach(stat => {
            const dist = getDistanceKm(currentLoc.lat, currentLoc.lng, stat.lat, stat.lng);
            const kwh = dist * carConfig.efficiency;
            const drop = (kwh / carConfig.capacity) * 100;
            stat.arrivalSOC = Math.max(0, Math.round(currentSOC - drop));
            stat.distanceFromLast = dist; 
            if (!allScannedStations.has(stat.id) && !visitedStationIds.has(stat.id)) {
                allScannedStations.set(stat.id, stat);
            }
        });

        // 🟢 6. SCORING (With Rescue Logic)
        let bestStation = null;
        let bestScore = -Infinity;

        for (const s of validCandidates) {
            if (isNight && (s.badge === 'BRONZE' || !s.badge)) continue;

            let score = calculateGreenScore(s); 
            if (userStrategy === 'FAST') score += (parseFloat(s.powerkw || 0) * config.powerWeight); 
            else if (s.badge === 'SILVER' || s.badge === 'GOLD') score += 20;

            const distFromIdeal = getDistanceKm(s.lat, s.lng, idealPoint.latitude, idealPoint.longitude);
            score -= (distFromIdeal * 2.0); 

            // 🟢 CRITICAL FIX: Disable strict power penalty in fallback modes
            // If we are desperate (Fallback/Deep Scan), accept ANY power level (>0).
            // Only punish <7kW if we are in strict Standard mode.
            if (!isFallbackMode && !isDeepScanMode) {
                if ((parseFloat(s.powerkw) || 0) < 7) score -= 5000;
            }

            if (s.arrivalSOC < safetyBuffer) score -= 1000;

            if (score > bestScore) {
                bestScore = score;
                bestStation = s;
            }
        }

        if (bestStation && bestScore > -5000) { // 🟢 Lowered threshold slightly just in case
            visitedStationIds.add(bestStation.id);
            const driveTimeMin = Math.round((bestStation.distanceFromLast / AVG_SPEED_KMH) * 60);
            accumulatedTimeMin += driveTimeMin;
            const arrivalDate = new Date(tripStartTime.getTime() + (accumulatedTimeMin * 60000));

            let targetChargeSOC = parseFloat(maxCharge) || 80;
            
            if (currentTargetIndex === targetQueue.length - 1) { 
                const distToFinal = getDistanceKm(bestStation.lat, bestStation.lng, target.lat, target.lng);
                const kwhNeeded = distToFinal * carConfig.efficiency;
                const percentNeeded = (kwhNeeded / carConfig.capacity) * 100;
                const minRequiredCharge = percentNeeded + target.reqBuffer + 5; 
                if (targetChargeSOC < minRequiredCharge) targetChargeSOC = Math.min(100, minRequiredCharge);
            }

            const chargeMinutes = calculateChargeTime(
                bestStation.arrivalSOC, targetChargeSOC, carConfig.capacity, 
                parseFloat(bestStation.powerkw), carConfig.maxChargeRate
            );
            accumulatedTimeMin += chargeMinutes;

            fullItinerary.push({
                type: 'CHARGER',
                station: bestStation,
                legDistance: bestStation.distanceFromLast,
                distanceFromLast: bestStation.distanceFromLast,
                arrivalSOC: bestStation.arrivalSOC,
                targetSOC: Math.round(targetChargeSOC),
                driveTime: driveTimeMin,
                chargeTime: chargeMinutes,
                arrivalTime: arrivalDate.toISOString(),
                isNightStop: isNight 
            });

            currentLoc = { lat: bestStation.lat, lng: bestStation.lng };
            currentSOC = targetChargeSOC;
            totalDistanceTraveled += bestStation.distanceFromLast;
        } else {
            console.warn(`⚠️ No suitable station found (Best Score: ${bestScore}).`);
            break;
        }
    }

    console.log(`✅ [Router] Complete. Total Stops: ${fullItinerary.length}. Candidates saved: ${allScannedStations.size}`);

    return { 
        plannedStops: fullItinerary, 
        allCandidates: Array.from(allScannedStations.values()),
        summary: {
            totalDistanceKm: totalDistanceTraveled, 
            totalDurationMin: accumulatedTimeMin,
            finalSOC: currentSOC
        }
    };
}

module.exports = { planRoute };