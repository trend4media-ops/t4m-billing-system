const fs = require('fs');
const { exec } = require('child_process');

async function testExcelUploadCommission() {
  console.log('🧪 TESTING EXCEL UPLOAD & COMMISSION CALCULATION v2.0');
  console.log('=====================================================');
  
  const BASE_URL = 'https://europe-west1-trend4media-billing.cloudfunctions.net/api';
  
  // Check if sample Excel file exists
  const excelFiles = ['sample-commission-data.xlsx', 'test.xlsx', 'Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx'];
  let selectedFile = null;
  
  for (const file of excelFiles) {
    if (fs.existsSync(file)) {
      selectedFile = file;
      break;
    }
  }
  
  if (!selectedFile) {
    console.log('❌ No Excel files found for testing');
    return;
  }
  
  console.log(`📁 Using Excel file: ${selectedFile}`);
  
  // Get token first
  exec(`curl -s -X POST "${BASE_URL}/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@trend4media.com","password":"admin123"}'`, (error, stdout) => {
    if (error) {
      console.log('❌ Login failed');
      return;
    }
    
    const loginResponse = JSON.parse(stdout);
    const token = loginResponse.access_token;
    
    console.log('✅ Login successful, preparing Excel upload...');
    
    // Convert file to base64 for upload
    const fileBuffer = fs.readFileSync(selectedFile);
    const base64Data = fileBuffer.toString('base64');
    
    const uploadData = {
      fileData: base64Data,
      fileName: selectedFile,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      period: '202506',
      comparison: false
    };
    
    // Upload via base64 endpoint
    console.log('\n📤 Uploading Excel file via base64 method...');
    
    const curlCommand = `curl -s -X POST "${BASE_URL}/uploads/excel-base64" ` +
      `-H "Content-Type: application/json" ` +
      `-H "Authorization: Bearer ${token}" ` +
      `-d '${JSON.stringify(uploadData)}'`;
    
    exec(curlCommand, (error, stdout) => {
      if (error) {
        console.log('❌ Upload failed:', error.message);
        return;
      }
      
      try {
        const uploadResponse = JSON.parse(stdout);
        
        if (uploadResponse.success) {
          console.log('✅ Excel upload successful!');
          console.log(`   📊 Batch ID: ${uploadResponse.batch.id}`);
          console.log(`   📈 Processed: ${uploadResponse.batch.processedCount} rows`);
          console.log(`   💳 Transactions: ${uploadResponse.batch.transactionCount}`);
          
          // Wait a bit for processing, then check manager earnings
          setTimeout(() => {
            console.log('\n💰 Checking updated manager earnings...');
            exec(`curl -s -H "Authorization: Bearer ${token}" "${BASE_URL}/managers/earnings?month=202506"`, (error, stdout) => {
              if (!error) {
                try {
                  const earningsResponse = JSON.parse(stdout);
                  if (earningsResponse.data && earningsResponse.data.length > 0) {
                    console.log(`✅ Found ${earningsResponse.data.length} managers with updated earnings`);
                    
                    // Show some examples
                    const managersWithEarnings = earningsResponse.data.filter(m => m.totalEarnings > 0);
                    console.log(`💰 ${managersWithEarnings.length} managers have non-zero earnings`);
                    
                    if (managersWithEarnings.length > 0) {
                      const topManager = managersWithEarnings.sort((a, b) => b.totalEarnings - a.totalEarnings)[0];
                      console.log(`\n🏆 Top earning manager: ${topManager.managerName}`);
                      console.log(`   💰 Total: €${topManager.totalEarnings.toFixed(2)}`);
                      console.log(`   🏢 Base Commission: €${topManager.baseCommission.toFixed(2)}`);
                      console.log(`   🎯 Milestone Bonuses: €${topManager.milestoneBonuses?.total?.toFixed(2) || '0.00'}`);
                      console.log(`   💎 Diamond Bonus: €${topManager.diamondBonus?.toFixed(2) || '0.00'}`);
                    }
                  }
                } catch (e) {
                  console.log('⚠️  Could not parse earnings response');
                }
              }
            });
          }, 3000);
          
        } else {
          console.log('❌ Upload failed:', uploadResponse.error || 'Unknown error');
        }
        
      } catch (e) {
        console.log('❌ Upload response parsing failed:', stdout);
      }
    });
  });
}

testExcelUploadCommission();
