/* Consolidation — per-entity summary matrix, the net elimination/adjustment
   effect, and the true consolidated (Final) total. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { const a = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); return n < 0 ? '(' + a + ')' : a; };

  function summary(rows) {
    const g = FS.grouped(rows);
    if (!g) return null;
    const bs = FS.buildBS(g), pl = FS.buildPL(g);
    return {
      'สินทรัพย์รวม': bs.totalAssets,
      'หนี้สินรวม': bs.totalLiab,
      'ส่วนของผู้ถือหุ้น': bs.totalEquity + bs.netProfit,
      'รายได้': pl.revenue,
      'กำไร (ขาดทุน) สุทธิ': pl.netProfit,
    };
  }

  function render() {
    // '' = live; a saved period's key = viewing that archive instead, via
    // the shared topbar picker (period-picker.js). Read-only page.
    const period = Store.uiPeriod();
    const E = RULEBOOK.entities.map(e => e.code).filter(c => Store.entitiesLoaded(period).includes(c));
    if (!E.length) {
      $('banner').innerHTML = '';
      $('matrix').innerHTML = `<tbody><tr><td><div class="results-empty"><div class="big">ยังไม่ได้นำเข้างบทดลอง</div><div class="muted">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div></div></td></tr></tbody>`;
      return;
    }
    const cols = E.map(ent => ({ ent, sum: summary(Store.tb(ent, period).rows) }));
    const combining = summary(Store.combinedRows(period ? Store.tbFor(period) : undefined));   // before journals
    const final = summary(Store.finalRows(period));          // after journals — the true consolidated position
    const lineNames = Object.keys(combining);
    const journals = Store.journals(period), enabled = Store.enabledJournals(period);

    let h = `<thead><tr><th>รายการ</th>${E.map(e => `<th class="ent">${esc(e)}</th>`).join('')}<th class="ent total-col">รวม (Combining)</th><th class="ent">ตัดรายการ/ปรับปรุง</th><th class="ent total-col">สุดท้าย (Final)</th></tr></thead><tbody>`;
    for (const name of lineNames) {
      const grand = name === 'สินทรัพย์รวม' || name === 'กำไร (ขาดทุน) สุทธิ';
      const adj = final[name] - combining[name];
      h += `<tr class="${grand ? 'subtotal-row' : ''}"><td>${esc(name)}</td>${cols.map(c => `<td class="ent">${money(c.sum[name])}</td>`).join('')}
        <td class="ent total-col">${money(combining[name])}</td>
        <td class="ent ${adj < 0 ? 'neg' : ''}">${Math.abs(adj) < 1 ? '—' : money(adj)}</td>
        <td class="ent total-col">${money(final[name])}</td></tr>`;
    }
    h += '</tbody>';
    $('matrix').innerHTML = h;

    const nEnt = E.length;
    $('banner').innerHTML = journals.length
      ? `<div class="check ok" style="margin-bottom:14px"><div class="ico">✓</div>
        <div><div class="t">รวม ${nEnt} บริษัท + ตัดรายการระหว่างกันแล้ว</div>
        <div class="d">${E.join(' · ')} — ใช้ ${enabled.length}/${journals.length} journal ที่อ่านจากไฟล์ — ปรับ/ปิดได้ที่หน้า <a class="linkish" href="journals.html">Journals</a></div></div></div>`
      : `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div>
        <div><div class="t">รวม ${nEnt} บริษัท — ยังไม่มีรายการตัดบัญชี</div>
        <div class="d">คอลัมน์ Final ยังเท่ากับ Combining เพราะยังไม่พบ journal — ดูหน้า <a class="linkish" href="journals.html">Journals</a></div></div></div>`;
  }

  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  render();
})();
