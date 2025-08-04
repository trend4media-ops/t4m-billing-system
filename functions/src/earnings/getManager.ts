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
    const period = (req.query.period as string) || undefined;

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

    // Transactions aggregation - check both liveManagerId and teamManagerId
    let liveQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("transactions")
      .where("liveManagerId", "==", managerId);
    if (period) {
      liveQuery = liveQuery.where("period", "==", period);
    }
    const liveSnap = await liveQuery.get();

    let teamQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("transactions")
      .where("teamManagerId", "==", managerId);
    if (period) {
      teamQuery = teamQuery.where("period", "==", period);
    }
    const teamSnap = await teamQuery.get();

    let gross = 0,
      bonusSum = 0,
      net = 0,
      txCount = 0;

    // Process live transactions
    liveSnap.forEach((doc) => {
      const d = doc.data();
      gross += d.grossAmount || 0;
      bonusSum += d.bonusSum || 0;
      net += d.net || 0; // Fixed: use 'net' instead of 'netAmount'
      txCount += 1;
    });

    // Process team transactions
    teamSnap.forEach((doc) => {
      const d = doc.data();
      gross += d.grossAmount || 0;
      bonusSum += d.bonusSum || 0;
      net += d.net || 0; // Fixed: use 'net' instead of 'netAmount'
      txCount += 1;
    });

    // Bonuses aggregation by type
    let bonusQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
      .collection("bonuses")
      .where("managerId", "==", managerId);
    if (period) {
      bonusQuery = bonusQuery.where("period", "==", period);
    }
    const bonusSnap = await bonusQuery.get();

    let baseCommission = 0;
    const milestoneBonuses = {
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
          milestoneBonuses.halfMilestone += amount;
          break;
        case "MILESTONE_N":
          milestoneBonuses.milestone1 += amount;
          break;
        case "MILESTONE_O":
          milestoneBonuses.milestone2 += amount;
          break;
        case "MILESTONE_P":
          milestoneBonuses.retention += amount;
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
          downlineIncome.levelA += amount;
          break;
        case "DOWNLINE_LEVEL_B":
          downlineIncome.levelB += amount;
          break;
        case "DOWNLINE_LEVEL_C":
          downlineIncome.levelC += amount;
          break;
      }
    });

    const totalBonus = 
      milestoneBonuses.halfMilestone + 
      milestoneBonuses.milestone1 + 
      milestoneBonuses.milestone2 + 
      milestoneBonuses.retention + 
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
      period,
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
      bonusCount: bonusSnap.size
    });

  } catch (error) {
    console.error("Get manager earnings error:", error);
    res.status(500).json({ error: "Failed to fetch manager earnings" });
  }
} 