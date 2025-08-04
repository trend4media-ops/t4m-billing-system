# 💡 Implementierungsplan: Dynamische Provisionskonfiguration

**Version 1.0 - Erstellt am 07.08.2025**

## Executive Summary

Dieses Feature ermöglicht es Admins, alle Provisionssätze und Bonusbeträge über das Admin-Panel zu konfigurieren, ohne Code-Änderungen vornehmen zu müssen. Die Lösung macht das System flexibel und reduziert Deployment-Zeiten von Tagen auf Minuten.

## 1. Aktuelle Situation

### Hardcodierte Werte

```typescript
// excel-calculator.ts
const MILESTONE_DEDUCTIONS = {
  N: 300, O: 1000, P: 240, S: 150
};

const MILESTONE_PAYOUTS = {
  live: { S: 75, N: 150, O: 400, P: 100 },
  team: { S: 80, N: 165, O: 450, P: 120 }
};

const DIAMOND_BONUS_PAYOUT = {
  live: 50, team: 60
};

const BASE_COMMISSION_RATES = {
  live: 0.30, team: 0.35
};

// downline-calculator.ts
const DOWNLINE_COMMISSION_RATES = {
  A: 0.10, B: 0.075, C: 0.05
};
```

### Probleme
- **Inflexibilität**: Jede Änderung erfordert Code-Deployment
- **Fehleranfälligkeit**: Entwickler könnten Werte falsch ändern
- **Verzögerung**: Business-Änderungen dauern Tage statt Minuten
- **Keine Historie**: Keine Nachvollziehbarkeit von Änderungen

## 2. Lösungsarchitektur

### 2.1 Firestore Collections

#### A) `systemConfig` Collection
```typescript
interface SystemConfig {
  id: 'commission-rules-v1'; // Versioniert für Rollback
  activeFrom: Timestamp;
  activeTo?: Timestamp; // null = aktuell aktiv
  createdBy: string;
  createdAt: Timestamp;
  
  milestoneDeductions: {
    N: number;
    O: number;
    P: number;
    S: number;
  };
  
  milestonePayouts: {
    live: { S: number; N: number; O: number; P: number };
    team: { S: number; N: number; O: number; P: number };
  };
  
  diamondBonusPayouts: {
    live: number;
    team: number;
  };
  
  baseCommissionRates: {
    live: number; // 0.30 = 30%
    team: number;
  };
  
  downlineCommissionRates: {
    A: number;
    B: number;
    C: number;
  };
}
```

#### B) `configHistory` Collection
```typescript
interface ConfigHistory {
  configId: string;
  changeType: 'created' | 'modified' | 'activated' | 'deactivated';
  changedFields: string[];
  previousValues?: any;
  newValues?: any;
  changedBy: string;
  changedAt: Timestamp;
  reason?: string; // Änderungsgrund
}
```

### 2.2 Frontend Components

#### A) Configuration Dashboard (`/admin/settings/commissions`)

```
┌─────────────────────────────────────────────────────────────┐
│  💰 Commission Configuration                                │
│  Active since: 01.01.2025 | Last updated: 04.08.2025      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 Base Commission Rates                                   │
│  ┌─────────────────┬─────────────┬──────────────────────┐ │
│  │ Manager Type    │ Current     │ New Value            │ │
│  ├─────────────────┼─────────────┼──────────────────────┤ │
│  │ Live Manager    │ 30%         │ [30    ]% ✏️         │ │
│  │ Team Manager    │ 35%         │ [35    ]% ✏️         │ │
│  └─────────────────┴─────────────┴──────────────────────┘ │
│                                                             │
│  🎯 Milestone Bonuses                                       │
│  ┌───────────┬──────────────┬──────────────┬────────────┐ │
│  │ Milestone │ Deduction    │ Live Payout  │ Team Payout│ │
│  ├───────────┼──────────────┼──────────────┼────────────┤ │
│  │ S         │ €[150  ] ✏️  │ €[75   ] ✏️  │ €[80   ] ✏️│ │
│  │ N         │ €[300  ] ✏️  │ €[150  ] ✏️  │ €[165  ] ✏️│ │
│  │ O         │ €[1000 ] ✏️  │ €[400  ] ✏️  │ €[450  ] ✏️│ │
│  │ P         │ €[240  ] ✏️  │ €[100  ] ✏️  │ €[120  ] ✏️│ │
│  └───────────┴──────────────┴──────────────┴────────────┘ │
│                                                             │
│  💎 Diamond Bonus                                           │
│  Live: €[50 ] ✏️   Team: €[60 ] ✏️                         │
│                                                             │
│  🔗 Downline Commissions                                    │
│  Level A: [10.0]% ✏️  Level B: [7.5]% ✏️  Level C: [5.0]% ✏️│
│                                                             │
│  Change Reason: [_________________________________]        │
│                                                             │
│  [Preview Changes] [Save as Draft] [Activate Now]          │
└─────────────────────────────────────────────────────────────┘
```

