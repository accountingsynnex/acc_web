/* Grouping engine — turn a raw trial balance into grouped FS lines.
   Pure functions only (no DOM); usable in the browser and in Node.
   The reusable mapping lives in rulebook.js; this file is just the logic. */

// ---- CSV / TSV parsing -------------------------------------------------
function splitLine(line, sep) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function toNumber(v) {
  if (v == null) return 0;
  // A cell straight from Excel is already a real number, not something to
  // clean — round-tripping it through the string cleanup below strips the
  // "e" out of scientific notation (a formula's floating-point near-zero
  // residue like 9e-12 turned into 9, a real few-baht error at the exact
  // scale this reads TB balances at). Only text needs the thousand-
  // separator/parens/currency-symbol cleanup that follows.
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim();
  if (!s || s === '-') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }   // (1,234) -> -1234
  s = s.replace(/,/g, '').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return neg ? -n : n;
}

// Find a column index whose header matches any of the given needles.
function findCol(headers, needles) {
  const h = headers.map(x => String(x || '').trim().toLowerCase());
  for (const need of needles) {
    const i = h.findIndex(x => x.includes(need));
    if (i !== -1) return i;
  }
  return -1;
}

/* Build TB rows from a 2-D matrix (row 0 = header). Used by both the CSV
   parser and the Excel importer. Returns { code, name, closing } — closing
   signed (debit +, credit -). Column positions are detected by header name,
   so it copes with the different TB sheet layouts in the workpaper. */
const CODE_HEADERS = ['mainaccount', 'account code', 'account no', 'account', 'code', 'รหัส'];
const AMOUNT_HEADERS = ['closing', 'ending', 'balance', 'ยอดคงเหลือ', 'คงเหลือ'];

/* Which row holds the header. Usually row 0, but department/cost-centre
   exports out of the workpaper carry a spacer or check row above it, and
   reading that as the header finds no columns at all. Scan a few rows for
   one that has both a code column and something to read an amount from. */
function findHeaderRow(matrix) {
  for (let i = 0; i < Math.min(matrix.length, 12); i++) {
    const h = matrix[i] || [];
    if (findCol(h, CODE_HEADERS) === -1) continue;
    const hasAmount = findCol(h, AMOUNT_HEADERS) !== -1
      || (findCol(h, ['debit', 'เดบิต']) !== -1 && findCol(h, ['credit', 'เครดิต']) !== -1);
    if (hasAmount) return i;
  }
  return 0;
}

/* Which accounts carry a credit (not debit) balance by nature — the raw
   signed convention everywhere else in this app (debit +, credit -). Only
   needed by parseStatementReport below, whose source report states every
   account at its own natural positive magnitude regardless of debit/credit,
   so getting an account onto the right side of zero means knowing that
   nature independently of the sign the report happens to print. Same rule
   the synthetic sample generator uses (tools/make_sample_tb.py) — code
   ranges 2/3/4/7 (liabilities, equity, revenue, other income), plus the
   contra accounts that sit inside an asset section by name (a provision or
   accumulated depreciation is a credit balance even though its code reads
   like an asset). */
const CREDIT_PREFIXES = ['2', '3', '4', '7'];
const CONTRA_NAME = /PROVISION|ALLOWANCE|ACCUMULAT|DEFERRED INTEREST/i;
function isCreditNatured(code, name) {
  return CONTRA_NAME.test(name || '') || CREDIT_PREFIXES.includes(code[0]);
}

/* Fallback for a sheet that isn't a plain account-list export at all — seen
   in a real workbook where one entity's "TB" tab held a combined balance
   sheet + income statement report ("INCOME STATEMENT (SYNNEX FORMAT)")
   instead, with a subtotal row above every account group and the account's
   own code sitting beside a plain-language label rather than a header
   naming a code column. buildRows' normal header search finds nothing to
   read there, so this reads the layout that report actually has:

     col A: the account code (a subtotal/group row carries a 1-2 digit
            index here instead, e.g. "1" for "Cash and equivalents" —
            distinguished from a real code by length, same >=3-digit rule
            buildRows itself uses for "is this row an account")
     col B: the account name
     one column, found from the header block above the data, holds the
            closing balance as of the report's own date

   The report states every account at its own natural positive magnitude
   (an asset positive, but ALSO a liability positive, equity positive,
   revenue positive) rather than this app's raw debit+/credit- convention,
   so isCreditNatured() above flips exactly the accounts that need it.

   Two eras of this same report were found: one column already IS the
   closing balance as of the report date; the other splits that date into
   an "MTD" column and a "YTD" column, and only the YTD one accumulates
   since the fiscal year start the same way every other TB in this app
   does — found by a "YTD" label a couple of rows above the date.

   Never trusted blind: the accounts pulled out are summed with the same
   sign rule applied, and if that sum isn't close to zero — the way a real
   trial balance's signed closing balances always are — this returns null
   instead of an import that would look plausible and be wrong. The caller
   falls through to the ordinary "column not found" error in that case. */
