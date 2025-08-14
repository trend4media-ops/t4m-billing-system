
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { calculateDownlineForPeriod } from './downline-calculator';

// Firebase Admin SDK is initialized in the root index.js
const db = admin.firestore();

// Helper: normalize manager handle/name for mapping
function normalizeHandle(s: string | undefined | null): string {
  if (!s) return '';
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}

// NEW: robust euro number parser that accepts "1.234,56", "1234.56", "€ 1.234,56" etc.
function parseEuroNumber(value: any): number {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  // Remove currency symbols and spaces
  let s = raw.replace(/[€\s]/g, '');
  // If both separators present, assume dot is thousand separator and comma is decimal
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(/,/g, '.');
  } else if (s.includes(',')) {
    // Only comma present → treat as decimal separator
    s = s.replace(/,/g, '.');
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// Consider a milestone achieved if the cell is non-empty OR matches accepted markers
function milestonePresent(cell: any): boolean {
  if (cell === undefined || cell === null) return false;
  const s = String(cell).trim();
  if (!s) return false;
  // Numeric positive value counts
  const n = parseEuroNumber(s);
  if (isFinite(n) && n > 0) return true;
  // Accept markers like 'x', 'X', '1', 'ja', 'yes'
  if (/^(x|1|true|ja|yes)$/i.test(s)) return true;
  return false;
}

const UPLOAD_COLLECTION = 'uploadBatches';

// Helper to publish a dashboard update
async function addDashboardUpdate(update: { type: string; batchId: string; month: string; results?: any }) {
  try {
    await db.collection('dashboard-updates').add({
      ...update,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('⚠️ Failed to write dashboard update', update.type, e);
  }
}

const commissionRowSchema = z.object({
  managerHandle: z.string().min(1, { message: "Manager Handle is required" }),
  managerType: z.enum(['live', 'team']),
  grossAmount: z.number().positive({ message: "Gross Amount must be a positive number" }),
  milestoneN: z.any().optional(),
  milestoneO: z.any().optional(),
  milestoneP: z.any().optional(),
  milestoneS: z.any().optional(),
});
// Mark as intentionally referenced (kept for documentation of expected row shape)
void (commissionRowSchema as unknown);

// Commission logic constants based on the definitive document v2.0
const MILESTONE_DEDUCTIONS = {
  N: 300,
  O: 1000,
  P: 240,
  S: 150,
};

// Fixed milestone payouts per manager type (Live/Team)
const MILESTONE_BONUSES = {
  live: { S: 75, N: 150, O: 400, P: 100 },
  team: { S: 80, N: 165, O: 450, P: 120 },
};

const BASE_COMMISSION_RATES = {
  live: 0.30,
  team: 0.35,
};

// Ensure only one active batch per month: clear previous month data and mark batches
async function clearExistingMonthData(month: string, currentBatchId: string): Promise<{ supersededCount: number }>{
  const firestore = admin.firestore();

  // Find other batches for this month
  const otherBatchesSnapshot = await firestore
    .collection(UPLOAD_COLLECTION)
    .where('month', '==', month)
    .get();

  const previousBatchIds: string[] = [];
  for (const docSnap of otherBatchesSnapshot.docs) {
    if (docSnap.id !== currentBatchId) {
      previousBatchIds.push(docSnap.id);
    }
  }

  // Mark other batches as SUPERSEDED and inactive
  const supersedeBatch = firestore.batch();
  for (const docSnap of otherBatchesSnapshot.docs) {
    if (docSnap.id !== currentBatchId) {
      supersedeBatch.update(docSnap.ref, {
        status: 'SUPERSEDED',
        active: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
  await supersedeBatch.commit();

  if (previousBatchIds.length === 0) {
    return { supersededCount: 0 };
  }

  // Delete previous month data to prevent duplication
  const collectionsToClear = ['transactions', 'manager-earnings'];

  for (const collectionName of collectionsToClear) {
    let query = firestore.collection(collectionName).where('month', '==', month);
    if (collectionName === 'transactions') {
      // Narrow to previous batches for performance
      for (const oldBatchId of previousBatchIds) {
        const snapshot = await firestore
          .collection(collectionName)
          .where('batchId', '==', oldBatchId)
          .get();
        const delBatch = firestore.batch();
        snapshot.docs.forEach(d => delBatch.delete(d.ref));
        if (snapshot.size > 0) {
          await delBatch.commit();
        }
      }
    } else {
      // manager-earnings uses month key; clear all for month, will be rebuilt
      const snapshot = await query.get();
      const delBatch = firestore.batch();
      snapshot.docs.forEach(d => delBatch.delete(d.ref));
      if (snapshot.size > 0) {
        await delBatch.commit();
      }
    }
  }

  // Remove only month-level auto bonuses if ever created under legacy type
  const legacyBonuses = await firestore
    .collection('bonuses')
    .where('month', '==', month)
    .where('type', '==', 'MONTHLY_TOTAL')
    .get();
  if (!legacyBonuses.empty) {
    const delBatch = firestore.batch();
    legacyBonuses.docs.forEach(d => delBatch.delete(d.ref));
    await delBatch.commit();
  }

  // NEW: Purge milestone bonus docs for this month to avoid double counting across re-uploads
  try {
    const milestoneSnap = await firestore
      .collection('bonuses')
      .where('month', '==', month)
      .where('type', 'in', ['MILESTONE_S', 'MILESTONE_N', 'MILESTONE_O', 'MILESTONE_P'])
      .get();
    if (!milestoneSnap.empty) {
      const b = firestore.batch();
      milestoneSnap.docs.forEach(d => b.delete(d.ref));
      await b.commit();
    }
  } catch (e) {
    console.warn('⚠️ Failed to purge milestone bonuses for month', month, e);
  }

  return { supersededCount: previousBatchIds.length };
}

/**
 * Creates or updates manager accounts from Excel data - OPTIMIZED VERSION
 */
async function ensureManagersExist(rows: any[][], uploadDocRef?: admin.firestore.DocumentReference): Promise<Map<string, string>> {
  console.log('📥 🚀 OPTIMIZED: Loading all managers in bulk...');
  const firestore = admin.firestore();

  const batch = firestore.batch();
  const managerMap = new Map<string, string>(); // normalized handle/name -> managerId
  
  // Extract unique managers from Excel
  const uniqueManagers = new Set<{name: string, type: 'live' | 'team', email?: string}>();
  const managerNames = new Set<string>();
  
  // Skip header row and collect unique managers
  for (const row of rows.slice(1)) {
    if (!row || !row[0]) continue;
    
    const liveManager = row[4]?.toString().trim();
    const teamManager = row[6]?.toString().trim();
    const managerName = liveManager || teamManager;
    const managerType = liveManager ? 'live' : 'team';
    
    if (managerName) {
      const norm = normalizeHandle(managerName);
      if (!managerNames.has(norm)) {
        managerNames.add(norm);
        uniqueManagers.add({
          name: managerName,
          type: managerType,
          email: row[7]?.toString().trim()
        });
      }
    }
  }
  
  console.log(`📊 Found ${uniqueManagers.size} unique managers in Excel`);
  
  // Load ALL existing managers in ONE query
  const existingManagersSnapshot = await firestore.collection('managers').get();
  const existingByHandle = new Map<string, string>();
  existingManagersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.handle) existingByHandle.set(normalizeHandle(data.handle as string), doc.id);
    if (data.name) existingByHandle.set(normalizeHandle(data.name as string), doc.id);
  });
  
  let newManagersCount = 0;
  
  // Process each unique manager
  for (const managerData of uniqueManagers) {
    const canonicalHandle = normalizeHandle(managerData.name);
    if (existingByHandle.has(canonicalHandle)) {
      const managerId = existingByHandle.get(canonicalHandle)!;
      managerMap.set(canonicalHandle, managerId);
      console.log(`✅ Manager exists: ${managerData.name} (${managerId})`);
    } else {
      // Create new manager with handle and name
      const managerId = firestore.collection('managers').doc().id;

      // Standardize credentials
      const baseHandle = (managerData.name || managerId).toString();
      const cleanHandle = baseHandle.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const defaultEmailBase = `${cleanHandle}@trend4media.com`;
      let resolvedEmail = (managerData.email && /@/.test(managerData.email)) ? String(managerData.email).trim() : defaultEmailBase;
      const defaultPassword = `manager123`;

      // Create Firestore manager doc (basic fields). Email will be merged after auth creation below
      batch.set(firestore.collection('managers').doc(managerId), {
        name: managerData.name,
        handle: managerData.name,
        type: managerData.type.toUpperCase(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        active: true,
        totalEarnings: 0,
        pendingPayouts: 0,
        completedPayouts: 0
      });
      managerMap.set(canonicalHandle, managerId);
      newManagersCount++;

      // Create auth user account and mirror to users collection; handle email collisions
      (async () => {
        let createdUid: string | null = null;
        let emailCandidate = resolvedEmail;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const userRecord = await admin.auth().createUser({
              email: emailCandidate,
              password: defaultPassword,
              displayName: managerData.name,
            });
            createdUid = userRecord.uid;
            resolvedEmail = emailCandidate;
            break;
          } catch (err: any) {
            if (err && err.code === 'auth/email-already-exists') {
              // Try a new candidate email
              emailCandidate = `${cleanHandle}${attempt + 1}@manager.com`;
              continue;
            }
            console.warn(`⚠️ Failed to create auth user for ${managerData.name}:`, err?.message || err);
            break;
          }
        }

        if (createdUid) {
          try {
            await admin.auth().setCustomUserClaims(createdUid, { role: 'MANAGER', managerId });
          } catch (e) {
            console.warn(`⚠️ Failed setting claims for ${createdUid}`, e);
          }
          try {
            await firestore.collection('users').doc(createdUid).set({
              email: resolvedEmail,
              role: 'manager',
              managerId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          } catch (e) {
            console.warn(`⚠️ Failed writing users doc for ${createdUid}`, e);
          }
          try {
            await firestore.collection('managers').doc(managerId).set({
              email: resolvedEmail,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          } catch (e) {
            console.warn(`⚠️ Failed updating manager email for ${managerId}`, e);
          }
        }
      })().catch(() => {});
    }
  }
  
  if (newManagersCount > 0) {
    await batch.commit();
    if (uploadDocRef) {
      await uploadDocRef.update({ 
        progress: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
  
  console.log(`✅ Manager mapping complete: ${managerMap.size} managers ready`);
  return managerMap;
}

/**
 * Updates manager earnings after commission calculation
 */
async function updateManagerEarnings(batchId: string, month: string): Promise<void> {
  console.log(`📊 Updating manager earnings for batch ${batchId}, month ${month}`);
  const firestore = admin.firestore();
  const batch = firestore.batch();

  // helpers
  const getPrevMonth = (p: string) => {
    if (!/^\d{6}$/.test(p)) return '';
    const y = parseInt(p.slice(0,4),10);
    const m = parseInt(p.slice(4,6),10);
    const date = new Date(y, m-2, 1);
    const yy = date.getFullYear();
    const mm = String(date.getMonth()+1).padStart(2,'0');
    return `${yy}${mm}`;
  };
  
  // Get all transactions for this batch
  const transactionsSnapshot = await firestore.collection('transactions')
      .where('batchId', '==', batchId)
      .get();
  
  // Get all bonuses for this month (exclude legacy MONTHLY_TOTAL)
  const bonusesSnapshot = await firestore.collection('bonuses')
      .where('month', '==', month)
      .get();
  
  const managerEarnings = new Map<string, {
      baseCommission: number,
      bonuses: number,
      totalGross: number,
      totalDeductions: number,
      totalNet: number,
      transactionCount: number,
      milestoneSum: number,
      extrasSum: number,
      creatorCount: number,
      downlineEarnings?: number,
  }>();
  const managerCreators = new Map<string, Set<string>>();
  
  // Process transactions
  transactionsSnapshot.forEach(doc => {
      const data = doc.data() as any;
      const managerId = data.managerId as string;
      
      if (!managerEarnings.has(managerId)) {
          managerEarnings.set(managerId, {
              baseCommission: 0,
              bonuses: 0, // will hold extras + milestone payouts
              totalGross: 0,
              totalDeductions: 0,
              totalNet: 0,
              transactionCount: 0,
              milestoneSum: 0,
              extrasSum: 0,
              creatorCount: 0,
              downlineEarnings: 0,
          });
      }
      
      const earnings = managerEarnings.get(managerId)!;
      earnings.baseCommission += data.baseCommission || 0;
      earnings.totalGross += data.grossAmount || 0;
      earnings.totalDeductions += data.deductions || 0;
      earnings.totalNet += data.netForCommission || 0;
      earnings.transactionCount += 1;

      // Track distinct creators per manager
      const creatorId = (data.creatorId || data.creator || 'unknown') as string;
      if (!managerCreators.has(managerId)) managerCreators.set(managerId, new Set<string>());
      managerCreators.get(managerId)!.add(creatorId);
  });

  // Process bonuses
  bonusesSnapshot.forEach(doc => {
      const data = doc.data() as any;
      const managerId = data.managerId as string;
      const t = String(data.type || '').toUpperCase();
      if (t === 'MONTHLY_TOTAL') return; // legacy noise
      if (!managerEarnings.has(managerId)) {
          managerEarnings.set(managerId, {
              baseCommission: 0,
              bonuses: 0, // will hold extras + milestone payouts
              totalGross: 0,
              totalDeductions: 0,
              totalNet: 0,
              transactionCount: 0,
              milestoneSum: 0,
              extrasSum: 0,
              creatorCount: 0,
              downlineEarnings: 0,
          } as any);
      }
      const earnings = managerEarnings.get(managerId)! as any;
      const amount = data.amount || 0;
      const isMilestone = (t === 'MILESTONE_S' || t === 'MILESTONE_N' || t === 'MILESTONE_O' || t === 'MILESTONE_P');
      if (isMilestone) {
        earnings.milestoneSum = (earnings.milestoneSum || 0) + amount;
      } else if (t === 'DOWNLINE_LEVEL_A' || t === 'DOWNLINE_LEVEL_B' || t === 'DOWNLINE_LEVEL_C') {
        // Keep downline separate from extras
        earnings.downlineEarnings = (earnings.downlineEarnings || 0) + amount;
      } else if (t === 'RECRUITMENT_BONUS' || t === 'GRADUATION_BONUS' || t === 'DIAMOND_BONUS') {
        // Only count manual one-per-month bonuses awarded via admin endpoint
        // They use deterministic ids: `${managerId}_${month}_${type}` or set awardMethod: 'MANUAL'
        const expectedId = `${managerId}_${month}_${t}`;
        const isManual = (doc.id === expectedId) || (String(data.awardMethod || '').toUpperCase() === 'MANUAL');
        if (isManual) {
          earnings.extrasSum = (earnings.extrasSum || 0) + amount;
        }
      }
  });

  // Diamond bonus per spec unchanged
  const prevMonth = getPrevMonth(month);
  if (prevMonth === month) {
    // no-op guard to avoid unused variable warnings in certain builds
  }

  // Update manager documents and monthly summaries
  for (const [managerId, earningsRaw] of managerEarnings) {
      const earnings: any = earningsRaw as any;
      const managerRef = firestore.collection('managers').doc(managerId);
      const milestoneSum = earnings.milestoneSum || 0;
      const extrasSum = earnings.extrasSum || 0;
      const downlineSum = earnings.downlineEarnings || 0;
      const totalEarnings = earnings.baseCommission + milestoneSum + extrasSum + downlineSum;
      
      batch.update(managerRef, {
          totalEarnings: admin.firestore.FieldValue.increment(totalEarnings),
          lastProcessedMonth: month,
          lastProcessedBatch: batchId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      const monthlyEarningsRef = firestore.collection('manager-earnings').doc(`${managerId}_${month}`);
      batch.set(monthlyEarningsRef, {
          managerId,
          month,
          batchId,
          baseCommission: earnings.baseCommission,
          milestonePayouts: milestoneSum,
          extras: extrasSum,
          downlineEarnings: downlineSum,
          totalEarnings,
          totalGross: earnings.totalGross,
          totalDeductions: earnings.totalDeductions,
          totalNet: earnings.totalNet,
          transactionCount: earnings.transactionCount,
          creatorCount: managerCreators.get(managerId)?.size || 0,
          status: 'CALCULATED',
          calculatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
  }
  
  await batch.commit();
  console.log(`✅ Updated earnings for ${managerEarnings.size} managers`);

  // Write batch summary for dashboard/report pages
  try {
    const uploadDoc = await firestore.collection(UPLOAD_COLLECTION).doc(batchId).get();
    const totalRows = uploadDoc.exists ? (uploadDoc.data()!.totalRows || 0) : 0;

    let sumGross = 0;
    let sumBaseCommission = 0;
    let sumMilestone = 0;
    let sumExtras = 0;
    let sumDownline = 0;
    let sumTotals = 0;
    let sumTransactions = 0;
    for (const aggRaw of managerEarnings.values()) {
      const agg: any = aggRaw as any;
      sumGross += agg.totalGross || 0;
      sumBaseCommission += agg.baseCommission || 0;
      sumMilestone += agg.milestoneSum || 0;
      sumExtras += agg.extrasSum || 0;
      sumDownline += agg.downlineEarnings || 0;
      sumTotals += (agg.baseCommission || 0) + (agg.milestoneSum || 0) + (agg.extrasSum || 0) + (agg.downlineEarnings || 0);
      sumTransactions += agg.transactionCount || 0;
    }

    await firestore.collection('batch-summaries').doc(batchId).set({
      month,
      processedRows: sumTransactions,
      totalRows,
      managersProcessed: managerEarnings.size,
      totalRevenue: Math.round(sumGross * 100) / 100,
      totalCommissions: Math.round(sumTotals * 100) / 100, // total payout now includes downline as part of earnings
      totalBonuses: Math.round(sumMilestone * 100) / 100,  // milestone payouts only
      collections: {
        transactions: sumTransactions,
        bonuses: bonusesSnapshot.size,
        managerEarnings: managerEarnings.size,
        processedManagers: managerEarnings.size,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    await addDashboardUpdate({
      type: 'EARNINGS_UPDATED',
      batchId,
      month,
      results: {
        managersProcessed: managerEarnings.size,
        totalRevenue: Math.round(sumGross * 100) / 100,
        totalCommissions: Math.round(sumTotals * 100) / 100,
        totalBonuses: Math.round(sumMilestone * 100) / 100,
        totalTransactions: sumTransactions,
      }
    });
  } catch (e) {
    console.warn('⚠️ Failed to write batch summary or dashboard update', e);
  }
}

/**
 * Processes an uploaded Excel file directly via an API call.
 * This function is designed to be called from an Express route.
 * @param batchId The ID of the upload metadata document in Firestore.
 */
export async function processUploadedExcel(batchId: string) {
  const uploadDocRef = db.collection(UPLOAD_COLLECTION).doc(batchId);
  const snap = await uploadDocRef.get();

  if (!snap.exists) {
    console.error(`Upload metadata document with ID ${batchId} not found.`);
    throw new Error(`Upload metadata not found for batchId: ${batchId}`);
  }

  const data = snap.data()! as any;

  // Idempotency guard: prevent duplicate processing
  if (data.isProcessing === true && (data.status === 'PROCESSING' || data.status === 'DOWNLOADING' || data.status === 'CALCULATING')) {
    console.warn(`⏳ Batch ${batchId} is already processing. Skip duplicate start.`);
    return Promise.resolve();
  }
  await uploadDocRef.update({ isProcessing: true, status: 'PROCESSING', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await addDashboardUpdate({ type: 'PROCESSING_ENQUEUED', batchId, month: data.month });

  const { fileName, filePath, isComparison, month } = data;

  console.log(`🚀 OPTIMIZED PROCESSING: Starting file ${filePath} with batch ID: ${batchId}`);
  
  const fileBucket = admin.storage().bucket().name; 
  const bucket = admin.storage().bucket(fileBucket);
  const tempFilePath = `/tmp/${fileName}`;

  try {
    // Enforce single active batch per month and clear old data BEFORE processing
    const dedupe = await clearExistingMonthData(month, batchId);
    await uploadDocRef.update({ active: true, dedupeSuperseded: dedupe.supersededCount });

    // Step 1: Download file
    await uploadDocRef.update({ 
      status: 'DOWNLOADING', 
      progress: 5,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() 
    });
    await addDashboardUpdate({ type: 'DOWNLOAD_STARTED', batchId, month, results: { filePath } });
    
    console.log(`📥 Downloading file from ${filePath}...`);
    await bucket.file(filePath).download({ destination: tempFilePath });
    console.log(`✅ File downloaded to ${tempFilePath}`);
    
    // Step 2: Parse Excel
    await uploadDocRef.update({ 
      status: 'PROCESSING', 
      progress: 15, 
      updatedAt: admin.firestore.FieldValue.serverTimestamp() 
    });
    await addDashboardUpdate({ type: 'PROCESSING_STARTED', batchId, month });

    console.log(`📊 Parsing Excel file...`);
    const workbook = XLSX.readFile(tempFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    const totalRows = rows.length - 1;

    console.log(`✅ Excel parsed: ${totalRows} data rows found`);
    await uploadDocRef.update({ 
      totalRows,
      progress: 20,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Step 3: Load managers efficiently
    console.log(`👥 Loading and preparing managers...`);
    const managerMap = await ensureManagersExist(rows, uploadDocRef);
    
    // Step 4: Process data based on type
    if (isComparison) {
      console.log(`📈 Processing COMPARISON data for month: ${month}`);
      await uploadDocRef.update({ 
        status: 'CALCULATING', 
        progress: 40,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });
      await processComparisonData(rows, month, fileName, uploadDocRef, managerMap);
    } else {
      console.log(`💰 Processing FULL commission data for month: ${month}`);
      await uploadDocRef.update({ 
        status: 'PROCESSING',
        progress: 35,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await processCommissionData(rows, batchId, month, uploadDocRef, managerMap);
      
      // Step 5: Update manager earnings
      console.log(`📊 Updating manager earnings summaries...`);
      await uploadDocRef.update({ 
        status: 'CALCULATING', 
        progress: 95,
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      });
      await addDashboardUpdate({ type: 'CALCULATING', batchId, month });
      await updateManagerEarnings(batchId, month);

      // Trigger downline calculation for this period (non-blocking)
      calculateDownlineForPeriod(month).catch((e) => console.warn('Downline calc failed:', e));
    }

    // Step 6: Complete
    console.log(`✅ Processing completed successfully for batch ${batchId}`);
    await uploadDocRef.update({
      status: 'COMPLETED',
      isProcessing: false,
      progress: 100,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await addDashboardUpdate({ type: 'BATCH_PROCESSED', batchId, month });
    
    try {
      require('fs').unlinkSync(tempFilePath);
    } catch {}
  } catch(err) {
    console.error(`💥 PROCESSING FAILED for ${filePath}:`, err);
    await uploadDocRef.update({
      status: 'FAILED',
      isProcessing: false,
      error: (err as Error).message,
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await addDashboardUpdate({ type: 'BATCH_FAILED', batchId, month, results: { error: (err as Error).message } });
    try { require('fs').unlinkSync(tempFilePath); } catch {}
    throw err;
  }
}


/*
// DEPRECATED: Replaced by direct API call to processUploadedExcel
export const excelCalculator = onDocumentCreated({
    document: `${UPLOAD_COLLECTION}/{batchId}`,
    region: "us-west1",
    timeoutSeconds: 540,
    memory: "1GiB"
}, async (event) => {
    const snap = event.data;
    if (!snap) {
        console.log("No data associated with the event");
        return;
    }
    const batchId = snap.id;
    await processUploadedExcel(batchId);
});
*/




/**
 * Processes a comparison upload, calculating and storing only the net amounts for each manager.
 */
async function processComparisonData(rows: any[][], month: string, fileName: string, uploadDocRef?: admin.firestore.DocumentReference, managerMap?: Map<string, string>) {
  const firestore = admin.firestore();
  const batch = firestore.batch();
  const managerNetTotals: { [key: string]: { net: number, handle: string, type: 'live' | 'team' } } = {};
  let processedRows = 0;

  // Skip header row
  for (const [index, row] of rows.slice(1).entries()) {
    if (!row || !row[0]) continue; // Skip empty rows

    // Extract manager from either LIVE (col 4) or TEAM (col 6) column
    const liveManager = row[4]?.toString().trim();
    const teamManager = row[6]?.toString().trim();
    const managerName = liveManager || teamManager;
    const managerType = liveManager ? 'live' : 'team';
    
    if (!managerName) {
      console.warn(`Row ${index + 2}: No manager found in columns E or G. Skipping...`);
      continue;
    }

    // Robust parsing for gross and milestones (updated column mapping: S→N(13), N→O(14), O→Q(16), P→P(15))
    const grossAmount = parseEuroNumber(row[12]);
    const milestoneChecks = {
      S: milestonePresent(row[13]),
      N: milestonePresent(row[14]),
      O: milestonePresent(row[16]),
      P: milestonePresent(row[15]),
    };

    // Validate only gross > 0
    if (!(grossAmount > 0)) {
      continue;
    }

    // Calculate deductions and net amount
    let totalDeductions = 0;
    if (milestoneChecks.S) totalDeductions += MILESTONE_DEDUCTIONS.S;
    if (milestoneChecks.N) totalDeductions += MILESTONE_DEDUCTIONS.N;
    if (milestoneChecks.O) totalDeductions += MILESTONE_DEDUCTIONS.O;
    if (milestoneChecks.P) totalDeductions += MILESTONE_DEDUCTIONS.P;

    const netForCommission = grossAmount - totalDeductions;

    const canonical = normalizeHandle(managerName);
    const managerId = managerMap?.get(canonical) || 'unknown_manager';
    if (managerId === 'unknown_manager') {
      console.warn(`Manager with handle '${managerName}' not found in managerMap. Skipping...`);
      continue;
    }

    if (!managerNetTotals[managerId]) {
      managerNetTotals[managerId] = { net: 0, handle: managerName, type: managerType };
    }
    managerNetTotals[managerId].net += netForCommission;

    processedRows++;
    if (uploadDocRef && processedRows % 20 === 0) {
      const currentProgress = 10 + Math.floor((processedRows / rows.length) * 80);
      await uploadDocRef.update({ processedRows, progress: currentProgress, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  }

  // Save the aggregated net amounts to the new collection
  for (const managerId in managerNetTotals) {
    const data = managerNetTotals[managerId];
    const docRef = firestore.collection('managerMonthlyNets').doc(`${managerId}_${month}`);
    batch.set(docRef, {
      managerId,
      managerHandle: data.handle,
      month,
      netAmount: data.net,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      sourceFile: fileName,
    });
  }

  await batch.commit();
  console.log(`✅ Stored net amounts for ${Object.keys(managerNetTotals).length} managers for comparison period ${month}.`);
}


/**
 * Processes the full commission data - OPTIMIZED WITH LIVE PROGRESS
 */
export async function processCommissionData(rows: any[][], batchId: string, month:string, uploadDocRef?: admin.firestore.DocumentReference, managerMap?: Map<string, string>) {
  const firestore = admin.firestore();
  const validationErrors: { row: number, errors: any }[] = [];
  let processedRows = 0;
  
  // Aggregate per manager (for creators count etc.)
  const perManager: Record<string, { type: 'live' | 'team'; creators: Set<string>; milestones: {S:number;N:number;O:number;P:number} }> = {};
  
  // Progress tracking
  const totalDataRows = rows.slice(1).length;
  const BATCH_SIZE = 50;
  const PROGRESS_UPDATE_INTERVAL = 25;
  
  if (uploadDocRef) {
    await uploadDocRef.update({ 
      status: 'PROCESSING',
      progress: 35,
      totalRows: totalDataRows,
      processedRows: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  const dataRows = rows.slice(1);
  const chunks = [] as any[][][];
  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    chunks.push(dataRows.slice(i, i + BATCH_SIZE));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const batch = firestore.batch();
    let batchOperations = 0;

    for (const [rowIndex, row] of chunk.entries()) {
      const absoluteRowIndex = chunkIndex * BATCH_SIZE + rowIndex;
      if (!row || !row[0]) continue;

      const liveManager = row[4]?.toString().trim();
      const teamManager = row[6]?.toString().trim();
      const managerHandle = liveManager || teamManager;
      const managerType: 'live' | 'team' = liveManager ? 'live' : 'team';
      if (!managerHandle) {
        validationErrors.push({ row: absoluteRowIndex + 2, errors: { manager: 'missing' } });
        continue;
      }

      // Robust parsing for numeric values
      const grossAmount = parseEuroNumber(row[12]);

      const managerId = managerMap?.get(normalizeHandle(managerHandle));
      if (!managerId) {
        validationErrors.push({ row: absoluteRowIndex + 2, errors: { manager: 'not found' } });
        continue;
      }

      // Compute milestone flags PER ROW (independent of gross) (updated columns)
      const hasN = milestonePresent(row[14]);
      const hasO = milestonePresent(row[16]);
      const hasP = milestonePresent(row[15]);
      const hasS = milestonePresent(row[13]);

      // Track per manager flags & creators (even if gross <= 0)
      if (!perManager[managerId]) {
        perManager[managerId] = {
          type: managerType,
          creators: new Set<string>(),
          milestones: { S: 0, N: 0, O: 0, P: 0 }
        };
      }
      // Count occurrences per row (only when row contributes revenue)
      if (grossAmount > 0) {
        if (hasS) perManager[managerId].milestones.S += 1;
        if (hasN) perManager[managerId].milestones.N += 1;
        if (hasO) perManager[managerId].milestones.O += 1;
        if (hasP) perManager[managerId].milestones.P += 1;
      }
      const creatorId = row[1]?.toString() || 'unknown';
      perManager[managerId].creators.add(creatorId);

      // Only write transaction when gross > 0
      if (grossAmount > 0) {
        const deductions = (hasN ? MILESTONE_DEDUCTIONS.N : 0)
          + (hasO ? MILESTONE_DEDUCTIONS.O : 0)
          + (hasP ? MILESTONE_DEDUCTIONS.P : 0)
          + (hasS ? MILESTONE_DEDUCTIONS.S : 0);

        const netForCommission = Math.max(0, grossAmount - deductions);
        const baseCommissionRate = BASE_COMMISSION_RATES[managerType];
        const baseCommission = netForCommission * baseCommissionRate;

        const txRef = firestore.collection('transactions').doc();
        batch.set(txRef, {
          batchId,
          managerId,
          managerHandle,
          managerType: managerType.toUpperCase(),
          creatorId,
          creatorHandle: row[2]?.toString() || 'unknown',
          grossAmount,
          deductions,
          netForCommission,
          baseCommission,
          month,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          processed: true
        });
        batchOperations++;
      }

      // Disable row-level milestone bonus writes; aggregate per manager after processing
      // Flags are tracked in perManager[managerId].milestones and written once per type later.
       
      if (batchOperations >= 400) {
        await batch.commit();
        batchOperations = 0;
      }

      processedRows++;
    }

    if (batchOperations > 0) {
      await batch.commit();
    }

    if (uploadDocRef && (chunkIndex % Math.ceil(PROGRESS_UPDATE_INTERVAL / BATCH_SIZE) === 0 || chunkIndex === chunks.length - 1)) {
      const progressPercentage = Math.min(90, 35 + (processedRows / totalDataRows) * 55);
      await uploadDocRef.update({
        progress: progressPercentage,
        processedRows: processedRows,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  // No per-manager milestone bonus writes here anymore (already per row)

  if (uploadDocRef) {
    await uploadDocRef.update({
      progress: 95,
      processedRows,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  // NEW: After processing all rows, write exactly one milestone bonus doc per manager/type
  try {
    const writeBatch = firestore.batch();
    let ops = 0;
    Object.entries(perManager).forEach(([managerId, info]) => {
      const rates = MILESTONE_BONUSES[info.type];
      const entries: Array<{ type: 'MILESTONE_S'|'MILESTONE_N'|'MILESTONE_O'|'MILESTONE_P'; amount: number } > = [];
      if (info.milestones.S > 0) entries.push({ type: 'MILESTONE_S', amount: rates.S * info.milestones.S });
      if (info.milestones.N > 0) entries.push({ type: 'MILESTONE_N', amount: rates.N * info.milestones.N });
      if (info.milestones.O > 0) entries.push({ type: 'MILESTONE_O', amount: rates.O * info.milestones.O });
      if (info.milestones.P > 0) entries.push({ type: 'MILESTONE_P', amount: rates.P * info.milestones.P });
      entries.forEach(e => {
        // Deterministic id per (manager, month, type) to guarantee idempotency
        const bonusId = `${managerId}_${month}_${e.type}`;
        const ref = firestore.collection('bonuses').doc(bonusId);
        writeBatch.set(ref, {
          managerId,
          month,
          type: e.type,
          amount: e.amount,
          batchId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          awardMethod: 'AUTO_MILESTONE'
        });
        ops++;
        if (ops >= 450) {
          // Note: we cannot await inside forEach; mark to flush later. We'll commit once after loop
        }
      });
    });
    await writeBatch.commit();
  } catch (e) {
    console.warn('⚠️ Failed writing aggregated milestone bonuses', e);
  }

  // VALIDATION: ensure milestone bonus docs match the flags we observed
  try {
    const checkSnap = await firestore.collection('bonuses')
      .where('month', '==', month)
      .where('type', 'in', ['MILESTONE_S','MILESTONE_N','MILESTONE_O','MILESTONE_P'])
      .get();
    const byManagerType = new Map<string, Record<'S'|'N'|'O'|'P', number>>();
    checkSnap.forEach(d => {
      const b = d.data();
      const mid = String(b.managerId || '');
      const t = String(b.type || '').slice(-1) as 'S'|'N'|'O'|'P';
      if (!mid || !('SNOP'.includes(t))) return;
      if (!byManagerType.has(mid)) byManagerType.set(mid, { S:0,N:0,O:0,P:0 });
      const m = byManagerType.get(mid)!;
      m[t] += (b.amount || 0);
    });
    const fixBatch = firestore.batch();
    Object.entries(perManager).forEach(([mid, info]) => {
      const expected = {
        S: (info.milestones.S || 0) * MILESTONE_BONUSES[info.type].S,
        N: (info.milestones.N || 0) * MILESTONE_BONUSES[info.type].N,
        O: (info.milestones.O || 0) * MILESTONE_BONUSES[info.type].O,
        P: (info.milestones.P || 0) * MILESTONE_BONUSES[info.type].P,
      };
      const actual = byManagerType.get(mid) || { S:0,N:0,O:0,P:0 };
      (['S','N','O','P'] as const).forEach(key => {
        const exp = expected[key];
        const act = actual[key];
        if (Math.round(exp*100) !== Math.round(act*100)) {
          const ref = firestore.collection('bonuses').doc(`${mid}_${month}_MILESTONE_${key}`);
          if (exp === 0) {
            fixBatch.delete(ref);
          } else {
            fixBatch.set(ref, {
              managerId: mid,
              month,
              type: `MILESTONE_${key}`,
              amount: exp,
              batchId,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              awardMethod: 'AUTO_MILESTONE'
            });
          }
        }
      });
    });
    await fixBatch.commit();
  } catch (e) {
    console.warn('⚠️ Milestone validation skipped due to error', e);
  }
} 