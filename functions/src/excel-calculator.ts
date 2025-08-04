
import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { onObjectFinalized, StorageEvent } from 'firebase-functions/v2/storage';
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
 * Triggered when a new Excel file is uploaded to the 'uploads' bucket.
 * This function reads the Excel file, calculates commissions based on v2.0 logic,
 * and saves the results to Firestore.
 */
export const excelCalculator = onObjectFinalized({ region: "us-west1", timeoutSeconds: 540, memory: "1GiB" }, async (event: StorageEvent) => {
  const { bucket: fileBucket, name: filePath, contentType, metadata } = event.data;

  if (!contentType?.includes('spreadsheet') && !filePath?.endsWith('.xlsx')) {
    console.log('This is not an Excel file.');
    return;
  }
  
  if(!filePath || !filePath.startsWith('uploads/')) {
    console.log(`File ${filePath} is not in the uploads folder.`);
    return;
  }

  const isComparison = metadata?.isComparison === 'true';
  const month = extractMonthFromFileName(filePath);
  if (!month) {
    console.error(`Could not extract month from filename: ${filePath}. Expected format 'YYYYMM'.`);
    return;
  }

  const uploadDocRef = db.collection(UPLOAD_COLLECTION).doc(month);

  try {
    await db.runTransaction(async (transaction) => {
      const uploadDoc = await transaction.get(uploadDocRef);

      if (uploadDoc.exists && uploadDoc.data()?.status === 'COMPLETED') {
        throw new Error(`Upload for month ${month} has already been successfully processed.`);
      }

      if (uploadDoc.exists && uploadDoc.data()?.status === 'PROCESSING') {
        const lastUpdated = uploadDoc.data()?.updatedAt?.toDate();
        const now = new Date();
        // If still processing after 10 minutes, assume it's stuck and allow reprocessing.
        if (now.getTime() - lastUpdated.getTime() < 10 * 60 * 1000) {
          throw new Error(`Upload for month ${month} is currently being processed.`);
        }
      }
      
      transaction.set(uploadDocRef, {
        fileName: filePath,
        status: 'PROCESSING',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (error: any) {
    console.error(`Transaction failed: ${error.message}`);
    return; // Stop execution if upload is locked or already completed
  }


  console.log(`Processing file: ${filePath}`);

  const bucket = admin.storage().bucket(fileBucket);
  const tempFilePath = `/tmp/${filePath.split('/').pop()}`;
  
  try {
    await bucket.file(filePath).download({ destination: tempFilePath });

    const workbook = XLSX.readFile(tempFilePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (isComparison) {
      console.log(`📈 Processing COMPARISON data for month: ${month}`);
      await processComparisonData(rows, month, filePath);
    } else {
      console.log(`💰 Processing FULL commission data for month: ${month}`);
      const batchId = db.collection('batches').doc().id;
      await processCommissionData(rows, batchId, month);
      console.log(`Successfully processed batch ${batchId} from file ${filePath}`);
    }

    await uploadDocRef.update({
      status: 'COMPLETED',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      isComparison,
    });
    
  } catch(err) {
    console.error(`Failed to process file ${filePath}`, err);
    await uploadDocRef.update({
      status: 'FAILED',
      error: (err as Error).message,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
});

/**
 * Extracts the month from the filename.
 * Expected format is YYYYMM.
 * @param fileName The name of the file.
 * @returns The month string or null if not found.
 */
function extractMonthFromFileName(fileName: string): string | null {
  const match = fileName.match(/(\d{6})/);
  return match ? match[0] : null;
}


/**
 * Processes a comparison upload, calculating and storing only the net amounts for each manager.
 */
async function processComparisonData(rows: any[][], month: string, fileName: string) {
  const firestore = admin.firestore();
  const batch = firestore.batch();
  const managerNetTotals: { [key: string]: { net: number, handle: string, type: 'live' | 'team' } } = {};

  // Skip header row
  for (const [index, row] of rows.slice(1).entries()) {
    if (!row || !row[0]) continue; // Skip empty rows

    const rowData = {
      managerHandle: row[0],
      managerType: row[1]?.toLowerCase(),
      grossAmount: parseFloat(row[12]),
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
    const managerSnapshot = await firestore.collection('managers').where('name', '==', managerHandle).limit(1).get();
    if (managerSnapshot.empty) {
      console.warn(`Manager with handle '${managerHandle}' not found. Skipping...`);
      continue;
    }
    const managerId = managerSnapshot.docs[0].id;

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
export async function processCommissionData(rows: any[][], batchId: string, month: string) {
    const firestore = admin.firestore();
    const batch = firestore.batch();
    const managerNetTotals: { [key: string]: { net: number, handle: string, type: 'live' | 'team' } } = {};
    const validationErrors: { row: number, errors: any }[] = [];


    // Skip header row
    for (const [index, row] of rows.slice(1).entries()) {
        if (!row || !row[0]) continue; // Skip empty rows

        const rowData = {
          managerHandle: row[0],
          managerType: row[1]?.toLowerCase(),
          grossAmount: parseFloat(row[12]),
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

        const { managerHandle, managerType, grossAmount, milestoneN, milestoneO, milestoneP, milestoneS } = validationResult.data;

        // Find manager by handle to get their ID
        const managerSnapshot = await firestore.collection('managers').where('name', '==', managerHandle).limit(1).get();
        if (managerSnapshot.empty) {
            console.warn(`Manager with handle '${managerHandle}' not found. Skipping...`);
            continue;
        }
        const manager = managerSnapshot.docs[0];
        const managerId = manager.id;

        // Store manager's net total for Diamond Bonus calculation later
        if (!managerNetTotals[managerId]) {
            managerNetTotals[managerId] = { net: 0, handle: managerHandle, type: managerType };
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

        const baseCommissionRate = BASE_COMMISSION_RATES[managerType];
        const baseCommission = netForCommission > 0 ? netForCommission * baseCommissionRate : 0;

        // 4. Save the main transaction document
        const transactionId = firestore.collection('transactions').doc().id;
        const transactionRef = firestore.collection('transactions').doc(transactionId);
        batch.set(transactionRef, {
            id: transactionId,
            managerId,
            managerHandle,
            managerType: managerType.toUpperCase(),
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
                managerHandle,
                type: 'BASE_COMMISSION',
                amount: baseCommission,
                month,
                batchId,
                calculatedAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: 'excel-calculator-function'
            });
        }

        // 6. Create separate bonus documents for each achieved milestone
        const milestonePayouts = MILESTONE_PAYOUTS[managerType];
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
                        managerHandle,
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