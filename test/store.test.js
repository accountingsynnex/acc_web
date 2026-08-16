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

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
