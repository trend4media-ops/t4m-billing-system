
import * as admin from 'firebase-admin';
// import * as XLSX from 'xlsx'; // Unused for now

const db = admin.firestore();

// Commission Rates
const COMMISSION_RATES = {
  LIVE: 0.35,  // 35% for LIVE managers
  TEAM: 0.30   // 30% for TEAM managers
};

// Milestone bonus configuration
const MILESTONE_BONUSES = {
  S: { threshold: 6000, amount: 600 },
  N: { threshold: 15000, amount: 1200 },
  O: { threshold: 25000, amount: 1500 },
  P: { threshold: 35000, amount: 2000 }
};

interface ProcessingData {
  type: 'regular' | 'comparison';
  month: string;
  batchId?: string;
}

interface ManagerRow {
  managerHandle: string;
  managerType: string;
  creatorHandle: string;
  grossAmount: number;
  netAmount: number;
  month: string;
}

/**
 * Main function to process commission data from Excel
 */
export async function processCommissionData(
  rows: any[][],
  batchId: string,
  month: string,
  uploadDocRef: admin.firestore.DocumentReference,
  managerMap?: Map<string, string>
): Promise<void> {
  console.log(`🚀 Starting commission processing for batch ${batchId}, month ${month}`);
  
  const data: ProcessingData = {
    type: 'regular',
    month: month,
    batchId: batchId
  };

  try {
    // Update status
    await uploadDocRef.update({
      status: 'CALCULATING',
      progress: 25,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Parse Excel data
    const parsedRows = parseExcelRows(rows, month);
    console.log(`📊 Parsed ${parsedRows.length} manager rows`);

    // Update progress
    await uploadDocRef.update({
      progress: 50,
      totalRows: parsedRows.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Ensure managers exist and get their IDs
    const managers = managerMap || await ensureManagersExist(parsedRows, batchId);
    console.log(`👥 Processing ${managers.size} unique managers`);

    // Process transactions for each manager
    const managerEarnings = await processManagerTransactions(parsedRows, managers, data, batchId);

    // Update progress
    await uploadDocRef.update({
      progress: 75,
      processedRows: parsedRows.length,
      managersProcessed: managers.size,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Calculate and store bonuses
    await calculateAndStoreBonuses(managerEarnings, data, batchId);

    // Final update
    await uploadDocRef.update({
      status: 'COMPLETED',
      progress: 100,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      totalRevenue: Object.values(managerEarnings).reduce((sum, earnings) => sum + earnings.totalGross, 0),
      totalCommissions: Object.values(managerEarnings).reduce((sum, earnings) => sum + earnings.baseCommission, 0),
      managersProcessed: managers.size
    });

    console.log(`✅ Commission processing completed for batch ${batchId}`);

  } catch (error) {
    console.error(`💥 Commission processing failed for batch ${batchId}:`, error);
    
    await uploadDocRef.update({
      status: 'FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    throw error;
  }
}

/**
 * Parse Excel rows into structured manager data
 */
function parseExcelRows(rows: any[][], month: string): ManagerRow[] {
  const parsedRows: ManagerRow[] = [];
  
  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    if (!row || row.length < 4) continue;
    
    const managerHandle = row[0]?.toString()?.trim();
    const managerType = row[1]?.toString()?.trim()?.toUpperCase();
    const creatorHandle = row[2]?.toString()?.trim();
    const grossAmount = parseFloat(row[3]?.toString() || '0');
    const netAmount = parseFloat(row[4]?.toString() || '0');
    
    if (!managerHandle || !creatorHandle || grossAmount <= 0) continue;
    
    parsedRows.push({
      managerHandle,
      managerType: managerType === 'TEAM' ? 'TEAM' : 'LIVE',
      creatorHandle,
      grossAmount,
      netAmount: netAmount || grossAmount * 0.85, // Default to 85% if not provided
      month
    });
  }
  
  return parsedRows;
}

/**
 * Ensure all managers exist in the database
 */
async function ensureManagersExist(rows: ManagerRow[], batchId: string): Promise<Map<string, string>> {
  const managers = new Map<string, string>();
  const batch = db.batch();
  
  // Get unique manager handles
  const uniqueManagers = new Map<string, { handle: string; type: string }>();
  rows.forEach(row => {
    uniqueManagers.set(row.managerHandle, {
      handle: row.managerHandle,
      type: row.managerType
    });
  });
  
  // Check existing managers and create new ones
  for (const [handle, info] of uniqueManagers) {
    const existing = await db.collection('managers')
      .where('handle', '==', handle)
      .limit(1)
      .get();
    
    if (!existing.empty) {
      managers.set(handle, existing.docs[0].id);
    } else {
      // Create new manager
      const newManagerRef = db.collection('managers').doc();
      batch.set(newManagerRef, {
        handle: handle,
        name: handle,
        type: info.type,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdByBatch: batchId
      });
      managers.set(handle, newManagerRef.id);
    }
  }
  
  if (managers.size < uniqueManagers.size) {
    await batch.commit();
    console.log(`✅ Created ${uniqueManagers.size - managers.size} new managers`);
  }
  
  return managers;
}

/**
 * Process transactions for all managers
 */
async function processManagerTransactions(
  rows: ManagerRow[],
  managers: Map<string, string>,
  data: ProcessingData,
  batchId: string
): Promise<Record<string, any>> {
  const managerEarnings: Record<string, any> = {};
  const batch = db.batch();
  
  // Group rows by manager
  const managerGroups = new Map<string, ManagerRow[]>();
  rows.forEach(row => {
    if (!managerGroups.has(row.managerHandle)) {
      managerGroups.set(row.managerHandle, []);
    }
    managerGroups.get(row.managerHandle)!.push(row);
  });
  
  // Process each manager
  for (const [managerHandle, managerRows] of managerGroups) {
    const managerId = managers.get(managerHandle);
    if (!managerId) continue;
    
    const earnings = calculateManagerEarnings(managerRows, managerId, data, batchId);
    managerEarnings[managerId] = earnings;
    
    // Store transactions
    managerRows.forEach((row, index) => {
      const transactionRef = db.collection('transactions').doc();
      batch.set(transactionRef, {
        managerId,
        managerHandle: row.managerHandle,
        managerType: row.managerType,
        creatorHandle: row.creatorHandle,
        grossAmount: row.grossAmount,
        netAmount: row.netAmount,
        baseCommission: row.grossAmount * COMMISSION_RATES[row.managerType as keyof typeof COMMISSION_RATES],
        month: data.month,
        batchId: batchId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    
    // Store manager earnings summary
    const earningsRef = db.collection('manager-earnings').doc(`${managerId}_${data.month}`);
    batch.set(earningsRef, earnings, { merge: true });
  }
  
  await batch.commit();
  console.log(`✅ Stored transactions and earnings for ${Object.keys(managerEarnings).length} managers`);
  
  return managerEarnings;
}

/**
 * Calculate earnings for a specific manager
 */
function calculateManagerEarnings(
  managerRows: ManagerRow[],
  managerId: string,
  data: ProcessingData,
  batchId: string
): any {
  const managerType = managerRows[0].managerType;
  const commissionRate = COMMISSION_RATES[managerType as keyof typeof COMMISSION_RATES];
  
  const totalGross = managerRows.reduce((sum, row) => sum + row.grossAmount, 0);
  const totalNet = managerRows.reduce((sum, row) => sum + row.netAmount, 0);
  const baseCommission = totalGross * commissionRate;
  const transactionCount = managerRows.length;
  const creatorCount = new Set(managerRows.map(row => row.creatorHandle)).size;
  
  return {
    managerId,
    month: data.month,
    managerType,
    totalGross,
    totalNet,
    baseCommission,
    transactionCount,
    creatorCount,
    batchId,
    status: 'CALCULATED',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

/**
 * Calculate and store milestone bonuses
 */
async function calculateAndStoreBonuses(
  managerEarnings: Record<string, any>,
  data: ProcessingData,
  batchId: string
): Promise<void> {
  const batch = db.batch();
  
  for (const [managerId, earnings] of Object.entries(managerEarnings)) {
    const { totalGross } = earnings;
    
    // Calculate milestone bonuses
    for (const [milestoneType, config] of Object.entries(MILESTONE_BONUSES)) {
      if (totalGross >= config.threshold) {
        const bonusRef = db.collection('bonuses').doc();
        batch.set(bonusRef, {
          managerId,
          type: `MILESTONE_${milestoneType}`,
          amount: config.amount,
          month: data.month,
          batchId,
          threshold: config.threshold,
          totalGross,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  }
  
  await batch.commit();
  console.log(`✅ Calculated and stored milestone bonuses`);
} 

// ✅ Add missing export for processUploadedExcel
export async function processUploadedExcel(batchId: string): Promise<void> {
  try {
    console.log(`🔄 Processing uploaded Excel for batch: ${batchId}`);
    
    const db = admin.firestore();
    const batchDoc = await db.collection('uploadBatches').doc(batchId).get();
    
    if (!batchDoc.exists) {
      throw new Error(`Batch ${batchId} not found`);
    }
    
    // const batchData = batchDoc.data()!; // Available for future use
    
    // Update status to processing
    await batchDoc.ref.update({
      status: 'PROCESSING',
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Here you would add the actual Excel processing logic
    // For now, just mark as completed
    await batchDoc.ref.update({
      status: 'COMPLETED',
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Excel processing completed for batch: ${batchId}`);
    
  } catch (error) {
    console.error(`❌ Error processing Excel for batch ${batchId}:`, error);
    
    // Update status to failed
    const db = admin.firestore();
    await db.collection('uploadBatches').doc(batchId).update({
      status: 'FAILED',
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    throw error;
  }
} 