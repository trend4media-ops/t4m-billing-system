## READFIRST – Trend4Media Abrechnungs- & Provisionsplattform

### Elevator Pitch (Wertversprechen)
- **Automatisiert** die komplette Provisionsabrechnung für Manager:innen und deren Creator-Portfolios
- **Transparenz in Echtzeit**: Upload → Verarbeitung → Reports → Auszahlung – alles live verbunden
- **Revisionssicher & skalierbar**: Serverless-Architektur, Audit-Logs, klare Rollen & Rechte
- **Produktnutzen**: Spart Zeit und Kosten, verhindert manuelle Fehler, erhöht Vertrauen und Zufriedenheit bei Partner:innen

---

## Systemüberblick
Die Plattform ist ein End-to-End-System zur Erfassung, Berechnung und Auszahlung von Manager-Provisionen auf Basis monatlicher Umsatz-Excels. Sie besteht aus zwei Hauptteilen:

- `functions/` – Backend auf Firebase Cloud Functions (TypeScript)
  - Upload-Verarbeitung (Excel → Parsing → Berechnung)
  - Provisions- & Bonus-Logik (v2.0, „Single Source of Truth“)
  - Downline-Berechnung, Auszahlungs-Workflow, Messaging, Admin-APIs
- `trend4media-frontend/` – Next.js-Frontend (Admin-Panel & Manager-Dashboard)
  - Admin: Upload, Reports, Payout-Management, Genealogy, Nachrichten
  - Manager: Earnings-Übersicht, Payout-Antrag, Nachrichten

Datenhaltung: **Firestore** (Dokument-DB, Indizes), Dateien: **Cloud Storage**, Auth: **Firebase Authentication**.

```text
📤 Excel Upload 
   ↓ (Echtzeit)
🧮 Verarbeitung & Berechnung (Functions)
   ↓ (Live)
💰 Manager Earnings & Boni
   ↓ (Direkt)
📊 Reports & Dashboards
   ↓ (Workflow)
💸 Payout (Antrag → Freigabe → Auszahlung)
```

Weiterführende Doku:
- Provisionslogik (definitiv): `COMMISSION_LOGIC_DEFINITIVE.md`
- Firestore-Datenmodell: `docs/FIRESTORE_SCHEMA.md`
- Roadmap & Architekturideen: `ROADMAP_SUMMARY.md`, `PUBSUB_ARCHITECTURE_PLAN.md`, `ERROR_DASHBOARD_PLAN.md`, `DYNAMIC_CONFIG_PLAN.md`
- Implementierungsstand: `SYSTEM_COMPLETE_IMPLEMENTATION.md`, `SYSTEM_COMPLETE_GOLD.md`

---

## Kernprozesse (End-to-End)
1. **Login & Rollen**
   - Rollen: `ADMIN`, `MANAGER` (Firebase Auth)
   - Schutz über Middleware & Firestore-Sicherheitsregeln
2. **Excel-Upload (monatlich)**
   - Admin lädt die Monatsdatei hoch (Frontend Upload)
   - Metadaten & Dedupe-Schutz (ein aktiver Batch pro Monat)
3. **Verarbeitung & Berechnung**
   - Parsing, Validierung, Fortschritts-Updates
   - Provisions- & Bonus-Berechnung gemäß v2.0 (s. unten)
   - Atomare Schreibvorgänge in `transactions`, `bonuses`, Aggregationen für `manager-earnings`
   - Live-Status in `uploadBatches`
4. **Earnings & Reporting**
   - Manager-Dashboard: Netto, Basisprovision, Boni, Verlauf
   - Admin-Reports: Manager-Übersicht, Filter, Export, History
5. **Payout-Workflow**
   - Manager stellt Antrag (`payoutRequests`)
   - Admin prüft und setzt Status: SUBMITTED → APPROVED → IN_PROGRESS → PAID
   - Audit-Log & Benachrichtigungen (Messages)
6. **Downline-Berechnung (monatlich geplant)**
   - Geplante Function berechnet Downline-Anteile (Level A/B/C)

