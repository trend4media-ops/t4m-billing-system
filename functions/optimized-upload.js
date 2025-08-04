const admin = require("firebase-admin");
const xlsx = require("xlsx");

// Initialize if not already done
const db = admin.firestore();

// Progress tracking function for real-time updates
async function updateProgress(batchId, stage, message, current, total) {
  const progressData = {
    batchId: batchId,
    stage: stage,
    message: message,
    current: current,
    total: total,
    percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };
  
  try {
    await db.collection('uploadProgress').doc(batchId).set(progressData, { merge: true });
    console.log(`📊 Progress: ${stage} - ${message} (${current}/${total}) [${progressData.percentage}%]`);
  } catch (error) {
    console.error('Error updating progress:', error);
  }
}

// Optimized manager caching function
async function getOrCreateManagerCached(managerCache, managerName, type, batchId) {
  if (!managerName || managerName.trim() === '') return null;
  
  const cacheKey = `${type}_${managerName.toLowerCase()}`;
  if (managerCache.has(cacheKey)) {
    return managerCache.get(cacheKey);
  }

  // First, try to find existing manager by handle or name
  console.log(`🔍 Searching for existing manager: ${managerName} (${type})`);
  
  const existingManagerQuery = await db.collection('managers')
    .where('handle', '==', managerName)
    .limit(1)
    .get();
    
  let existingManagerByName = null;
  if (existingManagerQuery.empty) {
    // Try searching by name if handle search fails
    const existingManagerNameQuery = await db.collection('managers')
      .where('name', '==', managerName)
      .limit(1)
      .get();
    if (!existingManagerNameQuery.empty) {
      existingManagerByName = existingManagerNameQuery.docs[0];
    }
  }

  let managerData;
  
  if (!existingManagerQuery.empty) {
    // Use existing manager found by handle
    const existingDoc = existingManagerQuery.docs[0];
    managerData = { id: existingDoc.id, ...existingDoc.data() };
    console.log(`✅ Found existing manager by handle: ${managerData.id}`);
  } else if (existingManagerByName) {
    // Use existing manager found by name
    managerData = { id: existingManagerByName.id, ...existingManagerByName.data() };
    console.log(`✅ Found existing manager by name: ${managerData.id}`);
  } else {
    // Create new manager with correct ID format
    const managerId = `manager_${managerName.replace(/\s+/g, '_').toLowerCase()}`;
    const managerRef = db.collection('managers').doc(managerId);
    const managerDoc = await managerRef.get();
    
    if (!managerDoc.exists) {
      managerData = {
        id: managerId,
        handle: managerName,
        name: managerName,
        type: type,
        commissionRate: type === 'LIVE' ? 0.30 : 0.35,
        email: `${managerName.replace(/\s+/g, '_').toLowerCase()}@manager.com`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        batchId: batchId
      };
      await managerRef.set(managerData);
      console.log(`👥 Created new ${type} manager: ${managerName} with ID: ${managerId}`);
    } else {
      managerData = { id: managerId, ...managerDoc.data() };
      await managerRef.update({ handle: managerName });
      console.log(`✅ Updated existing manager: ${managerId}`);
    }
  }
  
  managerCache.set(cacheKey, managerData);
  return managerData;
}

// Optimized creator caching function
async function getOrCreateCreatorCached(creatorCache, creatorId, creatorName, handle, batchId) {
  const cacheKey = handle.replace(/\s+/g, '_').toLowerCase();
  if (creatorCache.has(cacheKey)) {
    return creatorCache.get(cacheKey);
  }

  const creatorDocId = `creator_${cacheKey}`;
  const creatorRef = db.collection('creators').doc(creatorDocId);
  const creatorDoc = await creatorRef.get();
  
  let creatorData;
  if (!creatorDoc.exists) {
    creatorData = {
      id: creatorDocId,
      creatorId: creatorId,
      name: creatorName,
      handle: handle,
      email: `${cacheKey}@creator.com`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      batchId: batchId
    };
    await creatorRef.set(creatorData);
  } else {
    creatorData = { id: creatorDocId, ...creatorDoc.data() };
  }
  
  creatorCache.set(cacheKey, creatorData);
  return creatorData;
}

