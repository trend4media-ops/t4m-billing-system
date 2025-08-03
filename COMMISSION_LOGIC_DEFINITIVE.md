# 🔢 **NEW COMMISSION LOGIC - TREND4MEDIA 4M-ABRECHNUNGSSYSTEM v2.0**

> **⚠️ KRITISCH: Diese Datei enthält die NEUE, absolute Spezifikation der Kommissions-Berechnung. Version 2.0 - Vollständig überarbeitet mit festen Milestone-Bonusbeträgen und Diamond-Target-Bonus!**

---

## 📋 **ÜBERSICHT**

Das 4M-Abrechnungssystem für trend4media wurde komplett überarbeitet. Die neue Version 2.0 implementiert eine präzise Kommissions-Berechnung mit:
- **Festen Milestone-Bonusbeträgen** basierend auf Manager-Typ (Live vs Team)
- **Diamond-Target-Bonus** von 500€ bei Erreichen von 120% des Vormonats-Nets
- **Downline-Provision** basierend auf NET-Beträgen der Downline-Manager
- **Vereinfachter Berechnungslogik** ohne variable Bonus-Werte

---

## 🔢 **NEUE KERN-BERECHNUNGSLOGIK v2.0**

### **1. GRUNDDATEN AUS EXCEL**

```
Brutto (Gross):        Spalte M (Index 12) 
Meilenstein N:         Spalte N (Index 13) - ABZUG: 300 €
Meilenstein O:         Spalte O (Index 14) - ABZUG: 1000 €  
Meilenstein P:         Spalte P (Index 15) - ABZUG: 240 €
Meilenstein S:         Spalte S (Index 18) - ABZUG: 150 €
```

### **2. NETTO-BERECHNUNG (net)**

**Regel:** Feste Abzugsbeträge werden vom Gross-Wert abgezogen!

```javascript
// NEUE Implementierung
const deductions = [];
if (row[13] && row[13] !== '') deductions.push(300);  // N: Feste 300€
if (row[14] && row[14] !== '') deductions.push(1000); // O: Feste 1000€  
if (row[15] && row[15] !== '') deductions.push(240);  // P: Feste 240€
if (row[18] && row[18] !== '') deductions.push(150);  // S: Feste 150€

const bonusSum = deductions.reduce((sum, val) => sum + val, 0);
const net = grossAmount - bonusSum;
```

### **3. BASIS-PROVISION (unverändert)**

```
Live-Manager:  30% von net
Team-Manager:  35% von net
```

### **4. NEUE MEILENSTEIN-BONI (Feste Beträge!)**

**🆕 WICHTIG:** Die Milestone-Bonusse sind jetzt FESTE Beträge basierend auf Manager-Typ, NICHT die Excel-Werte!

```javascript
// Live-Manager Rookie Bonusse:
const liveMilestoneBonuses = {
  S: hasS ? 75 : 0,    // Half-Milestone/Graduation: 75€
  N: hasN ? 150 : 0,   // Milestone 1: 150€
  O: hasO ? 400 : 0,   // Milestone 2: 400€
  P: hasP ? 100 : 0    // Retention: 100€
};

// Team-Manager Rookie Bonusse:
const teamMilestoneBonuses = {
  S: hasS ? 80 : 0,    // Half-Milestone/Graduation: 80€
  N: hasN ? 165 : 0,   // Milestone 1: 165€
  O: hasO ? 450 : 0,   // Milestone 2: 450€
  P: hasP ? 120 : 0    // Retention: 120€
};
```

```javascript
const milestoneBonuses = {
  N: row[13] ? 300 : 0,   // Wenn Spalte N gefüllt
  O: row[14] ? 1000 : 0,  // Wenn Spalte O gefüllt
  P: row[15] ? 240 : 0,   // Wenn Spalte P gefüllt
  S: row[18] ? 150 : 0    // Wenn Spalte S gefüllt
};
```

### **5. DIAMOND-TARGET-BONUS (NEU!)**

