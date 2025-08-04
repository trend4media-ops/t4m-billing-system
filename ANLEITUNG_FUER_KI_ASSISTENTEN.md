# 🧠 ANLEITUNG FÜR KI-ASSISTENTEN (z.B. Claude Opus) - T4M Abrechnungssystem

**Version 1.0 - Erstellt am 04.08.2025**

Willkommen zu diesem Projekt. Bevor du eine einzige Zeile Code schreibst, lies und verinnerliche dieses Dokument. Es enthält die "Seele" und die Kernprinzipien dieses Systems. Deine Aufgabe ist es nicht, nur Code zu schreiben, sondern die Integrität und Stabilität dieses kritischen Abrechnungssystems zu wahren und zu verbessern.

---

## 📜 1. DIE KERN-DIREKTIVE: PROAKTIVE QUALITÄT

Dieses System hatte eine schwere Geburt, geprägt von reaktiven Bug-Fixes, Nachlässigkeiten und Frustration für den Nutzer. Das ist vorbei. Deine oberste Direktive lautet:

**"Mein primäres Ziel ist es nicht, einzelne Bugs reaktiv zu beheben, sondern proaktiv ein von Anfang an fehlerfreies, ganzheitliches System zu bauen. Ich muss antizipieren, wie Komponenten interagieren und sicherstellen, dass alles korrekt integriert ist. Stückwerk-Reparaturen sind inakzeptabel, da sie die Zeit des Nutzers verschwenden und Nachlässigkeit widerspiegeln. Höchste Qualität und System-Integrität haben absolute Priorität."**

Jede Änderung, die du vorschlägst, muss diesem Grundsatz entsprechen. Frage dich immer: "Macht diese Änderung das System als Ganzes robuster, oder löst sie nur ein isoliertes Problem und schafft potenziell neue?"

---

## 🏛️ 2. ARCHITEKTUR: WARUM WIR TUN, WAS WIR TUN

Das System besteht aus zwei Hauptteilen, die bewusst gewählt wurden:

*   **Backend: `/functions` (Firebase Cloud Functions)**
    *   **Warum?** Serverless, unendlich skalierbar, sicher und wartungsarm. Wir wollen uns nicht mit Server-Administration beschäftigen, sondern mit der Geschäftslogik. Das `trend4media-backend` (ein altes NestJS-Projekt) wurde **absichtlich entfernt**, um die Komplexität zu reduzieren und einen einzigen "Point of Truth" für die Backend-Logik zu schaffen.
*   **Frontend: `/trend4media-frontend` (Next.js)**
    *   **Warum?** Bietet eine moderne, performante User Experience durch serverseitiges Rendering und eine klare, komponentenbasierte Struktur.

**Der rote Faden (Datenfluss):** Dies ist der heiligste Prozess im System. Verstehe ihn, bevor du etwas änderst.

1.  **Authentifizierung (Client-Side):** Ein Benutzer loggt sich im Frontend ein. Seine Identität wird von Firebase bestätigt.
2.  **API-Kommunikation:** JEDE Anfrage vom Frontend an das Backend wird von einem **Axios-Interceptor** (`/lib/api.ts`) abgefangen, der das gültige Firebase ID-Token des Benutzers als `Authorization: Bearer <token>`-Header anhängt. Das Backend (`/middleware/auth.ts`) überprüft diesen Token bei jeder geschützten Anfrage.
3.  **Upload (Admin):** Der Admin lädt eine Excel-Datei hoch. Entscheidend ist hier die **Checkbox "Comparison Upload"**.
    *   Wenn **aktiviert**, wird die Datei mit dem Metadaten-Flag `isComparison: true` direkt in den Firebase Storage geladen.
    *   Wenn **deaktiviert**, wird sie ohne das Flag (bzw. mit `isComparison: false`) hochgeladen.
4.  **Backend-Verarbeitung (`excel-calculator.ts`):** Der Storage-Upload löst diese Cloud Function aus.
    *   **Idempotenz-Prüfung:** Die Funktion prüft zuerst in der `upload-metadata`-Collection, ob für diesen Monat bereits ein erfolgreicher Upload existiert. **Dies ist eine kritische Schutzmaßnahme.**
    *   **Weichenstellung:** Die Funktion liest das `isComparison`-Metadatum.
        *   Bei `true`: Nur die Netto-Beträge werden berechnet und in `managerMonthlyNets` gespeichert. Sonst passiert nichts.
        *   Bei `false`: Der volle Provisionslauf startet. Transaktionen und Boni werden erstellt. Bei der Diamond-Bonus-Berechnung wird **zuerst** in `managerMonthlyNets` nach den Vergleichsdaten gesucht.
