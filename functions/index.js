const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// Create Express app
const app = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    
    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    if (userDoc.exists) {
      req.user.role = userDoc.data().role;
    }
    
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
    
    // Custom token creation for email/password auth
    // This is a simplified version - you'd typically verify credentials first
    const userRecord = await auth.getUserByEmail(email);
    const customToken = await auth.createCustomToken(userRecord.uid);
    
    res.json({ 
      token: customToken,
      user: {
        uid: userRecord.uid,
        email: userRecord.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({ error: 'Invalid credentials' });
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
    if (req.user.role !== 'admin' && req.user.uid !== managerId) {
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
      query = query.where('managerId', '==', req.user.uid);
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

// Upload routes (Excel processing)
app.post('/uploads/excel', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // This would be expanded to handle actual file upload and processing
    // For now, just acknowledge the upload
    res.json({ 
      message: 'Excel upload received',
      timestamp: new Date().toISOString(),
      status: 'processing'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Bonuses routes
app.get('/bonuses', authenticateToken, async (req, res) => {
  try {
    let query = db.collection('bonuses');
    
    if (req.user.role !== 'admin') {
      query = query.where('managerId', '==', req.user.uid);
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

// Export the Express app as a Firebase Function
exports.api = onRequest({ 
  region: 'europe-west1',
  memory: '1GiB',
  timeoutSeconds: 300 
}, app); 