#!/usr/bin/env node

/**
 * 🔍 EXCEL COLUMN ANALYSIS
 * Analyzes what values are actually in milestone columns
 */

const xlsx = require('xlsx');
const fs = require('fs');

console.log('🔍 EXCEL MILESTONE COLUMN ANALYSIS');
console.log('==================================');

try {
  const xlsxFiles = fs.readdirSync('.').filter(f => f.endsWith('.xlsx'));
  const excelFile = xlsxFiles.find(f => f.startsWith('Neu_Task_202506')) || xlsxFiles[0];
  
  console.log(`📁 Analyzing file: ${excelFile}`);
  
  const workbook = xlsx.readFile(excelFile);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON, starting from row 2 (skip header)
  const jsonData = xlsx.utils.sheet_to_json(worksheet, { 
    header: 1,
    range: 1 // Skip first row (header)
  });

  console.log(`📊 Found ${jsonData.length} rows\n`);

  // Analyze milestone columns
  const columnAnalysis = {
    S: { index: 18, name: 'S (Half-Milestone)', values: new Set() },
    N: { index: 13, name: 'N (Milestone 1)', values: new Set() },
    O: { index: 14, name: 'O (Milestone 2)', values: new Set() },
    P: { index: 15, name: 'P (Retention)', values: new Set() }
  };

  // Collect all unique values in milestone columns
  jsonData.forEach((row, index) => {
    if (row && row.length >= 19) {
      Object.keys(columnAnalysis).forEach(key => {
        const colIndex = columnAnalysis[key].index;
        const value = row[colIndex];
        if (value !== undefined && value !== null && value !== '') {
          columnAnalysis[key].values.add(String(value));
        }
      });
    }
  });

  // Display analysis
  console.log('📊 MILESTONE COLUMN VALUES ANALYSIS:');
  console.log('=====================================');
  
  Object.entries(columnAnalysis).forEach(([key, info]) => {
    console.log(`\n${key} - ${info.name} (Column Index ${info.index}):`);
    console.log(`   Unique Values Found: ${info.values.size}`);
    
    if (info.values.size > 0) {
      const sortedValues = Array.from(info.values).sort();
      console.log(`   Values: ${sortedValues.map(v => `"${v}"`).join(', ')}`);
      
      // Count occurrences
      const valueCounts = {};
      jsonData.forEach(row => {
        if (row && row[info.index] !== undefined && row[info.index] !== null && row[info.index] !== '') {
          const val = String(row[info.index]);
          valueCounts[val] = (valueCounts[val] || 0) + 1;
        }
      });
      
      console.log(`   Counts:`);
      Object.entries(valueCounts).forEach(([val, count]) => {
        const percentage = ((count / jsonData.length) * 100).toFixed(1);
        console.log(`     "${val}": ${count} times (${percentage}%)`);
      });
    } else {
      console.log(`   No values found in this column`);
    }
  });

  // Show first 5 rows as sample
  console.log('\n📋 SAMPLE DATA (First 5 rows):');
  console.log('===============================');
  
  jsonData.slice(0, 5).forEach((row, index) => {
    if (row && row.length >= 19) {
      console.log(`\nRow ${index + 1}:`);
      console.log(`  Creator: ${row[2]} (${row[3]})`);
      console.log(`  Gross (M): ${row[12]}`);
      console.log(`  N (13): "${row[13]}"`);
      console.log(`  O (14): "${row[14]}"`);
      console.log(`  P (15): "${row[15]}"`);
      console.log(`  S (18): "${row[18]}"`);
    }
  });

} catch (error) {
  console.error('❌ Error:', error.message);
} 