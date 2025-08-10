#!/usr/bin/env node

/**
 * 🧮 ENGINE v2 EXCEL TEST CALCULATION
 * Tests the new commission logic with real Excel data
 */

const xlsx = require('xlsx');
const fs = require('fs');

console.log('🧮 ENGINE v2 EXCEL TEST CALCULATION');
console.log('===================================');

// Engine v2 Constants (in cents)
const MILESTONE_DEDUCTIONS = {
  S: 150_00,    // Half-Milestone: 150.00 EUR
  N: 300_00,    // Milestone 1: 300.00 EUR  
  O: 1_000_00,  // Milestone 2: 1000.00 EUR
  P: 240_00,    // Retention: 240.00 EUR
};

const MILESTONE_PAYOUTS = {
  live: {
    S: 75_00,   // Half-Milestone: 75.00 EUR
    N: 150_00,  // Milestone 1: 150.00 EUR
    O: 400_00,  // Milestone 2: 400.00 EUR  
    P: 100_00,  // Retention: 100.00 EUR
  },
  team: {
    S: 80_00,   // Half-Milestone: 80.00 EUR
    N: 165_00,  // Milestone 1: 165.00 EUR
    O: 450_00,  // Milestone 2: 450.00 EUR
    P: 120_00,  // Retention: 120.00 EUR
  },
};

const GRADUATION_BONUS = { live: 50_00, team: 60_00 };
const DIAMOND_BONUS = { live: 50_00, team: 60_00 };
const BASE_RATES = { live: 0.30, team: 0.35 };

const centsToEuros = (cents) => cents / 100;
const eurosToCents = (euros) => Math.round(euros * 100);

function calculateCommission(grossAmount, hasS, hasN, hasO, hasP, role) {
  // Calculate deductions
  const deductionsCents = [];
  if (hasN) deductionsCents.push(MILESTONE_DEDUCTIONS.N);
  if (hasO) deductionsCents.push(MILESTONE_DEDUCTIONS.O);
  if (hasP) deductionsCents.push(MILESTONE_DEDUCTIONS.P);
  if (hasS) deductionsCents.push(MILESTONE_DEDUCTIONS.S);
  
  const bonusSumCents = deductionsCents.reduce((sum, val) => sum + val, 0);
  const grossCents = eurosToCents(grossAmount);
  const netCents = grossCents - bonusSumCents;
  
  // Base commission
  const baseCommissionCents = Math.max(0, Math.round(netCents * BASE_RATES[role]));
  
  // Milestone bonuses
  const milestoneBonuses = {
    S: hasS ? MILESTONE_PAYOUTS[role].S : 0,
    N: hasN ? MILESTONE_PAYOUTS[role].N : 0,
    O: hasO ? MILESTONE_PAYOUTS[role].O : 0,
    P: hasP ? MILESTONE_PAYOUTS[role].P : 0,
  };
  
  // Graduation bonus (if any milestone achieved)
  const hasAnyMilestone = hasS || hasN || hasO || hasP;
  const graduationBonusCents = hasAnyMilestone ? GRADUATION_BONUS[role] : 0;
  
  // Total
  const totalMilestoneCents = Object.values(milestoneBonuses).reduce((sum, val) => sum + val, 0);
  const totalEarningsCents = baseCommissionCents + totalMilestoneCents + graduationBonusCents;
  
  return {
    gross: centsToEuros(grossCents),
    bonusSum: centsToEuros(bonusSumCents),
    net: centsToEuros(netCents),
    baseCommission: centsToEuros(baseCommissionCents),
    milestoneBonuses: {
      S: centsToEuros(milestoneBonuses.S),
      N: centsToEuros(milestoneBonuses.N),
      O: centsToEuros(milestoneBonuses.O),
      P: centsToEuros(milestoneBonuses.P),
    },
    graduationBonus: centsToEuros(graduationBonusCents),
    totalEarnings: centsToEuros(totalEarningsCents)
  };
}

