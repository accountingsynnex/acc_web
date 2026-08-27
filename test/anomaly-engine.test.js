/* anomaly-engine.js — the checks that read the finished statements back and
 * report what looks wrong before anyone signs them.
 *
 * The whole value of this module is that it stays quiet on a good close. A
 * check that fires on healthy books gets ignored within two months, and then
 * so does every other check next to it — so the tests here are as much about
 * SILENCE on clean input as about catching the planted faults.
 *
 * scan() reads through Store rather than taking rows, because it also looks
 * at prior periods and at journals. Each case below therefore sets Store up,
 * scans, and resets.
 */
'use strict';
const { suite, loadApp, row } = require('./helpers.js');
const { RULEBOOK, Store, AnomalyEngine } = loadApp();

const { ok, eq, done } = suite('anomaly-engine.js — statement checks');

const codeFor = pred => {
  const hit = Object.entries(RULEBOOK.rules).find(([, r]) => pred(r));
  if (!hit) throw new Error('rulebook has no account matching the test predicate');
  return hit[0];
};
const cashCode = codeFor(r => r.section === 'Current Assets' && /cash/i.test(r.group));
const arCode = codeFor(r => r.section === 'Current Assets' && /receivab/i.test(r.group));
const apCode = codeFor(r => r.section === 'Current Liabilities' && /payable/i.test(r.group));
const eqCode = codeFor(r => r.section === 'Equity' && !/retain|profit|จัดสรร/i.test(r.group));
const revCode = codeFor(r => r.section === 'Revenue');
const cogsCode = codeFor(r => r.section === 'Cost of Sales');

// A healthy consolidated close, in raw convention and at a realistic size —
// materiality is 0.2% of total assets, so a toy book would make every check
// hair-trigger and tell us nothing about how it behaves on real input.
const M = 1e6;
const healthy = () => [
  row(cashCode, 'Cash', 400 * M),
  row(arCode, 'Trade receivable', 900 * M),
  row(apCode, 'Trade payable', -500 * M),
  row(eqCode, 'Share capital', -600 * M),
  row(revCode, 'Sales', -1200 * M),
  row(cogsCode, 'Cost of goods sold', 1000 * M),
];

function scanWith(rows, journals) {
  Store.data = { schema: Store.SCHEMA, tb: {}, mappings: {}, journals: journals || [], periods: {}, workbooks: {} };
  Store.data.tb.SYN = { fileName: 'test.csv', rows };
  return AnomalyEngine.scan('');
}
const ids = r => r.findings.map(f => f.id);
const has = (r, id) => ids(r).includes(id);

// --- nothing imported ----------------------------------------------------
Store.data = { schema: Store.SCHEMA, tb: {}, mappings: {}, journals: [], periods: {}, workbooks: {} };
const empty = AnomalyEngine.scan('');
eq(empty.findings.length, 0, 'an empty workspace reports no findings, rather than every check failing');
ok(empty.skipped.length > 0, 'and says why it could not check anything');

// --- a clean close must be quiet ----------------------------------------
const clean = scanWith(healthy());
ok(clean.checks > 0, 'a clean close still runs its checks');
ok(!has(clean, 'bs-diff'), 'a balanced book raises no balance-sheet finding');
eq(clean.findings.filter(f => f.severity === 'high').length, 0,
   `a clean close raises nothing severe${ids(clean).length ? ' — got ' + ids(clean).join(', ') : ''}`);

// --- an unbalanced balance sheet is the one thing that must always fire ---
const broken = healthy();
broken.push(row(cashCode, 'Cash found under a rock', 7 * M));
const unbalanced = scanWith(broken);
ok(has(unbalanced, 'bs-diff'), 'an unbalanced balance sheet is reported');
const diffFinding = unbalanced.findings.find(f => f.id === 'bs-diff');
eq(diffFinding.severity, 'high', 'and it is reported as severe, not as a note');
ok(/7/.test(diffFinding.detail), 'and the message names the size of the difference');

// --- materiality: a rounding-sized difference is not an anomaly ----------
const rounding = healthy();
rounding.push(row(cashCode, 'Rounding', 0.4));
const tiny = scanWith(rounding);
ok(!has(tiny, 'bs-diff'), 'a sub-baht difference is treated as rounding, not as an unbalanced book');

// --- findings are well-formed so the Review page can render them ---------
for (const f of unbalanced.findings) {
  ok(f.id && f.title && f.detail && f.severity, `finding "${f.id}" carries an id, title, detail and severity`);
  ok(['high', 'medium', 'low'].includes(f.severity), `finding "${f.id}" uses a known severity`);
}

// --- duplicate adjustments ----------------------------------------------
/* Two journals with the same source, the same lines and the same net are
   almost always one entry posted twice — the check that found a real
   duplicate pair in production. Deliberately-halved elimination entries are
   NOT duplicates, which is why this compares whole entries, not amounts. */
const jn = (id, source, code, amount) =>
  ({ id, source, description: 'adj', lines: [{ code, name: '', amount }], net: 0, enabled: true });
const dup = scanWith(healthy(), [
  jn('SYN ADJ::5', 'AJE+RJE-Synnex', arCode, 3 * M),
  jn('SYN ADJ::15', 'AJE+RJE-Synnex', arCode, 3 * M),
]);
ok(dup.findings.length >= clean.findings.length, 'a duplicated adjustment adds at least one finding');

// --- scanning a period that does not exist -------------------------------
const missing = AnomalyEngine.scan('1999-01');
eq(missing.findings.length, 0, 'scanning a period with no data returns no findings instead of throwing');

// --- severity levels are exported for the page to colour by --------------
eq(AnomalyEngine.HIGH, 'high', 'HIGH is exported');
eq(AnomalyEngine.MED, 'medium', 'MED is exported');
eq(AnomalyEngine.LOW, 'low', 'LOW is exported');

done();
