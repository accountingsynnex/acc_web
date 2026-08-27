/* Browser smoke test — the app actually opening and working.
 *
 * The unit suites cover the arithmetic; nothing there would notice a missing
 * <script> tag, a typo in a selector, a page that throws on load, or a build
 * stamp that only got bumped on half the pages. Those are exactly the
 * regressions this app is prone to, because there is no bundler to catch a
 * broken reference for us.
 *
 * It drives the real files over file://, the way the app is used, and fails
 * on any console error rather than only on a missing element — a page that
 * renders while throwing is not working.
 *
 *   node test/browser.test.js
 *
 * Needs Chromium. In CI that is `npx playwright install --with-deps chromium`.
 * If Playwright is not installed the suite SKIPS rather than fails, so a
 * clean checkout can still run `npm run test:unit` with nothing installed.
 */
'use strict';
const path = require('path');
const { suite } = require('./helpers.js');

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) {
  console.log('\nbrowser smoke test — SKIPPED (Playwright not installed; run `npm install`)');
  process.exit(0);
}

const APP = 'file://' + path.join(__dirname, '..', 'app') + '/';
const PAGES = ['import', 'tb', 'mapping', 'journals', 'consolidation',
  'statements', 'cashflow', 'ratios', 'costcenter', 'review'];

// The credential the app ships with, read from the config rather than
// hardcoded here so changing it does not silently break the smoke test.
const cfg = (() => {
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'app', 'auth-config.js'), 'utf8');
  global.window = global;
  new Function('window', src)(global);
  return global.AUTH_CONFIG;
})();
const PASSWORD = process.env.SMOKE_PASSWORD || 'syn134589';

(async () => {
  const { ok, eq, done } = suite('browser smoke test');
  /* SMOKE_CHROMIUM points at an already-installed Chromium, for machines
     that ship one (a container image, a locked-down build agent) instead of
     letting Playwright download its own. Unset in CI, which installs the
     matching revision itself. */
  const browser = await chromium.launch(
    process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on('dialog', d => d.accept());
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('requestfailed', r => {
    const u = r.url();
    if (!/favicon|data:/.test(u)) errors.push('REQFAIL ' + u.split('/').pop() + ' ' + (r.failure() || {}).errorText);
  });

  try {
    // --- the sign-in gate ---------------------------------------------
    await page.goto(APP + 'statements.html');
    await page.waitForTimeout(900);
    ok(/login\.html/.test(page.url()), 'an app page with no session redirects to sign-in');

    await page.fill('#siName', cfg.user);
    await page.fill('#siPw', PASSWORD);
    await page.click('#siBtn');
    await page.waitForTimeout(2500);
    ok(/statements\.html/.test(page.url()), 'signing in returns to the page that was asked for');

    // The guide pops on a first visit; dismiss it so it cannot swallow clicks.
    await page.evaluate(() => { if (window.Guide) Guide.close(); });

    // --- every page loads, with the same build ------------------------
    const builds = new Set();
    for (const name of PAGES) {
      await page.goto(APP + name + '.html');
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => ({
        url: location.pathname.split('/').pop(),
        build: window.APP_BUILD || null,
        nav: document.querySelectorAll('#side .nav a').length,
        store: typeof Store !== 'undefined',
        who: !!document.querySelector('.side-foot .who'),
      }));
      eq(r.url, name + '.html', `${name} stays on its own URL`);
      ok(r.nav === PAGES.length, `${name} renders the full ${PAGES.length}-item sidebar (got ${r.nav})`);
      ok(r.store, `${name} has the Store loaded`);
      ok(r.who, `${name} shows who is signed in`);
      builds.add(r.build);
    }
    eq(builds.size, 1, `every page reports the same build (${[...builds].join(', ')})`);

    // --- importing a real trial balance --------------------------------
    /* The fixtures are CSV per entity, which is the app's other supported
       input and needs no Excel round trip to exercise. */
    await page.goto(APP + 'import.html');
    await page.waitForTimeout(700);
    const fixtures = require('fs').readdirSync(path.join(__dirname))
      .filter(f => /^TB_.*\.csv$/.test(f)).sort();
    ok(fixtures.length > 0, 'there are trial balance fixtures to import');

    for (const f of fixtures) {
      const ent = /^TB_([A-Z]+)_/.exec(f)[1];
      const slot = await page.$(`.up.empty[data-ent="${ent}"]`);
      if (!slot) continue;
      await slot.click();
      await page.setInputFiles('#fileInput', path.join(__dirname, f));
      await page.waitForTimeout(700);
    }
    const loaded = await page.evaluate(() => Store.entitiesLoaded().sort());
    ok(loaded.length >= 2, `the import loaded several entities (${loaded.join(', ')})`);

    // --- the statements it produces -------------------------------------
    await page.goto(APP + 'statements.html');
    await page.waitForTimeout(1200);
    const bs = await page.evaluate(() => {
      const g = FS.grouped(); if (!g) return null;
      const b = FS.buildBS(g);
      return { totalAssets: b.totalAssets, diff: b.diff, rows: document.querySelectorAll('td.stmt-amt').length };
    });
    ok(bs, 'the statements page builds a balance sheet from the imported data');
    ok(bs.totalAssets > 0, `total assets are a real figure (${Math.round(bs.totalAssets).toLocaleString()})`);
    ok(Math.abs(bs.diff) < 1, `and the balance sheet balances (difference ${bs.diff.toFixed(2)})`);
    ok(bs.rows > 10, `and the page rendered ${bs.rows} amounts`);

    // --- the guide -------------------------------------------------------
    await page.evaluate(() => Guide.open());
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.querySelector('dialog.guide').open), 'the user guide opens');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok(!(await page.evaluate(() => document.querySelector('dialog.guide').open)), 'and closes on Escape');

    // --- signing out ------------------------------------------------------
    await page.click('#signOutBtn');
    await page.waitForTimeout(900);
    ok(/login\.html/.test(page.url()), 'signing out returns to the sign-in page');

    eq(errors.length, 0, `no console or network errors anywhere${errors.length ? ':\n     ' + errors.join('\n     ') : ''}`);
  } finally {
    await browser.close();
  }
  done();
})().catch(e => { console.error(e); process.exit(1); });