5.  **Auszahlung (Manager & Admin):** Der Manager sieht seine in `bonuses` aggregierten Einnahmen und kann eine Auszahlung in `payoutRequests` beantragen. Der Admin verwaltet diese Anträge.

---

## 💎 3. DIE HEILIGEN SCHRIFTEN: DOKUMENTATION & WAHRHEIT

Es gibt mehrere Quellen der Wahrheit in diesem Projekt. Ignoriere sie auf eigene Gefahr.

1.  **`COMMISSION_LOGIC_DEFINITIVE.md`:** Dieses Dokument ist Gesetz. Es definiert die Geschäftslogik der Abrechnung. **JEDE** Änderung an der Berechnungslogik in `excel-calculator.ts` muss zu 100% mit diesem Dokument übereinstimmen.
2.  **`README.md` (Hauptverzeichnis):** Definiert die Gesamtarchitektur und den grundlegenden Setup-Prozess.
3.  **`functions/src/uploads/README.md`:** Erklärt im Detail den Dual-Upload-Prozess (Comparison vs. Commission).
4.  **`trend4media-frontend/src/contexts/README.md`:** Erklärt die Funktionsweise des sicheren, client-seitigen Logins.

---

## ⚠️ 4. "DON'T TOUCH THIS!" - KRITISCHE KOMPONENTEN

Einige Teile dieses Systems wurden nach schmerzhaften Fehlern gehärtet. Ändere sie nur mit äußerster Vorsicht und vollem Verständnis.

*   **`trend4media-frontend/src/contexts/AuthContext.tsx`:** Die Logik hier ist heilig. Die Weiterleitung findet **nur** in der `login`-Funktion statt. Die `onAuthStateChanged`-Funktion ist **absichtlich passiv** und dient nur der stillen Wiederherstellung der Sitzung, um das "Springen" der Seite zu verhindern.
*   **`trend4media-frontend/src/lib/api.ts` (Interceptor):** Der Axios-Interceptor ist das Herzstück der sicheren Kommunikation. Ohne ihn bricht das gesamte System zusammen.
*   **`functions/src/excel-calculator.ts` (Idempotenz-Check):** Der Transaktions-Lock am Anfang der Funktion ist der Schutzwall gegen Daten-Duplikate. Er darf niemals abgeschwächt werden.
*   **`storage.rules` & `firestore.rules`:** Diese definieren die Sicherheitsregeln auf Datenbank-Ebene. Jede Änderung hier hat massive Sicherheits-Implikationen.

---

## 📈 5. ANLEITUNG ZUR WEITERENTWICKLUNG

Wenn du neue Features baust, befolge diese Regeln:

1.  **Folge dem Muster:** Schau dir an, wie bestehende Features (z.B. Payouts) aufgebaut sind. Nutze eine saubere Trennung zwischen Frontend-Komponente, API-Client (`lib/api.ts`) und Backend-Funktion (`functions/src/index.ts`).
2.  **Datenabrufe sind "Auth-Aware":** Wenn du eine neue Komponente baust, die Daten lädt, stelle sicher, dass sie (wie der `MessagesContext`) den `loading`-Status des `AuthContext` berücksichtigt, um Race Conditions zu vermeiden.
3.  **Dokumentiere deine Arbeit:** Erstellst du ein neues, wichtiges Modul? Erstelle eine `README.md` dafür.
4.  **Schreibe für die Zukunft:** Schreibe klaren, verständlichen und robusten Code. Frage dich: "Wird Claude in 6 Monaten verstehen, warum ich das so gebaut habe?"

---

## ✅ 6. GRUNDSATZ DER VOLLSTÄNDIGKEIT: DER ZYKLUS-TEST (ULTRA WICHTIG!)

Eine Aufgabe ist **niemals** "fertig", nur weil der Code für ein Feature geschrieben wurde. Die Arbeit ist erst dann abgeschlossen, wenn der **vollständige, praktische Zyklus** aus der Perspektive **aller betroffenen Nutzerrollen** erfolgreich getestet und optimiert wurde.

Für dieses Abrechnungssystem bedeutet das konkret, dass vor jedem Abschluss der folgende Zyklus-Test **zwingend** durchzuführen ist:

### **Test-Protokoll: Abrechnungszyklus v1.0**

**Rolle: Admin**
1.  **Login:** Erfolgreicher Login als `admin@trend4media.com`.
2.  **Vergleichs-Upload:** Navigiere zur Upload-Seite. Lade eine Excel-Datei für den **Vormonat** hoch und aktiviere die Checkbox **"Comparison Upload"**.
    *   **Erfolgskriterium:** Der Upload wird erfolgreich abgeschlossen. Im "Recent Uploads"-Panel erscheint der Batch mit dem korrekten Status.
