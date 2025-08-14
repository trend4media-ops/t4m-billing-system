const admin = require('firebase-admin');

// Initialize Firebase Admin using application default credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'trend4media-billing',
  });
}

const db = admin.firestore();
const auth = admin.auth();

function cleanHandle(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

async function ensureUserForManager(managerId, nameOrHandle, existingEmail) {
  const base = cleanHandle(nameOrHandle || managerId);
  let finalEmail = existingEmail && /@/.test(existingEmail) ? existingEmail : `${base}@trend4media.com`;
  const defaultPassword = `manager123`;

  // Try to find existing user by managerId link
  const usersSnap = await db.collection('users').where('managerId', '==', managerId).limit(1).get();
  if (!usersSnap.empty) {
    const uid = usersSnap.docs[0].id;
    // Mirror email if changed
    const userData = usersSnap.docs[0].data();
    if (finalEmail && userData.email !== finalEmail) {
      try { await auth.updateUser(uid, { email: finalEmail }); } catch {}
      await db.collection('users').doc(uid).set({ email: finalEmail, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    // Ensure claims
    try { await auth.setCustomUserClaims(uid, { role: 'MANAGER', managerId }); } catch {}
    return { uid, email: finalEmail, created: false };
  }

  // Create or attach to existing email
  let userRecord = null;
  let emailCandidate = finalEmail;
  for (let i = 0; i < 5; i++) {
    try {
      userRecord = await auth.createUser({ email: emailCandidate, password: defaultPassword, displayName: nameOrHandle || base });
      finalEmail = emailCandidate;
      break;
    } catch (e) {
      if (e && e.code === 'auth/email-already-exists') {
        // If this is the first attempt with provided email, try to fetch and reuse
        try {
          const existing = await auth.getUserByEmail(emailCandidate);
          userRecord = existing;
          finalEmail = emailCandidate;
          break;
        } catch {
          emailCandidate = `${base}${i + 1}@trend4media.com`;
          continue;
        }
      }
      throw e;
    }
  }

  if (!userRecord) throw new Error(`Failed to create or find user for ${managerId}`);

  // Set claims and mirror to users collection
  try { await auth.setCustomUserClaims(userRecord.uid, { role: 'MANAGER', managerId }); } catch {}
  await db.collection('users').doc(userRecord.uid).set({
    email: finalEmail,
    role: 'manager',
    managerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { uid: userRecord.uid, email: finalEmail, created: true };
}

async function run() {
  console.log('🔧 Backfilling manager accounts...');
  const managersSnap = await db.collection('managers').get();
  let updatedManagers = 0;
  let createdUsers = 0;
  let linkedUsers = 0;

  for (const doc of managersSnap.docs) {
    const managerId = doc.id;
    const data = doc.data() || {};
    const nameOrHandle = data.handle || data.name || managerId;
    const base = cleanHandle(nameOrHandle);
    const desiredEmail = data.email && /@/.test(data.email) ? data.email : `${base}@trend4media.com`;

    // Ensure Auth user + users doc
    const result = await ensureUserForManager(managerId, nameOrHandle, desiredEmail);
    if (result.created) createdUsers++;
    else linkedUsers++;

    // Persist email back on manager doc if missing or different
    if (!data.email || data.email !== result.email) {
      await db.collection('managers').doc(managerId).set({
        email: result.email,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      updatedManagers++;
    }

    console.log(`✔ ${nameOrHandle} (${managerId}) → ${result.email}${result.created ? ' [created]' : ''}`);
  }

  console.log('\n✅ Done.');
  console.log(`Managers updated: ${updatedManagers}`);
  console.log(`Auth users created: ${createdUsers}`);
  console.log(`Auth users linked/updated: ${linkedUsers}`);
}

run().then(() => process.exit(0)).catch(err => { console.error('💥 Backfill failed:', err); process.exit(1); }); 