const admin = require('firebase-admin');

// Initialize Firebase Admin with the service account from the functions directory
const serviceAccount = require('./functions/service-account-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'trend4media-billing'
});

const db = admin.firestore();

async function createDemoData() {
  console.log('🚀 Creating demo data for manager reports...\n');

  const currentMonth = '202508'; // August 2025
  
  try {
    // Create demo managers first
    const managers = [
      { id: 'demo_mgr_1', name: 'Alice Schmidt', email: 'alice@trend4media.com', type: 'LIVE', handle: 'alice_live' },
      { id: 'demo_mgr_2', name: 'Bob Müller', email: 'bob@trend4media.com', type: 'TEAM', handle: 'bob_team' },
      { id: 'demo_mgr_3', name: 'Carol Weber', email: 'carol@trend4media.com', type: 'LIVE', handle: 'carol_live' },
      { id: 'demo_mgr_4', name: 'David Fischer', email: 'david@trend4media.com', type: 'TEAM', handle: 'david_team' },
      { id: 'demo_mgr_5', name: 'Eva Bauer', email: 'eva@trend4media.com', type: 'LIVE', handle: 'eva_live' }
    ];

    console.log('👥 Creating demo managers...');
    for (const manager of managers) {
      await db.collection('managers').doc(manager.id).set({
        name: manager.name,
        email: manager.email,
        type: manager.type,
        handle: manager.handle,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`  ✅ Created manager: ${manager.name}`);
    }

    console.log('\n📊 Creating manager earnings...');
    for (const manager of managers) {
      const earningsDocId = `${manager.id}_${currentMonth}`;
      
      // Realistic demo data based on manager type
      const isLive = manager.type === 'LIVE';
      const baseCommission = Math.round((Math.random() * (isLive ? 2500 : 1800) + (isLive ? 800 : 500)) * 100) / 100;
      const totalGross = Math.round((baseCommission / 0.3) * 100) / 100; // Assuming 30% commission rate
      
      const earningsData = {
        managerId: manager.id,
        month: currentMonth,
        baseCommission: baseCommission,
        totalGross: totalGross,
        totalNet: Math.round((totalGross * 0.85) * 100) / 100, // 85% after deductions
        totalEarnings: baseCommission + Math.round((Math.random() * 800 + 200) * 100) / 100, // base + bonuses
        transactionCount: Math.floor(Math.random() * (isLive ? 60 : 40) + (isLive ? 20 : 10)),
        creatorCount: Math.floor(Math.random() * (isLive ? 25 : 15) + (isLive ? 8 : 5)),
        bonuses: Math.round((Math.random() * 800 + 200) * 100) / 100,
        status: 'CALCULATED',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.collection('manager-earnings').doc(earningsDocId).set(earningsData);
      console.log(`  ✅ Created earnings for: ${manager.name} - €${earningsData.totalEarnings}`);

      // Create demo bonuses
      const bonusTypes = [
        { type: 'MILESTONE_S', amount: Math.round((Math.random() * 300 + 100) * 100) / 100 },
        { type: 'MILESTONE_N', amount: Math.round((Math.random() * 400 + 150) * 100) / 100 },
        { type: 'DIAMOND_BONUS', amount: Math.round((Math.random() * 500 + 200) * 100) / 100 },
        { type: 'RECRUITMENT_BONUS', amount: Math.round((Math.random() * 250 + 50) * 100) / 100 }
      ];

      // Randomly assign 2-3 bonuses per manager
      const numBonuses = Math.floor(Math.random() * 2) + 2;
      for (let i = 0; i < numBonuses; i++) {
        const bonus = bonusTypes[Math.floor(Math.random() * bonusTypes.length)];
        const bonusDocId = `${manager.id}_${currentMonth}_${bonus.type}_${i}`;
        
        await db.collection('bonuses').doc(bonusDocId).set({
          managerId: manager.id,
          month: currentMonth,
          type: bonus.type,
          amount: bonus.amount,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    console.log('\n✨ Demo data creation complete!');
    console.log('\n📋 Summary:');
    console.log(`  - ${managers.length} managers created`);
    console.log(`  - ${managers.length} earnings records for ${currentMonth}`);
    console.log(`  - Multiple bonus records created`);
    console.log('\n🔗 Test the Manager Reports page at:');
    console.log('   https://trend4media-billing.web.app/admin/reports');

  } catch (error) {
    console.error('💥 Error creating demo data:', error);
  }
}

// Check if service account file exists
const fs = require('fs');
if (!fs.existsSync('./functions/service-account-key.json')) {
  console.log('⚠️  service-account-key.json not found in functions directory.');
  console.log('   You can still test the API with the deployed functions.');
  console.log('   Check the Manager Reports page at: https://trend4media-billing.web.app/admin/reports');
  process.exit(0);
}

createDemoData().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
}); 