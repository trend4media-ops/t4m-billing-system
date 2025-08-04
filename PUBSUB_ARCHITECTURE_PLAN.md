# 🏗️ Implementierungsplan: Event-gesteuerte Pub/Sub-Architektur

**Version 1.0 - Erstellt am 07.08.2025**

## Executive Summary

Dieser Plan beschreibt die Transformation der monolithischen `excel-calculator.ts` Cloud Function in eine hochskalierbare, event-gesteuerte Architektur mittels Google Cloud Pub/Sub. Die neue Architektur ermöglicht die parallele Verarbeitung von 100.000+ Excel-Zeilen mit nahezu unbegrenzter Skalierbarkeit.

## 1. Aktuelle Herausforderungen

- **Timeout-Risiko**: Bei großen Excel-Dateien (50.000+ Zeilen) droht das 540-Sekunden-Timeout
- **Speicherlimit**: Die gesamte Datei wird in den Speicher geladen (1GB Limit)
- **Sequenzielle Verarbeitung**: Jede Zeile wird nacheinander verarbeitet
- **Single Point of Failure**: Ein Fehler unterbricht die gesamte Verarbeitung

## 2. Neue Architektur-Komponenten

### 2.1 Cloud Functions

#### A) `excel-processor-orchestrator` (Ersetzt `excelCalculator`)
- **Trigger**: Storage Object Finalized
- **Aufgaben**:
  - Excel-Datei validieren
  - Metadaten in `upload-metadata` erstellen
  - Datei in Chunks aufteilen (je 100 Zeilen)
  - Jeden Chunk als Message in Pub/Sub publizieren
- **Timeout**: 60 Sekunden (ausreichend für Splitting)
- **Memory**: 512MB

#### B) `row-processor-worker`
- **Trigger**: Pub/Sub Topic `excel-rows-to-process`
- **Aufgaben**:
  - Einzelnen Chunk (100 Zeilen) verarbeiten
  - Transaktionen in Firestore schreiben
  - Fehlerhafte Zeilen in `failed-rows` Collection speichern
- **Timeout**: 60 Sekunden
- **Memory**: 256MB
- **Concurrency**: 1000 (parallele Instanzen)

#### C) `bonus-calculator-worker`
- **Trigger**: Pub/Sub Topic `calculate-bonuses`
- **Aufgaben**:
  - Boni für einen Manager berechnen
  - Diamond Bonus mit Vergleichsdaten abgleichen
  - Ergebnisse in `bonuses` Collection schreiben
- **Timeout**: 60 Sekunden
- **Memory**: 256MB

#### D) `batch-finalizer`
- **Trigger**: Pub/Sub Topic `finalize-batch`
- **Aufgaben**:
  - Prüfen ob alle Chunks verarbeitet wurden
  - Batch-Status auf COMPLETED setzen
  - Zusammenfassung erstellen
- **Timeout**: 60 Sekunden
- **Memory**: 256MB

### 2.2 Pub/Sub Topics

1. **`excel-rows-to-process`**
   - Message Format:
   ```json
   {
     "batchId": "batch_123",
     "chunkId": "chunk_456",
     "month": "202508",
     "isComparison": false,
     "rows": [...], // 100 Zeilen
     "totalChunks": 500,
     "chunkIndex": 45
   }
   ```

2. **`calculate-bonuses`**
   - Message Format:
   ```json
   {
     "batchId": "batch_123",
     "managerId": "mgr_LIVE_97",
     "month": "202508",
     "transactions": [...]
   }
   ```

3. **`finalize-batch`**
   - Message Format:
   ```json
   {
     "batchId": "batch_123",
     "month": "202508",
     "totalChunks": 500,
     "processedChunks": 500
   }
   ```

### 2.3 Neue Firestore Collections

1. **`batch-chunks`**
   ```typescript
   {
     batchId: string,
     chunkId: string,
     status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
     rowCount: number,
     processedAt?: Timestamp,
     error?: string,
     retryCount: number
   }
   ```

2. **`failed-rows`**
   ```typescript
   {
     batchId: string,
     rowNumber: number,
     rowData: any,
     error: string,
     timestamp: Timestamp
   }
   ```

## 3. Implementierungs-Schritte

### Phase 1: Setup (1 Tag)
1. Pub/Sub Topics erstellen
2. Service Account Berechtigungen konfigurieren
3. Neue Collections in Firestore anlegen

### Phase 2: Orchestrator Function (2 Tage)
1. `excel-processor-orchestrator.ts` erstellen
2. Chunk-Splitting-Logik implementieren
3. Pub/Sub Publishing integrieren
4. Unit Tests schreiben

### Phase 3: Worker Functions (3 Tage)
1. `row-processor-worker.ts` implementieren
2. `bonus-calculator-worker.ts` implementieren
3. `batch-finalizer.ts` implementieren
4. Error Handling und Retry-Logik
5. Integration Tests

