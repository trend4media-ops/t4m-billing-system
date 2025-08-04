const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Configuration
const API_BASE = 'https://europe-west1-trend4media-billing.cloudfunctions.net/api';
const TEST_FILE = 'test.xlsx'; // Make sure this file exists

// Test JWT token (replace with valid admin token)
const JWT_TOKEN = 'your-admin-jwt-token-here';

async function testMultipartUpload() {
  console.log('🧪 Testing Multipart Upload...');
  
  try {
    if (!fs.existsSync(TEST_FILE)) {
      console.error(`❌ Test file ${TEST_FILE} not found!`);
      return false;
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(TEST_FILE));
    formData.append('period', '202508');
    formData.append('comparison', 'false');

    const response = await axios.post(`${API_BASE}/uploads`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${JWT_TOKEN}`
      },
      timeout: 300000, // 5 minutes
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxBodyLength: 50 * 1024 * 1024
    });

    console.log('✅ Multipart upload successful!');
    console.log('Response:', response.data);
    return true;
  } catch (error) {
    console.log('❌ Multipart upload failed:', error.response?.data || error.message);
    return false;
  }
}

async function testBase64Upload() {
  console.log('🧪 Testing Base64 Upload...');
  
  try {
    if (!fs.existsSync(TEST_FILE)) {
      console.error(`❌ Test file ${TEST_FILE} not found!`);
      return false;
    }

    // Read file as base64
    const fileBuffer = fs.readFileSync(TEST_FILE);
    const base64Data = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${fileBuffer.toString('base64')}`;

    const response = await axios.post(`${API_BASE}/uploads/base64`, {
      fileData: base64Data,
      fileName: 'test-upload.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      period: '202508',
      comparison: false
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JWT_TOKEN}`
      },
      timeout: 300000 // 5 minutes
    });

    console.log('✅ Base64 upload successful!');
    console.log('Response:', response.data);
    return true;
  } catch (error) {
    console.log('❌ Base64 upload failed:', error.response?.data || error.message);
    return false;
  }
}

async function testUploadBatchesEndpoint() {
  console.log('🧪 Testing Upload Batches Endpoint...');
  
  try {
    const response = await axios.get(`${API_BASE}/uploads/batches`, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`
      }
    });

    console.log('✅ Upload batches endpoint working!');
    console.log(`Found ${response.data.data?.length || 0} batches`);
    
    if (response.data.data?.length > 0) {
      console.log('Latest batch:', response.data.data[0]);
    }
    
    return true;
  } catch (error) {
    console.log('❌ Upload batches endpoint failed:', error.response?.data || error.message);
    return false;
  }
}

async function testManagerEarningsEndpoint() {
  console.log('🧪 Testing Manager Earnings Endpoint...');
  
  try {
    // You'll need to replace with a valid manager ID
    const testManagerId = 'test-manager-id';
    
    const response = await axios.get(`${API_BASE}/earnings/${testManagerId}?period=202508`, {
      headers: {
        'Authorization': `Bearer ${JWT_TOKEN}`
      }
    });

    console.log('✅ Manager earnings endpoint working!');
    console.log('Response:', response.data);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log('⚠️ Manager not found (expected with test ID)');
      return true; // This is expected
    }
    console.log('❌ Manager earnings endpoint failed:', error.response?.data || error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Upload System Tests...\n');
  
  if (JWT_TOKEN === 'your-admin-jwt-token-here') {
    console.log('⚠️ Please update JWT_TOKEN in the script with a valid admin token');
    console.log('You can get one by logging in as admin and checking localStorage.getItem("token")\n');
  }
  
  const results = {
    multipart: await testMultipartUpload(),
    base64: await testBase64Upload(),
    batches: await testUploadBatchesEndpoint(),
    earnings: await testManagerEarningsEndpoint()
  };
  
  console.log('\n📊 Test Results Summary:');
  console.log('========================');
  console.log(`Multipart Upload: ${results.multipart ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Base64 Upload: ${results.base64 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Upload Batches: ${results.batches ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Manager Earnings: ${results.earnings ? '✅ PASSED' : '❌ FAILED'}`);
  
  const passedTests = Object.values(results).filter(Boolean).length;
  const totalTests = Object.keys(results).length;
  
  console.log(`\n🎯 Overall: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Upload system is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Check the deployment and configuration.');
  }
}

// Instructions for use
console.log('Upload System Test Script');
console.log('========================');
console.log('');
console.log('Before running:');
console.log('1. Make sure test.xlsx exists in the current directory');
console.log('2. Update JWT_TOKEN with a valid admin token');
console.log('3. Ensure Firebase functions are deployed');
console.log('');
console.log('Run with: node test-upload-system.js');
console.log('');

// Uncomment the line below to run tests
// runAllTests();

module.exports = { runAllTests, testMultipartUpload, testBase64Upload }; 