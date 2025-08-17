import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import hpp from "hpp";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { onRequest } from "firebase-functions/v2/https";
import { apiRouter } from "./routes/api";
import { authRouter } from "./routes/auth";
import { appCheckMiddleware } from "./middleware/appCheck";
import multer from "multer";

// Initialize Firebase Admin only if not already initialized
if (!admin.apps.length) {
  // Prefer explicit storage bucket for signed URLs in prod
  let storageBucket: string | undefined;

  // 1) From explicit env variables
  storageBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.GCLOUD_STORAGE_BUCKET || storageBucket;

  // 2) From FIREBASE_CONFIG JSON
  if (!storageBucket && process.env.FIREBASE_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.FIREBASE_CONFIG);
      if (cfg && typeof cfg.storageBucket === 'string' && cfg.storageBucket.trim().length > 0) {
        storageBucket = cfg.storageBucket.trim();
      }
    } catch (e) {
      console.warn("Failed to parse FIREBASE_CONFIG for storageBucket:", e);
    }
  }

  // 3) Infer from project env
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!storageBucket && projectId) {
    storageBucket = `${projectId}.appspot.com`;
  }

  const options: admin.AppOptions = {};
  if (storageBucket) {
    options.storageBucket = storageBucket;
  }

  admin.initializeApp(options);
  // Optional log to verify bucket at startup
  try {
    const activeBucket = admin.storage().bucket().name;
    console.log(`Firebase Admin initialized. Storage bucket: ${activeBucket || "<none>"}`);
  } catch (e) {
    console.warn("Firebase Admin initialized, but could not read storage bucket name:", e);
  }
}

const app = express();

// Allowed origins (Whitelist)
const allowedOrigins = (process.env.CORS_ORIGINS || "https://trend4media-billing.web.app,https://trend4media-billing.firebaseapp.com,https://trend4media.web.app,https://www.tiktool.net,https://app.tiktool.net")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Security middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow same-origin/server-to-server
    const ok = allowedOrigins.includes(origin);
    return callback(ok ? null : new Error("CORS not allowed"), ok);
  },
  credentials: true
}));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));
app.use(hpp());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));

// Rate limiting (simple, per-IP)
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
const apiLimiter  = rateLimit({ windowMs: 1 * 60 * 1000,  max: 300, standardHeaders: true, legacyHeaders: false });

// App Check
const appCheckSoft = appCheckMiddleware(false);
const appCheckHard = appCheckMiddleware(true);

// Primary mount under /api
app.use("/api/auth", appCheckHard, authLimiter, authRouter);
app.use("/api", appCheckSoft, apiLimiter, apiRouter);
// Backward-compatible mount for clients that still call without /api
app.use("/auth", appCheckHard, authLimiter, authRouter);
app.use("/", appCheckSoft, apiLimiter, apiRouter);

// Centralized error handler (maps Multer + custom errors to clean JSON)
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Global error handler:", err);

  // Handle explicit PDF filter failure
  if (err && typeof err.message === 'string' && err.message === 'ONLY_PDF_ALLOWED') {
    return res.status(400).json({ error: "Nur PDF-Dokumente werden akzeptiert." });
    }

  // Multer errors (e.g., file too large)
  if (err instanceof (multer as any).MulterError || err?.name === 'MulterError') {
    if ((err as any).code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: "Die Datei ist zu groß." });
    }
    return res.status(400).json({ error: "Upload fehlgeschlagen." });
  }

  // Common express/cors errors normalized
  const message = String(err?.message || '').toLowerCase();
  if (message.includes('cors')) {
    return res.status(403).json({ error: "CORS not allowed" });
  }

  return res.status(500).json({ error: "Internal server error" });
});

export const api = onRequest({ region: "europe-west1" }, app);

// Export triggers
export { onPayoutStatusChange } from "./payouts/statusTrigger";
export { calculateDownlineCommissions, calculateDownlineForPeriodHttp } from "./downline-calculator";
export { onUploadBatchQueued } from "./uploads/queueTrigger"; 