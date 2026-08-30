# Architecture

For an engineer picking this up. It covers the shape of the code, the
accounting conventions the code assumes without restating them, and the
decisions that look odd until you know why.

Read `KNOWN-LIMITATIONS.md` next — it separates deliberate trade-offs from
real gaps, so you don't "fix" something that was a decision.

---

## 1. What it is

A group financial close, replacing an Excel workbook. Import each company's
trial balance, map account codes to statement lines, apply eliminations and
adjustments, read out consolidated statements, ratios and a departmental
expense view.

**Static site. No backend, no build step, no framework.** Every file in the
repository is served as-is. It runs from GitHub Pages and equally well by
opening `index.html` off a disk (`file://`), which is a hard requirement:
finance staff need it during an audit on a machine with no network.

Consequences that shape everything else:

- **The browser is the database.** All state is one JSON blob in
  `localStorage` (~5 MB cap). There is no server copy and no sync.
- **Modules are globals.** Each file is an IIFE that hangs one object off
  `window`; pages load them with ordered `<script>` tags. No bundler, so no
  import graph — the tag order in each HTML file *is* the dependency order.
- **Vendored libraries.** `app/vendor/` holds SheetJS and Chart.js as
  committed files. Nothing is fetched at runtime.

## 2. Layout

```
index.html            redirects into app/
app/
  login.html/.js      sign-in; the only page that does not load shell.js
  auth-config.js      the shared credential (hash only)  ← change here
  auth.js             sign-in logic + session
  shell.js            sidebar, build stamp, sign-in guard — every page
  guide.js            the first-run user guide dialog
  period-picker.js    the "which period am I viewing" control
  store.js            ALL persisted state. The database. Read this first.
  fs.js               trial balance -> balance sheet / P&L
  export-xlsx.js      the Excel workbook, and reading it back in
  month-import.js     one workbook holding many months -> many periods
  <page>.html/.js     one pair per step; the .js owns only that page
  styles.css          the whole design system, one file
  styleguide.html     every component, with markup to copy — open it first
  vendor/             SheetJS, Chart.js — committed, never edited
engine/               pure logic: no DOM, runs in Node, unit-tested
  rulebook.js         account code -> statement / section / group
  group-engine.js     TB and journal parsing, grouping
  cashflow-engine.js  indirect cash flow
  ratio-engine.js     ratios, cash-conversion cycle, TTM
  anomaly-engine.js   the checks on the Review page
test/                 unit suites + browser smoke test + fixtures
tools/                fixture generator, password generator
```

**The `app/` vs `engine/` line is the one to keep.** `engine/` is pure: give
it numbers, get numbers, no DOM and no Store. That is why it can be tested in
Node at all. When logic starts being needed by two pages, it belongs in
`engine/`; `ratio-engine.js` was extracted exactly when the ratio cards and
the trend table had drifted into disagreeing.

## 3. How a page is wired

```html
<script src="vendor/xlsx.full.min.js"></script>   <!-- only where needed -->
<script src="../engine/rulebook.js?v=BUILD"></script>
<script src="../engine/group-engine.js?v=BUILD"></script>
<script src="store.js?v=BUILD"></script>
<script src="auth-config.js?v=BUILD"></script>
<script src="auth.js?v=BUILD"></script>
<script src="period-picker.js?v=BUILD"></script>
<script src="fs.js?v=BUILD"></script>
<script src="shell.js?v=BUILD"></script>          <!-- guards the session -->
<script src="guide.js?v=BUILD"></script>
<script src="statements.js?v=BUILD"></script>     <!-- the page itself, last -->
```

`shell.js` redirects to `login.html` when there is no session, and it does so
**before** the page script runs. Adding a script means adding it in the right
place in every page that needs it — there is no module system to work that
out.

### The build stamp

`shell.js` holds `const BUILD = 'YYYY-MM-DD.N'`, and every app-owned script
and stylesheet is requested with it as `?v=`. **Bump it in the same commit as
any change to `app/` or `engine/`.** Two reasons: a release cannot be half
applied out of the browser cache, and the stamp is printed in the sidebar so
"is this the new version?" is answered by looking rather than guessing. The
browser smoke test asserts every page reports the same one.

## 4. Accounting conventions

These are assumed everywhere and stated nowhere in the UI. Get one wrong and
the statements still add up.

### Sign convention

A trial balance row is stored **raw: debit positive, credit negative.**

| | raw | presented |
|---|---|---|
| Assets, expenses | positive | positive |
| Liabilities, equity, revenue | **negative** | positive |

`fs.js` performs the flip, and only `fs.js`. Everything upstream — parsing,
journals, elimination — stays in raw convention, where a complete book sums
to zero. That property is what `buildBS().diff` measures.

`export-xlsx.js` has its own `signOf`, because the workpaper prints
liabilities and revenue as positive magnitudes to match the Excel original.

