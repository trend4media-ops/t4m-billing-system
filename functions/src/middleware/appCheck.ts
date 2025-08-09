import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';

export function appCheckMiddleware(required: boolean = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const headerNameCandidates = [
        'x-firebase-appcheck',
        'x-firebase-app-check',
        'x-firebase-appcheck-token',
      ];
      let token: string | undefined;
      for (const h of headerNameCandidates) {
        const v = req.headers[h] as string | undefined;
        if (v) { token = v; break; }
      }

      if (!token) {
        if (required) {
          res.status(401).json({ error: 'App Check token required' });
          return;
        }
        return next();
      }

      await admin.appCheck().verifyToken(token);
      return next();
    } catch (e) {
      if (required) {
        res.status(401).json({ error: 'Invalid App Check token' });
        return;
      }
      return next();
    }
  };
} 