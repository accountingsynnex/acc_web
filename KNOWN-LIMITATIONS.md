# Known limitations

What is deliberate, what is a real gap, and what nobody has decided yet — so
a new engineer can tell them apart instead of guessing.

Ordered by how likely each is to matter.

---

## 1. The cash flow statement does not reconcile fully

**Partly inherent to the indirect method, partly still open.**

Nothing in a trial balance says "cash paid to suppliers", so the statement is
reconstructed from the movement between the opening and closing balance
sheets plus the period's P&L. Whatever the operating, investing and financing
sections do not account for is disclosed on its own line —
**"ผลต่างที่ยังไม่ระบุ"** — rather than folded silently into a named one.

What lands there:

- **FX translation** and **trade-finance facilities** that may follow a
  different classification policy than the one assumed here. Neither is
  modelled. This part is inherent.
- **A real movement in retained earnings** — an actual dividend, or an
  appropriation to legal reserve. It used to get its own line; see below.

The statement is honest about the gap, but it is a gap: the Review page
flags it, and it should not be filed as a statutory cash flow statement
without reconciling the remainder by hand.

### An inferred dividend used to make this worse — removed

The financing section carried:

```js
fin.add('เงินปันผลจ่าย (…)', -((retainedNow - retainedOpen) - netProfit));
```

That is the right identity **when the period's result has been closed to
retained earnings**. In this app it never has: a trial balance keeps the
result in the P&L accounts and `FS.buildBS()` adds `netProfit` into total
liabilities+equity separately (ARCHITECTURE.md §4), so retained earnings does
not move while net profit does — including at a December close, because the
comparison is always closing against opening *within* one fiscal year.

So the line reported a distribution equal to the whole period profit, every
period, that nobody had made — and inflated the unexplained difference by its
own size. Measured on the fixture books: **473M with the line, 246M without
it**, against a real net cash movement of 2.9M.

Removed on the finance team's call. The cost is that a genuine movement in
retained earnings no longer gets a line of its own and falls into
"ผลต่างที่ยังไม่ระบุ" instead. Showing that movement — `-(retainedNow -
retainedOpen)`, without the `netProfit` term — is a one-line change if it is
ever wanted, and `test/cashflow-engine.test.js` has the assertions that stop
the old formula coming back by accident.

**Anyone comparing cash flow figures across the change should know the
financing section and the unexplained line both moved.**

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
suites; a Playwright smoke test covers sign-in, all ten pages, a real import
and a balancing balance sheet; and a design check asserts every component
resolves the same way on every page.

The **page scripts have no unit tests** — `import.js`, `ratios.js` and
`costcenter.js`, the three largest, are covered only by the browser suite
loading them without errors. `import.js` in particular carries a lot of file-shape
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
- **one `styles.css`.** Fine at its current size; the seams are marked with
  section comments if it ever needs splitting.
- **`import.js`** is the file most in need of being broken up. The
  file-shape detection is separable from the UI.

## 10. Dropdown lists look different on Firefox and Safari

**Cosmetic, and deliberately one-way.**

The list a `<select>` drops open is drawn by the browser, not by the page.
Chromium 135+ hands it over through `appearance: base-select`, so on Chrome
and Edge the popup is rounded, themed and dark-mode aware like every other
surface. Firefox and Safari have not shipped it: they fail the `@supports`
test in `app/styles.css`, skip the block, and get the square native popup.

Nothing but appearance depends on it, and the block is written so the *closed*
control lands in the same place either way — but the two branches are only
equal by construction, so anything added inside `@supports (appearance:
base-select)` has to be checked in a browser on each side. The geometry that
matters is pinned by `test/design.test.js` (`.filtersel` width and height,
`.fld input, .fld select` height, `.topbar` height), which runs Chromium only:
that catches the base-select branch drifting, not the native one.
