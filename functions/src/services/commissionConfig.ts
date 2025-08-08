import * as admin from 'firebase-admin';

export interface SystemConfig {
  milestoneDeductions?: { N: number; O: number; P: number; S: number };
  milestonePayouts?: {
    live: { S: number; N: number; O: number; P: number };
    team: { S: number; N: number; O: number; P: number };
  };
  diamondBonusPayouts?: { live: number; team: number };
  diamondThreshold?: number; // e.g. 1.2
  recruitmentBonusPayouts?: { live: number; team: number };
  graduationBonusPayouts?: { live: number; team: number };
}

export class CommissionConfigService {
  private static instance: CommissionConfigService;
  private cached: SystemConfig | null = null;
  private lastFetchMs = 0;
  private readonly CACHE_MS = 5 * 60 * 1000; // 5 minutes

  static getInstance(): CommissionConfigService {
    if (!this.instance) this.instance = new CommissionConfigService();
    return this.instance;
  }

  async getActiveConfig(): Promise<SystemConfig> {
    const now = Date.now();
    if (this.cached && (now - this.lastFetchMs) < this.CACHE_MS) return this.cached;

    const db = admin.firestore();
    try {
      const snap = await db
        .collection('systemConfig')
        .where('activeTo', '==', null)
        .orderBy('activeFrom', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) {
        this.cached = (snap.docs[0].data() as any) as SystemConfig;
        this.lastFetchMs = now;
        return this.cached!;
      }
    } catch {}

    // Defaults if none configured
    this.cached = {
      milestoneDeductions: { N: 300, O: 1000, P: 240, S: 150 },
      milestonePayouts: {
        live: { S: 75, N: 150, O: 400, P: 100 },
        team: { S: 80, N: 165, O: 450, P: 120 }
      },
      diamondBonusPayouts: { live: 50, team: 60 },
      diamondThreshold: 1.2,
      recruitmentBonusPayouts: { live: 50, team: 60 },
      graduationBonusPayouts: { live: 50, team: 60 },
    };
    this.lastFetchMs = now;
    return this.cached;
  }

  invalidate() { this.cached = null; this.lastFetchMs = 0; }
} 