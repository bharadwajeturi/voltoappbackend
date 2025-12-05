/**
 * VOLTPATH DATA PIPELINE CONTROLLER
 * Orchestrates: Fetching -> Merging -> Proximity Linking -> Database Saving
 */

const fetchGoogle = require('./src/fetchers/googleFetcher');
const fetchOCM = require('./src/fetchers/osmFetcher');
const fetchGov = require('./src/fetchers/govFetcher');
const fetchAmenities = require('./src/fetchers/amenityFetcher'); 
const fetchOSM = require('./src/fetchers/osmFetcher');

const mergeData = require('./src/merger/engine');
const db = require('./src/database/dbmanager');
const { linkAmenitiesToStations } = require('./src/utils/proximity');

async function startPipeline() {
    console.log("🚀 Starting VoltPath Data Pipeline...");
    console.log("-----------------------------------");

    try {
        // 1. Initialize Database
        await db.connectDB();
        await db.setupTables(); // Creates stations_master and amenities_master

        // 2. Fetch Data from All Sources in Parallel
        console.log("   ⚡ Triggering all fetchers...");
        const [googleData, ocmData, govData, googleAmenities, osmAmenities] = await Promise.all([
            fetchGoogle(),      // Google Chargers
            fetchOCM(),         // Open Charge Map
            fetchGov(),         // Local Gov JSON or API
            fetchAmenities(),   // Google Hotels (stations) & Restaurants (amenities)
            fetchOSM()          // OpenStreetMap Hotels & Restaurants
        ]);

        // Destructure Google Amenities result (it returns { stations, amenities })
        const { stations: hotelStations, amenities: googleRestList } = googleAmenities;

        console.log("-----------------------------------");
        console.log(`   📊 DATA FETCH REPORT:`);
        console.log(`      [Chargers] Google: ${googleData.length} | OCM: ${ocmData.length} | Gov: ${govData.length}`);
        console.log(`      [Hotels w/ EV] Google: ${hotelStations.length}`);
        console.log(`      [Amenities] Google: ${googleRestList.length} | OSM: ${osmAmenities.length}`);
        console.log("-----------------------------------");

        // 3. Merge Station Data (De-duplication)
        // We combine all sources that act as "Charging Stations"
        const goldenRecords = mergeData(googleData, ocmData, govData, hotelStations);
        console.log(`   ✨ Merged into ${goldenRecords.length} unique Golden Records (Stations).`);

        // 4. Proximity Logic: Link Amenities to Stations
        // We link OSM amenities to stations if they are within 500m
        // (You can swap 'osmAmenities' with 'googleRestList' if you prefer Google data)
        const enrichedStations = linkAmenitiesToStations(goldenRecords, osmAmenities);

        // 5. Save to Database
        if (enrichedStations.length > 0) {
            // Save stations (now containing the 'nearby_amenities' array)
            await db.saveStations(enrichedStations);
        }
        
        // Optionally save raw amenity lists for standalone "Near Me" searches
        if (osmAmenities.length > 0) {
            await db.saveAmenities(osmAmenities);
        }

    } catch (error) {
        console.error("🔥 Pipeline Failed:", error);
    } finally {
        await db.closeDB();
        console.log("-----------------------------------");
        console.log("🏁 Pipeline Finished.");
    }
}

startPipeline();