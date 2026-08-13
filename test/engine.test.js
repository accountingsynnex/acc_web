/* Engine smoke test — parse a real entity TB, validate it, auto-group it.
   Run: node test/engine.test.js  */
const fs = require('fs');
const path = require('path');
const { RULEBOOK } = require('../engine/rulebook.js');
const { parseTB, validateTB, applyRulebook } = require('../engine/group-engine.js');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) failures++; };

const csv = fs.readFileSync(path.join(__dirname, 'TB_SVP_2026-06.csv'), 'utf8');

// 1) parse
const { rows, columns } = parseTB(csv);
ok(rows.length > 100, `parsed ${rows.length} TB rows`);
ok(columns.code !== -1 && columns.closing !== -1, 'detected code + closing columns');
ok(typeof rows[0].closing === 'number', 'closing balances parsed as numbers');

// 2) validate (a real TB nets to ~0 on signed closing balances)
const v = validateTB(rows, 5);
ok(v.balanced, `TB balanced — net closing ${v.netClosing.toFixed(2)}`);

// 3) auto-group against the rulebook
const res = applyRulebook(rows, RULEBOOK);
ok(res.stats.mappedPct >= 95, `auto-grouped ${res.stats.mappedPct}% (${res.stats.mapped}/${res.stats.total})`);
ok(res.stats.unmapped >= 1, `flagged ${res.stats.unmapped} new code(s) for review: ${res.unmapped.map(u => u.code).join(', ')}`);

// 4) grouped totals must equal the sum of their mapped rows (no leakage)
const mappedSum = res.lines.filter(l => l.status === 'mapped').reduce((s, l) => s + l.closing, 0);
const groupSum = Object.values(res.groups).reduce((s, v) => s + v, 0);
ok(Math.abs(mappedSum - groupSum) < 0.01, `group totals reconcile to mapped rows (Δ ${(mappedSum - groupSum).toExponential(2)})`);

// 5) a known account lands in the right group
const cashLine = res.lines.find(l => l.code === '1110200');
ok(cashLine && cashLine.rule && cashLine.rule.group === 'Cash in Hand',
   `1110200 auto-grouped to "${cashLine && cashLine.rule ? cashLine.rule.group : '?'}"`);

// 6) historical statement inputs: only the inputs, never the stated ratios,
//    and a quarter column that repeats the year's figures is dropped rather
//    than read as three months of a full year's revenue.
const FsHistory = require('../engine/fs-history.js');
const histSheet = [
  ['Ratios', 'Q1-26', 'Q2-26', 'Q3-26', '2026', 'KPI'],
  ['AR Days', 50, 51, 52, 53, 45],
  ['Cash cycle', 60, 61, 62, 63, 55],
  ['Information', 'Q1-26', 'Q2-26', 'Q3-26', '2026', null],
  ['Total assets', 1000, 1100, 1200, 1200, null],
  ['Total revenues', 500, 520, 540, 2000, null],
  ['Total COGS', 400, 420, 440, 1700, null],
  ['AR', 300, 310, 320, 320, null],
  ['Inventory', 200, 210, 220, 220, null],
  ['AP', 150, 160, 170, 170, null],
];
const hist = FsHistory.parseFsSheet(histSheet);
ok(hist && hist.labels.length === 4, `read ${hist ? hist.labels.length : 0} periods of inputs`);
ok(hist && hist.arDays === undefined && hist.ccc === undefined, 'stated ratios ignored — inputs only');
ok(hist && JSON.stringify(hist.months) === JSON.stringify([3, 3, 3, 12]),
   `month count per column ${hist ? hist.months.join('/') : '?'}`);
const dup = FsHistory.parseFsSheet(histSheet.map(r => r.slice(0, 5)).map((r, i) =>
  i === 0 || i === 3 ? r : r.map((c, j) => (j === 3 ? (typeof c === 'number' && i > 3 ? histSheet[i][4] : c) : c))));
ok(dup && dup.dropped >= 1, `dropped ${dup ? dup.dropped : 0} column(s) duplicating the year`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
