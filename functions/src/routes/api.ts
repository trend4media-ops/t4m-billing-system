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
    
    // Load manager-earnings for the month (they are overwritten per month on each processing)
    const earningsSnapshot = await db.collection('manager-earnings')
      .where('month', '==', month)
      .get();
    
    const managers: any[] = [];
    let totalRevenue = 0;
    let totalCommissions = 0; // total payout = base + milestone + extras
    let totalBonuses = 0; // milestone payouts only
    let totalBase = 0; // sum of base commissions
    let totalTransactions = 0;
    
    for (const doc of earningsSnapshot.docs) {
      const data = doc.data();
      const managerDoc = await db.collection('managers').doc(data.managerId).get();
      const managerData = managerDoc.exists ? managerDoc.data() : {} as any;

      const milestoneSum = data.milestonePayouts || 0;
      const extrasSum = data.extras || 0;
      const base = data.baseCommission || 0;
      const total = base + milestoneSum + extrasSum;
      
      // Ensure creatorCount (fallback for legacy months)
      let creatorCount = data.creatorCount || 0;
      if (!creatorCount) {
        try {
          const txSnap = await db.collection('transactions')
            .where('month','==', month)
            .where('managerId','==', data.managerId)
            .get();
          const set = new Set<string>();
          txSnap.forEach(t => { const td:any = t.data(); set.add(td.creatorId || 'unknown'); });
          creatorCount = set.size;
        } catch {}
      }

      // Compute extras breakdown from bonuses collection (manual awards)
      let extrasBreakdown = { recruitment: 0, graduation: 0, diamond: 0 };
      try {
        const extrasSnap = await db.collection('bonuses')
          .where('managerId','==', data.managerId)
          .where('month','==', month)
          .get();
        extrasSnap.forEach((bDoc:any) => {
          const b = bDoc.data();
          const t = String(b.type || '').toUpperCase();
          const amt = b.amount || 0;
          if (t === 'RECRUITMENT_BONUS') extrasBreakdown.recruitment += amt;
          if (t === 'GRADUATION_BONUS') extrasBreakdown.graduation += amt;
          if (t === 'DIAMOND_BONUS') extrasBreakdown.diamond += amt;
        });
      } catch {}

      // Diamond eligibility preview (for UI badge)
      let diamondEligible: boolean | null = null;
      try {
        const config = await CommissionConfigService.getInstance().getActiveConfig();
        const threshold = config.diamondThreshold ?? 1.2;
        const prevMonth = (() => {
          const y = Number(month.slice(0,4));
          const m = Number(month.slice(4));
          const d = new Date(y, m - 2, 1);
          return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
        })();
        const prev = await db.collection('managerMonthlyNets').doc(`${data.managerId}_${prevMonth}`).get();
        const prevNet = prev.exists ? (prev.data()?.netAmount || 0) : 0;
        if (prevNet > 0) {
          const currentNet = data.totalNet || 0;
          diamondEligible = currentNet >= threshold * prevNet;
        }
      } catch {}
 
      managers.push({
        managerId: data.managerId,
        managerHandle: (managerData?.handle || managerData?.name || data.managerId) as string,
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
apiRouter.get("/messages/:userId", authMiddleware, getMessages); // Get messages for specific user
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
    const { managerId, period, type, description, amount } = req.body as {
      managerId: string;
      period?: string; // YYYYMM
      type: 'RECRUITMENT_BONUS'|'GRADUATION_BONUS'|'DIAMOND_BONUS';
      description?: string;
      amount?: number;
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

    // Optional diamond eligibility check (soft-check; warn only)
    let eligibility: { ok: boolean; note?: string } = { ok: true };
    if (type === 'DIAMOND_BONUS') {
      try {
        const current = await db.collection('manager-earnings').doc(`${managerId}_${month}`).get();
        const prevMonth = previousMonthYYYYMM(month);
        const prev = await db.collection('managerMonthlyNets').doc(`${managerId}_${prevMonth}`).get();
        const currentNet = current.exists ? (current.data()?.totalNet || 0) : 0;
        const prevNet = prev.exists ? (prev.data()?.netAmount || 0) : 0;
        const threshold = (await CommissionConfigService.getInstance().getActiveConfig()).diamondThreshold ?? 1.2;
        if (prevNet > 0 && currentNet < threshold * prevNet) {
          eligibility = { ok: false, note: `Current NET ${currentNet.toFixed(2)} < ${(threshold*100).toFixed(0)}% of previous NET ${prevNet.toFixed(2)}` };
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
    const byManager: Record<string, { managerId: string; recruitment: number; graduation: number; diamond: number; total: number }> = {};
    snap.forEach(d => {
      const b = d.data();
      const managerId = b.managerId as string;
      if (!byManager[managerId]) byManager[managerId] = { managerId, recruitment: 0, graduation: 0, diamond: 0, total: 0 };
      const amt = b.amount || 0;
      byManager[managerId].total += amt;
      switch (String(b.type || '').toUpperCase()) {
        case 'RECRUITMENT_BONUS': byManager[managerId].recruitment += amt; break;
        case 'GRADUATION_BONUS': byManager[managerId].graduation += amt; break;
        case 'DIAMOND_BONUS': byManager[managerId].diamond += amt; break;
      }
    });

    // Attach manager basic info
    const result = Object.values(byManager);
    for (const item of result) {
      try {
        const m = await admin.firestore().collection('managers').doc(item.managerId).get();
        (item as any).managerHandle = (m.exists ? (m.data()?.handle || m.data()?.name) : item.managerId) || item.managerId;
        (item as any).managerType = (m.exists ? (m.data()?.type || 'live') : 'live');
      } catch {}
    }

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
    const bonusId = `${managerId}_${month}_${t}`;
    const bonusRef = db.collection('bonuses').doc(bonusId);
    const bonusDoc = await bonusRef.get();
    if (!bonusDoc.exists) {
      res.status(404).json({ error: 'Bonus not found' });
      return;
    }
    const bonusAmount = bonusDoc.data()?.amount || 0;

    // Delete bonus
    await bonusRef.delete();

    // Recompute extras sum from remaining bonuses for that manager+month and update earnings
    const remainingSnap = await db.collection('bonuses')
      .where('managerId','==', managerId)
      .where('month','==', month)
      .get();
    let newExtras = 0;
    remainingSnap.forEach(d => { newExtras += d.data().amount || 0; });

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
        amount: bonusAmount,
        updatedExtras: newExtras,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch {}

    res.json({ success: true, managerId, month, type: t, removedAmount: bonusAmount, extras: newExtras });
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

export { apiRouter }; 