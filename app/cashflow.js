/* Cash Flow — indirect-method statement computed live from the imported
   TB via CashFlowEngine (engine/cashflow-engine.js), not a frozen
   snapshot. See that file's header comment for the accuracy caveats this
   page's copy also discloses. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { if (n == null) return ''; const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? '(' + a + ')' : a; };
  const amt = n => `<td class="stmt-amt ${n < 0 ? 'neg' : ''}">${money(n)}</td>`;

  function header(label) { return `<tr class="section-row"><td colspan="2">${esc(label)}</td></tr>`; }
  function line(label, value, indent) { return `<tr><td style="padding-left:${16 + (indent || 0) * 20}px">${esc(label)}</td>${amt(value)}</tr>`; }
  function subtotal(label, value) { return `<tr class="subtotal-row"><td>${esc(label)}</td>${amt(value)}</tr>`; }
  function sectiontotal(label, value) { return `<tr class="grand-row"><td>${esc(label)}</td>${amt(value)}</tr>`; }
  function rows(list) { return list.map(r => line(r.label, r.value, 1)).join(''); }

  function render() {
    const g = FS.grouped();
    if (!g) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้างบทดลอง</div><div class="d">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div></div></div>`;
      $('cf').innerHTML = '';
      return;
    }
    const openingRows = Store.openingRows();
    if (!openingRows) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">ไฟล์ที่นำเข้าไม่มีคอลัมน์ยอดยกมา (Opening balance)</div><div class="d">งบกระแสเงินสดต้องเทียบกับยอดต้นงวด — นำเข้าไฟล์ที่มีคอลัมน์นี้ก่อน (เช่น TB รายเดือนจากไฟล์ R9.3)</div></div></div>`;
      $('cf').innerHTML = '';
      return;
    }
    const bs = FS.buildBS(g), closingPL = FS.buildPL(g);
    const og = FS.grouped(openingRows);
    const openingBs = FS.buildBS(og), openingPL = FS.buildPL(og);
    const r = CashFlowEngine.computeCashFlow(bs, closingPL, openingBs, openingPL);

    let body = '<thead><tr><th>รายการ</th><th class="stmt-amt">บาท</th></tr></thead><tbody>';
    body += header('กระแสเงินสดจากกิจกรรมดำเนินงาน');
    body += line('กำไรสำหรับงวด', r.netProfit);
    body += header('รายการปรับกระทบกำไรเป็นเงินสดรับ (จ่าย)');
    body += rows(r.addback);
    body += subtotal('กำไรก่อนการเปลี่ยนแปลงในสินทรัพย์และหนี้สินดำเนินงาน', r.profitBeforeWC);
    body += header('การเปลี่ยนแปลงในสินทรัพย์และหนี้สินดำเนินงาน');
    body += rows(r.workingCapital);
    body += subtotal('กระแสเงินสดจากกิจกรรมดำเนินงานก่อนภาษี', r.cfoBeforeTax);
    body += line('จ่ายภาษีเงินได้', -r.taxPaid);
    body += sectiontotal('กระแสเงินสดสุทธิจากกิจกรรมดำเนินงาน', r.cfo);

    body += header('กระแสเงินสดจากกิจกรรมลงทุน');
    body += rows(r.investing);
    body += sectiontotal('กระแสเงินสดสุทธิจากกิจกรรมลงทุน', r.cfi);

    body += header('กระแสเงินสดจากกิจกรรมจัดหาเงิน');
    body += rows(r.financing);
    body += sectiontotal('กระแสเงินสดสุทธิจากกิจกรรมจัดหาเงิน', r.cff);

    body += header('การกระทบยอด');
    body += line('ผลต่างที่ยังไม่ระบุ (ดูหมายเหตุด้านบน)', r.unexplained);
    body += subtotal('เงินสดและรายการเทียบเท่าเงินสดเพิ่มขึ้น (ลดลง) สุทธิ', r.netIncrease);
    body += line('เงินสดและรายการเทียบเท่าเงินสด ต้นงวด', r.cashOpen);
    body += sectiontotal('เงินสดและรายการเทียบเท่าเงินสด ปลายงวด', r.cashNow);
    body += '</tbody>';
    $('cf').innerHTML = body;

    $('banner').innerHTML = `<div class="check ok" style="margin-bottom:14px"><div class="ico">✓</div><div><div class="t">คำนวณจากงบที่โรลอัปสด</div>
      <div class="d">งวด = ช่วงเวลาที่ไฟล์ที่นำเข้าครอบคลุม (ต้นงวด→ปลายงวดตามคอลัมน์ยอดยกมา/ยอดคงเหลือของไฟล์) — ไม่ได้ผูกกับเดือน/ไตรมาส/ปีตายตัว</div></div></div>`;
  }

  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  render();
})();