function parseStatementReport(matrix) {
  if (!matrix) return null;
  const scanRows = Math.min(matrix.length, 15);

  // The header row: the one with at least one real date in an early column.
  // The caller reads with raw:true (no cellDates), so a date-formatted cell
  // arrives as a plain Excel day-serial number, not a Date object — 25569 is
  // 1970-01-01, so this window (to ~2064) is date-plausible without also
  // catching an ordinary monetary figure that happens to be a round number.
  // More than one column can carry the same date (the MTD/YTD split), so
  // every match is kept, not just the first.
  const isDateLike = c => c instanceof Date || (typeof c === 'number' && Number.isInteger(c) && c > 25569 && c < 60000);
  let dateRow = -1, dateCols = [];
  for (let r = 0; r < scanRows; r++) {
    const cells = matrix[r] || [];
    const hits = [];
    for (let c = 0; c < Math.min(cells.length, 40); c++) if (isDateLike(cells[c])) hits.push(c);
    if (hits.length) { dateRow = r; dateCols = hits; break; }
  }
  if (dateRow === -1) return null;

  let valueCol = dateCols[0];
  if (dateCols.length > 1) {
    // Disambiguate by a "YTD" label a row or two above the date row —
    // MTD (this period alone) is not what a cumulative TB column means.
    // Defaults to the last candidate (YTD conventionally follows MTD) if no
    // such label is found.
    let ytdCol = null;
    for (let r = Math.max(0, dateRow - 3); r < dateRow; r++) {
      const cells = matrix[r] || [];
      for (const c of dateCols) {
        if (/ytd/i.test(String(cells[c] == null ? '' : cells[c]))) { ytdCol = c; break; }
      }
      if (ytdCol != null) break;
    }
    valueCol = ytdCol != null ? ytdCol : dateCols[dateCols.length - 1];
  }

  const byCode = new Map();
  for (let r = dateRow + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const raw = cells[0];
    if (raw == null || typeof raw === 'string') continue;   // a section string ("TOTAL LIABILITIES"), not a code
    const code = String(Math.round(raw));
    if (code.length < 3) continue;                          // a group's index number (1, 2, 5, ...), not an account
    const name = String(cells[1] == null ? '' : cells[1]).trim();
    const v = toNumber(cells[valueCol]);
    const closing = isCreditNatured(code, name) ? -v : v;
    const cur = byCode.get(code);
    if (cur) cur.closing += closing;
    else byCode.set(code, { code, name, closing, opening: null });
  }
  if (!byCode.size) return null;

  // A real trial balance's signed closing balances net to (near) zero; a
  // genuinely wrong sign rule misses by roughly twice that account's own
  // balance — many orders of magnitude past ordinary floating-point drift
  // summing 300+ values, which this tolerance is sized for instead.
  const net = [...byCode.values()].reduce((s, x) => s + x.closing, 0);
  if (Math.abs(net) > 1) return null;   // the sign rule misfired on this layout — don't guess

  return { rows: [...byCode.values()], deptRows: [], columns: null };
}