---

## Provisionslogik v2.0 (Zusammenfassung)
Die vollständige, verbindliche Spezifikation steht in `COMMISSION_LOGIC_DEFINITIVE.md` (bitte dort nachlesen). Nachfolgend eine Kurzfassung für das Verständnis:

- **Basis-Provision**: LIVE 30% von net, TEAM 35% von net
- **Feste Abzüge (Excel-Milestones → Abzug vom Gross)**
  - N = 300 €, O = 1000 €, P = 240 €, S = 150 €
- **Feste Milestone-Boni (nach Manager-Typ; unabhängig von Excel-Werten)**
  - LIVE: S=75 €, N=150 €, O=400 €, P=100 €
  - TEAM: S=80 €, N=165 €, O=450 €, P=120 €
- **Diamond-Target-Bonus**: Bei ≥120% des Vormonats-Netto; Betrag je nach Manager-Typ (Details siehe Datei)
- **Downline-Provision**: Level A 10%, Level B 7.5%, Level C 5% der jeweiligen Downline-Netto-Beträge
- **Recruitment-Bonus**: Manuell via API

Wichtig: `COMMISSION_LOGIC_DEFINITIVE.md` ist die „Single Source of Truth“. Bei Widersprüchen mit älteren Dokumenten gilt ausschließlich diese Datei.

---

## Datenmodell (Firestore)
Haupt-Collections (Details & Beispiele in `docs/FIRESTORE_SCHEMA.md`):
- `users` – Profile & Rollen (Admin/Manager)
- `managers` – Stammdaten, Typ (live/team), Satz
- `uploadBatches` – Upload-Metadaten, Status, Fortschritt
- `transactions` – Zeilenweise Transaktionen pro Creator & Periode
- `bonuses` – Einzelne Bonus-Einträge (Milestones, Diamond, Downline, …)
- `manager-earnings` – Aggregierte Monatswerte pro Manager
- `payoutRequests` – Auszahlungsanträge inkl. Status
- `messages`, `auditLogs` – Benachrichtigungen & Revisionssicherheit

Indizes: `firestore.indexes.json`. Sicherheitsregeln: `firestore.rules`, Storage: `storage.rules`.

---

## Architektur & Technik
- **Backend**: Firebase Cloud Functions (`functions/src`), Express-Router, Auth-/AppCheck-Middleware, strikte Typisierung (TypeScript)
- **Frontend**: Next.js (`trend4media-frontend`), React, Tailwind, umfangreiche Tests (Unit + E2E mit Playwright)
- **Skalierung**: Serverless; Plan für eventgetriebene Pub/Sub-Verarbeitung (`PUBSUB_ARCHITECTURE_PLAN.md`) zur hochparallelen Chunk-Verarbeitung
- **Qualität & Tests**: `TESTING.md`, Frontend-README. Smoke-, Unit-, und E2E-Tests; Mindestabdeckung im Frontend 80%+

---

## Wichtige APIs (Auszug)
Die konkreten Routen sind in `functions/src/routes/api.ts` definiert. Häufige Endpunkte:
- Health: `GET /api/health`
- Upload: `POST /api/uploads/metadata`, `POST /api/uploads/process`, `GET /api/uploads/batches`
- Manager & Earnings: `GET /api/managers`, `GET /api/managers/earnings-v2`
- Payouts: `POST /api/payouts/request`, `GET /api/payouts/available`, `GET /api/payouts/status`
- Messages: `POST /api/messages/broadcast`, `GET /api/messages`, `GET /api/messages/unread`

Hinweis: Auth-Zugriff & Rollenprüfung per Middleware. Details und vollständige Liste im Code.

---

## Bedienoberflächen (Frontend)
- Admin (`/trend4media-frontend/src/app/admin`): Upload, Reports, Payouts, Genealogy, Manager-Accounts, Broadcast-Nachrichten
- Manager (`/trend4media-frontend/src/app/dashboard`): Earnings, Payout-Antrag, Profil, Nachrichten

