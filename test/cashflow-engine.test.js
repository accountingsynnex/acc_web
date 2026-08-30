/* cashflow-engine.js — the indirect-method cash flow statement.
 *
 * Derived, not imported: nothing in a trial balance says "cash paid to
 * suppliers". The statement is reconstructed from the movement between the
 * opening and closing balance sheets plus the period's P&L. Two things are
 * worth pinning down because both fail silently:
 *
 *   1. the direction of a working-capital movement. A receivable that GREW
 *      consumed cash; getting that backwards yields a statement that still
 *      foots and is still wrong.
 *   2. `unexplained` must stay exactly what it claims to be — the part of
 *      the cash movement the sections do not account for. A change that
 *      quietly folded it into a named line would be worse than one that
 *      made it large.
 *
 * READ THIS BEFORE CHANGING THE FIXTURES. In this app a mid-year trial
 * balance keeps the period's result in the P&L accounts; FS.buildBS() adds
 * netProfit into total liabilities+equity separately, and the equity SECTION
 * holds only prior-year retained earnings. Verified against the fixture TBs:
 * their equity is share capital + retained + appropriated, with the current
 * result added on top. A fixture that also parks the profit in retained
 * earnings does not balance, and does not resemble real input.
 *
 * That model has a consequence this suite pins rather than hides — see
 * "inferred distribution" at the bottom, and KNOWN-LIMITATIONS.md.
 */
'use strict';
const { suite, loadApp, row } = require('./helpers.js');
const { RULEBOOK, FS, CashFlowEngine } = loadApp();

const { ok, near, eq, done } = suite('cashflow-engine.js — indirect cash flow');

const codeFor = pred => {
  const hit = Object.entries(RULEBOOK.rules).find(([, r]) => pred(r));
  if (!hit) throw new Error('rulebook has no account matching the test predicate');
  return hit[0];
};
const cashCode = codeFor(r => r.section === 'Current Assets' && /cash/i.test(r.group));
const arCode = codeFor(r => r.section === 'Current Assets' && /receivab/i.test(r.group));
const apCode = codeFor(r => r.section === 'Current Liabilities' && /payable/i.test(r.group));
const eqCode = codeFor(r => r.section === 'Equity' && !/retain|profit|จัดสรร/i.test(r.group));
const retainedCode = codeFor(r => r.group === 'Retained profit');
const revCode = codeFor(r => r.section === 'Revenue');

// Raw convention throughout: debit positive, credit negative.
const build = ({ cash, ar, ap, equity, revenue = 0, retained = 0 }) => FS.grouped([
  row(cashCode, 'Cash', cash),
  row(arCode, 'Trade receivable', ar),
  row(apCode, 'Trade payable', ap),
  row(eqCode, 'Share capital', equity),
  row(retainedCode, 'Retained earnings', retained),
  row(revCode, 'Sales', revenue),
]);
const shape = g => ({ bs: FS.buildBS(g), pl: FS.buildPL(g) });

/* Opening: cash 100, AR 200, AP 150, equity 150, nothing earned yet.
     assets 300 = liabilities 150 + equity 150
   Closing: profit 300 earned, AR up 50 (cash out), AP up 40 (cash in),
   so cash moves 300 - 50 + 40 = 290, to 390.
     assets 640 = liabilities 190 + equity 150 + profit 300                */
const open = shape(build({ cash: 100, ar: 200, ap: -150, equity: -150 }));
const close = shape(build({ cash: 390, ar: 250, ap: -190, equity: -150, revenue: -300 }));
near(open.bs.diff, 0, 'opening fixture balances');
near(close.bs.diff, 0, 'closing fixture balances');

const cf = CashFlowEngine.computeCashFlow(close.bs, close.pl, open.bs, open.pl);
ok(cf, 'computeCashFlow returns a statement');
near(cf.netProfit, 300, 'starts from the period net profit');