function buildRows(matrix) {
  if (!matrix || !matrix.length) return { rows: [], deptRows: [], columns: null };
  const headerRow = findHeaderRow(matrix);
  const headers = matrix[headerRow];
  const ci = findCol(headers, CODE_HEADERS);
  const ni = findCol(headers, ['name', 'description', 'ชื่อ']);
  const cli = findCol(headers, AMOUNT_HEADERS);
  const oi = findCol(headers, ['opening', 'beginning', 'ยอดยกมา', 'ยกมา', 'ต้นงวด']);
  const di = findCol(headers, ['debit', 'เดบิต']);
  const cri = findCol(headers, ['credit', 'เครดิต']);
  // Two separate dimensions, looked up in their own right: some exports carry
  // Department alone ("TB SYN_TW"), some carry Department AND CostCenter under
  // it. Searching for department first matters — a single pattern list would
  // let whichever column happened to come first stand in for both.
  const dpi = findCol(headers, ['department', 'dept', 'แผนก']);
  const cci = findCol(headers, ['costcenter', 'cost center', 'costcentre', 'cost centre', 'ศูนย์ต้นทุน']);
  // With no department column at all, a lone cost-centre column IS the
  // dimension this export offers, so it takes the department's place.
  const dimI = dpi !== -1 ? dpi : cci;
  const subI = dpi !== -1 ? cci : -1;
  if (ci === -1) {
    const fallback = parseStatementReport(matrix);
    if (fallback) return fallback;
    throw new Error('ไม่พบคอลัมน์รหัสบัญชี (MainAccount / Account / รหัส)');
  }

  // Aggregate by code: some exports (department/cost-centre-level TBs) repeat
  // the same account code once per department, so this is keyed by code
  // rather than pushed straight to an array — every other place that reads
  // an entity's rows (raw row counts, per-code lookups) assumes one row per
  // account, and de-duping here means that's true regardless of how granular
  // the source export is.
  const byCode = new Map();
  // Department detail is kept alongside the deduped rows (never instead of
  // them) so the cost-centre view has a real source while every existing
  // caller keeps seeing exactly one row per account code. Empty unless the
  // export actually carries a department dimension.
  // A row here is only its dimension codes and its figures. The readable
  // labels repeat across thousands of rows, so they're resolved once into
  // dimNames below and looked up by code — a department-level export runs to
  // tens of thousands of rows, and carrying three label strings on each of
  // them was most of what the browser had to keep in storage.
  const deptRows = [], deptNamesRaw = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const code = String(cells[ci] == null ? '' : cells[ci]).trim();
    if (!/^\d{3,}$/.test(code)) continue;                // skip totals / blank / notes
    let closing;
    if (cli !== -1) closing = toNumber(cells[cli]);
    else if (di !== -1 && cri !== -1) closing = toNumber(cells[di]) - toNumber(cells[cri]);
    else closing = 0;
    const opening = oi !== -1 ? toNumber(cells[oi]) : null;
    const name = ni !== -1 ? String(cells[ni] == null ? '' : cells[ni]).trim() : '';
    if (dimI !== -1) {
      const dept = String(cells[dimI] == null ? '' : cells[dimI]).trim();
      const cc = subI !== -1 ? String(cells[subI] == null ? '' : cells[subI]).trim() : '';
      // Labels are resolved after the whole sheet is read — see labelDims.
      if (dept) { deptRows.push({ code, dept, cc, closing, opening }); deptNamesRaw.push(name); }
    }
    const cur = byCode.get(code);
    if (cur) { cur.closing += closing; if (opening != null) cur.opening = (cur.opening || 0) + opening; if (!cur.name && name) cur.name = name; }
    else byCode.set(code, { code, name, closing, opening });
  }
  const dimNames = labelDims(deptRows, deptNamesRaw, subI !== -1);
  // The deduped rows took their name from whichever row of that account came
  // first, labels and all ("STAFF SALARIES-Center-Center"). Now that the
  // labels are known they come back off, so every page reading these rows
  // shows the account, not the account plus one arbitrary department.
  for (const row of byCode.values()) {
    const clean = dimNames.account && dimNames.account[row.code];
    if (clean) row.name = clean;
  }
  return { rows: [...byCode.values()], deptRows, dimNames, columns: { code: ci, name: ni, closing: cli, opening: oi, debit: di, credit: cri, dept: dimI, cc: subI } };
}

/* Readable names for the dimension codes. These exports hold only codes in
   the Department/CostCenter columns and spell the labels into the account
   name instead — "STAFF SALARIES-Marketing" with one dimension, or
   "STAFF SALARIES-Marketing-Multimedia Product Group (MPG)" with two.

   Taking the text after the last "-" is enough for one dimension but wrong
   for two (it yields the cost centre where the department belongs), and
   splitting on "-" outright breaks the labels that contain one of their own
   ("Marketplace (E-Commerce)", "Call-Center"). So the suffix is found by
   removing the account name first: an account that appears under several
   dimension values has its name as the common prefix of those rows, which
   leaves exactly the label part behind. Codes appearing under a single value
   can't be split that way, so they reuse a suffix already learned from
   another account with the same dimension codes.

   Returns { dept: {code: label}, cc: {"dept cc": label} } rather than
   labelling each row: the same handful of labels repeat across every row of
   a department-level export, and one lookup keeps that out of storage.
   Labels fall back to the code itself, never to a guess, so an export that
   spells no labels at all still reads sensibly. */
