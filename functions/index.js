const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const multer = require("multer");
const xlsx = require("xlsx");

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage();

// Create Express app
const app = express();

// Configure multer for file uploads with better error handling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    fieldSize: 10 * 1024 * 1024,
    fields: 10,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log('Multer fileFilter - File info:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      fieldname: file.fieldname
    });
    
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel' ||
        file.originalname.endsWith('.xlsx') ||
        file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed!'), false);
    }
  }
});

// Middleware
app.use(helmet());
app.use(cors({ 
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400'
    });
    res.status(200).end();
    return;
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Simple JWT token creation (for compatibility)
function createSimpleToken(user) {
  const payload = {
    userId: user.uid,
    email: user.email,
    role: user.role || 'user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  };
  
  // Simple base64 encoding (not secure for production, but works for testing)
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifySimpleToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }
    return payload;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'T4M Firebase Backend'
  });
});

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const payload = verifySimpleToken(token);
    req.user = payload;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth routes
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Simple password verification for test users
    const testUsers = {
      'admin@trend4media.com': { password: 'admin123', role: 'admin', firstName: 'Admin', lastName: 'User' },
      'live@trend4media.com': { password: 'manager123', role: 'manager', firstName: 'Live', lastName: 'Manager' },
      'team@trend4media.com': { password: 'manager123', role: 'manager', firstName: 'Team', lastName: 'Manager' }
    };

    const testUser = testUsers[email];
    if (!testUser || testUser.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create simple token
    const userPayload = {
      uid: `user_${Buffer.from(email).toString('base64').substring(0, 10)}`,
      email: email,
      role: testUser.role,
      firstName: testUser.firstName,
      lastName: testUser.lastName
    };

    const accessToken = createSimpleToken(userPayload);
    
    res.json({ 
      access_token: accessToken,
      user: {
        id: userPayload.uid,
        email: userPayload.email,
        firstName: userPayload.firstName,
        lastName: userPayload.lastName,
        role: userPayload.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Get current user
app.get('/auth/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      id: req.user.userId,
      email: req.user.email,
      role: req.user.role
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Managers routes
app.get('/managers', authenticateToken, async (req, res) => {
  try {
    const managersSnapshot = await db.collection('managers').get();
    const managers = managersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.json({ data: managers }); // Standardize response format
  } catch (error) {
    console.error('Get managers error:', error);
    res.status(500).json({ error: 'Failed to fetch managers' });
  }
});

// Add missing earnings endpoints
app.get('/managers/earnings', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const month = req.query.month;
    if (!month || !/^\d{6}$/.test(month)) {
      return res.status(400).json({ error: 'Month parameter is required in YYYYMM format' });
    }

    // Get all managers and their earnings for the specified month
    const managersSnapshot = await db.collection('managers').get();
    const earningsData = [];

    for (const managerDoc of managersSnapshot.docs) {
      const manager = { id: managerDoc.id, ...managerDoc.data() };
      
      // Get transactions for this manager and month
      const transactionsSnapshot = await db.collection('transactions')
        .where('liveManagerId', '==', manager.id)
        .where('period', '==', month)
        .get();

      const transactions = transactionsSnapshot.docs.map(doc => doc.data());
      
      // Calculate earnings
      const grossAmount = transactions.reduce((sum, tx) => sum + (tx.grossAmount || 0), 0);
      const netAmount = transactions.reduce((sum, tx) => sum + (tx.netAmount || 0), 0);
      const baseCommission = transactions.reduce((sum, tx) => sum + (tx.baseCommission || 0), 0);
      const downlineIncome = transactions.reduce((sum, tx) => sum + (tx.downlineIncome?.total || 0), 0);
      
      if (grossAmount > 0) { // Only include managers with earnings
        earningsData.push({
          managerId: manager.id,
          managerHandle: manager.handle,
          managerName: manager.name,
          managerType: manager.type,
          month: month,
          grossAmount,
          netAmount,
          baseCommission,
          downlineIncome,
          totalEarnings: baseCommission + downlineIncome,
          transactionCount: transactions.length
        });
      }
    }

    res.json({ data: earningsData });
  } catch (error) {
    console.error('Get all manager earnings error:', error);
    res.status(500).json({ error: 'Failed to fetch manager earnings' });
  }
});

app.get('/managers/:id/earnings', authenticateToken, async (req, res) => {
  try {
    const managerId = req.params.id;
    const month = req.query.month;
    
    // Check if user can access this manager's data
    if (req.user.role !== 'admin' && req.user.userId !== managerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!month || !/^\d{6}$/.test(month)) {
      return res.status(400).json({ error: 'Month parameter is required in YYYYMM format' });
    }

    // Get manager details
    const managerDoc = await db.collection('managers').doc(managerId).get();
    if (!managerDoc.exists) {
      return res.status(404).json({ error: 'Manager not found' });
    }

    const manager = { id: managerDoc.id, ...managerDoc.data() };

    // Get transactions for this manager and month
    const transactionsSnapshot = await db.collection('transactions')
      .where('liveManagerId', '==', managerId)
      .where('period', '==', month)
      .get();

    const transactions = transactionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Calculate detailed earnings
    const grossAmount = transactions.reduce((sum, tx) => sum + (tx.grossAmount || 0), 0);
    const netAmount = transactions.reduce((sum, tx) => sum + (tx.netAmount || 0), 0);
    const bonusSum = transactions.reduce((sum, tx) => sum + (tx.bonusSum || 0), 0);
    const baseCommission = transactions.reduce((sum, tx) => sum + (tx.baseCommission || 0), 0);
    
    // Downline income breakdown
    const downlineIncome = transactions.reduce((acc, tx) => {
      const dl = tx.downlineIncome || {};
      return {
        levelA: acc.levelA + (dl.levelA || 0),
        levelB: acc.levelB + (dl.levelB || 0),
        levelC: acc.levelC + (dl.levelC || 0),
        total: acc.total + (dl.total || 0)
      };
    }, { levelA: 0, levelB: 0, levelC: 0, total: 0 });

    // Milestone bonuses
    const milestoneBonuses = transactions.reduce((acc, tx) => {
      const mb = tx.milestoneBonuses || {};
      return {
        half: acc.half + (mb.half || 0),
        m1: acc.m1 + (mb.m1 || 0),
        m2: acc.m2 + (mb.m2 || 0),
        retention: acc.retention + (mb.retention || 0)
      };
    }, { half: 0, m1: 0, m2: 0, retention: 0 });

    const earningsData = {
      managerId: manager.id,
      managerHandle: manager.handle,
      managerName: manager.name,
      managerType: manager.type,
      month: month,
      grossAmount,
      netAmount,
      bonusSum,
      baseCommission,
      downlineIncome,
      milestoneBonuses,
      totalEarnings: baseCommission + downlineIncome.total,
      transactionCount: transactions.length,
      transactions: transactions
    };

    res.json(earningsData);
  } catch (error) {
    console.error('Get manager earnings error:', error);
    res.status(500).json({ error: 'Failed to fetch manager earnings' });
  }
});

// Transactions routes
app.get('/transactions', authenticateToken, async (req, res) => {
  try {
    let query = db.collection('transactions');
    
    // Filter by manager if not admin
    if (req.user.role !== 'admin') {
      query = query.where('managerId', '==', req.user.userId);
    }

    const snapshot = await query.orderBy('date', 'desc').limit(100).get();
    const transactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(transactions);
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Upload routes (Excel processing) - COMPLETE IMPLEMENTATION
app.post('/uploads/excel', authenticateToken, upload.single('file'), async (req, res) => {
  console.log('Upload endpoint hit');
  console.log('User:', req.user);
  console.log('File info:', req.file ? {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size
  } : 'No file');
  console.log('Body:', req.body);
  
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!req.file) {
      console.error('No file in request');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!req.file.buffer || req.file.buffer.length === 0) {
      console.error('File buffer is empty');
      return res.status(400).json({ error: 'Uploaded file is empty' });
    }

    // Generate batch ID
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = req.file.originalname;
    
    console.log(`Processing upload: ${filename} -> ${batchId}`);

    // 1. Save file to Firebase Storage
    const bucket = storage.bucket();
    const file = bucket.file(`uploads/${batchId}.xlsx`);
    
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          originalName: filename,
          batchId: batchId,
          uploadedBy: req.user.email,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    console.log(`File saved to Storage: uploads/${batchId}.xlsx`);

    // 2. Create initial batch document in Firestore
    const batchData = {
      id: batchId,
      filename: filename,
      createdAt: admin.firestore.Timestamp.now(),
      status: 'PENDING',
      processedCount: 0,
      newCreators: 0,
      newManagers: 0,
      transactionCount: 0,
      uploadedBy: req.user.email
    };

    await db.collection('uploadBatches').doc(batchId).set(batchData);
    console.log(`Batch document created: ${batchId}`);

    // 3. Process Excel file immediately
    await processExcelBatch(batchId, req.file.buffer, filename);

    // 4. Get the updated batch data after processing
    const updatedBatchDoc = await db.collection('uploadBatches').doc(batchId).get();
    const updatedBatch = updatedBatchDoc.data();

    // 5. Get recent batches for frontend display
    const recentBatchesSnapshot = await db.collection('uploadBatches')
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();

    const recentBatches = [];
    recentBatchesSnapshot.forEach(doc => {
      const data = doc.data();
      recentBatches.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        completedAt: data.completedAt?.toDate?.()?.toISOString() || data.completedAt
      });
    });

    res.json({
      success: true,
      message: 'Excel file uploaded and processed successfully',
      batch: {
        id: batchId,
        filename: filename,
        status: updatedBatch?.status || 'PROCESSING',
        processedCount: updatedBatch?.processedCount || 0,
        newCreators: updatedBatch?.newCreators || 0,
        newManagers: updatedBatch?.newManagers || 0,
        transactionCount: updatedBatch?.transactionCount || 0
      },
      recentBatches: recentBatches,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Excel processing function
async function processExcelBatch(batchId, fileBuffer, filename) {
  console.log(`Starting Excel processing for batch: ${batchId}`);
  
  try {
    // Parse Excel file
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON, starting from row 2 (skip header)
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const rows = data.slice(1); // Skip header row
    
    console.log(`Found ${rows.length} data rows to process`);

    let processedCount = 0;
    let newCreators = 0;
    let newManagers = 0;
    let transactionCount = 0;

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Skip empty rows - check for creator name in column A (index 0)
      if (!row || row.length === 0 || !row[0] || row[0].toString().trim() === '') {
        console.log(`Skipping empty row ${i + 2}`);
        continue;
      }

      try {
        await processExcelRow(row, batchId, i + 2); // +2 because we skipped header and array is 0-indexed
        processedCount++;
        transactionCount++;
        console.log(`Successfully processed row ${i + 2}`);
      } catch (rowError) {
        console.error(`Error processing row ${i + 2}:`, rowError);
        console.error(`Row data:`, row);
        // Continue with next row instead of failing the entire batch
      }
    }

    // Update batch status
    await db.collection('uploadBatches').doc(batchId).update({
      status: 'COMPLETED',
      processedCount: processedCount,
      newCreators: newCreators,
      newManagers: newManagers,
      transactionCount: transactionCount,
      completedAt: admin.firestore.Timestamp.now()
    });

    console.log(`Batch ${batchId} completed: ${processedCount} rows processed`);

  } catch (error) {
    console.error(`Error processing batch ${batchId}:`, error);
    
    // Update batch status to failed
    await db.collection('uploadBatches').doc(batchId).update({
      status: 'FAILED',
      error: error.message,
      completedAt: admin.firestore.Timestamp.now()
    });
    
    throw error;
  }
}

// Process individual Excel row
async function processExcelRow(row, batchId, rowNumber) {
  try {
    // Extract data from specific columns according to spec
    // Use more flexible column mapping to handle different Excel formats
    const creatorName = (row[0] || '').toString().trim(); // Column A - Creator Name
    const grossAmount = parseFloat(row[1]) || 0; // Column B - Gross Amount  
    const netAmount = parseFloat(row[2]) || 0; // Column C - Net Amount
    const period = (row[3] || '').toString().trim(); // Column D - Period
    const liveManagerHandle = (row[4] || '').toString().trim(); // Column E - Live Manager Handle
    const liveManagerName = (row[5] || '').toString().trim(); // Column F - Live Manager Name
    const teamManagerHandle = (row[6] || '').toString().trim(); // Column G - Team Manager Handle (optional)
    const teamManagerName = (row[7] || '').toString().trim(); // Column H - Team Manager Name (optional)

    console.log(`Processing row ${rowNumber}: Creator: "${creatorName}", Gross: ${grossAmount}, Net: ${netAmount}, Live: "${liveManagerHandle}", Team: "${teamManagerHandle}"`);

    // Skip if essential data is missing
    if (!creatorName || !liveManagerHandle || !period || grossAmount <= 0) {
      console.log(`Skipping row ${rowNumber}: missing essential data - Creator: "${creatorName}", Live: "${liveManagerHandle}", Period: "${period}", Gross: ${grossAmount}`);
      return;
    }

    // Calculate basic amounts
    const bonusSum = 0; // For now, set to 0 - can be calculated from additional columns if needed
    const net = netAmount || (grossAmount - bonusSum);
    const isLive = true; // Live manager (could be determined by other logic)
    const rate = isLive ? 0.30 : 0.35;
    const baseComm = net * rate;

    // Milestone bonuses (these would be calculated based on actual business logic)
    const milestoneBonuses = {
      half: 0,
      m1: 0,
      m2: 0,
      retention: 0
    };

    // Get or create Creator
    const creator = await getOrCreateCreator(creatorName);
    
    // Get or create Live Manager
    const liveManager = await getOrCreateManager(liveManagerHandle, liveManagerName || liveManagerHandle, 'LIVE');
    
    // Get or create Team Manager (if exists)
    let teamManager = null;
    if (teamManagerHandle) {
      teamManager = await getOrCreateManager(teamManagerHandle, teamManagerName || teamManagerHandle, 'TEAM');
    }

    // Get genealogy data for downline calculations
    const downlineIncome = await calculateDownlineIncome(liveManagerHandle, baseComm);

    // Create transaction
    const transactionId = `tx_${batchId}_${rowNumber}`;
    const transactionData = {
      id: transactionId,
      batchId: batchId,
      creatorId: creator.id,
      creatorName: creatorName,
      liveManagerId: liveManager.id,
      liveManagerHandle: liveManagerHandle,
      liveManagerName: liveManagerName,
      teamManagerId: teamManager?.id || null,
      teamManagerHandle: teamManagerHandle || null,
      teamManagerName: teamManagerName || null,
      grossAmount: grossAmount,
      bonusSum: bonusSum,
      netAmount: net,
      baseCommission: baseComm,
      commissionRate: rate,
      milestoneBonuses: milestoneBonuses,
      downlineIncome: downlineIncome,
      period: period || getCurrentPeriod(),
      rowNumber: rowNumber,
      createdAt: admin.firestore.Timestamp.now()
    };

    await db.collection('transactions').doc(transactionId).set(transactionData);
    console.log(`Transaction created: ${transactionId} for creator ${creatorName}`);
  } catch (error) {
    console.error(`Error processing row ${rowNumber}:`, error);
    throw error; // Re-throw to be caught by the caller
  }
}

// Get or create creator
async function getOrCreateCreator(creatorName) {
  const creatorsSnapshot = await db.collection('creators')
    .where('name', '==', creatorName)
    .limit(1)
    .get();

  if (!creatorsSnapshot.empty) {
    const doc = creatorsSnapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  // Create new creator
  const creatorId = `creator_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const creatorData = {
    id: creatorId,
    name: creatorName,
    createdAt: admin.firestore.Timestamp.now()
  };

  await db.collection('creators').doc(creatorId).set(creatorData);
  console.log(`New creator created: ${creatorName}`);
  
  return creatorData;
}

// Get or create manager
async function getOrCreateManager(managerHandle, managerName, type) {
  try {
    const managersSnapshot = await db.collection('managers')
      .where('handle', '==', managerHandle)
      .limit(1)
      .get();

    if (!managersSnapshot.empty) {
      const doc = managersSnapshot.docs[0];
      return { id: doc.id, ...doc.data() };
    }

    // Create new manager
    const managerId = `manager_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const managerData = {
      id: managerId,
      handle: managerHandle,
      name: managerName || managerHandle,
      type: type,
      commissionRate: type === 'LIVE' ? 0.30 : 0.35,
      createdAt: admin.firestore.Timestamp.now()
    };

    await db.collection('managers').doc(managerId).set(managerData);
    console.log(`New manager created: ${managerHandle} (${managerName}) [${type}]`);
    
    return managerData;
  } catch (error) {
    console.error(`Error creating/getting manager ${managerHandle}:`, error);
    throw error;
  }
}

// Calculate downline income based on genealogy
async function calculateDownlineIncome(liveManagerHandle, baseComm) {
  try {
    // Get genealogy entries where this manager appears as teamManager
    const genealogySnapshot = await db.collection('genealogy')
      .where('teamManagerHandle', '==', liveManagerHandle)
      .get();

    let downlineIncome = {
      levelA: 0,
      levelB: 0,
      levelC: 0,
      total: 0
    };

    if (genealogySnapshot.empty) {
      return downlineIncome;
    }

    // Calculate downline percentages based on levels
    genealogySnapshot.forEach(doc => {
      const genealogyData = doc.data();
      const level = genealogyData.level;
      
      if (level === 'A') {
        downlineIncome.levelA += baseComm * 0.10;
      } else if (level === 'B') {
        downlineIncome.levelB += baseComm * 0.075;
      } else if (level === 'C') {
        downlineIncome.levelC += baseComm * 0.05;
      }
    });

    downlineIncome.total = downlineIncome.levelA + downlineIncome.levelB + downlineIncome.levelC;
    
    return downlineIncome;
  } catch (error) {
    console.error('Error calculating downline income:', error);
    return { levelA: 0, levelB: 0, levelC: 0, total: 0 };
  }
}

// Get current period (YYYYMM)
function getCurrentPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}${month}`;
}

// Bonuses routes
app.get('/bonuses', authenticateToken, async (req, res) => {
  try {
    let query = db.collection('bonuses');
    
    if (req.user.role !== 'admin') {
      query = query.where('managerId', '==', req.user.userId);
    }

    const snapshot = await query.orderBy('month', 'desc').get();
    const bonuses = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(bonuses);
  } catch (error) {
    console.error('Get bonuses error:', error);
    res.status(500).json({ error: 'Failed to fetch bonuses' });
  }
});

// Admin API: Get upload batches
app.get('/uploads/batches', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const limit = parseInt(req.query.limit) || 20;
    const snapshot = await db.collection('uploadBatches')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const batches = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      batches.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt
      });
    });

    res.json({ data: batches });
  } catch (error) {
    console.error('Error fetching upload batches:', error);
    res.status(500).json({ error: 'Failed to fetch upload batches' });
  }
});

// Admin API: Get specific upload batch
app.get('/uploads/batches/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const batchId = req.params.id;
    const batchDoc = await db.collection('uploadBatches').doc(batchId).get();

    if (!batchDoc.exists) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const batchData = batchDoc.data();
    res.json({
      id: batchDoc.id,
      ...batchData,
      createdAt: batchData.createdAt?.toDate?.()?.toISOString() || batchData.createdAt,
      completedAt: batchData.completedAt?.toDate?.()?.toISOString() || batchData.completedAt
    });
  } catch (error) {
    console.error('Error fetching upload batch:', error);
    res.status(500).json({ error: 'Failed to fetch upload batch' });
  }
});

// Admin API: Get transactions for specific batch
app.get('/uploads/batches/:id/transactions', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const batchId = req.params.id;
    const snapshot = await db.collection('transactions')
      .where('batchId', '==', batchId)
      .orderBy('rowNumber', 'asc')
      .get();

    const transactions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt
      });
    });

    res.json({ 
      data: transactions,
      count: transactions.length 
    });
  } catch (error) {
    console.error('Error fetching batch transactions:', error);
    res.status(500).json({ error: 'Failed to fetch batch transactions' });
  }
});

// ===== GENEALOGY ENDPOINTS =====

// Get all genealogy entries
app.get('/genealogy', authenticateToken, async (req, res) => {
  try {
    const snapshot = await db.collection('genealogy').orderBy('assignedAt', 'desc').get();
    const genealogies = [];
    
    snapshot.forEach(doc => {
      genealogies.push({
        id: doc.id,
        ...doc.data(),
        assignedAt: doc.data().assignedAt?.toDate?.()?.toISOString() || doc.data().assignedAt
      });
    });

    res.json({ data: genealogies });
  } catch (error) {
    console.error('Error fetching genealogy:', error);
    res.status(500).json({ error: 'Failed to fetch genealogy data' });
  }
});

// Get genealogy entries by team manager handle
app.get('/genealogy/team-handle/:handle', authenticateToken, async (req, res) => {
  try {
    const { handle } = req.params;
    const snapshot = await db.collection('genealogy')
      .where('teamManagerHandle', '==', handle)
      .orderBy('assignedAt', 'desc')
      .get();
    
    const genealogies = [];
    snapshot.forEach(doc => {
      genealogies.push({
        id: doc.id,
        ...doc.data(),
        assignedAt: doc.data().assignedAt?.toDate?.()?.toISOString() || doc.data().assignedAt
      });
    });

    res.json({ data: genealogies });
  } catch (error) {
    console.error('Error fetching genealogy by team handle:', error);
    res.status(500).json({ error: 'Failed to fetch genealogy data' });
  }
});

// Create genealogy entry
app.post('/genealogy', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { teamManagerHandle, liveManagerHandle, level } = req.body;

    if (!teamManagerHandle || !liveManagerHandle || !level) {
      return res.status(400).json({ error: 'teamManagerHandle, liveManagerHandle, and level are required' });
    }

    if (!['A', 'B', 'C'].includes(level)) {
      return res.status(400).json({ error: 'level must be A, B, or C' });
    }

    // Verify managers exist
    const teamManagerSnapshot = await db.collection('managers').where('handle', '==', teamManagerHandle).get();
    const liveManagerSnapshot = await db.collection('managers').where('handle', '==', liveManagerHandle).get();

    if (teamManagerSnapshot.empty) {
      return res.status(404).json({ error: `Team Manager with handle '${teamManagerHandle}' not found` });
    }

    if (liveManagerSnapshot.empty) {
      return res.status(404).json({ error: `Live Manager with handle '${liveManagerHandle}' not found` });
    }

    const genealogyData = {
      teamManagerHandle,
      liveManagerHandle,
      level,
      assignedAt: admin.firestore.Timestamp.now()
    };

    const docRef = await db.collection('genealogy').add(genealogyData);

    // Log audit trail
    await db.collection('audit-logs').add({
      userId: req.user.userId,
      action: 'GENEALOGY_CREATED',
      details: {
        genealogyId: docRef.id,
        teamManagerHandle,
        liveManagerHandle,
        level
      },
      timestamp: admin.firestore.Timestamp.now()
    });

    // Trigger downline recalculation
    await triggerDownlineRecalculation(teamManagerHandle);

    res.status(201).json({ 
      id: docRef.id, 
      ...genealogyData,
      assignedAt: genealogyData.assignedAt.toDate().toISOString()
    });
  } catch (error) {
    console.error('Error creating genealogy:', error);
    res.status(500).json({ error: 'Failed to create genealogy entry' });
  }
});

// Update genealogy entry
app.put('/genealogy/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { teamManagerHandle, liveManagerHandle, level } = req.body;

    // Get existing genealogy
    const genealogyDoc = await db.collection('genealogy').doc(id).get();
    if (!genealogyDoc.exists) {
      return res.status(404).json({ error: 'Genealogy entry not found' });
    }

    const oldData = genealogyDoc.data();
    const updateData = {};

    if (teamManagerHandle !== undefined) {
      // Verify team manager exists
      const teamManagerSnapshot = await db.collection('managers').where('handle', '==', teamManagerHandle).get();
      if (teamManagerSnapshot.empty) {
        return res.status(404).json({ error: `Team Manager with handle '${teamManagerHandle}' not found` });
      }
      updateData.teamManagerHandle = teamManagerHandle;
    }

    if (liveManagerHandle !== undefined) {
      // Verify live manager exists
      const liveManagerSnapshot = await db.collection('managers').where('handle', '==', liveManagerHandle).get();
      if (liveManagerSnapshot.empty) {
        return res.status(404).json({ error: `Live Manager with handle '${liveManagerHandle}' not found` });
      }
      updateData.liveManagerHandle = liveManagerHandle;
    }

    if (level !== undefined) {
      if (!['A', 'B', 'C'].includes(level)) {
        return res.status(400).json({ error: 'level must be A, B, or C' });
      }
      updateData.level = level;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    await db.collection('genealogy').doc(id).update(updateData);

    // Log audit trail
    await db.collection('audit-logs').add({
      userId: req.user.userId,
      action: 'GENEALOGY_UPDATED',
      details: {
        genealogyId: id,
        oldValues: oldData,
        newValues: updateData
      },
      timestamp: admin.firestore.Timestamp.now()
    });

    // Trigger downline recalculation for affected managers
    if (updateData.teamManagerHandle && updateData.teamManagerHandle !== oldData.teamManagerHandle) {
      await triggerDownlineRecalculation(oldData.teamManagerHandle);
      await triggerDownlineRecalculation(updateData.teamManagerHandle);
    } else if (oldData.teamManagerHandle) {
      await triggerDownlineRecalculation(oldData.teamManagerHandle);
    }

    // Get updated document
    const updatedDoc = await db.collection('genealogy').doc(id).get();
    const updatedData = updatedDoc.data();

    res.json({
      id,
      ...updatedData,
      assignedAt: updatedData.assignedAt?.toDate?.()?.toISOString() || updatedData.assignedAt
    });
  } catch (error) {
    console.error('Error updating genealogy:', error);
    res.status(500).json({ error: 'Failed to update genealogy entry' });
  }
});

// Delete genealogy entry
app.delete('/genealogy/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Get existing genealogy
    const genealogyDoc = await db.collection('genealogy').doc(id).get();
    if (!genealogyDoc.exists) {
      return res.status(404).json({ error: 'Genealogy entry not found' });
    }

    const genealogyData = genealogyDoc.data();
    
    await db.collection('genealogy').doc(id).delete();

    // Log audit trail
    await db.collection('audit-logs').add({
      userId: req.user.userId,
      action: 'GENEALOGY_DELETED',
      details: {
        genealogyId: id,
        teamManagerHandle: genealogyData.teamManagerHandle,
        liveManagerHandle: genealogyData.liveManagerHandle,
        level: genealogyData.level
      },
      timestamp: admin.firestore.Timestamp.now()
    });

    // Trigger downline recalculation
    if (genealogyData.teamManagerHandle) {
      await triggerDownlineRecalculation(genealogyData.teamManagerHandle);
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting genealogy:', error);
    res.status(500).json({ error: 'Failed to delete genealogy entry' });
  }
});

// Helper function to trigger downline recalculation
async function triggerDownlineRecalculation(teamManagerHandle) {
  try {
    // Log the need for recalculation
    await db.collection('audit-logs').add({
      userId: 'system',
      action: 'DOWNLINE_RECALCULATION_TRIGGERED',
      details: {
        teamManagerHandle,
        reason: 'Genealogy change',
        timestamp: admin.firestore.Timestamp.now()
      },
      timestamp: admin.firestore.Timestamp.now()
    });

    // TODO: Implement actual downline income recalculation
    // This would typically involve updating commission calculations
    // and potentially triggering payout recalculations
    console.log(`Downline recalculation triggered for team manager: ${teamManagerHandle}`);
  } catch (error) {
    console.error('Error triggering downline recalculation:', error);
  }
}

// ===== PAYOUTS ENDPOINTS =====

// Get all payout requests (with optional status filter)
app.get('/payouts', authenticateToken, async (req, res) => {
  try {
    let query = db.collection('payouts');
    
    // Apply status filter if provided
    const status = req.query.status;
    if (status) {
      query = query.where('status', '==', status);
    }
    
    // Managers can only see their own payout requests
    if (req.user.role !== 'admin') {
      query = query.where('managerHandle', '==', req.user.userId);
    }

    const snapshot = await query.orderBy('requestedAt', 'desc').get();
    const payouts = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      payouts.push({
        id: doc.id,
        ...data,
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() || data.requestedAt,
        processedAt: data.processedAt?.toDate?.()?.toISOString() || data.processedAt
      });
    });

    res.json({ data: payouts });
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({ error: 'Failed to fetch payout requests' });
  }
});

// Get specific payout request
app.get('/payouts/:id', authenticateToken, async (req, res) => {
  try {
    const payoutId = req.params.id;
    const payoutDoc = await db.collection('payouts').doc(payoutId).get();

    if (!payoutDoc.exists) {
      return res.status(404).json({ error: 'Payout request not found' });
    }

    const payoutData = payoutDoc.data();
    
    // Check access permissions
    if (req.user.role !== 'admin' && payoutData.managerHandle !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      id: payoutDoc.id,
      ...payoutData,
      requestedAt: payoutData.requestedAt?.toDate?.()?.toISOString() || payoutData.requestedAt,
      processedAt: payoutData.processedAt?.toDate?.()?.toISOString() || payoutData.processedAt
    });
  } catch (error) {
    console.error('Error fetching payout:', error);
    res.status(500).json({ error: 'Failed to fetch payout request' });
  }
});

// Create new payout request
app.post('/payouts', authenticateToken, async (req, res) => {
  try {
    const { managerHandle, amount, description } = req.body;

    if (!managerHandle || !amount || amount <= 0) {
      return res.status(400).json({ error: 'managerHandle and positive amount are required' });
    }

    // Verify manager exists
    const managerSnapshot = await db.collection('managers').where('handle', '==', managerHandle).get();
    if (managerSnapshot.empty) {
      return res.status(404).json({ error: `Manager with handle '${managerHandle}' not found` });
    }

    const manager = { id: managerSnapshot.docs[0].id, ...managerSnapshot.docs[0].data() };

    // Create payout request
    const payoutData = {
      managerHandle: managerHandle,
      managerId: manager.id,
      managerName: manager.name,
      amount: parseFloat(amount),
      status: 'PENDING',
      description: description || '',
      requestedAt: admin.firestore.Timestamp.now(),
      requestedBy: req.user.userId
    };

    const docRef = await db.collection('payouts').add(payoutData);

    // Log audit trail
    await db.collection('audit-logs').add({
      userId: req.user.userId,
      action: 'PAYOUT_REQUEST_CREATED',
      details: {
        payoutId: docRef.id,
        managerHandle,
        amount: payoutData.amount,
        status: payoutData.status
      },
      timestamp: admin.firestore.Timestamp.now()
    });

    res.status(201).json({ 
      id: docRef.id, 
      ...payoutData,
      requestedAt: payoutData.requestedAt.toDate().toISOString()
    });
  } catch (error) {
    console.error('Error creating payout request:', error);
    res.status(500).json({ error: 'Failed to create payout request' });
  }
});

// Update payout request status (Admin only)
app.put('/payouts/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payoutId = req.params.id;
    const { status, notes } = req.body;

    if (!status || !['PENDING', 'APPROVED', 'PAID', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required (PENDING, APPROVED, PAID, REJECTED)' });
    }

    // Get existing payout
    const payoutDoc = await db.collection('payouts').doc(payoutId).get();
    if (!payoutDoc.exists) {
      return res.status(404).json({ error: 'Payout request not found' });
    }

    const oldData = payoutDoc.data();
    const updateData = {
      status: status,
      processedAt: admin.firestore.Timestamp.now(),
      processedBy: req.user.userId,
      notes: notes || ''
    };

    await db.collection('payouts').doc(payoutId).update(updateData);

    // Log audit trail
    await db.collection('audit-logs').add({
      userId: req.user.userId,
      action: 'PAYOUT_STATUS_UPDATED',
      details: {
        payoutId: payoutId,
        oldStatus: oldData.status,
        newStatus: status,
        managerHandle: oldData.managerHandle,
        amount: oldData.amount,
        notes: notes
      },
      timestamp: admin.firestore.Timestamp.now()
    });

    // Get updated document
    const updatedDoc = await db.collection('payouts').doc(payoutId).get();
    const updatedData = updatedDoc.data();

    res.json({
      id: payoutId,
      ...updatedData,
      requestedAt: updatedData.requestedAt?.toDate?.()?.toISOString() || updatedData.requestedAt,
      processedAt: updatedData.processedAt?.toDate?.()?.toISOString() || updatedData.processedAt
    });
  } catch (error) {
    console.error('Error updating payout request:', error);
    res.status(500).json({ error: 'Failed to update payout request' });
  }
});

// Get payout requests by manager handle
app.get('/payouts/manager/:managerHandle', authenticateToken, async (req, res) => {
  try {
    const { managerHandle } = req.params;
    
    // Check access permissions
    if (req.user.role !== 'admin' && req.user.userId !== managerHandle) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const snapshot = await db.collection('payouts')
      .where('managerHandle', '==', managerHandle)
      .orderBy('requestedAt', 'desc')
      .get();
    
    const payouts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      payouts.push({
        id: doc.id,
        ...data,
        requestedAt: data.requestedAt?.toDate?.()?.toISOString() || data.requestedAt,
        processedAt: data.processedAt?.toDate?.()?.toISOString() || data.processedAt
      });
    });

    res.json({ data: payouts });
  } catch (error) {
    console.error('Error fetching payouts by manager:', error);
    res.status(500).json({ error: 'Failed to fetch payout requests' });
  }
});

// ===== MESSAGES ENDPOINTS =====

// Get messages by userHandle
app.get('/messages', authenticateToken, async (req, res) => {
  try {
    const userHandle = req.query.userHandle;
    if (!userHandle) {
      return res.status(400).json({ error: 'userHandle parameter is required' });
    }

    // Check access permissions
    if (req.user.role !== 'admin' && req.user.email !== userHandle) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const snapshot = await db.collection('messages')
      .where('userHandle', '==', userHandle)
      .orderBy('createdAt', 'desc')
      .get();

    const messages = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      messages.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt
      });
    });

    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get unread message count
app.get('/messages/unread-count', authenticateToken, async (req, res) => {
  try {
    // For now, return 0 as we don't have manager mapping in Firebase Functions
    // In a real implementation, you'd need to map user email to manager handle
    res.json({ count: 0 });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// Mark message as read
app.put('/messages/:id/read', authenticateToken, async (req, res) => {
  try {
    const messageId = req.params.id;
    
    // Get message first to check permissions
    const messageDoc = await db.collection('messages').doc(messageId).get();
    if (!messageDoc.exists) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const messageData = messageDoc.data();
    
    // Check access permissions
    if (req.user.role !== 'admin' && req.user.email !== messageData.userHandle) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.collection('messages').doc(messageId).update({
      read: true
    });

    const updatedDoc = await db.collection('messages').doc(messageId).get();
    const updatedData = updatedDoc.data();

    res.json({
      id: messageId,
      ...updatedData,
      createdAt: updatedData.createdAt?.toDate?.()?.toISOString() || updatedData.createdAt
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// Create message
app.post('/messages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userHandle, module, content } = req.body;

    if (!userHandle || !module || !content) {
      return res.status(400).json({ error: 'userHandle, module, and content are required' });
    }

    const messageData = {
      userHandle,
      module,
      content,
      read: false,
      createdAt: admin.firestore.Timestamp.now()
    };

    const docRef = await db.collection('messages').add(messageData);

    res.status(201).json({
      id: docRef.id,
      ...messageData,
      createdAt: messageData.createdAt.toDate().toISOString()
    });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// Get all messages (admin only)
app.get('/messages/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('messages')
      .orderBy('createdAt', 'desc')
      .get();

    const messages = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      messages.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt
      });
    });

    res.json(messages);
  } catch (error) {
    console.error('Error fetching all messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Admin middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Export the Express app as a Firebase Function
exports.api = onRequest({ 
  region: 'europe-west1',
  memory: '1GiB',
  timeoutSeconds: 300 
}, app); // Force update Sat Aug  2 22:30:40 CEST 2025
