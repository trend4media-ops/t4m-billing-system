import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface PerformanceMetrics {
  currentMonthRank: number;
  totalManagers: number;
  growthPercentage: number;
  avgMonthlyEarnings: number;
  bestMonth: {
    period: string;
    earnings: number;
  };
  achievementBadges: string[];
  last6Months: Array<{
    period: string;
    earnings: number;
  }>;
  team?: {
    levelA: number;
    levelB: number;
    levelC: number;
    totalDownline: number;
    directCount: number;
  };
}

export async function getManagerPerformance(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { managerId } = req.params;
    const periodParam = (req.query.period as string) || undefined;
    
    // Verify authorization
    if (req.user?.role !== 'admin' && req.user?.managerId !== managerId) {
      res.status(403).json({ error: 'Unauthorized access' });
      return;
    }

    // Target months
    const now = new Date();
    const currentMonth = periodParam || now.toISOString().slice(0, 7).replace('-', '');
    const months: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Fetch last 6 months bonuses sums
    const earningsPromises = months.map(async (month) => {
      const bonusesSnapshot = await db.collection('bonuses')
        .where('managerId', '==', managerId)
        .where('month', '==', month)
        .get();
      const total = bonusesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
      const earningsDoc = await db.collection('manager-earnings').doc(`${managerId}_${month}`).get();
      const base = earningsDoc.exists ? (earningsDoc.data()?.baseCommission || 0) : 0;
      const combined = total + base;
      return { period: month, earnings: combined };
    });

    const last6Months = (await Promise.all(earningsPromises)).reverse();
    const currentMonthEarnings = last6Months[last6Months.length - 1]?.earnings || 0;
    const previousMonthEarnings = last6Months[last6Months.length - 2]?.earnings || 0;
    const growthPercentage = previousMonthEarnings > 0 
      ? ((currentMonthEarnings - previousMonthEarnings) / previousMonthEarnings) * 100 
      : 0;

    const totalEarnings = last6Months.reduce((s, m) => s + m.earnings, 0);
    const avgMonthlyEarnings = totalEarnings / Math.max(1, last6Months.length);
    const bestMonth = last6Months.reduce((best, cur) => cur.earnings > best.earnings ? cur : best, { period: '', earnings: 0 });

    // Rank among all managers for current month
    const allBonusesSnap = await db.collection('bonuses').where('month', '==', currentMonth).get();
    const managerSum = new Map<string, number>();
    for (const doc of allBonusesSnap.docs) {
      const d = doc.data();
      managerSum.set(d.managerId, (managerSum.get(d.managerId) || 0) + (d.amount || 0));
    }
    // add base commissions from manager-earnings
    const earningsSnap = await db.collection('manager-earnings').where('month', '==', currentMonth).get();
    for (const doc of earningsSnap.docs) {
      const d = doc.data();
      managerSum.set(d.managerId, (managerSum.get(d.managerId) || 0) + (d.baseCommission || 0));
    }
    const sorted = Array.from(managerSum.entries()).sort((a,b) => b[1] - a[1]);
    const currentMonthRank = (sorted.findIndex(([id]) => id === managerId) + 1) || 0;

    // Team/Downline KPIs
    const directDownlineSnap = await db.collection('genealogy').where('teamManagerId', '==', managerId).get();
    const directIds = directDownlineSnap.docs.map(d => d.data().liveManagerId).filter(Boolean) as string[];

    let levelASum = 0, levelBSum = 0, levelCSum = 0;
    const downlineBonusesSnap = await db.collection('bonuses').where('month', '==', currentMonth).get();
    downlineBonusesSnap.forEach(doc => {
      const b = doc.data();
      if (b.managerId === managerId) {
        if (b.type === 'DOWNLINE_LEVEL_A') levelASum += b.amount || 0;
        if (b.type === 'DOWNLINE_LEVEL_B') levelBSum += b.amount || 0;
        if (b.type === 'DOWNLINE_LEVEL_C') levelCSum += b.amount || 0;
      }
    });

    const metrics: PerformanceMetrics = {
      currentMonthRank,
      totalManagers: sorted.length,
      growthPercentage,
      avgMonthlyEarnings,
      bestMonth,
      achievementBadges: [],
      last6Months,
      team: {
        levelA: levelASum,
        levelB: levelBSum,
        levelC: levelCSum,
        totalDownline: levelASum + levelBSum + levelCSum,
        directCount: directIds.length
      }
    };

    res.json({ success: true, data: metrics });
  } catch (error) {
    console.error('Error fetching performance metrics:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch performance metrics' });
  }
} 