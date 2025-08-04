import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

const adminPayoutsRouter = Router();

adminPayoutsRouter.get('/payouts', async (req: Request, res: Response) => {
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

adminPayoutsRouter.put('/payouts/:id/status', async (req: AuthenticatedRequest, res: Response) => {
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

export { adminPayoutsRouter }; 