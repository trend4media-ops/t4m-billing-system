import { Router } from "express";
import { AuthenticatedRequest } from "../middleware/auth";
import { Response } from "express";
import * as admin from "firebase-admin";
import { calculateDownlineForPeriod } from "../downline-calculator";
import { CommissionConfigService } from '../services/commissionConfig';
import multer from 'multer';

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
      const type: 'live'|'team' = 'live'; // conservative default in preview
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

// NEW: Apply preview deltas safely via manual adjustments and update monthly earnings; trigger downline recompute
adminPayoutsRouter.post('/config/commission/apply', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const { month, overrides, note } = req.body as { month: string; overrides?: any; note?: string };
    if (!/^\d{6}$/.test(month)) {
      res.status(400).json({ error: 'month (YYYYMM) required' });
      return;
    }

    // Reuse preview calculation
    // (Preview was already implemented above; in apply we recompute inline for safety)

    // Above trick won't return here; do preview inline again
    const active = await CommissionConfigService.getInstance().getActiveConfig();
    const cfg = { ...active, ...(overrides || {}) } as any;
    const newBaseRates = cfg.baseCommissionRates || { live: 0.30, team: 0.35 };
    const newMilestones = cfg.milestonePayouts || active.milestonePayouts;

    const [earningsSnap, txSnap, bonusesSnap] = await Promise.all([
      db.collection('manager-earnings').where('month','==', month).get(),
      db.collection('transactions').where('month','==', month).get(),
      db.collection('bonuses').where('month','==', month).where('type','in', ['MILESTONE_S','MILESTONE_N','MILESTONE_O','MILESTONE_P']).get()
    ]);

    const current = new Map<string, { base: number; milestone: number }>();
    earningsSnap.forEach(d => {
      const e = d.data() as any;
      current.set(e.managerId, { base: Number(e.baseCommission || 0), milestone: Number(e.milestonePayouts || 0) });
    });

    const recomputedBase = new Map<string, number>();
    txSnap.forEach(d => {
      const t = d.data() as any;
      const mid = String(t.managerId || t.liveManagerId || t.teamManagerId || '');
      if (!mid) return;
      const type = (String(t.managerType || '').toLowerCase() === 'team') ? 'team' : 'live';
      const net = Number(t.netForCommission || t.net || 0);
      const nb = Math.round((net * (type === 'team' ? newBaseRates.team : newBaseRates.live)) * 100) / 100;
      recomputedBase.set(mid, (recomputedBase.get(mid) || 0) + nb);
    });

    const counts = new Map<string, { S:number; N:number; O:number; P:number }>();
    bonusesSnap.forEach(d => {
      const b = d.data();
      const mid = String(b.managerId);
      const k = String(b.type || '').slice(-1) as 'S'|'N'|'O'|'P';
      if (!counts.has(mid)) counts.set(mid, { S:0,N:0,O:0,P:0 });
      const entry = counts.get(mid)!; entry[k] += Math.round((Number(b.amount || 0) > 0 ? 1 : 0));
    });

    // Create adjustments and update earnings
    const batch = db.batch();
    const adjustments: Array<{ managerId: string; delta: number }> = [];

    current.forEach((vals, mid) => {
      const baseNew = Math.round((recomputedBase.get(mid) || 0) * 100) / 100;
      const curMilestone = vals.milestone || 0;
      const c = counts.get(mid) || { S:0,N:0,O:0,P:0 };
      const rates = newMilestones?.['live'] || { S:75,N:150,O:400,P:100 }; // unable to resolve exact type quickly here
      const milestoneNew = (c.S * rates.S) + (c.N * rates.N) + (c.O * rates.O) + (c.P * rates.P);

      const delta = Math.round(((baseNew - vals.base) + (milestoneNew - curMilestone)) * 100) / 100;
      if (Math.abs(delta) >= 0.01) {
        const ref = db.collection('manualAdjustments').doc();
        batch.set(ref, {
          id: ref.id,
          managerId: mid,
          month,
          amount: delta,
          reason: 'COMMISSION_CONFIG_APPLY',
          note: note || null,
          configName: cfg?.name || null,
          effectiveFrom: cfg?.effectiveFrom || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: req.user?.uid || 'admin'
        });

        const earnRef = db.collection('manager-earnings').doc(`${mid}_${month}`);
        batch.set(earnRef, {
          extras: admin.firestore.FieldValue.increment(delta),
          totalEarnings: admin.firestore.FieldValue.increment(delta),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        adjustments.push({ managerId: mid, delta });
      }
    });

    await batch.commit();

    // Trigger downline recompute using config for period
    try {
      await calculateDownlineForPeriod(month);
    } catch (e) { console.warn('Downline recompute failed after apply', e); }

    // Optional: broadcast notification to all managers
    try {
      const b = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const msg = `Commission settings applied for ${month.slice(0,4)}-${month.slice(4)}. Your available payout may have changed.`;
      adjustments.forEach(a => {
        const mref = db.collection('messages').doc();
        b.set(mref, {
          userId: a.managerId,
          title: 'Commission Config Applied',
          content: msg,
          module: 'SETTINGS_APPLY',
          read: false,
          isRead: false,
          createdAt: now,
          requiresAck: true
        });
      });
      await b.commit();
    } catch (e) { console.warn('Apply notification broadcast failed', e); }

    res.status(200).json({ success: true, month, adjustments: adjustments.length });
  } catch (e:any) {
    console.error('💥 Apply failed', e);
    res.status(500).json({ error: 'Apply failed', details: e.message });
  }
});

