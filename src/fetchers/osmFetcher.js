/**
 * OSM Restaurant Fetcher
 * ----------------------
 * Fetches restaurants/cafes/fast_food for a given AREA.
 * This file:
 * - Talks ONLY to OSM
 * - Does NOT touch DB
 * - Does NOT know about stations
 */

const axios = require('axios');

async function fetchRestaurantsForArea(lat, lng, radiusMeters = 2000) {
  if (!lat || !lng) {
    console.warn('[OSM] Missing lat/lng, skipping');
    return [];
  }

  const radiusKm = radiusMeters / 1000;
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

  const bbox = `
    ${lat - latDelta},
    ${lng - lngDelta},
    ${lat + latDelta},
    ${lng + lngDelta}
  `;

  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"restaurant|cafe|fast_food"]( ${bbox} );
      way["amenity"~"restaurant|cafe|fast_food"]( ${bbox} );
    );
    out center tags;
  `;

  try {
    const res = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (!res.data || !Array.isArray(res.data.elements)) {
      return [];
    }

    return res.data.elements
      .map(e => ({
        name: e.tags?.name || 'Unnamed',
        type: e.tags?.amenity || 'restaurant',
        lat: e.lat || e.center?.lat,
        lng: e.lon || e.center?.lon,
        source: 'osm'
      }))
      .filter(r => r.lat && r.lng);

  } catch (err) {
    console.error('[OSM] Fetch error:', err.message);
    return [];
  }
}

module.exports = fetchRestaurantsForArea;
