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

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
