import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

interface AvailableEarnings {
  period: string;
  totalEarnings: number; // EUR total used for payout cap
  alreadyRequested: number;
  netAvailable: number;
  pendingPayouts: number;
  approvedPayouts: number;
  paidPayouts: number;
  fx?: { month: string; asOfDate: string; usdToEur: number };
  breakdown?: {
    usdDerivedBasePlusMilestonesUSD: number;
    usdDerivedBasePlusMilestonesEUR: number;
    euroExtrasTotal: number; // EUR (Diamond, Graduation, Recruitment)
    euroDownlineTotal: number; // EUR
    manualAdjustmentsTotal?: number;
  };
  totalUSD?: number; // New: full USD basis before conversion
  totalEUR?: number; // New: converted amount using fx
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

    const db = admin.firestore();

    // Load manager earnings doc for the month
    const earningsDoc = await db.collection('manager-earnings')
      .doc(`${managerId}_${period}`)
      .get();

    const baseCommissionUSD = earningsDoc.exists ? (earningsDoc.data()?.baseCommission || 0) : 0; // USD-based

    // Sum milestones (USD-based) and EUR-native extras/downline from bonuses
    const bonusesSnapshot = await db.collection('bonuses')
      .where('managerId', '==', managerId)
      .where('month', '==', period)
      .get();

    let milestoneS = 0, milestoneN = 0, milestoneO = 0, milestoneP = 0; // USD-based (to convert)
    let diamond = 0, graduation = 0, recruitment = 0; // EUR-native
    let downA = 0, downB = 0, downC = 0; // EUR-native

    bonusesSnapshot.forEach(d => {
      const b = d.data();
      const amount = b.amount || 0;
      switch (b.type) {
        case 'MILESTONE_S': milestoneS += amount; break; // USD-based
        case 'MILESTONE_N': milestoneN += amount; break;
        case 'MILESTONE_O': milestoneO += amount; break;
        case 'MILESTONE_P': milestoneP += amount; break;
        case 'DIAMOND_BONUS': diamond += amount; break; // EUR-native
        case 'GRADUATION_BONUS': graduation += amount; break;
        case 'RECRUITMENT_BONUS': recruitment += amount; break;
        case 'DOWNLINE_LEVEL_A': if (b.baseSource === 'BASE_COMMISSION') downA += amount; break; // Only new-style downline
        case 'DOWNLINE_LEVEL_B': if (b.baseSource === 'BASE_COMMISSION') downB += amount; break;
        case 'DOWNLINE_LEVEL_C': if (b.baseSource === 'BASE_COMMISSION') downC += amount; break;
      }
    });

    const usdDerivedBasePlusMilestonesUSD = baseCommissionUSD + milestoneS + milestoneN + milestoneO + milestoneP;

    // Load locked FX rate for month (6th day)
    const fxRef = db.collection('fxRates').doc(period);
    let fxDoc = await fxRef.get();
    if (!fxDoc.exists) {
      // If not cached yet, obtain via public API and cache (server-side)
      const asOfDate = `${period.slice(0,4)}-${period.slice(4,6)}-06`;
      const url = `https://api.exchangerate.host/${asOfDate}?base=USD&symbols=EUR`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`FX fetch failed for ${asOfDate}`);
      const json = await r.json();
      const usdToEur = json?.rates?.EUR;
      if (typeof usdToEur !== 'number' || !isFinite(usdToEur)) throw new Error('Invalid FX response');
      const toSave = {
        month: period,
        asOfDate,
        usdToEur: Math.round(usdToEur * 1e6) / 1e6,
        source: 'exchangerate.host',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      } as any;
      await fxRef.set(toSave);
      fxDoc = await fxRef.get();
    }

    const fx = fxDoc.data() as any;
    const usdToEur = fx?.usdToEur || 1;

    const usdDerivedBasePlusMilestonesEUR = Math.round(usdDerivedBasePlusMilestonesUSD * usdToEur * 100) / 100;
    const euroExtrasTotal = Math.round((diamond + graduation + recruitment) * 100) / 100;
    const euroDownlineTotal = Math.round((downA + downB + downC) * 100) / 100;

    // Manual admin adjustments for this manager and month (EUR-native)
    const adjustmentsSnap = await db.collection('manualAdjustments')
      .where('managerId','==', managerId)
      .where('month','==', period)
      .get();
    let manualAdjustmentsTotal = 0;
    adjustmentsSnap.forEach(doc => { manualAdjustmentsTotal += (doc.data()?.amount || 0); });

    const totalUSD = Math.round((usdDerivedBasePlusMilestonesUSD + (euroExtrasTotal + euroDownlineTotal + manualAdjustmentsTotal) / usdToEur) * 100) / 100; // reflect complete USD basis for UI if needed
    const dynamicTotalEUR = Math.round((usdDerivedBasePlusMilestonesEUR + euroExtrasTotal + euroDownlineTotal + manualAdjustmentsTotal) * 100) / 100;

    // Already requested (all statuses)
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

    const netAvailable = Math.max(0, dynamicTotalEUR - alreadyRequested);
    
    const availableEarnings: AvailableEarnings = {
      period: period as string,
      totalEarnings: Math.round(dynamicTotalEUR * 100) / 100,
      alreadyRequested: Math.round(alreadyRequested * 100) / 100,
      netAvailable: Math.round(netAvailable * 100) / 100,
      pendingPayouts: Math.round(pendingPayouts * 100) / 100,
      approvedPayouts: Math.round(approvedPayouts * 100) / 100,
      paidPayouts: Math.round(paidPayouts * 100) / 100,
      fx: { month: period, asOfDate: fx?.asOfDate || `${period.slice(0,4)}-${period.slice(4,6)}-06`, usdToEur },
      breakdown: {
        usdDerivedBasePlusMilestonesUSD: Math.round(usdDerivedBasePlusMilestonesUSD * 100) / 100,
        usdDerivedBasePlusMilestonesEUR: Math.round(usdDerivedBasePlusMilestonesEUR * 100) / 100,
        euroExtrasTotal,
        euroDownlineTotal,
        manualAdjustmentsTotal: Math.round(manualAdjustmentsTotal * 100) / 100,
      },
      totalUSD,
      totalEUR: Math.round(dynamicTotalEUR * 100) / 100,
    };
    
    res.json({
      success: true,
      data: availableEarnings
    });
    
  } catch (error) {
    console.error('getAvailableEarnings error:', error);
    res.status(500).json({ error: 'Failed to compute available earnings' });
  }
} 