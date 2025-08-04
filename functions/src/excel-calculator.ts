
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { z } from 'zod';

// Firebase Admin SDK is initialized in the root index.js
const db = admin.firestore();

const UPLOAD_COLLECTION = 'upload-metadata';

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

const MILESTONE_PAYOUTS = {
  live: { S: 75, N: 150, O: 400, P: 100 },
  team: { S: 80, N: 165, O: 450, P: 120 },
};

const DIAMOND_BONUS_PAYOUT = {
  live: 50,
  team: 60,
};

const BASE_COMMISSION_RATES = {
  live: 0.30,
  team: 0.35,
};

/**
 * Creates or updates manager accounts from Excel data
 */
async function ensureManagersExist(rows: any[][], uploadDocRef?: admin.firestore.DocumentReference): Promise<Map<string, string>> {
    console.log('📥 Ensuring all managers exist in database...');
    const firestore = admin.firestore();
    const auth = admin.auth();
    const batch = firestore.batch();
    const managerMap = new Map<string, string>(); // name -> managerId
    const managersToCreate = new Set<{name: string, type: 'live' | 'team', email?: string}>();
    
    // Skip header row and collect unique managers
    for (const row of rows.slice(1)) {
        if (!row || !row[0]) continue;
        
        // Extract manager from either LIVE (col 4) or TEAM (col 6) column
        const liveManager = row[4]?.toString().trim();
        const teamManager = row[6]?.toString().trim();
        const managerName = liveManager || teamManager;
        const managerType = liveManager ? 'live' : 'team';
        
        if (managerName) {
            managersToCreate.add({
                name: managerName,
                type: managerType,
                email: row[7]?.toString().trim() // Email if available in column H
            });
        }
    }
    
    console.log(`📊 Found ${managersToCreate.size} unique managers in Excel`);
    
    // Check which managers already exist and create missing ones
    for (const managerData of managersToCreate) {
        const existingSnapshot = await firestore.collection('managers')
            .where('name', '==', managerData.name)
            .limit(1)
            .get();
        
        if (!existingSnapshot.empty) {
            // Manager exists
            const managerId = existingSnapshot.docs[0].id;
            managerMap.set(managerData.name, managerId);
            console.log(`✅ Manager exists: ${managerData.name} (${managerId})`);
        } else {
            // Create new manager
            const managerId = firestore.collection('managers').doc().id;
            const email = managerData.email || `${managerData.name.toLowerCase().replace(/\s+/g, '.')}@trend4media.com`;
            
            // Create manager document
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
            
            // Create auth user account
            try {
                await auth.createUser({
                    uid: managerId,
                    email: email,
                    emailVerified: true,
                    password: `T4M-${managerData.name.replace(/\s+/g, '')}-2025`, // Temporary password
                    displayName: managerData.name,
                });
                
                // Set custom claims
                await auth.setCustomUserClaims(managerId, {
                    role: 'MANAGER',
                    managerId: managerId
                });
                
                console.log(`🆕 Created manager account: ${managerData.name} (${managerId}) with email: ${email}`);
                
                // Create welcome message
                batch.set(firestore.collection('messages').doc(), {
                    userId: managerId,
                    title: 'Willkommen bei Trend4Media',
                    content: `Hallo ${managerData.name},\n\nIhr Account wurde erfolgreich erstellt. Sie können sich mit der E-Mail ${email} und dem temporären Passwort anmelden. Bitte ändern Sie Ihr Passwort nach dem ersten Login.\n\nBei Fragen wenden Sie sich bitte an den Support.`,
                    type: 'welcome',
                    read: false,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
            } catch (authError) {
                console.error(`⚠️ Could not create auth account for ${managerData.name}:`, authError);
                // Continue anyway - manager document is created
            }
            
            managerMap.set(managerData.name, managerId);
        }
    }
    
    // Commit all manager creations
    await batch.commit();
    console.log(`✨ Manager setup complete. Total managers: ${managerMap.size}`);
    
    if (uploadDocRef) {
        await uploadDocRef.update({
            managersCreated: managerMap.size,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
    
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

    console.log(`🚀 Processing file: ${filePath} with batch ID: ${batchId}`);
    
    const fileBucket = admin.storage().bucket().name; 
    const bucket = admin.storage().bucket(fileBucket);
    const tempFilePath = `/tmp/${fileName}`;
  
    try {
        await uploadDocRef.update({ status: 'DOWNLOADING', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        await bucket.file(filePath).download({ destination: tempFilePath });
        await uploadDocRef.update({ status: 'PROCESSING', progress: 10, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

        const workbook = XLSX.readFile(tempFilePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        const totalRows = rows.length -1;

        await uploadDocRef.update({ totalRows });

        // IMPORTANT: Ensure all managers exist before processing
        const managerMap = await ensureManagersExist(rows, uploadDocRef);
        await uploadDocRef.update({ status: 'CALCULATING', progress: 30, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

        if (isComparison) {
            console.log(`📈 Processing COMPARISON data for month: ${month}`);
            await processComparisonData(rows, month, fileName, uploadDocRef, managerMap);
        } else {
            console.log(`💰 Processing FULL commission data for month: ${month}`);
            await processCommissionData(rows, batchId, month, uploadDocRef, managerMap);
            
            // Update manager earnings after processing
            await updateManagerEarnings(batchId, month);
            
            console.log(`✅ Successfully processed batch ${batchId} from file ${fileName}`);
        }

        await uploadDocRef.update({
            status: 'COMPLETED',
            progress: 100,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    
    } catch(err) {
        console.error(`Failed to process file ${filePath}`, err);
        await uploadDocRef.update({
            status: 'FAILED',
            error: (err as Error).message,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Re-throw the error to be caught by the API handler
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
 * Processes the full commission data...
 */
export async function processCommissionData(rows: any[][], batchId: string, month:string, uploadDocRef?: admin.firestore.DocumentReference, managerMap?: Map<string, string>) {
    const firestore = admin.firestore();
    const batch = firestore.batch();
    const managerNetTotals: { [key: string]: { net: number, handle: string, type: 'live' | 'team' } } = {};
    const validationErrors: { row: number, errors: any }[] = [];
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
          validationErrors.push({ row: index + 2, errors: validationResult.error.flatten() });
          continue; // Skip this row
        }

        const { grossAmount, milestoneN, milestoneO, milestoneP, milestoneS } = validationResult.data;
        const validatedManagerHandle = validationResult.data.managerHandle;
        const validatedManagerType = validationResult.data.managerType;

        // Find manager by handle to get their ID
        const managerId = managerMap?.get(validatedManagerHandle) || 'unknown_manager'; // Fallback to 'unknown_manager' if not found

        if (managerId === 'unknown_manager') {
            console.warn(`Manager with handle '${validatedManagerHandle}' not found in managerMap. Skipping...`);
            continue;
        }

        // Store manager's net total for Diamond Bonus calculation later
        if (!managerNetTotals[managerId]) {
            managerNetTotals[managerId] = { net: 0, handle: validatedManagerHandle, type: validatedManagerType };
        }

        // 2. Calculate deductions and net amount
        let totalDeductions = 0;
        const milestoneChecks = {
            S: milestoneS,
            N: milestoneN,
            O: milestoneO,
            P: milestoneP,
        };

        if (milestoneChecks.S) totalDeductions += MILESTONE_DEDUCTIONS.S;
        if (milestoneChecks.N) totalDeductions += MILESTONE_DEDUCTIONS.N;
        if (milestoneChecks.O) totalDeductions += MILESTONE_DEDUCTIONS.O;
        if (milestoneChecks.P) totalDeductions += MILESTONE_DEDUCTIONS.P;

        const netForCommission = grossAmount - totalDeductions;
        managerNetTotals[managerId].net += netForCommission;

        const baseCommissionRate = BASE_COMMISSION_RATES[validatedManagerType];
        const baseCommission = netForCommission > 0 ? netForCommission * baseCommissionRate : 0;

        // 4. Save the main transaction document
        const transactionId = firestore.collection('transactions').doc().id;
        const transactionRef = firestore.collection('transactions').doc(transactionId);
        batch.set(transactionRef, {
            id: transactionId,
            managerId,
            managerHandle: validatedManagerHandle,
            managerType: validatedManagerType.toUpperCase(),
            month,
            batchId,
            grossAmount,
            deductions: totalDeductions,
            netForCommission,
            baseCommission,
            calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: 'excel-calculator-function'
        });

        // 5. Save base commission as a bonus document
        if (baseCommission > 0) {
            const bonusRef = firestore.collection('bonuses').doc();
            batch.set(bonusRef, {
                managerId,
                managerHandle: validatedManagerHandle,
                type: 'BASE_COMMISSION',
                amount: baseCommission,
                month,
                batchId,
                calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'excel-calculator-function'
            });
        }

        // 6. Create separate bonus documents for each achieved milestone
        const milestonePayouts = MILESTONE_PAYOUTS[validatedManagerType];
        const milestoneBonusTypes = {
            S: 'MILESTONE_S',
            N: 'MILESTONE_N',
            O: 'MILESTONE_O',
            P: 'MILESTONE_P'
        };

        for (const [key, value] of Object.entries(milestoneChecks)) {
            if (value) {
                const bonusAmount = milestonePayouts[key as keyof typeof milestonePayouts];
                if (bonusAmount > 0) {
                    const bonusRef = firestore.collection('bonuses').doc();
                    batch.set(bonusRef, {
                        managerId,
                        managerHandle: validatedManagerHandle,
                        type: milestoneBonusTypes[key as keyof typeof milestoneBonusTypes],
                        amount: bonusAmount,
                        month,
                        batchId,
                        calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        createdBy: 'excel-calculator-function'
                    });
                }
            }
        }
        processedRows++;
        if (uploadDocRef && processedRows % 20 === 0) {
            const currentProgress = 10 + Math.floor((processedRows / rows.length) * 80); // 10-90% for processing
            await uploadDocRef.update({ processedRows, progress: currentProgress, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        }
    }

    // After processing all rows, calculate and add Diamond Bonuses
    const previousMonth = getPreviousMonth(month);
    for (const managerId in managerNetTotals) {
        const managerData = managerNetTotals[managerId];
        const currentNet = managerData.net;

        let previousNet = 0;

        // 1. NEW: Prioritize the 'managerMonthlyNets' collection for previous month's data
        const comparisonDocRef = firestore.collection('managerMonthlyNets').doc(`${managerId}_${previousMonth}`);
        const comparisonDoc = await comparisonDocRef.get();

        if (comparisonDoc.exists) {
            previousNet = comparisonDoc.data()?.netAmount || 0;
            console.log(`📈 Found comparison data for ${managerData.handle} (Month: ${previousMonth}): €${previousNet}`);
        } else {
            // 2. FALLBACK: If no comparison data, calculate from previous transactions
            const prevTransactions = await firestore.collection('transactions')
                .where('managerId', '==', managerId)
                .where('month', '==', previousMonth)
                .get();
            
            prevTransactions.forEach(doc => {
                previousNet += doc.data().netForCommission || 0;
            });
            if(previousNet > 0) {
                console.log(`📉 No comparison data found. Using fallback transaction data for ${managerData.handle} (Month: ${previousMonth}): €${previousNet}`);
            }
        }
        
        // Check for Diamond Bonus
        if (currentNet >= previousNet * 1.2 && previousNet > 0) {
            const diamondBonusAmount = DIAMOND_BONUS_PAYOUT[managerData.type];
            const bonusRef = firestore.collection('bonuses').doc();
            batch.set(bonusRef, {
                managerId,
                managerHandle: managerData.handle,
                type: 'DIAMOND_BONUS',
                amount: diamondBonusAmount,
                month,
                batchId,
                notes: `Awarded for exceeding 120% of previous month's net (€${previousNet.toFixed(2)}).`,
                calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'excel-calculator-function'
            });
        }
    }


    if (validationErrors.length > 0) {
      console.warn(`Batch ${batchId} completed with ${validationErrors.length} validation errors.`);
      const errorsRef = db.collection(UPLOAD_COLLECTION).doc(month).collection('errors').doc();
      batch.set(errorsRef, { errors: validationErrors, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    await batch.commit();
    console.log(`Batch ${batchId} committed with ${rows.length - 1 - validationErrors.length} rows processed.`);
}

/**
 * Gets the previous month in YYYYMM format.
 * @param month The current month in YYYYMM format.
 * @returns The previous month in YYYYMM format.
 */
function getPreviousMonth(month: string): string {
    const year = parseInt(month.substring(0, 4));
    const monthNum = parseInt(month.substring(4, 6));
    
    let prevYear = year;
    let prevMonth = monthNum - 1;
    
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = year - 1;
    }
    
    return `${prevYear}${prevMonth.toString().padStart(2, '0')}`;
} 