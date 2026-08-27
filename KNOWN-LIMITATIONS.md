# Known limitations

What is deliberate, what is a real gap, and what nobody has decided yet — so
a new engineer can tell them apart instead of guessing.

Ordered by how likely each is to matter.

---

## 1. The cash flow statement infers a distribution that was never made

**Real defect. Needs an accountant's decision, not just a code change.**

`cashflow-engine.js` reads the movement in retained earnings against net
profit and reports the shortfall as a dividend:

```js
fin.add('เงินปันผลจ่าย (…)', -((retainedNow - retainedOpen) - netProfit));
```

But in this app the current period's result sits in the **P&L accounts**, not
in retained earnings (see ARCHITECTURE.md §4). Between two dates inside one
fiscal year, retained earnings does not move, so the shortfall is the entire
period profit. The statement therefore shows:

- a **distribution equal to the whole period profit**, which nobody paid, and
- an equal and opposite figure on the **"ผลต่างที่ยังไม่ระบุ" (unexplained)**
  line

Both are visible on the Cash Flow page today. The unexplained line was
described as an inherent limit of the indirect method; it is partly that, but
this component of it is a modelling error and is reproducible.

Pinned as current behaviour in `test/cashflow-engine.test.js` — deliberately
not "fixed" in passing, because changing it moves published cash flow figures
and is an accounting decision. When it is addressed, that test block is the
first thing to rewrite.

The other contributors to `unexplained` are genuine: FX translation and
trade-finance facilities that may follow a different classification policy
are not modelled. Whatever is left over is disclosed on its own line rather
than folded silently into a named one, which is the right default.

## 2. Sign-in is a door, not a wall

**Deliberate, with a known ceiling.**

The repository is public and the site is static. One shared credential lives
in `app/auth-config.js` as a PBKDF2-SHA256 hash — the password itself is not
committed — but:

- the hash is public, so a short or guessable password can be recovered from
  it offline
- any page URL can be opened directly; the guard is client-side, and there is
  no server to enforce anything
- the data is in the visitor's own `localStorage` either way

It stops someone wandering past an open browser. It does not stop anyone who
wants the data. Real access control means a backend; there is no partial
version of this worth building.

## 3. The browser is the only copy

**Deliberate, and the biggest operational risk.**

No server, no sync, no backup. Clearing site data loses the close. Mitigated,
not solved, by:

- the Excel export/import round trip (Review → edit → Import), which doubles
  as a file-based backup
- Save/Load JSON on the Journals and Mapping pages

The `localStorage` cap is about **5 MB**, and a department-level TB for
several months reaches it. The Import page shows a usage meter; a failed
write is reported rather than swallowed. A year of cost-centre periods is
roughly the practical ceiling.

Nothing is shared between machines or people. Two people cannot work one
close.

## 4. No audit trail

**Deliberate for now; the obvious next requirement.**

Nothing records who changed a mapping, when a journal was disabled, or what
the numbers were yesterday. The sign-in gives a name but nothing writes it
down. For a listed company's consolidation this is likely to be asked for,
and it needs a backend to be worth anything — a local log can be edited by
whoever it would incriminate.

## 5. Coverage is uneven

`engine/` and `app/store.js`, `app/fs.js`, `app/export-xlsx.js` have unit
suites, and a Playwright smoke test covers sign-in, all ten pages, a real
import and a balancing balance sheet.

The **page scripts have no unit tests** — `import.js` (870 lines),
`ratios.js`, `costcenter.js` are covered only by the smoke test loading them
without errors. `import.js` in particular carries a lot of file-shape
guesswork that would benefit from tests against real workbooks.

## 6. Input formats are inferred, not specified

`group-engine.js` detects columns by header name across several spellings in
two languages, because real exports vary month to month. It is forgiving by
design, which means it can also be *wrong* quietly. The Import page reports
per-sheet outcomes for this reason — that log is the mitigation, and it
should stay as formats are added.

Known shapes it handles: the combined Conso workpaper, one sheet per entity;
per-entity CSV; a workbook with one sheet per month; this app's own export.

## 7. Cost Center depends on a naming convention

Department and cost-centre **names** are recovered from the account-name
suffix (`STAFF SALARIES-Marketing`). Codes match reliably; names do not.
Names containing a hyphen or brackets — `TRADE-IN`, `Marketplace
(E-Commerce)`, `Call-Center` — are truncated. Confirmed against the company's
budget file: 113 of 125 cost-centre names matched exactly, 12 were truncated
this way. Cosmetic (the codes still match, so the money is right) but visible.

## 8. Nothing to say when a rule changes

`engine/rulebook.js` is the chart of accounts. Rename a group there and any
ratio summing it silently becomes zero — no error, just a KPI reading 0.0
forever. `unreachableGroups()` exists to catch this and is asserted in
`test/ratio-engine.test.js`, but it only covers groups the *ratios* name. A
group renamed out from under a statement section has no such guard.

## 9. Architecture decisions deferred

Not problems — choices whoever takes this over should make deliberately:

- **globals + script tags vs ES modules.** Current approach has no build step
  and works from `file://`. ES modules would too (`type="module"`), at the
  cost of needing a server for local development, since `file://` blocks
  module loading. That trade is the reason it has not been done.
- **types.** No TypeScript and no JSDoc annotations. The `engine/` modules
  are the ones where types would pay for themselves.
- **one 595-line `styles.css`.** Fine at this size; the seams are marked with
  section comments if it needs splitting.
- **`import.js` is 870 lines** and is the file most in need of being broken
  up. The file-shape detection is separable from the UI.
