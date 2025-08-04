import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

interface PayoutRequestBody {
  period: string;
  requestedAmount: number;
  bankDetails: string;
  notes?: string;
}

export async function requestPayout(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    if (req.user?.role !== "MANAGER") {
      res.status(403).json({ error: "Access denied. Manager role required." });
      return;
    }
    
    const { managerId, uid, email, firstName, lastName } = req.user;
    if (!managerId) {
        res.status(400).json({ error: "Manager ID is missing from user token." });
        return;
    }

    const { period, requestedAmount, bankDetails, notes } = req.body as PayoutRequestBody;

    if (!period || !requestedAmount || !bankDetails) {
      res.status(400).json({ error: "Missing required fields: period, requestedAmount, bankDetails." });
      return;
    }
    
    if (requestedAmount <= 0) {
      res.status(400).json({ error: "Requested amount must be positive." });
      return;
    }

    const db = admin.firestore();

    // 1. Calculate the total available earnings for the manager for the given period
    const bonusesSnapshot = await db.collection("bonuses")
      .where("managerId", "==", managerId)
      .where("month", "==", period)
      .get();
      
    const availableAmount = bonusesSnapshot.docs.reduce((sum, doc) => sum + (doc.data().amount || 0), 0);
    
    // 2. Calculate already requested amounts for the same period
    const existingRequestsSnapshot = await db.collection("payoutRequests")
      .where("managerId", "==", managerId)
      .where("period", "==", period)
      .where("status", "in", ["SUBMITTED", "APPROVED", "IN_PROGRESS"])
      .get();
      
    const alreadyRequestedAmount = existingRequestsSnapshot.docs.reduce((sum, doc) => sum + (doc.data().requestedAmount || 0), 0);

    const netAvailableAmount = availableAmount - alreadyRequestedAmount;

    // 3. Validate if the requested amount is available
    if (requestedAmount > netAvailableAmount) {
      res.status(400).json({ 
        error: "Requested amount exceeds available balance.",
        availableAmount,
        alreadyRequestedAmount,
        netAvailableAmount,
        requestedAmount
      });
      return;
    }

    // 4. Create the new payout request document
    const ref = db.collection("payoutRequests").doc();
    const newPayoutRequest = {
      id: ref.id,
      managerId,
      managerName: `${firstName} ${lastName}`.trim() || email,
      userId: uid,
      period,
      requestedAmount,
      availableOnRequest: availableAmount,
      status: "SUBMITTED",
      bankDetails,
      notes: notes || "",
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      history: [
        {
          status: "SUBMITTED",
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          actor: "MANAGER",
          userId: uid,
        }
      ]
    };

    await ref.set(newPayoutRequest);

    res.status(201).json(newPayoutRequest);
    
  } catch (error) {
    console.error("💥 Error in requestPayout:", error);
    res.status(500).json({ error: "Failed to create payout request due to an internal server error." });
  }
} 