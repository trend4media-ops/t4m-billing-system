import { Response } from 'express';
import * as admin from 'firebase-admin';
import { AuthenticatedRequest } from '../middleware/auth';

const db = admin.firestore();

interface AvailableEarnings {
  period: string;
  totalEarnings: number;
  alreadyRequested: number;
  netAvailable: number;
  pendingPayouts: number;
  approvedPayouts: number;
  paidPayouts: number;
}

export async function getAvailableEarnings(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { period } = req.query;
    const managerId = req.user?.managerId || req.user?.uid;
    
    if (!managerId) {
      res.status(400).json({ error: 'Manager ID not found' });
      return;
    }
    
    if (!period || typeof period !== 'string') {
      res.status(400).json({ error: 'Period is required' });
      return;
    }

    // 1) Load base commission for the month (may be 0 before Excel processing)
    const earningsDoc = await db.collection('manager-earnings')
      .doc(`${managerId}_${period}`)
      .get();
    const baseCommission = earningsDoc.exists ? (earningsDoc.data()?.baseCommission || 0) : 0;

    // 2) Sum all bonuses for that month (milestones, diamond, recruitment, downline ...)
    const bonusesSnapshot = await db.collection('bonuses')
      .where('managerId', '==', managerId)
      .where('month', '==', period)
      .get();
    const bonusesSum = bonusesSnapshot.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);

    const dynamicTotal = Math.round((baseCommission + bonusesSum) * 100) / 100;

    // 3) Sum already requested for the month (all statuses)
    const existingRequestsSnapshot = await db
      .collection('payoutRequests')
      .where('managerId', '==', managerId)
      .where('period', '==', period)
      .get();

    let alreadyRequested = 0;
    let pendingPayouts = 0;
    let approvedPayouts = 0;
    let paidPayouts = 0;
    
    existingRequestsSnapshot.forEach(doc => {
      const data = doc.data();
      const amount = data.amount || data.requestedAmount || 0;
      alreadyRequested += amount;
      switch (data.status) {
        case 'SUBMITTED':
          pendingPayouts += amount; break;
        case 'APPROVED':
        case 'IN_PROGRESS':
          approvedPayouts += amount; break;
        case 'PAID':
          paidPayouts += amount; break;
      }
    });

    const netAvailable = Math.max(0, dynamicTotal - alreadyRequested);
    
    const availableEarnings: AvailableEarnings = {
      period: period as string,
      totalEarnings: Math.round(dynamicTotal * 100) / 100,
      alreadyRequested: Math.round(alreadyRequested * 100) / 100,
      netAvailable: Math.round(netAvailable * 100) / 100,
      pendingPayouts: Math.round(pendingPayouts * 100) / 100,
      approvedPayouts: Math.round(approvedPayouts * 100) / 100,
      paidPayouts: Math.round(paidPayouts * 100) / 100
    };
    
    res.json({
      success: true,
      data: availableEarnings
    });
    
  } catch (error) {
    console.error('getAvailableEarnings error:', error);
    res.status(500).json({ error: 'Failed to fetch available earnings' });
  }
} 