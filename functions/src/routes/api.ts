import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { getManagerEarnings } from "../earnings/getManager";
import { requestPayout } from "../payouts/requestPayout";
import { getManagerPerformance } from "../managers/getPerformance";
import { getTeamPerformance } from "../managers/getTeamPerformance";
import { getAvailableEarnings } from "../payouts/getAvailable";
import { getManagers } from "../managers/getManagers";
import { createUploadMetadata } from "../uploads/createMetadata";
import { processUploadedExcel } from "../excel-calculator"; // Import the new function
import { getAllManagerEarnings } from "../managers/getAllEarnings";
import { getMessages, markMessageAsRead } from "../messages/getMessages";
import { createMessage } from "../messages/createMessage";
import { broadcastMessage, getBroadcastStatus } from "../messages/broadcast";
import { getUnreadMessagesCount } from "../messages/getUnreadCount";
import { getUploadBatchStatus } from "../uploads/getUploadStatus";
import { adminPayoutsRouter } from "./admin";
import { AuthenticatedRequest } from "../middleware/auth";
import { Response } from "express";
import * as admin from "firebase-admin";
import { 
  getAllGenealogy,
  getGenealogyByTeamHandle,
  createGenealogy,
  updateGenealogy,
  deleteGenealogy,
  getTeamByManagerId,
  getDownlineCompensation
} from "../genealogy/genealogy";
import { CommissionConfigService } from "../services/commissionConfig";
import { getMonthlyFxRate } from "../fx/getMonthlyRate";
import { getProfile, changePassword, changeEmail, updateBank, adminUpdateManagerCredentials, adminUpdateManagerBank } from "../auth/profile";

const apiRouter = Router();

