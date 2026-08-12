# FS Close Workspace

A static, offline-first web app for a group financial close: import each
entity's trial balance, map account codes to statement lines, apply
eliminations and adjustments, and read the consolidated outputs.

No backend, no build step, no install. Open `index.html` in a browser —
it works straight off the filesystem (`file://`).

## Your data stays in your browser

Everything you import is held in that browser's `localStorage` and never
leaves the machine. Nothing is uploaded anywhere, and no company figures
ship with the app — the bundled sample trial balances are generated
(`tools/make_sample_tb.py`), not real.

Because the only copy lives in the browser, clearing site data loses it.
The Journals and Mapping pages both have **Save to file / Load from file**
buttons for exactly that reason — keep a `.json` backup.

## Flow

| Page | What it does |
| --- | --- |
| **Import TB** | Drop a whole `.xlsx` workbook (one sheet per entity) or per-entity CSV. Also saves periods for trend comparison. |
| **Trial Balance** | Per-entity and combined TB with validation. |
| **Mapping** | Review codes the rulebook doesn't recognise; override any grouping. |
| **Journals** | Eliminations and adjustments — parsed from the workbook if present, or entered by hand. |
| **Consolidation** | Entity columns → combined → after journals. |
| **Statements** | Balance sheet and P&L. |
| **Cash Flow** | Indirect-method statement, estimated from the TB's own opening/closing movement. |
| **Ratios** | Liquidity, profitability, efficiency, leverage and cash-cycle ratios, on three side-by-side bases. |
| **Cost Center** | Expense by department, and against budget if a budget file is loaded. |
| **Review** | Close checklist. |

## Input formats

**Trial balance** — CSV/TSV or `.xlsx`. Columns are detected by header
name, so ordering doesn't matter:

- account code — `MainAccount` / `Account` / `Code` / `รหัส`
- name — `Name` / `Description` / `ชื่อ`
- balance — `Closing` / `Balance` / `ยอดคงเหลือ`, or `Debit` + `Credit`
- opening balance *(optional)* — `Opening` / `ยอดยกมา`; needed for Cash Flow
  and for the ratios that average a balance
- department *(optional)* — `Department` / `Dept` / `แผนก`; needed for Cost
  Center. One row per account × department; the department's readable name
  is taken from the account-name suffix, e.g. `STAFF SALARIES-Marketing`.

**Budget** *(optional, Cost Center)* — CSV or `.xlsx` with a department
column and a budget column, optionally an account code column for
account-level comparison.

## Layout

```
index.html          redirects into app/
app/                one page per step, plus store.js (state) and fs.js (BS/PL builder)
engine/             pure logic, usable in the browser and in Node
  rulebook.js         account code -> statement / section / group
  group-engine.js     TB parsing, grouping, journal parsing
  cashflow-engine.js  indirect cash flow
test/               engine smoke test + generated fixtures
tools/              make_sample_tb.py — regenerates the sample/fixture data
```

## Development

```sh
node test/engine.test.js        # engine smoke test
python3 tools/make_sample_tb.py # regenerate sample + fixture trial balances
```

Vendored libraries (`app/vendor/`) are committed on purpose so the app runs
with no network access.
