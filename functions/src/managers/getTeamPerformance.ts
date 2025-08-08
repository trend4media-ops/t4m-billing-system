import * as admin from 'firebase-admin';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

const db = admin.firestore();

export async function getTeamPerformance(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { managerId } = req.params;
    const monthParam = (req.query.month as string) || undefined;

    if (!managerId) {
      res.status(400).json({ error: 'managerId required' });
      return;
    }

    if (!req.user || (req.user.role !== 'ADMIN' && req.user.managerId !== managerId)) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date();
    const month = monthParam || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get Level A downline (directs)
    const genealogySnap = await db.collection('genealogy').where('teamManagerId', '==', managerId).get();
    const directs = genealogySnap.docs.map(d => ({ id: d.data().liveManagerId as string, handle: d.data().liveManagerHandle as string }))
      .filter(d => !!d.id);

    const members: any[] = [];
    let totals = { baseCommission: 0, bonuses: 0, totalEarnings: 0, totalNet: 0 };

    for (const m of directs) {
      const earningsDoc = await db.collection('manager-earnings').doc(`${m.id}_${month}`).get();
      const data = earningsDoc.exists ? earningsDoc.data()! : {} as any;
      const managerDoc = await db.collection('managers').doc(m.id).get();
      const managerData = managerDoc.exists ? managerDoc.data()! : {} as any;
      const item = {
        managerId: m.id,
        managerHandle: managerData.handle || managerData.name || m.handle || m.id,
        baseCommission: data.baseCommission || 0,
        bonuses: data.bonuses || 0,
        totalEarnings: (data.baseCommission || 0) + (data.bonuses || 0),
        totalNet: data.totalNet || 0,
        creatorCount: data.creatorCount || 0,
      };
      members.push(item);
      totals.baseCommission += item.baseCommission;
      totals.bonuses += item.bonuses;
      totals.totalEarnings += item.totalEarnings;
      totals.totalNet += item.totalNet;
    }

    members.sort((a, b) => b.totalEarnings - a.totalEarnings);

    res.status(200).json({ success: true, month, count: members.length, totals, members });
  } catch (error) {
    console.error('💥 Error fetching team performance:', error);
    res.status(500).json({ error: 'Failed to fetch team performance' });
  }
} 