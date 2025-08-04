import { Request, Response } from "express";
import * as admin from "firebase-admin";

interface RegistrationRequest {
  email: string;
  password: string;
  name: string;
  handle: string;
  type: 'live' | 'team';
  phone?: string;
  address?: string;
}

export async function registerManager(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name, handle, type, phone, address } = req.body as RegistrationRequest;

    // Validate required fields
    if (!email || !password || !name || !handle || !type) {
      res.status(400).json({ error: "Alle Pflichtfelder müssen ausgefüllt werden" });
      return;
    }

    // Validate manager type
    if (!['live', 'team'].includes(type)) {
      res.status(400).json({ error: "Ungültiger Manager-Typ" });
      return;
    }

    // Validate password length
    if (password.length < 6) {
      res.status(400).json({ error: "Passwort muss mindestens 6 Zeichen lang sein" });
      return;
    }

    const db = admin.firestore();

    // Check if handle already exists
    const handleQuery = await db.collection("managers")
      .where("handle", "==", handle)
      .limit(1)
      .get();

    if (!handleQuery.empty) {
      res.status(400).json({ error: "Handle ist bereits vergeben" });
      return;
    }

    // Create Firebase user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    // Generate manager ID
    const managerId = `mgr_${type}_${handle.replace(/\s+/g, "_").toLowerCase()}`;

    // Create manager document in Firestore
    await db.collection("managers").doc(managerId).set({
      id: managerId,
      name,
      handle,
      type,
      email,
      phone: phone || null,
      address: address || null,
      commissionRate: type === 'live' ? 0.3 : 0.35,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active'
    });

    // Create user document with role
    await db.collection("users").doc(userRecord.uid).set({
      email,
      name,
      role: 'manager',
      managerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Set custom claims for the user
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'manager',
      managerId
    });

    // Create audit log
    await db.collection("auditLogs").add({
      userId: 'system',
      action: 'manager_registered',
      targetCollection: 'managers',
      targetId: managerId,
      after: {
        name,
        handle,
        type,
        email
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        userUid: userRecord.uid
      }
    });

    res.status(201).json({
      message: "Manager erfolgreich registriert",
      managerId,
      userUid: userRecord.uid
    });

  } catch (error: any) {
    console.error("Registration error:", error);
    
    // Handle Firebase Auth specific errors
    if (error.code === 'auth/email-already-exists') {
      res.status(400).json({ error: "E-Mail-Adresse ist bereits registriert" });
      return;
    }
    
    if (error.code === 'auth/invalid-email') {
      res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
      return;
    }
    
    if (error.code === 'auth/weak-password') {
      res.status(400).json({ error: "Passwort ist zu schwach" });
      return;
    }

    res.status(500).json({ error: "Registrierung fehlgeschlagen" });
  }
} 