
import * as admin from 'firebase-admin';
import { onSchedule, ScheduledEvent } from 'firebase-functions/v2/scheduler';

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

    try {
      const managersSnapshot = await db.collection('managers').get();
      if (managersSnapshot.empty) {
        console.log("No managers found. Exiting.");
        return Promise.resolve();
      }

      const batch = db.batch();
      let bonusCount = 0;

      for (const managerDoc of managersSnapshot.docs) {
        const managerId = managerDoc.id;
        const managerHandle = managerDoc.data().name || managerDoc.data().handle || managerId;

        // Get direct downline (Level A)
        const downlineSnapshot = await db.collection('genealogy').where('teamManagerId', '==', managerId).get();
        if (downlineSnapshot.empty) {
          continue;
        }

        let totalDownlineCommission = 0;

        for (const downlineDoc of downlineSnapshot.docs) {
          const downline = downlineDoc.data();
          const downlineManagerId = downline.liveManagerId;
          const level = downline.level; // 'A', 'B', or 'C'

          if (!downlineManagerId || !level) continue;

          // Calculate the net total for the downline manager for the period
          const downlineTransactions = await db.collection('transactions').where('managerId', '==', downlineManagerId).where('month', '==', period).get();
          let downlineNet = 0;
          downlineTransactions.forEach(txDoc => {
            downlineNet += txDoc.data().netForCommission || 0;
          });

          if (downlineNet > 0) {
            const rate = DOWNLINE_COMMISSION_RATES[level as keyof typeof DOWNLINE_COMMISSION_RATES];
            if (rate) {
              const commission = downlineNet * rate;
              totalDownlineCommission += commission;

              // Create a specific bonus document for this downline relationship
              const bonusRef = db.collection('bonuses').doc();
              batch.set(bonusRef, {
                managerId: managerId,
                managerHandle: managerHandle,
                type: `DOWNLINE_LEVEL_${level}`,
                amount: commission,
                month: period,
                batchId: `downline_calc_${period}`,
                relatedManagerId: downlineManagerId,
                relatedManagerHandle: downline.liveManagerHandle,
                calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'downline-calculator-function',
              });
              bonusCount++;
            }
          }
        }
      }

      if (bonusCount > 0) {
        await batch.commit();
        console.log(`Successfully created ${bonusCount} downline commission bonuses for period: ${period}`);
      } else {
        console.log(`No downline commissions to create for period: ${period}`);
      }

    } catch (error) {
        console.error("Error calculating downline commissions:", error);
        return;
    }

    console.log(`Successfully completed downline commission calculation for period: ${period}`);
  });

function getPreviousMonthPeriod(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}${month}`;
} 