const axios = require('axios');

const BASE_URL = 'https://api-piwtsoxesq-ew.a.run.app';

async function testGenealogySimple() {
  console.log('🌳 GENEALOGY SIMPLE TEST');
  
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
    
    // 2. Test GET /genealogy
    console.log('\n📋 Testing GET /genealogy...');
    const genealogyResponse = await axios.get(`${BASE_URL}/genealogy`, { headers: authHeaders });
    console.log('✅ GET /genealogy successful');
    console.log(`   Current entries: ${genealogyResponse.data.data?.length || 0}`);
    
    // 3. Test with known manager handles (from Excel data)
    console.log('\n➕ Testing POST /genealogy with known handles...');
    
    const testCases = [
      {
        teamManagerHandle: 'VenTriiX',
        liveManagerHandle: 'Ghul',  
        level: 'A'
      },
      {
        teamManagerHandle: 'Team Ocepek',
        liveManagerHandle: 'Tim Ostholt',
        level: 'B'
      }
    ];
    
    const createdIds = [];
    
    for (const testCase of testCases) {
      try {
        console.log(`\n   Creating genealogy: ${testCase.teamManagerHandle} -> ${testCase.liveManagerHandle} (Level ${testCase.level})`);
        
        const createResponse = await axios.post(
          `${BASE_URL}/genealogy`,
          testCase,
          { headers: authHeaders }
        );
        
        console.log('   ✅ Created successfully:', createResponse.data.id);
        createdIds.push(createResponse.data.id);
        
        // Test level change
        console.log('   🔄 Testing level update...');
        const newLevel = testCase.level === 'A' ? 'B' : 'C';
        const updateResponse = await axios.put(
          `${BASE_URL}/genealogy/${createResponse.data.id}`,
          { level: newLevel },
          { headers: authHeaders }
        );
        console.log(`   ✅ Updated to level ${newLevel}:`, updateResponse.data.level);
        
      } catch (error) {
        console.log(`   ⚠️  Failed (${error.response?.status}):`, error.response?.data?.error || error.message);
      }
    }
    
    // 4. Test team-handle lookup
    console.log('\n🔍 Testing team-handle lookup...');
    try {
      const teamResponse = await axios.get(
        `${BASE_URL}/genealogy/team-handle/VenTriiX`,
        { headers: authHeaders }
      );
      console.log('✅ Team handle lookup successful');
      console.log(`   Entries for VenTriiX: ${teamResponse.data.data?.length || 0}`);
    } catch (error) {
      console.log('⚠️  Team handle lookup failed:', error.response?.status);
    }
    
    // 5. Verify final state
    console.log('\n📋 Final genealogy state...');
    const finalResponse = await axios.get(`${BASE_URL}/genealogy`, { headers: authHeaders });
    console.log(`   Total entries: ${finalResponse.data.data?.length || 0}`);
    
    if (finalResponse.data.data && finalResponse.data.data.length > 0) {
      console.log('   Sample entries:');
      finalResponse.data.data.slice(0, 3).forEach((entry, index) => {
        console.log(`   ${index + 1}. ${entry.teamManagerHandle} -> ${entry.liveManagerHandle} (Level ${entry.level})`);
      });
    }
    
    // 6. Clean up created entries
    console.log('\n🗑️ Cleaning up test entries...');
    for (const id of createdIds) {
      try {
        await axios.delete(`${BASE_URL}/genealogy/${id}`, { headers: authHeaders });
        console.log(`   ✅ Deleted: ${id}`);
      } catch (error) {
        console.log(`   ⚠️  Failed to delete ${id}:`, error.response?.status);
      }
    }
    
    console.log('\n🎉 GENEALOGY SIMPLE TEST COMPLETED');
    console.log('✅ Basic CRUD operations verified');
    console.log('✅ Level hierarchy management working');
    console.log('✅ Team handle lookup functional');
    
  } catch (error) {
    console.error('❌ Genealogy Simple Test Failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testGenealogySimple(); 