#### B) Change Preview Modal
```typescript
interface ChangePreview {
  affectedManagers: number;
  estimatedImpact: {
    avgCommissionChange: number;
    totalPayoutChange: number;
  };
  warnings: string[];
  effectiveDate: Date;
}
```

#### C) Configuration History View
- Zeigt alle Änderungen mit Zeitstempel
- Vergleichsansicht zwischen Versionen
- Rollback-Funktion zu früheren Versionen

### 2.3 Backend Implementation

#### A) Configuration Service
```typescript
class CommissionConfigService {
  private static instance: CommissionConfigService;
  private config: SystemConfig | null = null;
  private lastFetch: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 Minuten

  static getInstance(): CommissionConfigService {
    if (!this.instance) {
      this.instance = new CommissionConfigService();
    }
    return this.instance;
  }

  async getActiveConfig(): Promise<SystemConfig> {
    const now = Date.now();
    
    // Cache-Prüfung
    if (this.config && (now - this.lastFetch) < this.CACHE_DURATION) {
      return this.config;
    }

    // Aktive Konfiguration laden
    const configSnapshot = await db
      .collection('systemConfig')
      .where('activeTo', '==', null)
      .orderBy('activeFrom', 'desc')
      .limit(1)
      .get();

    if (configSnapshot.empty) {
      // Fallback auf Default-Werte
      return this.getDefaultConfig();
    }

    this.config = configSnapshot.docs[0].data() as SystemConfig;
    this.lastFetch = now;
    return this.config;
  }

  private getDefaultConfig(): SystemConfig {
    return {
      id: 'default-config',
      activeFrom: Timestamp.now(),
      createdBy: 'system',
      createdAt: Timestamp.now(),
      milestoneDeductions: { N: 300, O: 1000, P: 240, S: 150 },
      milestonePayouts: {
        live: { S: 75, N: 150, O: 400, P: 100 },
        team: { S: 80, N: 165, O: 450, P: 120 }
      },
      diamondBonusPayouts: { live: 50, team: 60 },
      baseCommissionRates: { live: 0.30, team: 0.35 },
      downlineCommissionRates: { A: 0.10, B: 0.075, C: 0.05 }
    };
  }

  invalidateCache(): void {
    this.config = null;
    this.lastFetch = 0;
  }
}
```

#### B) Updated excel-calculator.ts
```typescript
export const excelCalculator = onObjectFinalized(
  { region: "us-west1", timeoutSeconds: 540, memory: "1GiB" },
  async (event: StorageEvent) => {
    // ... existing validation code ...

    // Konfiguration laden
    const configService = CommissionConfigService.getInstance();
    const config = await configService.getActiveConfig();

    // Verwende dynamische Werte statt Konstanten
    const MILESTONE_DEDUCTIONS = config.milestoneDeductions;
    const MILESTONE_PAYOUTS = config.milestonePayouts;
    const DIAMOND_BONUS_PAYOUT = config.diamondBonusPayouts;
    const BASE_COMMISSION_RATES = config.baseCommissionRates;

    // ... rest of the function uses these variables ...
  }
);
```

