import { onRequest } from "firebase-functions/v2/https";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import * as admin from "firebase-admin";

import { authMiddleware, AuthenticatedRequest } from "./middleware/auth";
import { getManagerEarnings } from "./earnings/getManager";
import { requestPayout } from "./payouts/requestPayout";

const app = express();

app.use(helmet());
app.use(cors({ origin: true }));

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// All other routes require authentication
app.use(authMiddleware);

// --- UPLOAD BATCH MANAGEMENT (Admin only) ---
app.get("/uploads/batches", async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Access Denied: Admin role required." });
    }
    try {
        const db = admin.firestore();
        const limit = parseInt(req.query.limit as string) || 5;
        const snapshot = await db.collection("upload-metadata")
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();
        const batches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json(batches);
    } catch (error) {
        console.error("💥 Error fetching upload batches:", error);
        return res.status(500).json({ error: "Failed to fetch upload batches." });
    }
});

app.get("/uploads/batches/:id", async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Access Denied: Admin role required." });
    }
    try {
        const db = admin.firestore();
        const { id } = req.params;
        const doc = await db.collection("upload-metadata").doc(id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: "Batch not found" });
        }
        return res.status(200).json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error(`💥 Error fetching batch ${req.params.id}:`, error);
        return res.status(500).json({ error: "Failed to fetch batch details." });
    }
});


// --- EARNINGS & PAYOUTS ---
app.get("/earnings/:managerId", getManagerEarnings);
app.post("/payouts/request", requestPayout);

// --- ADMIN PAYOUTS ---
const adminPayoutsRouter = express.Router();
adminPayoutsRouter.use((req: AuthenticatedRequest, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access Denied: Admin role required.' });
  }
  return next();
});
adminPayoutsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = admin.firestore();
    const statusFilter = req.query.status as string | undefined;
    
    let query: admin.firestore.Query = db.collection("payoutRequests").orderBy("submittedAt", "desc");

    if (statusFilter && ["SUBMITTED", "APPROVED", "IN_PROGRESS", "PAID", "REJECTED"].includes(statusFilter)) {
        query = query.where("status", "==", statusFilter);
    }
    
    const snapshot = await query.limit(100).get();
    const payouts = snapshot.docs.map(doc => doc.data());
    res.status(200).json(payouts);
  } catch (error) {
    console.error("💥 Error fetching payout requests:", error);
    res.status(500).json({ error: "Failed to fetch payout requests." });
  }
});
adminPayoutsRouter.put('/:id/status', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;
        const { uid } = req.user!;

        if (!status || !["APPROVED", "IN_PROGRESS", "PAID", "REJECTED"].includes(status)) {
            return res.status(400).json({ error: "Invalid or missing 'status' field." });
        }

        const db = admin.firestore();
        const payoutRef = db.collection("payoutRequests").doc(id);

        await payoutRef.update({
            status: status,
            adminNotes: adminNotes || "",
            history: admin.firestore.FieldValue.arrayUnion({
                status: status,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                actor: "ADMIN",
                userId: uid,
                notes: adminNotes || ""
            })
        });

        return res.status(200).json({ success: true, message: `Payout status updated to ${status}.` });

    } catch (error) {
        console.error(`💥 Error updating payout status for ${req.params.id}:`, error);
        return res.status(500).json({ error: "Failed to update payout status." });
    }
});
app.use('/admin/payouts', adminPayoutsRouter);


export const api = onRequest({ region: "europe-west1" }, app);

// Export triggers
export { onPayoutStatusChange } from "./payouts/statusTrigger";
export { excelCalculator } from "./excel-calculator";
export { calculateDownlineCommissions } from "./downline-calculator"; 