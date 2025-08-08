import { Response } from "express";
import * as admin from "firebase-admin";
import { AuthenticatedRequest } from "../middleware/auth";

interface FxRateDoc {
  month: string; // YYYYMM
  asOfDate: string; // YYYY-MM-DD
  usdToEur: number;
  source: string;
  createdAt?: FirebaseFirestore.FieldValue;
}

function toAsOfDate(month: string): string {
  // month: YYYYMM -> YYYY-MM-06
  const year = month.slice(0, 4);
  const mm = month.slice(4, 6);
  return `${year}-${mm}-06`;
}

export async function getMonthlyFxRate(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const month = (req.query.month as string) || '';
    if (!/^\d{6}$/.test(month)) {
      res.status(400).json({ error: "Invalid or missing 'month' (YYYYMM)." });
      return;
    }

    const db = admin.firestore();
    const ref = db.collection('fxRates').doc(month);
    const existing = await ref.get();
    if (existing.exists) {
      const data = existing.data() as FxRateDoc;
      res.status(200).json({ success: true, data });
      return;
    }

    const asOfDate = toAsOfDate(month);

    // Fetch historical rate for asOfDate from exchangerate.host (no API key)
    // Example: https://api.exchangerate.host/2025-07-06?base=USD&symbols=EUR
    const url = `https://api.exchangerate.host/${asOfDate}?base=USD&symbols=EUR`;
    const r = await fetch(url);
    if (!r.ok) {
      res.status(502).json({ error: "Failed fetching FX rate", details: await r.text() });
      return;
    }
    const json = await r.json();
    const usdToEur = json?.rates?.EUR;
    if (typeof usdToEur !== 'number' || !isFinite(usdToEur)) {
      res.status(502).json({ error: "Invalid FX rate response" });
      return;
    }

    const doc: FxRateDoc = {
      month,
      asOfDate,
      usdToEur: Math.round(usdToEur * 1e6) / 1e6, // 6 decimals
      source: 'exchangerate.host',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(doc);

    res.status(200).json({ success: true, data: doc, cached: false });
  } catch (e: any) {
    console.error('getMonthlyFxRate error:', e);
    res.status(500).json({ error: 'Failed to resolve monthly FX rate', details: e?.message || String(e) });
  }
} 