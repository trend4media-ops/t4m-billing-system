import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeIban(iban?: string): string | undefined {
  if (!iban) return undefined;
  return iban.replace(/\s+/g, '').toUpperCase();
}

function isPlausibleIban(iban?: string): boolean {
  if (!iban) return false;
  const norm = normalizeIban(iban)!;
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(norm) && norm.length >= 15 && norm.length <= 34;
}

export async function getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const db = admin.firestore();
    const uid = req.user.uid;

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {} as any;

    let managerData: any = null;
    if (req.user.managerId) {
      const m = await db.collection('managers').doc(req.user.managerId).get();
      managerData = m.exists ? m.data() : null;
    }

    res.status(200).json({
      success: true,
      user: {
        uid,
        email: req.user.email || userData?.email,
        role: req.user.role,
        managerId: req.user.managerId || userData?.managerId,
        firstName: req.user.firstName || userData?.firstName || null,
        lastName: req.user.lastName || userData?.lastName || null,
      },
      manager: managerData ? {
        id: req.user.managerId,
        email: managerData.email || null,
        handle: managerData.handle || null,
        name: managerData.name || null,
        bank: managerData.bank || null,
      } : null
    });
  } catch (e:any) {
    console.error('getProfile failed', e);
    res.status(500).json({ error: 'Failed to load profile', details: e.message });
  }
}

export async function changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({ error: 'Invalid new password. Minimum length 8.' });
      return;
    }
    await admin.auth().updateUser(req.user.uid, { password: newPassword });
    res.status(200).json({ success: true, message: 'Password updated' });
  } catch (e:any) {
    console.error('changePassword failed', e);
    res.status(500).json({ error: 'Failed to change password', details: e.message });
  }
}