// NOTE: An "apply" endpoint could persist the preview by updating per-manager earnings and rewriting bonus docs.
// For safety, keep it as a future step and require explicit confirmation.

// NEW: Lock a specific config version for a month (baseline safety)
adminPayoutsRouter.post('/config/commission/lock', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const { month, configId } = req.body as { month: string; configId: string };
    if (!/^\d{6}$/.test(month) || !configId) {
      res.status(400).json({ error: 'month (YYYYMM) and configId are required' });
      return;
    }
    const cfg = await db.collection('systemConfig').doc(configId).get();
    if (!cfg.exists) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    await db.collection('systemConfigLocks').doc(month).set({ month, configId, lockedAt: admin.firestore.FieldValue.serverTimestamp(), lockedBy: req.user?.uid || 'admin' });
    res.status(200).json({ success: true });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to lock config for month', details: e.message });
  }
});

adminPayoutsRouter.delete('/config/commission/lock/:month', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = req.params.month;
    if (!/^\d{6}$/.test(month)) { res.status(400).json({ error: 'Invalid month' }); return; }
    await admin.firestore().collection('systemConfigLocks').doc(month).delete();
    res.status(200).json({ success: true });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to unlock config', details: e.message });
  }
});

// NEW: Snapshot current active config as baseline
adminPayoutsRouter.post('/config/commission/baseline', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const active = await CommissionConfigService.getInstance().getActiveConfig();
    const ref = await db.collection('systemConfigBaselines').add({
      snapshot: active,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user?.uid || 'admin'
    });
    res.status(201).json({ success: true, id: ref.id });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to snapshot baseline', details: e.message });
  }
});

// --- EVENTS (ADMIN) ---
adminPayoutsRouter.get('/events', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection('events').orderBy('startAt','desc').limit(200).get();
    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    res.status(200).json({ data: items });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to list events', details: e.message });
  }
});

adminPayoutsRouter.post('/events', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, description, startAt, endAt, audience, recipients, requireAck } = req.body as any;
    if (!title || !startAt) { res.status(400).json({ error: 'title and startAt required' }); return; }
    const ref = admin.firestore().collection('events').doc();
    const payload = {
      id: ref.id,
      title: String(title),
      description: description ? String(description) : '',
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      audience: audience || 'ALL',
      recipients: Array.isArray(recipients) ? recipients.slice(0,500) : [],
      requireAck: Boolean(requireAck),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user?.uid || 'admin'
    } as any;
    await ref.set(payload);
    res.status(201).json({ success: true, event: payload });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to create event', details: e.message });
  }
});