// Health check endpoint (no auth required)
apiRouter.get("/health", async (req, res) => {
    try {
        const db = admin.firestore();
        
        // Test Firestore connection
        await db.collection("_health").doc("test").set({
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            test: true
        });
        
        // Clean up test document
        await db.collection("_health").doc("test").delete();
        
        res.status(200).json({
            status: "healthy",
            services: {
                firestore: "connected",
                functions: "running",
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error("Health check failed:", error);
        res.status(503).json({
            status: "unhealthy",
            error: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// All other API routes are protected
apiRouter.use(authMiddleware);

// --- PROFILE / AUTH ---
apiRouter.get('/auth/profile', getProfile);
apiRouter.put('/auth/change-password', changePassword);
apiRouter.put('/auth/change-email', changeEmail);
apiRouter.put('/managers/me/bank', updateBank);

// Admin variants
apiRouter.put('/admin/managers/:managerId/credentials', adminUpdateManagerCredentials);
apiRouter.put('/admin/managers/:managerId/bank', adminUpdateManagerBank);

// --- FX RATES ---
apiRouter.get('/fx/monthly', getMonthlyFxRate);

// --- UPLOADS ---
apiRouter.post("/uploads/metadata", createUploadMetadata); // ✅ Fixed: uploads (with s)

// Route to trigger processing
apiRouter.post("/uploads/process", async (req: AuthenticatedRequest, res: Response) => {
  const { batchId } = req.body;

  if (!batchId) {
    return res.status(400).json({ error: "batchId is required." });
  }

  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'ADMIN')) {
    return res.status(403).json({ error: "Access Denied: Admin role required." });
  }

  try {
    const dbref = admin.firestore().collection('uploadBatches').doc(batchId);
    const snap = await dbref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    const data = snap.data() as any;

    // If already processing or completed, do not start a duplicate run
    if (data?.status === 'PROCESSING' || data?.status === 'DOWNLOADING' || data?.status === 'CALCULATING' || data?.isProcessing === true) {
      return res.status(202).json({ message: 'Processing already running', batchId });
    }
    if (data?.status === 'COMPLETED') {
      return res.status(409).json({ message: 'Batch already completed', batchId });
    }

    // Optionally mark as queued for visibility
    await dbref.update({ status: 'QUEUED', updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    // Start asynchronously; function itself sets isProcessing and statuses
    processUploadedExcel(batchId).catch(async (err) => {
      console.error(`Error processing batch ${batchId} in background:`, err);
      try {
        await dbref.update({
          isProcessing: false,
          status: 'FAILED',
          error: err?.message || String(err),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch {}
    });

    return res.status(202).json({ 
      message: "Processing started.",
      batchId: batchId
    });
  } catch (error) {
    console.error(`Failed to start processing for batch ${batchId}:`, error);
    return res.status(500).json({ error: "Failed to start processing." });
  }
});

apiRouter.get("/uploads/batches", async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Access Denied: Admin role required." });
    }
    try {
        const db = admin.firestore();
        const limit = parseInt(req.query.limit as string) || 5;
        const snapshot = await db.collection("uploadBatches") // ✅ Changed from upload-metadata
            .orderBy("createdAt", "desc")
            .limit(limit)
            .get();
        const batches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json({ data: batches }); // ✅ Wrap in data for consistency
    } catch (error) {
        console.error("💥 Error fetching upload batches:", error);
        return res.status(500).json({ error: "Failed to fetch upload batches." });
    }
});

apiRouter.get("/uploads/batches/:id", async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Access Denied: Admin role required." });
    }
    try {
        const db = admin.firestore();
        const { id } = req.params;
        const doc = await db.collection("uploadBatches").doc(id).get(); // ✅ Changed from upload-metadata
        if (!doc.exists) {
            return res.status(404).json({ error: "Batch not found" });
        }
        return res.status(200).json({ id: doc.id, ...doc.data() });
    } catch (error) {
        console.error(`💥 Error fetching batch ${req.params.id}:`, error);
        return res.status(500).json({ error: "Failed to fetch batch details." });
    }
});

apiRouter.get("/uploads/batches/:id/transactions", async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: "Access Denied: Admin role required." });
    }
    try {
        const db = admin.firestore();
        const { id } = req.params;
        const snapshot = await db.collection("transactions")
            .where("batchId", "==", id)
            .orderBy("createdAt", "desc")
            .get();
        const transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json(transactions);
    } catch (error) {
        console.error(`💥 Error fetching transactions for batch ${req.params.id}:`, error);
        return res.status(500).json({ error: "Failed to fetch batch transactions." });
    }
});

// Upload status route - FIXED: Removed duplicate
apiRouter.get("/uploads/status/:batchId", getUploadBatchStatus);

// --- BATCH MANAGEMENT SYSTEM ---

// Get all batches with metadata
apiRouter.get("/batches", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    try {
        const db = admin.firestore();
        
        const batchesSnapshot = await db.collection('uploadBatches')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();
        
        const batches = [] as any[];
        
        for (const doc of batchesSnapshot.docs) {
            const batchData = doc.data();
            const batchId = doc.id;
            
            const summaryDoc = await db.collection('batch-summaries').doc(batchId).get();
            const summaryData = summaryDoc.exists ? summaryDoc.data() : {};
            
            batches.push({
                batchId: batchId,
                fileName: batchData.fileName || batchData.filename || 'Unknown File',
                month: batchData.month || '',
                status: batchData.status || 'UNKNOWN',
                active: batchData.active === true,
                uploadedAt: (batchData.createdAt && (batchData.createdAt.toDate ? batchData.createdAt.toDate().toISOString() : batchData.createdAt)) || batchData.uploadedAt || new Date().toISOString(),
                processedRows: (summaryData as any)?.processedRows || batchData.processedRows || 0,
                totalRows: (summaryData as any)?.totalRows || batchData.totalRows || 0,
                managersProcessed: (summaryData as any)?.managersProcessed || batchData.managersProcessed || 0,
                totalRevenue: (summaryData as any)?.totalRevenue || batchData.totalRevenue || 0,
                totalCommissions: (summaryData as any)?.totalCommissions || batchData.totalCommissions || 0,
                totalBonuses: (summaryData as any)?.totalBonuses || batchData.totalBonuses || 0,
                collections: {
                    transactions: (summaryData as any)?.collections?.transactions || 0,
                    bonuses: (summaryData as any)?.collections?.bonuses || 0,
                    managerEarnings: (summaryData as any)?.collections?.managerEarnings || 0,
                    processedManagers: (summaryData as any)?.collections?.processedManagers || 0
                }
            });
        }
        
        res.status(200).json({
            success: true,
            batches: batches,
            count: batches.length
        });
        
    } catch (error) {
        console.error('💥 Error fetching batches:', error);
        res.status(500).json({ 
            error: "Failed to fetch batch data",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Clear month endpoint - deletes all data for a given month and marks batches
apiRouter.delete("/months/:month", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }
    try {
        const { month } = req.params;
        const db = admin.firestore();

        const collections = ['transactions', 'manager-earnings', 'bonuses'];
        let totalDeleted = 0;

        for (const col of collections) {
            const snap = await db.collection(col).where('month', '==', month).get();
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            totalDeleted += snap.size;
        }

        // Mark all batches for this month as CLEARED
        const batchesSnap = await db.collection('uploadBatches').where('month', '==', month).get();
        const updateBatch = db.batch();
        batchesSnap.docs.forEach(d => updateBatch.update(d.ref, { status: 'CLEARED', active: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
        await updateBatch.commit();

        res.status(200).json({ success: true, results: { totalDocumentsDeleted: totalDeleted, batchesProcessed: batchesSnap.size } });
    } catch (error) {
        console.error('💥 Error clearing month data:', error);
        res.status(500).json({ error: 'Failed to clear month data', details: error instanceof Error ? error.message : 'Unknown error' });
    }
});

// Get specific batch information
apiRouter.get("/batches/:batchId", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    try {
        const { batchId } = req.params;
        const db = admin.firestore();
        
        // Get batch data
        const batchDoc = await db.collection('uploadBatches').doc(batchId).get();
        if (!batchDoc.exists) {
            res.status(404).json({ error: "Batch not found" });
            return;
        }
        
        const batchData = batchDoc.data()!;
        
        // Get summary data
        const summaryDoc = await db.collection('batch-summaries').doc(batchId).get();
        const summaryData = summaryDoc.exists ? summaryDoc.data() : {};
        
        res.status(200).json({
            batchId: batchId,
            ...batchData,
            ...summaryData
        });
        
    } catch (error) {
        console.error(`💥 Error fetching batch ${req.params.batchId}:`, error);
        res.status(500).json({ 
            error: "Failed to fetch batch details",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// Delete batch and all related data
apiRouter.delete("/batches/:batchId", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    try {
        const { batchId } = req.params;
        const db = admin.firestore();
        
        console.log(`🗑️ Starting deletion of batch: ${batchId}`);
        
        // Collections to clean up
        const collections = [
            'transactions',
            'manager-earnings', 
            'bonuses',
            'genealogy',
            'uploadBatches',
            'batch-summaries'
        ];
        
        let totalDeleted = 0;
        const batch = db.batch();
        
        // Delete from each collection
        for (const collectionName of collections) {
            const snapshot = await db.collection(collectionName)
                .where('batchId', '==', batchId)
                .get();
                
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
                totalDeleted++;
            });
        }
        
        // Also delete the batch document itself
        const batchDoc = await db.collection('uploadBatches').doc(batchId).get();
        if (batchDoc.exists) {
            batch.delete(batchDoc.ref);
            totalDeleted++;
        }
        
        // Delete summary document
        const summaryDoc = await db.collection('batch-summaries').doc(batchId).get();
        if (summaryDoc.exists) {
            batch.delete(summaryDoc.ref);
            totalDeleted++;
        }
        
        await batch.commit();
        
        console.log(`✅ Batch ${batchId} deletion complete. Deleted ${totalDeleted} documents.`);
        
        res.status(200).json({
            success: true,
            result: {
                batchId: batchId,
                documentsDeleted: totalDeleted
            }
        });
        
    } catch (error) {
        console.error(`💥 Error deleting batch ${req.params.batchId}:`, error);
        res.status(500).json({ 
            error: "Failed to delete batch",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// --- DASHBOARD UPDATES ---

// Get real-time dashboard updates
apiRouter.get("/dashboard/updates", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    try {
        const db = admin.firestore();
        
        // Get recent dashboard updates from the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const updatesSnapshot = await db.collection('dashboard-updates')
            .where('timestamp', '>=', admin.firestore.Timestamp.fromDate(twentyFourHoursAgo))
            .orderBy('timestamp', 'desc')
            .limit(20)
            .get();
        
        const updates = updatesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp.toDate().toISOString()
        }));
        
        res.status(200).json({
            success: true,
            updates: updates,
            count: updates.length,
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('💥 Error fetching dashboard updates:', error);
        res.status(500).json({ 
            error: "Failed to fetch dashboard updates",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// --- PROCESSED MANAGERS ---

// Get processed managers for a specific month
apiRouter.get("/processed-managers/:month", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: "Access Denied: Admin role required." });
    return;
  }

  try {
    const { month } = req.params;
    const db = admin.firestore();
    
    // If there are no batches at all for this month, return empty to avoid stale data
    const anyBatchesSnap = await db.collection('uploadBatches').where('month', '==', month).limit(1).get();
    if (anyBatchesSnap.empty) {
      res.status(200).json({
        success: true,
        month,
        summary: {
          totalManagers: 0,
          totalRevenue: 0,
          totalCommissions: 0,
          totalBonuses: 0,
          totalTransactions: 0,
          lastUpdated: new Date().toISOString()
        },
        managers: [],
        count: 0,
        cached: false,
        loadTime: Date.now()
      });
      return;
    }
    
    // Prefer active batch for the month
    const activeBatchSnap = await db.collection('uploadBatches').where('month', '==', month).where('active', '==', true).limit(1).get();
    const preferredBatchId = activeBatchSnap.empty ? null : activeBatchSnap.docs[0].id;

    // Load all manager earnings for the month
    const earningsSnapshot = await db.collection('manager-earnings')
      .where('month', '==', month)
      .get();

    const earningsDocs = earningsSnapshot.docs;
    const managerIds = earningsDocs.map(d => (d.data().managerId as string)).filter(Boolean);

    // Fetch commission config once
    const config = await CommissionConfigService.getInstance().getActiveConfig();
    const diamondThreshold = config.diamondThreshold ?? 1.2;

    // Prepare parallel fetches to eliminate N+1 patterns
    const prevMonth = (() => {
      const y = Number(month.slice(0,4));
      const m = Number(month.slice(4));
      const d = new Date(y, m - 2, 1);
      return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
    })();

    // 1) Managers documents (parallel gets)
    const managerDocPromises = managerIds.map(id => db.collection('managers').doc(id).get());

    // 2) Bonuses for this month (single query, grouped by manager)
    const bonusesPromise = db.collection('bonuses')
      .where('month','==', month)
      .get();

    // 3) Fallback creator counts: only if any earnings doc lacks creatorCount
    const needsCreatorCounts = earningsDocs.some(d => !(d.data().creatorCount > 0));
    const transactionsPromise = needsCreatorCounts
      ? db.collection('transactions').where('month','==', month).get()
      : Promise.resolve(null as any);

    // 4) Previous month net docs for diamond eligibility (parallel gets)
    const prevNetDocPromises = managerIds.map(id => db.collection('managerMonthlyNets').doc(`${id}_${prevMonth}`).get());

    // Await parallel fetches
    const [managerDocSnaps, bonusesSnap, transactionsSnap, prevNetDocSnaps] = await Promise.all([
      Promise.all(managerDocPromises),
      bonusesPromise,
      transactionsPromise,
      Promise.all(prevNetDocPromises),
    ]);

    // Build helpers/maps
    const managersMap = new Map<string, any>();
    (managerDocSnaps || []).forEach(doc => { if (doc && doc.exists) managersMap.set(doc.id, doc.data()); });

    const extrasByManager = new Map<string, { recruitment: number; graduation: number; diamond: number }>();
    if (bonusesSnap) {
      bonusesSnap.forEach((bDoc: any) => {
        const b = bDoc.data();
        const mid = String(b.managerId || '');
        if (!mid) return;
        const entry = extrasByManager.get(mid) || { recruitment: 0, graduation: 0, diamond: 0 };
        const t = String(b.type || '').toUpperCase();
        const amt = b.amount || 0;
        if (t === 'RECRUITMENT_BONUS') entry.recruitment += amt;
        if (t === 'GRADUATION_BONUS') entry.graduation += amt;
        if (t === 'DIAMOND_BONUS') entry.diamond += amt;
        extrasByManager.set(mid, entry);
      });
    }

    const creatorCountsByManager = new Map<string, number>();
    if (transactionsSnap) {
      const perManagerCreators = new Map<string, Set<string>>();
      transactionsSnap.forEach((tDoc: any) => {
        const t = tDoc.data();
        const mid = String(t.managerId || '');
        if (!mid) return;
        if (!perManagerCreators.has(mid)) perManagerCreators.set(mid, new Set<string>());
        const cid = String(t.creatorId || 'unknown');
        perManagerCreators.get(mid)!.add(cid);
      });
      perManagerCreators.forEach((set, mid) => creatorCountsByManager.set(mid, set.size));
    }

    const prevNetByManager = new Map<string, number>();
    (prevNetDocSnaps || []).forEach(doc => {
      if (!doc || !doc.exists) return;
      const data: any = doc.data();
      // doc id is `${managerId}_${prevMonth}`; extract managerId reliably
      const id = String(doc.id);
      const idx = id.lastIndexOf('_');
      const mid = idx > 0 ? id.slice(0, idx) : (data.managerId || '');
      prevNetByManager.set(mid, Number(data.netAmount || 0));
    });

    const managers: any[] = [];
    let totalRevenue = 0;
    let totalCommissions = 0; // total payout = base + milestone + extras
    let totalBonuses = 0; // milestone payouts only
    let totalBase = 0; // sum of base commissions
    let totalTransactions = 0;

    for (const doc of earningsDocs) {
      const data = doc.data() as any;
      const managerId = data.managerId as string;
      const managerData = managersMap.get(managerId) || {};

      const milestoneSum = data.milestonePayouts || 0;
      const extrasSum = data.extras || 0;
      const base = data.baseCommission || 0;
      const total = base + milestoneSum + extrasSum;

      // Prefer stored creatorCount; fallback from aggregated map if missing
      const creatorCount = data.creatorCount || creatorCountsByManager.get(managerId) || 0;

      // Extras breakdown pre-aggregated
      const extrasBreakdown = extrasByManager.get(managerId) || { recruitment: 0, graduation: 0, diamond: 0 };

      // Diamond eligibility using preloaded prev month net and config threshold
      let diamondEligible: boolean | null = null;
      const prevNet = prevNetByManager.get(managerId) || 0;
      if (prevNet > 0) {
        const currentNet = data.totalNet || 0;
        diamondEligible = currentNet >= diamondThreshold * prevNet;
      }

      managers.push({
        managerId: managerId,
        managerHandle: (managerData?.handle || managerData?.name || managerId) as string,
        managerType: (managerData?.type || data.managerType || 'live').toString().toLowerCase(),
        totalGross: data.totalGross || 0,
        totalNet: data.totalNet || 0,
        baseCommission: base,
        totalBonuses: milestoneSum, // milestone payouts only (for column)
        transactionCount: data.transactionCount || 0,
        creatorCount: creatorCount,
        downlineEarnings: data.downlineEarnings || 0,
        processingDate: data.calculatedAt ? data.calculatedAt.toDate().toISOString() : new Date().toISOString(),
        month: month,
        batchId: data.batchId || preferredBatchId || 'unknown',
        totalEarnings: total,
        extrasTotal: extrasSum,
        extrasBreakdown,
        diamondEligible,
      });

      totalRevenue += data.totalGross || 0;
      totalCommissions += total;
      totalBonuses += milestoneSum;
      totalBase += base;
      totalTransactions += data.transactionCount || 0;
    }

    // Safeguard: total payout must not exceed revenue (summary level)
    const cappedCommissions = Math.min(totalCommissions, totalRevenue);

    const reportData = {
      success: true,
      month: month,
      summary: {
        totalManagers: managers.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCommissions: Math.round(cappedCommissions * 100) / 100,
        totalBonuses: Math.round(totalBonuses * 100) / 100,
        baseCommissions: Math.round(totalBase * 100) / 100,
        totalTransactions: totalTransactions,
        lastUpdated: new Date().toISOString()
      },
      managers: managers,
      count: managers.length,
      cached: false,
      loadTime: Date.now()
    };
    
    res.set('Cache-Control', 'private, max-age=60');
    res.status(200).json(reportData);
    
  } catch (error) {
    console.error(`💥 Error loading processed managers for ${req.params.month}:`, error);
    res.status(500).json({ 
      error: "Failed to load processed managers",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// --- DUPLICATES REPORT ---

// Get duplicates report for data integrity
apiRouter.get("/duplicates", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: "Access Denied: Admin role required." });
        return;
    }

    try {
        // This is a simplified duplicates check
        // In a real implementation, you'd have more sophisticated duplicate detection
        
        const report = {
            summary: {
                totalDuplicates: 0,
                affectedBatches: 0,
                dataIntegrityScore: 100.0
            },
            batches: []
        };
        
        res.status(200).json({
            success: true,
            report: report
        });
        
    } catch (error) {
        console.error('💥 Error generating duplicates report:', error);
        res.status(500).json({ 
            error: "Failed to generate duplicates report",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

// --- MANAGERS ---
apiRouter.get("/managers", getManagers);
apiRouter.get("/managers/earnings-v2", getAllManagerEarnings);
apiRouter.get("/managers/:managerId/earnings-v2", getManagerEarnings); // Add missing route with v2 endpoint
apiRouter.get("/managers/:managerId/performance", getManagerPerformance);
apiRouter.get("/managers/:managerId/team", getTeamPerformance);

// New: Creators endpoints (informational only)
apiRouter.get('/creators/top', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = admin.firestore();
    const month = (req.query.month as string) || (new Date().toISOString().slice(0,7).replace('-',''));
    // Aggregate transactions by creatorId + managerId for the month
    const snap = await db.collection('transactions').where('month','==', month).get();
    const aggregate = new Map<string, { creatorId: string; creatorHandle: string; managerId: string; managerHandle?: string; gross: number; net: number; base: number }>();
    for (const d of snap.docs) {
      const t: any = d.data();
      const key = `${t.creatorId || 'unknown'}__${t.managerId}`;
      const current = aggregate.get(key) || { creatorId: t.creatorId || 'unknown', creatorHandle: t.creatorHandle || 'unknown', managerId: t.managerId, managerHandle: undefined, gross: 0, net: 0, base: 0 };
      current.gross += t.grossAmount || 0;
      current.net += t.netForCommission || 0;
      current.base += t.baseCommission || 0;
      aggregate.set(key, current);
    }
    // Resolve manager handles
    const managerIds = Array.from(new Set(Array.from(aggregate.values()).map(v => v.managerId)));
    const managers: Record<string, any> = {};
    for (const mid of managerIds) {
      const mdoc = await db.collection('managers').doc(mid).get();
      managers[mid] = mdoc.exists ? mdoc.data() : {};
    }
    const items = Array.from(aggregate.values()).map(v => ({
      creatorId: v.creatorId,
      creatorHandle: v.creatorHandle,
      managerId: v.managerId,
      managerHandle: managers[v.managerId]?.handle || managers[v.managerId]?.name || v.managerId,
      grossAmount: Math.round(v.gross * 100) / 100,
      netAmount: Math.round(v.net * 100) / 100,
      baseCommission: Math.round(v.base * 100) / 100,
    }));
    items.sort((a,b) => (b.netAmount - a.netAmount));
    res.status(200).json({ success: true, month, count: items.length, items });
  } catch (e:any) {
    console.error('💥 Error loading top creators:', e);
    res.status(500).json({ error: 'Failed to load top creators', details: e.message });
  }
});

apiRouter.get('/managers/:managerId/creators', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { managerId } = req.params;
    if (!req.user || (req.user.role !== 'ADMIN' && req.user.managerId !== managerId)) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }
    const month = (req.query.month as string) || (new Date().toISOString().slice(0,7).replace('-',''));
    const db = admin.firestore();
    const snap = await db.collection('transactions').where('month','==', month).where('managerId','==', managerId).get();
    const byCreator = new Map<string, { creatorId: string; creatorHandle: string; gross: number; net: number; base: number; count: number }>();
    for (const d of snap.docs) {
      const t: any = d.data();
      const cid = t.creatorId || 'unknown';
      const cur = byCreator.get(cid) || { creatorId: cid, creatorHandle: t.creatorHandle || 'unknown', gross: 0, net: 0, base: 0, count: 0 };
      cur.gross += t.grossAmount || 0;
      cur.net += t.netForCommission || 0;
      cur.base += t.baseCommission || 0;
      cur.count += 1;
      byCreator.set(cid, cur);
    }
    const creators = Array.from(byCreator.values()).sort((a,b) => b.net - a.net);
    res.status(200).json({ success: true, month, managerId, count: creators.length, creators });
  } catch (e:any) {
    console.error('💥 Error loading manager creators:', e);
    res.status(500).json({ error: 'Failed to load manager creators', details: e.message });
  }
});

// Manager Accounts CRUD (Admin only)
apiRouter.post('/managers/accounts', async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
    try {
        const db = admin.firestore();
        const { name, handle, type } = req.body as { name?: string; handle?: string; type?: string };
        if (!name || !handle || !type) { res.status(400).json({ error: 'name, handle, type required' }); return; }
        const ref = db.collection('managers').doc();
        await ref.set({ name, handle, type: String(type).toUpperCase(), createdAt: admin.firestore.FieldValue.serverTimestamp(), active: true });
        res.status(201).json({ success: true, id: ref.id });
    } catch (e:any) { res.status(500).json({ error: 'Failed to create manager', details: e.message }); }
});

apiRouter.put('/managers/accounts/:id', async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
    try {
        const db = admin.firestore();
        const { id } = req.params;
        const updates: any = {};
        ['name','handle','type','active'].forEach(k => { if (req.body[k] !== undefined) updates[k] = k === 'type' ? String(req.body[k]).toUpperCase() : req.body[k]; });
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('managers').doc(id).update(updates);
        res.status(200).json({ success: true });
    } catch (e:any) { res.status(500).json({ error: 'Failed to update manager', details: e.message }); }
});

apiRouter.delete('/managers/accounts/:id', async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
    try {
        const db = admin.firestore();
        const { id } = req.params;
        await db.collection('managers').doc(id).delete();
        res.status(200).json({ success: true });
    } catch (e:any) { res.status(500).json({ error: 'Failed to delete manager', details: e.message }); }
});

// Generate Auth accounts for all managers without one (Admin only)
apiRouter.post('/managers/generate-accounts', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
  try {
    const db = admin.firestore();
    const managersSnap = await db.collection('managers').get();

    let created = 0;
    for (const m of managersSnap.docs) {
      const managerId = m.id;
      const data = m.data() as any;
      // Check if a user exists for this manager
      const usersSnap = await db.collection('users').where('managerId', '==', managerId).limit(1).get();
      if (!usersSnap.empty) continue;

      // Prepare email and password
      const handle = (data.handle || data.name || managerId).toString().replace(/\s+/g, '').toLowerCase();
      const email = data.email && /@/.test(data.email) ? data.email : `${handle}@manager.com`;
      const password = `${handle}2024!`;

      // Create Auth user
      const userRecord = await admin.auth().createUser({ email, password, displayName: data.name || handle });
      await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'MANAGER', managerId });

      // Mirror in users collection
      await db.collection('users').doc(userRecord.uid).set({
        email,
        role: 'manager',
        managerId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Persist resolved email back to managers collection for UI accuracy
      await db.collection('managers').doc(managerId).set({
        email,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      created += 1;
    }

    res.status(200).json({ success: true, message: `Generated ${created} account(s)` });
  } catch (e:any) {
    console.error('generate-accounts failed', e);
    res.status(500).json({ error: 'Failed to generate accounts', details: e.message });
  }
});

// Clear all commission-related data (Admin only)
apiRouter.delete('/managers/commission-data', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') { res.status(403).json({ error: 'Admin role required' }); return; }
  try {
    const db = admin.firestore();
    const collections = ['transactions','manager-earnings','bonuses','payoutRequests','uploadBatches','batch-summaries','dashboard-updates'];
    let totalDeleted = 0;
    for (const col of collections) {
      const snap = await db.collection(col).get();
      if (snap.empty) continue;
      const chunkSize = 450;
      for (let i = 0; i < snap.docs.length; i += chunkSize) {
        const chunk = snap.docs.slice(i, i + chunkSize);
        const b = db.batch();
        chunk.forEach(d => b.delete(d.ref));
        await b.commit();
        totalDeleted += chunk.length;
      }
    }
    res.status(200).json({ success: true, message: `Commission data cleared (${totalDeleted} docs)` });
  } catch (e:any) {
    console.error('commission-data clear failed', e);
    res.status(500).json({ error: 'Failed to clear commission data', details: e.message });
  }
});

// --- EARNINGS & PAYOUTS ---
apiRouter.get("/earnings/:managerId", getManagerEarnings); // Keep old route for compatibility
apiRouter.get("/payouts/available", getAvailableEarnings);
apiRouter.post("/payouts/request", requestPayout);

// Admin: list payout requests with optional status filter
apiRouter.get("/payouts", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: "Access Denied: Admin role required." });
    return;
  }
  try {
    const db = admin.firestore();
    const allowed = new Set(["SUBMITTED","APPROVED","IN_PROGRESS","PAID","REJECTED"]);
    const filter = (req.query.filter as string) || '';

    let snapshot: FirebaseFirestore.QuerySnapshot;
    if (filter && allowed.has(filter)) {
      snapshot = await db.collection("payoutRequests").where("status","==",filter).get();
    } else {
      snapshot = await db.collection("payoutRequests").get();
    }

    const payouts = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a:any,b:any) => {
        const aTs = a.requestedAt?.toDate ? a.requestedAt.toDate().getTime() : (a.requestedAt ? Date.parse(a.requestedAt) : 0);
        const bTs = b.requestedAt?.toDate ? b.requestedAt.toDate().getTime() : (b.requestedAt ? Date.parse(b.requestedAt) : 0);
        return bTs - aTs;
      })
      .map((p:any) => ({
        ...p,
        requestedAt: p.requestedAt?.toDate ? p.requestedAt.toDate().toISOString() : (p.requestedAt || null)
      }));

    res.status(200).json({ data: payouts });
  } catch (error) {
    console.error('💥 Error listing payouts:', error);
    res.status(500).json({ error: 'Failed to list payout requests' });
  }
});

// Admin: update payout status
apiRouter.put("/payouts/:id/status", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: "Access Denied: Admin role required." });
    return;
  }
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };

    const allowedStatuses = ["APPROVED","IN_PROGRESS","PAID","REJECTED"] as const;
    if (!status || !allowedStatuses.includes(status as any)) {
      res.status(400).json({ error: 'Invalid status. Must be one of APPROVED, IN_PROGRESS, PAID, REJECTED' });
      return;
    }

    const db = admin.firestore();
    const ref = db.collection('payoutRequests').doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'Payout request not found' });
      return;
    }

    const updateData: any = {
      status,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      decidedBy: req.user!.uid,
    };
    if (adminNotes) updateData.adminNotes = adminNotes;
    updateData.history = admin.firestore.FieldValue.arrayUnion({
      status,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      actor: 'ADMIN',
      userId: req.user!.uid,
      adminNotes: adminNotes || ''
    });

    await ref.update(updateData);

    res.status(200).json({ success: true, message: `Payout ${status.toLowerCase()} successfully` });
  } catch (error) {
    console.error('💥 Error updating payout status:', error);
    res.status(500).json({ error: 'Failed to update payout status' });
  }
});

