const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp();
const auth = admin.auth();
const db = admin.firestore();

async function createTestUsers() {
  console.log('🔥 Creating Firebase Auth users...');
  
  try {
    // Create Admin user
    const adminUser = await auth.createUser({
      uid: 'admin-user-001',
      email: 'admin@trend4media.com',
      password: 'admin123',
      displayName: 'Admin User'
    });
    console.log('✅ Admin user created:', adminUser.uid);
    
    // Add admin to Firestore
    await db.collection('users').doc(adminUser.uid).set({
      email: 'admin@trend4media.com',
      role: 'admin',
      firstName: 'Admin',
      lastName: 'User',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Create Live Manager user
    const liveManager = await auth.createUser({
      uid: 'live-manager-001',
      email: 'live@trend4media.com',
      password: 'manager123',
      displayName: 'Live Manager'
    });
    console.log('✅ Live Manager created:', liveManager.uid);
    
    // Add live manager to Firestore
    await db.collection('users').doc(liveManager.uid).set({
      email: 'live@trend4media.com',
      role: 'manager',
      firstName: 'Live',
      lastName: 'Manager',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Create Team Manager user
    const teamManager = await auth.createUser({
      uid: 'team-manager-001',
      email: 'team@trend4media.com',
      password: 'manager123',
      displayName: 'Team Manager'
    });
    console.log('✅ Team Manager created:', teamManager.uid);
    
    // Add team manager to Firestore
    await db.collection('users').doc(teamManager.uid).set({
      email: 'team@trend4media.com',
      role: 'manager',
      firstName: 'Team',
      lastName: 'Manager',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('🎉 All test users created successfully!');
    console.log('');
    console.log('📋 Login credentials:');
    console.log('   Admin: admin@trend4media.com / admin123');
    console.log('   Live Manager: live@trend4media.com / manager123');
    console.log('   Team Manager: team@trend4media.com / manager123');
    
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      console.log('ℹ️  Users already exist - that\'s OK!');
    } else {
      console.error('❌ Error creating users:', error);
    }
  }
  
  process.exit(0);
}

createTestUsers(); 