const admin = require("firebase-admin");
const db = admin.firestore();

// COMPREHENSIVE DATA PERSISTENCE SYSTEM
// Ensures all uploaded data is stored and accessible across modules

// Save upload batch with complete metadata
async function saveUploadBatch(batchData) {
  try {
    const batchRef = db.collection('uploadBatches').doc(batchData.id);
    const enrichedBatch = {
      ...batchData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'COMPLETED',
      isActive: true, // Mark as active for recent files display
      lastAccessed: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await batchRef.set(enrichedBatch);
    console.log(`✅ Upload batch saved: ${batchData.id}`);
    return enrichedBatch;
  } catch (error) {
    console.error('❌ Error saving upload batch:', error);
    throw error;
  }
}

// Get recent upload batches for display
async function getRecentUploads(limit = 10) {
  try {
    const snapshot = await db.collection('uploadBatches')
      .where('isActive', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    const batches = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      batches.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        lastAccessed: data.lastAccessed?.toDate?.()?.toISOString() || data.lastAccessed
      });
    });
    
    console.log(`📊 Retrieved ${batches.length} recent uploads`);
    return batches;
  } catch (error) {
    console.error('❌ Error fetching recent uploads:', error);
    return [];
  }
}

// Save processed transaction data
async function saveTransactionData(transactionData) {
  try {
    const transactionRef = db.collection('transactions').doc(transactionData.id);
    const enrichedTransaction = {
      ...transactionData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true
    };
    
    await transactionRef.set(enrichedTransaction);
    return enrichedTransaction;
  } catch (error) {
    console.error('❌ Error saving transaction:', error);
    throw error;
  }
}

// Save manager commission data  
async function saveManagerCommission(commissionData) {
  try {
    const commissionRef = db.collection('bonuses').doc();
    const enrichedCommission = {
      id: commissionRef.id,
      ...commissionData,
      calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true
    };
    
    await commissionRef.set(enrichedCommission);
    return enrichedCommission;
  } catch (error) {
    console.error('❌ Error saving commission:', error);
    throw error;
  }
}

// Get manager earnings data with comprehensive details
async function getManagerEarnings(managerId, period) {
  try {
    console.log(`🔍 Fetching earnings for manager: ${managerId}, period: ${period}`);
    
    // Get manager details
    const managerDoc = await db.collection('managers').doc(managerId).get();
    if (!managerDoc.exists) {
      throw new Error('Manager not found');
    }
    
    const manager = { id: managerDoc.id, ...managerDoc.data() };
    
    // Get transactions for this manager and period
    const transactionsQuery = db.collection('transactions')
      .where('isActive', '==', true);
    
    // Add period filter if provided
    if (period) {
      transactionsQuery.where('period', '==', period);
    }
    
    // Add manager filter
    const liveTransactionsSnapshot = await transactionsQuery
      .where('liveManagerId', '==', managerId)
      .get();
      
    const teamTransactionsSnapshot = await transactionsQuery
      .where('teamManagerId', '==', managerId)
      .get();
    
    const transactions = [];
    liveTransactionsSnapshot.forEach(doc => {
      transactions.push({ id: doc.id, ...doc.data(), managerRole: 'LIVE' });
    });
    teamTransactionsSnapshot.forEach(doc => {
      transactions.push({ id: doc.id, ...doc.data(), managerRole: 'TEAM' });
    });
    
    // Get bonuses for this manager and period
    const bonusesQuery = db.collection('bonuses')
      .where('managerId', '==', managerId)
      .where('isActive', '==', true);
      
    if (period) {
      bonusesQuery.where('period', '==', period);
    }
    
    const bonusesSnapshot = await bonusesQuery.get();
    const bonuses = [];
    bonusesSnapshot.forEach(doc => {
      bonuses.push({ id: doc.id, ...doc.data() });
    });
    
    // Calculate comprehensive earnings
    const grossAmount = transactions.reduce((sum, tx) => sum + (tx.grossAmount || 0), 0);
    const deductions = transactions.reduce((sum, tx) => sum + (tx.bonusSum || 0), 0);
    const netForCommission = transactions.reduce((sum, tx) => sum + (tx.net || 0), 0);
    
    const baseCommission = bonuses
      .filter(b => b.type === 'BASE_COMMISSION')
      .reduce((sum, b) => sum + (b.amount || 0), 0);
    
    const milestoneBonuses = {
      S: bonuses.filter(b => b.type === 'MILESTONE_S').reduce((sum, b) => sum + (b.amount || 0), 0),
      N: bonuses.filter(b => b.type === 'MILESTONE_N').reduce((sum, b) => sum + (b.amount || 0), 0),
      O: bonuses.filter(b => b.type === 'MILESTONE_O').reduce((sum, b) => sum + (b.amount || 0), 0),
      P: bonuses.filter(b => b.type === 'MILESTONE_P').reduce((sum, b) => sum + (b.amount || 0), 0)
    };
    
    const recruitmentBonus = bonuses
      .filter(b => b.type === 'RECRUITMENT_BONUS')
      .reduce((sum, b) => sum + (b.amount || 0), 0);
    
    const diamondBonus = bonuses
      .filter(b => b.type === 'DIAMOND_BONUS')
      .reduce((sum, b) => sum + (b.amount || 0), 0);
    
    const totalPayout = baseCommission + 
      milestoneBonuses.S + milestoneBonuses.N + milestoneBonuses.O + milestoneBonuses.P +
      recruitmentBonus + diamondBonus;
    
    const earningsData = {
      managerId: manager.id,
      managerHandle: manager.handle,
      managerName: manager.name,
      managerType: manager.type,
      period: period,
      grossAmount,
      deductions,
      netForCommission,
      baseCommission,
      milestoneBonuses,
      recruitmentBonus,
      diamondBonus,
      totalPayout,
      transactionCount: transactions.length,
      bonusCount: bonuses.length,
      transactions: transactions.slice(0, 50), // Limit for performance
      bonuses: bonuses
    };
    
    console.log(`✅ Manager earnings calculated: €${totalPayout.toFixed(2)} total payout`);
    return earningsData;
    
  } catch (error) {
    console.error('❌ Error fetching manager earnings:', error);
    throw error;
  }
}

