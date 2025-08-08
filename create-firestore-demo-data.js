// Script to create demo data in Firestore for testing the real-time integration
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./trend4media-billing-firebase-adminsdk-5zhtr-c49e8a9d3e.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'trend4media-billing'
});

const db = admin.firestore();

async function createDemoData() {
  console.log('🚀 Creating demo data in Firestore...');
  
  const currentMonth = '202508';
  const batch = db.batch();
  
  try {
    // 1. Create Dashboard Updates
    console.log('📊 Creating dashboard updates...');
    const dashboardUpdates = [
      {
        type: 'BATCH_PROCESSED',
        batchId: 'demo_batch_001',
        month: currentMonth,
        results: {
          processedRows: 1250,
          totalRows: 1250,
          managersProcessed: 12,
          totalRevenue: 45750.50,
          totalCommissions: 13725.15,
          totalBonuses: 2287.53
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      },
      {
        type: 'EXCEL_UPLOADED',
        batchId: 'demo_batch_002',
        month: currentMonth,
        results: {
          fileName: 'T4M_Excel_202508.xlsx',
          fileSize: 2048576,
          status: 'COMPLETED'
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      },
      {
        type: 'COMMISSION_CALCULATED',
        batchId: 'demo_batch_001',
        month: currentMonth,
        results: {
          managersProcessed: 12,
          totalRevenue: 45750.50,
          averageCommissionRate: 0.30
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      }
    ];
    
    for (const update of dashboardUpdates) {
      const updateRef = db.collection('dashboard-updates').doc();
      batch.set(updateRef, update);
    }
    
    // 2. Create Upload Batches
    console.log('📁 Creating upload batches...');
    const uploadBatches = [
      {
        fileName: 'T4M_Excel_202508_001.xlsx',
        month: currentMonth,
        status: 'COMPLETED',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processedRows: 1250,
        totalRows: 1250,
        managersProcessed: 12,
        totalRevenue: 45750.50
      },
      {
        fileName: 'T4M_Excel_202507_002.xlsx', 
        month: '202507',
        status: 'COMPLETED',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processedRows: 980,
        totalRows: 980,
        managersProcessed: 10,
        totalRevenue: 32450.25
      },
      {
        fileName: 'T4M_Excel_202508_003.xlsx',
        month: currentMonth,
        status: 'PROCESSING',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processedRows: 850,
        totalRows: 1100,
        managersProcessed: 8,
        totalRevenue: 28675.75
      }
    ];
    
    uploadBatches.forEach((batchData, index) => {
      const batchRef = db.collection('uploadBatches').doc(`demo_batch_00${index + 1}`);
      batch.set(batchRef, batchData);
    });
    
    // 3. Create Batch Summaries
    console.log('📋 Creating batch summaries...');
    const batchSummaries = [
      {
        processedRows: 1250,
        totalRows: 1250,
        managersProcessed: 12,
        totalRevenue: 45750.50,
        totalCommissions: 13725.15,
        totalBonuses: 2287.53,
        collections: {
          transactions: 1250,
          bonuses: 24,
          managerEarnings: 12,
          processedManagers: 12
        }
      },
      {
        processedRows: 980,
        totalRows: 980,
        managersProcessed: 10,
        totalRevenue: 32450.25,
        totalCommissions: 9735.08,
        totalBonuses: 1622.51,
        collections: {
          transactions: 980,
          bonuses: 20,
          managerEarnings: 10,
          processedManagers: 10
        }
      },
      {
        processedRows: 850,
        totalRows: 1100,
        managersProcessed: 8,
        totalRevenue: 28675.75,
        totalCommissions: 8602.73,
        totalBonuses: 1433.79,
        collections: {
          transactions: 850,
          bonuses: 16,
          managerEarnings: 8,
          processedManagers: 8
        }
      }
    ];
    
    batchSummaries.forEach((summaryData, index) => {
      const summaryRef = db.collection('batch-summaries').doc(`demo_batch_00${index + 1}`);
      batch.set(summaryRef, summaryData);
    });
    
    // 4. Create Manager Earnings
    console.log('💰 Creating manager earnings...');
    const managers = [
      { id: 'demo_mgr_001', handle: 'alice_live', type: 'LIVE', name: 'Alice Schmidt' },
      { id: 'demo_mgr_002', handle: 'bob_team', type: 'TEAM', name: 'Bob Müller' },
      { id: 'demo_mgr_003', handle: 'carol_live', type: 'LIVE', name: 'Carol Weber' },
      { id: 'demo_mgr_004', handle: 'david_team', type: 'TEAM', name: 'David Fischer' },
      { id: 'demo_mgr_005', handle: 'eva_live', type: 'LIVE', name: 'Eva Bauer' },
      { id: 'demo_mgr_006', handle: 'frank_team', type: 'TEAM', name: 'Frank Klein' },
      { id: 'demo_mgr_007', handle: 'greta_live', type: 'LIVE', name: 'Greta Wolf' },
      { id: 'demo_mgr_008', handle: 'hans_team', type: 'TEAM', name: 'Hans Becker' },
      { id: 'demo_mgr_009', handle: 'iris_live', type: 'LIVE', name: 'Iris Schulz' },
      { id: 'demo_mgr_010', handle: 'jens_team', type: 'TEAM', name: 'Jens Wagner' },
      { id: 'demo_mgr_011', handle: 'kira_live', type: 'LIVE', name: 'Kira Hoffmann' },
      { id: 'demo_mgr_012', handle: 'lars_team', type: 'TEAM', name: 'Lars Richter' }
    ];
    
    // Create manager documents
    managers.forEach(manager => {
      const managerRef = db.collection('managers').doc(manager.id);
      batch.set(managerRef, {
        handle: manager.handle,
        name: manager.name,
        type: manager.type,
        email: `${manager.handle}@trend4media.com`,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    
    // Create earnings for each manager
    managers.forEach(manager => {
      const isLive = manager.type === 'LIVE';
      const baseCommission = isLive ? (1500 + Math.random() * 800) : (800 + Math.random() * 600);
      const totalGross = baseCommission / 0.30; // Assuming 30% commission rate
      const totalNet = totalGross * 0.85; // Assuming 15% taxes/fees
      const bonuses = baseCommission * (0.15 + Math.random() * 0.10); // 15-25% bonuses
      const totalEarnings = baseCommission + bonuses;
      
      const earningsRef = db.collection('manager-earnings').doc(`${manager.id}_${currentMonth}`);
      batch.set(earningsRef, {
        managerId: manager.id,
        month: currentMonth,
        batchId: 'demo_batch_001',
        baseCommission: Math.round(baseCommission * 100) / 100,
        totalGross: Math.round(totalGross * 100) / 100,
        totalNet: Math.round(totalNet * 100) / 100,
        bonuses: Math.round(bonuses * 100) / 100,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        transactionCount: Math.floor(Math.random() * (isLive ? 150 : 100) + (isLive ? 50 : 30)),
        creatorCount: Math.floor(Math.random() * (isLive ? 30 : 20) + (isLive ? 10 : 5)),
        downlineEarnings: isLive ? 0 : Math.round((Math.random() * 500) * 100) / 100,
        managerType: manager.type.toLowerCase(),
        status: 'CALCULATED',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    
    // 5. Create Bonuses
    console.log('🎁 Creating bonuses...');
    const bonusTypes = ['MILESTONE_S', 'MILESTONE_N', 'MILESTONE_O', 'MILESTONE_P', 'DIAMOND_BONUS', 'RECRUITMENT_BONUS'];
    
    managers.forEach(manager => {
      // Create 2-3 bonuses per manager
      const bonusCount = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < bonusCount; i++) {
        const bonusRef = db.collection('bonuses').doc(`${manager.id}_${currentMonth}_${i}`);
        batch.set(bonusRef, {
          managerId: manager.id,
          month: currentMonth,
          batchId: 'demo_batch_001',
          type: bonusTypes[Math.floor(Math.random() * bonusTypes.length)],
          amount: Math.round((50 + Math.random() * 400) * 100) / 100,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });
    
    // Commit all changes
    console.log('💾 Committing batch write...');
    await batch.commit();
    
    console.log('✅ Demo data creation complete!');
    console.log(`📊 Created data for month: ${currentMonth}`);
    console.log(`👥 Created ${managers.length} managers with earnings`);
    console.log(`📁 Created ${uploadBatches.length} upload batches`);
    console.log(`🎁 Created bonuses for all managers`);
    console.log(`🔄 Created ${dashboardUpdates.length} dashboard updates`);
    
  } catch (error) {
    console.error('💥 Error creating demo data:', error);
  }
}

// Run the script
createDemoData().then(() => {
  console.log('🎯 Demo data script completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
}); 