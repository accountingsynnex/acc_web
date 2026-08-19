/* Reading a workbook that holds one company's trial balance a month at a
   time, a sheet each — shared by the Import page and Cost Center, which both
   offer it and must agree on where the months land.

   Globals: XLSX (vendor), buildRows (group-engine.js), Store (store.js). */
(function (global) {
  const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  // Month names a sheet might be titled with, English and Thai, short and long.
  const MONTH_WORDS = [
    ['jan', 'ม.ค', 'มกรา'], ['feb', 'ก.พ', 'กุมภา'], ['mar', 'มี.ค', 'มีนา'], ['apr', 'เม.ย', 'เมษา'],
    ['may', 'พ.ค', 'พฤษภา'], ['jun', 'มิ.ย', 'มิถุนา'], ['jul', 'ก.ค', 'กรกฎา'], ['aug', 'ส.ค', 'สิงหา'],
    ['sep', 'ก.ย', 'กันยา'], ['oct', 'ต.ค', 'ตุลา'], ['nov', 'พ.ย', 'พฤศจิกา'], ['dec', 'ธ.ค', 'ธันวา'],
  ];

  /* The month a WORKSHEET is named after, as a period key. A file with one
     sheet per month names them "Jan 26" / "Feb-2026" / "ม.ค. 69" rather than
     repeating the year the way a filename does, so this reads a month name
     plus a year: 2-digit years are Buddhist-era when they land in the 60s-70s
     (69 = 2569 = 2026) and Gregorian otherwise, matching how the company
     writes both. Returns null for anything that isn't clearly a month. */
  function periodKeyFromSheetName(name) {
    const s = String(name).trim().toLowerCase();
    const mi = MONTH_WORDS.findIndex(words => words.some(w => s.includes(w)));
    if (mi === -1) return null;
    const ym = /(\d{2,4})\s*$/.exec(s);
    if (!ym) return null;
    let year = +ym[1];
    if (year < 100) year += year >= 60 && year <= 99 ? 1957 : 2000;   // 69 -> 2026, 26 -> 2026
    else if (year >= 2500) year -= 543;
    if (year < 2000 || year > 2100) return null;
    return `${year}-${String(mi + 1).padStart(2, '0')}`;
  }

  function labelFromKey(key) {
    const m = /^(\d{4})-(\d{2})/.exec(String(key || ''));
    return m ? `${TH_MONTHS[+m[2] - 1]} ${+m[1] + 543}` : String(key);
  }

  const norm = s => String(s).trim().replace(/[\s_-]+/g, ' ').toUpperCase();

  /* The month sheets of a workbook, or [] when it isn't one of these files.
     A sheet named after the entity means it's the ordinary single-period
     export, whichever other sheets sit beside it. */
  function monthSheetsOf(wb, entityCode) {
    const names = wb.SheetNames || [];
    if (entityCode && names.some(n => norm(n) === 'TB ' + String(entityCode).toUpperCase())) return [];
    const months = names.map(sheet => ({ sheet, key: periodKeyFromSheetName(sheet) })).filter(m => m.key);
    return months.length > 1 ? months : [];
  }

  /* Which company the workbook is for, when the page can't say: the entity
     whose own sheet is in there, else the first one the rulebook names. */
  function guessEntity(wb, entities) {
    const names = wb.SheetNames || [];
    const hit = entities.find(e => names.some(n => norm(n) === 'TB ' + e.toUpperCase()));
    return hit || entities[0];
  }

  /* Where each month lands. `separate` keeps the periods the statements are
     built from out of it: the raw export out of the accounting system and the
     workpaper's own sheet for the same month are not the same trial balance
     (the workpaper carries reclass and cut-off entries that haven't been
     posted), so a cost-centre import gets a key of its own. Every month
     calculation on the Ratios page matches a bare "YYYY-MM" only, which is
     what keeps a suffixed period out of the statements entirely. */
  const CC_SUFFIX = '-cc';
  function planFor(months, separate) {
    return months.map(m => ({
      sheet: m.sheet,
      key: separate ? m.key + CC_SUFFIX : m.key,
      label: labelFromKey(m.key) + (separate ? ' · Cost Center' : ''),
    }));
  }

  function confirmText(entityCode, plan, separate) {
    const lines = plan.map(p => `   ${p.sheet}  →  ${p.label} (${p.key})`).join('\n');
    return `ไฟล์นี้มี ${plan.length} เดือนอยู่ในไฟล์เดียว — จะแยกเป็น ${plan.length} งวดให้อัตโนมัติ\n\n${lines}\n\n`
      + `นำเข้าเป็นงบทดลองของบริษัท ${entityCode}\n\n`
      + (separate
        ? 'เป็นงวดชุดใหม่แยกต่างหาก — งบทดลองของงวดปกติไม่ถูกแตะ ใช้ดูที่หน้า Cost Center'
        : `งวดที่มีอยู่แล้วจะถูกทับเฉพาะงบทดลองของ ${entityCode} เท่านั้น (บริษัทอื่นและรายการตัดบัญชีของงวดนั้นยังอยู่ครบ)\n`
          + '⚠ ถ้างวดนั้นมีงบทดลองจากไฟล์ Conso อยู่แล้ว ตัวเลขงบอาจเปลี่ยน — ไฟล์ Conso มีรายการปรับปรุงที่ระบบบัญชียังไม่ได้ลง');
  }

  /* Write the plan. Only this entity's TB is touched in each period, so
     dropping a department-level export over months that already hold a full
     consolidation adds the dimension and leaves the other companies and
     their journals alone. */
  function run(entityCode, fileName, wb, plan) {
    const added = [], skipped = [];
    for (const p of plan) {
      try {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[p.sheet], { header: 1, raw: true, defval: null });
        const { rows, deptRows, dimNames } = buildRows(aoa);
        if (!rows.length) { skipped.push(`${p.sheet} (ไม่มีแถวบัญชี)`); continue; }
        Store.setTB(entityCode, fileName + ' › ' + p.sheet, rows, p.key, deptRows,
          deptRows.length ? p.sheet : '', dimNames);
        // tbFor() names a period it had to create after its own key; give it
        // the readable month instead, without renaming one already labelled.
        const period = Store.getPeriod(p.key);
        if (period && period.label === p.key) Store.setPeriodLabel(p.key, p.label);
        added.push(p.label);
      } catch (e) { skipped.push(`${p.sheet} (${e.message})`); }
    }
    return { added, skipped };
  }

  const resultText = (entityCode, { added, skipped }) => added.length
    ? `นำเข้า ${entityCode} แล้ว ${added.length} งวด: ${added.join(' · ')}`
      + (skipped.length ? `\n\nข้าม: ${skipped.join(', ')}` : '')
    : `นำเข้าไม่สำเร็จ: ${skipped.join(', ')}`;

  global.MonthTB = { CC_SUFFIX, TH_MONTHS, periodKeyFromSheetName, labelFromKey, monthSheetsOf, guessEntity, planFor, confirmText, run, resultText };
  if (typeof module !== 'undefined') module.exports = global.MonthTB;
})(typeof window !== 'undefined' ? window : globalThis);
