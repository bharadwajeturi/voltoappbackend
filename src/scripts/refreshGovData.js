/**
 * scripts/refreshGovData.js
 * Run this manually or via Cron to update the static JSON file
 * Usage: node scripts/refreshGovData.js
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TARGET_FILE = path.join(__dirname, '../../data/govt_ev_stations.json');
const GOV_API_URL = 'https://e-amrit.niti.gov.in/getChargingStation';

async function refreshData() {
  console.log('🔄 Starting Government Data Refresh...');

  try {
    // 1. Fetch with Browser Headers (mimics a real user to avoid blocks)
    const response = await axios.get(GOV_API_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://e-amrit.niti.gov.in/charging-station-locators'
      },
      timeout: 30000 // Allow 30s for slow government servers
    });

    const newData = response.data;

    // 2. Validate Data (Don't overwrite if empty/error)
    if (!Array.isArray(newData) || newData.length < 50) {
      throw new Error(`Invalid data received. Expected array > 50 items, got ${Array.isArray(newData) ? newData.length : 'invalid type'}`);
    }

    // 3. Process & Clean Data (Optional: Fix typos before saving)
    const cleanData = newData.map(s => ({
      ...s,
      // Fix common typo in Gov API
      latitude: s.lattitude || s.latitude, 
      // Ensure power exists
      powerkw: s.power || s.powerKW || 15 
    }));

    // 4. Save to File
    fs.writeFileSync(TARGET_FILE, JSON.stringify(cleanData, null, 2));
    
    console.log(`✅ SUCCESS: Updated local DB with ${cleanData.length} stations.`);
    console.log(`📁 File saved to: ${TARGET_FILE}`);

  } catch (error) {
    console.error('❌ UPDATE FAILED:', error.message);
    console.log('⚠️ Keeping existing data. No changes made.');
  }
}

refreshData();