Wichtige UI-Komponenten: `src/components` und `src/app/.../page.tsx`. E2E-Flows: `trend4media-frontend/e2e/*` – inklusive „Upload → Payout“-Szenario.

---

## Setup & Lokale Entwicklung
Voraussetzungen:
- Node.js (empfohlen v20+), Firebase CLI (`npm i -g firebase-tools`)

Schnellstart (vereinfacht):
1. Abhängigkeiten installieren & bauen
   - Backend: `cd functions && npm install && npm run build`
   - Frontend: `cd trend4media-frontend && npm install && npm run dev`
2. Firebase Emulatoren optional starten: `firebase emulators:start`
3. Testskripte im Projektwurzelverzeichnis vorhanden (z. B. `test-all-modules.js`, `test-health-and-endpoints.js`)

---

## Deployment
- Ein-Kommando-Deployment: `deploy-firebase.sh` (Functions + Hosting)
- Alternativ vollständiger Ablauf: `deploy-complete-system.sh`
- Frontend-Deployment-Optionen: Vercel (empfohlen) oder Firebase Hosting (`trend4media-frontend/DEPLOYMENT.md`)
- Konfiguration & Umgebung: `firebase.json`, `vercel.json`, Env-Variablen gemäß Frontend-README

Nach dem Deployment: Health-Check und Smoke-Tests ausführen.

---

## Sicherheit & Compliance
- **Authentication**: Firebase Auth, Rollen in Userprofilen gespiegelt
- **Authorization**: Middleware + Firestore-Regeln, least privilege
- **App Check**: Schutz vor Missbrauch (siehe `functions/src/middleware/appCheck.ts`)
- **Audit Logs**: Jede relevante Änderung wird nachvollziehbar protokolliert
- **Datenkonsistenz**: Dedupe-Mechanismen, atomare Batches, Idempotenz wo möglich

---

## Betrieb & Monitoring
- Logs & Fehleranalyse: `firebase functions:log`
- Geplante Funktionen (z. B. Downline) per Scheduler
- Geplantes Fehler-Dashboard (`ERROR_DASHBOARD_PLAN.md`) für interaktive Korrekturen & selektive Neuverarbeitung

---

## Governance & Änderungen
- Änderungen an Provisionsparametern sind zentral zu steuern. Perspektivisch: Dynamische Konfiguration mit Versionierung (`DYNAMIC_CONFIG_PLAN.md`).
- Vor jeder Änderung an der Berechnungslogik: Spezifikation prüfen, Tests anpassen, E2E-Flow validieren.

---

## Häufige Fragen (FAQ)
- **Was ist die maßgebliche Berechnungsquelle?** `COMMISSION_LOGIC_DEFINITIVE.md`.
- **Kann ich die Monatsdatei erneut hochladen?** Ja, mit Dedupe-Schutz. Alte Batches werden superseded, Status & History bleiben nachvollziehbar.
- **Wie werden Downline-Provisionen berechnet?** Monatlich geplant; basierend auf den Netto-Werten der Downline (A/B/C-Level). Details in der Spezifikation.
- **Wie starte ich schnell?** Siehe „Setup & Lokale Entwicklung“ und nutze die Testskripte für einen Smoke-Test.

---

## Anlaufstellen & Dateien
- Spezifikation: `COMMISSION_LOGIC_DEFINITIVE.md`
- Datenmodell: `docs/FIRESTORE_SCHEMA.md`
- Architektur & Roadmap: `ROADMAP_SUMMARY.md`, `PUBSUB_ARCHITECTURE_PLAN.md`
- Deployment: `deploy-firebase.sh`, `deploy-complete-system.sh`, `trend4media-frontend/DEPLOYMENT.md`
- Implementierungsstatus: `SYSTEM_COMPLETE_IMPLEMENTATION.md`, `SYSTEM_COMPLETE_GOLD.md`

Diese Datei ist der Startpunkt. Für exakte Beträge und Abläufe immer die verlinkten Quelldateien konsultieren. 