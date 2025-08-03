const axios = require('axios');

const BASE_URL = 'https://api-piwtsoxesq-ew.a.run.app';

async function testRecruitmentBonus() {
  console.log('💰 RECRUITMENT BONUS TEST');
  
  try {
    // 1. Login
    console.log('\n🔐 Logging in...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
      email: 'admin@trend4media.com',
      password: 'admin123'
    });
    
    const token = loginResponse.data.access_token;
    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // 2. Test recruitment bonus creation
    console.log('\n💰 Testing recruitment bonus creation...');
    
    const bonusData = {
      managerHandle: 'VenTriiX',  // Known manager from Excel data
      amount: 1500,
      description: 'Test recruitment bonus for VenTriiX'
    };
    
    try {
      const createResponse = await axios.post(
        `${BASE_URL}/recruitment-bonus`,
        bonusData,
        { headers: authHeaders }
      );
      
      console.log('✅ Recruitment bonus created successfully:', {
        id: createResponse.data.id,
        managerHandle: createResponse.data.managerHandle,
        amount: createResponse.data.amount,
        type: createResponse.data.type,
        description: createResponse.data.description
      });
      
      // 3. Verify bonus appears in listings
      console.log('\n📋 Verifying bonus in listings...');
      const bonusesResponse = await axios.get(`${BASE_URL}/bonuses`, { headers: authHeaders });
      const recruitmentBonuses = bonusesResponse.data.filter(b => b.type === 'RECRUITMENT_BONUS');
      
      console.log(`✅ Found ${recruitmentBonuses.length} recruitment bonuses`);
      if (recruitmentBonuses.length > 0) {
        console.log('   Latest recruitment bonus:', {
          manager: recruitmentBonuses[0].managerName,
          amount: recruitmentBonuses[0].amount,
          description: recruitmentBonuses[0].description
        });
      }
      
    } catch (createError) {
      console.log('⚠️  Recruitment bonus creation failed:', createError.response?.status, createError.response?.data);
    }
    
    console.log('\n🎉 RECRUITMENT BONUS TEST COMPLETED');
    
  } catch (error) {
    console.error('❌ Recruitment Bonus Test Failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testRecruitmentBonus(); 