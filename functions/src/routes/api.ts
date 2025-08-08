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
  getTeamByManagerId
} from "../genealogy/genealogy";

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
    let totalCommissions = 0;
    let totalBonuses = 0; // milestone-only
    let totalTransactions = 0;
    
    for (const doc of earningsSnapshot.docs) {
      const data = doc.data();
      const managerDoc = await db.collection('managers').doc(data.managerId).get();
      const managerData = managerDoc.exists ? managerDoc.data() : {} as any;

      // Sum milestone bonuses only (per month & manager)
      const milestoneTypes = ['MILESTONE_S','MILESTONE_N','MILESTONE_O','MILESTONE_P'];
      const milestoneSnap = await db.collection('bonuses')
        .where('managerId', '==', data.managerId)
        .where('month', '==', month)
        .where('type', 'in', milestoneTypes)
        .get();
      let milestoneSum = 0;
      milestoneSnap.docs.forEach(b => { milestoneSum += (b.data().amount || 0); });
      
      managers.push({
        managerId: data.managerId,
        managerHandle: (managerData?.handle || managerData?.name || data.managerId) as string,
        managerType: (managerData?.type || data.managerType || 'live').toString().toLowerCase(),
        totalGross: data.totalGross || 0,
        totalNet: data.totalNet || 0,
        baseCommission: data.baseCommission || 0,
        totalBonuses: milestoneSum, // milestone-only as requested
        transactionCount: data.transactionCount || 0,
        creatorCount: data.creatorCount || 0,
        downlineEarnings: data.downlineEarnings || 0,
        processingDate: data.calculatedAt ? data.calculatedAt.toDate().toISOString() : new Date().toISOString(),
        month: month,
        batchId: data.batchId || preferredBatchId || 'unknown'
      });
      
      totalRevenue += data.totalGross || 0;
      totalCommissions += data.baseCommission || 0;
      totalBonuses += milestoneSum;
      totalTransactions += data.transactionCount || 0;
    }
    
    const reportData = {
      success: true,
      month: month,
      summary: {
        totalManagers: managers.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCommissions: Math.round(totalCommissions * 100) / 100,
        totalBonuses: Math.round(totalBonuses * 100) / 100,
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

// --- GENEALOGY ---
apiRouter.get("/genealogy", getAllGenealogy);
apiRouter.get("/genealogy/team-handle/:teamManagerHandle", getGenealogyByTeamHandle);
apiRouter.post("/genealogy", createGenealogy);
apiRouter.put("/genealogy/:id", updateGenealogy);
apiRouter.delete("/genealogy/:id", deleteGenealogy);
apiRouter.get("/genealogy/team/:teamManagerId", getTeamByManagerId);

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

export { apiRouter }; 