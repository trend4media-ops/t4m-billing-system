const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function checkDatabaseStatus() {
  console.log('🔍 Checking database status...\n');

  try {
    // Check manager-earnings
    const earningsSnapshot = await db.collection('manager-earnings').limit(5).get();
    console.log(`📊 Manager-earnings documents: ${earningsSnapshot.size}`);
    if (earningsSnapshot.size > 0) {
      earningsSnapshot.forEach(doc => {
        console.log(`  - ${doc.id}: ${JSON.stringify(doc.data(), null, 2)}`);
      });
    }

    // Check managers
    const managersSnapshot = await db.collection('managers').limit(5).get();
    console.log(`\n👥 Managers documents: ${managersSnapshot.size}`);
    if (managersSnapshot.size > 0) {
      managersSnapshot.forEach(doc => {
        console.log(`  - ${doc.id}: ${doc.data().name || doc.data().email}`);
      });
    }

    // Check transactions
    const transactionsSnapshot = await db.collection('transactions').limit(5).get();
    console.log(`\n💰 Transactions documents: ${transactionsSnapshot.size}`);

    // Check bonuses
    const bonusesSnapshot = await db.collection('bonuses').limit(5).get();
    console.log(`\n🎁 Bonuses documents: ${bonusesSnapshot.size}`);

    // If no data exists, create demo data
    if (earningsSnapshot.size === 0 && managersSnapshot.size > 0) {
      console.log('\n🚀 Creating demo manager-earnings data...');
      await createDemoEarningsData();
    }

  } catch (error) {
    console.error('💥 Error checking database:', error);
  }
}

async function createDemoEarningsData() {
  const currentMonth = '202508'; // August 2025
  
  // Get existing managers
  const managersSnapshot = await db.collection('managers').limit(10).get();
  
  if (managersSnapshot.size === 0) {
    console.log('⚠️  No managers found. Creating demo managers first...');
    await createDemoManagers();
  }

  const managers = [];
  managersSnapshot.forEach(doc => {
    managers.push({ id: doc.id, ...doc.data() });
  });

  console.log(`📝 Creating earnings for ${managers.length} managers...`);

  const batch = db.batch();
  
  for (let i = 0; i < Math.min(managers.length, 5); i++) {
    const manager = managers[i];
    const earningsDocId = `${manager.id}_${currentMonth}`;
    
    // Demo earnings data
    const earningsData = {
      managerId: manager.id,
      month: currentMonth,
      baseCommission: Math.round((Math.random() * 2000 + 500) * 100) / 100,
      totalGross: Math.round((Math.random() * 10000 + 2000) * 100) / 100,
      totalNet: Math.round((Math.random() * 8000 + 1500) * 100) / 100,
      totalEarnings: Math.round((Math.random() * 3000 + 800) * 100) / 100,
      transactionCount: Math.floor(Math.random() * 50 + 10),
      creatorCount: Math.floor(Math.random() * 20 + 5),
      bonuses: Math.round((Math.random() * 1000 + 200) * 100) / 100,
      status: 'CALCULATED',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    batch.set(db.collection('manager-earnings').doc(earningsDocId), earningsData);

    // Create some demo bonuses
    const bonusTypes = ['MILESTONE_S', 'MILESTONE_N', 'DIAMOND_BONUS', 'RECRUITMENT_BONUS'];
    for (let j = 0; j < 2; j++) {
      const bonusDocId = `${manager.id}_${currentMonth}_${j}`;
      const bonusData = {
        managerId: manager.id,
        month: currentMonth,
        type: bonusTypes[Math.floor(Math.random() * bonusTypes.length)],
        amount: Math.round((Math.random() * 500 + 100) * 100) / 100,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      batch.set(db.collection('bonuses').doc(bonusDocId), bonusData);
    }
  }

  await batch.commit();
  console.log('✅ Demo earnings data created!');
}

async function createDemoManagers() {
  console.log('👥 Creating demo managers...');
  
  const managers = [
    { name: 'Alice Manager', email: 'alice@example.com', type: 'LIVE', handle: 'alice_mgr' },
    { name: 'Bob Manager', email: 'bob@example.com', type: 'TEAM', handle: 'bob_mgr' },
    { name: 'Carol Manager', email: 'carol@example.com', type: 'LIVE', handle: 'carol_mgr' },
    { name: 'David Manager', email: 'david@example.com', type: 'TEAM', handle: 'david_mgr' },
    { name: 'Eve Manager', email: 'eve@example.com', type: 'LIVE', handle: 'eve_mgr' }
  ];

  const batch = db.batch();
  
  managers.forEach((manager, index) => {
    const docId = `demo_manager_${index + 1}`;
    batch.set(db.collection('managers').doc(docId), {
      ...manager,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  console.log('✅ Demo managers created!');
}

// Run the check
checkDatabaseStatus().then(() => {
  console.log('\n✨ Database check complete!');
  process.exit(0);
}).catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
}); 