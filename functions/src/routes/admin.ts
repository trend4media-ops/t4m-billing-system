import { Router } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { Response } from "express";
import * as admin from "firebase-admin";
import { calculateDownlineForPeriod } from "../downline-calculator";

const adminPayoutsRouter = Router();

// Alle Admin-Routen benötigen Admin-Berechtigung
adminPayoutsRouter.use((req: AuthenticatedRequest, res: Response, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Admin role required" });
    }
    return next();
});

adminPayoutsRouter.get('/recalc-downline', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const period = (req.query.period as string) || undefined;
        const now = new Date();
        const fallback = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
        await calculateDownlineForPeriod(period || fallback);
        res.status(200).json({ success: true, period: period || fallback });
    } catch (e:any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get all pending payouts
adminPayoutsRouter.get("/payouts/pending", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection("payouts")
            .where("status", "==", "PENDING")
            .orderBy("requestedAt", "desc")
            .get();
        
        const payouts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.status(200).json({ data: payouts });
    } catch (error) {
        console.error("💥 Error fetching pending payouts:", error);
        res.status(500).json({ error: "Failed to fetch pending payouts" });
    }
});

// Approve/Reject payout
adminPayoutsRouter.put("/payouts/:payoutId/status", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { payoutId } = req.params;
        const { status, adminNotes } = req.body;

        if (!["APPROVED", "REJECTED"].includes(status)) {
            res.status(400).json({ error: "Invalid status. Must be APPROVED or REJECTED" });
            return;
        }

        const db = admin.firestore();
        const payoutRef = db.collection("payouts").doc(payoutId);
        
        const updateData: any = {
            status,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: req.user!.uid
        };

        if (adminNotes) {
            updateData.adminNotes = adminNotes;
        }

        await payoutRef.update(updateData);

        console.log(`✅ Payout ${payoutId} ${status.toLowerCase()} by admin ${req.user!.uid}`);
        
        res.status(200).json({
            success: true,
            message: `Payout ${status.toLowerCase()} successfully`
        });

    } catch (error) {
        console.error(`💥 Error updating payout status:`, error);
        res.status(500).json({ error: "Failed to update payout status" });
    }
});

// Get payout statistics
adminPayoutsRouter.get("/payouts/stats", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = admin.firestore();
        
        // Get counts for each status
        const [pendingSnapshot, approvedSnapshot, rejectedSnapshot] = await Promise.all([
            db.collection("payouts").where("status", "==", "PENDING").get(),
            db.collection("payouts").where("status", "==", "APPROVED").get(),
            db.collection("payouts").where("status", "==", "REJECTED").get()
        ]);

        // Calculate total amounts
        let totalPending = 0;
        let totalApproved = 0;
        
        pendingSnapshot.docs.forEach(doc => {
            const data = doc.data();
            totalPending += data.amount || 0;
        });

        approvedSnapshot.docs.forEach(doc => {
            const data = doc.data();
            totalApproved += data.amount || 0;
        });

        const stats = {
            counts: {
                pending: pendingSnapshot.size,
                approved: approvedSnapshot.size,
                rejected: rejectedSnapshot.size,
                total: pendingSnapshot.size + approvedSnapshot.size + rejectedSnapshot.size
            },
            amounts: {
                totalPending: Math.round(totalPending * 100) / 100,
                totalApproved: Math.round(totalApproved * 100) / 100,
                currency: "EUR"
            }
        };

        res.status(200).json(stats);
    } catch (error) {
        console.error("💥 Error fetching payout stats:", error);
        res.status(500).json({ error: "Failed to fetch payout statistics" });
    }
});

export { adminPayoutsRouter }; 