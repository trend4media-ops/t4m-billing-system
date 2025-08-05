
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { z } from 'zod';

// Firebase Admin SDK is initialized in the root index.js
const db = admin.firestore();

const UPLOAD_COLLECTION = 'uploadBatches';

const commissionRowSchema = z.object({
  managerHandle: z.string().min(1, { message: "Manager Handle is required" }),
  managerType: z.enum(['live', 'team']),
  grossAmount: z.number().positive({ message: "Gross Amount must be a positive number" }),
  milestoneN: z.any().optional(),
  milestoneO: z.any().optional(),
  milestoneP: z.any().optional(),
  milestoneS: z.any().optional(),
});

// Commission logic constants based on the definitive document v2.0
const MILESTONE_DEDUCTIONS = {
  N: 300,
  O: 1000,
  P: 240,
  S: 150,
};

// const MILESTONE_PAYOUTS = {
//   live: { S: 75, N: 150, O: 400, P: 100 },
//   team: { S: 80, N: 165, O: 450, P: 120 },
// };

const BASE_COMMISSION_RATES = {
  live: 0.30,
  team: 0.35,
};

/**
 * Creates or updates manager accounts from Excel data - OPTIMIZED VERSION
 */
async function ensureManagersExist(rows: any[][], uploadDocRef?: admin.firestore.DocumentReference): Promise<Map<string, string>> {
    console.log('📥 🚀 OPTIMIZED: Loading all managers in bulk...');
    const firestore = admin.firestore();
    const auth = admin.auth();
    const batch = firestore.batch();
    const managerMap = new Map<string, string>(); // name -> managerId
    
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
        
        if (managerName && !managerNames.has(managerName)) {
            managerNames.add(managerName);
            uniqueManagers.add({
                name: managerName,
                type: managerType,
                email: row[7]?.toString().trim()
            });
        }
    }
    
    console.log(`📊 Found ${uniqueManagers.size} unique managers in Excel`);
    
    // 🚀 OPTIMIZATION: Load ALL existing managers in ONE query
    const existingManagersSnapshot = await firestore.collection('managers').get();
    const existingManagersMap = new Map<string, string>();
    
    existingManagersSnapshot.forEach(doc => {
        const data = doc.data();
        existingManagersMap.set(data.name, doc.id);
    });
    
    console.log(`✅ Loaded ${existingManagersMap.size} existing managers from database`);
    
    let newManagersCount = 0;
    
    // Process each unique manager
    for (const managerData of uniqueManagers) {
        if (existingManagersMap.has(managerData.name)) {
            // Manager exists - add to map
            const managerId = existingManagersMap.get(managerData.name)!;
            managerMap.set(managerData.name, managerId);
            console.log(`✅ Manager exists: ${managerData.name} (${managerId})`);
        } else {
            // Create new manager
            const managerId = firestore.collection('managers').doc().id;
            const email = managerData.email || `${managerData.name.toLowerCase().replace(/\s+/g, '.')}@trend4media.com`;
            
            // Add to batch
            batch.set(firestore.collection('managers').doc(managerId), {
                name: managerData.name,
                email: email,
                type: managerData.type.toUpperCase(),
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                active: true,
                totalEarnings: 0,
                pendingPayouts: 0,
                completedPayouts: 0
            });
            
            managerMap.set(managerData.name, managerId);
            newManagersCount++;
            
            // Create auth user account (async, don't wait)
            auth.createUser({
                uid: managerId,
                email: email,
                password: 'TempPassword123!',
                displayName: managerData.name
            }).then(() => {
                console.log(`✅ Created auth user for ${managerData.name}`);
            }).catch(err => {
                console.warn(`⚠️ Failed to create auth user for ${managerData.name}:`, err.code);
            });
            
            console.log(`🆕 Will create new manager: ${managerData.name} (${managerId})`);
        }
    }
    
    // Commit new managers in one batch
    if (newManagersCount > 0) {
        await batch.commit();
        console.log(`✅ Created ${newManagersCount} new managers in batch`);
        
        // Update progress
        if (uploadDocRef) {
            await uploadDocRef.update({ 
                progress: 25,
                processedRows: newManagersCount,
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
    
    // Get all transactions for this batch
    const transactionsSnapshot = await firestore.collection('transactions')
        .where('batchId', '==', batchId)
        .get();
    
    // Get all bonuses for this batch
    const bonusesSnapshot = await firestore.collection('bonuses')
        .where('batchId', '==', batchId)
        .get();
    
    // Calculate earnings per manager
    const managerEarnings = new Map<string, {
        baseCommission: number,
        bonuses: number,
        totalGross: number,
        totalDeductions: number,
        totalNet: number,
        transactionCount: number
    }>();
    
    // Process transactions
    transactionsSnapshot.forEach(doc => {
        const data = doc.data();
        const managerId = data.managerId;
        
        if (!managerEarnings.has(managerId)) {
            managerEarnings.set(managerId, {
                baseCommission: 0,
                bonuses: 0,
                totalGross: 0,
                totalDeductions: 0,
                totalNet: 0,
                transactionCount: 0
            });
        }
        
        const earnings = managerEarnings.get(managerId)!;
        earnings.baseCommission += data.baseCommission || 0;
        earnings.totalGross += data.grossAmount || 0;
        earnings.totalDeductions += data.deductions || 0;
        earnings.totalNet += data.netForCommission || 0;
        earnings.transactionCount += 1;
    });
    
    // Process bonuses
    bonusesSnapshot.forEach(doc => {
        const data = doc.data();
        const managerId = data.managerId;
        
        if (!managerEarnings.has(managerId)) {
            managerEarnings.set(managerId, {
                baseCommission: 0,
                bonuses: 0,
                totalGross: 0,
                totalDeductions: 0,
                totalNet: 0,
                transactionCount: 0
            });
        }
        
        const earnings = managerEarnings.get(managerId)!;
        earnings.bonuses += data.amount || 0;
    });
    
    // Update manager documents
    for (const [managerId, earnings] of managerEarnings) {
        const managerRef = firestore.collection('managers').doc(managerId);
        const totalEarnings = earnings.baseCommission + earnings.bonuses;
        
        // Update manager total earnings
        batch.update(managerRef, {
            totalEarnings: admin.firestore.FieldValue.increment(totalEarnings),
            lastProcessedMonth: month,
            lastProcessedBatch: batchId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Create or update monthly earnings document
        const monthlyEarningsRef = firestore.collection('manager-earnings').doc(`${managerId}_${month}`);
        batch.set(monthlyEarningsRef, {
            managerId,
            month,
            batchId,
            baseCommission: earnings.baseCommission,
            bonuses: earnings.bonuses,
            totalEarnings,
            totalGross: earnings.totalGross,
            totalDeductions: earnings.totalDeductions,
            totalNet: earnings.totalNet,
            transactionCount: earnings.transactionCount,
            status: 'CALCULATED',
            calculatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        console.log(`💰 Manager ${managerId}: €${totalEarnings.toFixed(2)} (Base: €${earnings.baseCommission.toFixed(2)}, Bonuses: €${earnings.bonuses.toFixed(2)})`);
    }
    
    await batch.commit();
    console.log(`✅ Updated earnings for ${managerEarnings.size} managers`);
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

    const data = snap.data()!;
    const { fileName, filePath, isComparison, month } = data;

    console.log(`🚀 OPTIMIZED PROCESSING: Starting file ${filePath} with batch ID: ${batchId}`);
    
    const fileBucket = admin.storage().bucket().name; 
    const bucket = admin.storage().bucket(fileBucket);
    const tempFilePath = `/tmp/${fileName}`;
  
    try {
        // Step 1: Download file
        await uploadDocRef.update({ 
            status: 'DOWNLOADING', 
            progress: 5,
            updatedAt: admin.firestore.FieldValue.serverTimestamp() 
        });
        
        console.log(`📥 Downloading file from ${filePath}...`);
        await bucket.file(filePath).download({ destination: tempFilePath });
        console.log(`✅ File downloaded to ${tempFilePath}`);
        
        // Step 2: Parse Excel
        await uploadDocRef.update({ 
            status: 'PROCESSING', 
            progress: 15, 
            updatedAt: admin.firestore.FieldValue.serverTimestamp() 
        });

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
            await processCommissionData(rows, batchId, month, uploadDocRef, managerMap);
            
            // Step 5: Update manager earnings
            console.log(`📊 Updating manager earnings summaries...`);
            await uploadDocRef.update({ 
                status: 'CALCULATING', 
                progress: 95,
                updatedAt: admin.firestore.FieldValue.serverTimestamp() 
            });
            
            await updateManagerEarnings(batchId, month);
        }

        // Step 6: Complete
        console.log(`✅ Processing completed successfully for batch ${batchId}`);
        await uploadDocRef.update({
            status: 'COMPLETED',
            progress: 100,
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        // Cleanup temp file
        try {
            require('fs').unlinkSync(tempFilePath);
            console.log(`🗑️ Cleaned up temp file: ${tempFilePath}`);
        } catch (cleanupError) {
            console.warn(`⚠️ Failed to cleanup temp file: ${cleanupError}`);
        }
    
    } catch(err) {
        console.error(`💥 PROCESSING FAILED for ${filePath}:`, err);
        await uploadDocRef.update({
            status: 'FAILED',
            error: (err as Error).message,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        // Cleanup temp file on error too
        try {
            require('fs').unlinkSync(tempFilePath);
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        
        throw err; // Re-throw for API handler
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

    const rowData = {
      managerHandle: managerName, // Using name as handle for now
      managerType: managerType,
      grossAmount: parseFloat(row[12] || '0'),
      milestoneN: row[13],
      milestoneO: row[14],
      milestoneP: row[15],
      milestoneS: row[18],
    };

    const validationResult = commissionRowSchema.safeParse(rowData);

    if (!validationResult.success) {
      console.warn(`Skipping row ${index + 2} due to validation errors: ${JSON.stringify(validationResult.error.flatten())}`);
      continue; // Skip this row
    }

    const { managerHandle, grossAmount, ...milestones } = validationResult.data;
    
    // Find manager by handle to get their ID
    const managerId = managerMap?.get(managerHandle) || 'unknown_manager'; // Fallback to 'unknown_manager' if not found

    if (managerId === 'unknown_manager') {
      console.warn(`Manager with handle '${managerHandle}' not found in managerMap. Skipping...`);
      continue;
    }

    // Calculate deductions and net amount
    let totalDeductions = 0;
    const milestoneChecks = {
        S: milestones.milestoneS,
        N: milestones.milestoneN,
        O: milestones.milestoneO,
        P: milestones.milestoneP,
    };

    if (milestoneChecks.S) totalDeductions += MILESTONE_DEDUCTIONS.S;
    if (milestoneChecks.N) totalDeductions += MILESTONE_DEDUCTIONS.N;
    if (milestoneChecks.O) totalDeductions += MILESTONE_DEDUCTIONS.O;
    if (milestoneChecks.P) totalDeductions += MILESTONE_DEDUCTIONS.P;

    const netForCommission = grossAmount - totalDeductions;

    if (!managerNetTotals[managerId]) {
      managerNetTotals[managerId] = { net: 0, handle: managerHandle, type: validationResult.data.managerType };
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
    const managerNetTotals: { [key: string]: { net: number, handle: string, type: 'live' | 'team' } } = {};
    const validationErrors: { row: number, errors: any }[] = [];
    let processedRows = 0;
    
    // Progress tracking
    const totalDataRows = rows.slice(1).length;
    const BATCH_SIZE = 50; // Process in batches of 50 rows
    const PROGRESS_UPDATE_INTERVAL = 25; // Update progress every 25 rows
    
    console.log(`🚀 OPTIMIZED PROCESSING: ${totalDataRows} rows in batches of ${BATCH_SIZE}`);
    
    if (uploadDocRef) {
        await uploadDocRef.update({ 
            status: 'PROCESSING',
            progress: 35,
            totalRows: totalDataRows,
            processedRows: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    // Process data in chunks for better performance
    const dataRows = rows.slice(1);
    const chunks = [];
    for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
        chunks.push(dataRows.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`📦 Split into ${chunks.length} processing chunks`);

    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        const batch = firestore.batch();
        let batchOperations = 0;
        
        console.log(`📦 Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} rows)`);
        
        // Process rows in current chunk
        for (const [rowIndex, row] of chunk.entries()) {
            const absoluteRowIndex = chunkIndex * BATCH_SIZE + rowIndex;
            
            if (!row || !row[0]) continue; // Skip empty rows

            // Extract manager data
            const liveManager = row[4]?.toString().trim();
            const teamManager = row[6]?.toString().trim();
            const managerName = liveManager || teamManager;
            const managerType = liveManager ? 'live' : 'team';
            
            if (!managerName) {
                console.warn(`Row ${absoluteRowIndex + 2}: No manager found in columns E or G. Skipping...`);
                continue;
            }

            const rowData = {
                managerHandle: managerName,
                managerType: managerType,
                grossAmount: parseFloat(row[12] || '0'),
                milestoneN: row[13],
                milestoneO: row[14],
                milestoneP: row[15],
                milestoneS: row[18],
            };

            const validationResult = commissionRowSchema.safeParse(rowData);

            if (!validationResult.success) {
                validationErrors.push({ row: absoluteRowIndex + 2, errors: validationResult.error.flatten() });
                continue;
            }

            const { grossAmount, milestoneN, milestoneO, milestoneP, milestoneS } = validationResult.data;
            const validatedManagerHandle = validationResult.data.managerHandle;
            const validatedManagerType = validationResult.data.managerType;

            // Get manager ID from pre-loaded map
            const managerId = managerMap?.get(validatedManagerHandle);
            if (!managerId) {
                console.warn(`Manager ${validatedManagerHandle} not found in map. Skipping row ${absoluteRowIndex + 2}`);
                continue;
            }

            // Calculate commissions and deductions
            const baseCommissionRate = BASE_COMMISSION_RATES[validatedManagerType];
            const baseCommission = grossAmount * baseCommissionRate;

            let totalDeductions = 0;
            const milestoneChecks = {
                S: milestoneS, N: milestoneN, O: milestoneO, P: milestoneP,
            };

            // Calculate milestone deductions
            if (milestoneChecks.S) totalDeductions += MILESTONE_DEDUCTIONS.S;
            if (milestoneChecks.N) totalDeductions += MILESTONE_DEDUCTIONS.N;
            if (milestoneChecks.O) totalDeductions += MILESTONE_DEDUCTIONS.O;
            if (milestoneChecks.P) totalDeductions += MILESTONE_DEDUCTIONS.P;

            const netAmount = Math.max(0, baseCommission - totalDeductions);

            // Track manager totals
            if (!managerNetTotals[managerId]) {
                managerNetTotals[managerId] = {
                    net: 0,
                    handle: validatedManagerHandle,
                    type: validatedManagerType
                };
            }
            managerNetTotals[managerId].net += netAmount;

            // Create transaction document
            const transactionDoc = firestore.collection('transactions').doc();
            batch.set(transactionDoc, {
                batchId: batchId,
                managerId: managerId,
                managerHandle: validatedManagerHandle,
                managerType: validatedManagerType.toUpperCase(),
                creatorId: row[1]?.toString() || 'unknown',
                creatorHandle: row[2]?.toString() || 'unknown',
                grossAmount: grossAmount,
                baseCommission: baseCommission,
                deductions: totalDeductions,
                netAmount: netAmount,
                milestones: milestoneChecks,
                month: month,
                date: admin.firestore.FieldValue.serverTimestamp(),
                processed: true
            });
            
            batchOperations++;
            processedRows++;

            // Commit batch if it gets too large (Firestore limit is 500 operations)
            if (batchOperations >= 450) {
                await batch.commit();
                console.log(`💾 Committed batch with ${batchOperations} transactions`);
                batchOperations = 0;
            }
        }

        // Commit remaining operations in this chunk
        if (batchOperations > 0) {
            await batch.commit();
            console.log(`💾 Committed final batch with ${batchOperations} transactions`);
        }

        // Update progress every chunk or every PROGRESS_UPDATE_INTERVAL rows
        if (uploadDocRef && (chunkIndex % Math.ceil(PROGRESS_UPDATE_INTERVAL / BATCH_SIZE) === 0 || chunkIndex === chunks.length - 1)) {
            const progressPercentage = Math.min(90, 35 + (processedRows / totalDataRows) * 55); // 35% to 90%
            
            await uploadDocRef.update({
                progress: progressPercentage,
                processedRows: processedRows,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            console.log(`📊 Progress update: ${processedRows}/${totalDataRows} rows (${progressPercentage.toFixed(1)}%)`);
        }
    }

    // Final processing - create bonus documents for managers
    console.log(`🎁 Creating bonus documents for ${Object.keys(managerNetTotals).length} managers...`);
    
    const bonusBatch = firestore.batch();
    let bonusCount = 0;
    
    for (const [managerId, data] of Object.entries(managerNetTotals)) {
        // Calculate milestone bonuses
        // const milestonePayouts = MILESTONE_PAYOUTS[data.type];
        
        // Create bonus document for this manager's month
        const bonusDoc = firestore.collection('bonuses').doc();
        bonusBatch.set(bonusDoc, {
            managerId: managerId,
            managerHandle: data.handle,
            month: month,
            type: 'MONTHLY_TOTAL',
            amount: data.net,
            details: {
                totalTransactions: processedRows,
                managerType: data.type
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        bonusCount++;
    }
    
    if (bonusCount > 0) {
        await bonusBatch.commit();
        console.log(`✅ Created ${bonusCount} bonus documents`);
    }

    // Log validation errors if any
    if (validationErrors.length > 0) {
        console.warn(`⚠️ ${validationErrors.length} validation errors encountered:`, validationErrors.slice(0, 5));
    }

    console.log(`✅ PROCESSING COMPLETE: ${processedRows} rows processed successfully`);
    
    // Final progress update
    if (uploadDocRef) {
        await uploadDocRef.update({
            progress: 95,
            processedRows: processedRows,
            validationErrors: validationErrors.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
} 