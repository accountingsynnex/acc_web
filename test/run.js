/* Test runner.
 *
 * Runs each suite in its own child process, so a module that sets globals
 * (and all of them do — that is how the browser loads them) cannot leak into
 * the next suite and make a failure depend on file order.
 *
 *   node test/run.js            unit suites, then the browser smoke test
 *   node test/run.js --unit     unit suites only (no browser needed)
 */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const UNIT = [
  'engine.test.js',
  'store.test.js',
  'fs.test.js',
  'ratio-engine.test.js',
  'cashflow-engine.test.js',
  'anomaly-engine.test.js',
  'export-xlsx.test.js',
];

const unitOnly = process.argv.includes('--unit');
const files = UNIT.slice();
if (!unitOnly) files.push('browser.test.js', 'design.test.js');

const failed = [];
for (const f of files) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.log(`\n(skipped ${f} — not present)`); continue; }
  const r = spawnSync(process.execPath, [p], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

console.log('');
if (failed.length) {
  console.log(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`All suites passed (${files.length}).`);
