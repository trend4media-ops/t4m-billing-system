import { Request, Response } from "express";
import * as admin from "firebase-admin";

// Definitive test users with clear credentials
const TEST_USERS = {
  'admin@trend4media.com': {
    password: 'admin123',
    role: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    uid: 'admin_user_001'
  },
  'live@trend4media.com': {
    password: 'live123', 
    role: 'manager',
    firstName: 'Live',
    lastName: 'Manager',
    uid: 'live_manager_001'
  },
  'team@trend4media.com': {
    password: 'team123',
    role: 'manager', 
    firstName: 'Team',
    lastName: 'Manager',
    uid: 'team_manager_001'
  },
  'test@trend4media.com': {
    password: 'test123',
    role: 'manager',
    firstName: 'Test',
    lastName: 'User',
    uid: 'test_user_001'
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

    // Set custom claims for the user
    await admin.auth().setCustomUserClaims(testUser.uid, { role: testUser.role });

    // Create a Firebase Custom Token
    const customToken = await admin.auth().createCustomToken(testUser.uid);

    const userData = {
      id: testUser.uid,
      email: normalizedEmail,
      firstName: testUser.firstName,
      lastName: testUser.lastName,
      role: testUser.role
    };

    res.json({ 
      customToken: customToken, 
      user: userData, 
      message: "Login erfolgreich" 
    });

  } catch (error) {
    console.error("💥 LOGIN ERROR:", error);
    res.status(500).json({ 
      error: "Interner Serverfehler",
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 