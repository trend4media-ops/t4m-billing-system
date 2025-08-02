const fs = require('fs');
const axios = require('axios');

async function testBase64Upload() {
  console.log('🧪 Testing Base64 Upload Endpoint');
  
  try {
    // 1. Login to get token
    console.log('🔐 Logging in...');
    const loginResponse = await axios.post(
      'https://europe-west1-trend4media-billing.cloudfunctions.net/api/auth/login',
      {
        email: 'admin@trend4media.com',
        password: 'admin123'
      }
    );
    
    const token = loginResponse.data.access_token;
    console.log('✅ Login successful, got token');
    
    // 2. Read Excel file and convert to base64
    const filePath = '../Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx';
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ Excel file not found:', filePath);
      return;
    }
    
    console.log('📄 Reading Excel file...');
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fileBuffer.toString('base64')}`;
    
    console.log('📊 File info:', {
      size: fileBuffer.length,
      base64Length: base64Data.length
    });
    
    // 3. Upload via base64 endpoint
    console.log('📤 Uploading via base64 endpoint...');
    const uploadResponse = await axios.post(
      'https://europe-west1-trend4media-billing.cloudfunctions.net/api/uploads/excel-base64',
      {
        fileData: base64Data,
        fileName: 'Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minutes
      }
    );
    
    console.log('✅ Upload successful!');
    console.log('📊 Response:', JSON.stringify(uploadResponse.data, null, 2));
    
    // 4. Verify data was processed correctly
    if (uploadResponse.data.batch) {
      const batch = uploadResponse.data.batch;
      console.log('\n📈 PROCESSING RESULTS:');
      console.log(`Batch ID: ${batch.id}`);
      console.log(`Status: ${batch.status}`);
      console.log(`Processed Count: ${batch.processedCount}`);
      console.log(`New Creators: ${batch.newCreators}`);
      console.log(`New Managers: ${batch.newManagers}`);
      console.log(`Transactions: ${batch.transactionCount}`);
    }
    
    // 5. Check recent batches
    if (uploadResponse.data.recentBatches && uploadResponse.data.recentBatches.length > 0) {
      console.log('\n📋 RECENT BATCHES:');
      uploadResponse.data.recentBatches.forEach((batch, index) => {
        console.log(`${index + 1}. ${batch.filename} - ${batch.status} (${batch.processedCount} rows)`);
      });
    }
    
  } catch (error) {
    console.error('❌ Upload test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testBase64Upload(); 