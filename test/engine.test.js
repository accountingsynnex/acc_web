/* Engine smoke test — parse a real entity TB, validate it, auto-group it.
   Run: node test/engine.test.js  */
const fs = require('fs');
const path = require('path');
const { RULEBOOK } = require('../engine/rulebook.js');
const { parseTB, validateTB, applyRulebook, toNumber, isCreditNatured, parseStatementReport } = require('../engine/group-engine.js');

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

// 6) toNumber must not mangle a real number — a native Excel cell (as
// opposed to text like "1,234.56") needs no cleanup, and running it through
// the string-cleanup path used to strip the "e" out of scientific notation,
// turning a formula's near-zero float residue (9e-12) into a real few-baht
// error at the scale trial balances are read at.
ok(Math.abs(toNumber(9.094947017729282e-12)) < 1e-6, `tiny float residue stays ~0 (got ${toNumber(9.094947017729282e-12)})`);
ok(toNumber(-2.5e-10) === -2.5e-10, 'negative scientific notation preserved');
ok(toNumber('1,234.56') === 1234.56, 'thousand separators still stripped from text');
ok(toNumber('(1,234)') === -1234, 'parenthesised negative still handled');

// 7) isCreditNatured — the same rule the synthetic sample generator uses
// (tools/make_sample_tb.py): liabilities/equity/revenue/other-income code
// ranges, plus a contra account named as one even inside an asset section.
ok(isCreditNatured('2110000', 'TRADE PAYABLE') === true, 'liability code is credit-natured');
ok(isCreditNatured('4101000', 'REVENUES FROM SALES') === true, 'revenue code is credit-natured');
ok(isCreditNatured('1110200', 'PETTY CASH') === false, 'asset code is not credit-natured');
ok(isCreditNatured('5100000', 'COST OF GOODS SOLD') === false, 'cost-of-sales code is not credit-natured');
ok(isCreditNatured('1139000', 'PROVISION FOR BAD DEBTS') === true, 'a contra-asset is credit-natured by name, despite its 1xxxxxx code');

// 8) parseStatementReport — a combined BS+P&L management report (seen in a
// real workbook, where one entity's own "TB" tab held this instead of a
// plain account-list export) states every account at its own natural
// positive magnitude rather than this app's raw debit+/credit- convention,
// with subtotal rows (a 1-2 digit group index in the code column) sitting
// above each group's real accounts. A minimal fixture of that shape:
const REPORT_FIXTURE = [
  ['SAMPLE COMPANY LIMITED'],
  ['THAI BAHT'],
  [],
  ['INCOME STATEMENT (SYNNEX FORMAT)', , , , , , , , , 'CY-YTD'],
  ['For the 3 Months ended 01/03/2025'],
  [, , , 45747, , 'SALE', , 'ADMIN', , 'Y2025'],   // 45747 = 2025-03-31 as an Excel day-serial
  ['Operating Revenue'],
  [4101000, 'REVENUES FROM SALES', , 1000, , 1000, , 0, , 1000],
  [5100000, 'COST OF GOODS SOLD', , 1000, , 1000, , 0, , 1000],
  [1, 'Cash and equivalents', , 500, , 500, , 0, , 500],   // group subtotal — must be skipped, not read as an account
  [1110200, 'PETTY CASH', , 500, , 500, , 0, , 500],
  [2110000, 'TRADE PAYABLE', , 500, , 0, , 500, , 500],
];
const statementRows = parseStatementReport(REPORT_FIXTURE);
ok(statementRows && statementRows.rows.length === 4, `read ${statementRows ? statementRows.rows.length : 0} accounts, skipping the group-subtotal row`);
const rev = statementRows && statementRows.rows.find(r => r.code === '4101000');
ok(rev && rev.closing === -1000, `revenue flipped to raw credit convention (got ${rev ? rev.closing : '?'})`);
const cogs = statementRows && statementRows.rows.find(r => r.code === '5100000');
ok(cogs && cogs.closing === 1000, `cost of sales kept as-is, no flip (got ${cogs ? cogs.closing : '?'})`);
const cash = statementRows && statementRows.rows.find(r => r.code === '1110200');
ok(cash && cash.closing === 500, `asset kept as-is, no flip (got ${cash ? cash.closing : '?'})`);
const ap = statementRows && statementRows.rows.find(r => r.code === '2110000');
ok(ap && ap.closing === -500, `liability flipped to raw credit convention (got ${ap ? ap.closing : '?'})`);
ok(statementRows && Math.abs(statementRows.rows.reduce((s, r) => s + r.closing, 0)) < 1, 'fixture nets to zero once flipped');

// A sheet with no date-bearing header at all isn't this report — must not
// be mistaken for one just because it also fails the normal header search.
ok(parseStatementReport([['just', 'some', 'text'], ['no', 'dates', 'here']]) === null, 'a non-report sheet returns null, not a guess');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
