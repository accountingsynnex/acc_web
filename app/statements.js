/* Statements — Balance Sheet & P&L rolled up from the grouped TB (FS.js). */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? '(' + a + ')' : a; };
  const amt = n => `<td class="stmt-amt ${n < 0 ? 'neg' : ''}">${money(n)}</td>`;
  let tab = 'BS';

  function sectionRows(sec) {
    if (sec.empty) return '';
    let h = `<tr class="section-row"><td colspan="2">${esc(sec.name)}</td></tr>`;
    for (const g of sec.groups) h += `<tr><td class="indent">${esc(g.group)}</td>${amt(g.value)}</tr>`;
    h += `<tr class="subtotal-row"><td class="lbl">รวม ${esc(sec.name)}</td>${amt(sec.total)}</tr>`;
    return h;
  }

  function renderBS(g) {
    const bs = FS.buildBS(g);
    let h = '<thead><tr><th>รายการ</th><th class="stmt-amt">จำนวนเงิน (บาท)</th></tr></thead><tbody>';
    bs.assets.forEach(s => h += sectionRows(s));
    h += `<tr class="grand-row"><td>รวมสินทรัพย์</td>${amt(bs.totalAssets)}</tr>`;
    bs.liab.forEach(s => h += sectionRows(s));
    bs.equity.forEach(s => h += sectionRows(s));
    h += `<tr><td class="indent">กำไร (ขาดทุน) สำหรับงวด</td>${amt(bs.netProfit)}</tr>`;
    h += `<tr class="grand-row"><td>รวมหนี้สินและส่วนของผู้ถือหุ้น</td>${amt(bs.totalLE)}</tr>`;
    h += '</tbody>';
    $('stmt').innerHTML = h;
    const ok = Math.abs(bs.diff) < 1;
    $('banner').innerHTML = `<div class="check ${ok ? 'ok' : 'no'}" style="margin-bottom:14px"><div class="ico">${ok ? '✓' : '!'}</div>
      <div><div class="t">${ok ? 'งบดุลสมดุล' : 'งบดุลไม่สมดุล'}</div>
      <div class="d">สินทรัพย์ ${money(bs.totalAssets)} • หนี้สิน+ทุน ${money(bs.totalLE)} • ผลต่าง ${money(bs.diff)}</div></div></div>`;
  }

  function renderPL(g) {
    const pl = FS.buildPL(g);
    let h = '<thead><tr><th>รายการ</th><th class="stmt-amt">จำนวนเงิน (บาท)</th></tr></thead><tbody>';
    pl.sections.forEach(s => {
      h += sectionRows(s);
      if (s.name === 'Cost of Sales') h += `<tr class="gross-row"><td>กำไรขั้นต้น (Gross Profit)</td>${amt(pl.grossProfit)}</tr>`;
    });
    h += `<tr class="grand-row"><td>กำไร (ขาดทุน) สุทธิสำหรับงวด</td>${amt(pl.netProfit)}</tr>`;
    h += '</tbody>';
    $('stmt').innerHTML = h;
    $('banner').innerHTML = `<div class="check ok" style="margin-bottom:14px"><div class="ico">%</div>
      <div><div class="t">อัตรากำไรสุทธิ ${pl.revenue ? (100 * pl.netProfit / pl.revenue).toFixed(1) : '—'}%</div>
      <div class="d">รายได้ ${money(pl.revenue)} • กำไรขั้นต้น ${money(pl.grossProfit)} • กำไรสุทธิ ${money(pl.netProfit)}</div></div></div>`;
  }

  function render() {
    // '' = live; a saved period's key = viewing that archive instead, via
    // the shared topbar picker (period-picker.js). Read-only page.
    const g = FS.grouped(null, Store.uiPeriod());
    if (!g) {
      $('banner').innerHTML = '';
      $('stmt').innerHTML = `<tbody><tr><td><div class="results-empty"><div class="big">ยังไม่ได้นำเข้างบทดลอง</div><div class="muted">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div></div></td></tr></tbody>`;
      return;
    }
    if (tab === 'BS') renderBS(g); else renderPL(g);
  }

  $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    tab = b.dataset.t; $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); render();
  });
  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  render();
})();
