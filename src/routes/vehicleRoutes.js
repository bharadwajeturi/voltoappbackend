/**
 * VOLTPATH VEHICLE ROUTES
 * Handles requests for the EV Catalog
 */

const express = require('express');
const router = express.Router();

// Import the data file we created earlier
const vehicles = require('../data/evCatalog'); 

// GET /api/vehicles
// Returns the full list of supported EVs
router.get('/', (req, res) => {
    try {
        // Sort the list alphabetically: First by Brand, then by Model
        // This makes the dropdown much easier to read
        const sortedVehicles = [...vehicles].sort((a, b) => {
            if (a.brand === b.brand) {
                return a.model.localeCompare(b.model);
            }
            return a.brand.localeCompare(b.brand);
        });

        res.json(sortedVehicles);
    } catch (error) {
        console.error("❌ Error fetching vehicle list:", error);
        res.status(500).json({ error: "Internal Server Error fetching vehicles" });
    }
});

module.exports = router;