// Manager: payout history
apiRouter.get("/payouts/history", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user || (req.user.role !== 'MANAGER' && req.user.role !== 'manager')) {
    res.status(403).json({ error: 'Access denied. Manager role required.' });
    return;
  }
  try {
    const db = admin.firestore();
    const managerId = req.user.managerId || req.user.uid;
    const period = (req.query.period as string) || undefined;

    let q: FirebaseFirestore.Query = db.collection('payoutRequests').where('managerId','==',managerId);
    if (period) q = q.where('period','==',period);
    const snapshot = await q.get();

    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a:any,b:any) => {
        const aTs = a.requestedAt?.toDate ? a.requestedAt.toDate().getTime() : (a.requestedAt ? Date.parse(a.requestedAt) : 0);
        const bTs = b.requestedAt?.toDate ? b.requestedAt.toDate().getTime() : (b.requestedAt ? Date.parse(b.requestedAt) : 0);
        return bTs - aTs;
      })
      .map((p:any) => ({
        ...p,
        requestedAt: p.requestedAt?.toDate ? p.requestedAt.toDate().toISOString() : (p.requestedAt || null)
      }));

    res.status(200).json({ success: true, data: items });
  } catch (error) {
    console.error('💥 Error fetching payout history:', error);
    res.status(500).json({ error: 'Failed to fetch payout history' });
  }
});