#### C) Configuration API Endpoints

1. **`GET /api/admin/config/commission`**
   - Gibt aktuelle Konfiguration zurück
   - Inkludiert Änderungshistorie

2. **`POST /api/admin/config/commission`**
   - Erstellt neue Konfiguration (als Entwurf)
   - Validiert alle Werte
   - Berechnet Impact-Preview

3. **`PUT /api/admin/config/commission/{id}/activate`**
   - Aktiviert eine Konfiguration
   - Deaktiviert die vorherige
   - Invalidiert Caches

4. **`GET /api/admin/config/commission/history`**
   - Gibt Änderungshistorie zurück
   - Filtert nach Datum/Benutzer

5. **`POST /api/admin/config/commission/{id}/rollback`**
   - Aktiviert eine frühere Version
   - Erstellt Audit-Eintrag

### 2.4 Sicherheit & Validierung

#### A) Validierungsregeln
```typescript
const configValidationSchema = z.object({
  milestoneDeductions: z.object({
    N: z.number().min(0).max(5000),
    O: z.number().min(0).max(5000),
    P: z.number().min(0).max(5000),
    S: z.number().min(0).max(5000),
  }),
  baseCommissionRates: z.object({
    live: z.number().min(0).max(1), // 0-100%
    team: z.number().min(0).max(1),
  }),
  // ... weitere Validierungen
}).refine(data => {
  // Business-Logik Validierung
  return data.baseCommissionRates.team >= data.baseCommissionRates.live;
}, {
  message: "Team commission rate must be >= Live commission rate"
});
```

#### B) Berechtigungen
- Nur Admins mit Rolle `SUPER_ADMIN` können Konfigurationen ändern
- Änderungen werden im Audit-Log protokolliert
- Email-Benachrichtigung an alle Admins bei Änderungen

### 2.5 Migration & Rollout

#### Phase 1: Backend-Vorbereitung
1. Config Service implementieren
2. Default-Konfiguration in Firestore anlegen
3. Calculator-Functions anpassen

#### Phase 2: Frontend Development
1. Configuration Dashboard bauen
2. History View implementieren
3. Impact Preview Feature

#### Phase 3: Testing
1. Unit Tests für Config Service
2. Integration Tests mit verschiedenen Konfigurationen
3. Performance Tests (Cache-Verhalten)

#### Phase 4: Rollout
1. Feature Flag für schrittweise Aktivierung
2. Monitoring der Cache-Hit-Rate
3. Performance-Vergleich vorher/nachher

## 3. Vorteile

### Business Benefits
- **Agilität**: Provisionsänderungen in Minuten statt Tagen
- **Transparenz**: Vollständige Historie aller Änderungen
- **Sicherheit**: Validierung verhindert fehlerhafte Eingaben
- **Preview**: Auswirkungen vor Aktivierung sichtbar

### Technical Benefits
- **Separation of Concerns**: Business-Logik von Code getrennt
- **Performance**: Effizientes Caching
- **Auditierbarkeit**: Lückenlose Nachvollziehbarkeit
- **Testbarkeit**: Verschiedene Konfigurationen einfach testbar

## 4. Erfolgsmetriken

- **Änderungszeit**: Von 2-3 Tagen auf < 10 Minuten
- **Fehlerrate**: 0% ungültige Konfigurationen
- **Cache-Hit-Rate**: > 95%
- **Admin-Zufriedenheit**: "Sehr einfach zu bedienen"

## 5. Zukünftige Erweiterungen

1. **A/B Testing**: Verschiedene Provisionssätze für Gruppen
2. **Zeitbasierte Regeln**: Automatische Anpassungen (z.B. Quartalsende)
3. **Conditional Rules**: "Wenn Umsatz > X, dann Bonus Y"
4. **Import/Export**: Konfigurationen zwischen Umgebungen

---

**Anmerkung**: Diese Lösung verkörpert das Prinzip der proaktiven Qualität, indem sie Business-Agilität mit technischer Robustheit vereint. Das System wird nicht nur flexibler, sondern auch sicherer und transparenter. 