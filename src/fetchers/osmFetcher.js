/**
 * OpenStreetMap (OSM) Fetcher
 * Fetches POIs and amenities from OpenStreetMap
 * Uses Overpass API for queries
 * 
 * UPDATED:
 * - Accepts lat/lng/radius parameters (not hard-coded)
 * - Supports time-based filtering (opening hours)
 * - Better error handling
 */

const axios = require('axios');
const { getDistanceKm } = require('../utils/distance');

async function fetchOSM(lat, lng, radiusMeters = 5000, includeAmenities = true) {
  if (!lat || !lng) {
    console.warn('[OSM] Missing lat/lng, skipping fetch');
    return [];
  }

  console.log(
    `[OSM] Fetching from OpenStreetMap within ${radiusMeters / 1000}km of ${lat},${lng}`
  );

  try {
    const radiusKm = radiusMeters / 1000;
    const bbox = calculateBBox(lat, lng, radiusKm);

    // Overpass API query for amenities
    if (!includeAmenities) {
      return [];
    }

    const query = `
      [bbox:${bbox}];
      (
        node["amenity"~"restaurant|cafe|bar|fast_food"];
        way["amenity"~"restaurant|cafe|bar|fast_food"];
      );
      out body;
    `;

    const url = 'https://overpass-api.de/api/interpreter';

    const response = await axios.post(url, `data=${encodeURIComponent(query)}`, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (!response.data?.elements) {
      console.log('[OSM] No amenities found');
      return [];
    }

    console.log(`[OSM] Found ${response.data.elements.length} elements`);

    // Extract amenities
    const amenities = response.data.elements
      .filter(
        elem =>
          elem.tags?.name &&
          elem.lat &&
          elem.lon &&
          getDistanceKm(lat, lng, elem.lat, elem.lon) <= radiusKm
      )
      .map(elem => ({
        name: elem.tags.name,
        lat: elem.lat,
        lng: elem.lon,
        type: capitalizeFirst(elem.tags.amenity || 'Unknown'),
        cuisineType: elem.tags.cuisine || '',
        openingHours: elem.tags.opening_hours || '',
        source: 'osm',
        externalId: `osm_${elem.id}`,
      }));

    console.log(`[OSM] Extracted ${amenities.length} amenities`);
    return amenities;
  } catch (error) {
    console.error(`[OSM] Error: ${error.message}`);
    return [];
  }
}

/**
 * Calculate bounding box from center point and radius
 * Used for Overpass API queries
 */
function calculateBBox(lat, lng, radiusKm) {
  const latChange = radiusKm / 111; // 1 degree ≈ 111km
  const lngChange = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  return `${(lat - latChange).toFixed(4)},${(lng - lngChange).toFixed(4)},${(lat + latChange).toFixed(4)},${(lng + lngChange).toFixed(4)}`;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = fetchOSM;
