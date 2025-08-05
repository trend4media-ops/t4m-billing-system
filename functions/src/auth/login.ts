import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { Request, Response } from 'express';

interface TestUserBase {
  password: string;
  role: string;
  firstName: string;
  lastName: string;
  uid: string;
}

interface TestUserWithManagerType extends TestUserBase {
  managerType: string;
}

type TestUser = TestUserBase | TestUserWithManagerType;

const testUsers: TestUser[] = [
  {
    uid: "demo-admin-001",
    password: "admin123",
    role: "ADMIN",
    firstName: "Admin",
    lastName: "User"
  },
  {
    uid: "demo-live-001", 
    password: "live123",
    role: "MANAGER",
    managerType: "LIVE",
    firstName: "Live",
    lastName: "Manager"
  },
  {
    uid: "demo-team-001",
    password: "team123", 
    role: "MANAGER",
    managerType: "TEAM",
    firstName: "Team",
    lastName: "Manager"
  }
];

export const login = functions.region('europe-west1').https.onRequest(async (req: Request, res: Response) => {
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Find test user by email/uid pattern
    const testUser = testUsers.find(user => 
      email.includes(user.uid) || 
      email.startsWith(user.firstName.toLowerCase()) ||
      email === `${user.firstName.toLowerCase()}@trend4media.com`
    );

    if (!testUser || testUser.password !== password) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Create custom claims
    const hasManagerType = 'managerType' in testUser;
    const customClaims: any = {
      role: testUser.role,
      firstName: testUser.firstName,
      lastName: testUser.lastName,
      ...(hasManagerType && { managerType: (testUser as TestUserWithManagerType).managerType }),
    };

    // Create custom token
    const customToken = await admin.auth().createCustomToken(testUser.uid, customClaims);

    // Response with user data
    const response = {
      customToken,
      user: {
        uid: testUser.uid,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        role: testUser.role,
        ...(hasManagerType && { managerType: (testUser as TestUserWithManagerType).managerType })
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}); 