```javascript
// Diamond Bonus: 500€ wenn net ≥ 1,2 × previousNet
const diamondBonus = (net >= previousNet * 1.2) ? 500 : 0;
```

**Bedingung:** Aktueller NET-Betrag ≥ 120% des NET-Betrags vom Vormonat  
**Betrag:** Feste 500€ (nicht konfigurierbar)

### **6. RECRUITMENT-BONUS (unverändert)**

```
Manuell über API: POST /recruitment-bonus
Admin kann beliebige Beträge zuweisen
```

### **7. DOWNLINE-PROVISION (Verbessert!)**

**🆕 WICHTIG:** Downline-Provision basiert jetzt auf den NET-Beträgen der Downline-Manager!

```javascript
// Für jeden Downline-Manager:
const downlineNet = downlineGross - downlineBonusSum;

// Provision basierend auf Level:
Level A (Direkte Reports):     10% von downlineNet
Level B (Zweite Ebene):        7,5% von downlineNet  
Level C (Dritte Ebene):        5% von downlineNet
```

---

## 💾 **DATENSTRUKTUR FIRESTORE**

### **Transaction Document**
```javascript
{
  id: "transaction_uuid",
  managerId: "manager_uuid",
  managerHandle: "Manager Name",
  managerType: "LIVE" | "TEAM", 
  month: "202506",
  batchId: "batch_uuid",
  
  // Rohdaten
  grossAmount: 2000,
  deductions: 1690,           // Summe aller abgezogenen Meilensteine
  netForCommission: 310,      // gross - deductions
  
  // Berechnete Provisionen  
  baseCommission: 93,         // 30% (LIVE) oder 35% (TEAM) von netForCommission
  downlineIncome: 0,          // Wird durch Genealogy berechnet
  
  // Metadata
  calculatedAt: timestamp,
  createdBy: "user_id"
}
```

### **Bonus Document**
```javascript
{
  id: "bonus_uuid",
  managerId: "manager_uuid", 
  managerHandle: "Manager Name",
  type: "BASE_COMMISSION" | "MILESTONE_1_BONUS" | "MILESTONE_2_BONUS" | 
        "MILESTONE_3_BONUS" | "GRADUATION_BONUS" | "DIAMOND_BONUS" | 
        "RECRUITMENT_BONUS" | "DOWNLINE_PROVISION",
  amount: 300,
  month: "202506",
  batchId: "batch_uuid",      // Falls aus Upload
  calculatedAt: timestamp,
  createdBy: "user_id"
}
```

---

## 🛠️ **IMPLEMENTIERUNGS-ANFORDERUNGEN**

### **Backend (Firebase Functions)**

#### **1. processCommissionData(rows, batchId)**
```javascript
async function processCommissionData(rows, batchId) {
  for (const row of rows) {
    // 1. Daten extrahieren
    const grossAmount = parseFloat(row[12]) || 0;
    const managerName = row[0];
    const managerType = row[1]; // LIVE oder TEAM
    
    // 2. Deductions berechnen
    const deductions = [];
    if (row[13] && row[13] !== '') deductions.push(300);
    if (row[14] && row[14] !== '') deductions.push(1000);
    if (row[15] && row[15] !== '') deductions.push(240);
    if (row[18] && row[18] !== '') deductions.push(150);
    
    const totalDeductions = deductions.reduce((sum, val) => sum + val, 0);
    const netForCommission = grossAmount - totalDeductions;
    
    // 3. Basis-Provision
    const baseCommissionRate = managerType === 'LIVE' ? 0.30 : 0.35;
    const baseCommission = netForCommission * baseCommissionRate;
    
    // 4. Transaction speichern
    // 5. Basis-Commission als Bonus
    // 6. Meilenstein-Boni als separate Bonus-Dokumente
    // 7. Diamond-Bonus prüfen und erstellen
    // 8. Downline-Provision berechnen
  }
}
```

