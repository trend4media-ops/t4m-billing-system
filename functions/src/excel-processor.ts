import * as admin from 'firebase-admin';
import * as XLSX from 'xlsx';
import { processCommissionData } from './excel-calculator';

const db = admin.firestore();
const storage = admin.storage();

export interface ProcessingResult {
  batchId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress: number;
  totalRows: number;
  processedRows: number;
  managersProcessed: number;
  totalRevenue: number;
  totalCommissions: number;
  totalBonuses: number;
  errors: any[];
  processingTime: number;
  month: string;
  fileName: string;
}

export interface ManagerData {
  managerId: string;
  managerHandle: string;
  managerType: 'live' | 'team';
  totalGross: number;
  totalNet: number;
  baseCommission: number;
  totalBonuses: number;
  transactionCount: number;
  creatorCount: number;
  downlineEarnings: number;
  processingDate: string;
  month: string;
  batchId: string;
}

/**
 * Complete Excel Processing Pipeline
 * Upload → Download → Parse → Calculate → Store → Update Dashboard
 */
export class ExcelProcessor {
  private batchId: string;
  private uploadDoc: admin.firestore.DocumentReference;
  
  constructor(batchId: string) {
    this.batchId = batchId;
    this.uploadDoc = db.collection('uploadBatches').doc(batchId);
  }

