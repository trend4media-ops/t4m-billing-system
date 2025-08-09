import { Router } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { Response } from "express";
import * as admin from "firebase-admin";
import { calculateDownlineForPeriod } from "../downline-calculator";
import { CommissionConfigService } from '../services/commissionConfig';

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

// List all payout requests (optional filter by status)
adminPayoutsRouter.get("/payouts", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = admin.firestore();
        const allowed = new Set(["SUBMITTED","APPROVED","IN_PROGRESS","PAID","REJECTED"]);
        const filter = (req.query.filter as string) || '';
        const period = (req.query.period as string) || '';

        let baseQuery: FirebaseFirestore.Query = db.collection("payoutRequests");
        if (filter && allowed.has(filter)) {
            baseQuery = baseQuery.where("status","==",filter);
        }
        if (period && /^\d{6}$/.test(period)) {
            baseQuery = baseQuery.where("period","==",period);
        }

        const snapshot = await baseQuery.get();

        const payouts = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a:any,b:any) => {
                const aTs = a.requestedAt?.toDate ? a.requestedAt.toDate().getTime() : (a.requestedAt ? Date.parse(a.requestedAt) : 0);
                const bTs = b.requestedAt?.toDate ? b.requestedAt.toDate().getTime() : (b.requestedAt ? Date.parse(b.requestedAt) : 0);
                return bTs - aTs;
            })
            .map((p:any) => ({
                ...p,
                requestedAt: p.requestedAt?.toDate ? p.requestedAt.toDate().toISOString() : (p.requestedAt || null),
                managerId: p.managerId || p.userId || undefined
            }));

        res.status(200).json({ data: payouts });
    } catch (error) {
        console.error("💥 Error listing payouts:", error);
        res.status(500).json({ error: "Failed to list payout requests" });
    }
});

// Get all pending payouts (SUBMITTED)
adminPayoutsRouter.get("/payouts/pending", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const db = admin.firestore();
        const snapshot = await db.collection("payoutRequests")
            .where("status", "==", "SUBMITTED")
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

// Approve/Reject/Progress/Pay payout
adminPayoutsRouter.put("/payouts/:payoutId/status", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
        const { payoutId } = req.params;
        const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };

        const allowedStatuses = ["APPROVED", "IN_PROGRESS", "PAID", "REJECTED"] as const;
        if (!status || !allowedStatuses.includes(status as any)) {
            res.status(400).json({ error: "Invalid status. Must be one of APPROVED, IN_PROGRESS, PAID, REJECTED" });
            return;
        }

        const db = admin.firestore();
        const payoutRef = db.collection("payoutRequests").doc(payoutId);
        const payoutSnap = await payoutRef.get();
        if (!payoutSnap.exists) {
            res.status(404).json({ error: "Payout request not found" });
            return;
        }
        
        const updateData: any = {
            status,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            decidedBy: req.user!.uid
        };

        if (adminNotes) {
            updateData.adminNotes = adminNotes;
        }

        // Append to history
        updateData.history = admin.firestore.FieldValue.arrayUnion({
            status,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            actor: "ADMIN",
            userId: req.user!.uid,
            adminNotes: adminNotes || ""
        });

        await payoutRef.update(updateData);

        console.log(`✅ Payout ${payoutId} updated to ${status.toLowerCase()} by admin ${req.user!.uid}`);
        
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
        const [submittedSnapshot, approvedSnapshot, rejectedSnapshot, inProgressSnapshot, paidSnapshot] = await Promise.all([
            db.collection("payoutRequests").where("status", "==", "SUBMITTED").get(),
            db.collection("payoutRequests").where("status", "==", "APPROVED").get(),
            db.collection("payoutRequests").where("status", "==", "REJECTED").get(),
            db.collection("payoutRequests").where("status", "==", "IN_PROGRESS").get(),
            db.collection("payoutRequests").where("status", "==", "PAID").get(),
        ]);

        // Calculate total amounts
        const sumAmount = (snap: any) => {
            let total = 0;
            snap.docs.forEach((d: any) => {
                const data = d.data();
                total += (data.amount || data.requestedAmount || 0);
            });
            return Math.round(total * 100) / 100;
        };

        const stats = {
            counts: {
                submitted: submittedSnapshot.size,
                approved: approvedSnapshot.size,
                inProgress: inProgressSnapshot.size,
                paid: paidSnapshot.size,
                rejected: rejectedSnapshot.size,
                total: submittedSnapshot.size + approvedSnapshot.size + rejectedSnapshot.size + inProgressSnapshot.size + paidSnapshot.size
            },
            amounts: {
                totalSubmitted: sumAmount(submittedSnapshot),
                totalApproved: sumAmount(approvedSnapshot),
                totalInProgress: sumAmount(inProgressSnapshot),
                totalPaid: sumAmount(paidSnapshot),
                totalRejected: sumAmount(rejectedSnapshot),
                currency: "EUR"
            }
        };

        res.status(200).json(stats);
    } catch (error) {
        console.error("💥 Error fetching payout stats:", error);
        res.status(500).json({ error: "Failed to fetch payout statistics" });
    }
});

// Commission config read-only endpoint for admins
adminPayoutsRouter.get('/config/commission', async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  try {
    const config = await CommissionConfigService.getInstance().getActiveConfig();
    res.json({ success: true, config });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to load commission config', details: e.message });
  }
});

export { adminPayoutsRouter }; 