// --- the two identities that must always hold ---------------------------
near(cf.cashNow - cf.cashOpen, cf.netIncrease,
     'net increase is exactly the movement in cash on the balance sheet');
near(cf.netIncrease, 290, 'and that movement is the one the fixture describes');
near(cf.unexplained, cf.netIncrease - (cf.cfo + cf.cfi + cf.cff),
     'unexplained is precisely what the three sections do not account for');

// --- working-capital direction ------------------------------------------
/* Mirror the movements: AR falls 50 (releases cash), AP falls 40 (consumes
   it), so cash moves 300 + 50 - 40 = 310 instead of 290. If the sign of a
   working-capital movement were flipped, this figure would move the wrong
   way while everything still balanced. */
const close2 = shape(build({ cash: 410, ar: 150, ap: -110, equity: -150, revenue: -300 }));
near(close2.bs.diff, 0, 'mirrored fixture balances');
const cf2 = CashFlowEngine.computeCashFlow(close2.bs, close2.pl, open.bs, open.pl);
near(cf2.netIncrease, 310, 'a falling receivable releases cash instead of consuming it');
ok(cf2.netIncrease > cf.netIncrease, 'collecting receivables beats granting them, in cash terms');
const wcOf = (r, re) => (r.workingCapital.find(x => re.test(x.label)) || { value: 0 }).value;
ok(wcOf(cf, /ลูกหนี้|receivab/i) < 0, 'a receivable that grew is a cash outflow');
ok(wcOf(cf2, /ลูกหนี้|receivab/i) > 0, 'a receivable that shrank is a cash inflow');

// --- a book that did not move -------------------------------------------
const flat = CashFlowEngine.computeCashFlow(open.bs, open.pl, open.bs, open.pl);
near(flat.netIncrease, 0, 'an unchanged book moves no cash');
near(flat.netProfit, 0, 'and reports no profit');
near(flat.unexplained, 0, 'and explains all zero of it');
eq(flat.workingCapital.length, 0, 'and lists no working-capital movements at all');

// --- no opening position -------------------------------------------------
eq(CashFlowEngine.computeCashFlow(close.bs, close.pl, null, null), null,
   'no opening balance sheet returns null instead of a fabricated statement');

/* --- no inferred distribution -------------------------------------------
   The engine used to read the movement in retained earnings against net
   profit and call the shortfall a dividend. Given the model described at the
   top — the period's result sits in the P&L accounts, not in retained
   earnings — that shortfall was the whole period profit on every comparison
   this app produces, so the statement reported a distribution nobody had
   made and inflated the unexplained difference by the same amount.

   Removed on the finance team's call. These assertions exist so it cannot
   come back by accident: an inferred dividend is a number presented to
   readers of a statutory statement, and it has to be a real one.           */
eq(cf.financing.filter(r => /ปันผล|dividend/i.test(r.label)).length, 0,
   'no dividend is inferred from retained earnings not moving');
ok(cf.financing.every(r => Math.abs(Math.abs(r.value) - Math.abs(cf.netProfit)) > 0.01),
   'and no financing line happens to be the size of the whole period profit');

/* A real movement in retained earnings — an actual dividend, or an
   appropriation to legal reserve — now falls into `unexplained` rather than
   getting a line of its own. That is a deliberate trade, and disclosure
   rather than concealment: the identity below still holds, so the money is
   still on the statement, just not named. */
const openR = shape(build({ cash: 100, ar: 200, ap: -150, equity: -150 }));
const closeR = shape(build({ cash: 50, ar: 200, ap: -150, equity: -150, retained: 50 }));
near(closeR.bs.diff, 0, 'appropriation fixture balances');
const cfR = CashFlowEngine.computeCashFlow(closeR.bs, closeR.pl, openR.bs, openR.pl);
near(cfR.netIncrease, -50, 'the cash actually left');
near(cfR.unexplained, cfR.netIncrease - (cfR.cfo + cfR.cfi + cfR.cff),
     'and it is disclosed on the unexplained line rather than dropped');

done();
