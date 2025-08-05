import { Request, Response } from "express";
import * as admin from "firebase-admin";

// Definitive test users with clear credentials
const TEST_USERS = {
  'admin@trend4media.com': {
    password: 'admin123',
    role: 'ADMIN', // Uppercase for consistency
    firstName: 'Admin',
    lastName: 'User',
    uid: 'admin-user-001'
  },
  'live@trend4media.com': {
    password: 'live123', 
    role: 'MANAGER',
    managerType: 'LIVE',
    firstName: 'Live',
    lastName: 'Manager',
    uid: 'live-manager-001'
  },
  'team@trend4media.com': {
    password: 'team123',
    role: 'MANAGER',
    managerType: 'TEAM', 
    firstName: 'Team',
    lastName: 'Manager',
    uid: 'team-manager-001'
  },
  'test@trend4media.com': {
    password: 'test123',
    role: 'MANAGER',
    firstName: 'Test',
    lastName: 'User',
    uid: 'test-user-001'
  }
};

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email und Passwort sind erforderlich" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();
    const testUser = TEST_USERS[normalizedEmail as keyof typeof TEST_USERS];

    if (!testUser || testUser.password !== password) {
      res.status(401).json({ error: "Ungültige Anmeldedaten" });
      return;
    }

    // Set comprehensive custom claims
    const customClaims = {
      role: testUser.role,
      firstName: testUser.firstName,
      lastName: testUser.lastName,
      ...((testUser as any).managerType && { managerType: (testUser as any).managerType }),
      ...(testUser.role === 'MANAGER' && { managerId: testUser.uid })
    };

    try {
      // First ensure user exists in Firebase Auth
      // let userRecord;
      try {
        // userRecord = await admin.auth().getUser(testUser.uid);
      } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
          // Create user if not exists
          // userRecord = await admin.auth().createUser({
          //   uid: testUser.uid,
          //   email: normalizedEmail,
          //   password: testUser.password,
          //   displayName: `${testUser.firstName} ${testUser.lastName}`
          // });
          console.log(`✅ Created missing user: ${testUser.uid}`);
        } else {
          throw error;
        }
      }

      // Set custom claims for the user
      await admin.auth().setCustomUserClaims(testUser.uid, customClaims);
      console.log(`✅ Set custom claims for ${testUser.uid}:`, customClaims);

      // Create a Firebase Custom Token with additional claims
      const customToken = await admin.auth().createCustomToken(testUser.uid, customClaims);

      const response = {
        uid: testUser.uid,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        role: testUser.role,
        ...(('managerType' in testUser) && testUser.managerType && { managerType: (testUser as any).managerType }),
      };

      res.json({ 
        customToken: customToken, 
        user: response, 
        message: "Login erfolgreich",
        claims: customClaims // Debug info
      });

    } catch (authError) {
      console.error("💥 Firebase Auth Error:", authError);
      res.status(500).json({ error: "Authentication setup failed" });
    }

  } catch (error) {
    console.error("💥 LOGIN ERROR:", error);
    res.status(500).json({ error: "Interner Server-Fehler" });
  }
} 