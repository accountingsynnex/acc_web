/* Journals — review the eliminations + adjustments parsed from the
   workbook. Each is enabled by default; toggling off excludes it from
   Store.finalRows() (and so from every downstream statement) without
   deleting it, so re-importing next month keeps the same on/off choices. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? '(' + a + ')' : a; };
  const open = new Set();
  // '' = live; a saved period's key = viewing/editing that archive's own
  // journals instead, via the shared topbar picker (period-picker.js).
  // Every Store journal accessor already takes this as its trailing arg.
  const period = () => Store.uiPeriod();

  const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;

  function render() {
    const pk = period();
    const periodNote = $('periodNote');
    if (periodNote) {
      if (pk) {
        periodNote.style.display = '';
        periodNote.innerHTML = `⚠ กำลังดู/แก้ไข journal ของงวดที่บันทึกไว้ <b>${esc((Store.getPeriod(pk) || {}).label || pk)}</b> เท่านั้น — ไม่กระทบ journal ของงวดปัจจุบัน`;
      } else periodNote.style.display = 'none';
    }
    const journals = Store.journals(pk);
    if (!journals.length) {
      $('banner').innerHTML = `<div class="check no"><div class="ico">!</div><div><div class="t">ยังไม่พบรายการตัดบัญชี/ปรับปรุง</div>
        <div class="d">อัปโหลด Workpaper ทั้งไฟล์ (.xlsx) ที่หน้า <a class="linkish" href="import.html">Import TB</a> ให้ระบบอ่านชีต Eliminate/AJE ให้อัตโนมัติ หรือกด "+ เพิ่มรายการเอง" ด้านบนถ้าไฟล์เป็น TB/GL เปล่าๆ</div></div></div>`;
      $('tiles').innerHTML = ''; $('list').innerHTML = ''; return;
    }
    $('banner').innerHTML = '';

    const enabled = Store.enabledJournals(pk);
    const totalLines = journals.reduce((s, j) => s + j.lines.length, 0);
    const unbalanced = journals.filter(j => Math.abs(j.net) > 1);
    const netImpact = enabled.reduce((s, j) => s + j.lines.reduce((s2, l) => s2 + Math.abs(l.amount), 0) / 2, 0);

    $('tiles').innerHTML = [
      tile('Journal ทั้งหมด', String(journals.length), `${enabled.length} เปิดใช้งาน`),
      tile('บรรทัดรายการ', totalLines.toLocaleString(), `รวมทุก journal`),
      tile('ยอดไม่เป็น 0 ในตัวเอง', String(unbalanced.length), unbalanced.length ? 'อาจหักล้างกับ journal เลขที่อื่น — ลองตรวจดู' : 'ทุก journal บาลานซ์ในตัวเอง', unbalanced.length ? 'flag' : ''),
      tile('มูลค่ารวมที่ปรับ', (netImpact / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' M', 'จาก journal ที่เปิดใช้งาน'),
    ].join('');

    const bySource = {};
    journals.forEach(j => (bySource[j.source] = bySource[j.source] || []).push(j));

    let html = '';
    for (const [source, list] of Object.entries(bySource)) {
      html += `<div class="jn-source-head">${esc(source)} · ${list.length} journal</div>`;
      list.forEach(j => {
        const isOpen = open.has(j.id);
        const on = j.enabled !== false;
        const bad = Math.abs(j.net) > 1;
        html += `<div class="jn-card ${on ? '' : 'off'} ${isOpen ? 'open' : ''}" data-id="${esc(j.id)}">
          <div class="jn-head" data-toggleopen="${esc(j.id)}">
            <svg class="jn-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
            <span class="id">${esc(j.no || j.id)}</span>
            <span class="desc">${esc(j.description || '(ไม่มีคำอธิบาย)')}</span>
            <span class="spacer"></span>
            ${bad ? `<span class="chip bad" style="margin-right:8px"><span class="dot"></span>ยอดไม่เป็น 0: ${money(j.net)}</span>` : ''}
            <span class="net muted">${j.lines.length} บรรทัด</span>
            <div class="jn-toggle ${on ? 'on' : ''}" data-toggleon="${esc(j.id)}" title="${on ? 'ปิดใช้งาน journal นี้' : 'เปิดใช้งาน journal นี้'}"><span></span></div>
            <button class="jn-del" data-editjn="${esc(j.id)}" title="แก้ไขรายการนี้">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
            </button>
            <button class="jn-del" data-deljn="${esc(j.id)}" title="ลบรายการนี้">✕</button>
          </div>
          <div class="jn-lines"><table><tbody>
            ${j.lines.map(l => `<tr><td class="code">${esc(l.code)}</td><td>${esc(l.name)}</td><td class="amt ${l.amount < 0 ? 'neg' : ''}">${money(l.amount)}</td></tr>`).join('')}
          </tbody></table></div>
        </div>`;
      });
    }
    $('list').innerHTML = html;

    $('list').querySelectorAll('[data-toggleopen]').forEach(el => el.onclick = e => {
      if (e.target.closest('[data-toggleon]')) return;
      const id = el.dataset.toggleopen;
      if (open.has(id)) open.delete(id); else open.add(id);
      el.closest('.jn-card').classList.toggle('open');
    });
    $('list').querySelectorAll('[data-toggleon]').forEach(el => el.onclick = e => {
      e.stopPropagation();
      const id = el.dataset.toggleon;
      const j = journals.find(x => x.id === id);
      const newState = !(j.enabled !== false);
      Store.toggleJournal(id, newState, pk);
      render();
    });
    $('list').querySelectorAll('[data-deljn]').forEach(el => el.onclick = e => {
      e.stopPropagation();
      if (!confirm('ลบรายการนี้ออกจากรายการตัดบัญชี/ปรับปรุง?')) return;
      Store.removeJournal(el.dataset.deljn, pk);
      render();
    });
    $('list').querySelectorAll('[data-editjn]').forEach(el => el.onclick = e => {
      e.stopPropagation();
      openForm(journals.find(x => x.id === el.dataset.editjn));
    });
  }

  // ---- Manual entry + edit (for periods where the workbook is a bare
  // TB/GL with no Eliminate/AJE sheets, or to tweak a recurring entry's
  // amounts each month without re-doing it in Excel) ----------------------
  let editingId = null;

  function lineRow(code = '', name = '', amount = '') {
    const row = document.createElement('div');
    row.className = 'mline';
    row.innerHTML = `<div class="fld"><label>รหัสบัญชี</label><input class="js-ml-code" value="${esc(code)}" /></div>
      <div class="fld"><label>ชื่อบัญชี</label><input class="js-ml-name" value="${esc(name)}" /></div>
      <div class="fld"><label>Dr./(Cr.)</label><input class="js-ml-amt" type="number" step="0.01" value="${esc(amount)}" /></div>
      <button class="ml-del" type="button" title="ลบบรรทัด">✕</button>`;
    row.querySelector('.ml-del').onclick = () => { row.remove(); updateNet(); };
    row.querySelectorAll('.js-ml-amt').forEach(i => i.oninput = updateNet);
    return row;
  }
  function updateNet() {
    const total = [...$('mLines').querySelectorAll('.js-ml-amt')].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
    $('mNet').textContent = `ยอดรวม: ${money(total)}${Math.abs(total) > 1 ? ' (ยังไม่เป็น 0)' : ''}`;
  }
  function resetForm(journal) {
    $('mDesc').value = journal ? journal.description || '' : '';
    $('mLines').innerHTML = '';
    const src = journal ? journal.lines : [{}, {}];
    src.forEach(l => $('mLines').appendChild(lineRow(l.code, l.name, l.amount)));
    updateNet();
  }
  function openForm(journal) {
    editingId = journal ? journal.id : null;
    $('formTitle').textContent = journal ? 'แก้ไขรายการตัดบัญชี/ปรับปรุง' : 'เพิ่มรายการตัดบัญชี/ปรับปรุงเอง';
    $('mSave').textContent = journal ? 'บันทึกการแก้ไข' : 'บันทึกรายการ';
    resetForm(journal);
    $('addForm').style.display = '';
    $('mDesc').focus();
  }
  function closeForm() { $('addForm').style.display = 'none'; editingId = null; }
  function saveManual() {
    const description = $('mDesc').value.trim();
    const lines = [...$('mLines').querySelectorAll('.mline')].map(row => ({
      code: row.querySelector('.js-ml-code').value.trim(),
      name: row.querySelector('.js-ml-name').value.trim(),
      amount: parseFloat(row.querySelector('.js-ml-amt').value),
    })).filter(l => l.code && isFinite(l.amount) && l.amount !== 0);
    if (!description) { alert('กรอกคำอธิบายรายการก่อน'); return; }
    if (lines.length < 2) { alert('ต้องมีอย่างน้อย 2 บรรทัด (Dr. และ Cr.)'); return; }
    const net = lines.reduce((s, l) => s + l.amount, 0);
    if (editingId) {
      Store.updateJournal(editingId, { description, lines, net }, period());
    } else {
      const id = 'manual-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      Store.addJournal({ id, description, source: 'บันทึกเอง', lines, net }, period());
    }
    closeForm();
    render();
  }

  $('addBtn').onclick = () => openForm(null);
  $('mCancel').onclick = closeForm;
  $('mAddLine').onclick = () => { $('mLines').appendChild(lineRow()); };
  $('mSave').onclick = saveManual;

  // Backup / restore. Eliminations only live in this browser's localStorage,
  // so a file is the only way to survive a cleared cache or move machines.
  $('exportBtn').onclick = () => {
    const pk = period();
    const list = Store.journals(pk);
    if (!list.length) { alert('ยังไม่มีรายการให้บันทึก'); return; }
    const blob = new Blob([JSON.stringify(Store.exportJournals(pk), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eliminations-' + (pk || new Date().toISOString().slice(0, 10)) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('importBtn').onclick = () => $('importInput').click();
  $('importInput').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const pk = period();
    const existing = Store.journals(pk).length;
    const whichPeriod = pk ? `งวด ${(Store.getPeriod(pk) || {}).label || pk}` : 'งวดปัจจุบัน';
    if (existing && !confirm(`การโหลดจากไฟล์จะแทนที่รายการเดิมทั้งหมด ${existing} รายการของ${whichPeriod} ต้องการดำเนินการต่อหรือไม่?`)) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let n;
      try {
        n = Store.importJournals(JSON.parse(reader.result), pk);
      } catch (err) {
        alert('โหลดไฟล์ไม่สำเร็จ: ' + err.message);
        return;
      } finally {
        e.target.value = '';
      }
      alert('โหลดรายการตัดบัญชีแล้ว ' + n + ' รายการ');
      render();
    };
    reader.onerror = () => { alert('อ่านไฟล์ไม่ได้'); e.target.value = ''; };
    reader.readAsText(file);
  };

  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  render();
})();
