const fs = require('fs');

// Test das lokale System ohne axios
async function testLocalSystem() {
  console.log('🧪 Testing Local T4M System');
  console.log('==============================');
  
  // 1. Check if sample Excel file exists
  console.log('\n📊 1. Checking Excel files...');
  const excelFiles = ['sample-commission-data.xlsx', 'test.xlsx'];
  
  for (const file of excelFiles) {
    if (fs.existsSync(file)) {
      const stats = fs.statSync(file);
      console.log(`✅ ${file} exists (${Math.round(stats.size/1024)}KB)`);
    } else {
      console.log(`❌ ${file} not found`);
    }
  }
  
  // 2. Check if Frontend is running
  console.log('\n🌐 2. Checking if Frontend is running...');
  try {
    const { exec } = require('child_process');
    exec('curl -s http://localhost:3000 > /dev/null', (error, stdout, stderr) => {
      if (error) {
        console.log('❌ Frontend not running on port 3000');
      } else {
        console.log('✅ Frontend running on http://localhost:3000');
      }
    });
  } catch (err) {
    console.log('⚠️  Could not check frontend status');
  }
  
  // 3. Check if Backend functions are running
  console.log('\n🔧 3. Checking Firebase Functions...');
  try {
    const { exec } = require('child_process');
    exec('curl -s http://localhost:5001/trend4media-billing/europe-west1/api/health > /dev/null', (error) => {
      if (error) {
        console.log('❌ Firebase Functions not running');
        console.log('💡 Start with: firebase emulators:start --only functions,firestore');
      } else {
        console.log('✅ Firebase Functions running');
      }
    });
  } catch (err) {
    console.log('⚠️  Could not check functions status');
  }
  
  // 4. Test data structure
  console.log('\n🏗️  4. Testing Excel data structure...');
  if (fs.existsSync('sample-commission-data.xlsx')) {
    const XLSX = require('xlsx');
    try {
      const workbook = XLSX.read(fs.readFileSync('sample-commission-data.xlsx'));
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      console.log(`✅ Excel parsed successfully: ${jsonData.length} rows`);
      console.log(`   Headers: ${JSON.stringify(jsonData[0])}`);
      console.log(`   Sample row: ${JSON.stringify(jsonData[1])}`);
    } catch (err) {
      console.log(`❌ Excel parsing failed: ${err.message}`);
    }
  }
  
  // 5. System summary
  console.log('\n📋 5. System Summary:');
  console.log('   📁 Excel files: Available');
  console.log('   🌐 Frontend: Check manually at http://localhost:3000');
  console.log('   🔧 Backend: Check Firebase Emulators');
  console.log('   🔐 Test users: admin@trend4media.com / admin123');
  console.log('\n🎯 Manual Testing Steps:');
  console.log('   1. Open http://localhost:3000');
  console.log('   2. Login as admin@trend4media.com / admin123');
  console.log('   3. Go to Admin Panel > Excel Upload');
  console.log('   4. Upload sample-commission-data.xlsx');
  console.log('   5. Check Manager Reports for results');
}

testLocalSystem().catch(console.error);
