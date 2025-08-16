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

// Admin: Impersonate a manager (returns Firebase Custom Token)
adminPayoutsRouter.post('/impersonate/:managerId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { managerId } = req.params;
    if (!managerId) {
      res.status(400).json({ error: 'managerId required' });
      return;
    }
    const db = admin.firestore();
    const mgrDoc = await db.collection('managers').doc(managerId).get();
    if (!mgrDoc.exists) {
      res.status(404).json({ error: 'Manager not found' });
      return;
    }
    const m: any = mgrDoc.data() || {};

    // Ensure a Firebase Auth user exists for this managerId
    try {
      await admin.auth().getUser(managerId);
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') {
        await admin.auth().createUser({
          uid: managerId,
          email: m.email || undefined,
          displayName: m.name || `${m.firstName || ''} ${m.lastName || ''}`.trim() || managerId,
          emailVerified: !!m.email,
        });
      } else {
        throw e;
      }
    }

    // Set custom claims for manager role
    const claims = {
      role: 'MANAGER',
      managerId: managerId,
      firstName: m.firstName || '',
      lastName: m.lastName || '',
    } as any;
    await admin.auth().setCustomUserClaims(managerId, claims);

    // Create short-lived custom token to sign in on client
    const token = await admin.auth().createCustomToken(managerId, claims);

    res.status(200).json({ success: true, token, manager: { id: managerId, name: m.name || '', email: m.email || null } });
  } catch (e: any) {
    console.error('💥 Impersonation error:', e);
    res.status(500).json({ error: 'Failed to impersonate manager', details: e?.message || String(e) });
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

// NEW: List config versions (latest first)
adminPayoutsRouter.get('/config/commission/versions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const snap = await db.collection('systemConfig').orderBy('activeFrom', 'desc').limit(50).get();
    const versions = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    res.status(200).json({ success: true, versions });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to list versions', details: e.message });
  }
});

// NEW: Create or update a config version (with optional named snapshot)
adminPayoutsRouter.post('/config/commission', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const body = req.body || {};
    const name = (body.name || '').toString().trim() || `Config ${new Date().toISOString()}`;
    const effectiveFrom = (body.effectiveFrom || '').toString().trim(); // YYYYMM or ''

    const payload = {
      milestoneDeductions: body.milestoneDeductions || undefined,
      milestonePayouts: body.milestonePayouts || undefined,
      diamondBonusPayouts: body.diamondBonusPayouts || undefined,
      diamondThreshold: typeof body.diamondThreshold === 'number' ? body.diamondThreshold : undefined,
      recruitmentBonusPayouts: body.recruitmentBonusPayouts || undefined,
      graduationBonusPayouts: body.graduationBonusPayouts || undefined,
      baseCommissionRates: body.baseCommissionRates || undefined,
      downlineRates: body.downlineRates || undefined,
      name,
      effectiveFrom: /^\d{6}$/.test(effectiveFrom) ? effectiveFrom : undefined,
      createdBy: req.user?.uid || 'admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      activeFrom: null,
      activeTo: null,
    } as any;

    const ref = await db.collection('systemConfig').add(payload);
    await CommissionConfigService.getInstance().invalidate();
    res.status(201).json({ success: true, id: ref.id });
  } catch (e:any) {
    console.error('💥 Create config failed', e);
    res.status(500).json({ error: 'Failed to create config', details: e.message });
  }
});

// NEW: Activate a version (optionally close previous active)
adminPayoutsRouter.post('/config/commission/:id/activate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const { id } = req.params;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Close currently active
    const activeSnap = await db.collection('systemConfig').where('activeTo', '==', null).get();
    const b = db.batch();
    activeSnap.forEach(d => b.update(d.ref, { activeTo: now }));

    // Activate selected
    const ref = db.collection('systemConfig').doc(id);
    b.update(ref, { activeFrom: now, activeTo: null });
    await b.commit();
    CommissionConfigService.getInstance().invalidate();
    res.status(200).json({ success: true });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to activate config', details: e.message });
  }
});