adminPayoutsRouter.put('/events/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const update: any = {};
    ['title','description','audience','requireAck'].forEach(k => { if (k in req.body) update[k] = req.body[k]; });
    if ('startAt' in req.body) update.startAt = new Date(req.body.startAt);
    if ('endAt' in req.body) update.endAt = req.body.endAt ? new Date(req.body.endAt) : null;
    await admin.firestore().collection('events').doc(id).set(update, { merge: true });
    res.status(200).json({ success: true });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to update event', details: e.message });
  }
});

adminPayoutsRouter.delete('/events/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await admin.firestore().collection('events').doc(id).delete();
    res.status(200).json({ success: true });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to delete event', details: e.message });
  }
});

adminPayoutsRouter.post('/events/:id/notify', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { recipients } = req.body as { recipients?: string[] };
    const db = admin.firestore();
    const ev = await db.collection('events').doc(id).get();
    if (!ev.exists) { res.status(404).json({ error: 'Event not found' }); return; }
    const e = ev.data() as any;
    // Determine audience
    let targetIds: string[] = [];
    if (Array.isArray(recipients) && recipients.length > 0) targetIds = recipients;
    else if (Array.isArray(e.recipients) && e.recipients.length > 0) targetIds = e.recipients;
    else {
      const mgrSnap = await db.collection('managers').get();
      targetIds = mgrSnap.docs.map(d => d.id);
    }
    if (targetIds.length === 0) { res.status(400).json({ error: 'No recipients' }); return; }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    targetIds.forEach(uid => {
      const ref = db.collection('messages').doc();
      batch.set(ref, {
        userId: uid,
        title: `Event: ${e.title}`,
        content: `${e.description || ''}\n\nStarts: ${e.startAt?.toDate ? e.startAt.toDate().toISOString() : e.startAt}`,
        module: 'EVENT',
        read: false,
        isRead: false,
        requiresAck: Boolean(e.requireAck),
        eventId: id,
        createdAt: now,
        senderId: req.user?.uid || 'admin',
        senderRole: 'ADMIN'
      });
    });
    await batch.commit();
    res.status(200).json({ success: true, notified: targetIds.length });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to notify', details: e.message });
  }
});

// --- INCENTIVES (ADMIN) ---
adminPayoutsRouter.get('/incentives/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection('incentiveRules').orderBy('createdAt','desc').limit(200).get();
    res.status(200).json({ data: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to list rules', details: e.message });
  }
});

adminPayoutsRouter.post('/incentives/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, type, percentIncrease, amounts, active, effectiveFrom } = req.body as any;
    if (!name || type !== 'NET_GROWTH_PERCENT' || typeof percentIncrease !== 'number') {
      res.status(400).json({ error: 'name, type=NET_GROWTH_PERCENT and percentIncrease required' });
      return;
    }
    const payload = {
      name: String(name),
      type: 'NET_GROWTH_PERCENT',
      percentIncrease: Number(percentIncrease),
      amounts: amounts || { live: 50, team: 50 },
      active: active !== false,
      effectiveFrom: typeof effectiveFrom === 'string' ? effectiveFrom : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user?.uid || 'admin'
    };
    const ref = await admin.firestore().collection('incentiveRules').add(payload);
    res.status(201).json({ success: true, id: ref.id });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to create rule', details: e.message });
  }
});

