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

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
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
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
    res.json(managers);
  } catch (error) {
    console.error('Get managers error:', error);
    res.status(500).json({ error: 'Failed to fetch managers' });
  }
});

app.get('/managers/:id/earnings', authenticateToken, async (req, res) => {
  try {
    const managerId = req.params.id;
    
    // Check if user can access this manager's data
    if (req.user.role !== 'admin' && req.user.userId !== managerId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const transactionsSnapshot = await db.collection('transactions')
      .where('managerId', '==', managerId)
      .orderBy('date', 'desc')
      .get();

    const transactions = transactionsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const totalEarnings = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

    res.json({
      managerId,
      totalEarnings,
      transactions,
      count: transactions.length
    });
  } catch (error) {
    console.error('Get earnings error:', error);
    res.status(500).json({ error: 'Failed to fetch earnings' });
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
app.post('/uploads/excel', upload.single('file'), authenticateToken, async (req, res) => {
  console.log('Upload endpoint hit');
  console.log('User:', req.user);
  console.log('File:', req.file);
  
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
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

    res.json({
      success: true,
      message: 'Excel file uploaded and processed successfully',
      batch: {
        id: batchId,
        filename: filename,
        status: 'PROCESSING'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message,
      stack: error.stack 
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
      
      // Skip empty rows
      if (!row || row.length === 0 || !row[3]) { // Column D (index 3) = creatorName
        continue;
      }

      try {
        await processExcelRow(row, batchId, i + 2); // +2 because we skipped header and array is 0-indexed
        processedCount++;
        transactionCount++;
      } catch (rowError) {
        console.error(`Error processing row ${i + 2}:`, rowError);
        // Continue with next row
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
  // Extract data from specific columns according to spec
  const creatorName = (row[3] || '').toString().trim(); // Column D
  const liveManagerHandle = (row[4] || '').toString().trim(); // Column E  
  const teamManagerHandle = (row[6] || '').toString().trim(); // Column G
  const gross = parseFloat(row[12]) || 0; // Column M
  const rookieMilestone1 = parseFloat(row[13]) || 0; // Column N
  const rookieMilestone2 = parseFloat(row[14]) || 0; // Column O
  const rookieRetention = parseFloat(row[15]) || 0; // Column P
  const rookieHalfMilestone = parseFloat(row[18]) || 0; // Column S

  console.log(`Processing row ${rowNumber}: ${creatorName}, Live: ${liveManagerHandle}, Team: ${teamManagerHandle}, Gross: ${gross}`);

  // Skip if essential data is missing
  if (!creatorName || !liveManagerHandle || gross <= 0) {
    console.log(`Skipping row ${rowNumber}: missing essential data`);
    return;
  }

  // Calculate basic amounts
  const bonusSum = rookieMilestone1 + rookieMilestone2 + rookieRetention + rookieHalfMilestone;
  const net = gross - bonusSum;
  const isLive = true; // Live manager (could be determined by other logic)
  const rate = isLive ? 0.30 : 0.35;
  const baseComm = net * rate;

  // Milestone bonuses (these would be calculated based on actual business logic)
  const milestoneBonuses = {
    half: rookieHalfMilestone,
    m1: rookieMilestone1,
    m2: rookieMilestone2,
    retention: rookieRetention
  };

  // Get or create Creator
  const creator = await getOrCreateCreator(creatorName);
  
  // Get or create Live Manager
  const liveManager = await getOrCreateManager(liveManagerHandle, 'LIVE');
  
  // Get or create Team Manager (if exists)
  let teamManager = null;
  if (teamManagerHandle) {
    teamManager = await getOrCreateManager(teamManagerHandle, 'TEAM');
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
    teamManagerId: teamManager?.id || null,
    teamManagerHandle: teamManagerHandle || null,
    grossAmount: gross,
    bonusSum: bonusSum,
    netAmount: net,
    baseCommission: baseComm,
    commissionRate: rate,
    milestoneBonuses: milestoneBonuses,
    downlineIncome: downlineIncome,
    period: getCurrentPeriod(),
    rowNumber: rowNumber,
    createdAt: admin.firestore.Timestamp.now()
  };

  await db.collection('transactions').doc(transactionId).set(transactionData);
  console.log(`Transaction created: ${transactionId}`);
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
async function getOrCreateManager(managerHandle, type) {
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
    name: managerHandle, // Use handle as name for now
    type: type,
    commissionRate: type === 'LIVE' ? 0.30 : 0.35,
    createdAt: admin.firestore.Timestamp.now()
  };

  await db.collection('managers').doc(managerId).set(managerData);
  console.log(`New manager created: ${managerHandle} (${type})`);
  
  return managerData;
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

// Admin middleware
function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Export the Express app as a Firebase Function
exports.api = onRequest({ 
  region: 'europe-west1',
  memory: '1GiB',
  timeoutSeconds: 300 
}, app); 