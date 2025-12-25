/**
 * BATTERY ROUTER v10.6 (Explicit Tiers & Destination Logic)
 * * * UPDATES:
 * 1. 🟢 Search Tiers: Explicitly searches 5km -> 10km -> 20km -> 50km to generate detailed logs.
 * 2. 🟢 Destination Charging: Confirmed logic handles the toggle correctly.
 * 3. 🟢 Logs: "Failed X km search" logs added as requested.
 */

const { getDistanceKm } = require('../utils/distance');
const { calculateGreenScore } = require('../utils/scoringEngine');

const DEFAULT_SPEED_KMH = 65; 
const EARTH_RADIUS_KM = 6371;

// --- MATH HELPERS ---
function toRad(deg) { return deg * (Math.PI / 180); }
function toDeg(rad) { return rad * (180 / Math.PI); }

function getBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function getCrossTrackDistance(lat1, lon1, lat2, lon2, pLat, pLon) {
    const d13 = getDistanceKm(lat1, lon1, pLat, pLon) / EARTH_RADIUS_KM; 
    const b13 = toRad(getBearing(lat1, lon1, pLat, pLon)); 
    const b12 = toRad(getBearing(lat1, lon1, lat2, lon2)); 
    const dXt = Math.asin(Math.sin(d13) * Math.sin(b13 - b12)) * EARTH_RADIUS_KM;
    return dXt; 
}

