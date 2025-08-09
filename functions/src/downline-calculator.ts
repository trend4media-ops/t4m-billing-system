
import * as admin from 'firebase-admin';
import { onSchedule, ScheduledEvent } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';

// Firebase Admin SDK is initialized in the root index.js
const db = admin.firestore();

const DOWNLINE_COMMISSION_RATES = {
  A: 0.10,
  B: 0.075,
  C: 0.05,
};

/**
 * Scheduled function to be run monthly to calculate downline commissions
 * for all managers.
 */
export const calculateDownlineCommissions = onSchedule('0 2 1 * *', async (event: ScheduledEvent) => {
  const period = getPreviousMonthPeriod();
  console.log(`Starting downline commission calculation for period: ${period}`);

  await calculateDownlineForPeriod(period);

  console.log(`Successfully completed downline commission calculation for period: ${period}`);
});

export const calculateDownlineForPeriodHttp = onRequest(async (req, res) => {
  try {
    const period = (req.query.period as string) || getPreviousMonthPeriod();
    await calculateDownlineForPeriod(period);
    res.status(200).json({ success: true, period });
  } catch (e:any) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export async function calculateDownlineForPeriod(period: string): Promise<void> {
  console.log(`Calculating downline for period ${period}`);

  // 0) Cleanup existing downline bonuses for this period to avoid stale values from older genealogy versions
  // Delete any bonuses with type DOWNLINE_LEVEL_A/B/C for the given month
  const toDeleteSnap = await db.collection('bonuses')
    .where('month', '==', period)
    .where('type', 'in', ['DOWNLINE_LEVEL_A', 'DOWNLINE_LEVEL_B', 'DOWNLINE_LEVEL_C'])
    .get();
  if (!toDeleteSnap.empty) {
    console.log(`Deleting ${toDeleteSnap.size} existing downline bonus docs for period ${period} before recalculation`);
    const CHUNK = 450;
    for (let i = 0; i < toDeleteSnap.docs.length; i += CHUNK) {
      const chunk = toDeleteSnap.docs.slice(i, i + CHUNK);
      const b = db.batch();
      chunk.forEach(d => b.delete(d.ref));
      await b.commit();
    }
  }

  const managersSnapshot = await db.collection('managers').get();
  if (managersSnapshot.empty) return;

  // We'll batch writes in chunks to stay under Firestore limits
  let pendingBatch = db.batch();
  let batchOps = 0;
  let bonusCount = 0;

  for (const managerDoc of managersSnapshot.docs) {
    const managerId = managerDoc.id;
    const managerHandle = (managerDoc.data().name || managerDoc.data().handle || managerId) as string;

    // Get direct downline (Level A/B/C assignments)
    const downlineSnapshot = await db.collection('genealogy').where('teamManagerId', '==', managerId).get();
    if (downlineSnapshot.empty) continue;

    for (const downlineDoc of downlineSnapshot.docs) {
      const downline = downlineDoc.data();
      const downlineManagerId = downline.liveManagerId as string;
      const level = downline.level as 'A'|'B'|'C';
      if (!downlineManagerId || !level) continue;

      // Aggregate Base Commission (from net) for this downline manager for the given period
      const downlineTransactions = await db.collection('transactions')
        .where('managerId', '==', downlineManagerId)
        .where('month', '==', period)
        .get();
      let downlineBase = 0;
      downlineTransactions.forEach(txDoc => {
        downlineBase += (txDoc.data().baseCommission || 0);
      });
      if (downlineBase <= 0) continue;

      const rate = DOWNLINE_COMMISSION_RATES[level];
      const commission = downlineBase * rate;

      // Deterministic document id to ensure idempotency per (period, teamManager, liveManager, level)
      const bonusId = `downline_${period}_${managerId}_${downlineManagerId}_${level}`;
      const bonusRef = db.collection('bonuses').doc(bonusId);

      pendingBatch.set(bonusRef, {
        managerId: managerId,
        managerHandle: managerHandle,
        type: `DOWNLINE_LEVEL_${level}`,
        amount: commission,
        month: period,
        batchId: `downline_calc_${period}`,
        relatedManagerId: downlineManagerId,
        relatedManagerHandle: downline.liveManagerHandle,
        baseSource: 'BASE_COMMISSION',
        baseAmount: downlineBase,
        calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: 'downline-calculator',
      });
      bonusCount++;
      batchOps++;

      if (batchOps >= 450) {
        await pendingBatch.commit();
        pendingBatch = db.batch();
        batchOps = 0;
      }
    }
  }

  if (batchOps > 0) {
    await pendingBatch.commit();
  }

  console.log(`Downline calculation for ${period} completed. Created ${bonusCount} bonus entries.`);
}

function getPreviousMonthPeriod(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}${month}`;
} 