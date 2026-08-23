/* Store smoke test — per-period journals, the piece that lets an archived
   period carry its own eliminations instead of only ever the live close's.
   Run: node test/store.test.js  */
const { Store } = require('../app/store.js');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) failures++; };

const j = (id, source, code, amount) => ({ id, source, description: '', lines: [{ code, name: '', amount }], net: amount });

// 1) journalsFor / journals(periodKey) — '' (default) is the live set, a real
// key is that period's own, auto-created (mirroring tbFor's own behaviour).
Store.setJournals([j('L1', 'Eliminate', '1110000', -100)], ['Eliminate']);
ok(Store.journals().length === 1, 'live journals set with no periodKey');
ok(Store.journals('2025-06').length === 0, "a fresh period starts with no journals of its own");
Store.setJournals([j('P1', 'Eliminate', '2110000', 50)], ['Eliminate'], '2025-06');
ok(Store.journals('2025-06').length === 1 && Store.journals().length === 1,
   'setting a period\'s journals leaves the live set untouched');

// 2) finalRows(periodKey) — combining + that period's OWN journals, not the
// live ones. The bug this exists to catch: an archived period silently
// picking up the live close's eliminations (or vice versa).
Store.data.tb = { SYN: { fileName: 'live.csv', rows: [{ code: '1110000', name: 'Cash', closing: 1000, opening: null }] } };
Store.tbFor('2025-06').SYN = { fileName: 'jun.csv', rows: [{ code: '2110000', name: 'AP', closing: -500, opening: null }] };
const liveFinal = Store.finalRows();
const periodFinal = Store.finalRows('2025-06');
ok(liveFinal.find(r => r.code === '1110000').closing === 900, `live final applies the live journal (got ${liveFinal.find(r => r.code === '1110000').closing})`);
ok(!liveFinal.some(r => r.code === '2110000'), 'live final does not see the archived period\'s own row or journal');
ok(periodFinal.find(r => r.code === '2110000').closing === -450, `period final applies its OWN journal (got ${periodFinal.find(r => r.code === '2110000').closing})`);
ok(!periodFinal.some(r => r.code === '1110000'), 'period final does not see the live TB or the live journal');

// 3) removeJournalsBySource(sources, periodKey) — the undo half of a
// workbook import must stay scoped to the period it targeted.
const removed = Store.removeJournalsBySource(['Eliminate'], '2025-06');
ok(removed === 1 && Store.journals('2025-06').length === 0, `removed ${removed} from the period only`);
ok(Store.journals().length === 1, 'the live journal survived a period-scoped removal');

// 4) archivePeriod carries the live journals into the snapshot, so a period
// saved via "บันทึกงวดนี้" (not a straight workbook drop) still has them.
Store.archivePeriod('2025-07', 'Jul 2025');
ok(Store.journals('2025-07').length === 1 && Store.journals('2025-07')[0].id === 'L1',
   'archivePeriod snapshots the live journals into the new period');
Store.addJournal({ id: 'L2', source: 'บันทึกเอง', description: '', lines: [], net: 0 });
ok(Store.journals('2025-07').length === 1, 'archiving is a one-time snapshot — a later live journal does not retroactively appear in it');

// 5) uiPeriod()/setUiPeriod() — the page-wide "which period am I viewing"
// selection the shared topbar picker writes to (Statements, Cash Flow,
// Cost Center, ...). Plain persisted state; '' means live.
ok(Store.uiPeriod() === '', 'uiPeriod defaults to live (empty string)');
Store.setUiPeriod('2025-07');
ok(Store.uiPeriod() === '2025-07', 'setUiPeriod is read back by uiPeriod');
Store.setUiPeriod('');
ok(Store.uiPeriod() === '', 'setUiPeriod(\'\') returns to live');

