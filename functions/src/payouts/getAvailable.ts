import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import * as admin from 'firebase-admin';

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

    // Get total earnings for the period from manager-earnings collection
    const earningsDoc = await db.collection('manager-earnings')
      .doc(`${managerId}_${period}`)
      .get();
      
    let totalEarnings = 0;
    if (earningsDoc.exists) {
      const earningsData = earningsDoc.data();
      totalEarnings = earningsData?.totalEarnings || 0;
    }
    
    // Get existing payout requests for this period
    const payoutRequestsSnapshot = await db.collection('payoutRequests')
      .where('managerId', '==', managerId)
      .where('period', '==', period)
      .get();
      
    let alreadyRequested = 0;
    let pendingPayouts = 0;
    let approvedPayouts = 0;
    let paidPayouts = 0;
    
    payoutRequestsSnapshot.forEach(doc => {
      const data = doc.data();
      const amount = data.amount || 0;
      alreadyRequested += amount;
      
      switch (data.status) {
        case 'SUBMITTED':
          pendingPayouts += amount;
          break;
        case 'APPROVED':
        case 'IN_PROGRESS':
          approvedPayouts += amount;
          break;
        case 'PAID':
          paidPayouts += amount;
          break;
      }
    });
    
    const netAvailable = Math.max(0, totalEarnings - alreadyRequested);
    
    const availableEarnings: AvailableEarnings = {
      period,
      totalEarnings,
      alreadyRequested,
      netAvailable,
      pendingPayouts,
      approvedPayouts,
      paidPayouts
    };
    
    res.json({
      success: true,
      data: availableEarnings
    });
    
  } catch (error) {
    console.error('Error fetching available earnings:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch available earnings' 
    });
  }
} 