/**
 * Route Cache Service
 * - Saves planned routes for offline access
 * - Allows users to save routes and access later
 * - Tracks route history
 */

const crypto = require('crypto');

async function saveRoute({ 
  userId, 
  routeData, 
  startLat, 
  startLng, 
  endLat, 
  endLng, 
  carModel, 
  startSOC, 
  targetArrivalSOC, 
  db 
}) {
  
  if (!routeData) {
    throw new Error('routeData required');
  }

  const routeId = crypto.randomBytes(16).toString('hex');
  const expiryTime = new Date();
  expiryTime.setDate(expiryTime.getDate() + 30);

  const query = `
    INSERT INTO route_cache 
    (id, userid, routejson, startlat, startlng, endlat, endlng, carmodel, startsoc, targetarrivalsoc, expirytime, offline)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;

  const result = await db.pool.query(query, [
    routeId,
    userId,
    JSON.stringify(routeData),
    startLat,
    startLng,
    endLat,
    endLng,
    carModel,
    startSOC,
    targetArrivalSOC,
    expiryTime,
    true
  ]);

  console.log(`[RouteCache] Saved route ${routeId} for user ${userId}`);

  return {
    routeId,
    message: `Route saved for offline access (expires in 30 days)`,
    saved: true,
    expiresAt: expiryTime.toISOString(),
  };
}

async function getUserRoutes(userId, db) {
  const query = `
    SELECT 
      id,
      routejson,
      startlat,
      startlng,
      endlat,
      endlng,
      carmodel,
      startsoc,
      targetarrivalsoc,
      createdtime,
      expirytime,
      (expirytime > NOW()) as still_valid
    FROM route_cache
    WHERE userid = $1
    ORDER BY createdtime DESC
  `;

  const result = await db.pool.query(query, [userId]);
  const routes = result.rows.map(row => ({
    routeId: row.id,
    createdAt: row.createdtime,
    expiresAt: row.expirytime,
    stillValid: row.still_valid,
    route: JSON.parse(row.routejson),
  }));

  console.log(`[RouteCache] Found ${routes.length} routes for user ${userId}`);

  return {
    userId,
    routeCount: routes.length,
    routes,
  };
}

async function getRoute(routeId, db) {
  const query = `
    SELECT routejson, userid, createdtime
    FROM route_cache
    WHERE id = $1
  `;

  const result = await db.pool.query(query, [routeId]);
  if (result.rows.length === 0) {
    throw new Error(`Route ${routeId} not found`);
  }

  const row = result.rows;
  return {
    routeId,
    userId: row.userid,
    createdAt: row.createdtime,
    route: JSON.parse(row.routejson),
  };
}

async function deleteRoute(routeId, userId, db) {
  const query = `
    DELETE FROM route_cache
    WHERE id = $1 AND userid = $2
  `;

  const result = await db.pool.query(query, [routeId, userId]);

  if (result.rowCount === 0) {
    throw new Error('Route not found or unauthorized');
  }

  console.log(`[RouteCache] Deleted route ${routeId}`);

  return {
    message: `Route deleted successfully`,
  };
}

module.exports = {
  saveRoute,
  getUserRoutes,
  getRoute,
  deleteRoute,
};
