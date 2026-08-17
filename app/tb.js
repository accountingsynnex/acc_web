/* Trial Balance — combining worksheet: every account across entities +
   consolidated, grouped by section, auto-grouped via the engine.
   Globals: RULEBOOK, applyRulebook/validateTB, Store. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? '(' + a + ')' : a; };
  const cell = n => `<td class="ent ${Math.abs(n) < 0.005 ? 'zero' : (n < 0 ? 'neg' : '')}">${money(n)}</td>`;

  const SECTION_ORDER = ['Current Assets', 'Non-current Assets', 'Current Liabilities', 'Non-current Liabilities', 'Equity',
    'Revenue', 'Cost of Sales', 'Operating Expenses', 'Other Income / Expense', 'Finance Costs', 'Share of Profit', 'Income Tax'];
  const NEW = 'รอจับคู่ (รหัสใหม่)';

  const state = { q: '', statement: 'all', status: 'all' };
  // '' = live; a saved period's key = viewing that archive instead, via the
  // shared topbar picker (period-picker.js). Read-only page, so this is
  // always safe to switch.
  const period = Store.uiPeriod();

  // entities in canonical order, only those loaded
  const ents = () => RULEBOOK.entities.map(e => e.code).filter(c => Store.entitiesLoaded(period).includes(c));

  // code -> { code, name, byEnt:{ent:bal}, total }
  function perEntity() {
    const map = new Map();
    for (const ent of ents()) {
      for (const r of Store.tb(ent, period).rows) {
        let o = map.get(r.code);
        if (!o) { o = { code: r.code, name: r.name, byEnt: {}, total: 0 }; map.set(r.code, o); }
        o.byEnt[ent] = (o.byEnt[ent] || 0) + r.closing;
        o.total += r.closing;
        if (!o.name && r.name) o.name = r.name;
      }
    }
    return map;
  }

  const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;

  function render() {
    const E = ents();
    if (!E.length) {
      $('tiles').innerHTML = '';
      $('tbTable').innerHTML = `<tbody><tr><td><div class="results-empty"><div class="big">ยังไม่ได้นำเข้างบทดลอง</div>
        <div class="muted">ไปที่ <a class="linkish" href="import.html">Import TB</a> เพื่ออัปโหลดไฟล์ก่อน</div></div></td></tr></tbody>`;
      $('countSub').textContent = '';
      return;
    }

    const rules = Store.mappings();
    const ruleFor = code => rules[code] || RULEBOOK.rules[code] || null;
    const accounts = [...perEntity().values()].map(o => {
      const r = ruleFor(o.code);
      return { ...o, rule: r, status: r ? 'mapped' : 'new', section: r ? r.section : NEW, group: r ? r.group : '—', statement: r ? r.statement : null };
    });

    // tiles
    const combined = Store.combinedRows(period ? Store.tbFor(period) : undefined);
    const res = applyRulebook(combined, RULEBOOK, rules);
    const allBalanced = E.every(e => validateTB(Store.tb(e, period).rows, 5).balanced);
    $('tiles').innerHTML = [
      tile('บัญชีทั้งหมด', accounts.length.toLocaleString(), `รวม ${E.length} บริษัท`),
      tile('จัดกลุ่มอัตโนมัติแล้ว', res.stats.mappedPct + '%', `${res.stats.mapped}/${res.stats.total} รหัส`),
      tile('งบทดลองสมดุล', allBalanced ? 'ผ่าน' : 'ตรวจ', `Debit = Credit ${E.length} บริษัท`).replace('<div class="v">', `<div class="v" style="color:var(--${allBalanced ? 'good' : 'bad'})">`),
      tile('บริษัทที่นำเข้า', String(E.length), E.join(' · ')),
    ].join('');

    // filter
    const q = state.q.toLowerCase();
    const filtered = accounts.filter(a => {
      if (state.statement !== 'all' && a.statement !== state.statement) return false;
      if (state.status !== 'all' && a.status !== state.status) return false;
      if (q && !(a.code.toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q) || (a.group || '').toLowerCase().includes(q))) return false;
      return true;
    });

    // group by section, in canonical order (unknown sections after, NEW last)
    const bySection = {};
    filtered.forEach(a => (bySection[a.section] = bySection[a.section] || []).push(a));
    const order = SECTION_ORDER.filter(s => bySection[s])
      .concat(Object.keys(bySection).filter(s => !SECTION_ORDER.includes(s) && s !== NEW).sort())
      .concat(bySection[NEW] ? [NEW] : []);

    const colspanLead = 3;               // code, name, group
    const head = `<thead><tr><th>รหัส</th><th>ชื่อบัญชี</th><th>กลุ่ม</th>${E.map(e => `<th class="ent">${esc(e)}</th>`).join('')}<th class="ent total-col">รวม</th></tr></thead>`;

    let body = '';
    for (const sec of order) {
      const list = bySection[sec].slice().sort((a, b) => a.code.localeCompare(b.code));
      body += `<tr class="section-row"><td colspan="${colspanLead + E.length + 1}">${esc(sec)}</td></tr>`;
      const subtot = {}; E.forEach(e => subtot[e] = 0); let subT = 0;
      for (const a of list) {
        E.forEach(e => subtot[e] += (a.byEnt[e] || 0)); subT += a.total;
        const groupCell = a.status === 'new'
          ? `<span class="chip warn"><span class="dot"></span>รหัสใหม่</span>`
          : `<span class="path"><span class="grp">${esc(a.group)}</span></span>`;
        body += `<tr><td class="code">${esc(a.code)}</td><td class="name">${esc(a.name)}</td><td>${groupCell}</td>${E.map(e => cell(a.byEnt[e] || 0)).join('')}<td class="ent total-col">${money(a.total)}</td></tr>`;
      }
      body += `<tr class="subtotal-row"><td class="lbl" colspan="${colspanLead}">รวม ${esc(sec)}</td>${E.map(e => `<td class="ent">${money(subtot[e])}</td>`).join('')}<td class="ent total-col">${money(subT)}</td></tr>`;
    }
    if (!filtered.length) body = `<tr><td colspan="${colspanLead + E.length + 1}"><div class="results-empty"><div>ไม่พบบัญชีตามตัวกรอง</div></div></td></tr>`;

    $('tbTable').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('countSub').textContent = `แสดง ${filtered.length.toLocaleString()} / ${accounts.length.toLocaleString()} บัญชี`;
  }

  $('q').addEventListener('input', e => { state.q = e.target.value; render(); });
  $('fStatement').addEventListener('change', e => { state.statement = e.target.value; render(); });
  $('fStatus').addEventListener('change', e => { state.status = e.target.value; render(); });
  $('nextBtn').onclick = () => { location.href = 'statements.html'; };
  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };

  render();
})();
