const admin = require('firebase-admin');

// Initialize Firebase Admin (will use existing credentials from environment)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function fixManagerIds() {
  console.log('🔧 Starting Manager ID Fix...');
  
  try {
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
    
    // Step 4: Fix bonuses as well
    console.log('📋 Step 3: Finding bonuses to fix...');
    const bonusesSnapshot = await db.collection('bonuses')
      .where('period', '==', '202508')
      .get();
    
    console.log(`Found ${bonusesSnapshot.size} bonuses to check`);
    
    bonusesSnapshot.forEach(doc => {
      const bonus = doc.data();
      let needsUpdate = false;
      const updates = {};
      
      // Check and fix managerId in bonuses
      if (bonus.managerId && managerMapping.has(bonus.managerId)) {
        const correctId = managerMapping.get(bonus.managerId);
        console.log(`🔄 Fixing bonus managerId: ${bonus.managerId} -> ${correctId}`);
        updates.managerId = correctId;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        batch.update(doc.ref, updates);
        fixedCount++;
      }
    });
    
    // Step 5: Commit all changes
    if (fixedCount > 0) {
      console.log(`💾 Committing ${fixedCount} fixes...`);
      await batch.commit();
      console.log('✅ All manager IDs fixed successfully!');
    } else {
      console.log('ℹ️ No manager IDs needed fixing.');
    }
    
    // Step 6: Verify the fix
    console.log('🔍 Verifying fix...');
    const verifySnapshot = await db.collection('transactions')
      .where('period', '==', '202508')
      .limit(5)
      .get();
    
    verifySnapshot.forEach(doc => {
      const transaction = doc.data();
      console.log(`Verified transaction: Live: ${transaction.liveManagerId}, Team: ${transaction.teamManagerId}`);
    });
    
  } catch (error) {
    console.error('❌ Error fixing manager IDs:', error);
  }
}

// Run the fix
fixManagerIds().then(() => {
  console.log('🎉 Manager ID fix completed!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Fix failed:', error);
  process.exit(1);
}); 