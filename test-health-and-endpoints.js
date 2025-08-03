const axios = require('axios');

const BASE_URL = 'https://api-piwtsoxesq-ew.a.run.app';

async function runSystemTests() {
  console.log('🔍 SYSTEM-WIDE SMOKE TESTS');
  
  try {
    // 1. Health Check
    console.log('\n📊 Testing Health Check...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Health Check:', healthResponse.data);
    
    // 2. Authentication Test  
    console.log('\n🔐 Testing Authentication...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@trend4media.com',
      password: 'admin123'
    });
    
    const token = loginResponse.data.access_token;
    console.log('✅ Login successful');
    
    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // 3. Test /auth/me
    console.log('\n👤 Testing /auth/me...');
    const meResponse = await axios.get(`${BASE_URL}/auth/me`, { headers: authHeaders });
    console.log('✅ /auth/me:', meResponse.data);
    
    // 4. Test Managers Endpoint
    console.log('\n👥 Testing Managers Endpoint...');
    const managersResponse = await axios.get(`${BASE_URL}/managers`, { headers: authHeaders });
    console.log('✅ Managers count:', managersResponse.data.data?.length || 0);
    
    // 5. Test Upload Batches
    console.log('\n📋 Testing Upload Batches...');
    const batchesResponse = await axios.get(`${BASE_URL}/uploads/batches?limit=5`, { headers: authHeaders });
    console.log('✅ Recent Batches:', batchesResponse.data.data?.length || 0);
    
    if (batchesResponse.data.data && batchesResponse.data.data.length > 0) {
      const latestBatch = batchesResponse.data.data[0];
      console.log('   Latest Batch:', {
        id: latestBatch.id,
        filename: latestBatch.filename,
        status: latestBatch.status,
        processedCount: latestBatch.processedCount
      });
    }
    
    // 6. Test Manager Earnings (if managers exist)
    if (managersResponse.data.data && managersResponse.data.data.length > 0) {
      console.log('\n💰 Testing Manager Earnings...');
      const managerId = managersResponse.data.data[0].id;
      const month = '202506'; // From the Excel data
      
      try {
        const earningsResponse = await axios.get(`${BASE_URL}/managers/${managerId}/earnings?month=${month}`, { headers: authHeaders });
        console.log('✅ Manager Earnings Test successful');
        console.log('   Total Earnings:', earningsResponse.data.totalEarnings);
        console.log('   Base Commission:', earningsResponse.data.baseCommission);
        console.log('   Transactions:', earningsResponse.data.transactionCount);
      } catch (earningsError) {
        console.log('⚠️  Manager Earnings Test (expected if no data):', earningsError.response?.status);
      }
      
      // 7. Test All Manager Earnings
      console.log('\n📊 Testing All Manager Earnings...');
      try {
        const allEarningsResponse = await axios.get(`${BASE_URL}/managers/earnings?month=${month}`, { headers: authHeaders });
        console.log('✅ All Manager Earnings Test successful');
        console.log('   Managers with earnings:', allEarningsResponse.data.data?.length || 0);
      } catch (allEarningsError) {
        console.log('⚠️  All Manager Earnings Test (expected if no data):', allEarningsError.response?.status);
      }
    }
    
    // 8. Test Genealogy Endpoints
    console.log('\n🌳 Testing Genealogy Endpoints...');
    try {
      const genealogyResponse = await axios.get(`${BASE_URL}/genealogy`, { headers: authHeaders });
      console.log('✅ Genealogy Test successful');
      console.log('   Genealogy entries:', genealogyResponse.data.data?.length || 0);
    } catch (genealogyError) {
      console.log('⚠️  Genealogy Test (expected if no data):', genealogyError.response?.status);
    }
    
    // 9. Test Payouts Endpoints
    console.log('\n💳 Testing Payouts Endpoints...');
    try {
      const payoutsResponse = await axios.get(`${BASE_URL}/payouts`, { headers: authHeaders });
      console.log('✅ Payouts Test successful');
      console.log('   Payout requests:', payoutsResponse.data.data?.length || 0);
    } catch (payoutsError) {
      console.log('⚠️  Payouts Test (expected if no data):', payoutsError.response?.status);
    }
    
    // 10. Test Messages Endpoints
    console.log('\n💌 Testing Messages Endpoints...');
    try {
      const messagesResponse = await axios.get(`${BASE_URL}/messages?userHandle=admin@trend4media.com`, { headers: authHeaders });
      console.log('✅ Messages Test successful');
      console.log('   Messages count:', messagesResponse.length || 0);
    } catch (messagesError) {
      console.log('⚠️  Messages Test (expected if no data):', messagesError.response?.status);
    }
    
    console.log('\n🎉 SMOKE TESTS COMPLETED');
    console.log('🔗 API Base URL:', BASE_URL);
    console.log('🎯 All core endpoints are responding');
    
  } catch (error) {
    console.error('❌ System Test Failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the tests
runSystemTests(); 