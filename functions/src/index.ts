import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";
import { onRequest } from "firebase-functions/v2/https";
import { apiRouter } from "./routes/api";

// Initialize Firebase Admin only if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// Primary mount under /api
app.use("/api", apiRouter);
// Backward-compatible mount for clients that still call without /api
app.use("/", apiRouter);

export const api = onRequest({ region: "europe-west1" }, app);

// Export triggers
export { onPayoutStatusChange } from "./payouts/statusTrigger";
// export { excelCalculator } from "./excel-calculator"; // DEPRECATED
export { calculateDownlineCommissions, calculateDownlineForPeriodHttp } from "./downline-calculator";
export { onUploadBatchQueued } from "./uploads/queueTrigger"; 