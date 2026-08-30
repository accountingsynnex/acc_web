/* Design consistency check — the guard that keeps the pages looking like one
 * application.
 *
 * This does NOT compare screenshots. Pixel diffing rasterised text is
 * famously flaky across machines and font stacks, so it goes red for reasons
 * nobody caused and gets switched off within a month. Instead it reads the
 * COMPUTED STYLES the browser actually resolved, which are deterministic
 * everywhere, and asserts two different things:
 *
 *   1. CONSISTENCY — every element wearing the same component class resolves
 *      to the same appearance. Two `.btn`s with different padding is the
 *      literal definition of "these pages look like different websites", and
 *      it is now a failing test rather than something you notice later on a
 *      screenshot. This is the check that answers "how does the next person
 *      keep it consistent": they cannot make it inconsistent without CI
 *      telling them.
 *
 *   2. REGRESSION — those resolved values match test/design-snapshot.json.
 *      Restyling a component on purpose means updating the snapshot in the
 *      same commit, which puts the change in the diff where a reviewer sees
 *      it, instead of it arriving as a surprise.
 *
 * Update the snapshot deliberately:  node test/design.test.js --update
 *
 * A component is exempted from (1) only with a reason in EXEMPT below —
 * never by loosening the check.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { suite } = require('./helpers.js');

let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch (e) {
  console.log('\ndesign consistency — SKIPPED (Playwright not installed; run `npm install`)');
  process.exit(0);
}

const APP = 'file://' + path.join(__dirname, '..', 'app') + '/';
const SNAPSHOT = path.join(__dirname, 'design-snapshot.json');
const UPDATE = process.argv.includes('--update');
const PAGES = ['import', 'tb', 'mapping', 'journals', 'consolidation',
  'statements', 'cashflow', 'ratios', 'costcenter', 'review'];

const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'auth-config.js'), 'utf8');
global.window = global;
new Function('window', cfgSrc)(global);
const USER = global.AUTH_CONFIG.user;
const PASSWORD = process.env.SMOKE_PASSWORD || 'syn134589';

/* The components whose appearance is a contract, and the properties that
   make up "looks the same". Deliberately not every property — colour varies
   by state (a .chip is green or red by design), so only the structural
   properties that must never drift are listed per component. */
const COMPONENTS = [
  { sel: '.btn', props: ['fontSize', 'fontWeight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderRadius', 'textDecorationLine'] },
    /* .linkish is an inline link and inherits the size of the text around it
     by design, so fontSize is deliberately not part of its contract — only
     that it still reads as a link. A toolbar action must not be a .linkish;
     it wears .btn.ghost, whose size IS checked. */
  { sel: '.linkish', props: ['fontWeight', 'textDecorationLine'] },
  { sel: '.iconbtn', props: ['width', 'height', 'borderRadius'] },
  { sel: '.chip', props: ['fontSize', 'fontWeight', 'paddingTop', 'paddingBottom', 'borderRadius'] },
  { sel: '.tile', props: ['borderRadius', 'paddingTop', 'paddingLeft'] },
  { sel: '.tile .v', props: ['fontSize', 'fontWeight'] },
  { sel: '.panel', props: ['borderRadius'] },
  { sel: '.page-head h1', props: ['fontSize', 'fontWeight'] },
  { sel: 'h2.sec', props: ['fontSize', 'fontWeight', 'textTransform'] },
  { sel: '.fld label', props: ['fontSize', 'fontWeight'] },
  { sel: '.fld input, .fld select', props: ['fontSize', 'paddingTop', 'paddingLeft', 'borderRadius'] },
  { sel: '.seg button', props: ['fontSize', 'fontWeight', 'paddingTop', 'paddingLeft'] },
  { sel: '.topbar', props: ['height'] },
  { sel: '.crumb', props: ['fontSize'] },
];

/* Deliberate exceptions. Each needs a reason — an exemption without one is
   just the check being switched off. */
const EXEMPT = {
  // The sign-in button is the only action on its page and is sized to the
  // card, not to a toolbar. Different on purpose.
  '.btn': ['login-go'],
};

