const admin = require('firebase-admin');

// Function to fix manager IDs
exports.fixManagerIds = async (req, res) => {
  // Only allow admin access
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = admin.firestore();
    
    console.log('🔧 Starting Manager ID Fix...');
    
    // Step 1: Get all existing managers to build a mapping
    console.log('📋 Step 1: Building manager mapping...');
    const managersSnapshot = await db.collection('managers').get();
    const managerMapping = new Map();
    
    managersSnapshot.forEach(doc => {
      const manager = doc.data();
      console.log(`Manager: ${manager.name} (${manager.handle}) -> ID: ${doc.id}`);
      
      // Create mappings for different possible formats
      if (manager.name) {
        const wrongId = `manager_${manager.name.replace(/\s+/g, '_').toLowerCase()}`;
        managerMapping.set(wrongId, doc.id);
      }
      if (manager.handle) {
        const wrongIdFromHandle = `manager_${manager.handle.replace(/\s+/g, '_').toLowerCase()}`;
        managerMapping.set(wrongIdFromHandle, doc.id);
      }
    });
    
    console.log(`✅ Built mapping for ${managerMapping.size} manager ID conversions`);
    
    // Step 2: Get all transactions that need fixing
    console.log('📋 Step 2: Finding transactions to fix...');
    const transactionsSnapshot = await db.collection('transactions')
      .where('period', '==', '202508')
      .get();
    
    console.log(`Found ${transactionsSnapshot.size} transactions to check`);
    
    let fixedCount = 0;
    const batch = db.batch();
    
    // Step 3: Update transactions with correct manager IDs
    transactionsSnapshot.forEach(doc => {
      const transaction = doc.data();
      let needsUpdate = false;
      const updates = {};
      
      // Check and fix liveManagerId
      if (transaction.liveManagerId && managerMapping.has(transaction.liveManagerId)) {
        const correctId = managerMapping.get(transaction.liveManagerId);
        console.log(`🔄 Fixing liveManagerId: ${transaction.liveManagerId} -> ${correctId}`);
        updates.liveManagerId = correctId;
        needsUpdate = true;
      }
      
      // Check and fix teamManagerId
      if (transaction.teamManagerId && managerMapping.has(transaction.teamManagerId)) {
        const correctId = managerMapping.get(transaction.teamManagerId);
        console.log(`🔄 Fixing teamManagerId: ${transaction.teamManagerId} -> ${correctId}`);
        updates.teamManagerId = correctId;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        batch.update(doc.ref, updates);
        fixedCount++;
      }
    });
    
    // Step 4: Commit all changes
    if (fixedCount > 0) {
      console.log(`💾 Committing ${fixedCount} fixes...`);
      await batch.commit();
      console.log('✅ All manager IDs fixed successfully!');
    } else {
      console.log('ℹ️ No manager IDs needed fixing.');
    }
    
    // Step 5: Verify the fix
    console.log('🔍 Verifying fix...');
    const verifySnapshot = await db.collection('transactions')
      .where('period', '==', '202508')
      .limit(5)
      .get();
    
    const sampleTransactions = [];
    verifySnapshot.forEach(doc => {
      const transaction = doc.data();
      sampleTransactions.push({
        id: doc.id,
        liveManagerId: transaction.liveManagerId,
        teamManagerId: transaction.teamManagerId,
        grossAmount: transaction.grossAmount,
        net: transaction.net
      });
    });
    
    res.json({
      success: true,
      message: `Fixed ${fixedCount} records`,
      mappingSize: managerMapping.size,
      totalTransactions: transactionsSnapshot.size,
      sampleTransactions: sampleTransactions
    });
    
  } catch (error) {
    console.error('❌ Error fixing manager IDs:', error);
    res.status(500).json({ 
      error: 'Failed to fix manager IDs', 
      details: error.message 
    });
  }
}; 