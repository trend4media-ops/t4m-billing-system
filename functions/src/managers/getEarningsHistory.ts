import * as admin from 'firebase-admin';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const db = admin.firestore();

export async function getEarningsHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { managerId } = req.params;
    const monthsParam = Number(req.query.months || 6);
    const months = Math.max(1, Math.min(24, isFinite(monthsParam) ? monthsParam : 6));

    if (!req.user || (req.user.role !== 'ADMIN' && req.user.managerId !== managerId)) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();
    const periods: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const results: Array<{ period: string; earnings: number; baseCommission: number; bonuses: number }> = [];

    for (const period of periods) {
      const earningsDoc = await db.collection('manager-earnings').doc(`${managerId}_${period}`).get();
      const baseCommission = earningsDoc.exists ? (earningsDoc.data()?.baseCommission || 0) : 0;

      const bonusesSnap = await db.collection('bonuses')
        .where('managerId', '==', managerId)
        .where('month', '==', period)
        .get();
      const bonuses = bonusesSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

      results.push({ period, earnings: baseCommission + bonuses, baseCommission, bonuses });
    }

    res.status(200).json(results);
  } catch (e: any) {
    console.error('💥 Error in getEarningsHistory:', e);
    res.status(500).json({ error: 'Failed to load earnings history' });
  }
} 