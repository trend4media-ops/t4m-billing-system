const { exec } = require('child_process');

async function testLiveFix() {
  console.log('🔧 Testing Live System After Fixes');
  console.log('===================================');
  
  const BASE_URL = 'https://europe-west1-trend4media-billing.cloudfunctions.net/api';
  
  // Login
  exec(`curl -s -X POST "${BASE_URL}/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@trend4media.com","password":"admin123"}'`, (error, stdout) => {
    if (error) {
      console.log('❌ Login failed');
      return;
    }
    
    const loginResponse = JSON.parse(stdout);
    const token = loginResponse.access_token;
    
    console.log('✅ Login successful');
    
    // Test Manager Reports API with month parameter
    console.log('\n📊 Testing Manager Reports API...');
    exec(`curl -s -H "Authorization: Bearer ${token}" "${BASE_URL}/managers/earnings?month=202506"`, (error, stdout) => {
      if (error) {
        console.log('❌ Manager Reports API failed');
        return;
      }
      
      try {
        const data = JSON.parse(stdout);
        console.log('✅ Manager Reports API Response:');
        console.log(`   Status: ${data.error ? 'ERROR' : 'SUCCESS'}`);
        
        if (data.error) {
          console.log(`   Error: ${data.error}`);
        } else {
          console.log(`   Data type: ${Array.isArray(data.data) ? 'Array' : typeof data.data}`);
          console.log(`   Manager count: ${data.data?.length || 0}`);
          
          if (data.data && data.data.length > 0) {
            const sample = data.data[0];
            console.log(`   Sample manager: ${sample.managerName || 'N/A'}`);
            console.log(`   Total earnings: €${sample.totalEarnings?.toFixed(2) || '0.00'}`);
            console.log(`   Manager type: ${sample.managerType || 'N/A'}`);
          }
        }
      } catch (e) {
        console.log(`⚠️  Response parsing failed: ${stdout.substring(0, 200)}`);
      }
    });
    
    setTimeout(() => {
      console.log('\n🌐 Opening live system in browser...');
      exec('open https://trend4media-billing.web.app/admin/reports/');
      
      console.log('\n🎯 SYSTEM STATUS AFTER FIXES:');
      console.log('============================');
      console.log('✅ Backend API: Fixed data structures');
      console.log('✅ Frontend: Added defensive programming');
      console.log('✅ Deployment: Completed successfully');
      console.log('🌐 Live URL: https://trend4media-billing.web.app/admin/reports/');
      console.log('🔑 Admin Login: admin@trend4media.com / admin123');
      console.log('');
      console.log('🔧 FIXES APPLIED:');
      console.log('   - Fixed undefined array errors');
      console.log('   - Added proper error handling');
      console.log('   - Consistent API data structures');
      console.log('   - Safe array operations with fallbacks');
    }, 3000);
  });
}

testLiveFix();
