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

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // @ts-ignore Node 20 global fetch
    const resp = await fetch(url, { signal: controller.signal });
    return resp as unknown as Response;
  } finally {
    clearTimeout(t);
  }
}

async function getUsdToEurFromPrimary(asOfDate: string): Promise<{ rate: number; source: string } | null> {
  // exchangerate.host (no key)
  const url = `https://api.exchangerate.host/${asOfDate}?base=USD&symbols=EUR`;
  // @ts-ignore Response type compatible at runtime
  const r = await fetchWithTimeout(url).catch(() => null as any);
  if (!r || !(r as any).ok) return null;
  const json = await (r as any).json().catch(() => null);
  const rate = json?.rates?.EUR;
  if (typeof rate !== 'number' || !isFinite(rate)) return null;
  return { rate: Math.round(rate * 1e6) / 1e6, source: 'exchangerate.host' };
}

async function getUsdToEurFromFallback(asOfDate: string): Promise<{ rate: number; source: string } | null> {
  // Frankfurter (ECB). If date is weekend/holiday, returns previous business day's rate
  const url = `https://api.frankfurter.app/${asOfDate}?from=USD&to=EUR`;
  // @ts-ignore Response type compatible at runtime
  const r = await fetchWithTimeout(url).catch(() => null as any);
  if (!r || !(r as any).ok) return null;
  const json = await (r as any).json().catch(() => null);
  const rate = json?.rates?.EUR;
  if (typeof rate !== 'number' || !isFinite(rate)) return null;
  return { rate: Math.round(rate * 1e6) / 1e6, source: 'frankfurter.app' };
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

    // Try primary provider, then fallback
    const primary = await getUsdToEurFromPrimary(asOfDate);
    const chosen = primary ?? (await getUsdToEurFromFallback(asOfDate));

    if (!chosen) {
      res.status(502).json({ error: "Failed fetching FX rate from providers" });
      return;
    }

    const doc: FxRateDoc = {
      month,
      asOfDate,
      usdToEur: chosen.rate,
      source: chosen.source,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(doc);

    res.status(200).json({ success: true, data: doc, cached: false });
  } catch (e: any) {
    console.error('getMonthlyFxRate error:', e);
    res.status(500).json({ error: 'Failed to resolve monthly FX rate', details: e?.message || String(e) });
  }
} 