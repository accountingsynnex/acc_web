/* fs.js — the balance sheet and P&L builder.
 *
 * This is the sign-convention boundary of the whole app, and the place a
 * mistake is most expensive: everything upstream works in the trial
 * balance's raw convention (debit positive, credit negative) and everything
 * a human reads is a positive magnitude. buildBS/buildPL flip liabilities,
 * equity and P&L on the way out. If that flip is ever wrong, the statements
 * still add up and still balance — they are just backwards, which is far
 * harder to notice than a crash.
 */
'use strict';
const { suite, loadApp, row } = require('./helpers.js');
const { RULEBOOK, Store, FS } = loadApp();

const { ok, near, eq, done } = suite('fs.js — statement builder');

// Pick real codes out of the rulebook so the fixture cannot drift away from
// the chart of accounts: whatever the rulebook says is a current asset today
// is what this test uses.
const codeIn = (statement, section) => {
  const hit = Object.entries(RULEBOOK.rules).find(([, r]) => r.statement === statement && r.section === section);
  if (!hit) throw new Error(`rulebook has no ${statement}/${section} account to test with`);
  return hit[0];
};
const ASSET_CODE = codeIn('BS', 'Current Assets');
const LIAB_CODE = codeIn('BS', 'Current Liabilities');
const EQ_CODE = codeIn('BS', 'Equity');
const REV_CODE = codeIn('PL', 'Revenue');
const COGS_CODE = codeIn('PL', 'Cost of Sales');

/* A balanced book in raw convention:
     assets   1,000 debit   -> +1000
     payables   400 credit  ->  -400
     equity     300 credit  ->  -300
     revenue    900 credit  ->  -900
     cost       600 debit   -> +600
   Assets 1000 = liabilities 400 + equity 300 + profit 300. */
const ROWS = [
  row(ASSET_CODE, 'Cash', 1000, 800),
  row(LIAB_CODE, 'Trade payable', -400, -350),
  row(EQ_CODE, 'Share capital', -300, -300),
  row(REV_CODE, 'Sales', -900, null),
  row(COGS_CODE, 'Cost of goods sold', 600, null),
];

Store.data.mappings = {};
const g = FS.grouped(ROWS);
ok(g, 'grouped() returns a result for a non-empty TB');

// --- P&L: everything reads as a positive magnitude -----------------------
const pl = FS.buildPL(g);
near(pl.revenue, 900, 'revenue prints positive, not the raw -900');
near(pl.cogs, -600, 'cost of sales prints negative (a deduction from revenue)');
near(pl.grossProfit, 300, 'gross profit = revenue + cost of sales');
near(pl.netProfit, 300, 'net profit = 900 - 600');

// --- Balance sheet -------------------------------------------------------
const bs = FS.buildBS(g);
near(bs.totalAssets, 1000, 'total assets print positive');
near(bs.totalLiab, 400, 'liabilities print positive, not the raw -400');
near(bs.totalEquity, 300, 'equity prints positive, not the raw -300');
near(bs.netProfit, 300, 'the P&L result is carried into equity');
near(bs.totalLE, 1000, 'liabilities + equity + profit');
near(bs.diff, 0, 'the balance sheet balances');

/* The property that actually matters, stated directly: in the raw
   convention a complete trial balance sums to zero, and the presented
   statement must therefore balance. Scaling every row keeps that true, so a
   flip applied to the wrong side would break this even where the fixture
   above happened to be symmetric. */
const scaled = ROWS.map(r => row(r.code, r.name, r.closing * 3.7, r.opening));
const bs2 = FS.buildBS(FS.grouped(scaled));
near(bs2.diff, 0, 'still balances when every figure is scaled', 0.0001);
near(bs2.totalAssets, 3700, 'assets scale with the input');

// --- Empty input is null, not a zeroed statement -------------------------
eq(FS.grouped([]), null, 'an empty TB returns null rather than an all-zero statement');

// --- A one-sided book must NOT balance -----------------------------------
// Guards against a builder that forces diff to 0 by construction: if this
// ever passes, the balance check on the Review page is meaningless.
const lopsided = FS.buildBS(FS.grouped([row(ASSET_CODE, 'Cash', 1000, null)]));
ok(Math.abs(lopsided.diff) > 1, 'an unbalanced TB reports a non-zero difference');

// --- A user override on the Mapping page must move the money -------------
Store.data.mappings = { [ASSET_CODE]: { statement: 'BS', section: 'Non-current Assets', group: 'Moved by hand' } };
const moved = FS.buildBS(FS.grouped(ROWS));
near(moved.totalAssets, 1000, 'a mapping override keeps total assets the same');
const nonCurrent = moved.assets.find(s => s.name === 'Non-current Assets');
ok(nonCurrent && nonCurrent.groups.some(x => x.group === 'Moved by hand'),
   'the override lands in the section it names');
Store.data.mappings = {};

done();