// Admin: manager-specific payouts
apiRouter.get("/payouts/manager/:managerId", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: "Access Denied: Admin role required." });
    return;
  }
  try {
    const db = admin.firestore();
    const { managerId } = req.params;
    const snapshot = await db.collection('payoutRequests').where('managerId','==',managerId).get();
    const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.status(200).json({ data });
  } catch (error) {
    console.error('💥 Error fetching manager payouts:', error);
    res.status(500).json({ error: 'Failed to fetch manager payouts' });
  }
});

// --- GENEALOGY ---
apiRouter.get("/genealogy", getAllGenealogy);
apiRouter.get("/genealogy/team-handle/:teamManagerHandle", getGenealogyByTeamHandle);
apiRouter.post("/genealogy", createGenealogy);
apiRouter.put("/genealogy/:id", updateGenealogy);
apiRouter.delete("/genealogy/:id", deleteGenealogy);
apiRouter.get("/genealogy/team/:teamManagerId", getTeamByManagerId);
apiRouter.get("/genealogy/compensation", getDownlineCompensation);

// --- MESSAGES ---
apiRouter.get("/messages/unread-count", authMiddleware, getUnreadMessagesCount); // Get unread count first
apiRouter.post("/messages", authMiddleware, createMessage); // Create/send message
apiRouter.post("/messages/broadcast", authMiddleware, broadcastMessage); // Broadcast to all or selected managers
apiRouter.get("/messages/broadcast/:broadcastId/status", authMiddleware, getBroadcastStatus); // Broadcast read status
apiRouter.get("/messages/:userId", authMiddleware, getMessages); // Get messages for specific user (admin allowed)
apiRouter.put("/messages/:messageId/read", authMiddleware, markMessageAsRead); // Mark message as read
apiRouter.get("/messages", authMiddleware, getMessages); // Get all messages for authenticated user (must be last)

