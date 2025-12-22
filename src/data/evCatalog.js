/**
 * src/data/evCatalog.js
 * Comprehensive Database of Indian EVs (2024-2025)
 * Values are conservative real-world estimates for safe routing.
 */

const vehicles = [
    // --- TATA MOTORS ---
    {
        id: 'tata_tiago_ev_mr',
        brand: 'Tata',
        model: 'Tiago EV (Medium Range)',
        batteryKwh: 19.2,
        realRange: 150, 
        maxChargeKw: 20
    },
    {
        id: 'tata_tiago_ev_lr',
        brand: 'Tata',
        model: 'Tiago EV (Long Range)',
        batteryKwh: 24,
        realRange: 190, 
        maxChargeKw: 25
    },
    {
        id: 'tata_tigor_ev',
        brand: 'Tata',
        model: 'Tigor EV',
        batteryKwh: 26,
        realRange: 210, 
        maxChargeKw: 25
    },
    {
        id: 'tata_punch_ev_std',
        brand: 'Tata',
        model: 'Punch EV (Standard)',
        batteryKwh: 25,
        realRange: 200, 
        maxChargeKw: 25
    },
    {
        id: 'tata_punch_ev_lr',
        brand: 'Tata',
        model: 'Punch EV (Long Range)',
        batteryKwh: 35,
        realRange: 290, 
        maxChargeKw: 50
    },
    {
        id: 'tata_nexon_ev_prime',
        brand: 'Tata',
        model: 'Nexon EV Prime',
        batteryKwh: 30.2,
        realRange: 220, 
        maxChargeKw: 25
    },
    {
        id: 'tata_nexon_ev_max',
        brand: 'Tata',
        model: 'Nexon EV Max / LR',
        batteryKwh: 40.5,
        realRange: 290, 
        maxChargeKw: 30
    },
    {
        id: 'tata_curvv_ev_45',
        brand: 'Tata',
        model: 'Curvv EV (45 kWh)',
        batteryKwh: 45,
        realRange: 330, 
        maxChargeKw: 60
    },
    {
        id: 'tata_curvv_ev_55',
        brand: 'Tata',
        model: 'Curvv EV (55 kWh)',
        batteryKwh: 55,
        realRange: 400, 
        maxChargeKw: 70
    },

    // --- MG MOTORS ---
    {
        id: 'mg_comet_ev',
        brand: 'MG',
        model: 'Comet EV',
        batteryKwh: 17.3,
        realRange: 160, 
        maxChargeKw: 20 // Effectively slow charging mostly
    },
    {
        id: 'mg_windsor_ev_38',
        brand: 'MG',
        model: 'Windsor EV (38 kWh)',
        batteryKwh: 38,
        realRange: 250, 
        maxChargeKw: 45
    },
    {
        id: 'mg_windsor_ev_50',
        brand: 'MG',
        model: 'Windsor EV (50 kWh)',
        batteryKwh: 50.6,
        realRange: 330, 
        maxChargeKw: 50
    },
    {
        id: 'mg_zs_ev_excite',
        brand: 'MG',
        model: 'ZS EV (Excite/Exclusive)',
        batteryKwh: 50.3,
        realRange: 340, 
        maxChargeKw: 75
    },

    // --- MAHINDRA ---
    {
        id: 'mahindra_xuv400_ec',
        brand: 'Mahindra',
        model: 'XUV400 EC (34.5 kWh)',
        batteryKwh: 34.5,
        realRange: 250, 
        maxChargeKw: 50
    },
    {
        id: 'mahindra_xuv400_el',
        brand: 'Mahindra',
        model: 'XUV400 EL (39.4 kWh)',
        batteryKwh: 39.4,
        realRange: 280, 
        maxChargeKw: 50
    },

    // --- CITROEN ---
    {
        id: 'citroen_ec3',
        brand: 'Citroen',
        model: 'eC3',
        batteryKwh: 29.2,
        realRange: 220, 
        maxChargeKw: 30
    },

    // --- HYUNDAI / KIA ---
    {
        id: 'hyundai_kona',
        brand: 'Hyundai',
        model: 'Kona Electric',
        batteryKwh: 39.2,
        realRange: 300, 
        maxChargeKw: 50
    },
    {
        id: 'hyundai_ioniq5',
        brand: 'Hyundai',
        model: 'Ioniq 5',
        batteryKwh: 72.6,
        realRange: 430, 
        maxChargeKw: 220 // 800V Support
    },
    {
        id: 'kia_ev6',
        brand: 'Kia',
        model: 'EV6',
        batteryKwh: 77.4,
        realRange: 450, 
        maxChargeKw: 230
    },
    {
        id: 'kia_ev9',
        brand: 'Kia',
        model: 'EV9',
        batteryKwh: 99.8,
        realRange: 480, 
        maxChargeKw: 230
    },

    // --- BYD ---
    {
        id: 'byd_atto3_std',
        brand: 'BYD',
        model: 'Atto 3 (Standard)',
        batteryKwh: 49.9,
        realRange: 320, 
        maxChargeKw: 70
    },
    {
        id: 'byd_atto3_ext',
        brand: 'BYD',
        model: 'Atto 3 (Extended)',
        batteryKwh: 60.5,
        realRange: 400, 
        maxChargeKw: 80
    },
    {
        id: 'byd_emax_7_prem',
        brand: 'BYD',
        model: 'eMAX 7 (Premium)',
        batteryKwh: 55.4,
        realRange: 350, 
        maxChargeKw: 89
    },
    {
        id: 'byd_emax_7_sup',
        brand: 'BYD',
        model: 'eMAX 7 (Superior)',
        batteryKwh: 71.8,
        realRange: 450, 
        maxChargeKw: 115
    },
    {
        id: 'byd_seal_dyn',
        brand: 'BYD',
        model: 'Seal (Dynamic)',
        batteryKwh: 61.4,
        realRange: 400, 
        maxChargeKw: 110
    },
    {
        id: 'byd_seal_perf',
        brand: 'BYD',
        model: 'Seal (Premium/Performance)',
        batteryKwh: 82.6,
        realRange: 500, 
        maxChargeKw: 150
    },

    // --- LUXURY (BMW, VOLVO, MERCEDES, AUDI) ---
    {
        id: 'volvo_xc40_recharge',
        brand: 'Volvo',
        model: 'XC40 / EX40 Recharge',
        batteryKwh: 78,
        realRange: 380, 
        maxChargeKw: 150
    },
    {
        id: 'volvo_c40_recharge',
        brand: 'Volvo',
        model: 'C40 / EC40 Recharge',
        batteryKwh: 78,
        realRange: 400, 
        maxChargeKw: 150
    },
    {
        id: 'bmw_ix1',
        brand: 'BMW',
        model: 'iX1',
        batteryKwh: 66.4,
        realRange: 370, 
        maxChargeKw: 130
    },
    {
        id: 'bmw_i4_edrive40',
        brand: 'BMW',
        model: 'i4 eDrive40',
        batteryKwh: 83.9,
        realRange: 480, 
        maxChargeKw: 205
    },
    {
        id: 'bmw_ix_xdrive40',
        brand: 'BMW',
        model: 'iX xDrive40',
        batteryKwh: 76.6,
        realRange: 350, 
        maxChargeKw: 150
    },
    {
        id: 'mercedes_eqe_suv',
        brand: 'Mercedes',
        model: 'EQE SUV',
        batteryKwh: 90.6,
        realRange: 420, 
        maxChargeKw: 170
    },
    {
        id: 'mercedes_eqs_580',
        brand: 'Mercedes',
        model: 'EQS 580',
        batteryKwh: 107.8,
        realRange: 600, 
        maxChargeKw: 200
    },
    {
        id: 'audi_q8_etron_50',
        brand: 'Audi',
        model: 'Q8 e-tron 50',
        batteryKwh: 95,
        realRange: 380, 
        maxChargeKw: 150
    },
    {
        id: 'audi_q8_etron_55',
        brand: 'Audi',
        model: 'Q8 e-tron 55',
        batteryKwh: 114,
        realRange: 450, 
        maxChargeKw: 170
    },
    {
        id: 'mini_cooper_se',
        brand: 'Mini',
        model: 'Cooper SE',
        batteryKwh: 32.6,
        realRange: 180, 
        maxChargeKw: 50
    },
    {
        id: 'lotus_eletre',
        brand: 'Lotus',
        model: 'Eletre',
        batteryKwh: 112,
        realRange: 480, 
        maxChargeKw: 350
    }
];

module.exports = vehicles;