function findClosestPolylineIndex(routePoints, lat, lng) {
    let minDidst = Infinity;
    let closestIndex = 0;
    for (let i = 0; i < routePoints.length; i += 5) { 
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
async function planRoute(
    start, end, waypoints = [], carConfig, startSOC, bufferSOC, maxCharge, 
    routePoints, db, userStrategy = 'FAST', isDestinationChargerAvailable = false, 
    legConfigs = [], tripStartTime = new Date()
) {
    console.log(`\n🧠 [Router] STARTING SIMULATION (v10.6 Tiered Search)`);
    
    const visitedStationIds = new Set(); 
    const allScannedStations = new Map(); 

    let currentSOC = parseFloat(startSOC);
    let currentLoc = { lat: start.lat || start.latitude, lng: start.lng || start.longitude };
    let accumulatedTimeMin = 0;
    let totalDistanceTraveled = 0;

    const safetyBuffer = parseFloat(bufferSOC) || 10;
    const isFastStrat = userStrategy === 'FAST';

    // 🟢 DESTINATION BUFFER LOGIC
    // If we can charge at destination, we can arrive with low buffer (e.g. 10%).
    // If NOT, we need enough buffer to find a charger later (e.g. 25%).
    const destBuffer = isDestinationChargerAvailable ? safetyBuffer : (safetyBuffer + 15);

    const targetQueue = [
        ...waypoints.map((w, i) => ({ 
            ...w, type: 'WAYPOINT', label: `Stop #${i+1}`, reqBuffer: w.canCharge ? safetyBuffer : (safetyBuffer + 5) 
        })),
        { ...end, type: 'DESTINATION', label: 'Destination', reqBuffer: destBuffer }
    ];
    let currentTargetIndex = 0;
    let isAtExactNode = true; 

    const fullItinerary = [{
        type: 'START',
        station: { id: 'trip_start', name: start.name, lat: currentLoc.lat, lng: currentLoc.lng, address: start.address, powerkw: 0, connectorTypes: [], source: 'user' },
        legDistance: 0, distanceFromLast: 0, arrivalSOC: currentSOC, targetSOC: currentSOC,
        chargeTime: 0, driveTime: 0, arrivalTime: tripStartTime.toISOString(), isNightStop: false
    }];

    for (let leg = 0; leg < 35; leg++) { 
        if (currentTargetIndex >= targetQueue.length) break; 
        const target = targetQueue[currentTargetIndex];

        // 1. Distance & Speed
        const currentLegConfig = legConfigs[currentTargetIndex] || { speedKmh: DEFAULT_SPEED_KMH, distKm: 0 };
        const legSpeed = currentLegConfig.speedKmh || DEFAULT_SPEED_KMH;
        let distToTarget = isAtExactNode ? currentLegConfig.distKm : getDistanceKm(currentLoc.lat, currentLoc.lng, target.lat, target.lng) * 1.15;

        const kwhToTarget = distToTarget * carConfig.efficiency;
        const dropToTarget = (kwhToTarget / carConfig.capacity) * 100;
        const projectedSOC = currentSOC - dropToTarget;

        const currentHour = new Date(tripStartTime.getTime() + (accumulatedTimeMin * 60000)).getHours();
        const isNight = currentHour > 22 || currentHour < 6;

        // 2. REACHABILITY CHECK
        if (projectedSOC >= target.reqBuffer) {
            console.log(`✅ Reached ${target.label} (Est: ${projectedSOC.toFixed(1)}%)`);
            const driveTime = Math.round((distToTarget / legSpeed) * 60);
            accumulatedTimeMin += driveTime;
            const arrivalDate = new Date(tripStartTime.getTime() + (accumulatedTimeMin * 60000));

            let finalTargetSOC = Math.round(projectedSOC);
            let finalChargeTime = 0;
            
            // 🟢 DESTINATION CHARGING CHECK
            const canChargeHere = target.type === 'DESTINATION' ? isDestinationChargerAvailable : target.canCharge;

            if (canChargeHere) {
                const limit = target.type === 'DESTINATION' ? 70 : (parseFloat(maxCharge) || 80);
                if (projectedSOC < limit) {
                    finalTargetSOC = limit;
                    finalChargeTime = calculateChargeTime(projectedSOC, limit, carConfig.capacity, 7.2, carConfig.maxChargeRate);
                }
            }
            
            // Add charge time to total duration (Destination charge is usually excluded from "Travel Time" but included in "Total Trip")
            if (target.type !== 'DESTINATION') accumulatedTimeMin += finalChargeTime;
            
            fullItinerary.push({
                type: target.type, 
                station: { 
                    id: target.place_id || `wp_${currentTargetIndex}`, name: target.name || target.label, 
                    lat: target.lat, lng: target.lng, address: target.address || target.label, 
                    powerkw: canChargeHere ? 7.2 : 0, 
                    connectorTypes: canChargeHere ? ['Type 2'] : [], 
                    source: 'user' 
                },
                legDistance: distToTarget, distanceFromLast: distToTarget, 
                arrivalSOC: Math.round(projectedSOC), 
                targetSOC: finalTargetSOC, 
                driveTime: driveTime, 
                chargeTime: finalChargeTime, 
                arrivalTime: arrivalDate.toISOString(), 
                isNightStop: isNight
            });

            currentLoc = { lat: target.lat, lng: target.lng };
            currentSOC = finalTargetSOC; 
            totalDistanceTraveled += distToTarget;
            currentTargetIndex++;
            isAtExactNode = true;
            continue; 
        }

        // 3. FIND CHARGER (Tiered Search Logic)
        const usableRangeKm = ((currentSOC - safetyBuffer) * carConfig.capacity / 100) / carConfig.efficiency;
        const currentPolyIndex = findClosestPolylineIndex(routePoints, currentLoc.lat, currentLoc.lng);
        const offsetKm = Math.max(usableRangeKm * 0.85, 10); 
        const idealPoint = getPointAhead(routePoints, currentPolyIndex, offsetKm);
        const idealPolyIndex = findClosestPolylineIndex(routePoints, idealPoint.latitude, idealPoint.longitude);

        console.log(`   🔎 Scanning at ${offsetKm.toFixed(0)}km ahead...`);

        let candidates = { stations: [] };
        let isFallbackMode = false;
        let isDeepScanMode = false;

        // 🟢 TIERED SEARCH LOOP (5km -> 10km -> 20km -> 50km)
        // We expand the search outward from the Ideal Point until we find something.
        const searchTiers = [5000, 10000, 20000, 50000];
        let foundInTier = false;

        for (const radius of searchTiers) {
            candidates = await db.adaptiveSearch(
                idealPoint.latitude, idealPoint.longitude, 
                Array.from(visitedStationIds), 'FAST', radius
            );
            
            if (candidates.stations && candidates.stations.length > 0) {
                foundInTier = true;
                break; // Found something!
            } else {
                console.log(`   ❌ Failed: ${radius/1000}km Search`);
            }
        }

        // 3b. Fallback: Fast -> Slow (if tiered FAST search failed)
        if (!foundInTier && isFastStrat) {
            console.log(`   🔄 Retrying: Standard 50km Search (SLOW/ALL)...`);
            candidates = await db.adaptiveSearch(idealPoint.latitude, idealPoint.longitude, Array.from(visitedStationIds), 'SLOW', 50000);
            if (candidates.stations.length > 0) isFallbackMode = true; 
        }

        // 3c. Deep Scan: 100km (Rescue / Backward)
        if (!candidates.stations || candidates.stations.length === 0) {
            console.log(`   ❌ Failed: Standard 50km Search (SLOW). Attempting 100km DEEP SCAN...`);
            candidates = await db.adaptiveSearch(idealPoint.latitude, idealPoint.longitude, Array.from(visitedStationIds), 'SLOW', 100000);
            if (candidates.stations.length > 0) isDeepScanMode = true; 
        }

        if (!candidates.stations || candidates.stations.length === 0) { 
            console.warn("   ❌ CRITICAL: No chargers found even after 100km Deep Scan."); 
            break; 
        }

        // 4. FILTERING
        const searchSegmentStart = currentPolyIndex;
        const searchSegmentEnd = Math.min(routePoints.length - 1, idealPolyIndex + 50); 

        let validCandidates = candidates.stations.filter(stat => {
            let bestDistToLine = Infinity;
            let bestCrossTrack = 0;
            let matchedIndex = 0;

            for (let i = searchSegmentStart; i < searchSegmentEnd - 1; i += 2) {
                const p1 = routePoints[i];
                const p2 = routePoints[i+1];
                const distToSegmentStart = getDistanceKm(p1.latitude, p1.longitude, stat.lat, stat.lng);
                
                if (distToSegmentStart < 5.0) {
                    const crossTrack = getCrossTrackDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude, stat.lat, stat.lng);
                    if (Math.abs(crossTrack) < bestDistToLine) {
                        bestDistToLine = Math.abs(crossTrack);
                        bestCrossTrack = crossTrack; 
                        matchedIndex = i;
                    }
                }
            }

            if (bestDistToLine > 3.0) return false; 
            if (bestCrossTrack < -0.05 && !isDeepScanMode) return false; 
            if (matchedIndex < currentPolyIndex && !isDeepScanMode) return false; 

            stat.distFromLine = bestDistToLine;
            stat.isOnLeftSide = bestCrossTrack >= 0;
            return true;
        });

        if (validCandidates.length === 0) {
            console.warn("   🚨 Strict Filter Empty. Relaxing Side-of-Road rules.");
            validCandidates = candidates.stations;
            isDeepScanMode = true; 
        }

        candidates.stations.forEach(stat => {
            const dist = getDistanceKm(currentLoc.lat, currentLoc.lng, stat.lat, stat.lng);
            const drop = (dist * carConfig.efficiency / carConfig.capacity) * 100;
            stat.arrivalSOC = Math.max(0, Math.round(currentSOC - drop));
            stat.distanceFromLast = dist; 
            if (!allScannedStations.has(stat.id)) allScannedStations.set(stat.id, stat);
        });

        // 5. Score
        let bestStation = null;
        let bestScore = -Infinity;

        for (const s of validCandidates) {
            if (isNight && (s.badge === 'BRONZE' || !s.badge)) continue;
            let score = calculateGreenScore(s); 
            if (isFastStrat) score += (parseFloat(s.powerkw || 0) * 2.0); 
            score -= (s.distFromLine || 0) * 500; 
            if (!isFallbackMode && !isDeepScanMode) {
                if ((parseFloat(s.powerkw) || 0) < 15) score -= 10000; 
            }
            if (s.arrivalSOC < safetyBuffer) score -= 1000;
            if (score > bestScore) { bestScore = score; bestStation = s; }
        }

        const acceptanceThreshold = (isFallbackMode || isDeepScanMode) ? -20000 : -9000;

        if (bestStation && bestScore > acceptanceThreshold) { 
            visitedStationIds.add(bestStation.id);
            const driveTime = Math.round((bestStation.distanceFromLast / legSpeed) * 60);
            accumulatedTimeMin += driveTime;
            
            let targetChargeSOC = parseFloat(maxCharge) || 80;
            if (currentTargetIndex === targetQueue.length - 1) { 
                const distToFinal = getDistanceKm(bestStation.lat, bestStation.lng, target.lat, target.lng) * 1.15;
                const percentNeeded = (distToFinal * carConfig.efficiency / carConfig.capacity) * 100;
                targetChargeSOC = Math.min(100, Math.max(targetChargeSOC, percentNeeded + target.reqBuffer + 5));
            }

            const chargeTime = calculateChargeTime(bestStation.arrivalSOC, targetChargeSOC, carConfig.capacity, parseFloat(bestStation.powerkw), carConfig.maxChargeRate);
            accumulatedTimeMin += chargeTime;

            fullItinerary.push({
                type: 'CHARGER', station: bestStation, legDistance: bestStation.distanceFromLast, distanceFromLast: bestStation.distanceFromLast, 
                arrivalSOC: bestStation.arrivalSOC, targetSOC: Math.round(targetChargeSOC), driveTime, chargeTime, 
                arrivalTime: new Date(tripStartTime.getTime() + (accumulatedTimeMin * 60000)).toISOString(), isNightStop: isNight 
            });

            currentLoc = { lat: bestStation.lat, lng: bestStation.lng };
            currentSOC = targetChargeSOC;
            totalDistanceTraveled += bestStation.distanceFromLast;
            isAtExactNode = false; 
        } else {
            console.warn(`⚠️ No station found. Best Score: ${bestScore}`);
            break;
        }
    }

    console.log(`✅ [Router] Complete. Total Stops: ${fullItinerary.length}.`);
    return { plannedStops: fullItinerary, allCandidates: Array.from(allScannedStations.values()), summary: { totalDistanceKm: totalDistanceTraveled, totalDurationMin: accumulatedTimeMin, finalSOC: currentSOC } };
}

module.exports = { planRoute };