try {
  // Read Excel file - accept CLI arg; else scan local folder
  let excelFile = process.argv[2];
  if (!excelFile) {
    const xlsxFiles = fs.readdirSync('.').filter(f => f.endsWith('.xlsx'));
    console.log(`📁 Available xlsx files: ${xlsxFiles.join(', ')}`);
    if (xlsxFiles.length === 0) {
      console.error(`❌ No xlsx files found in directory`);
      process.exit(1);
    }
    // Prefer new format Task_202507*, then Neu_Task_202506*, otherwise first
    excelFile = xlsxFiles.find(f => f.startsWith('Task_202507'))
            || xlsxFiles.find(f => f.startsWith('Neu_Task_202506'))
            || xlsxFiles[0];
  }
  console.log(`📁 Using Excel file: ${excelFile}`);
  
  if (!fs.existsSync(excelFile)) {
    console.error(`❌ Excel file not accessible: ${excelFile}`);
    process.exit(1);
  }
  
  const workbook = xlsx.readFile(excelFile);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  console.log(`📊 Reading sheet: ${sheetName}`);
  
  // Convert to JSON, starting from row 2 (skip header)
  const jsonData = xlsx.utils.sheet_to_json(worksheet, { 
    header: 1,
    range: 1 // Skip first row (header)
  });

  console.log(`📊 Found ${jsonData.length} rows in Excel file\n`);

  // Process first 3 rows for demonstration
  const sampleRows = jsonData.slice(0, 3);
  
  sampleRows.forEach((row, index) => {
    if (!row || row.length < 19) {
      console.log(`⚠️ Row ${index + 1}: Incomplete data`);
      return;
    }

    console.log(`🧮 CALCULATION ${index + 1}:`);
    console.log('=' .repeat(40));
    
    // Extract data according to specification
    const period = row[0];
    const creatorId = row[1]; 
    const creatorName = row[2];
    const handle = row[3];
    const liveManagerName = row[4];
    const groupName = row[5];
    const teamManagerName = row[6];
    
    // Column M (Index 12) = Gross
    const grossAmount = parseFloat(row[12]) || 0;
    
    // Check milestone columns (NEW ORDER)
    // S: now column N (13), N: now column O (14), O: now column Q (16), P: column P (15)
    const hasS = row[13] === '150' || row[13] === 150;
    const hasN = row[14] === '300' || row[14] === 300;
    const hasO = row[16] === '1000' || row[16] === 1000;
    const hasP = row[15] === '240' || row[15] === 240;
    
    console.log(`Creator: ${creatorName} (${handle})`);
    console.log(`Live Manager: ${liveManagerName}`);
    console.log(`Team Manager: ${teamManagerName}`);
    console.log(`Period: ${period}`);
    console.log(`Gross Amount: €${grossAmount.toFixed(2)}`);
    console.log(`Milestones: S=${hasS ? 'YES' : 'NO'}, N=${hasN ? 'YES' : 'NO'}, O=${hasO ? 'YES' : 'NO'}, P=${hasP ? 'YES' : 'NO'}`);
    
    console.log('\n📊 ENGINE v2 CALCULATIONS:');
    
    // Calculate for both Live and Team managers
    ['live', 'team'].forEach(role => {
      console.log(`\n💼 ${role.toUpperCase()} MANAGER CALCULATION:`);
      
      const result = calculateCommission(grossAmount, hasS, hasN, hasO, hasP, role);
      
      console.log(`Gross: €${result.gross.toFixed(2)}`);
      console.log(`Bonus Sum (Deductions): €${result.bonusSum.toFixed(2)}`);
      console.log(`Net: €${result.net.toFixed(2)}`);
      console.log(`Base Commission (${(BASE_RATES[role]*100)}%): €${result.baseCommission.toFixed(2)}`);
      
      console.log('Milestone Bonuses:');
      console.log(`  S (Half): €${result.milestoneBonuses.S.toFixed(2)}`);
      console.log(`  N (Milestone 1): €${result.milestoneBonuses.N.toFixed(2)}`);
      console.log(`  O (Milestone 2): €${result.milestoneBonuses.O.toFixed(2)}`);
      console.log(`  P (Retention): €${result.milestoneBonuses.P.toFixed(2)}`);
      
      console.log(`Graduation Bonus: €${result.graduationBonus.toFixed(2)}`);
      console.log(`👑 TOTAL EARNINGS: €${result.totalEarnings.toFixed(2)}`);
    });
    
    console.log('\n' + '═'.repeat(50) + '\n');
  });

  // Summary statistics
  console.log('📈 SUMMARY STATISTICS:');
  console.log('=' .repeat(30));
  
  let totalRows = 0;
  let totalGross = 0;
  let milestoneCounts = { S: 0, N: 0, O: 0, P: 0 };
  let managerStats = {};
  
  jsonData.forEach(row => {
    if (row && row.length >= 17) {
      totalRows++;
      const gross = parseFloat(row[12]) || 0;
      totalGross += gross;
      
      // NEW ORDER: Only count specific achievement values
      if (row[13] === '150' || row[13] === 150) milestoneCounts.S++;
      if (row[14] === '300' || row[14] === 300) milestoneCounts.N++;
      if (row[16] === '1000' || row[16] === 1000) milestoneCounts.O++;
      if (row[15] === '240' || row[15] === 240) milestoneCounts.P++;
      
      // Track managers
      const liveManager = row[4];
      const teamManager = row[6];
      
      if (liveManager && liveManager.trim() !== '') {
        if (!managerStats[liveManager]) {
          managerStats[liveManager] = { type: 'LIVE', gross: 0, count: 0 };
        }
        managerStats[liveManager].gross += gross;
        managerStats[liveManager].count++;
      }
      
      if (teamManager && teamManager.trim() !== '') {
        if (!managerStats[teamManager]) {
          managerStats[teamManager] = { type: 'TEAM', gross: 0, count: 0 };
        }
        managerStats[teamManager].gross += gross;
        managerStats[teamManager].count++;
      }
    }
  });
  
  console.log(`Total Valid Rows: ${totalRows}`);
  console.log(`Total Gross Amount: €${totalGross.toFixed(2)}`);
  console.log(`Average Gross per Creator: €${(totalGross / totalRows).toFixed(2)}`);
  console.log(`Milestone Achievements:`);
  console.log(`  S (Half): ${milestoneCounts.S} creators (${((milestoneCounts.S/totalRows)*100).toFixed(1)}%)`);
  console.log(`  N (Milestone 1): ${milestoneCounts.N} creators (${((milestoneCounts.N/totalRows)*100).toFixed(1)}%)`);
  console.log(`  O (Milestone 2): ${milestoneCounts.O} creators (${((milestoneCounts.O/totalRows)*100).toFixed(1)}%)`);
  console.log(`  P (Retention): ${milestoneCounts.P} creators (${((milestoneCounts.P/totalRows)*100).toFixed(1)}%)`);
  
  console.log(`\n👥 MANAGER PERFORMANCE:`);
  Object.entries(managerStats).forEach(([name, stats]) => {
    console.log(`${name} (${stats.type}): ${stats.count} creators, €${stats.gross.toFixed(2)} total gross`);
  });

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    file: excelFile,
    totalRows,
    totalGross,
    milestoneCounts,
    managerStats,
    engine: 'v2',
    constants: {
      MILESTONE_DEDUCTIONS,
      MILESTONE_PAYOUTS,
      GRADUATION_BONUS,
      DIAMOND_BONUS,
      BASE_RATES
    }
  };
  
  fs.writeFileSync('excel-test-results-engine-v2.json', JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to: excel-test-results-engine-v2.json`);

} catch (error) {
  console.error('❌ Error reading Excel file:', error.message);
  console.error('Full error:', error);
} 