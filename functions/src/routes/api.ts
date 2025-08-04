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
import { getMessages } from "../messages/getMessages";
import { getUnreadMessagesCount } from "../messages/getUnreadCount";
import { adminPayoutsRouter } from "./admin";
import { AuthenticatedRequest } from "../middleware/auth";
import { Response } from "express";
import * as admin from "firebase-admin";

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
apiRouter.post("/uploads/metadata", createUploadMetadata);

// New route to trigger processing
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

apiRouter.get("/uploads/batches/:id", async (req: AuthenticatedRequest, res: Response) => {
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

apiRouter.get("/uploads/batches/:id/transactions", async (req: AuthenticatedRequest, res: Response) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'ADMIN') {
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


// --- MANAGERS ---
apiRouter.get("/managers", getManagers);
apiRouter.get("/managers/earnings-v2", getAllManagerEarnings);
apiRouter.get("/managers/:managerId/performance", getManagerPerformance);

// --- EARNINGS & PAYOUTS ---
apiRouter.get("/earnings/:managerId", getManagerEarnings);
apiRouter.get("/payouts/available", getAvailableEarnings);
apiRouter.post("/payouts/request", requestPayout);

// --- GENEALOGY ---
apiRouter.get("/genealogy", (req, res) => res.status(501).json({ error: "Not Implemented" }));

// --- MESSAGES ---
apiRouter.get("/messages", getMessages);
apiRouter.get("/messages/unread-count", getUnreadMessagesCount);

// --- ADMIN ---
apiRouter.use('/admin', adminPayoutsRouter);

export { apiRouter }; 