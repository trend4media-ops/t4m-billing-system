import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    role: string;
    managerId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    [key: string]: any;
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    console.log('=== AUTH MIDDLEWARE ===');
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log('❌ No Bearer token provided');
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const idToken = authHeader.substring(7);
    console.log('🔍 Verifying Firebase ID token...');

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log('✅ Firebase token verified for UID:', decodedToken.uid);

    // Get custom claims
    const userRecord = await admin.auth().getUser(decodedToken.uid);
    const customClaims = userRecord.customClaims || {};
    
    console.log('📋 User claims:', customClaims);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: customClaims.role || 'MANAGER',
      managerId: customClaims.managerId,
      firstName: customClaims.firstName || '',
      lastName: customClaims.lastName || '',
      ...customClaims
    };

    console.log('✅ User authenticated:', {
      uid: req.user.uid,
      email: req.user.email,
      role: req.user.role,
      managerId: req.user.managerId
    });
    
    next();
  } catch (error: any) {
    console.error("💥 Auth error:", error);
    
    if (error.code === 'auth/id-token-expired') {
      res.status(401).json({ error: "Token expired" });
    } else if (error.code === 'auth/id-token-revoked') {
      res.status(401).json({ error: "Token revoked" });
    } else if (error.code === 'auth/argument-error') {
      res.status(401).json({ error: "Invalid token format" });
    } else {
      res.status(401).json({ error: "Authentication failed" });
    }
  }
} 