function labelDims(deptRows, names, twoLevel) {
  const out = { dept: {}, cc: {} };
  if (!deptRows.length) return out;
  const lcp = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return a.slice(0, i); };
  const upToDash = s => { const i = s.lastIndexOf('-'); return i === -1 ? s : s.slice(0, i); };

  // 1) account name per code = common prefix of its rows' names, cut back to a
  // "-" boundary so a prefix that stops mid-label isn't mistaken for the name.
  const byCode = new Map();
  deptRows.forEach((r, i) => {
    byCode.set(r.code, byCode.has(r.code) ? lcp(byCode.get(r.code), names[i]) : names[i]);
  });
  // 2) the suffix each (dept, cc) pair spells, learned from any code that
  // appears under more than one pair.
  const suffixOf = new Map();
  deptRows.forEach((r, i) => {
    const name = names[i], prefix = byCode.get(r.code);
    if (prefix === name) return;                     // single-valued code — nothing to subtract yet
    const base = upToDash(prefix);
    if (!name.startsWith(base)) return;
    const suffix = name.slice(base.length).replace(/^-/, '').trim();
    const key = r.dept + ' ' + r.cc;
    if (suffix && !suffixOf.has(key)) suffixOf.set(key, suffix);
  });
  // 3) department label = common prefix of its pairs' suffixes, cut back to a
  // "-" boundary. A department holding one cost centre has the cost centre's
  // own label still attached, which that cut removes.
  const deptSuffixes = new Map();
  for (const [key, suffix] of suffixOf) {
    const dept = key.slice(0, key.indexOf(' '));
    deptSuffixes.set(dept, deptSuffixes.has(dept) ? lcp(deptSuffixes.get(dept), suffix) : suffix);
  }
  for (const [dept, common] of deptSuffixes) {
    const label = (twoLevel ? upToDash(common) : common).replace(/[\s-]+$/, '').trim();
    if (label) out.dept[dept] = label;
  }
  for (const r of deptRows) {
    const key = r.dept + ' ' + r.cc;
    if (out.dept[r.dept] == null) out.dept[r.dept] = suffixOf.get(key) || r.dept;
    if (!twoLevel || out.cc[key] != null) continue;
    const suffix = suffixOf.get(key) || '';
    const dl = out.dept[r.dept];
    out.cc[key] = (suffix.startsWith(dl) ? suffix.slice(dl.length).replace(/^-/, '') : suffix).trim() || r.cc;
  }
  // 4) the account's own name, with the labels taken back off. An account
  // seen under several dimension values gives it up as the common prefix
  // above; one seen under a single value has to have that value's own
  // suffix — learned from some other account — subtracted instead.
  out.account = {};
  deptRows.forEach((r, i) => {
    if (out.account[r.code] != null) return;
    const prefix = byCode.get(r.code);
    let name = prefix === names[i] ? names[i] : upToDash(prefix);
    if (prefix === names[i]) {
      const suffix = suffixOf.get(r.dept + ' ' + r.cc);
      if (suffix && name.endsWith('-' + suffix)) name = name.slice(0, -(suffix.length + 1));
    }
    out.account[r.code] = name.trim();
  });
  return out;
}

/* Parse a raw TB export (CSV or tab-separated) into rows. */
function parseTB(text) {
  text = String(text).replace(/^﻿/, '');            // strip BOM
  const rawLines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!rawLines.length) return { rows: [], columns: null };
  const sep = (rawLines[0].split('\t').length > rawLines[0].split(',').length) ? '\t' : ',';
  return buildRows(rawLines.map(l => splitLine(l, sep)));
}

// ---- Validation --------------------------------------------------------
/* A trial balance is balanced when its signed closing balances net to zero. */
function validateTB(rows, tolerance = 1) {
  const total = rows.reduce((s, r) => s + r.closing, 0);
  return { balanced: Math.abs(total) <= tolerance, netClosing: total, count: rows.length };
}

// ---- Apply the rulebook ------------------------------------------------
/* Join TB rows against the rulebook. Returns grouped totals, the per-row
   result, and the list of codes the rulebook has never seen (need mapping). */
function applyRulebook(rows, rulebook, overrides = {}) {
  const rules = rulebook.rules || {};
  const lines = [], unmapped = [], groups = {};
  for (const row of rows) {
    const rule = overrides[row.code] || rules[row.code] || null;
    const status = rule ? 'mapped' : 'new';
    const line = { ...row, rule, status };
    lines.push(line);
    if (rule) {
      const key = `${rule.statement}||${rule.section}||${rule.group}`;
      groups[key] = (groups[key] || 0) + row.closing;
    } else {
      unmapped.push(row);
    }
  }
  const mapped = lines.length - unmapped.length;
  return {
    lines, groups, unmapped,
    stats: {
      total: lines.length,
      mapped,
      unmapped: unmapped.length,
      mappedPct: lines.length ? +(100 * mapped / lines.length).toFixed(1) : 0,
    },
  };
}