// --- TEMPORARY DEMO DATA ENDPOINT ---
apiRouter.post("/admin/create-demo-data", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: "Admin role required" });
    return;
  }

  try {
    const db = admin.firestore();
    const currentMonth = '202508';
    
    console.log('🚀 Creating demo data...');
    
    // Demo managers
    const managers = [
      { id: 'demo_mgr_1', name: 'Alice Schmidt', type: 'LIVE', handle: 'alice_live' },
      { id: 'demo_mgr_2', name: 'Bob Müller', type: 'TEAM', handle: 'bob_team' },
      { id: 'demo_mgr_3', name: 'Carol Weber', type: 'LIVE', handle: 'carol_live' },
      { id: 'demo_mgr_4', name: 'David Fischer', type: 'TEAM', handle: 'david_team' },
      { id: 'demo_mgr_5', name: 'Eva Bauer', type: 'LIVE', handle: 'eva_live' }
    ];

    const batch = db.batch();

    // Create managers
    managers.forEach(manager => {
      const managerRef = db.collection('managers').doc(manager.id);
      batch.set(managerRef, {
        name: manager.name,
        email: `${manager.handle}@trend4media.com`,
        type: manager.type,
        handle: manager.handle,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    // Create earnings
    managers.forEach(manager => {
      const isLive = manager.type === 'LIVE';
      const baseCommission = isLive ? 1850 + Math.random() * 500 : 1000 + Math.random() * 400;
      const totalEarnings = baseCommission + 400 + Math.random() * 400;
      
      const earningsRef = db.collection('manager-earnings').doc(`${manager.id}_${currentMonth}`);
      batch.set(earningsRef, {
        managerId: manager.id,
        month: currentMonth,
        baseCommission: Math.round(baseCommission * 100) / 100,
        totalGross: Math.round((baseCommission / 0.3) * 100) / 100,
        totalNet: Math.round((baseCommission / 0.3 * 0.85) * 100) / 100,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        transactionCount: Math.floor(Math.random() * (isLive ? 60 : 40) + (isLive ? 20 : 10)),
        creatorCount: Math.floor(Math.random() * (isLive ? 25 : 15) + (isLive ? 8 : 5)),
        bonuses: Math.round((totalEarnings - baseCommission) * 100) / 100,
        status: 'CALCULATED',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Create bonuses
      const bonusTypes = ['MILESTONE_S', 'MILESTONE_N', 'DIAMOND_BONUS', 'RECRUITMENT_BONUS'];
      for (let i = 0; i < 2; i++) {
        const bonusRef = db.collection('bonuses').doc(`${manager.id}_${currentMonth}_${i}`);
        batch.set(bonusRef, {
          managerId: manager.id,
          month: currentMonth,
          type: bonusTypes[Math.floor(Math.random() * bonusTypes.length)],
          amount: Math.round((100 + Math.random() * 300) * 100) / 100,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    });

    await batch.commit();
    
    console.log('✅ Demo data created successfully');
    res.json({ 
      success: true, 
      message: 'Demo data created successfully',
      managersCreated: managers.length,
      month: currentMonth
    });

  } catch (error) {
    console.error('💥 Error creating demo data:', error);
    res.status(500).json({ 
      error: 'Failed to create demo data', 
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// --- MAINTENANCE / CLEANUP ---
apiRouter.post('/maintenance/cleanup-orphans', async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: 'Admin role required' });
        return;
    }
    try {
        const db = admin.firestore();
        const { month } = req.body as { month?: string };
        if (!month || !/^\d{6}$/.test(month)) {
            res.status(400).json({ error: 'month (YYYYMM) required' });
            return;
        }
        // if no batches exist for this month, delete any stray docs
        const batchSnap = await db.collection('uploadBatches').where('month', '==', month).limit(1).get();
        if (!batchSnap.empty) {
            res.status(200).json({ success: true, skipped: true, message: 'Batches exist for month; nothing cleaned.' });
            return;
        }
        let totalDeleted = 0;
        for (const col of ['transactions','manager-earnings','bonuses']) {
            const snap = await db.collection(col).where('month','==',month).get();
            if (snap.empty) continue;
            const b = db.batch();
            snap.docs.forEach(d => b.delete(d.ref));
            await b.commit();
            totalDeleted += snap.size;
        }
        res.status(200).json({ success: true, month, totalDeleted });
    } catch (e:any) {
        console.error('cleanup-orphans failed', e);
        res.status(500).json({ error: 'cleanup failed', details: e.message });
    }
});

apiRouter.post('/maintenance/purge-all-excel', async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
        res.status(403).json({ error: 'Admin role required' });
        return;
    }
    try {
        const db = admin.firestore();
        const collections: Array<{ name: string; query?: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> }> = [
            { name: 'transactions' },
            { name: 'manager-earnings' },
            { name: 'bonuses', query: db.collection('bonuses').where('month', '>=', '000000') }, // only monthly bonuses
            { name: 'uploadBatches' },
            { name: 'batch-summaries' },
            { name: 'dashboard-updates' },
        ];
        let totalDeleted = 0;
        for (const c of collections) {
            const colRef = db.collection(c.name);
            const snap = c.query ? await c.query.get() : await colRef.get();
            if (snap.empty) continue;
            const chunkSize = 450;
            for (let i = 0; i < snap.docs.length; i += chunkSize) {
                const chunk = snap.docs.slice(i, i + chunkSize);
                const b = db.batch();
                chunk.forEach(d => b.delete(d.ref));
                await b.commit();
                totalDeleted += chunk.length;
            }
        }
        res.status(200).json({ success: true, totalDeleted });
    } catch (e:any) {
        console.error('purge-all-excel failed', e);
        res.status(500).json({ error: 'purge failed', details: e.message });
    }
});

// --- ADMIN ---
apiRouter.use('/admin', adminPayoutsRouter);

// --- BONUSES (ADMIN) ---

function currentMonthYYYYMM(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function previousMonthYYYYMM(base?: string): string {
  if (base && /^\d{6}$/.test(base)) {
    const year = Number(base.slice(0,4));
    const month = Number(base.slice(4));
    const date = new Date(year, month - 2, 1);
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const d = new Date();
  const date = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function resolveManagerType(db: FirebaseFirestore.Firestore, managerId: string): Promise<'live'|'team'> {
  try {
    const m = await db.collection('managers').doc(managerId).get();
    const t = (m.exists ? (m.data()?.type || 'live') : 'live').toString().toLowerCase();
    return (t === 'team') ? 'team' : 'live';
  } catch { return 'live'; }
}

async function dynamicBonusAmount(type: 'RECRUITMENT_BONUS'|'GRADUATION_BONUS'|'DIAMOND_BONUS', managerType: 'live'|'team'): Promise<number> {
  const config = await CommissionConfigService.getInstance().getActiveConfig();
  if (type === 'RECRUITMENT_BONUS') return (config.recruitmentBonusPayouts?.[managerType] ?? (managerType==='live'?50:60));
  if (type === 'GRADUATION_BONUS') return (config.graduationBonusPayouts?.[managerType] ?? (managerType==='live'?50:60));
  if (type === 'DIAMOND_BONUS') return (config.diamondBonusPayouts?.[managerType] ?? (managerType==='live'?50:60));
  return managerType==='live'?50:60;
}

apiRouter.post('/bonuses/award', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  try {
    const db = admin.firestore();
    const { managerId, period, type, description, amount, force } = req.body as {
      managerId: string;
      period?: string; // YYYYMM
      type: 'RECRUITMENT_BONUS'|'GRADUATION_BONUS'|'DIAMOND_BONUS';
      description?: string;
      amount?: number;
      force?: boolean; // allow admin override for eligibility checks
    };

    if (!managerId || !type) {
      res.status(400).json({ error: 'managerId and type are required' });
      return;
    }

    const month = (period && /^\d{6}$/.test(period)) ? period : currentMonthYYYYMM();

    // Resolve manager type
    const mType = await resolveManagerType(db, managerId);
    const computed = await dynamicBonusAmount(type, mType);
    const finalAmount = Math.round(((typeof amount === 'number' && amount > 0) ? amount : computed) * 100) / 100;

    // Prevent duplicates: one bonus type per manager per month
    const bonusId = `${managerId}_${month}_${type}`;
    const existing = await db.collection('bonuses').doc(bonusId).get();
    if (existing.exists) {
      res.status(409).json({ error: 'Bonus already awarded for this manager and month', code: 'DUPLICATE_BONUS' });
      return;
    }

    // Enforce diamond eligibility unless force=true
    let eligibility: { ok: boolean; note?: string } = { ok: true };
    if (type === 'DIAMOND_BONUS') {
      try {
        const current = await db.collection('manager-earnings').doc(`${managerId}_${month}`).get();
        const prevMonth = previousMonthYYYYMM(month);
        const prev = await db.collection('managerMonthlyNets').doc(`${managerId}_${prevMonth}`).get();
        const currentNet = current.exists ? (current.data()?.totalNet || 0) : 0;
        const prevNet = prev.exists ? (prev.data()?.netAmount || 0) : 0;
        const threshold = (await CommissionConfigService.getInstance().getActiveConfig()).diamondThreshold ?? 1.2;
        const meets = prevNet > 0 && currentNet >= threshold * prevNet;
        if (!meets) {
          eligibility = { ok: false, note: prevNet <= 0 ? 'No previous NET available' : `Current NET ${currentNet.toFixed(2)} < ${(threshold*100).toFixed(0)}% of previous NET ${prevNet.toFixed(2)}` };
        }
        if (!eligibility.ok && !force) {
          res.status(400).json({ error: 'Diamond eligibility not met', details: eligibility.note, code: 'DIAMOND_NOT_ELIGIBLE' });
          return;
        }
      } catch {}
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const bonusRef = db.collection('bonuses').doc(bonusId);

    await bonusRef.set({
      managerId,
      month,
      type,
      amount: finalAmount,
      createdAt: now,
      createdBy: req.user?.uid || 'admin',
      description: description || null,
      managerTypeAtAward: mType,
      awardMethod: 'MANUAL'
    });

    // Reflect immediately in monthly earnings totals (extras + totalEarnings)
    const earningsRef = db.collection('manager-earnings').doc(`${managerId}_${month}`);
    await earningsRef.set({
      managerId,
      month,
      extras: admin.firestore.FieldValue.increment(finalAmount),
      totalEarnings: admin.firestore.FieldValue.increment(finalAmount),
      updatedAt: now,
    }, { merge: true });

    res.status(201).json({ success: true, month, amount: finalAmount, eligibility });
  } catch (e:any) {
    console.error('💥 Award bonus failed', e);
    res.status(500).json({ error: 'Failed to award bonus', details: e.message });
  }
});

// Backward compatibility: recruitment endpoint
apiRouter.post('/bonuses/recruitment', async (req: AuthenticatedRequest, res: Response) => {
  // Map to generic award endpoint
  (req as any).body = {
    managerId: req.body?.managerId,
    period: req.body?.period,
    type: 'RECRUITMENT_BONUS',
    description: req.body?.description,
    amount: req.body?.amount,
  };
  // @ts-ignore - reuse handler
  return (apiRouter as any).handle({ ...req, method: 'POST', url: '/bonuses/award' }, res);
});

// Overview of extras for a given month (admin)
apiRouter.get('/bonuses/overview', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  try {
    const db = admin.firestore();
    const month = (req.query.month as string) || currentMonthYYYYMM();
    const snap = await db.collection('bonuses').where('month','==', month).get();
    const byManager: Record<string, { managerId: string; recruitment: number; graduation: number; diamond: number; total: number } & { managerHandle?: string; managerType?: string; diamondEligible?: boolean } > = {};
    snap.forEach(d => {
      const b = d.data();
      const managerId = b.managerId as string;
      if (!managerId) return;
      if (!byManager[managerId]) byManager[managerId] = { managerId, recruitment: 0, graduation: 0, diamond: 0, total: 0 };
      const amt = Number(b.amount || 0) || 0;
      const t = String(b.type || '').toUpperCase();
      if (t === 'RECRUITMENT_BONUS') byManager[managerId].recruitment += amt;
      if (t === 'GRADUATION_BONUS') byManager[managerId].graduation += amt;
      if (t === 'DIAMOND_BONUS') byManager[managerId].diamond += amt;
      byManager[managerId].total += amt;
    });

    // Attach manager basic info and validate diamond eligibility per manager
    const result = Object.values(byManager);

    const config = await CommissionConfigService.getInstance().getActiveConfig();
    const threshold = config.diamondThreshold ?? 1.2;
    const prevMonth = previousMonthYYYYMM(month);

    await Promise.all(result.map(async (item) => {
      try {
        const m = await db.collection('managers').doc(item.managerId).get();
        (item as any).managerHandle = (m.exists ? (m.data()?.handle || m.data()?.name) : item.managerId) || item.managerId;
        (item as any).managerType = (m.exists ? (m.data()?.type || 'live') : 'live');
      } catch {}

      // Only compute eligibility if there is a diamond amount recorded
      if (item.diamond > 0) {
        try {
          const [current, prev] = await Promise.all([
            db.collection('manager-earnings').doc(`${item.managerId}_${month}`).get(),
            db.collection('managerMonthlyNets').doc(`${item.managerId}_${prevMonth}`).get(),
          ]);
          const currentNet = current.exists ? (current.data()?.totalNet || 0) : 0;
          const prevNet = prev.exists ? (prev.data()?.netAmount || 0) : 0;
          const eligible = prevNet > 0 && currentNet >= threshold * prevNet;
          (item as any).diamondEligible = eligible;
          if (!eligible) {
            // Ignore ineligible diamond amounts in the overview totals to avoid misleading display
            item.diamond = 0;
          }
        } catch {
          (item as any).diamondEligible = null;
        }
      } else {
        (item as any).diamondEligible = false;
      }

      // Recompute total from components to ensure consistency
      item.total = Math.round((item.recruitment + item.graduation + item.diamond) * 100) / 100;
    }));

    res.json({ success: true, month, data: result });
  } catch (e:any) {
    console.error('💥 bonuses/overview failed', e);
    res.status(500).json({ error: 'Failed to load bonuses overview', details: e.message });
  }
});

// Remove a specific extra bonus and resync earnings
apiRouter.delete('/bonuses/:managerId/:month/:type', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  try {
    const db = admin.firestore();
    const { managerId, month, type } = req.params as { managerId: string; month: string; type: string };
    if (!/^\d{6}$/.test(month)) {
      res.status(400).json({ error: 'Invalid month format; expected YYYYMM' });
      return;
    }
    const t = String(type || '').toUpperCase();

    // Delete ALL matching bonus docs regardless of document ID pattern
    const snap = await db.collection('bonuses')
      .where('managerId','==', managerId)
      .where('month','==', month)
      .where('type','==', t)
      .get();

    if (snap.empty) {
      res.status(404).json({ error: 'Bonus not found' });
      return;
    }

    let removedAmount = 0;
    const b = db.batch();
    snap.docs.forEach(d => {
      removedAmount += d.data()?.amount || 0;
      b.delete(d.ref);
    });
    await b.commit();

    // Recompute extras (R+G+D) for the manager+month and update earnings
    const remainingExtrasSnap = await db.collection('bonuses')
      .where('managerId','==', managerId)
      .where('month','==', month)
      .get();
    let newExtras = 0;
    remainingExtrasSnap.forEach(d => {
      const dt = String(d.data()?.type || '').toUpperCase();
      if (dt === 'RECRUITMENT_BONUS' || dt === 'GRADUATION_BONUS' || dt === 'DIAMOND_BONUS') {
        newExtras += d.data()?.amount || 0;
      }
    });

    const earningsRef = db.collection('manager-earnings').doc(`${managerId}_${month}`);
    await db.runTransaction(async (tx) => {
      const e = await tx.get(earningsRef);
      const base = e.exists ? (e.data()?.baseCommission || 0) : 0;
      const milestones = e.exists ? (e.data()?.milestonePayouts || 0) : 0;
      const newTotal = Math.round((base + milestones + newExtras) * 100) / 100;
      tx.set(earningsRef, { extras: newExtras, totalEarnings: newTotal, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });

    // Optional: push a dashboard update event (lightweight)
    try {
      await db.collection('dashboard-updates').add({
        type: 'BONUS_REMOVED',
        managerId,
        month,
        bonusType: t,
        amount: removedAmount,
        updatedExtras: newExtras,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch {}

    res.json({ success: true, managerId, month, type: t, removedAmount, extras: newExtras, removedCount: snap.size });
  } catch (e:any) {
    console.error('💥 delete bonus failed', e);
    res.status(500).json({ error: 'Failed to delete bonus', details: e.message });
  }
});

// Diamond eligibility endpoint for UI indicators
apiRouter.get('/bonuses/eligibility/:managerId', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  try {
    const db = admin.firestore();
    const { managerId } = req.params;
    const month = (req.query.month as string) || (() => { const d=new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`; })();
    const config = await CommissionConfigService.getInstance().getActiveConfig();
    const threshold = config.diamondThreshold ?? 1.2;
    const prevMonth = previousMonthYYYYMM(month);
    const current = await db.collection('manager-earnings').doc(`${managerId}_${month}`).get();
    const prev = await db.collection('managerMonthlyNets').doc(`${managerId}_${prevMonth}`).get();
    const currentNet = current.exists ? (current.data()?.totalNet || 0) : 0;
    const prevNet = prev.exists ? (prev.data()?.netAmount || 0) : 0;
    const eligible = prevNet > 0 ? (currentNet >= threshold * prevNet) : false;
    res.json({ success: true, month, threshold, currentNet, prevNet, eligible });
  } catch (e:any) {
    res.status(500).json({ error: 'Failed to check eligibility', details: e.message });
  }
});

// Bulk cleanup: remove DIAMOND_BONUS entries that are not eligible for a given month
apiRouter.post('/bonuses/cleanup/diamond', async (req: AuthenticatedRequest, res: Response) => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }
  try {
    const db = admin.firestore();
    const { month: bodyMonth } = (req.body || {}) as { month?: string };
    const month = (bodyMonth && /^\d{6}$/.test(bodyMonth)) ? bodyMonth : currentMonthYYYYMM();
    const config = await CommissionConfigService.getInstance().getActiveConfig();
    const threshold = config.diamondThreshold ?? 1.2;
    const prevMonth = previousMonthYYYYMM(month);

    // Load all diamond bonus docs for the month
    const diamondSnap = await db.collection('bonuses')
      .where('month','==', month)
      .where('type','==', 'DIAMOND_BONUS')
      .get();

    if (diamondSnap.empty) {
      res.json({ success: true, month, removed: 0, affectedManagers: 0 });
      return;
    }

    // Group by manager
    const byManager = new Map<string, FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]>();
    diamondSnap.docs.forEach(d => {
      const mid = String(d.data()?.managerId || '');
      if (!mid) return;
      const arr = byManager.get(mid) || [];
      arr.push(d);
      byManager.set(mid, arr);
    });

    let removed = 0;
    const affected: string[] = [];

    for (const [managerId, docs] of byManager.entries()) {
      // Load eligibility inputs
      const [current, prev] = await Promise.all([
        db.collection('manager-earnings').doc(`${managerId}_${month}`).get(),
        db.collection('managerMonthlyNets').doc(`${managerId}_${prevMonth}`).get(),
      ]);
      const currentNet = current.exists ? (current.data()?.totalNet || 0) : 0;
      const prevNet = prev.exists ? (prev.data()?.netAmount || 0) : 0;
      const eligible = prevNet > 0 && currentNet >= threshold * prevNet;
      if (eligible) continue;

      // Delete all DIAMOND_BONUS docs for this manager+month
      const b = db.batch();
      docs.forEach(d => b.delete(d.ref));
      await b.commit();
      removed += docs.length;
      affected.push(managerId);

      // Recompute extras and update totals
      const extrasSnap = await db.collection('bonuses')
        .where('managerId','==', managerId)
        .where('month','==', month)
        .get();
      let newExtras = 0;
      extrasSnap.forEach(d => {
        const t = String(d.data()?.type || '').toUpperCase();
        if (t === 'RECRUITMENT_BONUS' || t === 'GRADUATION_BONUS' || t === 'DIAMOND_BONUS') newExtras += (d.data()?.amount || 0);
      });
      const earningsRef = db.collection('manager-earnings').doc(`${managerId}_${month}`);
      await db.runTransaction(async (tx) => {
        const e = await tx.get(earningsRef);
        const base = e.exists ? (e.data()?.baseCommission || 0) : 0;
        const milestones = e.exists ? (e.data()?.milestonePayouts || 0) : 0;
        const newTotal = Math.round((base + milestones + newExtras) * 100) / 100;
        tx.set(earningsRef, { extras: newExtras, totalEarnings: newTotal, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    }

    res.json({ success: true, month, removed, affectedManagers: affected.length, managers: affected });
  } catch (e:any) {
    console.error('💥 diamond cleanup failed', e);
    res.status(500).json({ error: 'Failed to cleanup diamond bonuses', details: e.message });
  }
});

export { apiRouter }; 