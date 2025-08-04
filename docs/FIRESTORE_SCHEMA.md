# Firestore Data Model – Trend4Media Bonus Management

> Version: Draft 2025-08-03

Dieses Dokument beschreibt die angestrebte **Firebase Firestore**-Struktur für das komplett SQL-freie Bonus- und Auszahlungs-System.

## 1 Übersicht der Collections

| Collection | Beschreibung | Beispiel-Dok ID |
|------------|--------------|------------------|
| `users`            | Firebase-Auth-spiegelnde Profildaten (Admins & Manager)                               | `uid_abc123` |
| `managers`        | Manager-Metadaten (Kommissionssatz, Handle, Typ)                                      | `mgr_LIVE_97` |
| `uploadBatches`   | Meta-Infos pro hochgeladener Excel-Datei                                             | `202508_liveReport.xlsx` |
| `transactions`    | Eine Zeile pro Creator & Periode – Umsätze / Netto / Boni                             | `creator_42_202508` |
| `bonuses`         | Einzelne Bonus-Einträge (Milestones, Graduation, Downline, …)                          | `bonus_milestone1_202508_mgr97` |
| `payoutRequests`  | Von Managern ausgelöste Auszahlungsanträge                                            | `request_202508_mgr97` |
| `messages`        | System- & Benachrichtigungs-Meldungen                                                | auto ID |
| `auditLogs`       | Änderungen & Admin-Aktionen (Write-Trigger)                                          | auto ID |

## 2 Collection-Details

### 2.1 `users`
```
{
  uid: string            // = Firebase UID (Dok-ID)
  email: string
  role: 'admin' | 'manager'
  firstName: string
  lastName: string
  managerId?: string      // FK auf managers (nur bei role == 'manager')
  createdAt: Timestamp
  lastLoginAt: Timestamp
}
```

### 2.2 `managers`
```
{
  handle: string          // Kurzname z. B. @jdoe
  name: string            // Vollständiger Anzeigename
  type: 'live' | 'team'
  commissionRate: number  // 0.30 oder 0.35 etc.
  creatorCount: number
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

### 2.3 `uploadBatches`
```
{
  filename: string
  period: string          // "YYYYMM" (Monat der Zahlen)
  status: 'UPLOADED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  processedCount: number
  transactionCount: number
  uploadedBy: string      // userId
  createdAt: Timestamp
  completedAt?: Timestamp
  warnings?: string[]
  error?: string
}
```

### 2.4 `transactions`
```
{
  creatorId: string
  creatorName: string
  managerId: string       // FK managers
  period: string          // "YYYYMM"
  grossAmount: number     // Column M
  netAmount: number       // gross - bonusSum
  bonusSum: number        // Abzüge
  commission: number      // 30 % / 35 % etc.
  liveManagerId?: string  // Downline Referenzen
  teamManagerId?: string
  batchId: string         // FK uploadBatches
  createdAt: Timestamp
}
```

### 2.5 `bonuses`
```
{
  managerId: string
  transactionId?: string  // optional FK auf Einzeltransaction
  period: string          // "YYYYMM"
  type: 'MILESTONE_S' | 'MILESTONE_N' | 'MILESTONE_O' | 'MILESTONE_P' | 'GRADUATION_BONUS' | 'DIAMOND_BONUS' | 'RECRUITMENT_BONUS' | 'DOWNLINE_LEVEL_A' | 'DOWNLINE_LEVEL_B' | 'DOWNLINE_LEVEL_C'
  amount: number
  createdAt: Timestamp
}
```

### 2.6 `payoutRequests`
```
{
  managerId: string
  period: string          // "YYYYMM"
  amount: number          // totalEarnings Rounded
  status: 'SUBMITTED' | 'APPROVED' | 'DENIED' | 'PAID'
  submittedAt: Timestamp
  decidedAt?: Timestamp
  decidedBy?: string      // Admin UID
  notes?: string
}
```

### 2.7 `messages`
```
{
  userId: string          // Empfänger (Admin oder Manager)
  title: string
  body: string
  read: boolean
  createdAt: Timestamp
}
```

### 2.8 `auditLogs`
```
{
  userId: string
  action: string
  targetCollection: string
  targetId: string
  before?: any
  after?: any
  timestamp: Timestamp
}
```

## 3 Indexes

1. `transactions` – (`managerId`, `period`, `grossAmount DESC`)
2. `bonuses` – (`managerId`, `period`)
3. `payoutRequests` – (`managerId`, `period`)
4. `auditLogs` – (`timestamp DESC`)

(Detaillierte Konfiguration bereits in `firestore.indexes.json` hinterlegen.)

## 4 Security Rules (Auszug)

| Pfad                        | Lesen                        | Schreiben                     |
|-----------------------------|------------------------------|-------------------------------|
| /users/{uid}               | uid == auth.uid              | uid == auth.uid               |
| /payoutRequests/{id}       | admin ∪ (manager && owner)   | admin ∪ (manager && owner)    |
| /uploadBatches/{id}        | admin                        | admin                         |

— vollständige Regeln werden in `firestore.rules` gepflegt.

## 5 Triggers & Functions

| Trigger/Funktion          | Aufgabe |
|---------------------------|---------|
| `uploads.processExcel` (HTTP) | Excel-Upload via multipart, Parsing, Schreiben von `uploadBatches`, `transactions`, `bonuses` |
| `earnings.getManager` (HTTP)  | Aggregierte Earnings-Antwort für Manager-Dashboard |
| `payouts.request` (HTTP)      | Anlage eines Auszahlungs-Antrags |
| `payouts.onStatusChange` (onUpdate) | Audit-Log, Notification an Manager |

---
*Draft – bitte Feedback geben, bevor wir weiter implementieren.* 