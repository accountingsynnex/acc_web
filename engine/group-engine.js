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
  const dpi = findCol(headers, ['department', 'dept', 'cost center', 'costcentre', 'cost centre', 'แผนก', 'ศูนย์ต้นทุน']);
  if (ci === -1) throw new Error('ไม่พบคอลัมน์รหัสบัญชี (MainAccount / Account / รหัส)');

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
  const deptRows = [];
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
    if (dpi !== -1) {
      const dept = String(cells[dpi] == null ? '' : cells[dpi]).trim();
      // These exports name the account "STAFF SALARIES-Marketing", i.e. the
      // department's own label is the suffix — the only place a readable
      // department name exists, since the Department column holds just a code.
      if (dept) deptRows.push({ code, dept, name, deptName: name.includes('-') ? name.slice(name.lastIndexOf('-') + 1).trim() : '', closing, opening });
    }
    const cur = byCode.get(code);
    if (cur) { cur.closing += closing; if (opening != null) cur.opening = (cur.opening || 0) + opening; if (!cur.name && name) cur.name = name; }
    else byCode.set(code, { code, name, closing, opening });
  }
  return { rows: [...byCode.values()], deptRows, columns: { code: ci, name: ni, closing: cli, opening: oi, debit: di, credit: cri, dept: dpi } };
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
  // locate the header row (has an account-code column and an amount column)
  let hr = -1, col = {};
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const cells = (matrix[r] || []).map(x => String(x == null ? '' : x).trim().toLowerCase());
    const codeI = cells.findIndex(x => x.includes('account code') || x === 'code' || x.includes('รหัส'));
    const amtI = cells.findIndex(x => x.includes('dr.') || x.includes('dr/') || x.includes('debit') || x.includes('cr.'));
    if (codeI !== -1 && amtI !== -1) {
      hr = r;
      col = {
        code: codeI, amount: amtI,
        desc: cells.findIndex(x => x.includes('description') || x.includes('รายการ')),
        name: cells.findIndex(x => x.includes('name') || x.includes('ชื่อ')),
        no: cells.findIndex(x => x === 'no.' || x === 'no' || x.includes('เลขที่')),
      };
      break;
    }
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

const GroupEngine = { parseTB, buildRows, validateTB, applyRulebook, parseJournals, journalEffect, toNumber };
if (typeof module !== 'undefined') module.exports = GroupEngine;