// OPTIMIZED COMMISSION CALCULATION with Batch Processing
async function processCommissionDataOptimized(rows, batchId, requestPeriod) {
  console.log(`🔄 Processing ${rows.length} rows for batch ${batchId} with period: ${requestPeriod}`);
  
  let processedCount = 0;
  let newCreators = 0;
  let newManagers = 0;
  let transactionCount = 0;

  // Initialize progress tracking
  await updateProgress(batchId, 'INITIALIZING', 'Setting up processing...', 0, rows.length);

  // Manager and creator caching to avoid redundant queries
  const managerCache = new Map();
  const creatorCache = new Map();
  
  // Batch processing configuration
  const BATCH_SIZE = 50; // Process in smaller chunks for better responsiveness
  const WRITE_BATCH_SIZE = 25; // Firestore batch write limit consideration
  
  // Prepare batch operations
  const pendingWrites = [];
  
  try {
    // Process rows in chunks
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const chunkEnd = Math.min(i + BATCH_SIZE, rows.length);
      
      await updateProgress(batchId, 'PROCESSING', `Processing rows ${i + 1}-${chunkEnd}...`, i, rows.length);
      
      // Process each row in the chunk
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const actualIndex = i + j;
        
        try {
          if (!row || row.length < 19) {
            console.log(`⚠️ Skipping incomplete row ${actualIndex + 1}:`, row);
            continue;
          }

          // Extract row data - USE REQUEST PERIOD INSTEAD OF EXCEL DATA
          const period = requestPeriod; // ✅ Use parameter instead of row[0]
          const creatorId = row[1];
          const creatorName = row[2];
          const handle = row[3];
          const liveManagerName = row[4];
          const groupName = row[5];
          const teamManagerName = row[6];
          
          // Commission calculations
          const grossAmount = parseFloat(row[12]) || 0;
          
          // Milestone deductions logic
          const deductions = [];
          if (row[13] === '300' || row[13] === 300) deductions.push(300);
          if (row[14] === '1000' || row[14] === 1000) deductions.push(1000);
          if (row[15] === '240' || row[15] === 240) deductions.push(240);
          if (row[18] === '150' || row[18] === 150) deductions.push(150);
          
          const totalDeductions = deductions.reduce((sum, val) => sum + val, 0);
          const netForCommission = grossAmount - totalDeductions;
          
          // Milestone bonus checks
          const hasS = row[18] === '150' || row[18] === 150;
          const hasN = row[13] === '300' || row[13] === 300;
          const hasO = row[14] === '1000' || row[14] === 1000;
          const hasP = row[15] === '240' || row[15] === 240;
          
          const liveMilestoneBonuses = {
            S: hasS ? 75 : 0,
            N: hasN ? 150 : 0,
            O: hasO ? 400 : 0,
            P: hasP ? 100 : 0
          };
          
          const teamMilestoneBonuses = {
            S: hasS ? 80 : 0,
            N: hasN ? 165 : 0,
            O: hasO ? 450 : 0,
            P: hasP ? 120 : 0
          };

          if (!creatorName || grossAmount <= 0) {
            console.log(`⚠️ Skipping invalid row ${actualIndex + 1}: ${creatorName}, gross: ${grossAmount}`);
            continue;
          }

          // Use cached functions for creators and managers
          const creatorData = await getOrCreateCreatorCached(creatorCache, creatorId, creatorName, handle, batchId);
          if (!creatorCache.has(handle.replace(/\s+/g, '_').toLowerCase())) {
            newCreators++;
          }

          const liveManagerData = await getOrCreateManagerCached(managerCache, liveManagerName, 'LIVE', batchId);
          const teamManagerData = await getOrCreateManagerCached(managerCache, teamManagerName, 'TEAM', batchId);
          
          if (liveManagerData && !managerCache.has(`LIVE_${liveManagerName.toLowerCase()}`)) {
            newManagers++;
          }
          if (teamManagerData && !managerCache.has(`TEAM_${teamManagerName.toLowerCase()}`)) {
            newManagers++;
          }

          // Calculate commissions
          const liveManagerBaseCommission = liveManagerData && netForCommission > 0 ? netForCommission * 0.30 : 0;
          const teamManagerBaseCommission = teamManagerData && netForCommission > 0 ? netForCommission * 0.35 : 0;
          
          // Create transaction data
          const transactionId = `trans_${batchId}_${actualIndex}`;
          const transactionData = {
            id: transactionId,
            creatorId: creatorData.id,
            creatorName: creatorName,
            creatorHandle: handle,
            period: period, // ✅ Now uses the correct period parameter
            grossAmount: grossAmount,
            bonusSum: totalDeductions,
            net: netForCommission,
            liveMilestoneBonuses: liveMilestoneBonuses,
            teamMilestoneBonuses: teamMilestoneBonuses,
            liveManagerId: liveManagerData?.id || null,
            liveManagerName: liveManagerName,
            teamManagerId: teamManagerData?.id || null,
            teamManagerName: teamManagerName,
            baseCommission: liveManagerBaseCommission,
            batchId: batchId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            calculationVersion: 'OPTIMIZED_v1.1_FIXED_PERIOD'
          };

          // Add to pending writes
          pendingWrites.push({
            collection: 'transactions',
            doc: transactionId,
            data: transactionData
          });

          // Create bonus entries for managers
          if (liveManagerBaseCommission > 0) {
            pendingWrites.push({
              collection: 'bonuses',
              doc: `bonus_live_${actualIndex}_${batchId}`,
              data: {
                managerId: liveManagerData.id,
                managerHandle: liveManagerName,
                managerName: liveManagerName,
                managerType: 'LIVE',
                amount: liveManagerBaseCommission,
                type: 'BASE_COMMISSION',
                basedOnNet: netForCommission,
                commissionRate: 0.30,
                creatorId: creatorData.id,
                creatorName: creatorName,
                transactionId: transactionId,
                batchId: batchId,
                period: period, // ✅ Now uses the correct period parameter
                month: period,
                calculatedAt: admin.firestore.FieldValue.serverTimestamp()
              }
            });
          }

          if (teamManagerBaseCommission > 0) {
            pendingWrites.push({
              collection: 'bonuses',
              doc: `bonus_team_${actualIndex}_${batchId}`,
              data: {
                managerId: teamManagerData.id,
                managerHandle: teamManagerName,
                managerName: teamManagerName,
                managerType: 'TEAM',
                amount: teamManagerBaseCommission,
                type: 'BASE_COMMISSION',
                basedOnNet: netForCommission,
                commissionRate: 0.35,
                creatorId: creatorData.id,
                creatorName: creatorName,
                transactionId: transactionId,
                batchId: batchId,
                period: period, // ✅ Now uses the correct period parameter
                month: period,
                calculatedAt: admin.firestore.FieldValue.serverTimestamp()
              }
            });
          }

          // Add milestone bonuses for live manager
          const milestoneTypes = ['S', 'N', 'O', 'P'];
          milestoneTypes.forEach(type => {
            if (liveMilestoneBonuses[type] > 0) {
              pendingWrites.push({
                collection: 'bonuses',
                doc: `bonus_live_${type}_${actualIndex}_${batchId}`,
                data: {
                  managerId: liveManagerData.id,
                  managerHandle: liveManagerName,
                  managerName: liveManagerName,
                  managerType: 'LIVE',
                  amount: liveMilestoneBonuses[type],
                  type: `MILESTONE_${type}`,
                  creatorId: creatorData.id,
                  creatorName: creatorName,
                  transactionId: transactionId,
                  batchId: batchId,
                  period: period, // ✅ Now uses the correct period parameter
                  month: period,
                  calculatedAt: admin.firestore.FieldValue.serverTimestamp()
                }
              });
            }
          });

          // Add milestone bonuses for team manager
          milestoneTypes.forEach(type => {
            if (teamMilestoneBonuses[type] > 0) {
              pendingWrites.push({
                collection: 'bonuses',
                doc: `bonus_team_${type}_${actualIndex}_${batchId}`,
                data: {
                  managerId: teamManagerData.id,
                  managerHandle: teamManagerName,
                  managerName: teamManagerName,
                  managerType: 'TEAM',
                  amount: teamMilestoneBonuses[type],
                  type: `MILESTONE_${type}`,
                  creatorId: creatorData.id,
                  creatorName: creatorName,
                  transactionId: transactionId,
                  batchId: batchId,
                  period: period, // ✅ Now uses the correct period parameter
                  month: period,
                  calculatedAt: admin.firestore.FieldValue.serverTimestamp()
                }
              });
            }
          });

          transactionCount++;
          processedCount++;

        } catch (rowError) {
          console.error(`❌ Error processing row ${actualIndex + 1}:`, rowError);
          console.error('Row data:', row);
        }
      }
      
      // Execute batch writes when we have enough operations
      if (pendingWrites.length >= WRITE_BATCH_SIZE) {
        await updateProgress(batchId, 'WRITING', `Writing ${pendingWrites.length} records to database...`, i, rows.length);
        await executeBatchWrites(pendingWrites.splice(0, WRITE_BATCH_SIZE));
      }
    }
    
    // Execute remaining batch writes
    if (pendingWrites.length > 0) {
      await updateProgress(batchId, 'WRITING', `Writing final ${pendingWrites.length} records...`, rows.length, rows.length);
      await executeBatchWrites(pendingWrites);
    }

    await updateProgress(batchId, 'COMPLETED', 'Processing completed successfully!', rows.length, rows.length);

    console.log(`✅ OPTIMIZED Commission processing completed:`,
      `${processedCount} processed, ${newCreators} new creators, ${newManagers} new managers, ${transactionCount} transactions`);
    
    return { processedCount, newCreators, newManagers, transactionCount };
    
  } catch (error) {
    console.error('❌ processCommissionDataOptimized error:', error);
    await updateProgress(batchId, 'ERROR', `Processing failed: ${error.message}`, 0, rows.length);
    throw error;
  }
}

// Execute batch writes efficiently
async function executeBatchWrites(writeOperations) {
  const batch = db.batch();
  
  writeOperations.forEach(op => {
    const ref = db.collection(op.collection).doc(op.doc);
    batch.set(ref, op.data);
  });
  
  try {
    await batch.commit();
    console.log(`✅ Batch write completed: ${writeOperations.length} operations`);
  } catch (error) {
    console.error('❌ Batch write failed:', error);
    throw error;
  }
}

module.exports = {
  processCommissionDataOptimized,
  updateProgress
}; 