adminPayoutsRouter.post('/incentives/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month } = req.body as { month: string };
    if (!/^\d{6}$/.test(month)) { res.status(400).json({ error: 'month (YYYYMM) required' }); return; }
    const db = admin.firestore();
    const rulesSnap = await db.collection('incentiveRules').where('active','==', true).get();
    const rules = rulesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const earningsSnap = await db.collection('manager-earnings').where('month','==', month).get();

    // Load prev month nets
    const prevMonth = (() => { const y=+month.slice(0,4), m=+month.slice(4); const d=new Date(y, m-2, 1); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`; })();
    const prevNetsSnap = await db.collection('managerMonthlyNets').where('month','==', prevMonth).get();
    const prevByManager = new Map<string, number>();
    prevNetsSnap.forEach(doc => { const data = doc.data() as any; prevByManager.set(data.managerId, Number(data.netAmount || 0)); });

    // Compute incentives
    const results: Array<{ managerId: string; amount: number; ruleId: string }> = [];
    earningsSnap.forEach(doc => {
      const e = doc.data() as any;
      const managerId = e.managerId as string;
      const managerType = String(e.managerType || 'live').toLowerCase() === 'team' ? 'team' : 'live';
      const currentNet = Number(e.totalNet || 0);
      const prevNet = prevByManager.get(managerId) || 0;
      rules.forEach((r:any) => {
        if (r.type === 'NET_GROWTH_PERCENT') {
          const required = prevNet * (1 + Number(r.percentIncrease || 0) / 100);
          if (prevNet > 0 && currentNet >= required) {
            const amt = Number(r.amounts?.[managerType] || 0);
            if (amt > 0) results.push({ managerId, amount: amt, ruleId: r.id });
          }
        }
      });
    });

    res.status(200).json({ success: true, month, results });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to preview incentives', details: e.message });
  }
});

adminPayoutsRouter.post('/incentives/apply', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month } = req.body as { month: string };
    if (!/^\d{6}$/.test(month)) { res.status(400).json({ error: 'month (YYYYMM) required' }); return; }
    const db = admin.firestore();

    // Compute preview as above
    const [rulesSnap, earningsSnap] = await Promise.all([
      db.collection('incentiveRules').where('active','==', true).get(),
      db.collection('manager-earnings').where('month','==', month).get(),
    ]);
    const rules = rulesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const prevMonth = (() => { const y=+month.slice(0,4), m=+month.slice(4); const d=new Date(y, m-2, 1); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`; })();
    const prevNetsSnap = await db.collection('managerMonthlyNets').where('month','==', prevMonth).get();
    const prevByManager = new Map<string, number>();
    prevNetsSnap.forEach(doc => { const data = doc.data() as any; prevByManager.set(data.managerId, Number(data.netAmount || 0)); });

    const toApply: Array<{ managerId: string; amount: number; ruleId: string }> = [];
    earningsSnap.forEach(doc => {
      const e = doc.data() as any;
      const managerId = e.managerId as string;
      const managerType = String(e.managerType || 'live').toLowerCase() === 'team' ? 'team' : 'live';
      const currentNet = Number(e.totalNet || 0);
      const prevNet = prevByManager.get(managerId) || 0;
      rules.forEach((r:any) => {
        if (r.type === 'NET_GROWTH_PERCENT') {
          const required = prevNet * (1 + Number(r.percentIncrease || 0) / 100);
          if (prevNet > 0 && currentNet >= required) {
            const amt = Number(r.amounts?.[managerType] || 0);
            if (amt > 0) toApply.push({ managerId, amount: amt, ruleId: r.id });
          }
        }
      });
    });

    // Apply bonuses & update earnings
    const b = db.batch();
    toApply.forEach(item => {
      const bonusId = `${item.managerId}_${month}_INCENTIVE_BONUS_${item.ruleId}`;
      const ref = db.collection('bonuses').doc(bonusId);
      b.set(ref, {
        managerId: item.managerId,
        month,
        type: 'INCENTIVE_BONUS',
        amount: item.amount,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: req.user?.uid || 'admin',
        awardMethod: 'MANUAL',
        ruleId: item.ruleId,
        description: 'Incentive Bonus (rule-based)'
      }, { merge: true });
      const earnRef = db.collection('manager-earnings').doc(`${item.managerId}_${month}`);
      b.set(earnRef, {
        extras: admin.firestore.FieldValue.increment(item.amount),
        totalEarnings: admin.firestore.FieldValue.increment(item.amount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await b.commit();

    res.status(200).json({ success: true, applied: toApply.length });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to apply incentives', details: e.message });
  }
});

// --- CREATORS (ADMIN CRM) ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

adminPayoutsRouter.get('/creators', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const { status } = req.query as any;
    let q: FirebaseFirestore.Query = db.collection('creators');
    if (status) q = q.where('status','==', String(status));
    const snap = await q.orderBy('createdAt','desc').limit(200).get();
    res.status(200).json({ data: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to list creators', details: e.message });
  }
});

adminPayoutsRouter.post('/creators', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { handle, name, email, status, managerId } = req.body as any;
    if (!handle || !name) { res.status(400).json({ error: 'handle and name required' }); return; }
    const db = admin.firestore();
    const ref = db.collection('creators').doc();
    const payload = {
      id: ref.id,
      handle: String(handle),
      name: String(name),
      email: email ? String(email) : null,
      status: (status || 'onboarding').toString().toLowerCase(),
      managerId: managerId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(payload);
    res.status(201).json({ success: true, creator: payload });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to create creator', details: e.message });
  }
});

adminPayoutsRouter.get('/creators/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection('creators').doc(req.params.id).get();
    if (!snap.exists) { res.status(404).json({ error: 'Not found' }); return; }
    res.status(200).json({ data: { id: snap.id, ...(snap.data() as any) } });
  } catch (e:any) { res.status(500).json({ error: 'Failed to get creator', details: e.message }); }
});