  /**
   * Main processing function - orchestrates the entire pipeline
   */
  async processExcelFile(): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    try {
      // 1. Get upload metadata
      console.log(`🚀 Starting Excel processing for batch: ${this.batchId}`);
      const uploadData = await this.getUploadMetadata();
      
      // 2. Download Excel file from Firebase Storage
      const excelData = await this.downloadExcelFile(uploadData.filePath, uploadData.fileName);
      
      // 3. Parse Excel and extract data
      const parsedData = await this.parseExcelFile(excelData, uploadData.fileName);
      
      // 4. Process through calculation engine
      const calculationResults = await this.processCalculations(parsedData, uploadData.month);
      
      // 5. Store processed results in Firestore
      const storageResults = await this.storeProcessedData(calculationResults, uploadData.month);
      
      // 6. Update dashboard data
      await this.updateDashboardData(storageResults, uploadData.month);
      
      // 7. Finalize processing
      const processingTime = Date.now() - startTime;
      const result = await this.finalizeProcessing(storageResults, processingTime, uploadData);
      
      console.log(`✅ Excel processing completed in ${processingTime}ms`);
      return result;
      
    } catch (error) {
      console.error(`💥 Excel processing failed:`, error);
      await this.handleProcessingError(error);
      throw error;
    }
  }

  /**
   * Get upload metadata from Firestore
   */
  private async getUploadMetadata() {
    const doc = await this.uploadDoc.get();
    if (!doc.exists) {
      throw new Error(`Upload batch ${this.batchId} not found`);
    }
    
    const data = doc.data()!;
    await this.updateProgress('DOWNLOADING', 5);
    
    return {
      fileName: data.fileName,
      filePath: data.filePath,
      month: data.month,
      isComparison: data.isComparison || false
    };
  }

  /**
   * Download Excel file from Firebase Storage
   */
  private async downloadExcelFile(filePath: string, fileName: string): Promise<Buffer> {
    console.log(`📥 Downloading Excel file: ${fileName}`);
    
    try {
      const bucket = storage.bucket();
      const file = bucket.file(filePath);
      
      const [fileContent] = await file.download();
      await this.updateProgress('PARSING', 15);
      
      console.log(`✅ Downloaded ${fileContent.length} bytes`);
      return fileContent;
      
         } catch (error) {
       throw new Error(`Failed to download Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
     }
  }

  /**
   * Parse Excel file and extract structured data
   */
  private async parseExcelFile(fileContent: Buffer, fileName: string) {
    console.log(`📊 Parsing Excel file: ${fileName}`);
    
    try {
      const workbook = XLSX.read(fileContent, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON with proper headers
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      // Extract headers and data
      const headers = rawData[0] || [];
      const dataRows = rawData.slice(1);
      
      await this.updateProgress('CALCULATING', 25, dataRows.length);
      
      console.log(`✅ Parsed ${dataRows.length} data rows with ${headers.length} columns`);
      
      return {
        headers,
        rows: rawData, // Include headers for compatibility with existing calculator
        dataRows,
        totalRows: dataRows.length
      };
      
         } catch (error) {
       throw new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
     }
  }

  /**
   * Process data through the calculation engine
   */
  private async processCalculations(parsedData: any, month: string) {
    console.log(`🧮 Processing calculations for ${parsedData.totalRows} rows`);
    
    try {
      // Use existing calculation engine
      const managerMap = await this.ensureManagersExist(parsedData.rows);
      
      // Process through commission calculator
      await processCommissionData(
        parsedData.rows, 
        this.batchId, 
        month, 
        this.uploadDoc, 
        managerMap
      );
      
      // Get processing results
      const processingResults = await this.getCalculationResults(month);
      
      await this.updateProgress('STORING', 75);
      
      console.log(`✅ Calculated data for ${processingResults.managersProcessed} managers`);
      return processingResults;
      
         } catch (error) {
       throw new Error(`Failed to process calculations: ${error instanceof Error ? error.message : 'Unknown error'}`);
     }
  }

  /**
   * Ensure all managers exist in database
   */
  private async ensureManagersExist(rows: any[][]): Promise<Map<string, string>> {
    const managerMap = new Map<string, string>();
    const batch = db.batch();
    let managersCreated = 0;
    
    // Extract unique manager handles from data
    const managerHandles = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const managerHandle = row[0]?.toString()?.trim();
      if (managerHandle) {
        managerHandles.add(managerHandle);
      }
    }
    
    // Check existing managers
    for (const handle of managerHandles) {
      const existing = await db.collection('managers')
        .where('handle', '==', handle)
        .limit(1)
        .get();
      
      if (!existing.empty) {
        managerMap.set(handle, existing.docs[0].id);
      } else {
        // Create new manager
        const newManagerRef = db.collection('managers').doc();
        const managerType = this.determineManagerType(handle, rows);
        
        batch.set(newManagerRef, {
          handle: handle,
          name: handle,
          type: managerType,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdByBatch: this.batchId
        });
        
        managerMap.set(handle, newManagerRef.id);
        managersCreated++;
      }
    }
    
    if (managersCreated > 0) {
      await batch.commit();
      console.log(`✅ Created ${managersCreated} new managers`);
    }
    
    return managerMap;
  }

  /**
   * Determine manager type from Excel data
   */
  private determineManagerType(handle: string, rows: any[][]): 'live' | 'team' {
    // Look for manager type in the data rows
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] === handle && row[1]) {
        const type = row[1].toString().toLowerCase();
        return type === 'team' ? 'team' : 'live';
      }
    }
    return 'live'; // Default
  }

  /**
   * Get calculation results from database
   */
  private async getCalculationResults(month: string) {
    // Get transactions for this batch
    const transactionsQuery = await db.collection('transactions')
      .where('batchId', '==', this.batchId)
      .get();
    
    // Get bonuses for this batch
    const bonusesQuery = await db.collection('bonuses')
      .where('batchId', '==', this.batchId)
      .get();
    
    // Calculate totals
    let totalRevenue = 0;
    let totalCommissions = 0;
    let totalBonuses = 0;
    const managers = new Set<string>();
    
    transactionsQuery.forEach(doc => {
      const data = doc.data();
      totalRevenue += data.grossAmount || 0;
      totalCommissions += data.baseCommission || 0;
      managers.add(data.managerId);
    });
    
    bonusesQuery.forEach(doc => {
      const data = doc.data();
      totalBonuses += data.amount || 0;
    });
    
    return {
      totalRevenue,
      totalCommissions,
      totalBonuses,
      managersProcessed: managers.size,
      transactionCount: transactionsQuery.size,
      bonusCount: bonusesQuery.size
    };
  }

  /**
   * Store processed results in optimized format for dashboard
   */
  private async storeProcessedData(calculationResults: any, month: string) {
    console.log(`💾 Storing processed data for month: ${month}`);
    
    try {
      // Get manager earnings data
      const managerEarnings = await this.getManagerEarningsData(month);
      
      // Store batch summary
      await this.storeBatchSummary(calculationResults, month);
      
      // Store manager data for quick dashboard access
      await this.storeManagerData(managerEarnings, month);
      
      await this.updateProgress('FINALIZING', 90);
      
      console.log(`✅ Stored data for ${managerEarnings.length} managers`);
      return {
        ...calculationResults,
        managerEarnings
      };
      
         } catch (error) {
       throw new Error(`Failed to store processed data: ${error instanceof Error ? error.message : 'Unknown error'}`);
     }
  }

  /**
   * Get manager earnings data from individual collections
   */
  private async getManagerEarningsData(month: string): Promise<ManagerData[]> {
    const earnings = await db.collection('manager-earnings')
      .where('month', '==', month)
      .where('batchId', '==', this.batchId)
      .get();
    
    const managerData: ManagerData[] = [];
    
    for (const doc of earnings.docs) {
      const data = doc.data();
      
      // Get manager details
      const managerDoc = await db.collection('managers').doc(data.managerId).get();
      const manager = managerDoc.data();
      
      managerData.push({
        managerId: data.managerId,
        managerHandle: manager?.handle || data.managerId,
        managerType: manager?.type || 'live',
        totalGross: data.totalGross || 0,
        totalNet: data.totalNet || 0,
        baseCommission: data.baseCommission || 0,
        totalBonuses: data.bonuses || 0,
        transactionCount: data.transactionCount || 0,
        creatorCount: data.creatorCount || 0,
        downlineEarnings: 0, // Will be calculated separately
        processingDate: new Date().toISOString(),
        month: month,
        batchId: this.batchId
      });
    }
    
    return managerData;
  }

  /**
   * Store batch summary for quick dashboard access
   */
  private async storeBatchSummary(results: any, month: string) {
    const summaryRef = db.collection('batch-summaries').doc(this.batchId);
    
    await summaryRef.set({
      batchId: this.batchId,
      month: month,
      totalRevenue: results.totalRevenue,
      totalCommissions: results.totalCommissions,
      totalBonuses: results.totalBonuses,
      managersProcessed: results.managersProcessed,
      transactionCount: results.transactionCount,
      processingDate: admin.firestore.FieldValue.serverTimestamp(),
      status: 'COMPLETED'
    });
  }

  /**
   * Store manager data in optimized format
   */
  private async storeManagerData(managerData: ManagerData[], month: string) {
    const batch = db.batch();
    
    // Store individual manager documents
    managerData.forEach(manager => {
      const managerRef = db.collection('processed-managers').doc(`${manager.managerId}_${month}`);
      batch.set(managerRef, manager);
    });
    
    // Store month summary
    const monthSummaryRef = db.collection('month-summaries').doc(month);
    const monthSummary = this.calculateMonthSummary(managerData);
    batch.set(monthSummaryRef, monthSummary, { merge: true });
    
    await batch.commit();
  }

  /**
   * Calculate month summary from manager data
   */
  private calculateMonthSummary(managerData: ManagerData[]) {
    return {
      month: managerData[0]?.month,
      totalManagers: managerData.length,
      totalRevenue: managerData.reduce((sum, m) => sum + m.totalGross, 0),
      totalCommissions: managerData.reduce((sum, m) => sum + m.baseCommission, 0),
      totalBonuses: managerData.reduce((sum, m) => sum + m.totalBonuses, 0),
      totalTransactions: managerData.reduce((sum, m) => sum + m.transactionCount, 0),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      batchIds: [this.batchId]
    };
  }

  /**
   * Update dashboard data with real-time changes
   */
  private async updateDashboardData(results: any, month: string) {
    console.log(`📊 Updating dashboard data for month: ${month}`);
    
    // Trigger real-time update
    const dashboardRef = db.collection('dashboard-updates').doc();
    await dashboardRef.set({
      type: 'EXCEL_PROCESSING_COMPLETE',
      batchId: this.batchId,
      month: month,
      results: {
        managersProcessed: results.managersProcessed,
        totalRevenue: results.totalRevenue,
        totalCommissions: results.totalCommissions,
        totalBonuses: results.totalBonuses
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Dashboard update triggered`);
  }

  /**
   * Finalize processing and return results
   */
  private async finalizeProcessing(results: any, processingTime: number, uploadData: any): Promise<ProcessingResult> {
    await this.updateProgress('COMPLETED', 100);
    
    const finalResult: ProcessingResult = {
      batchId: this.batchId,
      status: 'COMPLETED',
      progress: 100,
      totalRows: results.transactionCount || 0,
      processedRows: results.transactionCount || 0,
      managersProcessed: results.managersProcessed || 0,
      totalRevenue: results.totalRevenue || 0,
      totalCommissions: results.totalCommissions || 0,
      totalBonuses: results.totalBonuses || 0,
      errors: [],
      processingTime,
      month: uploadData.month,
      fileName: uploadData.fileName
    };
    
    // Update upload document with final results
    await this.uploadDoc.update({
      ...finalResult,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return finalResult;
  }

  /**
   * Update processing progress
   */
  private async updateProgress(status: string, progress: number, totalRows?: number) {
    const updateData: any = {
      status,
      progress,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (totalRows) {
      updateData.totalRows = totalRows;
    }
    
    await this.uploadDoc.update(updateData);
    
    console.log(`📊 Progress: ${status} - ${progress}%`);
  }

  /**
   * Handle processing errors
   */
  private async handleProcessingError(error: any) {
    await this.uploadDoc.update({
      status: 'FAILED',
      error: error.message,
      failedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}

/**
 * Public function to start Excel processing
 */
export async function processExcelFile(batchId: string): Promise<ProcessingResult> {
  const processor = new ExcelProcessor(batchId);
  return await processor.processExcelFile();
} 