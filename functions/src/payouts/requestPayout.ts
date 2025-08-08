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
    if (!req.user || (req.user.role !== "MANAGER" && req.user.role !== "manager")) {
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

    const requested = typeof amount === 'number' ? amount : requestedAmount;
    if (!requested || requested <= 0) {
      res.status(400).json({ error: "Requested amount must be a positive number." });
      return;
    }

    const db = admin.firestore();

    // 1) Load consolidated total earnings for the month
    const earningsDoc = await db.collection("manager-earnings").doc(`${managerId}_${period}`).get();
    const totalEarnings = earningsDoc.exists ? (earningsDoc.data()?.totalEarnings || 0) : 0;

    // 2) Sum already requested for the month (open + approved + paid)
    const existingRequestsSnapshot = await db
      .collection("payoutRequests")
      .where("managerId", "==", managerId)
      .where("period", "==", period)
      .where("status", "in", ["SUBMITTED", "APPROVED", "IN_PROGRESS", "PAID"]) // exclude REJECTED
      .get();

    const alreadyRequested = existingRequestsSnapshot.docs.reduce((sum, d) => sum + (d.data().amount || d.data().requestedAmount || 0), 0);

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
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: [
        {
          status: "SUBMITTED",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
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