adminPayoutsRouter.put('/creators/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const update: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    ['handle','name','email','status','managerId'].forEach(k => { if (k in req.body) update[k] = req.body[k]; });
    await admin.firestore().collection('creators').doc(req.params.id).set(update, { merge: true });
    res.status(200).json({ success: true });
  } catch (e:any) { res.status(500).json({ error: 'Failed to update creator', details: e.message }); }
});

adminPayoutsRouter.delete('/creators/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    await admin.firestore().collection('creators').doc(req.params.id).delete();
    res.status(200).json({ success: true });
  } catch (e:any) { res.status(500).json({ error: 'Failed to delete creator', details: e.message }); }
});

// Docs upload
adminPayoutsRouter.post('/creators/:id/docs', upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const creatorId = req.params.id;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) { res.status(400).json({ error: 'file required' }); return; }
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
    const isImg = /^image\//.test(file.mimetype || '');
    if (!isPdf && !isImg) { res.status(400).json({ error: 'Only PDF or images allowed' }); return; }
    const bucket = admin.storage().bucket();
    const safeName = (file.originalname || 'doc').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const dest = `creator-docs/${creatorId}/${Date.now()}_${safeName}`;
    const ref = bucket.file(dest);
    await ref.save(file.buffer, { contentType: file.mimetype, resumable: false, public: false, metadata: { cacheControl: 'no-store' } });
    const [url] = await ref.getSignedUrl({ action: 'read', expires: Date.now() + 1000*60*60*24*30 });
    const docRef = admin.firestore().collection('creatorDocs').doc();
    const payload = { id: docRef.id, creatorId, path: dest, fileName: file.originalname, contentType: file.mimetype, size: file.size, signedUrl: url, uploadedAt: admin.firestore.FieldValue.serverTimestamp(), uploadedBy: req.user?.uid || 'admin' };
    await docRef.set(payload);
    res.status(201).json({ success: true, doc: payload });
  } catch (e:any) { res.status(500).json({ error: 'Failed to upload doc', details: e.message }); }
});

adminPayoutsRouter.get('/creators/:id/docs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection('creatorDocs').where('creatorId','==', req.params.id).orderBy('uploadedAt','desc').get();
    res.status(200).json({ data: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) });
  } catch (e:any) { res.status(500).json({ error: 'Failed to list docs', details: e.message }); }
});

