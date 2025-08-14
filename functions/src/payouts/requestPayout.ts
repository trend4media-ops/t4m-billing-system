import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

interface PayoutRequestBody {
  period: string;
  requestedAmount?: number;
  amount?: number;
  bankDetails?: string;
  notes?: string;
}

export async function requestPayout(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (!req.user || (String(req.user.role).toUpperCase() !== "MANAGER")) {
      res.status(403).json({ error: "Access denied. Manager role required." });
      return;
    }
    
    const { managerId, uid, email, firstName, lastName } = req.user;
    if (!managerId) {
      res.status(400).json({ error: "Manager ID is missing from user token." });
      return;
    }

    const { period, requestedAmount, amount, bankDetails, notes } = req.body as PayoutRequestBody;

    if (!period) {
      res.status(400).json({ error: "Missing required field: period" });
      return;
    }

    const raw = typeof amount === 'number' ? amount : requestedAmount;
    const requested = raw ? Math.round(raw * 100) / 100 : 0;
    if (!requested || requested <= 0) {
      res.status(400).json({ error: "Requested amount must be a positive number." });
      return;
    }

    const db = admin.firestore();

    // 1) Load base + bonuses dynamically for the month
    const earningsDoc = await db.collection("manager-earnings").doc(`${managerId}_${period}`).get();
    const baseCommission = earningsDoc.exists ? (earningsDoc.data()?.baseCommission || 0) : 0;
    const bonusesSnap = await db.collection('bonuses')
      .where('managerId', '==', managerId)
      .where('month', '==', period)
      .get();
    const bonusesSum = bonusesSnap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
    const totalEarnings = Math.round((baseCommission + bonusesSum) * 100) / 100;

    // 2) Sum already requested for the month (open + approved + paid)
    const existingRequestsSnapshot = await db
      .collection("payoutRequests")
      .where("managerId", "==", managerId)
      .where("period", "==", period)
      .get();

    const alreadyRequested = existingRequestsSnapshot.docs
      .map(d => d.data())
      .filter(d => (d.status || 'SUBMITTED') !== 'REJECTED')
      .reduce((sum, d:any) => sum + (d.amount || d.requestedAmount || 0), 0);

    const netAvailable = Math.max(0, totalEarnings - alreadyRequested);
    if (requested > netAvailable) {
      res.status(400).json({ 
        error: "Requested amount exceeds available balance.",
        totalEarnings,
        alreadyRequested,
        netAvailable,
        requested
      });
      return;
    }

    // 3) Create payout request in payoutRequests collection
    const ref = db.collection("payoutRequests").doc();
    const newPayoutRequest = {
      id: ref.id,
      managerId,
      managerName: `${firstName || ''} ${lastName || ''}`.trim() || email || managerId,
      userId: uid,
      period,
      amount: requested,
      availableOnRequest: totalEarnings,
      status: "SUBMITTED",
      bankDetails: bankDetails || "",
      notes: notes || "",
      // Currency metadata for clarity
      currency: 'EUR',
      amountEUR: requested,
      fxRateOnRequest: null,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: [
        {
          status: "SUBMITTED",
          timestamp: admin.firestore.Timestamp.now(),
          actor: "MANAGER",
          userId: uid,
        }
      ]
    } as any;

    await ref.set(newPayoutRequest);

    res.status(201).json({ success: true, request: newPayoutRequest });
    
  } catch (error) {
    console.error("💥 Error in requestPayout:", error);
    res.status(500).json({ error: "Failed to create payout request due to an internal server error." });
  }
} 