// ---- Journals (eliminations / adjustments) -----------------------------
/* Parse an elimination or AJE/RJE sheet (2-D matrix) into balanced journals.
   These sheets carry a title block, then a header row with columns like
   Description | Account code | Account name | Dr./(Cr.) | NO. Each NO. groups
   the double-entry lines of one journal. Returns:
   [{ id, description, source, lines:[{code, name, amount}], net }]. */
function parseJournals(matrix, source) {
  if (!matrix || !matrix.length) return [];
  // A raw Excel day-serial (no cellDates) or an already-parsed Date — the
  // same test buildRows/parseStatementReport use to spot a date-headed
  // column, needed below for one era of the amount column too.
  const isDateCell = c => c instanceof Date || (typeof c === 'number' && Number.isInteger(c) && c > 25569 && c < 60000);
  // locate the header row (has an account-code column and an amount column).
  // The amount column comes in three shapes across the company's own
  // template history: a single "Dr./ (Cr.)" column (already signed); a
  // "Current Period" column (also already signed, sitting beside separate
  // raw Debit/Credit columns from before a sheet was reorganised — matching
  // "debit" first would silently drop every credit-side line); or, after
  // that reorganising, that same combined column with no text label at all,
  // headed by the report date instead. The first of these three found wins,
  // so a combined column is always preferred over guessing from a split
  // debit/credit pair.
  let hr = -1, col = {};
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const raw = matrix[r] || [];
    const cells = raw.map(x => String(x == null ? '' : x).trim().toLowerCase());
    const codeI = cells.findIndex(x => x.includes('account code') || x === 'code' || x.includes('รหัส'));
    if (codeI === -1) continue;
    let amtI = cells.findIndex(x => x.includes('current period'));
    if (amtI === -1) amtI = raw.findIndex(isDateCell);
    if (amtI === -1) amtI = cells.findIndex(x => x.includes('dr.') || x.includes('dr/') || x.includes('debit') || x.includes('cr.'));
    if (amtI === -1) continue;
    hr = r;
    col = {
      code: codeI, amount: amtI,
      desc: cells.findIndex(x => x.includes('description') || x.includes('รายการ')),
      name: cells.findIndex(x => x.includes('name') || x.includes('ชื่อ')),
      no: cells.findIndex(x => x === 'no.' || x === 'no' || x.includes('เลขที่')),
    };
    break;
  }
  if (hr === -1) return [];

  const byId = new Map();
  let lastDesc = '';
  for (let r = hr + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const get = i => (i != null && i !== -1 && cells[i] != null) ? String(cells[i]).trim() : '';
    const code = get(col.code);
    const amount = toNumber(cells[col.amount]);
    const id = get(col.no);
    if (get(col.desc)) lastDesc = get(col.desc);
    if (!code || !isFinite(amount) || amount === 0 && !code) continue;
    if (!/^[0-9A-Za-z][0-9A-Za-z\- ]{1,}$/.test(code)) continue;   // skip blanks / notes
    const no = id || '(' + source + ')';
    // Prefix with source: the "NO." label (e.g. "CAJE#1") is only unique
    // within its own sheet — the real workpaper reuses the same NO. across
    // different sheets (e.g. AJE+RJE-Synnex and AJE+RJE-Audit both have a
    // "CAJE#1"), and every other Store lookup (toggle/edit/delete) keys off
    // `id` alone, so an un-prefixed id would make one of the pair unreachable.
    const key = source + '::' + no;
    if (!byId.has(key)) byId.set(key, { id: key, no, description: lastDesc, source, lines: [] });
    const j = byId.get(key);
    if (!j.description && lastDesc) j.description = lastDesc;
    j.lines.push({ code, name: get(col.name), amount });
  }
  return [...byId.values()].map(j => ({ ...j, net: j.lines.reduce((s, l) => s + l.amount, 0) }))
    .filter(j => j.lines.length);
}

/* Net effect of a set of journals per account code: { code: sumAmount }. */
function journalEffect(journals) {
  const eff = {};
  for (const j of journals) for (const l of j.lines) eff[l.code] = (eff[l.code] || 0) + l.amount;
  return eff;
}

const GroupEngine = { parseTB, buildRows, labelDims, validateTB, applyRulebook, parseJournals, journalEffect, toNumber, isCreditNatured, parseStatementReport };
if (typeof module !== 'undefined') module.exports = GroupEngine;