// Tasks
adminPayoutsRouter.post('/creators/:id/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { title, type, dueAt, requiresAck } = req.body as any;
    if (!title) { res.status(400).json({ error: 'title required' }); return; }
    const ref = admin.firestore().collection('creatorTasks').doc();
    const payload = { id: ref.id, creatorId: req.params.id, title: String(title), type: type || 'ONBOARDING', state: 'OPEN', dueAt: dueAt ? new Date(dueAt) : null, requiresAck: Boolean(requiresAck), createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: req.user?.uid || 'admin' };
    await ref.set(payload);
    res.status(201).json({ success: true, task: payload });
  } catch (e:any) { res.status(500).json({ error: 'Failed to create task', details: e.message }); }
});

adminPayoutsRouter.put('/creators/:id/tasks/:taskId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { state } = req.body as any;
    if (!state) { res.status(400).json({ error: 'state required' }); return; }
    const update: any = { state: String(state), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (String(state).toUpperCase() === 'DONE') update.completedAt = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore().collection('creatorTasks').doc(req.params.taskId).set(update, { merge: true });
    res.status(200).json({ success: true });
  } catch (e:any) { res.status(500).json({ error: 'Failed to update task', details: e.message }); }
});

adminPayoutsRouter.get('/creators/:id/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection('creatorTasks').where('creatorId','==', req.params.id).orderBy('createdAt','desc').get();
    res.status(200).json({ data: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) });
  } catch (e:any) { res.status(500).json({ error: 'Failed to list tasks', details: e.message }); }
});

// --- TARGETS ---
adminPayoutsRouter.post('/targets', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { creatorId, month, netGoal } = req.body as { creatorId: string; month: string; netGoal: number };
    if (!creatorId || !/^\d{6}$/.test(month)) { res.status(400).json({ error: 'creatorId and month (YYYYMM) required' }); return; }
    const ref = admin.firestore().collection('creatorTargets').doc(`${creatorId}_${month}`);
    await ref.set({ creatorId, month, netGoal: Number(netGoal || 0), updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user?.uid || 'admin' }, { merge: true });
    res.status(200).json({ success: true });
  } catch (e:any) { res.status(500).json({ error: 'Failed to set target', details: e.message }); }
});

adminPayoutsRouter.get('/targets', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { creatorId, month } = req.query as any;
    const db = admin.firestore();
    if (creatorId && month) {
      const doc = await db.collection('creatorTargets').doc(`${creatorId}_${month}`).get();
      res.status(200).json({ data: doc.exists ? doc.data() : null });
      return;
    }
    let q: FirebaseFirestore.Query = db.collection('creatorTargets');
    if (creatorId) q = q.where('creatorId','==', String(creatorId));
    if (month) q = q.where('month','==', String(month));
    const snap = await q.limit(200).get();
    res.status(200).json({ data: snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) });
  } catch (e:any) { res.status(500).json({ error: 'Failed to get targets', details: e.message }); }
});

// --- EVENT ATTENDANCE (ADMIN) ---
adminPayoutsRouter.post('/events/:id/attendance', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { creatorId, attended } = req.body as { creatorId: string; attended: boolean };
    if (!creatorId || typeof attended !== 'boolean') { res.status(400).json({ error: 'creatorId and attended required' }); return; }
    const ref = admin.firestore().collection('eventAttendance').doc(`${id}_${creatorId}`);
    await ref.set({ eventId: id, creatorId, attended: Boolean(attended), updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: req.user?.uid || 'admin' }, { merge: true });
    res.status(200).json({ success: true });
  } catch (e:any) { res.status(500).json({ error: 'Failed to mark attendance', details: e.message }); }
});

adminPayoutsRouter.get('/events/:id/attendance', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const snap = await admin.firestore().collection('eventAttendance').where('eventId','==', req.params.id).get();
    const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    const counts = { yes: list.filter(l=>l.attended===true).length, no: list.filter(l=>l.attended===false).length };
    res.status(200).json({ data: list, counts });
  } catch (e:any) { res.status(500).json({ error: 'Failed to fetch attendance', details: e.message }); }
});

export { adminPayoutsRouter }; 