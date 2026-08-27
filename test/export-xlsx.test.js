/* export-xlsx.js — the Excel workbook, and reading it back in.
 *
 * The round trip is the risky half. Exporting a wrong number is visible; a
 * READER that mis-parses one is not — the file re-imports without complaint
 * and the close continues on figures nobody typed. So the test that matters
 * is: build a workbook from known state, edit a cell the way an accountant
 * would in Excel, read it back, and assert the edit — and only the edit —
 * survived.
 *
 * Statement sheets (Conso BS, Conso PL, Cash Flow, ...) are OUTPUT and are
 * deliberately not read back; only TB and journal sheets are inputs. That
 * asymmetry is the thing most likely to be "fixed" by someone who has not
 * read this, so it is asserted below.
 */
'use strict';
const { suite, loadApp, row } = require('./helpers.js');
const { RULEBOOK, Store } = loadApp();
global.XLSX = require('../app/vendor/xlsx.full.min.js');
global.APP_BUILD = 'test';
const ConsoExport = require('../app/export-xlsx.js');

const { ok, near, eq, done } = suite('export-xlsx.js — Excel export and round trip');

const codeFor = pred => Object.entries(RULEBOOK.rules).find(([, r]) => pred(r))[0];
const cashCode = codeFor(r => r.section === 'Current Assets' && /cash/i.test(r.group));
const arCode = codeFor(r => r.section === 'Current Assets' && /receivab/i.test(r.group));
const apCode = codeFor(r => r.section === 'Current Liabilities' && /payable/i.test(r.group));
const eqCode = codeFor(r => r.section === 'Equity' && !/retain|profit|จัดสรร/i.test(r.group));

const ENT = RULEBOOK.entities[0].code;
const START_CASH = 1234567.89;

Store.data = { schema: Store.SCHEMA, tb: {}, mappings: {}, journals: [], periods: {}, workbooks: {} };
Store.setTB(ENT, 'source.csv', [
  row(cashCode, 'CASH', START_CASH),
  row(arCode, 'TRADE RECEIVABLE', 500000),
  row(apCode, 'TRADE PAYABLE', -700000),
  row(eqCode, 'SHARE CAPITAL', -1034567.89),
]);
Store.setJournals([{
  id: 'Eliminate::E1', source: 'Eliminate', description: 'intercompany',
  lines: [{ code: arCode, name: 'AR', amount: -100000 }, { code: apCode, name: 'AP', amount: 100000 }],
  net: 0, enabled: true,
}], ['Eliminate']);

// --- build ---------------------------------------------------------------
// build() returns { wb, meta } — the caller needs the metadata for the
// download filename, so the workbook is one field of it, not the result.
const built = ConsoExport.build('');
const wb = built.wb;
ok(wb && wb.SheetNames.length > 0, 'build() returns a workbook');
ok(built.meta && built.meta.periodLabel, 'and the metadata the download filename is built from');
const sheets = wb.SheetNames;
ok(sheets.some(n => /_Export info/i.test(n)), 'it carries the cover sheet that identifies it as ours');
ok(sheets.some(n => /Conso BS/i.test(n)), 'a consolidated balance sheet');
ok(sheets.some(n => /Conso PL/i.test(n)), 'a consolidated P&L');
ok(sheets.some(n => /Cash Flow/i.test(n)), 'a cash flow statement');
ok(sheets.some(n => n === `TB ${ENT}`), `a trial balance sheet for ${ENT}`);
ok(sheets.some(n => /Eliminate/i.test(n)), 'a sheet for the elimination source');

// It has to survive a real write/read cycle, not just live in memory.
const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
ok(bytes && bytes.length > 0, 'the workbook writes to xlsx bytes');
const reread = XLSX.read(bytes, { type: 'buffer' });
eq(reread.SheetNames.length, sheets.length, 'and reads back with every sheet intact');

// --- parse ---------------------------------------------------------------
const parsed = ConsoExport.parse(reread, 'export.xlsx');
ok(parsed && parsed.ok !== false, `parse() accepts our own export${parsed && parsed.error ? ' — ' + parsed.error : ''}`);
ok(parsed.entities[ENT], `it reads the ${ENT} trial balance back`);
const cashBack = parsed.entities[ENT].rows.find(r => String(r.code) === String(cashCode));
near(cashBack.closing, START_CASH, 'and the cash balance survives the round trip to the satang');
eq(parsed.journals.length, 1, 'the elimination entry comes back too');

// --- a workbook that is not ours is refused ------------------------------
const stranger = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(stranger, XLSX.utils.aoa_to_sheet([['Account', 'Balance'], ['1110000', 100]]), 'Sheet1');
const rejected = ConsoExport.parse(stranger, 'random.xlsx');
ok(!rejected || rejected.ok === false, 'a workbook without the cover sheet is refused, not half-read');

// --- the edit-in-Excel path ---------------------------------------------
/* What an accountant actually does: open the file, change one balance, save,
   drop it back on Import. The new figure must be what the app then uses. */
const EDITED = 998482.55;
const tbSheet = reread.Sheets[`TB ${ENT}`];
const aoa = XLSX.utils.sheet_to_json(tbSheet, { header: 1, raw: true, defval: null });
let edits = 0;
for (const r of aoa) {
  if (r && String(r[0]) === String(cashCode)) {
    for (let c = 1; c < r.length; c++) if (typeof r[c] === 'number' && Math.abs(r[c] - START_CASH) < 0.005) { r[c] = EDITED; edits++; }
  }
}
eq(edits, 1, 'exactly one cell in the TB sheet held the cash balance to edit');
reread.Sheets[`TB ${ENT}`] = XLSX.utils.aoa_to_sheet(aoa);

const afterEdit = ConsoExport.parse(reread, 'edited.xlsx');
const editedRow = afterEdit.entities[ENT].rows.find(r => String(r.code) === String(cashCode));
near(editedRow.closing, EDITED, 'the edited balance is what comes back');
const untouched = afterEdit.entities[ENT].rows.find(r => String(r.code) === String(arCode));
near(untouched.closing, 500000, 'and the rows nobody touched are unchanged');

// --- restore writes it into the workspace --------------------------------
ConsoExport.restore(afterEdit, { periodKey: '' });
const live = Store.tb(ENT, '').rows.find(r => String(r.code) === String(cashCode));
near(live.closing, EDITED, 'restore() puts the edited figure into the live period');
eq(Store.journals('').length, 1, 'and restores the journals with it');

// --- statement sheets are output, not input ------------------------------
/* Editing a computed statement must not feed back: those figures are derived
   from the TB, and a reader that accepted them would let two sources of
   truth disagree silently. */
ok(!Object.keys(afterEdit.entities).some(k => /Conso|Cash Flow|Ratio/i.test(k)),
   'no statement sheet is read back as if it were a trial balance');

done();