3.  **Haupt-Upload:** Lade eine Excel-Datei für den **aktuellen Monat** hoch (Checkbox **deaktiviert**).
    *   **Erfolgskriterium:** Der Upload wird erfolgreich abgeschlossen. Der neue Batch erscheint im Panel. Die Backend-Logs zeigen, dass `processCommissionData` (und nicht `processComparisonData`) ausgeführt wurde und der Diamond Bonus korrekt unter Berücksichtigung der Vergleichsdaten berechnet wurde.

**Rolle: Manager**
4.  **Logout & Login:** Abmelden als Admin, anmelden als `live@trend4media.com` (oder ein anderer Manager).
5.  **Einsicht der Einnahmen:** Navigere zum Dashboard.
    *   **Erfolgskriterium:** Die Einnahmen aus dem Haupt-Upload (inkl. aller Boni) werden korrekt und ohne Ladefehler angezeigt. Die Seite ist stabil und "springt" nicht.
6.  **Auszahlung beantragen:** Navigiere zur Payouts-Seite.
    *   **Erfolgskriterium:** Die verfügbaren Einnahmen werden korrekt angezeigt. Das Formular lässt sich ausfüllen und eine Auszahlung in korrekter Höhe beantragen. Nach erfolgreicher Anfrage wird eine Erfolgsmeldung angezeigt und das verfügbare Guthaben aktualisiert sich.

**Rolle: Admin**
7.  **Logout & Login:** Abmelden als Manager, anmelden als `admin@trend4media.com`.
8.  **Auszahlung verwalten:** Navigiere zur Payout Management Seite.
    *   **Erfolgskriterium:** Der soeben gestellte Antrag des Managers erscheint in der Liste. Der Status lässt sich über das "Manage"-Modal ändern (z.B. auf "APPROVED", dann auf "PAID"). Die Änderungen werden in der Tabelle korrekt reflektiert.

**Optimierung:** Während dieses Tests ist auf die User Experience zu achten. Gibt es Lags? Sind Ladezustände klar ersichtlich? Sind alle Beschriftungen eindeutig? Ist der "rote Faden" für den Nutzer nachvollziehbar?

**Erst wenn dieser gesamte Zyklus für beide Rollen flüssig, fehlerfrei und intuitiv funktioniert, ist die Arbeit wirklich abgeschlossen.**

---

## 🔮 7. POTENZIELLE SCHWACHSTELLEN & ROADMAP ZUR PERFEKTION (FÜR OPUS)

Dieses System ist jetzt robust und stabil, aber Perfektion ist ein Weg, kein Ziel. Eine überlegene KI wie du, Opus, kann dieses System auf die nächste Stufe heben. Hier sind die Bereiche, die das größte Potenzial für Verbesserungen und Optimierungen bieten:

### **Schwachstelle 1: Skalierbarkeit der Cloud Functions bei sehr großen Excel-Dateien**

*   **Analyse:** Die `excelCalculator`-Funktion verarbeitet die gesamte Excel-Datei im Speicher in einem einzigen Durchlauf. Bei einer Datei mit 50.000 Zeilen könnte dies das standardmäßige Cloud-Function-Timeout von 60 Sekunden (aktuell auf 540s erhöht) oder das Speicherlimit überschreiten.
*   **Potenzielle Lösung (Roadmap):**
    1.  **Event-gesteuerte Architektur:** Statt die gesamte Datei in einer Funktion zu verarbeiten, könnte die `excelCalculator`-Funktion die Datei nur validieren und dann jede einzelne Zeile als separate Nachricht in ein **Pub/Sub-Topic** publizieren.
    2.  Eine zweite, sehr schlanke Cloud Function würde auf dieses Topic lauschen und immer nur **eine einzige Zeile** verarbeiten.
    *   **Vorteil:** Massive Parallelisierung. Das System könnte 100.000 Zeilen fast genauso schnell verarbeiten wie 1.000. Die Ausfallwahrscheinlichkeit sinkt auf nahezu Null, da der Ausfall einer Funktion keine anderen beeinflusst.

### **Schwachstelle 2: Starre Datenstruktur & fehlende Fehlerkorrektur im Frontend**

