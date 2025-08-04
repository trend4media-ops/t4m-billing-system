import { Request, Response, NextFunction } from "express";
import * as jwt from "jsonwebtoken";

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

// JWT Secret - should match the one in login.ts
const JWT_SECRET = 'trend4media_secret_key_2024_secure';

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

    const token = authHeader.substring(7);
    console.log('🔍 Verifying JWT token...');

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    console.log('✅ Token verified:', decoded);

    req.user = {
      uid: decoded.uid,
      role: decoded.role || 'user',
      email: decoded.email,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
      managerId: decoded.managerId
    };

    console.log('✅ User set in request:', req.user);
    next();
  } catch (error) {
    console.error("💥 Auth error:", error);
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Invalid token" });
    } else if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
    } else {
      res.status(401).json({ error: "Authentication failed" });
    }
  }
} 