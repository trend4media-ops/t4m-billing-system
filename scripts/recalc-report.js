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

function isActive(v){
  if (v === undefined || v === null || v === '') return false;
  const n = parseEuro(v);
  if (n > 0) return true;
  const s = String(v).trim();
  return !!s && !/^0+(\.0+)?$/.test(s.replace(/,/g,'.'));
}

const filePath = path.resolve(__dirname, '..', ' Neu_Task_202506_UTC+0_2025_07_29_22_14_15.xlsx');
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

const MILESTONE_DEDUCTIONS = { N:300, O:1000, P:240, S:150 };
const MILESTONE_BONUSES = { live: {S:75,N:150,O:400,P:100}, team:{S:80,N:165,O:450,P:120} };

let totalGross=0, totalNet=0, totalBase=0, totalMilestones=0;
let tx=0; let managers=new Map();

for(let i=1;i<rows.length;i++){
  const r = rows[i];
  if(!r || (!r[4] && !r[6])) continue;
  const liveManager = r[4] && String(r[4]).trim();
  const teamManager = r[6] && String(r[6]).trim();
  const type = liveManager ? 'live':'team';
  const mgr = (liveManager||teamManager)||'unknown';
  const gross = parseEuro(r[12]);
  if(!(gross>0)) continue;
  const flags = { N:isActive(r[13]), O:isActive(r[14]), P:isActive(r[15]), S:isActive(r[18]) };
  const deductions = (flags.N?MILESTONE_DEDUCTIONS.N:0)+(flags.O?MILESTONE_DEDUCTIONS.O:0)+(flags.P?MILESTONE_DEDUCTIONS.P:0)+(flags.S?MILESTONE_DEDUCTIONS.S:0);
  const net = Math.max(0, gross - deductions);
  const rate = type==='live'?0.30:0.35;
  const base = net * rate;
  const bonusRates = MILESTONE_BONUSES[type];
  const mile = (flags.S?bonusRates.S:0)+(flags.N?bonusRates.N:0)+(flags.O?bonusRates.O:0)+(flags.P?bonusRates.P:0);
  totalGross += gross; totalNet += net; totalBase += base; totalMilestones += mile; tx++;
  const k = mgr.toLowerCase();
  if(!managers.has(k)) managers.set(k,{type, gross:0, net:0, base:0, mile:0, count:0});
  const m = managers.get(k); m.gross+=gross; m.net+=net; m.base+=base; m.mile+=mile; m.count+=1;
}

function euro(n){return new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Math.round(n*100)/100)}
console.log({
  rows: tx,
  totalRevenue: euro(totalGross),
  totalNet: euro(totalNet),
  baseCommissions: euro(totalBase),
  milestoneBonuses: euro(totalMilestones),
  managers: managers.size
}); 