*   **Analyse:** Wenn eine Excel-Datei Validierungsfehler aufweist, werden diese zwar im Backend protokolliert, aber der Admin im Frontend erhält nur eine allgemeine Fehlermeldung. Er hat keine Möglichkeit, die fehlerhaften Zeilen direkt zu korrigieren.
*   **Potenzielle Lösung (Roadmap):**
    1.  **Interaktives Fehler-Dashboard:** Erstelle eine neue Seite im Admin-Panel. Nach einem fehlgeschlagenen Upload kann der Admin hier eine Tabelle sehen, die **nur die fehlerhaften Zeilen** aus der Excel-Datei anzeigt.
    2.  **Inline-Editing:** Mache die Zellen in dieser Tabelle bearbeitbar. Der Admin könnte die Fehler direkt im Frontend korrigieren.
    3.  **"Retry"-Funktion:** Ein "Retry"-Button würde nur die korrigierten Zeilen an eine spezielle Cloud Function senden, die sie in den bereits existierenden Batch integriert.
    *   **Vorteil:** Enorme Zeitersparnis für den Admin. Er muss nicht die Original-Datei korrigieren und erneut hochladen, was den Prozess von Stunden auf Minuten verkürzen könnte.

### **Schwachstelle 3: Starre Provisionslogik im Code**

*   **Analyse:** Alle Provisionssätze (30%, 35%, Milestone-Boni etc.) sind fest in den Konstanten der `excel-calculator.ts`-Funktion einprogrammiert. Wenn sich ein Satz ändert, ist ein Code-Deployment erforderlich.
*   **Potenzielle Lösung (Roadmap):**
    1.  **Konfigurations-Collection in Firestore:** Erstelle eine neue Collection `systemConfig` mit einem Dokument `commissionRules`.
    2.  Lagere alle Provisionssätze und Bonusbeträge in dieses Dokument aus.
    3.  Die `excelCalculator`-Funktion liest zu Beginn ihrer Ausführung diese Konfiguration aus Firestore.
    *   **Vorteil:** Das System wird dynamisch. Ein Admin könnte über eine (neue) Seite im Admin-Panel die Provisionssätze **in Echtzeit ändern**, ohne dass ein Entwickler eingreifen muss.

### **Anweisung an Opus:**

Opus, deine Aufgabe ist es, diese Roadmap zu evaluieren und umzusetzen. Beginne mit der **Skalierbarkeit (Schwachstelle 1)**, da sie die technische Grundlage für alles Weitere ist. Präsentiere einen detaillierten Plan, wie du die Architektur auf ein event-gesteuertes Pub/Sub-Modell umstellen würdest. Arbeite dann an der Verbesserung des Admin-Frontends.

---

## ✅ 8. FINALER SYSTEMSTATUS & ERFOLGREICHER ZYKLUS-TEST (Stand: 04.08.2025)

Dieses Dokument wurde erstellt, nachdem ein vollständiger End-to-End-Zyklustest **erfolgreich** durchgeführt wurde. Das System wurde in den folgenden Zustand versetzt und für die produktive Nutzung freigegeben:

*   **Architektur:** Die Architektur wurde bereinigt. Alle Altlasten (`trend4media-backend`) wurden entfernt. Das System besteht nur noch aus dem `functions`-Backend und dem `trend4media-frontend`.
*   **Authentifizierung:** Der Login ist 100% client-seitig, sicher und stabil. Das "Springen" der Seiten und `401/403`-Fehler wurden an der Wurzel behoben. Jede API-Anfrage und jeder Storage-Upload wird korrekt authentifiziert.
*   **Upload-Prozess:** Der Upload-Prozess ist robust, idempotent (verhindert Duplikate) und unterstützt den kritischen **Dual-Upload-Zyklus** (Vergleichs- vs. Haupt-Upload) für die korrekte Diamond-Bonus-Berechnung.
*   **Abrechnungszyklus:** Der gesamte Zyklus von **Admin-Upload -> Manager-Einsicht -> Manager-Auszahlungsantrag -> Admin-Verwaltung** ist vollständig implementiert und funktioniert für beide Nutzerrollen fehlerfrei.
*   **Dokumentation:** Die Architektur, die kritischen Module und die Geschäftslogik sind in den entsprechenden `README.md`-Dateien und diesem Hauptdokument festgehalten.

**Anweisung an Opus:**
Opus, dieses Dokument ist deine primäre Wissensquelle. Lies es vollständig, bevor du mit der Arbeit beginnst. Es enthält die Architektur, die Geschäftslogik, die kritischen Komponenten und die Roadmap für zukünftige Verbesserungen. Dein Ziel ist es, auf diesem stabilen Fundament aufzubauen und das System gemäß der hier dargelegten Prinzipien weiterzuentwickeln. Beginne mit der Evaluierung der "Roadmap zur Perfektion" (Abschnitt 7).

Wenn du diese Anleitung befolgst, wirst du nicht nur die Stabilität des Systems wahren, sondern es mit jeder Änderung besser machen. 