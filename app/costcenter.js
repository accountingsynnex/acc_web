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
  // Cost centres opened inside an expanded department, keyed "dept|cc" — a
  // third level, present only when the imported TB carries that dimension.
  const expandedCCs = new Set();

  /* How the accounts inside a department are ordered. One shared setting,
     not one per department: picking "by code" once should reorder every
     drill-down at the same time, the way sorting a spreadsheet column does.
     Defaults to the largest spend first, which is what the ranking above
     shows. */
  let acctSort = { key: 'actual', dir: 'desc' };

  function sortAccounts(list) {
    const { key, dir } = acctSort, s = dir === 'asc' ? 1 : -1;
    const byCode = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
    // Accounts with no budget line have nothing to rank on, so they sort to
    // the bottom in BOTH directions — floating them to the top on an
    // ascending sort would bury the rows the sort was asked about.
    const valOf = a => key === 'budget' ? a.budget
      : key === 'variance' ? (a.budget == null ? null : a.actual - a.budget)
      : a.actual;
    return list.slice().sort((a, b) => {
      if (key === 'code') return s * byCode(a, b);
      const av = valOf(a), bv = valOf(b);
      if (av == null && bv == null) return byCode(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return s * (av - bv) || byCode(a, b);
    });
  }

  function sortableTh(key, label, cls) {
    const on = acctSort.key === key;
    const arrow = on ? (acctSort.dir === 'asc' ? '▲' : '▼') : '';
    return `<th class="${cls} sortable${on ? ' sorted' : ''}" data-sort="${key}" title="กดเพื่อเรียงลำดับ">${label}<span class="sarrow">${arrow}</span></th>`;
  }

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
    // '' = live; a saved period's key = viewing that archive's own
    // department detail instead, via the shared topbar picker
    // (period-picker.js). Budget stays a single GLOBAL record either way
    // (it's an ongoing target, not something any one closed period owns) —
    // the banner says so when viewing an archive so importing/clearing it
    // here doesn't look like it only touched this period.
    const period = Store.uiPeriod();
    if (!Store.hasData(period)) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้างบทดลอง</div><div class="d">กด <b>นำเข้า TB รายศูนย์ต้นทุน</b> ด้านบนขวา แล้วเลือกไฟล์งบทดลองที่มีคอลัมน์ <b>Department</b> — หรือไปที่ <a class="linkish" href="import.html">Import TB</a></div></div></div>`;
      $('tiles').innerHTML = ''; $('overrunPanel').style.display = 'none'; $('deptPanel').style.display = 'none';
      return;
    }
    if (!Store.hasDeptData(period)) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">งบทดลองที่นำเข้าไม่มีมิติแผนก</div>
        <div class="d">หน้านี้ต้องใช้ TB ที่มีคอลัมน์ <b>Department</b> (หนึ่งแถวต่อ บัญชี×แผนก) — ไฟล์ที่นำเข้าตอนนี้เป็น TB รวมรายบัญชีอย่างเดียว กด <b>นำเข้า TB รายศูนย์ต้นทุน</b> ด้านบนขวาได้เลย (ถ้าไฟล์มีหลายเดือนในไฟล์เดียว ระบบแยกงวดให้เอง) — หรือไปที่หน้า <a class="linkish" href="import.html">Import TB</a></div></div></div>`;
      $('tiles').innerHTML = ''; $('overrunPanel').style.display = 'none'; $('deptPanel').style.display = 'none';
      return;
    }
    $('overrunPanel').style.display = ''; $('deptPanel').style.display = '';

    const { rows, deptNames, ccNames, sources, hasCC } = Store.deptRows(period);
    const budgetRec = Store.budget();
    const bmap = budgetRec && budgetRec.map;
    const expense = rows.filter(r => isExpense(r.code));

    const nameOf = d => deptNames[d] || d;
    const ccNameOf = (d, cc) => ccNames[d + ' ' + cc] || cc;
    // buildRows already strips the "-Department-Cost centre" labels these
    // exports append to the account name, so this is only a fallback for a
    // TB imported before it did.
    const acctName = r => {
      const tail = [nameOf(r.dept), r.cc ? ccNameOf(r.dept, r.cc) : ''].filter(Boolean);
      let n = (r.name || '').trim();
      for (const t of [tail.join('-'), tail[0]]) {
        if (t && n.endsWith('-' + t)) { n = n.slice(0, -(t.length + 1)); break; }
      }
      return n.trim() || r.code;
    };

    // ---- aggregate by department, then by cost centre, then by account ----
    const byDept = new Map();
    for (const r of expense) {
      if (!byDept.has(r.dept)) byDept.set(r.dept, { code: r.dept, actual: 0, exactBudget: 0, hasExact: false, accounts: [], ccs: new Map() });
      const d = byDept.get(r.dept);
      d.actual += r.closing;
      const b = exactBudget(bmap, r.code, r.dept);
      if (b != null) { d.exactBudget += b; d.hasExact = true; }
      const acct = { code: r.code, name: acctName(r), actual: r.closing, budget: b };
      d.accounts.push(acct);
      if (r.cc) {
        if (!d.ccs.has(r.cc)) d.ccs.set(r.cc, { code: r.cc, actual: 0, accounts: [] });
        const c = d.ccs.get(r.cc);
        c.actual += r.closing;
        c.accounts.push(acct);
      }
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
      if (!byAccount.has(r.code)) byAccount.set(r.code, { code: r.code, name: acctName(r), actual: 0, budget: 0, hasBudget: false });
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
    const archiveNote = period
      ? `<div class="inline-note" style="margin-top:10px">⚠ กำลังดูงวดที่บันทึกไว้ <b>${esc((Store.getPeriod(period) || {}).label || period)}</b> — Budget เป็นค่ากลางใช้ร่วมกันทุกงวด ไม่ได้ผูกกับงวดนี้โดยเฉพาะ นำเข้า/ล้างที่นี่จะกระทบทุกงวดที่ดู</div>`
      : '';
    $('banner').innerHTML = (hasBudget
      ? `<div class="check ok" style="margin-bottom:18px"><div class="ico">✓</div><div><div class="t">คำนวณสดจากงบทดลองรายแผนกที่นำเข้า${srcNote}</div>
          <div class="d">Budget จากไฟล์ <b>${esc(budgetRec.fileName)}</b> — <button class="linkish" id="clearBudgetBtn">ล้าง Budget</button></div></div></div>`
      : `<div class="check no" style="margin-bottom:18px"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้า Budget — แสดงเฉพาะ Actual${srcNote}</div>
          <div class="d">กด <b>นำเข้า Budget</b> ด้านบนขวา แล้วเลือกไฟล์ CSV/Excel ที่มีคอลัมน์ <b>แผนก</b> + <b>งบประมาณ</b> (ใส่คอลัมน์ <b>รหัสบัญชี</b> ด้วยก็ได้ ถ้าอยากเทียบระดับบัญชี)</div></div></div>`) + archiveNote;
    const clearBtn = $('clearBudgetBtn');
    if (clearBtn) clearBtn.onclick = () => { Store.clearBudget(); render(); };

    const overCount = depts.filter(d => d.variance > 0.5).length;
    $('tiles').innerHTML = [
      tile('Actual รวม (ทุกแผนก)', M(totalActual), 'จากบัญชีค่าใช้จ่าย 6xxxxxx'),
      hasBudget ? tile('Budget รวม (ทุกแผนก)', M(totalBudget), `${depts.length} แผนก`)
        : hasCC ? tile('แผนก / ศูนย์ต้นทุน', `${depts.length} / ${new Set(expense.filter(r => r.cc).map(r => r.dept + '|' + r.cc)).size}`, 'จากมิติในไฟล์ที่นำเข้า')
          : tile('จำนวนแผนก', String(depts.length), 'จากมิติแผนกในไฟล์'),
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
    const splitCount = deptAll.filter(d => d.ccs.size > 1).length;
    $('deptSub').textContent = `ครบทั้ง ${deptAll.length} แผนก — ${hasBudget ? 'เรียงตามผลต่างสัมบูรณ์' : 'เรียงตามยอดใช้จ่าย'} (กราฟแสดง Top 8, ตารางเลื่อนดูได้ครบ)`
      + (splitCount ? ` · ${splitCount} แผนกกดเข้าไปดูรายศูนย์ต้นทุนได้` : '');

    const acctCols = () => `${sortableTh('code', 'บัญชี', '')}${sortableTh('actual', 'Actual', 'r')}${accountBudgets ? sortableTh('budget', 'Budget', 'r') + sortableTh('variance', 'ผลต่าง', 'r') : ''}`;
    const acctLine = a => {
      const v = a.budget == null ? null : a.actual - a.budget;
      return `<tr class="${v != null && v > 0.5 ? 'acct-over' : ''}">
        <td class="code">${esc(a.name)}<div class="muted" style="font-size:10.5px;font-weight:500">${esc(a.code)}</div></td>
        <td class="r">${money(a.actual)}</td>
        ${accountBudgets ? `<td class="r">${a.budget == null ? '—' : money(a.budget)}</td>
        <td class="r ${v != null && v > 0 ? 'neg' : ''}">${v == null ? '—' : (v >= 0 ? '+' : '') + money(v)}</td>` : ''}
      </tr>`;
    };
    // Accounts of one department, merged across its cost centres — the view
    // when the export has no cost-centre dimension, and the fallback for a
    // department that has all its spend under a single one.
    const acctTable = list => `<div class="acct-scroll"><table>
      <thead><tr>${acctCols()}</tr></thead>
      <tbody>${sortAccounts(list).map(acctLine).join('')}</tbody>
    </table></div>`;

    /* Cost centres of one department. Each is a row that opens to its own
       accounts, so the department stays readable at a glance (which team
       spent what) with the account detail one more click down rather than
       hundreds of rows deep. Only rendered when the import actually carries
       the dimension AND the department is split across more than one — a
       department with a single cost centre would just be the same list
       behind an extra click. */
    function ccTable(d) {
      const list = [...d.ccs.values()].sort((a, b) => b.actual - a.actual);
      const row = c => {
        const key = d.code + '|' + c.code;
        const open = expandedCCs.has(key);
        const share = d.actual ? 100 * c.actual / d.actual : 0;
        return `<tr class="cc-row ${open ? 'open' : ''}" data-cc="${esc(key)}">
            <td class="chev">${open ? '▾' : '▸'}</td>
            <td class="code">${esc(ccNameOf(d.code, c.code))} <span class="muted" style="font-weight:500">(${esc(c.code)})</span></td>
            <td class="r">${money(c.actual)}</td>
            <td class="r muted">${share.toFixed(1)}%</td>
          </tr>
          <tr class="cc-detail" ${open ? '' : 'hidden'}><td colspan="4"><div class="inner">${acctTable(c.accounts)}</div></td></tr>`;
      };
      return `<div class="acct-scroll"><table>
        <thead><tr><th></th><th>ศูนย์ต้นทุน</th><th class="r">Actual</th><th class="r">สัดส่วนในแผนก</th></tr></thead>
        <tbody>${list.map(row).join('')}</tbody>
      </table></div>`;
    }

    function detailHtml(d) {
      const open = expandedDepts.has(d.code);
      // Every account, not a top-N slice: once the header can be sorted, a
      // cut-off would silently hide whatever the chosen order pushed down —
      // and sorting by code exists precisely to go find one account. Long
      // departments scroll inside the drill-down instead (CSS max-height, so
      // short ones get no scrollbar at all).
      const inner = d.ccs.size > 1 ? ccTable(d) : acctTable(d.accounts);
      return `<tr class="dept-detail" data-for="${esc(d.code)}" ${open ? '' : 'hidden'}><td colspan="${hasBudget ? 6 : 4}"><div class="inner">${inner}</div></td></tr>`;
    }

    $('deptTbl').innerHTML = `<thead><tr><th></th><th>แผนก</th><th class="r">Actual</th>${hasBudget ? '<th class="r">Budget</th><th class="r">ผลต่าง</th><th>สถานะ</th>' : ''}</tr></thead>
      <tbody>${deptAll.map(d => `
        <tr class="dept-row ${expandedDepts.has(d.code) ? 'open' : ''}" data-dept="${esc(d.code)}">
          <td class="chev">${expandedDepts.has(d.code) ? '▾' : '▸'}</td>
          <td class="code">${esc(nameOf(d.code))} <span class="muted" style="font-weight:500">(${esc(d.code)})</span>${d.ccs.size > 1 ? `<div class="muted" style="font-size:11px;font-weight:500">${d.ccs.size} ศูนย์ต้นทุน</div>` : ''}</td>
          <td class="r">${money(d.actual)}</td>
          ${hasBudget ? `<td class="r">${money(d.budget)}</td>
          <td class="r ${d.variance > 0 ? 'neg' : ''}">${d.variance >= 0 ? '+' : ''}${money(d.variance)}</td>
          <td>${statusChip(d.variance)}</td>` : ''}
        </tr>
        ${detailHtml(d)}`).join('')}</tbody>`;
    $('deptTbl').onclick = e => {
      // Sorting a drill-down header re-renders every drill-down at once;
      // expandedDepts is module state, so which departments are open
      // survives the redraw. Clicking the same column again flips direction.
      const th = e.target.closest('[data-sort]');
      if (th) {
        const key = th.dataset.sort;
        if (acctSort.key === key) acctSort.dir = acctSort.dir === 'asc' ? 'desc' : 'asc';
        else acctSort = { key, dir: key === 'code' ? 'asc' : 'desc' };   // codes read best low→high, money high→low
        render();
        return;
      }
      // A cost-centre row lives inside a department's own drill-down, so it
      // has to be checked before the department row that contains it.
      const ccRow = e.target.closest('.cc-row');
      if (ccRow) {
        const key = ccRow.dataset.cc;
        const openCC = !expandedCCs.has(key);
        if (openCC) expandedCCs.add(key); else expandedCCs.delete(key);
        ccRow.classList.toggle('open', openCC);
        ccRow.querySelector('.chev').textContent = openCC ? '▾' : '▸';
        ccRow.nextElementSibling.hidden = !openCC;
        return;
      }
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

  /* ---- department/cost-centre TB import, from this page ----------------
     The same reader the Import page uses (month-import.js), offered here
     because this is the page that needs the dimension — a file holding a
     month per sheet becomes a period each, and always the separate keys:
     a page about cost centres has no business rewriting the trial balance
     the statements are built from. A single-sheet file goes to the period
     being viewed, which is the one the reader is looking at. */
  const ENTITY_CODES = (RULEBOOK.entities || []).map(e => e.code);
  $('tbBtn').onclick = () => $('tbInput').click();
  $('tbInput').onchange = e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => alert('อ่านไฟล์ไม่ได้');
    reader.onload = () => setTimeout(() => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), {
          type: 'array', cellStyles: false, cellFormula: false, cellHTML: false, cellNF: false, bookVBA: false,
        });
        const entity = MonthTB.guessEntity(wb, ENTITY_CODES);
        const months = MonthTB.monthSheetsOf(wb, entity);
        if (months.length) {
          const plan = MonthTB.planFor(months);
          if (!confirm(MonthTB.confirmText(entity, plan))) return;
          const result = MonthTB.run(entity, file.name, wb, plan);
          alert(MonthTB.resultText(entity, result));
          // Land on a period the reader can actually see the result in. A
          // reload is what redraws the topbar picker around the new periods
          // — it paints itself once, the same as when a period is picked.
          if (result.added.length) { Store.setUiPeriod(plan[plan.length - 1].key); location.reload(); return; }
        } else {
          const sheet = wb.SheetNames.find(n => MonthTB.periodKeyFromSheetName(n) === Store.uiPeriod())
            || wb.SheetNames[0];
          const { rows, deptRows, dimNames } = buildRows(
            XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null }));
          if (!rows.length) throw new Error('ไม่พบแถวบัญชีในไฟล์');
          if (!deptRows.length && !confirm(`ชีต "${sheet}" ไม่มีคอลัมน์ Department — นำเข้าเป็นงบทดลองธรรมดาของ ${entity} ต่อไหม?`)) return;
          Store.setTB(entity, file.name + ' › ' + sheet, rows, Store.uiPeriod(), deptRows,
            deptRows.length ? sheet : '', dimNames);
          alert(`นำเข้า ${entity} จากชีต "${sheet}" แล้ว (${rows.length} บัญชี, ${deptRows.length} แถวมิติ)`);
        }
      } catch (err) { alert('อ่านไฟล์ไม่ได้: ' + err.message); }
      render();
    }, 30);
    reader.readAsArrayBuffer(file);
  };

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