// NEW: Preview recalculation (dry-run) – returns deltas for a given month using provided overrides
adminPayoutsRouter.post('/config/commission/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const { month, overrides } = req.body as { month: string; overrides?: any };
    if (!/^\d{6}$/.test(month)) {
      res.status(400).json({ error: 'month (YYYYMM) required' });
      return;
    }
    // Load existing totals
    const earningsSnap = await db.collection('manager-earnings').where('month','==', month).get();
    const currentByManager = new Map<string, { base: number; milestone: number; total: number }>();
    earningsSnap.forEach(d => {
      const e = d.data() as any;
      currentByManager.set(e.managerId, {
        base: Number(e.baseCommission || 0),
        milestone: Number(e.milestonePayouts || 0),
        total: Number((e.baseCommission || 0) + (e.milestonePayouts || 0) + (e.extras || 0) + (e.downlineEarnings || 0))
      });
    });

    // Load transactions & milestone counts to recompute with overrides
    const [txSnap, bonusesSnap] = await Promise.all([
      db.collection('transactions').where('month','==', month).get(),
      db.collection('bonuses').where('month','==', month).where('type','in', ['MILESTONE_S','MILESTONE_N','MILESTONE_O','MILESTONE_P']).get()
    ]);

    const milestoneCounts = new Map<string, { S:number; N:number; O:number; P:number }>();
    bonusesSnap.forEach(d => {
      const b = d.data();
      const mid = String(b.managerId);
      const key = String(b.type || '').slice(-1) as 'S'|'N'|'O'|'P';
      if (!milestoneCounts.has(mid)) milestoneCounts.set(mid, { S:0,N:0,O:0,P:0 });
      const entry = milestoneCounts.get(mid)!;
      entry[key] += Math.round((Number(b.amount || 0) > 0 ? 1 : 0));
    });

    const active = await CommissionConfigService.getInstance().getActiveConfig();
    const cfg = { ...active, ...(overrides || {}) } as any;
    const newBaseRates = cfg.baseCommissionRates || { live: 0.30, team: 0.35 };
    const newMilestones = cfg.milestonePayouts || active.milestonePayouts;

    // Recompute per manager
    txSnap.forEach(d => {
      const t = d.data() as any;
      const mid = String(t.managerId || t.liveManagerId || t.teamManagerId || '');
      if (!mid) return;
      const type = (String(t.managerType || '').toLowerCase() === 'team') ? 'team' : 'live';
      const net = Number(t.netForCommission || t.net || 0);
      const newBase = Math.round((net * (type === 'team' ? newBaseRates.team : newBaseRates.live)) * 100) / 100;
      const cur = currentByManager.get(mid) || { base: 0, milestone: 0, total: 0 };
      currentByManager.set(mid, { ...cur, base: (cur.base || 0) + newBase });
    });

    // Add milestone recompute
    currentByManager.forEach((v, mid) => {
      const counts = milestoneCounts.get(mid) || { S:0,N:0,O:0,P:0 };
      const type: 'live'|'team' = 'live'; // unknown here; using live as conservative default in preview if not resolvable quickly
      const rates = newMilestones?.[type] || { S:75,N:150,O:400,P:100 };
      const milestone = (counts.S * rates.S) + (counts.N * rates.N) + (counts.O * rates.O) + (counts.P * rates.P);
      currentByManager.set(mid, { ...v, milestone });
    });

    // Produce response
    const results = Array.from(currentByManager.entries()).map(([managerId, vals]) => ({
      managerId,
      previewBase: Math.round((vals.base || 0) * 100) / 100,
      previewMilestones: Math.round((vals.milestone || 0) * 100) / 100,
      previewTotal: Math.round(((vals.base || 0) + (vals.milestone || 0)) * 100) / 100,
    }));

    res.status(200).json({ success: true, month, results });
  } catch (e:any) {
    console.error('💥 Preview failed', e);
    res.status(500).json({ error: 'Preview failed', details: e.message });
  }
});

// NOTE: An "apply" endpoint could persist the preview by updating per-manager earnings and rewriting bonus docs.
// For safety, keep it as a future step and require explicit confirmation.

export { adminPayoutsRouter }; 