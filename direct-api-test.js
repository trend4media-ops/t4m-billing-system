const { exec } = require('child_process');

// Direct API test
console.log('🔍 Direct API Test - Manager Reports');

const BASE_URL = 'https://europe-west1-trend4media-billing.cloudfunctions.net/api';

// First get token
exec(`curl -s -X POST "${BASE_URL}/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@trend4media.com","password":"admin123"}'`, (error, stdout) => {
  if (error) {
    console.log('❌ Login failed:', error.message);
    return;
  }
  
  console.log('Raw login response:', stdout);
  
  let token;
  try {
    const loginResponse = JSON.parse(stdout);
    token = loginResponse.access_token;
    console.log('✅ Token obtained');
  } catch (e) {
    console.log('❌ Login response parsing failed');
    return;
  }
  
  // Test Manager Reports for the uploaded period (202508)
  console.log('\n📊 Testing Manager Reports for period 202508...');
  exec(`curl -s -H "Authorization: Bearer ${token}" "${BASE_URL}/reports/manager-earnings?period=202508"`, (error, stdout) => {
    if (error) {
      console.log('❌ Manager reports error:', error.message);
      return;
    }
    
    try {
      const response = JSON.parse(stdout);
      console.log('\n✅ Manager Reports Response:');
      console.log('Summary:', JSON.stringify(response.summary, null, 2));
      
      if (response.managers && response.managers.length > 0) {
        console.log('\n👥 Top 5 Managers:');
        response.managers.slice(0, 5).forEach((manager, index) => {
          console.log(`${index + 1}. ${manager.managerName} (${manager.managerHandle}): €${manager.totalEarnings.toFixed(2)} - ${manager.transactionCount} transactions, ${manager.bonusCount} bonuses`);
        });
      } else {
        console.log('⚠️ No managers found with earnings data');
      }
    } catch (e) {
      console.log('❌ Response parsing failed:', e.message);
      console.log('Raw response:', stdout);
    }
  });
  
  // Test individual manager earnings for a specific manager
  setTimeout(() => {
    console.log('\n🔍 Testing individual manager earnings...');
    exec(`curl -s -H "Authorization: Bearer ${token}" "${BASE_URL}/managers/earnings/florian_tripodi?period=202508"`, (error, stdout) => {
      if (error) {
        console.log('❌ Individual manager error:', error.message);
        return;
      }
      
      try {
        const response = JSON.parse(stdout);
        console.log('\n💰 Individual Manager Response:');
        console.log(JSON.stringify(response, null, 2));
      } catch (e) {
        console.log('❌ Individual response parsing failed:', e.message);
        console.log('Raw response:', stdout);
      }
    });
  }, 3000);
  
  // Also test the health endpoint
  setTimeout(() => {
    console.log('\n💓 Testing health endpoint...');
    exec(`curl -s "${BASE_URL}/health"`, (error, stdout) => {
      console.log('Health response:', stdout);
    });
  }, 6000);
});
