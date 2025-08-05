import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { getManagerEarnings } from "../earnings/getManager";
import { requestPayout } from "../payouts/requestPayout";
import { getManagerPerformance } from "../managers/getPerformance";
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
        // We don't wait for the promise to resolve.
        // The function will run in the background.
        processUploadedExcel(batchId).catch(err => {
            console.error(`Error processing batch ${batchId} in background:`, err);
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


// --- MANAGERS ---
apiRouter.get("/managers", getManagers);
apiRouter.get("/managers/earnings-v2", getAllManagerEarnings);
apiRouter.get("/managers/:managerId/earnings-v2", getManagerEarnings); // Add missing route with v2 endpoint
apiRouter.get("/managers/:managerId/performance", getManagerPerformance);

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

// --- ADMIN ---
apiRouter.use('/admin', adminPayoutsRouter);

export { apiRouter }; 