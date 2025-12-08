async function verifyStation({ 
  stationId, 
  userId, 
  carModel, 
  workingStatus, 
  comment, 
  rating, 
  db 
}) {
  if (!stationId || !userId) {
    throw new Error('stationId and userId required');
  }

  const station = await db.getStationById(stationId);
  if (!station) {
    throw new Error(`Station ${stationId} not found`);
  }

  await db.verifyStation(stationId);

  // ✅ INSERT QUERY (in verifyStation)
  const insertQuery = `
    INSERT INTO verification_history 
    (stationid, userid, carmodel, workingstatus, comment, rating) 
    VALUES ($1::varchar, $2, $3, $4, $5, $6)
  `;
  
  await db.pool.query(insertQuery, [stationId, userId, carModel, workingStatus, comment || null, rating]);

  const details = await getVerificationDetails(stationId, db);
  
  let badge = { type: 'NONE', text: '' };
  if (details.successRate >= 90) {
    badge = { type: 'TRUSTED', text: '✅ Highly Trusted', color: '#22c55e' };
  } else if (details.successRate >= 70) {
    badge = { type: 'RELIABLE', text: '👍 Reliable', color: '#3b82f6' };
  } else if (details.successRate < 50) {
    badge = { type: 'CAUTION', text: '⚠️ Check Reviews', color: '#f59e0b' };
  }

  console.log(`[Verification] Recorded for ${station.name}`);
  return {
    stationId,
    verified: true,
    message: `Thank you! You've helped ${details.totalVerifications} others.`,
    badge,
    stats: {
      totalVerifications: details.totalVerifications,
      workingCount: details.workingCount,
      successRate: `${details.successRate.toFixed(1)}%`,
      averageRating: details.averageRating.toFixed(1),
    }
  };
}

async function getVerificationDetails(stationId, db) {
  // ✅ SELECT QUERY (in getVerificationDetails)
  const query = `
    SELECT 
      COUNT(*) as total_verifications,
      SUM(CASE WHEN workingstatus = true THEN 1 ELSE 0 END) as working_count,
      AVG(CASE WHEN workingstatus = true THEN 1 ELSE 0 END) * 100 as success_rate,
      AVG(rating) as average_rating
    FROM verification_history
    WHERE stationid = $1::varchar
  `;

  const result = await db.pool.query(query, [stationId]);
  const row = result.rows[0] || { 
    total_verifications: 0, 
    working_count: 0, 
    success_rate: 0, 
    average_rating: 0 
  };

  return {
    totalVerifications: parseInt(row.total_verifications) || 0,
    workingCount: parseInt(row.working_count) || 0,
    notWorkingCount: (parseInt(row.total_verifications) || 0) - (parseInt(row.working_count) || 0),
    successRate: parseFloat(row.success_rate) || 0,
    averageRating: parseFloat(row.average_rating) || 0,
  };
}

module.exports = {
  verifyStation,
  getVerificationDetails,
};
