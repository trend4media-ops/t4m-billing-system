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

function eq(v, expected) {
  const n = parseEuro(v);
  return Math.round(n * 100) === Math.round(expected * 100);
}

const filePath = path.resolve(__dirname, '..', ' Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx');
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

const DED = { N:300, O:1000, P:240, S:150 };
const PAY = { live: { S:75, N:150, O:400, P:100 }, team: { S:80, N:165, O:450, P:120 } };

function euro(n){ return (Math.round(n*100)/100).toFixed(2); }

// Header
console.log([
  'row','managerType','manager','gross','N','O','P','S','deductions','net','base','bonusS','bonusN','bonusO','bonusP','total'
].join(','));

let processed=0; let totalGross=0, totalNet=0, totalBase=0, totalBonus=0, totalTotal=0;
for (let i=1;i<rows.length;i++){
  const r = rows[i];
  if (!r) continue;
  const liveManager = r[4] && String(r[4]).trim();
  const teamManager = r[6] && String(r[6]).trim();
  const manager = (liveManager || teamManager || '').trim();
  if (!manager) continue;
  const type = liveManager ? 'live' : 'team';
  const gross = parseEuro(r[12]);
  if (!(gross>0)) continue;
  const N = eq(r[13], 300) ? 1 : 0;
  const O = eq(r[14], 1000) ? 1 : 0;
  const P = eq(r[15], 240) ? 1 : 0;
  const S = eq(r[18], 150) ? 1 : 0;
  const deductions = N*DED.N + O*DED.O + P*DED.P + S*DED.S;
  const net = Math.max(0, gross - deductions);
  const rate = type === 'live' ? 0.30 : 0.35;
  const base = net * rate;
  const bonusS = S ? PAY[type].S : 0;
  const bonusN = N ? PAY[type].N : 0;
  const bonusO = O ? PAY[type].O : 0;
  const bonusP = P ? PAY[type].P : 0;
  const total = base + bonusS + bonusN + bonusO + bonusP;
  console.log([
    i+1, type, '"'+manager.replace(/"/g,'""')+'"', euro(gross), N, O, P, S, euro(deductions), euro(net), euro(base), euro(bonusS), euro(bonusN), euro(bonusO), euro(bonusP), euro(total)
  ].join(','));
  processed++; totalGross+=gross; totalNet+=net; totalBase+=base; totalBonus+=(bonusS+bonusN+bonusO+bonusP); totalTotal+=total;
}

console.error(`Processed rows: ${processed}, Gross=${euro(totalGross)}, Net=${euro(totalNet)}, Base=${euro(totalBase)}, Bonuses=${euro(totalBonus)}, Total=${euro(totalTotal)}`); 