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

// Upload routes (Excel processing) - Debug version
app.post('/uploads/excel', authenticateToken, async (req, res) => {
  console.log('Upload endpoint hit');
  console.log('User:', req.user);
  console.log('Files in request:', req.files);
  console.log('Body:', req.body);
  
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // For now, just return success to test the basic flow
    res.json({
      success: true,
      message: 'Upload endpoint is working',
      user: req.user.email,
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

// Helper function to extract data month from Excel data
function extractDataMonth(data) {
  // Try to find date information in the first few rows
  for (const row of data.slice(0, 5)) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && value.match(/\d{4}[\-\/]\d{2}/)) {
        const match = value.match(/(\d{4})[\-\/](\d{2})/);
        if (match) {
          return `${match[1]}${match[2]}`;
        }
      }
    }
  }
  // Default to current month if no date found
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}${month}`;
}

// Helper function to process individual row data
function processRowData(row) {
  const processed = {};
  
  // Map common Excel columns to our data structure
  for (const [key, value] of Object.entries(row)) {
    const lowerKey = key.toLowerCase();
    
    if (lowerKey.includes('name') || lowerKey.includes('creator')) {
      processed.creatorName = value;
    } else if (lowerKey.includes('manager')) {
      processed.managerName = value;
    } else if (lowerKey.includes('amount') || lowerKey.includes('revenue') || lowerKey.includes('earnings')) {
      processed.amount = parseFloat(value) || 0;
    } else if (lowerKey.includes('commission')) {
      processed.commission = parseFloat(value) || 0;
    } else if (lowerKey.includes('date')) {
      processed.date = value;
    } else {
      // Keep original data
      processed[key] = value;
    }
  }
  
  return processed;
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

// Get upload batches
app.get('/uploads/batches', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const snapshot = await db.collection('upload_batches')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const batches = [];
    snapshot.forEach(doc => {
      batches.push(doc.data());
    });

    res.json({ data: batches });
  } catch (error) {
    console.error('Error fetching upload batches:', error);
    res.status(500).json({ error: 'Failed to fetch upload batches' });
  }
});

// Export the Express app as a Firebase Function
exports.api = onRequest({ 
  region: 'europe-west1',
  memory: '1GiB',
  timeoutSeconds: 300 
}, app); 