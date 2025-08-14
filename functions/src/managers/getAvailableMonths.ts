import * as admin from 'firebase-admin';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const db = admin.firestore();

export async function getAvailableMonths(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { managerId } = req.params;

    if (!req.user || (req.user.role !== 'ADMIN' && req.user.managerId !== managerId)) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const monthsSet = new Set<string>();

    // From manager-earnings
    const earningsSnap = await db.collection('manager-earnings').where('managerId','==', managerId).get();
    earningsSnap.docs.forEach(d => {
      const m = d.data().month as string | undefined;
      if (m && /^\d{6}$/.test(m)) monthsSet.add(m);
    });

    // Also consider bonuses
    const bonusesSnap = await db.collection('bonuses').where('managerId','==', managerId).get();
    bonusesSnap.docs.forEach(d => {
      const m = d.data().month as string | undefined;
      if (m && /^\d{6}$/.test(m)) monthsSet.add(m);
    });

    const months = Array.from(monthsSet).sort((a,b) => b.localeCompare(a)).slice(0, 24);

    res.status(200).json({ success: true, months });
  } catch (e:any) {
    console.error('💥 Error in getAvailableMonths:', e);
    res.status(500).json({ error: 'Failed to load months' });
  }
} 