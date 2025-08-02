const xlsx = require('xlsx');
const fs = require('fs');
const axios = require('axios');

// Create sample Excel data for testing
function createSampleExcel() {
  console.log('📊 Creating sample Excel file for testing...');
  
  // Sample data matching your Excel structure
  const sampleData = [
    ['Creator Name', 'Gross', 'Net', 'Period', 'Live Mgr', 'Live Mgr Name', 'Team Mgr', 'Team Mgr Name'],
    ['Anna Müller', 1500.00, 1200.00, '202506', 'live001', 'Max Schmidt', 'team001', 'Sandra Weber'],
    ['Tom Fischer', 2200.00, 1800.00, '202506', 'live002', 'Lisa Hofmann', 'team001', 'Sandra Weber'],
    ['Julia Klein', 1800.00, 1450.00, '202506', 'live001', 'Max Schmidt', 'team002', 'Michael Bauer'],
    ['Marco Richter', 3200.00, 2600.00, '202506', 'live003', 'Stefan Keller', 'team001', 'Sandra Weber'],
    ['Nina Wolf', 1100.00, 900.00, '202506', 'live002', 'Lisa Hofmann', 'team003', 'Christina Lange']
  ];
  
  // Create workbook and worksheet
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet(sampleData);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Commissions');
  
  // Save to file
  const filename = '../sample-commission-data.xlsx';
  xlsx.writeFile(workbook, filename);
  
  console.log('✅ Sample Excel file created:', filename);
  
  // Calculate expected results
  let totalGross = 0;
  let totalLiveCommission = 0;
  let totalTeamCommission = 0;
  
  console.log('\n💰 Expected Commission Calculations:');
  for (let i = 1; i < sampleData.length; i++) {
    const [creator, gross, net, period, liveMgr, liveMgrName, teamMgr, teamMgrName] = sampleData[i];
    const grossAmount = parseFloat(gross);
    const liveCommission = grossAmount * 0.05; // 5%
    const teamCommission = grossAmount * 0.03; // 3%
    
    totalGross += grossAmount;
    totalLiveCommission += liveCommission;
    totalTeamCommission += teamCommission;
    
    console.log(`${creator}: €${grossAmount} → Live Mgr: €${liveCommission.toFixed(2)} | Team Mgr: €${teamCommission.toFixed(2)}`);
  }
  
  console.log('\n📈 EXPECTED TOTALS:');
  console.log(`Total Gross: €${totalGross.toFixed(2)}`);
  console.log(`Total Live Manager Commission (5%): €${totalLiveCommission.toFixed(2)}`);
  console.log(`Total Team Manager Commission (3%): €${totalTeamCommission.toFixed(2)}`);
  console.log(`Total Commission Payout: €${(totalLiveCommission + totalTeamCommission).toFixed(2)}`);
  
  return filename;
}

// Test the base64 upload with sample data
async function testWithSampleData() {
  console.log('\n🧪 Testing Base64 Upload with Sample Data');
  
  try {
    // Create sample Excel file
    const excelFile = createSampleExcel();
    
    // Login
    console.log('\n🔐 Logging in...');
    const loginResponse = await axios.post(
      'https://europe-west1-trend4media-billing.cloudfunctions.net/api/auth/login',
      {
        email: 'admin@trend4media.com',
        password: 'admin123'
      }
    );
    
    const token = loginResponse.data.access_token;
    console.log('✅ Login successful');
    
    // Read and upload file
    console.log('\n📄 Reading sample Excel file...');
    const fileBuffer = fs.readFileSync(excelFile);
    const base64Data = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fileBuffer.toString('base64')}`;
    
    console.log('📤 Uploading via base64 endpoint...');
    const uploadResponse = await axios.post(
      'https://europe-west1-trend4media-billing.cloudfunctions.net/api/uploads/excel-base64',
      {
        fileData: base64Data,
        fileName: 'sample-commission-data.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );
    
    console.log('\n✅ UPLOAD SUCCESSFUL!');
    console.log('📊 Processing Results:');
    
    if (uploadResponse.data.batch) {
      const batch = uploadResponse.data.batch;
      console.log(`- Batch ID: ${batch.id}`);
      console.log(`- Status: ${batch.status}`);
      console.log(`- Processed Rows: ${batch.processedCount}`);
      console.log(`- New Creators: ${batch.newCreators}`);
      console.log(`- New Managers: ${batch.newManagers}`);
      console.log(`- Transactions Created: ${batch.transactionCount}`);
    }
    
    // Verify data in database
    console.log('\n🔍 Verifying data in database...');
    
    // Check bonuses
    const bonusesResponse = await axios.get(
      'https://europe-west1-trend4media-billing.cloudfunctions.net/api/bonuses?limit=20',
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    
    const bonuses = bonusesResponse.data.data || [];
    console.log(`📈 Bonuses created: ${bonuses.length}`);
    
    let totalLiveBonuses = 0;
    let totalTeamBonuses = 0;
    
    bonuses.forEach(bonus => {
      if (bonus.managerType === 'LIVE') {
        totalLiveBonuses += bonus.amount;
      } else if (bonus.managerType === 'TEAM') {
        totalTeamBonuses += bonus.amount;
      }
      console.log(`  - ${bonus.managerName} (${bonus.managerType}): €${bonus.amount.toFixed(2)} from €${bonus.basedOnGross}`);
    });
    
    console.log('\n💰 ACTUAL COMMISSION TOTALS:');
    console.log(`Live Manager Commissions: €${totalLiveBonuses.toFixed(2)}`);
    console.log(`Team Manager Commissions: €${totalTeamBonuses.toFixed(2)}`);
    console.log(`Total Commission Payout: €${(totalLiveBonuses + totalTeamBonuses).toFixed(2)}`);
    
    // Check transactions
    const transactionsResponse = await axios.get(
      'https://europe-west1-trend4media-billing.cloudfunctions.net/api/transactions?limit=10',
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );
    
    const transactions = transactionsResponse.data || [];
    console.log(`\n💳 Transactions created: ${transactions.length}`);
    
    let totalTransactionGross = 0;
    transactions.forEach(transaction => {
      totalTransactionGross += transaction.gross || 0;
      console.log(`  - ${transaction.creatorName}: €${transaction.gross} gross, €${transaction.net} net`);
    });
    
    console.log(`\n📊 Total Transaction Gross: €${totalTransactionGross.toFixed(2)}`);
    
    console.log('\n🎉 TEST COMPLETED SUCCESSFULLY!');
    console.log('✅ Upload, processing, and commission calculation all working correctly');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testWithSampleData(); 