// Get all managers with earnings summary
async function getAllManagersEarnings(period) {
  try {
    console.log(`📊 Fetching all managers earnings for period: ${period || 'all periods'}`);
    
    // Get all managers
    const managersSnapshot = await db.collection('managers').get();
    const earningsData = [];
    
    for (const managerDoc of managersSnapshot.docs) {
      const manager = { id: managerDoc.id, ...managerDoc.data() };
      
      try {
        const managerEarnings = await getManagerEarnings(manager.id, period);
        if (managerEarnings.totalPayout > 0) { // Only include managers with earnings
          earningsData.push(managerEarnings);
        }
      } catch (error) {
        console.error(`❌ Error fetching earnings for manager ${manager.id}:`, error);
      }
    }
    
    console.log(`✅ Retrieved earnings for ${earningsData.length} managers`);
    return earningsData;
    
  } catch (error) {
    console.error('❌ Error fetching all managers earnings:', error);
    throw error;
  }
}

// Get transactions with filtering
async function getTransactions(filters = {}) {
  try {
    let query = db.collection('transactions').where('isActive', '==', true);
    
    if (filters.managerId) {
      // Check both live and team manager fields
      const liveTransactions = await query.where('liveManagerId', '==', filters.managerId).get();
      const teamTransactions = await query.where('teamManagerId', '==', filters.managerId).get();
      
      const transactions = [];
      liveTransactions.forEach(doc => {
        transactions.push({ id: doc.id, ...doc.data(), managerRole: 'LIVE' });
      });
      teamTransactions.forEach(doc => {
        transactions.push({ id: doc.id, ...doc.data(), managerRole: 'TEAM' });
      });
      
      return transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    
    if (filters.period) {
      query = query.where('period', '==', filters.period);
    }
    
    if (filters.batchId) {
      query = query.where('batchId', '==', filters.batchId);
    }
    
    const snapshot = await query.orderBy('createdAt', 'desc').limit(100).get();
    const transactions = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt
      });
    });
    
    console.log(`📊 Retrieved ${transactions.length} transactions`);
    return transactions;
    
  } catch (error) {
    console.error('❌ Error fetching transactions:', error);
    throw error;
  }
}

// Get bonuses with filtering
async function getBonuses(filters = {}) {
  try {
    let query = db.collection('bonuses').where('isActive', '==', true);
    
    if (filters.managerId) {
      query = query.where('managerId', '==', filters.managerId);
    }
    
    if (filters.period) {
      query = query.where('period', '==', filters.period);
    }
    
    if (filters.type) {
      query = query.where('type', '==', filters.type);
    }
    
    const snapshot = await query.orderBy('calculatedAt', 'desc').limit(100).get();
    const bonuses = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      bonuses.push({
        id: doc.id,
        ...data,
        calculatedAt: data.calculatedAt?.toDate?.()?.toISOString() || data.calculatedAt
      });
    });
    
    console.log(`💰 Retrieved ${bonuses.length} bonuses`);
    return bonuses;
    
  } catch (error) {
    console.error('❌ Error fetching bonuses:', error);
    throw error;
  }
}

// Update last accessed time for upload batch
async function updateBatchLastAccessed(batchId) {
  try {
    await db.collection('uploadBatches').doc(batchId).update({
      lastAccessed: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('❌ Error updating last accessed:', error);
  }
}

module.exports = {
  saveUploadBatch,
  getRecentUploads,
  saveTransactionData,
  saveManagerCommission,
  getManagerEarnings,
  getAllManagersEarnings,
  getTransactions,
  getBonuses,
  updateBatchLastAccessed
}; 