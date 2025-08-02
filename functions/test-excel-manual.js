const fs = require('fs');
const xlsx = require('xlsx');

// Read and process the Excel file to understand its structure
function processExcelFile(filePath) {
  console.log('📊 Reading Excel file:', filePath);
  
  try {
    // Read the Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    console.log('📄 Sheet names:', workbook.SheetNames);
    console.log('📄 Processing sheet:', sheetName);
    
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON with headers
    const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log('📊 Total rows:', jsonData.length);
    console.log('📊 Headers:', jsonData[0]);
    
    // Show first few data rows
    console.log('\n📋 Sample data rows:');
    for (let i = 1; i <= Math.min(5, jsonData.length - 1); i++) {
      console.log(`Row ${i}:`, jsonData[i]);
    }
    
    // Process commission calculations
    console.log('\n💰 Commission Calculations:');
    let totalLiveManagerCommission = 0;
    let totalTeamManagerCommission = 0;
    let totalGross = 0;
    let processedRows = 0;
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      
      // Assuming structure: Creator Name, Gross, Net, Period, Live Mgr, Live Mgr Name, Team Mgr, Team Mgr Name
      const [creatorName, gross, net, period, liveMgrId, liveMgrName, teamMgrId, teamMgrName] = row;
      
      if (!creatorName || gross === undefined) continue;
      
      const grossAmount = parseFloat(gross) || 0;
      if (grossAmount <= 0) continue;
      
      // Calculate commissions
      const liveMgrCommission = grossAmount * 0.05; // 5%
      const teamMgrCommission = grossAmount * 0.03; // 3%
      
      totalGross += grossAmount;
      totalLiveManagerCommission += liveMgrCommission;
      totalTeamManagerCommission += teamMgrCommission;
      processedRows++;
      
      if (i <= 10) { // Show first 10 calculations
        console.log(`${creatorName}: Gross: ${grossAmount} → Live Mgr: ${liveMgrCommission.toFixed(2)} | Team Mgr: ${teamMgrCommission.toFixed(2)}`);
      }
    }
    
    console.log('\n📈 SUMMARY:');
    console.log(`Processed Rows: ${processedRows}`);
    console.log(`Total Gross: ${totalGross.toFixed(2)}`);
    console.log(`Total Live Manager Commission (5%): ${totalLiveManagerCommission.toFixed(2)}`);
    console.log(`Total Team Manager Commission (3%): ${totalTeamManagerCommission.toFixed(2)}`);
    console.log(`Total Commissions: ${(totalLiveManagerCommission + totalTeamManagerCommission).toFixed(2)}`);
    
    return {
      processedRows,
      totalGross,
      totalLiveManagerCommission,
      totalTeamManagerCommission,
      sampleData: jsonData.slice(0, 6) // Headers + 5 sample rows
    };
    
  } catch (error) {
    console.error('❌ Error processing Excel file:', error);
    throw error;
  }
}

// Test the Excel file processing
const excelFile = '../Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx';

if (fs.existsSync(excelFile)) {
  const result = processExcelFile(excelFile);
  console.log('\n✅ Excel processing completed successfully!');
} else {
  console.error('❌ Excel file not found:', excelFile);
  console.log('📁 Current directory contents:');
  console.log(fs.readdirSync('.').filter(f => f.includes('xlsx')));
} 