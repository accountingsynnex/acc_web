/* Review — closing gates + export (CSV / JSON) of the grouped result. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

  // '' = live; a saved period's key = viewing that archive instead, via the
  // shared topbar picker (period-picker.js). Read-only page.
  const period = () => Store.uiPeriod();
  function periodLabel() {
    const key = period();
    if (!key) return 'ปัจจุบัน';
    const p = Store.getPeriod(key);
    return p ? p.label : key;
  }

  function computed() {
    const pk = period();
    const E = RULEBOOK.entities.map(e => e.code).filter(c => Store.entitiesLoaded(pk).includes(c));
    const rows = Store.combinedRows(pk ? Store.tbFor(pk) : undefined);
    const res = rows.length ? applyRulebook(rows, RULEBOOK, Store.mappings()) : null;
    const g = FS.grouped(null, pk);      // final (post-journal) — the actual consolidated position
    const bs = g ? FS.buildBS(g) : null;
    const unbalanced = E.filter(e => !validateTB(Store.tb(e, pk).rows, 5).balanced);
    const journals = Store.journals(pk), unbalancedJournals = journals.filter(j => Math.abs(j.net) > 1);
    return { E, res, bs, unbalanced, journals, unbalancedJournals };
  }

  function render() {
    const c = computed();
    const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    if (!c.res) {
      $('tiles').innerHTML = '';
      $('checks').innerHTML = `<div class="check no"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้างบทดลอง</div><div class="d">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div></div></div>`;
      return;
    }
    $('tiles').innerHTML = [
      tile('บริษัท', String(c.E.length), c.E.join(' · ')),
      tile('บัญชีทั้งหมด', c.res.stats.total.toLocaleString(), `จัดกลุ่ม ${c.res.stats.mappedPct}%`),
      tile('รหัสใหม่ค้าง', String(c.res.stats.unmapped), c.res.stats.unmapped ? 'ต้องจับคู่ก่อน' : 'ครบแล้ว', c.res.stats.unmapped ? 'flag' : ''),
      tile('งบดุล', c.bs && Math.abs(c.bs.diff) < 1 ? 'สมดุล' : 'ตรวจ', c.bs ? `ผลต่าง ${money(c.bs.diff)}` : '—').replace('<div class="v">', `<div class="v" style="color:var(--${c.bs && Math.abs(c.bs.diff) < 1 ? 'good' : 'bad'})">`),
    ].join('');

    const gates = [
      [c.E.length > 0, 'นำเข้างบทดลองแล้ว', `${c.E.length} บริษัท: ${c.E.join(', ')}`, null],
      [c.unbalanced.length === 0, 'งบทดลองสมดุลทุกบริษัท', c.unbalanced.length ? `ไม่สมดุล: ${c.unbalanced.join(', ')}` : 'Debit = Credit ครบ', null],
      [c.res.stats.unmapped === 0, 'จัดกลุ่มครบทุกรหัส', c.res.stats.unmapped ? `เหลือ ${c.res.stats.unmapped} รหัสใหม่` : 'ทุกบัญชีเข้ากลุ่มแล้ว', !c.res.stats.unmapped ? null : ['mapping.html', 'ไปจับคู่']],
      [c.journals.length > 0, 'ใช้รายการตัดบัญชี/ปรับปรุงแล้ว',
        c.journals.length ? `${Store.enabledJournals(period()).length}/${c.journals.length} journal เปิดใช้งาน${c.unbalancedJournals.length ? ` · ${c.unbalancedJournals.length} journal ยอดไม่เป็น 0 ในตัวเอง (อาจหักล้างกับเลขที่อื่น — ลองตรวจดู)` : ''}` : 'ยังไม่พบ journal ในไฟล์ที่นำเข้า',
        ['journals.html', 'ไปดู Journals']],
      [c.bs && Math.abs(c.bs.diff) < 1, 'งบดุลสมดุล (Final)', c.bs ? `สินทรัพย์ ${money(c.bs.totalAssets)} = หนี้สิน+ทุน ${money(c.bs.totalLE)}` : '—', null],
    ];
    $('checks').innerHTML = gates.map(([ok, t, d, link]) => `<div class="check ${ok ? 'ok' : 'no'}"><div class="ico">${ok ? '✓' : '!'}</div>
      <div><div class="t">${esc(t)}</div><div class="d">${esc(d)}${link && !ok ? ` <a class="linkish" href="${link[0]}">${esc(link[1])}</a>` : ''}</div></div></div>`).join('');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }

  function exportCSV() {
    const pk = period();
    const res = applyRulebook(Store.finalRows(pk), RULEBOOK, Store.mappings());
    const out = [['Account', 'Name', 'Statement', 'Section', 'Group', 'Closing (Final)']];
    res.lines.slice().sort((a, b) => a.code.localeCompare(b.code)).forEach(l =>
      out.push([l.code, l.name, l.rule ? l.rule.statement : '', l.rule ? l.rule.section : '', l.rule ? l.rule.group : 'UNMAPPED', l.closing.toFixed(2)]));
    download(`FS_Grouped_${pk || 'current'}.csv`, out.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  function exportJSON() {
    const pk = period();
    const g = FS.grouped(null, pk);   // final, post-journal
    const payload = {
      period: periodLabel(), entities: Store.entitiesLoaded(pk), mappings: Store.mappings(),
      journals: Store.journals(pk).map(j => ({ id: j.id, description: j.description, source: j.source, enabled: j.enabled !== false, net: j.net })),
      balanceSheet: g ? FS.buildBS(g) : null, profitLoss: g ? FS.buildPL(g) : null,
    };
    download(`FS_Closing_Package_${pk || 'current'}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  /* The whole close as one workbook, shaped like the company's own Conso
     workpaper — see export-xlsx.js. Building it walks every account of
     every entity plus every journal, which on a full consolidation is a
     second or two, so the button says what it's doing rather than looking
     dead. */
  $('xlsxBtn').onclick = () => {
    const btn = $('xlsxBtn'), label = btn.textContent;
    btn.disabled = true; btn.textContent = 'กำลังสร้างไฟล์…';
    setTimeout(() => {
      try {
        const meta = ConsoExport.download(period());
        btn.textContent = `ดาวน์โหลดแล้ว (${meta.periodLabel})`;
      } catch (e) {
        alert('ส่งออกไม่สำเร็จ: ' + e.message);
        btn.textContent = label;
      } finally {
        btn.disabled = false;
        setTimeout(() => { btn.textContent = label; }, 4000);
      }
    }, 30);
  };
  $('csvBtn').onclick = exportCSV;
  $('jsonBtn').onclick = exportJSON;
  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  render();
})();