// 6) deptRows/hasDeptData/hasData(periodKey) — Cost Center's department
// detail, now readable per-period the same way TB itself already was.
Store.data.tb = { SYN: { fileName: 'live.csv', rows: [{ code: '1110000', name: 'Cash', closing: 1000, opening: null }] } };
ok(Store.hasData() === true && Store.hasData('2099-01') === false, 'hasData(periodKey) checks that period, not always live');
ok(Store.hasDeptData() === false, 'live TB above has no department rows yet');
Store.setTB('SYN', 'live-dept.csv', [{ code: '6100000', name: 'RENT-Sales', closing: 500, opening: null }], '', [{ code: '6100000', name: 'RENT-Sales', dept: 'D1', deptName: 'Sales', closing: 500 }], 'TB SYN_TW');
Store.setTB('SYN', 'jun-dept.csv', [{ code: '6100000', name: 'RENT-Ops', closing: 200, opening: null }], '2025-06', [{ code: '6100000', name: 'RENT-Ops', dept: 'D2', deptName: 'Ops', closing: 200 }], 'TB SYN_TW');
ok(Store.hasDeptData() === true, 'hasDeptData(live) true once the live TB carries department rows');
ok(Store.hasDeptData('2025-06') === true, 'hasDeptData(periodKey) true for that period independently');
ok(Store.hasDeptData('2025-07') === false, 'a period with no department rows of its own reads false, not the live TB\'s');
const liveDept = Store.deptRows();
const juneDept = Store.deptRows('2025-06');
ok(liveDept.rows.length === 1 && liveDept.rows[0].dept === 'D1', 'deptRows() (live) returns only the live period\'s own department rows');
ok(juneDept.rows.length === 1 && juneDept.rows[0].dept === 'D2', 'deptRows(periodKey) returns only that period\'s own department rows');

// 7) exportJournals/importJournals(periodKey) — the journals backup/restore
// buttons, now scoped so restoring into an archived period can't silently
// wipe or dump the live set instead.
Store.setJournals([j('E1', 'Eliminate', '3000000', 10)], ['Eliminate'], '2025-06');
const exported = Store.exportJournals('2025-06');
ok(exported.journals.length === 1 && exported.journals[0].id === 'E1', 'exportJournals(periodKey) exports that period\'s own journals');
const beforeLive = Store.journals().length;
Store.importJournals({ journals: [{ id: 'R1', lines: [{ code: '9999999', amount: 42 }] }] }, '2025-06');
ok(Store.journals('2025-06').length === 1 && Store.journals('2025-06')[0].id === 'R1', 'importJournals(payload, periodKey) replaces that period\'s own journals');
ok(Store.journals().length === beforeLive, 'importJournals into a period leaves the live journal set untouched');

/* 4) exportAll / importAll — the whole-workspace backup. Everything lives in
   one browser's localStorage, so this round trip is the only thing standing
   between a cleared browser and a re-imported year. */
Store.data.mappings['7777777'] = { statement: 'PL', section: 'Revenue', group: 'Test' };
const backup = JSON.parse(JSON.stringify(Store.exportAll()));      // as it would survive a file
ok(backup.format === 'fs-close-workspace' && backup.formatVersion === 1, 'export is stamped as a workspace backup');
ok(backup.periods.includes('2025-06'), 'export lists the periods it carries');

const snapshot = JSON.stringify(Store.data);
Store.clearAll();
ok(Store.listPeriods('all').length === 0 && !Store.mappings()['7777777'], 'clearAll really empties the workspace');

const restored = Store.importAll(backup);
ok(restored.ok && !restored.merged, 'importAll restores by replacing');
ok(JSON.stringify(Store.data) === snapshot, 'the restored workspace is byte-identical to the backup');

// A file that isn't ours must be refused OUTRIGHT — a half-applied restore
// over a live close is worse than no restore.
const guarded = JSON.stringify(Store.data);
for (const junk of [null, {}, { format: 'something-else', data: {} }, { format: 'fs-close-workspace', formatVersion: 99, data: { tb: {} } }, { format: 'fs-close-workspace', formatVersion: 1, data: { nope: 1 } }]) {
  const r = Store.importAll(junk);
  ok(!r.ok && !!r.error, `importAll refuses ${JSON.stringify(junk)?.slice(0, 46)}`);
}
ok(JSON.stringify(Store.data) === guarded, 'a refused restore leaves the workspace exactly as it was');

// Merge keeps what this browser already has and adds only what it lacks.
const twoPeriods = JSON.parse(JSON.stringify(Store.exportAll()));
twoPeriods.data.periods['2025-03'] = { key: '2025-03', label: 'Mar', savedAt: '', tb: {}, journals: [] };
twoPeriods.data.periods['2025-06'] = Object.assign({}, twoPeriods.data.periods['2025-06'], { label: 'OVERWRITTEN' });
const merged = Store.importAll(twoPeriods, { merge: true });
ok(merged.ok && merged.merged, 'importAll merges when asked');
ok(merged.added.includes('2025-03') && merged.kept.includes('2025-06'), 'merge adds the missing period and keeps the existing one');
ok(Store.getPeriod('2025-06').label !== 'OVERWRITTEN', 'merge does not overwrite a period this browser already holds');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