export async function changeEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const { newEmail } = req.body as { newEmail?: string };
    if (!newEmail || !isValidEmail(newEmail)) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    const db = admin.firestore();
    await admin.auth().updateUser(req.user.uid, { email: newEmail });

    // Mirror in users collection
    await db.collection('users').doc(req.user.uid).set({ email: newEmail, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // If manager, sync managers collection email
    if (req.user.managerId) {
      await db.collection('managers').doc(req.user.managerId).set({ email: newEmail, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    res.status(200).json({ success: true, message: 'Email updated', email: newEmail });
  } catch (e:any) {
    console.error('changeEmail failed', e);
    res.status(500).json({ error: 'Failed to change email', details: e.message });
  }
}

export async function updateBank(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!req.user.managerId) { res.status(400).json({ error: 'Manager context required' }); return; }

    const { iban, bic, holder, bankName, bankDetails } = req.body as {
      iban?: string;
      bic?: string;
      holder?: string;
      bankName?: string;
      bankDetails?: string; // legacy fallback
    };

    const normIban = normalizeIban(iban);
    if (iban && !isPlausibleIban(iban)) {
      res.status(400).json({ error: 'Invalid IBAN format' });
      return;
    }

    const db = admin.firestore();
    const bank: any = {
      ...(holder ? { holder } : {}),
      ...(bankName ? { bankName } : {}),
      ...(normIban ? { iban: normIban } : {}),
      ...(bic ? { bic: bic.trim().toUpperCase() } : {}),
      ...(bankDetails ? { note: bankDetails } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('managers').doc(req.user.managerId).set({ bank }, { merge: true });
    res.status(200).json({ success: true, bank });
  } catch (e:any) {
    console.error('updateBank failed', e);
    res.status(500).json({ error: 'Failed to update bank details', details: e.message });
  }
}

export async function adminUpdateManagerCredentials(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
    const { managerId } = req.params as { managerId: string };
    const { email, password } = req.body as { email?: string; password?: string };

    const db = admin.firestore();

    // Try resolve uid by managerId
    const usersSnap = await db.collection('users').where('managerId', '==', managerId).limit(1).get();
    let uid: string | null = usersSnap.empty ? null : usersSnap.docs[0].id;

    // If missing, create user now
    if (!uid) {
      // Load manager for handle/name context
      const managerDoc = await db.collection('managers').doc(managerId).get();
      const nameOrId = managerDoc.exists ? ((managerDoc.data()?.handle || managerDoc.data()?.name || managerId) as string) : managerId;
      const clean = nameOrId.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const defaultPassword = `manager123`;
      // Decide email: use provided or synthesize
      let emailCandidate = email && isValidEmail(email) ? email : `${clean}@trend4media.com`;
      if (email && !isValidEmail(email)) { res.status(400).json({ error: 'Invalid email' }); return; }

      let created;
      for (let i = 0; i < 5; i++) {
        try {
          created = await admin.auth().createUser({
            email: emailCandidate,
            password: password && password.length >= 8 ? password : defaultPassword,
            displayName: (managerDoc.data()?.name as string) || clean
          });
          break;
        } catch (e: any) {
          if (e && e.code === 'auth/email-already-exists') {
            emailCandidate = `${clean}${i + 1}@manager.com`;
            continue;
          }
          throw e;
        }
      }

      if (!created) { res.status(500).json({ error: 'Failed to create user' }); return; }
      uid = created.uid;
      try { await admin.auth().setCustomUserClaims(uid, { role: 'MANAGER', managerId }); } catch {}
      await db.collection('users').doc(uid).set({
        email: emailCandidate,
        role: 'manager',
        managerId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await db.collection('managers').doc(managerId).set({ email: emailCandidate, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      res.status(201).json({ success: true, created: true, email: emailCandidate });
      return;
    }

    const updateAuth: admin.auth.UpdateRequest = { uid } as any;
    if (email) {
      if (!isValidEmail(email)) { res.status(400).json({ error: 'Invalid email' }); return; }
      (updateAuth as any).email = email;
    }
    if (password) {
      if (typeof password !== 'string' || password.length < 8) { res.status(400).json({ error: 'Password too short' }); return; }
      (updateAuth as any).password = password;
    }

    await admin.auth().updateUser(uid, updateAuth as any);

    // Mirror changes
    const updates: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (email) updates.email = email;
    await db.collection('users').doc(uid).set(updates, { merge: true });
    if (email) await db.collection('managers').doc(managerId).set({ email, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    res.status(200).json({ success: true });
  } catch (e:any) {
    console.error('adminUpdateManagerCredentials failed', e);
    res.status(500).json({ error: 'Failed to update credentials', details: e.message });
  }
}

export async function adminUpdateManagerBank(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
    const { managerId } = req.params as { managerId: string };
    const { iban, bic, holder, bankName, bankDetails } = req.body as {
      iban?: string; bic?: string; holder?: string; bankName?: string; bankDetails?: string;
    };

    const normIban = normalizeIban(iban);
    if (iban && !isPlausibleIban(iban)) {
      res.status(400).json({ error: 'Invalid IBAN format' });
      return;
    }

    const db = admin.firestore();
    const bank: any = {
      ...(holder ? { holder } : {}),
      ...(bankName ? { bankName } : {}),
      ...(normIban ? { iban: normIban } : {}),
      ...(bic ? { bic: bic.trim().toUpperCase() } : {}),
      ...(bankDetails ? { note: bankDetails } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection('managers').doc(managerId).set({ bank }, { merge: true });

    res.status(200).json({ success: true });
  } catch (e:any) {
    console.error('adminUpdateManagerBank failed', e);
    res.status(500).json({ error: 'Failed to update bank details', details: e.message });
  }
}

/**
 * Admin-only: Reset a manager's password to a known temporary value and return it for display
 * - Creates the Auth user if missing
 * - Ensures custom claims and users mirror
 */
export async function adminResetManagerPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.user || req.user.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
    const { managerId } = req.params as { managerId: string };
    const db = admin.firestore();

    const mdoc = await db.collection('managers').doc(managerId).get();
    if (!mdoc.exists) { res.status(404).json({ error: 'Manager not found' }); return; }
    const mdata = mdoc.data() || {} as any;
    const handle = String(mdata.handle || mdata.name || managerId);
    const clean = handle.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const defaultEmail = `${clean}@trend4media.com`;
    const tempPassword = 'manager123';

    // Resolve uid for this manager
    let uid: string | null = null;
    const usersSnap = await db.collection('users').where('managerId','==',managerId).limit(1).get();
    if (!usersSnap.empty) {
      uid = usersSnap.docs[0].id;
    }

    // If no user, create one (with email from manager or default)
    if (!uid) {
      let emailCandidate = (typeof mdata.email === 'string' && /@/.test(mdata.email)) ? mdata.email : defaultEmail;
      let created;
      for (let i = 0; i < 5; i++) {
        try {
          created = await admin.auth().createUser({ email: emailCandidate, password: tempPassword, displayName: mdata.name || clean });
          break;
        } catch (e:any) {
          if (e && e.code === 'auth/email-already-exists') {
            emailCandidate = `${clean}${i + 1}@trend4media.com`;
            continue;
          }
          throw e;
        }
      }
      if (!created) { res.status(500).json({ error: 'Failed to create user' }); return; }
      uid = created.uid;
      try { await admin.auth().setCustomUserClaims(uid, { role: 'MANAGER', managerId }); } catch {}
      await db.collection('users').doc(uid).set({ email: emailCandidate, role: 'manager', managerId, createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('managers').doc(managerId).set({ email: emailCandidate, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      res.status(200).json({ success: true, password: tempPassword, created: true, email: emailCandidate });
      return;
    }

    // Update password for existing uid
    await admin.auth().updateUser(uid, { password: tempPassword });
    res.status(200).json({ success: true, password: tempPassword, created: false });
  } catch (e:any) {
    console.error('adminResetManagerPassword failed', e);
    res.status(500).json({ error: 'Failed to reset password', details: e.message });
  }
} 