#### **2. GET /managers/:id/earnings**
```javascript
app.get('/managers/:id/earnings', async (req, res) => {
  const { month } = req.query;
  
  // 1. Alle Bonuses für Manager + Monat laden
  const bonuses = await db.collection('bonuses')
    .where('managerId', '==', req.params.id)
    .where('month', '==', month)
    .get();
    
  // 2. Nach Typ aggregieren
  const result = {
    grossAmount: 0,
    deductions: 0, 
    netForCommission: 0,
    baseCommission: 0,
    milestoneBonuses: { N: 0, O: 0, P: 0, S: 0 },
    diamondBonus: 0,
    downlineBonus: 0,
    recruitmentBonus: 0,
    totalPayout: 0,
    bonuses: []
  };
  
  // 3. Bonuses summieren und kategorisieren
  // 4. totalPayout = Summe aller Bonus-Amounts
});
```

### **Frontend (Next.js)**

#### **1. Manager Dashboard - Earnings Display**
```typescript
interface EarningsData {
  grossAmount: number;
  deductions: number;
  netForCommission: number; 
  baseCommission: number;
  milestoneBonuses: {
    N: number;
    O: number; 
    P: number;
    S: number;
  };
  diamondBonus: number;
  downlineBonus: number;
  recruitmentBonus: number;
  totalPayout: number;
  bonuses: BonusItem[];
}
```

#### **2. Admin Panel - Commission Overview**
- Separate Spalten für jeden Bonus-Typ
- Drill-Down in Bonus-Details
- Bulk-Operations für Recruitment-Boni
- Diamond-Bonus Konfiguration

---

## 🧪 **NEUE TEST-SZENARIEN v2.0**

### **Test Case 1: Live Manager - Vollständige Meilensteine**
```
Input:
  Gross: 2000 €
  N: vorhanden → ABZUG 300 €
  O: vorhanden → ABZUG 1000 €  
  P: vorhanden → ABZUG 240 €
  S: vorhanden → ABZUG 150 €
  Manager: LIVE

Expected:
  gross: 2000 €
  bonusSum: 1690 € (300+1000+240+150)
  net: 310 € (2000-1690)
  baseCommission: 93 € (30% von 310)
  milestoneBonuses: {
    S: 75 €,     // Live Half-Milestone Bonus
    N: 150 €,    // Live Milestone 1 Bonus
    O: 400 €,    // Live Milestone 2 Bonus  
    P: 100 €     // Live Retention Bonus
  }
  totalEarnings: 818 € (93+75+150+400+100)
```

### **Test Case 2: Team Manager - Teilweise Meilensteine**
```
Input:
  Gross: 1500 €
  N: vorhanden → ABZUG 300 €
  O: leer → 0 €
  P: vorhanden → ABZUG 240 €  
  S: leer → 0 €
  Manager: TEAM

Expected:
  gross: 1500 €
  bonusSum: 540 € (300+240)
  net: 960 € (1500-540)
  baseCommission: 336 € (35% von 960)
  milestoneBonuses: {
    S: 0 €,      // Nicht vorhanden
    N: 165 €,    // Team Milestone 1 Bonus
    O: 0 €,      // Nicht vorhanden
    P: 120 €     // Team Retention Bonus
  }
  totalEarnings: 621 € (336+165+120)
```

### **Test Case 3: Diamond-Target-Bonus**
```
Input:
  Gross: 3000 €
  bonusSum: 1450 € (N+O+S)
  net: 1550 €
  previousNet: 1000 €
  Manager: LIVE

Expected:
  diamondBonus: 500 € (1550 ≥ 1.2 × 1000 = 1200 ✓)
  totalEarnings: 1590 € (465+500+75+150+400)
```

