/* ratio-engine.js — the financial ratios and the cash-conversion cycle.
 *
 * The engine exists so the ratio CARDS, the quarterly TREND table and the
 * Excel export all compute from one place. Before it was extracted they each
 * had their own copy and disagreed, which is the failure mode worth guarding:
 * a ratio that is merely wrong gets questioned, but two screens showing
 * different numbers for the same quarter destroys trust in all of them.
 *
 * The arithmetic under test is annualisation. A trial balance states the P&L
 * cumulatively from the start of the fiscal year, so June holds six months of
 * revenue. Turning that into "days" needs the month count, and every
 * off-by-one there lands straight on a published KPI.
 */
'use strict';
const { suite, loadApp, row } = require('./helpers.js');
const { RULEBOOK, FS, RatioEngine } = loadApp();

const { ok, near, eq, done } = suite('ratio-engine.js — ratios and cash cycle');
const { monthsFromKey, shiftMonthKey, computeTabMetrics, RATIO_SPEC, unreachableGroups } = RatioEngine;

// --- period keys ---------------------------------------------------------
eq(monthsFromKey('2026-01'), 1, 'January is one month of cumulative P&L');
eq(monthsFromKey('2026-06'), 6, 'June is six');
eq(monthsFromKey('2026-12'), 12, 'December is a full year');
eq(monthsFromKey(''), null, 'no period key means no month count, and null rather than 0');
eq(monthsFromKey('nonsense'), null, 'and neither does a key that is not a period');

eq(shiftMonthKey('2026-06', -1), '2026-05', 'one month back');
eq(shiftMonthKey('2026-01', -1), '2025-12', 'back across a year boundary');
eq(shiftMonthKey('2025-12', 1), '2026-01', 'forward across a year boundary');
eq(shiftMonthKey('2026-06', -12), '2025-06', 'a year back is the same month');
eq(shiftMonthKey('', -1), null, 'an empty key shifts to nothing, not to NaN');

// --- the rulebook can actually reach every group the ratios ask for ------
/* Every ratio names the groups it sums. If the rulebook is edited and a
   group is renamed, the ratio silently becomes zero — no error, just a KPI
   that quietly reads 0.0 forever. This is the check that catches it, and it
   runs against the real rulebook rather than a fixture. */
const unreachable = unreachableGroups();
eq(unreachable.length, 0,
   `every group the ratios sum exists in the rulebook${unreachable.length ? ' — missing: ' + unreachable.join(', ') : ''}`);

// --- the cash-conversion cycle -------------------------------------------
const codeFor = pred => {
  const hit = Object.entries(RULEBOOK.rules).find(([, r]) => pred(r));
  if (!hit) throw new Error('rulebook has no account matching the test predicate');
  return hit[0];
};
const arCode = codeFor(r => r.section === 'Current Assets' && /receivab/i.test(r.group));
const invCode = codeFor(r => r.section === 'Current Assets' && /inventor|สินค้า/i.test(r.group));
const apCode = codeFor(r => r.section === 'Current Liabilities' && /payable/i.test(r.group));
const cashCode = codeFor(r => r.section === 'Current Assets' && /cash/i.test(r.group));
const eqCode = codeFor(r => r.section === 'Equity' && !/retain|profit|จัดสรร/i.test(r.group));
const revCode = codeFor(r => r.section === 'Revenue');
const cogsCode = codeFor(r => r.section === 'Cost of Sales');

/* Six months (a June close) of a book chosen so the days come out round:
     revenue 7,300 over 6 months -> 14,600/yr -> 40/day; AR 1,200 -> 30 days
     cost    3,650 over 6 months ->  7,300/yr -> 20/day; INV 600 -> 30 days
                                                          AP 800 -> 40 days
     CCC = 30 + 30 - 40 = 20 days                                          */
const g = FS.grouped([
  row(cashCode, 'Cash', 5000),
  row(arCode, 'Trade receivable', 1200),
  row(invCode, 'Inventory', 600),
  row(apCode, 'Trade payable', -800),
  row(eqCode, 'Share capital', -2350),
  row(revCode, 'Sales', -7300),
  row(cogsCode, 'Cost of goods sold', 3650),
]);
const bs = FS.buildBS(g), pl = FS.buildPL(g);
near(bs.diff, 0, 'ratio fixture balances');

/* A metric is {value, formula, base}, not a bare number: the cards show the
   formula next to the figure so an accountant can see how it was derived,
   and Excel exports it. `v` reads just the figure. */
const v = x => (x && typeof x === 'object' ? x.value : x);

const m = computeTabMetrics('th', bs, pl, null, { periodMonths: 6 });
ok(m, 'computeTabMetrics returns a metric set');
ok(m.arDays && typeof m.arDays === 'object' && 'formula' in m.arDays,
   'each metric carries the formula it was derived from, not just a number');
near(v(m.arDays), 30, 'AR days annualises the six-month revenue');
near(v(m.invDays), 30, 'inventory days annualises the six-month cost');
near(v(m.apDays), 40, 'AP days annualises the six-month cost');
near(v(m.ccc), 20, 'cash conversion cycle = AR + inventory - AP');
near(v(m.ccc), v(m.arDays) + v(m.invDays) - v(m.apDays), 'and it is exactly that sum, not a separate calculation');

/* The same balances read as a TWELVE-month close describe a company turning
   over twice as slowly per baht of annual revenue, so every day count
   doubles. This is the off-by-one guard: a month count read from the wrong
   place would leave these unchanged. */
const m12 = computeTabMetrics('th', bs, pl, null, { periodMonths: 12 });
near(v(m12.arDays), 60, 'twelve months of the same revenue halves the daily rate, doubling AR days');
near(v(m12.ccc), 40, 'and the whole cycle doubles with it');

// --- liquidity and leverage ---------------------------------------------
// current assets 6,800 / current liabilities 800
near(v(m.currentRatio), 8.5, 'current ratio = current assets / current liabilities');
ok(v(m.quickRatio) < v(m.currentRatio), 'the quick ratio excludes inventory, so it is the smaller of the two');

// --- a zero denominator must not become Infinity on a card ---------------
const noSales = FS.grouped([
  row(cashCode, 'Cash', 1000),
  row(arCode, 'Trade receivable', 500),
  row(eqCode, 'Share capital', -1500),
]);
const mz = computeTabMetrics('th', FS.buildBS(noSales), FS.buildPL(noSales), null, { periodMonths: 6 });
ok(v(mz.arDays) == null || isFinite(v(mz.arDays)), 'no revenue yields null or a finite AR days, never Infinity');
ok(v(mz.ccc) == null || isFinite(v(mz.ccc)), 'and the cycle stays finite too');

// --- the spec the pages render from --------------------------------------
ok(RATIO_SPEC.length > 0, 'there is a ratio spec to render');
ok(RATIO_SPEC.every(r => r.key && r.label && r.group), 'every ratio has a key, a label and a group');
const twOnly = RATIO_SPEC.filter(r => r.only === 'tw');
ok(twOnly.length > 0, 'at least one ratio is Taiwan-only');
ok(twOnly.every(r => r.key !== 'ccc'), 'and the cash conversion cycle is not one of them — every tab shows it');

done();
