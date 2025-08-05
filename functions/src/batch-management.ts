import * as admin from 'firebase-admin';

const db = admin.firestore();

export interface BatchInfo {
  batchId: string;
  fileName: string;
  month: string;
  uploadedAt: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  processedRows: number;
  managersProcessed: number;
  totalRevenue: number;
  totalCommissions: number;
  totalBonuses: number;
  collections: {
    transactions: number;
    bonuses: number;
    managerEarnings: number;
    processedManagers: number;
  };
}

export interface BatchCleanupResult {
  batchId: string;
  collectionsCleared: string[];
  documentsDeleted: number;
  success: boolean;
  error?: string;
}

/**
 * Batch Management System
 * Organizes all data by batch for systematic management and cleanup
 */
export class BatchManager {
  
  /**
   * Get all available batches with their metadata
   */
  static async getAllBatches(): Promise<BatchInfo[]> {
    try {
      const batchesSnapshot = await db.collection('uploadBatches')
        .orderBy('createdAt', 'desc')
        .get();
      
      const batches: BatchInfo[] = [];
      
      for (const doc of batchesSnapshot.docs) {
        const data = doc.data();
        
        // Count documents in related collections
        const collections = await this.getBatchCollectionCounts(doc.id);
        
        batches.push({
          batchId: doc.id,
          fileName: data.fileName || 'Unknown',
          month: data.month || 'Unknown',
          uploadedAt: data.createdAt?.toDate()?.toISOString() || new Date().toISOString(),
          status: data.status || 'UNKNOWN',
          totalRows: data.totalRows || 0,
          processedRows: data.processedRows || 0,
          managersProcessed: data.managersProcessed || 0,
          totalRevenue: data.totalRevenue || 0,
          totalCommissions: data.totalCommissions || 0,
          totalBonuses: data.totalBonuses || 0,
          collections
        });
      }
      
      return batches;
      
    } catch (error) {
      console.error('Error getting all batches:', error);
      throw new Error(`Failed to get batches: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Get batch information including data distribution
   */
  static async getBatchInfo(batchId: string): Promise<BatchInfo | null> {
    try {
      const batchDoc = await db.collection('uploadBatches').doc(batchId).get();
      
      if (!batchDoc.exists) {
        return null;
      }
      
      const data = batchDoc.data()!;
      const collections = await this.getBatchCollectionCounts(batchId);
      
      return {
        batchId,
        fileName: data.fileName || 'Unknown',
        month: data.month || 'Unknown',
        uploadedAt: data.createdAt?.toDate()?.toISOString() || new Date().toISOString(),
        status: data.status || 'UNKNOWN',
        totalRows: data.totalRows || 0,
        processedRows: data.processedRows || 0,
        managersProcessed: data.managersProcessed || 0,
        totalRevenue: data.totalRevenue || 0,
        totalCommissions: data.totalCommissions || 0,
        totalBonuses: data.totalBonuses || 0,
        collections
      };
      
    } catch (error) {
      console.error(`Error getting batch info for ${batchId}:`, error);
      throw new Error(`Failed to get batch info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  /**
   * Count documents in each collection for a specific batch
   */
  private static async getBatchCollectionCounts(batchId: string) {
    const [
      transactionsCount,
      bonusesCount, 
      managerEarningsCount,
      processedManagersCount
    ] = await Promise.all([
      db.collection('transactions').where('batchId', '==', batchId).count().get(),
      db.collection('bonuses').where('batchId', '==', batchId).count().get(),
      db.collection('manager-earnings').where('batchId', '==', batchId).count().get(),
      db.collection('processed-managers').where('batchId', '==', batchId).count().get()
    ]);
    
    return {
      transactions: transactionsCount.data().count,
      bonuses: bonusesCount.data().count,
      managerEarnings: managerEarningsCount.data().count,
      processedManagers: processedManagersCount.data().count
    };
  }
  
  /**
   * Clear all data for a specific batch
   */
  static async clearBatchData(batchId: string): Promise<BatchCleanupResult> {
    const batch = db.batch();
    const collectionsCleared: string[] = [];
    let documentsDeleted = 0;
    
    try {
      console.log(`🗑️ Starting cleanup for batch: ${batchId}`);
      
      // 1. Clear transactions
      const transactionsSnapshot = await db.collection('transactions')
        .where('batchId', '==', batchId)
        .get();
      
      transactionsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        documentsDeleted++;
      });
      
      if (transactionsSnapshot.docs.length > 0) {
        collectionsCleared.push('transactions');
      }
      
      // 2. Clear bonuses
      const bonusesSnapshot = await db.collection('bonuses')
        .where('batchId', '==', batchId)
        .get();
      
      bonusesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        documentsDeleted++;
      });
      
      if (bonusesSnapshot.docs.length > 0) {
        collectionsCleared.push('bonuses');
      }
      
      // 3. Clear manager earnings
      const earningsSnapshot = await db.collection('manager-earnings')
        .where('batchId', '==', batchId)
        .get();
      
      earningsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        documentsDeleted++;
      });
      
      if (earningsSnapshot.docs.length > 0) {
        collectionsCleared.push('manager-earnings');
      }
      
      // 4. Clear processed managers
      const processedSnapshot = await db.collection('processed-managers')
        .where('batchId', '==', batchId)
        .get();
      
      processedSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        documentsDeleted++;
      });
      
      if (processedSnapshot.docs.length > 0) {
        collectionsCleared.push('processed-managers');
      }
      
      // 5. Clear batch summary
      const batchSummaryDoc = await db.collection('batch-summaries').doc(batchId).get();
      if (batchSummaryDoc.exists) {
        batch.delete(batchSummaryDoc.ref);
        documentsDeleted++;
        collectionsCleared.push('batch-summaries');
      }
      
      // 6. Update upload batch status
      const uploadBatchRef = db.collection('uploadBatches').doc(batchId);
      batch.update(uploadBatchRef, {
        status: 'CLEARED',
        clearedAt: admin.firestore.FieldValue.serverTimestamp(),
        documentsDeleted,
        collectionsCleared
      });
      
      // Execute batch deletion
      await batch.commit();
      
      console.log(`✅ Batch cleanup completed: ${documentsDeleted} documents deleted from ${collectionsCleared.length} collections`);
      
      return {
        batchId,
        collectionsCleared,
        documentsDeleted,
        success: true
      };
      
    } catch (error) {
      console.error(`💥 Batch cleanup failed for ${batchId}:`, error);
      
      return {
        batchId,
        collectionsCleared,
        documentsDeleted,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Clear all data for a specific month (multiple batches)
   */
  static async clearMonthData(month: string): Promise<BatchCleanupResult[]> {
    try {
      console.log(`🗑️ Starting month cleanup for: ${month}`);
      
      // Get all batches for the month
      const monthBatchesSnapshot = await db.collection('uploadBatches')
        .where('month', '==', month)
        .get();
      
      const results: BatchCleanupResult[] = [];
      
      // Clear each batch
      for (const doc of monthBatchesSnapshot.docs) {
        const result = await this.clearBatchData(doc.id);
        results.push(result);
      }
      
      // Clear month summary
      const monthSummaryDoc = await db.collection('month-summaries').doc(month).get();
      if (monthSummaryDoc.exists) {
        await monthSummaryDoc.ref.delete();
        console.log(`✅ Month summary cleared for ${month}`);
      }
      
      console.log(`✅ Month cleanup completed for ${month}: ${results.length} batches processed`);
      
      return results;
      
    } catch (error) {
      console.error(`💥 Month cleanup failed for ${month}:`, error);
      throw error;
    }
  }
  
  /**
   * Detect and report duplicate transactions across batches
   */
  static async detectDuplicateTransactions(): Promise<{
    duplicates: Array<{
      transactionKey: string;
      batches: string[];
      count: number;
    }>;
    totalDuplicates: number;
  }> {
    try {
      console.log('🔍 Detecting duplicate transactions...');
      
      const transactionsSnapshot = await db.collection('transactions').get();
      const transactionMap = new Map<string, string[]>();
      
      // Group transactions by unique key (managerId + amount + date)
      transactionsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const key = `${data.managerId}_${data.grossAmount}_${data.month}`;
        
        if (!transactionMap.has(key)) {
          transactionMap.set(key, []);
        }
        
        transactionMap.get(key)!.push(data.batchId);
      });
      
      // Find duplicates
      const duplicates = [];
      let totalDuplicates = 0;
      
      for (const [key, batches] of transactionMap.entries()) {
        if (batches.length > 1) {
          const uniqueBatches = [...new Set(batches)];
          if (uniqueBatches.length > 1) {
            duplicates.push({
              transactionKey: key,
              batches: uniqueBatches,
              count: batches.length
            });
            totalDuplicates += batches.length - 1; // Subtract 1 for the original
          }
        }
      }
      
      console.log(`🔍 Found ${duplicates.length} duplicate transaction groups (${totalDuplicates} total duplicates)`);
      
      return { duplicates, totalDuplicates };
      
    } catch (error) {
      console.error('💥 Error detecting duplicates:', error);
      throw error;
    }
  }
  
  /**
   * Get duplicate transaction report for display
   */
  static async getDuplicatesReport(): Promise<{
    summary: {
      totalBatches: number;
      duplicateGroups: number;
      totalDuplicates: number;
      affectedBatches: string[];
    };
    details: Array<{
      transactionKey: string;
      batches: string[];
      count: number;
      recommendation: string;
    }>;
  }> {
    try {
      const allBatches = await this.getAllBatches();
      const duplicateData = await this.detectDuplicateTransactions();
      
      const affectedBatches = new Set<string>();
      duplicateData.duplicates.forEach(dup => {
        dup.batches.forEach(batchId => affectedBatches.add(batchId));
      });
      
      const details = duplicateData.duplicates.map(dup => ({
        transactionKey: dup.transactionKey,
        batches: dup.batches,
        count: dup.count,
        recommendation: dup.count > 2 ? 'Keep newest batch, delete others' : 'Keep most recent upload'
      }));
      
      return {
        summary: {
          totalBatches: allBatches.length,
          duplicateGroups: duplicateData.duplicates.length,
          totalDuplicates: duplicateData.totalDuplicates,
          affectedBatches: Array.from(affectedBatches)
        },
        details
      };
      
    } catch (error) {
      console.error('💥 Error generating duplicates report:', error);
      throw error;
    }
  }
} 