### **Test Case 4: Downline-Provision**
```
Input:
  Manager: TEAM
  Downline-Manager A1: net = 1000 € → 10% = 100 €
  Downline-Manager A2: net = 800 € → 10% = 80 €
  Downline-Manager B1: net = 600 € → 7.5% = 45 €
  Downline-Manager C1: net = 400 € → 5% = 20 €

Expected:
  downlineIncome: {
    levelA: 180 €,  // (1000+800) × 10%
    levelB: 45 €,   // 600 × 7.5%
    levelC: 20 €    // 400 × 5%
  }
  downlineTotal: 245 €
```

---

## 🚨 **KRITISCHE REGELN v2.0**

### **1. NIEMALS ÄNDERN**
- Meilenstein-Abzugswerte (300, 1000, 240, 150) 
- Basis-Provision Prozentsätze (30% LIVE, 35% TEAM)
- **NEUE** Milestone-Bonus-Beträge:
  - Live: S=75€, N=150€, O=400€, P=100€
  - Team: S=80€, N=165€, O=450€, P=120€
- Diamond-Bonus: Fest 500€ bei 120% Schwelle
- Downline-Provision Prozentsätze (10%, 7.5%, 5%)

### **2. IMMER VALIDIEREN**
- Gross > 0 vor Berechnung
- net kann negativ sein (wenn bonusSum > gross)
- Basis-Provision nur auf positive net-Werte
- Diamond-Bonus nur bei positivem net-Vergleich
- Downline-Provision basiert auf downline-net, nicht auf base-commission

### **3. AUDIT-TRAIL**
- Jede Kommissions-Berechnung → Audit-Log
- User-Attribution für alle manuellen Änderungen
- Keine Löschung von Commission-Daten
- **NEU:** Version-Tracking für Commission-Logic-Updates

---

## 🔧 **ENTWICKLER-CHECKLISTE v2.0**

Vor jeder Änderung am Commission-System:

- [ ] **NEUE** Spezifikation v2.0 vollständig gelesen
- [ ] **NEUE** Test-Cases (Live/Team/Diamond/Downline) ausgeführt  
- [ ] Unit-Tests für **NEUE** Logik geschrieben
- [ ] Integration-Tests mit Excel-Upload-Workflow
- [ ] Frontend-Komponenten mit neuer API-Struktur getestet
- [ ] Smoke-Tests (Backend + Frontend) ausgeführt
- [ ] Audit-Logging validiert
- [ ] Performance-Impact mit neuer Downline-Berechnung gemessen
- [ ] Code-Review mit Fokus auf **NEUE** Commission-Logic

---

## 📞 **SUPPORT & ESKALATION**

Bei Unklarheiten zur **NEUEN** Commission-Logic v2.0:

1. **Diese Dokumentation prüfen** (Version 2.0)
2. **NEUE Test-Cases ausführen** (`test-new-commission-logic.js`)
3. **Code analysieren** (trend4media-backend/src/managers/commission-calculation.service.ts)
4. **Frontend-Integration prüfen** (trend4media-frontend/src/lib/api.ts)
5. **Team konsultieren** vor eigenmächtigen Änderungen

**🚨 NIEMALS** die **NEUEN** Kommissions-Berechnungen ohne explizite Freigabe ändern!

---

## 📊 **ERFOLGREICHE MIGRATION**

**✅ ABGESCHLOSSEN:**
- Excel-Processing mit neuen festen Abzügen
- Backend-Service mit manager-spezifischen Milestone-Bonussen  
- Frontend-API mit neuer gross/bonusSum/net-Struktur
- Diamond-Target-Bonus (500€) implementiert
- Downline-Provision auf net-Basis umgestellt
- Umfassende Tests für alle Szenarien
- Dokumentation vollständig aktualisiert

**🎯 KOMMISSIONS-FORMEL FINAL:**
```
totalEarnings = baseCommission + milestoneBonuses + diamondBonus + recruitmentBonus + downlineIncome
```

---

*Letzte Aktualisierung: August 2025*  
*Version: **2.0 NEW COMMISSION LOGIC***  
*Status: 🚀 IMPLEMENTED - Vollständig erneuert und getestet* 