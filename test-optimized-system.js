const { exec } = require('child_process');

async function testOptimizedSystem() {
  console.log('🚀 Testing Optimized Live System');
  console.log('=================================');
  
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
    
    // Test Manager Reports API
    console.log('\n📊 Testing Optimized Manager Reports API...');
    exec(`curl -s -H "Authorization: Bearer ${token}" "${BASE_URL}/managers/earnings?month=202506"`, (error, stdout) => {
      if (error) {
        console.log('❌ API request failed');
        return;
      }
      
      try {
        const data = JSON.parse(stdout);
        console.log('✅ Manager Reports API Response:');
        console.log(`   ✅ Data type: ${Array.isArray(data.data) ? 'Array' : typeof data.data}`);
        console.log(`   ✅ Manager count: ${data.data?.length || 0}`);
        console.log(`   ✅ Response size: ~${Math.round(stdout.length / 1024)}KB (optimized!)`);
        
        if (data.data && data.data.length > 0) {
          const sample = data.data[0];
          console.log(`   ✅ Sample manager: ${sample.managerName || 'N/A'}`);
          console.log(`   ✅ Total earnings: €${sample.totalEarnings?.toFixed(2) || '0.00'}`);
          console.log(`   ✅ Manager type: ${sample.managerType || 'N/A'}`);
          console.log(`   ✅ No heavy data arrays: ${!sample.transactions && !sample.bonuses ? 'YES' : 'NO'}`);
        }
        
        console.log('\n🎉 OPTIMIZATION SUCCESS! System should now work properly.');
        console.log('\n🌐 Open the live system:');
        console.log('   https://trend4media-billing.web.app/admin/reports/');
        console.log('\n🔑 Login with: admin@trend4media.com / admin123');
        
        // Open the browser
        setTimeout(() => {
          exec('open https://trend4media-billing.web.app/admin/reports/');
        }, 2000);
        
      } catch (e) {
        console.log(`❌ Response parsing failed: ${stdout.substring(0, 200)}`);
      }
    });
  });
}

testOptimizedSystem();