(async () => {
  const { ok, eq, done } = suite('design consistency');
  const browser = await chromium.launch(
    process.env.SMOKE_CHROMIUM ? { executablePath: process.env.SMOKE_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1340, height: 950 } });
  page.on('dialog', d => d.accept());

  const seen = {};    // "selector|prop" -> { value -> [ "page:label", ... ] }

  try {
    await page.goto(APP + 'import.html');
    await page.waitForTimeout(900);
    await page.fill('#siName', USER);
    await page.fill('#siPw', PASSWORD);
    await page.click('#siBtn');
    await page.waitForTimeout(2500);
    await page.evaluate(() => { if (window.Guide) Guide.close(); });

    // Real content, so components that only exist once data is loaded (chips,
    // tiles, statement rows) are measured too rather than silently skipped.
    await page.goto(APP + 'import.html');
    await page.waitForTimeout(600);
    for (const f of fs.readdirSync(__dirname).filter(x => /^TB_.*\.csv$/.test(x)).sort()) {
      const ent = /^TB_([A-Z]+)_/.exec(f)[1];
      const slot = await page.$(`.up.empty[data-ent="${ent}"]`);
      if (!slot) continue;
      await slot.click();
      await page.setInputFiles('#fileInput', path.join(__dirname, f));
      await page.waitForTimeout(600);
    }

    for (const name of PAGES) {
      await page.goto(APP + name + '.html');
      await page.waitForTimeout(900);
      const measured = await page.evaluate(({ COMPONENTS, EXEMPT }) => {
        const out = [];
        for (const { sel, props } of COMPONENTS) {
          const skip = EXEMPT[sel] || [];
          for (const el of document.querySelectorAll(sel)) {
            if (skip.some(c => el.classList.contains(c))) continue;
            // Hidden elements resolve to different values (display:none gives
            // no box), so they are not comparable and are left out.
            if (!el.offsetParent && el.tagName !== 'BODY' && getComputedStyle(el).position !== 'fixed') continue;
            const cs = getComputedStyle(el);
            const label = (el.id || el.textContent.trim().slice(0, 18) || el.className).replace(/\s+/g, ' ');
            for (const p of props) out.push({ sel, prop: p, value: cs[p], label });
          }
        }
        return out;
      }, { COMPONENTS, EXEMPT });

      for (const m of measured) {
        const key = `${m.sel}|${m.prop}`;
        const bucket = (seen[key] = seen[key] || {});
        (bucket[m.value] = bucket[m.value] || []).push(`${name}:${m.label}`);
      }
    }

    // ---- 1. consistency: one value per component property ---------------
    const snapshot = {};
    let inconsistent = 0;
    for (const key of Object.keys(seen).sort()) {
      const values = Object.keys(seen[key]);
      if (values.length === 1) {
        snapshot[key] = values[0];
        continue;
      }
      inconsistent++;
      // Report the odd ones out against the majority, so the message is a
      // worklist and not a puzzle.
      const sorted = values.sort((a, b) => seen[key][b].length - seen[key][a].length);
      const majority = sorted[0];
      const strays = sorted.slice(1)
        .map(v => `${v} on ${[...new Set(seen[key][v])].slice(0, 4).join(', ')}`)
        .join('\n            ');
      ok(false, `${key} is not consistent — most are ${majority}, but:\n            ${strays}`);
    }
    if (!inconsistent) ok(true, `every component resolves to one value across all ${PAGES.length} pages`);

    // ---- 2. regression against the committed snapshot -------------------
    if (UPDATE) {
      fs.writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
      console.log(`  (updated ${path.basename(SNAPSHOT)} — ${Object.keys(snapshot).length} entries)`);
    } else if (fs.existsSync(SNAPSHOT)) {
      const want = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
      let drift = 0;
      for (const key of Object.keys(want)) {
        if (!(key in snapshot)) { ok(false, `${key} disappeared — the component is gone or no longer measured`); drift++; continue; }
        if (snapshot[key] !== want[key]) { ok(false, `${key} changed: ${want[key]} -> ${snapshot[key]} (intended? run with --update)`); drift++; }
      }
      if (!drift) ok(true, `all ${Object.keys(want).length} component styles match the committed snapshot`);
    } else {
      ok(false, `no ${path.basename(SNAPSHOT)} yet — run: node test/design.test.js --update`);
    }

    // ---- 3. no class used in markup that CSS never defines --------------
    /* A class with no rule behind it is how `btn ghost` ended up with its
       appearance pasted inline at every call site. */
    const appDir = path.join(__dirname, '..', 'app');
    let css = fs.readFileSync(path.join(appDir, 'styles.css'), 'utf8');
    /* A page's own <style> block counts as a definition — it factually is
       one. Which is why the next assertion exists: only the style guide and
       the redirect stub may have one at all, so "a class is defined in
       styles.css" stays true of every page that renders the app. */
    const LOCAL_STYLE_OK = ['styleguide.html'];
    const withLocalStyle = [];
    const used = new Set();
    for (const f of fs.readdirSync(appDir)) {
      if (!/\.(html|js)$/.test(f) || f === 'vendor') continue;
      const src = fs.readFileSync(path.join(appDir, f), 'utf8');
      if (/<style>/.test(src)) {
        withLocalStyle.push(f);
        for (const m of src.matchAll(/<style>([\s\S]*?)<\/style>/g)) css += '\n' + m[1];
      }
      for (const m of src.matchAll(/class="([^"${}]*)"/g)) {
        /* `js-` prefixed classes are handles for querySelector, never for
           styling, so they are exempt from needing a CSS rule. That naming
           split is what lets "a styling class must exist in CSS" be a rule a
           machine can enforce at all. */
        for (const c of m[1].split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(c) && !c.startsWith('js-')) used.add(c);
      }
    }
    const undefined_ = [...used].filter(c => !new RegExp(`\\.${c}(?![a-z0-9-])`, 'i').test(css)).sort();
    eq(undefined_.length, 0,
       `every class used in markup has a rule in CSS${undefined_.length ? ' — missing: ' + undefined_.join(', ') : ''}`);

    /* One stylesheet, or there is no design system. A page that styles itself
       is how two pages end up with different buttons, so the exceptions are
       named rather than tolerated. */
    const stray = withLocalStyle.filter(f => !LOCAL_STYLE_OK.includes(f)).sort();
    eq(stray.length, 0,
       `no app page carries its own <style> block${stray.length ? ' — found in: ' + stray.join(', ') : ''}`);
  } finally {
    await browser.close();
  }
  done();
})().catch(e => { console.error(e); process.exit(1); });
