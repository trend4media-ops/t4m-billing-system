import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

interface ManagerData {
  id: string;
  name?: string;
  handle?: string;
  type?: string;
  [key: string]: any;
}

export async function getManagerEarnings(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const { managerId } = req.params;
    // Accept both 'month' and 'period' for compatibility
    const period = (req.query.month as string) || (req.query.period as string) || undefined;

    // Access control
    if (req.user?.role === "manager" && req.user.managerId !== managerId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const db = admin.firestore();

    // Get manager details
    const managerDoc = await db.collection("managers").doc(managerId).get();
    if (!managerDoc.exists) {
      res.status(404).json({ error: "Manager not found" });
      return;
    }
    const manager: ManagerData = { id: managerDoc.id, ...managerDoc.data() };

    // Get earnings from manager-earnings collection if period is specified
    let gross = 0,
      bonusSum = 0,
      net = 0,
      txCount = 0,
      baseCommission = 0;
    let creatorCount = 0;
    const creatorsAgg: Record<string, { creatorId: string; creatorHandle: string; gross: number; net: number; base: number; count: number }> = {};

    if (period) {
      const earningsDoc = await db.collection("manager-earnings").doc(`${managerId}_${period}`).get();
      if (earningsDoc.exists) {
        const earningsData = earningsDoc.data();
        gross = earningsData?.totalGross || 0;
        net = earningsData?.totalNet || 0;
        baseCommission = earningsData?.baseCommission || 0;
        txCount = earningsData?.transactionCount || 0;
        bonusSum = earningsData?.bonuses || 0;
        creatorCount = earningsData?.creatorCount || 0;
      }
      // If creatorCount missing, compute from transactions for the month
      if (!creatorCount) {
        const q = await db.collection('transactions').where('managerId','==', managerId).where('month','==', period).get();
        const set = new Set<string>();
        q.forEach(d => {
          const t: any = d.data();
          set.add(t.creatorId || 'unknown');
          if ((req.query.includeCreators === '1' || req.query.includeCreators === 'true')) {
            const cid = t.creatorId || 'unknown';
            const ch = t.creatorHandle || 'unknown';
            const cur = creatorsAgg[cid] || { creatorId: cid, creatorHandle: ch, gross: 0, net: 0, base: 0, count: 0 };
            cur.gross += t.grossAmount || 0;
            cur.net += t.netForCommission || 0;
            cur.base += t.baseCommission || 0;
            cur.count += 1;
            creatorsAgg[cid] = cur;
          }
        });
        creatorCount = set.size;
      }
    } else {
      // If no period specified, aggregate all transactions
      const transactionsQuery = db.collection("transactions").where("managerId", "==", managerId);
      const transactionsSnap = await transactionsQuery.get();
      
      transactionsSnap.forEach((doc) => {
        const d = doc.data();
        gross += d.grossAmount || 0;
        net += d.netForCommission || 0;
        baseCommission += d.baseCommission || 0;
        txCount += 1;
      });
    }

    // Bonuses aggregation by type
    let bonusQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("bonuses")
      .where("managerId", "==", managerId);
    if (period) {
      bonusQuery = bonusQuery.where("month", "==", period);
    }
    const bonusSnap = await bonusQuery.get();
    const milestoneInternal = {
      halfMilestone: 0, // S
      milestone1: 0,    // N
      milestone2: 0,    // O
      retention: 0      // P
    };
    let graduationBonus = 0;
    let diamondBonus = 0;
    let recruitmentBonus = 0;
    const downlineIncome = {
      levelA: 0,
      levelB: 0,
      levelC: 0
    };

    bonusSnap.forEach((doc) => {
      const b = doc.data();
      const amount = b.amount || 0;

      switch (b.type) {
        case "BASE_COMMISSION":
          baseCommission += amount;
          break;
        case "MILESTONE_S":
          milestoneInternal.halfMilestone += amount;
          break;
        case "MILESTONE_N":
          milestoneInternal.milestone1 += amount;
          break;
        case "MILESTONE_O":
          milestoneInternal.milestone2 += amount;
          break;
        case "MILESTONE_P":
          milestoneInternal.retention += amount;
          break;
        case "GRADUATION_BONUS":
          graduationBonus += amount;
          break;
        case "DIAMOND_BONUS":
          diamondBonus += amount;
          break;
        case "RECRUITMENT_BONUS":
          recruitmentBonus += amount;
          break;
        case "DOWNLINE_LEVEL_A":
          if (b.baseSource === 'BASE_COMMISSION') downlineIncome.levelA += amount;
          break;
        case "DOWNLINE_LEVEL_B":
          if (b.baseSource === 'BASE_COMMISSION') downlineIncome.levelB += amount;
          break;
        case "DOWNLINE_LEVEL_C":
          if (b.baseSource === 'BASE_COMMISSION') downlineIncome.levelC += amount;
          break;
      }
    });

    // Align milestone bonuses with frontend schema { S, N, O, P }
    const milestoneBonuses = {
      S: milestoneInternal.halfMilestone,
      N: milestoneInternal.milestone1,
      O: milestoneInternal.milestone2,
      P: milestoneInternal.retention,
    };

    const totalBonus = 
      milestoneBonuses.S + 
      milestoneBonuses.N + 
      milestoneBonuses.O + 
      milestoneBonuses.P + 
      graduationBonus + 
      diamondBonus + 
      recruitmentBonus +
      downlineIncome.levelA + 
      downlineIncome.levelB + 
      downlineIncome.levelC;

    const totalEarnings = baseCommission + totalBonus;

    console.log(`💰 Manager ${manager.handle || manager.name} earnings: €${totalEarnings.toFixed(2)} (${txCount} transactions, €${baseCommission.toFixed(2)} base + €${totalBonus.toFixed(2)} bonuses)`);

    res.json({
      managerId: manager.id,
      managerHandle: manager.handle,
      managerName: manager.name,
      managerType: manager.type,
      month: period, // include canonical field expected by frontend
      period,        // keep legacy for compatibility
      grossAmount: gross,
      bonusSum,
      netAmount: net,
      baseCommission,
      milestoneBonuses,
      graduationBonus,
      diamondBonus,
      recruitmentBonus,
      downlineIncome,
      totalBonus,
      totalEarnings,
      transactionCount: txCount,
      bonusCount: bonusSnap.size,
      creatorCount,
      creators: (req.query.includeCreators === '1' || req.query.includeCreators === 'true') ?
        Object.values(creatorsAgg).sort((a,b) => b.net - a.net) : undefined
    });

  } catch (error) {
    console.error("Get manager earnings error:", error);
    res.status(500).json({ error: "Failed to fetch manager earnings" });
  }
} 