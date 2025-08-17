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
  // NEW: base commission rates and downline rates
  baseCommissionRates?: { live: number; team: number };
  downlineRates?: { A: number; B: number; C: number };
  // Metadata for versioning
  name?: string;
  effectiveFrom?: string; // YYYYMM – used to pick config for a month
  activeFrom?: FirebaseFirestore.Timestamp | null;
  activeTo?: FirebaseFirestore.Timestamp | null;
  createdBy?: string;
  createdAt?: FirebaseFirestore.Timestamp;
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
        return this.withDefaults(this.cached!);
      }
    } catch {}

    // Defaults if none configured
    this.cached = this.defaultConfig();
    this.lastFetchMs = now;
    return this.cached;
  }

  // NEW: Resolve config for a specific period (YYYYMM). Prefers lock → then effectiveFrom → then active/defaults.
  async getConfigForPeriod(period: string): Promise<SystemConfig> {
    const db = admin.firestore();
    // 1) Check explicit lock override for the period
    try {
      const lockDoc = await db.collection('systemConfigLocks').doc(period).get();
      if (lockDoc.exists) {
        const lock = lockDoc.data() as any;
        const configId = String(lock?.configId || '');
        if (configId) {
          const cfgSnap = await db.collection('systemConfig').doc(configId).get();
          if (cfgSnap.exists) {
            return this.withDefaults(cfgSnap.data() as SystemConfig);
          }
        }
      }
    } catch {}

    // 2) Select by effectiveFrom
    try {
      const snap = await db
        .collection('systemConfig')
        .orderBy('effectiveFrom', 'desc')
        .limit(50)
        .get();
      if (!snap.empty) {
        const configs = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Array<SystemConfig & { id: string }>;
        const chosen = configs.find(c => typeof c.effectiveFrom === 'string' && c.effectiveFrom <= period);
        if (chosen) return this.withDefaults(chosen);
      }
    } catch {}

    // 3) Active/default
    return this.getActiveConfig();
  }

  invalidate() { this.cached = null; this.lastFetchMs = 0; }

  private defaultConfig(): SystemConfig {
    return this.withDefaults({});
  }

  private withDefaults(cfg: SystemConfig): SystemConfig {
    return {
      milestoneDeductions: cfg.milestoneDeductions ?? { N: 300, O: 1000, P: 240, S: 150 },
      milestonePayouts: cfg.milestonePayouts ?? {
        live: { S: 75, N: 150, O: 400, P: 100 },
        team: { S: 80, N: 165, O: 450, P: 120 }
      },
      diamondBonusPayouts: cfg.diamondBonusPayouts ?? { live: 50, team: 60 },
      diamondThreshold: cfg.diamondThreshold ?? 1.2,
      recruitmentBonusPayouts: cfg.recruitmentBonusPayouts ?? { live: 50, team: 60 },
      graduationBonusPayouts: cfg.graduationBonusPayouts ?? { live: 50, team: 60 },
      baseCommissionRates: cfg.baseCommissionRates ?? { live: 0.30, team: 0.35 },
      downlineRates: cfg.downlineRates ?? { A: 0.10, B: 0.075, C: 0.05 },
      name: cfg.name,
      effectiveFrom: cfg.effectiveFrom,
      activeFrom: cfg.activeFrom ?? null,
      activeTo: cfg.activeTo ?? null,
      createdBy: cfg.createdBy,
      createdAt: cfg.createdAt,
    };
  }
} 