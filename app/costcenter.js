/* Cost Center — department expense view, computed live from the imported
   TB. Needs a TB export that carries a Department column (buildRows keeps
   that dimension alongside the deduped rows); without one this page says so
   rather than showing anything.

   Budget is a separate import — no accounting system ships budget with the
   trial balance. Until one is loaded the page runs actual-only: same
   ranking and drill-down, just no variance columns. Deliberately not a full
   grid of every account/department — one curated overspend ranking plus a
   department summary that drills down, mirroring the Inventory dashboard. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { const a = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); return n < 0 ? '(' + a + ')' : a; };
  const M = n => (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M';
  const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;

  // Expense accounts only — this page is about spend, not the whole TB.
  const isExpense = code => /^6/.test(code);

  const expandedDepts = new Set();
  const charts = {};
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function drawChart(canvasId, labels, actualData, budgetData) {
    if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }
    const el = $(canvasId);
    if (!el || !labels.length) return;
    const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), accent = cssVar('--accent'), bad = cssVar('--bad');
    const datasets = [{ label: 'Actual', data: actualData, backgroundColor: budgetData ? bad : accent, borderRadius: 3 }];
    if (budgetData) datasets.push({ label: 'Budget', data: budgetData, backgroundColor: accent, borderRadius: 3 });
    charts[canvasId] = new Chart(el.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !!budgetData, position: 'top', align: 'end', labels: { color: muted, boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw.toLocaleString('en-US', { maximumFractionDigits: 0 })}` } },
        },
        scales: {
          x: { ticks: { color: muted, font: { size: 10.5 }, callback: v => (v / 1e6) + 'M' }, grid: { color: line } },
          y: { ticks: { color: ink, font: { size: 11.5 } }, grid: { display: false } },
        },
      },
    });
  }

  function statusChip(variance) {
    if (variance > 0.5) return `<span class="chip bad"><span class="dot"></span>เกิน budget</span>`;
    if (variance < -0.5) return `<span class="chip good"><span class="dot"></span>ต่ำกว่า budget</span>`;
    return `<span class="chip neutral"><span class="dot"></span>ตรง budget</span>`;
  }

  /* Budget is looked up per (account, department) only. A department-only
     budget line is applied once to the department total instead — applying
     it per account would multiply it by however many accounts that
     department happens to have. */
  const exactBudget = (map, code, dept) => { const v = map && map[code + ' ' + dept]; return v == null ? null : v; };

  function parseBudget(matrix) {
    if (!matrix || !matrix.length) throw new Error('ไฟล์ว่าง');
    const headers = matrix[0];
    const find = names => {
      for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i] == null ? '' : headers[i]).trim().toLowerCase();
        if (names.some(n => h === n || h.includes(n))) return i;
      }
      return -1;
    };
    const di = find(['department', 'dept', 'cost center', 'แผนก', 'ศูนย์ต้นทุน']);
    const ci = find(['mainaccount', 'account code', 'account', 'code', 'รหัส']);
    const bi = find(['budget', 'งบประมาณ', 'งบ']);
    if (di === -1) throw new Error('ไม่พบคอลัมน์แผนก (Department / แผนก)');
    if (bi === -1) throw new Error('ไม่พบคอลัมน์งบประมาณ (Budget / งบประมาณ)');
    const map = {};
    for (let r = 1; r < matrix.length; r++) {
      const cells = matrix[r] || [];
      const dept = String(cells[di] == null ? '' : cells[di]).trim();
      if (!dept) continue;
      const amount = toNumber(cells[bi]);
      if (!isFinite(amount)) continue;
      const code = ci === -1 ? '' : String(cells[ci] == null ? '' : cells[ci]).trim();
      const key = (code && /^\d{3,}$/.test(code) ? code : '') + ' ' + dept;
      map[key] = (map[key] || 0) + amount;
    }
    if (!Object.keys(map).length) throw new Error('ไม่พบบรรทัดงบประมาณที่ใช้ได้');
    return map;
  }

  function render() {
    if (!Store.hasData()) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้างบทดลอง</div><div class="d">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div></div></div>`;
      $('tiles').innerHTML = ''; $('overrunPanel').style.display = 'none'; $('deptPanel').style.display = 'none';
      return;
    }
    if (!Store.hasDeptData()) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">งบทดลองที่นำเข้าไม่มีมิติแผนก</div>
        <div class="d">หน้านี้ต้องใช้ TB ที่มีคอลัมน์ <b>Department</b> (หนึ่งแถวต่อ บัญชี×แผนก) — ไฟล์ที่นำเข้าตอนนี้เป็น TB รวมรายบัญชีอย่างเดียว ลองนำเข้าไฟล์ TB รายแผนกที่หน้า <a class="linkish" href="import.html">Import TB</a></div></div></div>`;
      $('tiles').innerHTML = ''; $('overrunPanel').style.display = 'none'; $('deptPanel').style.display = 'none';
      return;
    }
    $('overrunPanel').style.display = ''; $('deptPanel').style.display = '';

    const { rows, deptNames, sources } = Store.deptRows();
    const budgetRec = Store.budget();
    const bmap = budgetRec && budgetRec.map;
    const expense = rows.filter(r => isExpense(r.code));

    const nameOf = d => deptNames[d] || d;

    // ---- aggregate by department, and by account within each department ----
    const byDept = new Map();
    for (const r of expense) {
      if (!byDept.has(r.dept)) byDept.set(r.dept, { code: r.dept, actual: 0, exactBudget: 0, hasExact: false, accounts: [] });
      const d = byDept.get(r.dept);
      d.actual += r.closing;
      const b = exactBudget(bmap, r.code, r.dept);
      if (b != null) { d.exactBudget += b; d.hasExact = true; }
      d.accounts.push({ code: r.code, name: (r.name || '').split('-')[0].trim() || r.code, actual: r.closing, budget: b });
    }
    const depts = [...byDept.values()].map(d => {
      // Per-account budget when the file has that detail, otherwise the
      // department's own single line — counted once, not once per account.
      const budget = d.hasExact ? d.exactBudget : (bmap && bmap[' ' + d.code] != null ? bmap[' ' + d.code] : 0);
      return { ...d, budget, variance: d.actual - budget };
    });
    // Company-wide account view: same code re-aggregated across departments.
    // Only exact (account, department) budgets roll up here — a
    // department-only budget can't be attributed to a specific account.
    const byAccount = new Map();
    for (const r of expense) {
      if (!byAccount.has(r.code)) byAccount.set(r.code, { code: r.code, name: (r.name || '').split('-')[0].trim() || r.code, actual: 0, budget: 0, hasBudget: false });
      const a = byAccount.get(r.code);
      a.actual += r.closing;
      const b = exactBudget(bmap, r.code, r.dept);
      if (b != null) { a.budget += b; a.hasBudget = true; }
    }
    const accounts = [...byAccount.values()].map(a => ({ ...a, variance: a.actual - a.budget, pct: a.budget ? 100 * (a.actual - a.budget) / a.budget : null }));
    const accountBudgets = accounts.some(a => a.hasBudget);

    const totalActual = depts.reduce((s, d) => s + d.actual, 0);
    const totalBudget = depts.reduce((s, d) => s + d.budget, 0);
    const hasBudget = !!bmap;

    // Name the sheet the department detail came from: it's often a separate
    // sheet from the entity's own TB, and can therefore be a different
    // period than the rest of the app is showing.
    const srcNote = sources && sources.length ? ` — มิติแผนกจากชีต <b>${esc(sources.join(', '))}</b>` : '';
    $('banner').innerHTML = hasBudget
      ? `<div class="check ok" style="margin-bottom:18px"><div class="ico">✓</div><div><div class="t">คำนวณสดจากงบทดลองรายแผนกที่นำเข้า${srcNote}</div>
          <div class="d">Budget จากไฟล์ <b>${esc(budgetRec.fileName)}</b> — <button class="linkish" id="clearBudgetBtn">ล้าง Budget</button></div></div></div>`
      : `<div class="check no" style="margin-bottom:18px"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้า Budget — แสดงเฉพาะ Actual${srcNote}</div>
          <div class="d">กด <b>นำเข้า Budget</b> ด้านบนขวา แล้วเลือกไฟล์ CSV/Excel ที่มีคอลัมน์ <b>แผนก</b> + <b>งบประมาณ</b> (ใส่คอลัมน์ <b>รหัสบัญชี</b> ด้วยก็ได้ ถ้าอยากเทียบระดับบัญชี)</div></div></div>`;
    const clearBtn = $('clearBudgetBtn');
    if (clearBtn) clearBtn.onclick = () => { Store.clearBudget(); render(); };

    const overCount = depts.filter(d => d.variance > 0.5).length;
    $('tiles').innerHTML = [
      tile('Actual รวม (ทุกแผนก)', M(totalActual), 'จากบัญชีค่าใช้จ่าย 6xxxxxx'),
      hasBudget ? tile('Budget รวม (ทุกแผนก)', M(totalBudget), `${depts.length} แผนก`) : tile('จำนวนแผนก', String(depts.length), 'จากมิติแผนกในไฟล์'),
      hasBudget
        ? tile('ผลต่างรวม', (totalActual - totalBudget < 0 ? '−' : '+') + M(Math.abs(totalActual - totalBudget)), totalActual > totalBudget ? 'ใช้เกิน budget' : 'ใช้ต่ำกว่า budget', totalActual > totalBudget ? 'flag' : '')
        : tile('จำนวนบัญชีค่าใช้จ่าย', String(accounts.length), 'ที่มียอดในงวดนี้'),
      hasBudget
        ? tile('แผนกที่เกิน budget', String(overCount), `จาก ${depts.length} แผนก`, overCount ? 'flag' : '')
        : tile('แผนกที่ใช้จ่ายสูงสุด', nameOf(depts.slice().sort((a, b) => b.actual - a.actual)[0].code), M(Math.max(...depts.map(d => d.actual)))),
    ].join('');

    // ---- account ranking ----
    const ranked = accountBudgets
      ? accounts.filter(a => a.hasBudget && a.variance > 0).sort((a, b) => b.variance - a.variance)
      : accounts.slice().sort((a, b) => b.actual - a.actual);
    const top5 = ranked.slice(0, 5);
    $('overrunTitle').textContent = accountBudgets ? 'รายการที่ทำให้เกินงบประมาณมากที่สุด' : 'รายการที่ใช้จ่ายมากที่สุด';
    $('overrunSub').textContent = accountBudgets ? 'Top 5 บัญชี ตาม Actual เทียบ Budget' : `Top 5 บัญชี จากทั้งหมด ${accounts.length} บัญชี` + (hasBudget ? ' — Budget ที่นำเข้าเป็นระดับแผนก จึงเทียบรายบัญชีไม่ได้' : '');
    const pool = ranked.reduce((s, r) => s + (accountBudgets ? r.variance : r.actual), 0);
    $('overrunBadge').textContent = accountBudgets
      ? `เกินรวม +${M(pool)} (จาก ${accounts.length} บัญชี)`
      : `รวมทุกบัญชี ${M(totalActual)}`;
    $('overrunTbl').innerHTML = `<thead><tr><th>#</th><th>ค่าใช้จ่าย</th><th class="r">Actual</th>${accountBudgets ? '<th class="r">Budget</th><th class="r">เกินงบ</th><th class="r">% เกิน</th>' : ''}<th class="r">สัดส่วน</th></tr></thead>
      <tbody>${top5.map((r, i) => `<tr><td>${i + 1}</td>
        <td class="code">${esc(r.name)}<div class="muted" style="font-size:11px;font-weight:500">Account ${esc(r.code)}</div></td>
        <td class="r">${money(r.actual)}</td>
        ${accountBudgets ? `<td class="r">${money(r.budget)}</td>
        <td class="r neg">+${money(r.variance)}</td>
        <td class="r neg">${r.pct == null ? '—' : '+' + r.pct.toFixed(1) + '%'}</td>` : ''}
        <td class="r">${pool ? (100 * (accountBudgets ? r.variance : r.actual) / pool).toFixed(1) + '%' : '—'}</td></tr>`).join('')}</tbody>`;
    drawChart('overrunChart', top5.map(r => r.name), top5.map(r => r.actual), accountBudgets ? top5.map(r => r.budget) : null);

    // ---- department summary + drill-down ----
    const deptAll = depts.slice().sort((a, b) => hasBudget ? Math.abs(b.variance) - Math.abs(a.variance) : b.actual - a.actual);
    $('deptSub').textContent = `ครบทั้ง ${deptAll.length} แผนก — ${hasBudget ? 'เรียงตามผลต่างสัมบูรณ์' : 'เรียงตามยอดใช้จ่าย'} (กราฟแสดง Top 8, ตารางเลื่อนดูได้ครบ)`;

    function detailHtml(d) {
      const open = expandedDepts.has(d.code);
      const list = d.accounts.slice().sort((a, b) => b.actual - a.actual);
      const top = list.slice(0, 8);
      const rest = list.slice(8);
      const restActual = rest.reduce((s, a) => s + a.actual, 0);
      const restBudget = rest.reduce((s, a) => s + (a.budget || 0), 0);
      const line = a => {
        const v = a.budget == null ? null : a.actual - a.budget;
        return `<tr class="${v != null && v > 0.5 ? 'acct-over' : ''}">
          <td class="code">${esc(a.name)}<div class="muted" style="font-size:10.5px;font-weight:500">${esc(a.code)}</div></td>
          <td class="r">${money(a.actual)}</td>
          ${accountBudgets ? `<td class="r">${a.budget == null ? '—' : money(a.budget)}</td>
          <td class="r ${v != null && v > 0 ? 'neg' : ''}">${v == null ? '—' : (v >= 0 ? '+' : '') + money(v)}</td>` : ''}
        </tr>`;
      };
      return `<tr class="dept-detail" data-for="${esc(d.code)}" ${open ? '' : 'hidden'}><td colspan="${hasBudget ? 6 : 4}"><div class="inner"><table>
        <thead><tr><th>บัญชี</th><th class="r">Actual</th>${accountBudgets ? '<th class="r">Budget</th><th class="r">ผลต่าง</th>' : ''}</tr></thead>
        <tbody>${top.map(line).join('')}${rest.length ? line({ code: '', name: `อื่นๆ (${rest.length} บัญชี)`, actual: restActual, budget: accountBudgets ? restBudget : null }) : ''}</tbody>
      </table></div></td></tr>`;
    }

    $('deptTbl').innerHTML = `<thead><tr><th></th><th>แผนก</th><th class="r">Actual</th>${hasBudget ? '<th class="r">Budget</th><th class="r">ผลต่าง</th><th>สถานะ</th>' : ''}</tr></thead>
      <tbody>${deptAll.map(d => `
        <tr class="dept-row ${expandedDepts.has(d.code) ? 'open' : ''}" data-dept="${esc(d.code)}">
          <td class="chev">${expandedDepts.has(d.code) ? '▾' : '▸'}</td>
          <td class="code">${esc(nameOf(d.code))} <span class="muted" style="font-weight:500">(${esc(d.code)})</span></td>
          <td class="r">${money(d.actual)}</td>
          ${hasBudget ? `<td class="r">${money(d.budget)}</td>
          <td class="r ${d.variance > 0 ? 'neg' : ''}">${d.variance >= 0 ? '+' : ''}${money(d.variance)}</td>
          <td>${statusChip(d.variance)}</td>` : ''}
        </tr>
        ${detailHtml(d)}`).join('')}</tbody>`;
    $('deptTbl').onclick = e => {
      const row = e.target.closest('.dept-row');
      if (!row) return;
      const code = row.dataset.dept;
      const detailRow = row.nextElementSibling;
      const open = !expandedDepts.has(code);
      if (open) expandedDepts.add(code); else expandedDepts.delete(code);
      row.classList.toggle('open', open);
      row.querySelector('.chev').textContent = open ? '▾' : '▸';
      detailRow.hidden = !open;
    };
    const deptTop = deptAll.slice(0, 8);
    drawChart('deptChart', deptTop.map(d => nameOf(d.code)), deptTop.map(d => d.actual), hasBudget ? deptTop.map(d => d.budget) : null);
  }

  // ---- budget import ----
  $('budgetBtn').onclick = () => $('budgetInput').click();
  $('budgetInput').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const done = map => { Store.setBudget(map, file.name); render(); };
    const fail = msg => alert('อ่านไฟล์ Budget ไม่ได้: ' + msg);
    const reader = new FileReader();
    if (/\.xlsx?$/i.test(file.name)) {
      reader.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
          done(parseBudget(aoa));
        } catch (err) { fail(err.message); } finally { e.target.value = ''; }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        try {
          const text = String(reader.result).replace(/^﻿/, '');
          const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
          const sep = (lines[0].split('\t').length > lines[0].split(',').length) ? '\t' : ',';
          done(parseBudget(lines.map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '')))));
        } catch (err) { fail(err.message); } finally { e.target.value = ''; }
      };
      reader.readAsText(file);
    }
  };

  $('themeBtn').onclick = () => {
    const r = document.documentElement;
    r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    render();
  };
  render();
})();
