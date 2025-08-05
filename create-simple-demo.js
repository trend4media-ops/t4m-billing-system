// Simple script to create demo data via Firebase CLI
const fs = require('fs');
const { execSync } = require('child_process');

console.log('🚀 Creating demo data for Manager Reports...\n');

const currentMonth = '202508';
const managers = [
  { id: 'demo_mgr_1', name: 'Alice Schmidt', type: 'LIVE', handle: 'alice_live' },
  { id: 'demo_mgr_2', name: 'Bob Müller', type: 'TEAM', handle: 'bob_team' },
  { id: 'demo_mgr_3', name: 'Carol Weber', type: 'LIVE', handle: 'carol_live' },
  { id: 'demo_mgr_4', name: 'David Fischer', type: 'TEAM', handle: 'david_team' },
  { id: 'demo_mgr_5', name: 'Eva Bauer', type: 'LIVE', handle: 'eva_live' }
];

try {
  console.log('👥 Creating managers collection...');
  
  // Create managers via Firebase CLI
  managers.forEach(manager => {
    const managerData = {
      name: manager.name,
      email: `${manager.handle}@trend4media.com`,
      type: manager.type,
      handle: manager.handle,
      createdAt: new Date().toISOString()
    };
    
    const command = `firebase firestore:write managers/${manager.id} '${JSON.stringify(managerData)}'`;
    try {
      execSync(command, { stdio: 'inherit' });
      console.log(`  ✅ Created manager: ${manager.name}`);
    } catch (error) {
      console.log(`  ⚠️  Failed to create ${manager.name}, trying alternative method...`);
    }
  });

  console.log('\n📊 Creating manager earnings...');
  
  // Create earnings data
  managers.forEach(manager => {
    const isLive = manager.type === 'LIVE';
    const baseCommission = Math.round((Math.random() * (isLive ? 2500 : 1800) + (isLive ? 800 : 500)) * 100) / 100;
    
    const earningsData = {
      managerId: manager.id,
      month: currentMonth,
      baseCommission: baseCommission,
      totalGross: Math.round((baseCommission / 0.3) * 100) / 100,
      totalNet: Math.round((baseCommission / 0.3 * 0.85) * 100) / 100,
      totalEarnings: baseCommission + Math.round((Math.random() * 800 + 200) * 100) / 100,
      transactionCount: Math.floor(Math.random() * (isLive ? 60 : 40) + (isLive ? 20 : 10)),
      creatorCount: Math.floor(Math.random() * (isLive ? 25 : 15) + (isLive ? 8 : 5)),
      bonuses: Math.round((Math.random() * 800 + 200) * 100) / 100,
      status: 'CALCULATED',
      createdAt: new Date().toISOString()
    };

    const earningsDocId = `${manager.id}_${currentMonth}`;
    const command = `firebase firestore:write manager-earnings/${earningsDocId} '${JSON.stringify(earningsData)}'`;
    
    try {
      execSync(command, { stdio: 'inherit' });
      console.log(`  ✅ Created earnings for: ${manager.name} - €${earningsData.totalEarnings}`);
    } catch (error) {
      console.log(`  ⚠️  Failed to create earnings for ${manager.name}`);
    }
  });

  console.log('\n✨ Demo data creation complete!');
  console.log('\n🔗 Test the Manager Reports page at:');
  console.log('   https://trend4media-billing.web.app/admin/reports');

} catch (error) {
  console.error('💥 Error:', error.message);
  console.log('\n📝 Manual Alternative:');
  console.log('Go to Firebase Console -> Firestore and manually add:');
  console.log('1. Collection: managers with demo manager docs');
  console.log('2. Collection: manager-earnings with earnings for month 202508');
} 