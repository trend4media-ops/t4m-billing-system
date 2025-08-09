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

// Initialize Firebase Admin only if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();

// Allowed origins (Whitelist)
const allowedOrigins = (process.env.CORS_ORIGINS || "https://trend4media-billing.web.app,https://trend4media-billing.firebaseapp.com,https://trend4media.web.app")
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

export const api = onRequest({ region: "europe-west1" }, app);

// Export triggers
export { onPayoutStatusChange } from "./payouts/statusTrigger";
export { calculateDownlineCommissions, calculateDownlineForPeriodHttp } from "./downline-calculator";
export { onUploadBatchQueued } from "./uploads/queueTrigger"; 