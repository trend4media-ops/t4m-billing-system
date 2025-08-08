const xlsx = require('xlsx');
const path = require('path');

function parseEuro(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  let s = String(value ?? '').trim();
  if (!s) return 0;
  s = s.replace(/[€\s]/g, '');
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.');
  else if (s.includes(',')) s = s.replace(/,/g, '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

const filePath = path.resolve(__dirname, '..', ' Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx');
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
let sum = 0;
for (let i = 1; i < rows.length; i++) {
  const v = rows[i]?.[12];
  if (v === undefined || v === null || v === '') continue;
  sum += parseEuro(v);
}
console.log('SUM_GROSS_EUR', sum.toFixed(2)); 