### Phase 4: Migration (1 Tag)
1. Alte `excel-calculator.ts` deaktivieren
2. Neue Functions deployen
3. Monitoring einrichten
4. Rollback-Plan erstellen

### Phase 5: Testing & Optimierung (2 Tage)
1. Load Testing mit 100.000+ Zeilen
2. Performance-Metriken analysieren
3. Concurrency-Limits optimieren
4. Cost-Analyse durchführen

## 4. Vorteile der neuen Architektur

### Skalierbarkeit
- **Vorher**: Max. ~50.000 Zeilen in 9 Minuten
- **Nachher**: 1.000.000+ Zeilen in < 2 Minuten

### Resilienz
- **Automatische Wiederholung**: Fehlgeschlagene Chunks werden automatisch wiederholt
- **Teilweise Verarbeitung**: Erfolgreiche Chunks bleiben erhalten
- **Fehler-Isolation**: Ein fehlerhafter Chunk blockiert nicht andere

### Kosten-Effizienz
- **Pay-per-Use**: Nur tatsächlich verarbeitete Zeilen kosten
- **Optimale Ressourcennutzung**: Kleine Functions statt einer großen
- **Auto-Scaling**: Keine Over-Provisioning

### Monitoring & Debugging
- **Granulare Fehler**: Genau wissen, welche Zeile fehlgeschlagen ist
- **Progress Tracking**: Live-Fortschritt der Verarbeitung
- **Detaillierte Metriken**: Pro Chunk und pro Manager

## 5. Code-Beispiele

### Orchestrator (Auszug)
```typescript
export const excelProcessorOrchestrator = onObjectFinalized(
  { region: "us-west1", timeoutSeconds: 60, memory: "512MB" },
  async (event: StorageEvent) => {
    const { bucket, name: filePath, metadata } = event.data;
    
    // Validation...
    
    const workbook = XLSX.readFile(tempFilePath);
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Create chunks of 100 rows each
    const chunks = [];
    const CHUNK_SIZE = 100;
    
    for (let i = 1; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      chunks.push({
        batchId,
        chunkId: `${batchId}_chunk_${Math.floor(i/CHUNK_SIZE)}`,
        rows: chunk,
        // ... other metadata
      });
    }
    
    // Publish each chunk to Pub/Sub
    const pubsub = new PubSub();
    const topic = pubsub.topic('excel-rows-to-process');
    
    await Promise.all(chunks.map(chunk => 
      topic.publishMessage({ data: Buffer.from(JSON.stringify(chunk)) })
    ));
  }
);
```

### Row Processor (Auszug)
```typescript
export const rowProcessorWorker = onMessagePublished(
  {
    topic: 'excel-rows-to-process',
    region: 'us-west1',
    timeoutSeconds: 60,
    memory: '256MB',
    maxInstances: 1000
  },
  async (event: CloudEvent<MessagePublishedData>) => {
    const message = JSON.parse(
      Buffer.from(event.data.message.data, 'base64').toString()
    );
    
    const { batchId, chunkId, rows } = message;
    const batch = db.batch();
    
    for (const row of rows) {
      try {
        // Process individual row
        const transaction = await processRow(row);
        batch.set(db.collection('transactions').doc(transaction.id), transaction);
      } catch (error) {
        // Save failed row for later inspection
        await db.collection('failed-rows').add({
          batchId,
          rowData: row,
          error: error.message,
          timestamp: FieldValue.serverTimestamp()
        });
      }
    }
    
    await batch.commit();
    
    // Update chunk status
    await db.collection('batch-chunks').doc(chunkId).update({
      status: 'COMPLETED',
      processedAt: FieldValue.serverTimestamp()
    });
  }
);
```

## 6. Migrations-Strategie

1. **Parallelbetrieb**: Neue Architektur parallel zur alten laufen lassen
2. **Feature Flag**: Schrittweise Traffic umleiten
3. **Monitoring**: Beide Systeme vergleichen
4. **Rollback**: Alte Function bleibt 30 Tage aktiv

## 7. Erfolgs-Metriken

- Verarbeitungszeit für 100.000 Zeilen: < 2 Minuten
- Fehlerrate: < 0.1%
- Kosten pro 1 Million Zeilen: < $5
- Verfügbarkeit: 99.9%

## 8. Nächste Schritte

1. **Review**: Technisches Review mit dem Team
2. **Approval**: Freigabe für Implementierung
3. **Sprint Planning**: Aufgaben in 2-Wochen-Sprint einplanen
4. **Kickoff**: Implementierung starten

---

**Anmerkung für Opus**: Dies ist der detaillierte Plan für Schwachstelle 1. Nach erfolgreichem Review und Approval kann mit der Implementierung begonnen werden. Die modulare Struktur ermöglicht es, einzelne Komponenten unabhängig zu entwickeln und zu testen. 