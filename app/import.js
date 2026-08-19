/* Import page — wire real CSV upload to the grouping engine.
   Globals: RULEBOOK (rulebook.js), parseTB/validateTB/applyRulebook
   (group-engine.js), Store (store.js). Shared state lives in Store so
   mappings saved on the Mapping page auto-apply here. */
(function () {
  const ENTITIES = RULEBOOK.entities.length ? RULEBOOK.entities : [
    { code: 'SYN', name: 'SYNNEX (Thailand)' }, { code: 'SVP', name: 'Service Point' },
    { code: 'SYNIN', name: 'SYNNEX Incubation' }, { code: 'SWOP', name: 'Swop Mart' },
  ];
  let filter = 'all', pendingEntity = null;
  // '' = the live/current period every other page reads. Anything else
  // targets an archived period's own tb (and journals) directly — for
  // uploading a prior period's whole workbook straight in, instead of
  // loading it as "current" and archiving a copy. A workbook dropped here
  // is read exactly the same way as the live close, elimination/AJE sheets
  // included, so Ratios' trend can show that period's real consolidated
  // position rather than a raw pre-elimination combine. Only Ratios reads
  // archived periods at all; every other page (Mapping, Journals,
  // Statements, ...) always reads the live one, so switching this never
  // disturbs the active close.
  let activePeriod = '';
  // Guards the batch importer below against overlapping itself — it drives
  // activePeriod across an async loop, and a second batch (or a manual
  // switcher change) starting mid-loop would race it and write a file into
  // the wrong period.
  let batchRunning = false;
  /* Where a months-in-one-workbook file lands: 'separate' gives each month a
     period key of its own so the periods the statements are built from stay
     untouched, 'normal' writes that entity's TB straight into them. Defaults
     to separate — the destructive one has to be picked. */
  let monthMode = 'separate';

  const $ = id => document.getElementById(id);

  // A whole-year drop names every file after its own month, in one of a
  // few forms seen across real workbooks so far: "...2025122025..." (year +
  // month + the same year again, no separator), "...202501__2025..." or
  // "...2025-06-2025..." (same triple, with separators). Stripping
  // non-digits first and matching year-month-year as one run handles all of
  // those the same way; a plain "YYYY-MM"/"YYYY_MM" is tried as a fallback
  // for a filename that doesn't repeat the year. Returns null rather than
  // guessing when neither shows up, so an unrecognised name is skipped and
  // reported instead of landing in the wrong period.
  function periodKeyFromFilename(name) {
    const digits = String(name).replace(/\D/g, '');
    const rep = /(\d{4})(\d{2})\1/.exec(digits);
    if (rep) {
      const mo = +rep[2];
      if (mo >= 1 && mo <= 12) return `${rep[1]}-${String(mo).padStart(2, '0')}`;
    }
    const plain = /(20\d{2})[-_. ]?(\d{2})(?!\d)/.exec(String(name));
    if (plain) {
      const mo = +plain[2];
      if (mo >= 1 && mo <= 12) return `${plain[1]}-${String(mo).padStart(2, '0')}`;
    }
    return null;
  }

  const { periodKeyFromSheetName, labelFromKey } = MonthTB;
  const TH_MONTHS = MonthTB.TH_MONTHS;
  const money = n => {
    const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? '(' + a + ')' : a;
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const balancedOf = ent => { const t = Store.tb(ent, activePeriod); return t ? validateTB(t.rows, 5) : null; };

  function ingest(entityCode, file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { rows, deptRows, dimNames } = parseTB(reader.result);
        if (!rows.length) throw new Error('ไม่พบแถวบัญชีในไฟล์');
        Store.setTB(entityCode, file.name, rows, activePeriod, deptRows, '', dimNames);
      } catch (e) { alert(`อ่านไฟล์ของ ${entityCode} ไม่ได้: ${e.message}`); }
      renderAll();
    };
    reader.readAsText(file);
  }

  // A single-entity .xlsx dropped on a specific entity's slot: prefer that
  // entity's "TB <code>" sheet if the file happens to have one (e.g. the
  // big combined workbook dropped on the wrong slot), otherwise fall back to
  // the first sheet — covers a plain single-sheet TB export, which is a
  // normal shape for a standalone monthly file and was previously always
  // routed into ingestWorkbook() (which only recognizes the combined
  // workbook's sheet names) and silently imported nothing.
  function ingestEntityXlsx(entityCode, file) {
    if (typeof XLSX === 'undefined') { alert('ตัวอ่าน Excel ยังไม่พร้อม'); return; }
    const reader = new FileReader();
    reader.onerror = () => alert('อ่านไฟล์ไม่ได้');
    reader.onload = () => setTimeout(() => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), {
          type: 'array', cellStyles: false, cellFormula: false, cellHTML: false, cellNF: false, bookVBA: false,
        });
        // Hyphens/underscores count as the same separator as a space — the
        // company's own monthly files vary between "TB SYN" and "TB-SYN"
        // across different periods' templates.
        const norm = s => String(s).trim().replace(/[\s_-]+/g, ' ').toUpperCase();
        const wanted = 'TB ' + entityCode.toUpperCase();
        // A file holding one sheet per month ("Jan 26" … "Jul 26") names no
        // sheet after the entity, and taking the first one would import
        // January no matter which period was selected — silently, since the
        // rows parse perfectly well. The period being imported into already
        // says which month is wanted, so it picks the matching sheet.
        const entitySheet = wb.SheetNames.find(n => norm(n) === wanted);
        // Several month-named sheets and no sheet named after the entity: the
        // file is a run of months, not one period, so each sheet goes to its
        // own period in one drop — the same thing the workbook drop zone does
        // for a folder of monthly files, for a workbook that keeps the months
        // inside itself instead.
        const months = MonthTB.monthSheetsOf(wb, entityCode);
        if (months.length) { ingestMonthSheets(entityCode, file, wb, months); return; }
        const sheetName = entitySheet
          || wb.SheetNames.find(n => periodKeyFromSheetName(n) === activePeriod)
          || wb.SheetNames[0];
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
        const { rows, deptRows, dimNames } = buildRows(aoa);
        if (!rows.length) throw new Error('ไม่พบแถวบัญชีในไฟล์');
        Store.setTB(entityCode, file.name + ' › ' + sheetName, rows, activePeriod, deptRows, deptRows.length ? sheetName : '', dimNames);
      } catch (e) { alert(`อ่านไฟล์ของ ${entityCode} ไม่ได้: ${e.message}`); }
      renderAll();
    }, 30);
    reader.readAsArrayBuffer(file);
  }

  /* One company's trial balance for several months, a sheet each, split into
     one saved period per sheet — the shared reader in month-import.js does
     the work, so Cost Center's own upload lands the months identically. */
  function ingestMonthSheets(entityCode, file, wb, months) {
    const separate = monthMode === 'separate';
    const plan = MonthTB.planFor(months, separate);
    if (!confirm(MonthTB.confirmText(entityCode, plan, separate))) return;
    const result = MonthTB.run(entityCode, file.name, wb, plan);
    alert(MonthTB.resultText(entityCode, result));
    renderAll();
  }

  const isXlsx = f => /\.xlsx?$/i.test(f.name);

  function resetWbDrop() {
    $('wbDrop').classList.remove('busy');
    renderWorkbook();
  }

  /* Which entities are currently fed by the remembered workbook. Derived from
     each TB's own file name rather than the note's entity list, so replacing a
     single company with its own CSV afterwards drops it out of the count on
     its own — and removing the workbook then only takes back what it still
     owns, never the file that replaced it. */
  function wbEntities(rec) {
    return ENTITIES.map(e => e.code).filter(code => {
      const s = Store.tb(code, activePeriod);
      return s && String(s.fileName).startsWith(rec.fileName + ' › ');
    });
  }
  const wbJournals = rec => Store.journals(activePeriod).filter(j => (rec.journalSources || []).includes(j.source));

  function renderWorkbook() {
    const drop = $('wbDrop'), rec = Store.workbook(activePeriod);
    const ents = rec ? wbEntities(rec) : [];
    if (rec && !ents.length) Store.clearWorkbook(activePeriod);   // every company it loaded is gone
    if (!ents.length) {
      drop.classList.remove('loaded');
      $('wbTag').hidden = false;
      $('wbRemove').hidden = true;
      $('wbT').textContent = 'อัปโหลด Workpaper ทั้งไฟล์ (.xlsx)';
      $('wbD').textContent = 'ลากไฟล์งบ Conso ทั้งไฟล์มาวาง — ระบบแยก TB ทุกบริษัท (SYN · SVP · SYNIN · SWOP) ให้อัตโนมัติ';
      return;
    }
    drop.classList.add('loaded');
    $('wbTag').hidden = true;
    $('wbRemove').hidden = false;
    $('wbT').textContent = rec.fileName;
    const jc = wbJournals(rec).length;
    const bits = [`TB ${ents.length} บริษัท (${ents.join(' · ')})`];
    if (jc) bits.push(`${jc} journal`);
    if (rec.deptSource) bits.push(`มิติแผนกจากชีต ${rec.deptSource}`);
    $('wbD').textContent = `นำเข้าไว้แล้วเมื่อ ${new Date(rec.savedAt).toLocaleString('th-TH')} — ${bits.join(' · ')} · อัปไฟล์ใหม่ทับได้เลย`;
  }

  function removeWorkbook() {
    const rec = Store.workbook(activePeriod);
    if (!rec) return;
    const ents = wbEntities(rec), jc = wbJournals(rec).length;
    const what = [`TB ${ents.length} บริษัท`].concat(jc ? [`รายการตัดบัญชี/ปรับปรุง ${jc} journal`] : []).join(' และ ');
    if (!confirm(`เอาไฟล์ "${rec.fileName}" ออก?\n\nจะลบ${what ? ' ' + what : 'ข้อมูล'}ที่นำเข้าจากไฟล์นี้\nผังบัญชีที่จับคู่ไว้ งวดที่บันทึกไว้ และรายการที่คีย์เอง ยังอยู่ครบ`)) return;
    ents.forEach(code => Store.removeTB(code, activePeriod));
    Store.removeJournalsBySource(rec.journalSources, activePeriod);
    Store.clearWorkbook(activePeriod);
    renderAll();
  }

  // Each entity's adjustment workpaper — named consistently across the
  // months seen so far. The elimination sheet is not in this list: its own
  // name varies (see elimSheetName below), so it's found separately.
  const AJE_SHEETS = ['AJE+RJE-Synnex', 'AJE+RJE-SVP', 'AJE+RJE-SWOPMART', 'AJE+RJE-Audit'];

  // Hyphens/underscores count as the same separator as a space. The
  // company's own workbook varies this across months/eras — "TB SYN" some
  // months, "TB-SYN" others — for a sheet that is otherwise identical.
  const normSheet = s => String(s).trim().replace(/[\s_-]+/g, ' ').toUpperCase();

  // An entity's own sheet name follows its CODE (below) for every entity
  // except when the entity itself was legally renamed — SYNIN's TB sheet is
  // "TB-INFINIT" from the month it became "Infinit Partners Co.,Ltd."
  // onward, same company and account codes, just a new name over the same
  // Store entity code so its history keeps lining up under one code.
  const ENTITY_SHEET_ALIASES = { SYNIN: ['INFINIT'] };

  // The elimination sheet's name has been "Eliminate", "Elimiate" (a
  // recurring typo in the company's own template) and "Elimiate + RJE" —
  // matched by prefix so all three (and whatever the next variant turns out
  // to be) are found the same way — or, in an older era of the template,
  // "RECORD" (its journal entries sit there instead, one sheet for every
  // entity's eliminations/adjustments rather than split across "Eliminate"
  // + several "AJE+RJE-*" sheets).
  const findElimSheet = names => names.find(n => /^ELIMI/.test(normSheet(n)) || normSheet(n) === 'RECORD') || null;

  // Read the whole consolidation workbook: split out each entity's TB sheet
  // and parse the elimination/adjustment journals into double-entry lines.
  // notify defaults to alert (a single dropped file); the batch importer
  // below passes a collector instead, so importing 12 files doesn't pop 12
  // blocking dialogs — and awaits the returned promise to run them one at a
  // time rather than all at once.
  function ingestWorkbook(file, notify = alert) {
    return new Promise(resolve => {
    if (typeof XLSX === 'undefined') { notify('ตัวอ่าน Excel ยังไม่พร้อม'); resolve(); return; }
    $('wbDrop').classList.add('busy');
    $('wbDrop').classList.remove('loaded');       // the previous file's receipt is about to be replaced
    $('wbRemove').hidden = true;
    $('wbTag').hidden = false;
    $('wbT').textContent = 'กำลังอ่านและแยกไฟล์…';
    $('wbD').textContent = file.name;
    const reader = new FileReader();
    reader.onerror = () => { notify('อ่านไฟล์ไม่ได้'); resetWbDrop(); resolve(); };
    reader.onload = () => setTimeout(() => {          // yield so the "reading" state paints first
      try {
        // Parse only the entity TB + journal sheets and cap rows — the workbook
        // is ~25 MB and TB SYN spans Excel's full 1M-row range, so this keeps
        // it to ~6s. Sheet names come first — bookSheets skips worksheet
        // parsing, so it's cheap — so every real name (an entity's TB, its
        // department-detail variant, the elimination sheet under whatever
        // its name is this month) is known before the restricted real read,
        // rather than assumed and then silently unmatched.
        const names = XLSX.read(new Uint8Array(reader.result), { type: 'array', bookSheets: true }).SheetNames || [];

        const entitySheet = {};      // entity code -> real sheet name, or null
        const deptVariant = {};      // entity code -> its "_TW"-style variant, or null
        for (const ent of ENTITIES) {
          const bases = ['TB ' + ent.code.toUpperCase()].concat((ENTITY_SHEET_ALIASES[ent.code] || []).map(a => 'TB ' + a));
          entitySheet[ent.code] = names.find(n => bases.includes(normSheet(n))) || null;
          // The department dimension usually lives in its own sheet next to
          // the entity's TB ("TB SYN_TW" beside "TB SYN"). The separator
          // check on the character right after the base matters — without
          // it "TB SYNIN" would look like a variant of "TB SYN".
          deptVariant[ent.code] = names.find(n => {
            const u = normSheet(n);
            return !bases.includes(u) && bases.some(b => u.startsWith(b) && / /.test(u[b.length]));
          }) || null;
        }
        const elimSheetName = findElimSheet(names);
        const ajeSheetNames = AJE_SHEETS.map(sh => names.find(n => normSheet(n) === normSheet(sh))).filter(Boolean);
        const journalSheetNames = (elimSheetName ? [elimSheetName] : []).concat(ajeSheetNames);

        const wanted = Object.values(entitySheet).filter(Boolean)
          .concat(Object.values(deptVariant).filter(Boolean))
          .concat(journalSheetNames);
        const readOpts = {
          type: 'array', sheetRows: 5000,
          cellStyles: false, cellFormula: false, cellHTML: false, cellNF: false, bookVBA: false,
        };
        if (wanted.length) readOpts.sheets = wanted;   // restrict only once something was actually found
        const wb = XLSX.read(new Uint8Array(reader.result), readOpts);

        const added = [], skipped = [];
        let deptSheet = '';
        for (const ent of ENTITIES) {
          const sheetName = entitySheet[ent.code];
          if (!sheetName) { skipped.push(`${ent.code} (ไม่พบชีต TB ในไฟล์นี้)`); continue; }
          // A company's own sheet is occasionally not a trial balance at all
          // — seen in a real file where "TB SWOP" held an unrelated income-
          // statement report for one month. That must not sink the other
          // three companies or the journals below, so it's isolated here and
          // reported once at the end instead of aborting the whole import.
          try {
            const read = n => buildRows(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }));
            const { rows, deptRows, dimNames } = read(sheetName);
            let dept = deptRows, deptSource = deptRows.length ? sheetName : '', dims = dimNames;
            if (!dept.length && deptVariant[ent.code]) {
              const got = read(deptVariant[ent.code]);
              if (got.deptRows.length) { dept = got.deptRows; deptSource = deptVariant[ent.code]; dims = got.dimNames; }
            }
            if (rows.length) {
              Store.setTB(ent.code, file.name + ' › ' + sheetName, rows, activePeriod, dept, deptSource, dims);
              added.push(ent.code);
              if (deptSource && !deptSheet) deptSheet = deptSource;
            } else {
              skipped.push(`${ent.code} (ชีต "${sheetName}" ไม่มีแถวบัญชี)`);
            }
          } catch (e) {
            skipped.push(`${ent.code} (ชีต "${sheetName}": ${e.message})`);
          }
        }
        if (!added.length) notify('ไม่พบชีต TB รายบริษัท (TB SYN / TB SVP / TB SYNIN / TB SWOP) ในไฟล์นี้');
        else if (skipped.length) notify(`นำเข้าได้ ${added.length} บริษัท แต่ข้าม: ${skipped.join(', ')}`);

        // An archived period gets its own Eliminate/AJE sheets read the same
        // way the live close does — its journals live alongside its tb
        // (Store.journalsFor), so Ratios' trend can show that period's real
        // consolidated position instead of a raw pre-elimination combine.
        let journals = [];
        for (const sheetName of journalSheetNames) {
          try {
            const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
            journals = journals.concat(parseJournals(aoa, sheetName));
          } catch (e) { /* one bad journal sheet shouldn't drop the rest */ }
        }
        Store.setJournals(journals, journalSheetNames, activePeriod);

        // Remember the file itself, not just its rows, so the drop zone can
        // report "already imported" on the next visit and undo it in one click.
        if (added.length) {
          Store.setWorkbook(activePeriod, {
            fileName: file.name,
            savedAt: new Date().toISOString(),
            entities: added,
            deptSource: deptSheet,
            journalSources: journalSheetNames,
          });
        }
      } catch (e) { notify('อ่านไฟล์ Excel ไม่ได้: ' + e.message); }
      resetWbDrop(); renderAll();
      resolve();
    }, 30);
    reader.readAsArrayBuffer(file);
    });
  }

  // Several files dropped/selected at once — a whole year's worth of monthly
  // workbooks in one go, instead of switching the period dropdown and
  // dropping one file, 12 times over. Each file becomes (or updates) its OWN
  // saved period, auto-keyed and auto-created from the month in its own
  // filename — never the live/current period, so a bulk drop can't silently
  // overwrite the close actually being worked on. Sequential, not parallel:
  // each workbook is several MB and briefly owns `activePeriod` while it's
  // being read, so running them one at a time (awaiting ingestWorkbook's
  // promise) is what keeps that shared variable pointed at the right period.
  async function ingestWorkbooksBatch(files, skippedNonXlsx) {
    if (batchRunning) { alert('กำลังนำเข้าไฟล์ชุดก่อนหน้าอยู่ กรุณารอให้เสร็จก่อน'); return; }
    batchRunning = true;
    $('periodSwitcher').disabled = true;
    const prevActive = activePeriod;
    const notes = skippedNonXlsx ? [`ข้ามไฟล์ที่ไม่ใช่ .xlsx ${skippedNonXlsx} ไฟล์`] : [];
    let recognized = 0;
    try {
      for (const file of files) {
        const key = periodKeyFromFilename(file.name);
        if (!key) { notes.push(`"${file.name}" — แยกรหัสงวด (ปี-เดือน) จากชื่อไฟล์ไม่ได้ ข้ามไฟล์นี้`); continue; }
        if (!Store.getPeriod(key)) { Store.tbFor(key); Store.setPeriodLabel(key, labelFromKey(key)); }
        activePeriod = key;
        recognized++;
        await ingestWorkbook(file, msg => notes.push(`งวด ${key} (${file.name}): ${msg}`));
      }
    } finally {
      activePeriod = prevActive;
      batchRunning = false;
      $('periodSwitcher').disabled = false;
      renderPeriodSwitcher(); renderPeriods(); renderAll();
    }
    alert(`นำเข้า ${recognized}/${files.length} ไฟล์เป็นงวดที่บันทึกไว้แล้ว (แยกงวดจากชื่อไฟล์อัตโนมัติ) — ใช้ดูแนวโน้มที่หน้า Ratios${notes.length ? `\n\n${notes.join('\n')}` : ''}`);
  }

  // A single file keeps the original one-file flow untouched (imports into
  // whichever period the switcher is currently on); more than one always
  // goes through the batch path above, which only ever touches periods of
  // its own — untagged non-.xlsx files are dropped silently there rather
  // than raising one alert per stray file.
  function handleWorkbookFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length === 1) { ingestWorkbook(files[0]); return; }
    const xlsxFiles = files.filter(isXlsx);
    if (!xlsxFiles.length) { alert('ไม่พบไฟล์ .xlsx ในไฟล์ที่เลือก'); return; }
    ingestWorkbooksBatch(xlsxFiles, files.length - xlsxFiles.length);
  }

  async function loadSamples() {
    const files = { SVP: 'TB_SVP_2026-06.csv', SYNIN: 'TB_SYNIN_2026-06.csv', SWOP: 'TB_SWOP_2026-06.csv', SYN: 'TB_SYN_2026-06.csv' };
    for (const [ent, fn] of Object.entries(files)) {
      try {
        let text = null;
        if (typeof SAMPLES !== 'undefined' && SAMPLES[ent]) text = SAMPLES[ent].text;   // works offline (file://)
        else { const res = await fetch('../test/' + fn); if (res.ok) text = await res.text(); }
        if (!text) continue;
        const { rows, deptRows, dimNames } = parseTB(text);
        if (rows.length) Store.setTB(ent, fn, rows, activePeriod, deptRows, '', dimNames);
      } catch (e) { /* skip */ }
    }
    renderAll();
  }

  function renderUploads() {
    $('uploads').innerHTML = ENTITIES.map(ent => {
      const s = Store.tb(ent.code, activePeriod);
      if (s) {
        const v = validateTB(s.rows, 5);
        return `<div class="up" data-ent="${ent.code}">
          <div class="ent"><span class="code">${esc(ent.code)}</span>
            <button class="remove" data-remove="${ent.code}" title="เอาไฟล์ออก">✕</button></div>
          <div class="file">${esc(s.fileName)}</div>
          <div class="meta"><span>${s.rows.length.toLocaleString()} รหัส</span>
            <span class="chip ${v.balanced ? 'good' : 'bad'}"><span class="dot"></span>${v.balanced ? 'Debit = Credit' : 'ไม่สมดุล'}</span></div>
        </div>`;
      }
      return `<button class="up empty" data-ent="${ent.code}">
        <span class="plus">+</span><b>${esc(ent.code)} · ${esc(ent.name)}</b>
        <span>ลากไฟล์ CSV หรือ Excel มาวาง หรือคลิกเลือก</span></button>`;
    }).join('');
    wireUploads();
  }

  const tile = (k, v, s, cls = '', meter) =>
    `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div>${meter != null ? `<div class="meter"><span style="width:${meter}%"></span></div>` : ''}</div>`;

  function renderAll() {
    renderWorkbook();
    renderUploads();
    const loaded = Store.entitiesLoaded(activePeriod).length;
    const rows = Store.combinedRows(Store.tbFor(activePeriod));
    const res = rows.length ? applyRulebook(rows, RULEBOOK, Store.mappings()) : null;

    if (!res) {
      $('tiles').innerHTML = [tile('รหัสบัญชีทั้งหมด', '—', 'ยังไม่ได้นำเข้าไฟล์'),
        tile('จัดกลุ่มอัตโนมัติแล้ว', '—', 'อัปโหลด TB เพื่อเริ่ม'),
        tile('รหัสใหม่ ต้องตรวจ', '—', '—'), tile('งบทดลองสมดุล', '—', '—')].join('');
    } else {
      const allBalanced = Store.entitiesLoaded(activePeriod).every(e => balancedOf(e).balanced);
      $('tiles').innerHTML = [
        tile('รหัสบัญชีทั้งหมด', res.stats.total.toLocaleString(), `รวมจาก ${loaded} บริษัทที่นำเข้า`),
        tile('จัดกลุ่มอัตโนมัติแล้ว', res.stats.mappedPct + '%', `${res.stats.mapped.toLocaleString()} รหัส ตรงกับ Rulebook`, '', res.stats.mappedPct),
        tile('รหัสใหม่ ต้องตรวจ', String(res.stats.unmapped), 'ยังไม่เคยอยู่ใน Rulebook', res.stats.unmapped ? 'flag' : ''),
        tile('งบทดลองสมดุล', allBalanced ? 'ผ่าน' : 'ตรวจ', `Debit = Credit ${loaded} บริษัท`).replace('<div class="v">', `<div class="v" style="color:var(--${allBalanced ? 'good' : 'bad'})">`),
      ].join('');
    }

    $('filterSeg').querySelector('[data-f="new"]').textContent = `รหัสใหม่ · ${res ? res.stats.unmapped : 0}`;

    if (!res) {
      $('rows').innerHTML = `<tr><td colspan="5"><div class="results-empty"><div class="big">ยังไม่มีข้อมูล</div>
        <div>อัปโหลดไฟล์ TB ด้านบน หรือ <span class="linkish" id="emptySample">ลองข้อมูลตัวอย่าง</span></div></div></td></tr>`;
      const es = $('emptySample'); if (es) es.onclick = loadSamples;
    } else {
      const list = (filter === 'new' ? res.lines.filter(l => l.status === 'new') : res.lines)
        .slice().sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
      $('rows').innerHTML = list.map(l => {
        const neg = l.closing < 0;
        if (l.status === 'new') {
          return `<tr class="flagged"><td class="code"><span class="flag-stripe"></span>${esc(l.code)}</td>
            <td class="name">${esc(l.name)}</td><td class="r amt ${neg ? 'neg' : ''}">${money(l.closing)}</td>
            <td><span class="chip warn"><span class="dot"></span>ยังไม่ได้จัดกลุ่ม</span></td>
            <td><a class="rowbtn" href="mapping.html">จับคู่กลุ่ม →</a></td></tr>`;
        }
        return `<tr><td class="code">${esc(l.code)}</td><td class="name">${esc(l.name)}</td>
          <td class="r amt ${neg ? 'neg' : ''}">${money(l.closing)}</td>
          <td><span class="path"><span class="sctn">${esc(l.rule.section)}</span><span class="arw">▸</span><span class="grp">${esc(l.rule.group)}</span></span></td>
          <td><span class="chip good"><span class="dot"></span>จัดกลุ่มแล้ว</span></td></tr>`;
      }).join('') || `<tr><td colspan="5"><div class="results-empty"><div>ไม่มีรายการในมุมมองนี้</div></div></td></tr>`;
    }

    const co = $('callout');
    if (res && res.stats.unmapped) {
      co.style.display = '';
      $('calloutTxt').innerHTML = `มี <b>${res.stats.unmapped} รหัสใหม่</b> ที่ระบบยังจัดกลุ่มให้ไม่ได้ เพราะไม่เคยอยู่ใน Rulebook — <a class="linkish" href="mapping.html">จับคู่ให้ครั้งเดียว</a> ระบบจะจดจำไว้ใช้ทุกเดือนถัดไปโดยอัตโนมัติ`;
    } else co.style.display = 'none';

    const jn = $('journalNote'), jc = Store.journals(activePeriod).length;
    // Journals/Statements only ever show the LIVE period, so an archived
    // period's own journal count is reported here — the one place it's
    // visible at all — instead of pointing at pages that can't show it.
    const jDest = activePeriod
      ? `ใช้คำนวณยอดหลังตัดรายการของ<b>งวดนี้เอง</b>ในหน้า Ratios (ไม่ปรากฏที่หน้า Journals/Statements — หน้านั้นแสดงเฉพาะงวดปัจจุบัน)`
      : `ดูยอดสุดท้ายที่ <a class="linkish" href="journals.html">Journals</a> หรือ <a class="linkish" href="statements.html">Statements</a>`;
    if (res) {
      jn.style.display = '';
      jn.innerHTML = jc
        ? `ตารางนี้คือยอด <b>ก่อนตัดรายการ</b> (Combining) — ระบบอ่านรายการตัดบัญชี/ปรับปรุงจากไฟล์แล้ว <b>${jc} journal</b> ${jDest}`
        : `ตารางนี้คือยอด <b>ก่อนตัดรายการ</b> (Combining) — ยังไม่พบรายการตัดบัญชี/ปรับปรุงในไฟล์นี้ ถ้ามีชีต Eliminate/AJE ให้ลองอัปโหลด Workpaper ทั้งไฟล์อีกครั้ง`;
    } else jn.style.display = 'none';

    if (activePeriod) renderPeriods();   // uploading into an archived period changes its company count below
  }

  function renderPeriods() {
    const periods = Store.listPeriods();
    if (!periods.length) {
      $('periodsTbl').innerHTML = `<tbody><tr><td class="muted" style="padding:14px 16px">ยังไม่มีงวดที่บันทึกไว้</td></tr></tbody>`;
      return;
    }
    $('periodsTbl').innerHTML = `<thead><tr><th>รหัสงวด</th><th>ชื่องวด</th><th>บันทึกเมื่อ</th><th>บริษัท</th><th></th></tr></thead>
      <tbody>${periods.map(p => `<tr><td class="code">${esc(p.key)}</td><td>${esc(p.label)}</td>
        <td class="muted">${new Date(p.savedAt).toLocaleString('th-TH')}</td>
        <td class="muted">${Object.keys(p.tb).length} บริษัท</td>
        <td><button class="remove" data-period-remove="${esc(p.key)}" title="ลบงวดนี้">✕</button></td></tr>`).join('')}</tbody>`;
    $('periodsTbl').querySelectorAll('[data-period-remove]').forEach(b => b.onclick = () => {
      const key = b.dataset.periodRemove;
      if (!confirm(`ลบงวด "${key}" ที่บันทึกไว้?`)) return;
      Store.removePeriod(key);
      if (activePeriod === key) activePeriod = '';   // was editing the period just deleted — back to current
      renderPeriods(); renderPeriodSwitcher(); renderAll();
    });
  }

  $('archiveBtn').onclick = () => {
    const key = $('periodKey').value.trim(), label = $('periodLabel').value.trim();
    if (!key) { alert('กรอกรหัสงวดก่อน เช่น 2026-06'); return; }
    if (!Store.entitiesLoaded().length) { alert('ยังไม่มีข้อมูล TB ให้บันทึก'); return; }
    Store.archivePeriod(key, label);
    $('periodKey').value = ''; $('periodLabel').value = '';
    renderPeriods(); renderPeriodSwitcher();
  };

  // Uploads default to the live/current period; switching here lets you
  // upload a prior period's TB straight into an archive instead — e.g. to
  // feed Ratios' SET-tab TTM feature the same quarter a year ago, without
  // ever touching the current close.
  function renderPeriodSwitcher() {
    const periods = Store.listPeriods();
    const opts = periods.map(p => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('');
    $('periodSwitcher').innerHTML = `<option value="">งวดปัจจุบัน (กำลังทำงาน)</option>${opts}<option value="__new__">+ สร้างงวดใหม่…</option>`;
    $('periodSwitcher').value = activePeriod;
    const note = $('periodSwitcherNote');
    if (activePeriod) {
      note.style.display = '';
      note.innerHTML = `⚠ กำลังนำเข้าให้งวด <b>${esc(Store.getPeriod(activePeriod) ? Store.getPeriod(activePeriod).label : activePeriod)}</b> — ใช้เทียบเทรนด์ในหน้า Ratios เท่านั้น (อ่านรายการตัดบัญชี/ปรับปรุงของงวดนี้ด้วย ถ้าไฟล์มีชีต Eliminate/AJE) ไม่กระทบ Mapping/Journals/Statements ของงวดปัจจุบัน`;
    } else note.style.display = 'none';
  }
  $('periodSwitcher').onchange = e => {
    const v = e.target.value;
    if (v === '__new__') {
      const key = prompt('รหัสงวดใหม่ (เช่น 2025-06):');
      if (!key || !key.trim()) { renderPeriodSwitcher(); return; }
      const label = prompt('ชื่องวด (เช่น มิ.ย. 2568):', key.trim()) || key.trim();
      Store.tbFor(key.trim());               // create the empty period
      Store.setPeriodLabel(key.trim(), label);
      activePeriod = key.trim();
    } else {
      activePeriod = v;
    }
    renderPeriodSwitcher(); renderPeriods(); renderAll();
  };

  function wireUploads() {
    document.querySelectorAll('.up[data-ent]').forEach(el => {
      const ent = el.dataset.ent;
      el.onclick = e => { if (e.target.closest('[data-remove]')) return; pendingEntity = ent; $('fileInput').click(); };
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
      el.addEventListener('dragleave', () => el.classList.remove('drag'));
      el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) (isXlsx(f) ? ingestEntityXlsx(ent, f) : ingest(ent, f)); });
    });
    document.querySelectorAll('[data-remove]').forEach(b => b.onclick = e => { e.stopPropagation(); Store.removeTB(e.target.dataset.remove, activePeriod); renderAll(); });
  }

  $('fileInput').onchange = e => { const f = e.target.files[0]; if (f && pendingEntity) (isXlsx(f) ? ingestEntityXlsx(pendingEntity, f) : ingest(pendingEntity, f)); e.target.value = ''; };
  $('wbInput').onchange = e => { handleWorkbookFiles(e.target.files); e.target.value = ''; };
  // A <div role="button"> rather than a real <button>, because the "remove"
  // control lives inside it and a button can't nest inside a button.
  $('wbDrop').onclick = e => { if (e.target.closest('#wbRemove')) return; $('wbInput').click(); };
  $('wbDrop').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('wbInput').click(); } };
  $('wbRemove').onclick = e => { e.stopPropagation(); removeWorkbook(); };
  $('wbDrop').addEventListener('dragover', e => { e.preventDefault(); $('wbDrop').classList.add('drag'); });
  $('wbDrop').addEventListener('dragleave', () => $('wbDrop').classList.remove('drag'));
  $('wbDrop').addEventListener('drop', e => { e.preventDefault(); $('wbDrop').classList.remove('drag'); handleWorkbookFiles(e.dataTransfer.files); });
  $('monthModeSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
    monthMode = b.dataset.mode;
    $('monthModeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('filterSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
    filter = b.dataset.f; $('filterSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderAll();
  });
  $('sampleBtn').onclick = loadSamples;
  $('nextBtn').onclick = () => { location.href = 'mapping.html'; };
  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };

  renderPeriodSwitcher();
  renderAll();
  renderPeriods();
})();