### Cumulative year-to-date P&L

A trial balance states profit and loss **cumulatively from the start of the
fiscal year.** June holds six months of revenue; January restarts at one.

So anything per-period is a *difference of two cumulative readings*
(`cashflow-engine.js: periodPL`), and anything annualised needs the month
count (`ratio-engine.js: monthsFromKey`, derived from the `YYYY-MM` period
key). Every off-by-one here lands on a published KPI. It is the single most
common source of a wrong number in this codebase.

### The current period's profit is not in equity

A mid-year balance sheet's equity section holds **prior-year** retained
earnings only. `FS.buildBS()` adds `netProfit` into total
liabilities+equity separately. Fixtures that also park the profit in retained
earnings do not balance. This has a consequence for the cash flow statement —
see `KNOWN-LIMITATIONS.md` §1.

## 5. State: `app/store.js`

One JSON blob under `localStorage['fs-close-workspace-v1']`:

```js
{
  schema: 1,             // see "Changing the schema" below
  tb: { SYN: { fileName, rows: [{code,name,closing,opening}],
               deptRows?, deptSource?, dimNames? }, ... },   // the LIVE period
  journals: [ { id, source, description, lines:[{code,name,amount}],
                net, enabled } ],                            // the LIVE period
  mappings: { '<code>': { statement, section, group } },      // user overrides
  periods: { '2026-06': { key, label, savedAt, tb, journals } },
  uiPeriod: '',          // which period the report pages are showing
  budget: { ... },       // the Cost Center budget import
  workbooks: { ... },
}
```

### Periods

- `''` (empty string) is **the live period** — the close being worked on.
  Every `periodKey` argument in `Store` follows this convention.
- `'2026-06'` is a saved period, with its **own** TB *and its own journals*.
  An archived period must never pick up the live close's eliminations.
- `'2026-06-cc'` (`Store.CC_SUFFIX`) is a **cost-centre period**: one
  company's department-level trial balance, not a consolidated close.

Cost-centre periods belong to the Cost Center page alone. The guarantee is
structural rather than a rule each page remembers: `Store.uiPeriod()` returns
`''` when the stored key is a cost-centre one unless the caller passes
`true`. Only Cost Center and the picker's own branch opt in, so a
consolidated statement cannot be built out of one by accident.

`Store.listPeriods(scope)` — `'main'` (default) excludes cost-centre periods,
`'cc'` is only those, `'all'` is everything (Import's delete list).

### Row packing

Department rows are stored as bare tuples `[code, dept, cc, closing]`, not
objects. A department-level TB is tens of thousands of rows and the four
field names cost more than the values; packing roughly halves a period,
which is the difference between a year of them fitting in 5 MB and not.

### Changing the schema

There is no migration tool, so the only chance to reshape stored data is on
the way in. In `store.js`:

1. bump `SCHEMA`
2. add a `case` to `migrate()` turning the previous version into the new one
3. add a test to `test/store.test.js` starting from real old-shape data

Cases fall through, so data several versions old is brought forward a step at
a time. **Never edit an existing case** — someone's browser still holds data
only that code knows how to read. Data written by a *newer* build is left
untouched on disk and the session runs empty rather than corrupting it.

## 6. Sign-in

One shared credential in `app/auth-config.js`: a PBKDF2-SHA256 hash at 150k
iterations over a random salt, never the password. `tools/set-password.html`
generates a replacement. `shell.js` gates every page.

**This is a door, not a wall.** The repository is public and the site is
static: the hash is public, a weak password can be recovered from it offline,
and anyone can open a page URL directly because there is no server to stop
them. It keeps out whoever wanders past an open browser. If real access
control is ever needed, that is a backend, not a change here.

## 7. Testing

```sh
npm test           # unit suites, then the browser smoke test
npm run test:unit  # unit only — needs no browser
npm run lint
```

`test/helpers.js` provides the assertion harness (deliberately no runner
dependency, so a clean checkout works and still works in five years) and
`loadApp()`, which assigns module exports onto `global` to reproduce what the
`<script>` tags do.

The browser suite drives the real files over `file://` and **fails on any
console error**, not just a missing element — a page that renders while
throwing is not working. Set `SMOKE_CHROMIUM` to use a preinstalled browser.

CI (`.github/workflows/ci.yml`) runs lint, unit, and the browser smoke test
on every push, plus a check that `test/` fixtures still match their
generator. It is deliberately separate from the Pages deployment and does not
currently block it — see `CONTRIBUTING.md`.

## 8. Where to start reading

1. `app/store.js` — the data model is the app
2. `engine/rulebook.js` — the chart of accounts and how it maps
3. `app/fs.js` — the sign flip, in 70 lines
4. `test/cashflow-engine.test.js` — the conventions above, executable
