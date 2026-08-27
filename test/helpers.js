/* Shared test helpers.
 *
 * Two jobs. First, a tiny assertion harness — this repo has no test runner
 * dependency on purpose, so that `node test/run.js` works on a clean
 * checkout with nothing installed and the tests keep running years from now
 * when today's runner has moved on.
 *
 * Second, `browserGlobals()`. app/ files are browser scripts: they run as an
 * IIFE and hang an object off `window`, and only engine/ files and a few
 * app/ ones also set module.exports. Requiring one in Node therefore needs
 * `global.window` to exist first. This sets up just enough of a browser for
 * the pure-logic modules — no DOM, because anything needing a DOM belongs in
 * the Playwright smoke test instead, where it gets a real one.
 */
'use strict';

function suite(title) {
  const state = { pass: 0, fail: 0, title };
  console.log(`\n${title}`);
  const ok = (cond, msg) => {
    if (cond) { state.pass++; console.log(`  ok   ${msg}`); }
    else { state.fail++; console.log(`  FAIL ${msg}`); }
    return !!cond;
  };
  // Money is compared to the satang, not to the float. Every figure here
  // comes from summing thousands of parsed decimals, so exact equality would
  // fail on representation alone while being wrong about nothing.
  const near = (a, b, msg, tol = 0.01) =>
    ok(Math.abs(a - b) <= tol, `${msg} (got ${fmt(a)}, want ${fmt(b)})`);
  const eq = (a, b, msg) =>
    ok(Object.is(a, b) || a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  const throws = (fn, msg) => {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    return ok(threw, msg);
  };
  /* Call at the end of a suite. Prints the tally and exits non-zero on any
     failure, which is what run.js and CI read — a suite that printed FAIL
     and still exited 0 would go green in CI, which is worse than no test. */
  const done = () => {
    console.log(`  ${state.fail ? 'FAILED' : 'passed'} — ${state.pass} ok, ${state.fail} failed`);
    process.exit(state.fail ? 1 : 0);
  };
  return { ok, near, eq, throws, done, state };
}

const fmt = n => typeof n === 'number' && isFinite(n)
  ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  : JSON.stringify(n);

/* A minimal browser for modules that only touch window/localStorage.
   localStorage is a real in-memory implementation rather than a stub that
   throws, because Store's persistence path is worth exercising: a test that
   never writes would not catch a change that breaks writing. */
function browserGlobals() {
  if (!global.window) global.window = global;
  if (!global.localStorage) {
    const mem = new Map();
    global.localStorage = {
      getItem: k => (mem.has(String(k)) ? mem.get(String(k)) : null),
      setItem: (k, v) => { mem.set(String(k), String(v)); },
      removeItem: k => { mem.delete(String(k)); },
      clear: () => mem.clear(),
      get length() { return mem.size; },
      key: i => [...mem.keys()][i] ?? null,
    };
  }
  return global;
}

/* Load the app's modules the way a page does, in the same order and with
   the same globals.

   Node's module scope is not the global scope, so a `function foo()` at the
   top of engine/group-engine.js becomes window.foo in a browser but stays
   private under require(). Anything that reads it as a global — fs.js calls
   applyRulebook(), anomaly-engine reads global.RatioEngine — would find
   nothing. Assigning the exports onto `global` here reproduces what the
   <script> tags do, so the modules under test run exactly as they ship.

   Order matters and mirrors the order in app/*.html: rulebook, then the
   group engine, then Store, then everything built on top. */
function loadApp() {
  browserGlobals();
  const { RULEBOOK } = require('../engine/rulebook.js');
  global.RULEBOOK = RULEBOOK;
  Object.assign(global, require('../engine/group-engine.js'));
  const { Store } = require('../app/store.js');
  global.Store = Store;
  const FS = require('../app/fs.js');
  global.FS = FS;
  const CashFlowEngine = require('../engine/cashflow-engine.js');
  global.CashFlowEngine = CashFlowEngine;
  const RatioEngine = require('../engine/ratio-engine.js');
  global.RatioEngine = RatioEngine;
  const AnomalyEngine = require('../engine/anomaly-engine.js');
  global.AnomalyEngine = AnomalyEngine;
  return { RULEBOOK, Store, FS, CashFlowEngine, RatioEngine, AnomalyEngine };
}

/* A trial-balance row as the parser produces one: raw convention, debit
   positive and credit negative. Assets and expenses are positive; liability,
   equity and revenue accounts are negative. */
const row = (code, name, closing, opening = null) => ({ code: String(code), name, closing, opening });

module.exports = { suite, browserGlobals, loadApp, row, fmt };
