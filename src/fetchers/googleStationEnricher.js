/**
 * Google Station Enricher (Premium)
 * Fetches Technical Specs (Connectors, Power) for a specific station.
 * Cost: High (Place Details SKU) - Use ONLY for selected route stops.
 */
const axios = require('axios');
const config = require('../config/configuration');

async function fetchStationSpecs(placeId) {
    if (!placeId) return null;

    try {
        const apiKey = config.keys.google;
        // 🟢 Field Mask: Only ask for EV options (Cost optimization)
        const fields = 'evChargeOptions,summary'; 
        
        const url = `https://places.googleapis.com/v1/places/${placeId}?fields=${fields}&key=${apiKey}`;

        const response = await axios.get(url);
        const data = response.data;

        if (!data.evChargeOptions) return null;

        // Map Google Format to VoltPath Format
        const connectors = (data.evChargeOptions.connectorAggregation || []).map(c => c.type);
        
        // Find Max Power
        const maxPower = (data.evChargeOptions.connectorAggregation || []).reduce((max, c) => {
            return Math.max(max, parseFloat(c.maxChargeRateKw) || 0);
        }, 0);

        return {
            connectors: connectors.length > 0 ? connectors : ['CCS2', 'Type 2'], // Fallback if empty but present
            powerkw: maxPower > 0 ? maxPower : 25, // Default to 25 if Google says "EV" but hides power
            summary: data.summary?.text
        };

    } catch (error) {
        console.error(`[Station Enricher] Failed for ${placeId}: ${error.message}`);
        return null;
    }
}

module.exports = { fetchStationSpecs };