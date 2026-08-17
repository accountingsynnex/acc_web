/* Ratios — financial ratios from the rolled-up BS / P&L.

   All 3 tabs (Thailand / Taiwan / SET) render from ONE shared card list
   (RATIO_SPEC) and ONE shared renderer (renderTabCards) — same 16 ratios,
   same grouping, same order, same card style on every tab, so the numbers
   line up for a direct side-by-side comparison. The only thing that
   differs per tab is the FORMULA behind each number (computeTabMetrics),
   each one sourced from a real company file where we found one (Thailand =
   Conso/MD&A, Taiwan = Synnex Thai PAR's NROIC+KPI sheets, SET = the
   company's own "Synnex KPI / SET / Taiwan" comparison chart) and falling
   back to the same ending-balance convention where no tab-specific formula
   exists. Tab-only ratios that had no equivalent elsewhere (Taiwan's NROIC/
   Debt Ratio/Net Bank Loan to Equity, Thailand's Interest-Bearing D/E) and
   the bank-covenant pass/fail highlight (Thailand-only before) were dropped
   so the three lists could be genuinely identical — except AR Vendor Days,
   which the company's own comparison chart shows as a real Taiwan-only
   metric (blank for Synnex KPI/SET), so RATIO_SPEC restricts that one row
   to Taiwan (`only: 'tw'`) instead of showing it everywhere. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, unit) => v == null ? '—' : (unit === 'x' ? v.toFixed(2) + '×' : unit === 'pct' ? v.toFixed(1) + '%' : unit === 'days' ? v.toFixed(1) + ' วัน' : v.toFixed(2));
  const M = n => (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'M';

  // Which period the top cards show — ONE control, identical on all 3 tabs
  // (Q1 · Q2 · Q3 · Q4). Once ANYTHING has been saved on Import's "งวดที่
  // บันทึกไว้" (a single click, or the whole-year batch-drop that reads a
  // period straight from each file's own name), the buttons stop being a
  // manual month-count guess against the live TB and instead pick the
  // saved period that actually ends that quarter — Q1 → that year's own
  // "-03" period, Q2 → "-06", Q3 → "-09", Q4 → "-12" — so four real monthly
  // closes drive four real quarters instead of one file read four ways.
  // Before anything is archived at all (a brand new import, nothing saved
  // yet) the buttons fall back to their original job: told the live TB's
  // own month count directly, so a first-time user isn't forced to archive
  // a period just to see a ratio. PERIOD_OPTS' months (3/6/9/12) still
  // supplies that fallback and the days-per-quarter math either way — a
  // saved period's own key would derive the same number regardless (see
  // monthsFromKey below); it's only the DATA source that changes.
  const PERIOD_OPTS = [
    { key: 'q1', label: 'Q1', months: 3 },
    { key: 'q2', label: 'Q2', months: 6 },
    { key: 'q3', label: 'Q3', months: 9 },
    { key: 'q4', label: 'Q4', months: 12 },
  ];
  const QUARTER_END_MONTH = { q1: '03', q2: '06', q3: '09', q4: '12' };
  let periodSel = 'q1';
  const periodOpt = () => PERIOD_OPTS.find(o => o.key === periodSel) || PERIOD_OPTS[0];

  // Import's own period-key convention is "YYYY-MM" (see the "รหัสงวด เช่น
  // 2026-06" placeholder there) — the month is right there in the key, so
  // both the quarter resolver below and the trend loop further down read it
  // the same way, rather than guessing from a separately-typed label.
  const monthsFromKey = key => {
    const m = /^\d{4}-(\d{2})$/.exec(String(key || ''));
    const n = m ? +m[1] : NaN;
    return n >= 1 && n <= 12 ? n : null;
  };

  // Which saved period (if any) this quarter's own close resolves to, for
  // whichever year is the most recent one with anything saved at all — so
  // switching Q1→Q4 stays inside one consistent year instead of jumping to
  // whatever year happens to have that one quarter. `archived` is false
  // only when NOTHING has ever been saved (the pre-archive fallback); once
  // it's true, a quarter with no matching period is a real "not saved yet"
  // state, not a silent fallback to the live TB.
  function resolveQuarter(saved) {
    if (!saved.length) return { archived: false };
    let year = null;
    for (const p of saved) {
      const m = /^(\d{4})-\d{2}$/.exec(p.key);
      if (m && (!year || m[1] > year)) year = m[1];
    }
    const key = `${year}-${QUARTER_END_MONTH[periodSel]}`;
    return { archived: true, year, key, period: Store.getPeriod(key) };
  }

  // ---- Real trailing-12-months + cross-period averaging, matching the
  // company's own Cash Cycle sheet exactly (Synnex KPI/SET/Taiwan columns)
  // instead of the single-file approximation above — needs several months'
  // worth of saved periods to exist, which the batch-upload workflow makes
  // realistic to have. Every helper here returns null rather than an
  // estimate when a period it needs isn't archived, so computeTabMetrics
  // can tell the difference between "computed the real formula" and
  // "fell back to the approximation" instead of silently mixing the two.
  function shiftMonthKey(key, delta) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    const idx = (+m[1]) * 12 + (+m[2] - 1) + delta;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  }
  function plAt(key) {
    const rows = key ? Store.finalRows(key) : null;
    const g = rows && rows.length ? FS.grouped(rows) : null;
    return g ? FS.buildPL(g) : null;
  }
  function bsAt(key) {
    const rows = key ? Store.finalRows(key) : null;
    const g = rows && rows.length ? FS.grouped(rows) : null;
    return g ? FS.buildBS(g) : null;
  }
  /* ---- What each column actually measures ------------------------------
     The three columns don't just average differently — they measure
     DIFFERENT balances, each copied from the source that column comes from:

       Synnex KPI — the published consolidated balance sheet: ลูกหนี้การค้า
                    (net of the credit-loss allowance) plus its non-current
                    portion, สินค้าคงเหลือ net of the obsolescence allowance,
                    เจ้าหนี้การค้า.
       SET        — the same published lines, but AR read together with
                    ลูกหนี้หมุนเวียนอื่น and AP with เจ้าหนี้หมุนเวียนอื่น +
                    ค่าใช้จ่ายค้างจ่าย.
       Taiwan     — the Synnex Thai PAR workbook (ARINV / Factor(locked)):
                    AR and inventory GROSS, i.e. before those same two
                    allowances, and payables net of prepayments for
                    purchases (its "AP-Prepaid" line).

     A base is the list of this app's own grouping names that has to add up
     to one of those published lines, each optionally signed. A group the
     chart of accounts doesn't have simply contributes nothing, so a
     different company's mapping still computes rather than breaking. */
  const AS = 'assets', LI = 'liab', CUR = 'Current Assets', NCUR = 'Non-current Assets', CLB = 'Current Liabilities';
  const neg = spec => spec.map(([a, s, g]) => [a, s, g, -1]);
  const BASE = {
    // ลูกหนี้การค้า (หมุนเวียน) — the allowance is a credit-natured contra
    // account inside Current Assets, so adding it here is what nets it off.
    arNetCur: [[AS, CUR, 'Trade receivables'], [AS, CUR, 'Account receivable - other company'],
               [AS, CUR, 'Allowance for doubful debt'], [AS, CUR, 'Notes receivables']],
    arNonCur: [[AS, NCUR, 'ลูกหนี้การค้า']],
    arAllow: [[AS, CUR, 'Allowance for doubful debt']],
    otherRecv: [[AS, CUR, 'Other receivable'], [AS, CUR, 'Rebate receivables'], [AS, CUR, 'Prepayment'],
                [AS, CUR, 'Prepayment - VAT'], [AS, CUR, 'Provision for other receivable']],
    invGross: [[AS, CUR, 'Inventories']],
    invAllow: [[AS, CUR, 'Allowance for obsolete inventory']],
    apTrade: [[LI, CLB, 'Trade payable']],
    // เจ้าหนี้หมุนเวียนอื่น + ค่าใช้จ่ายค้างจ่าย as the published statement
    // states them. Vendor reserve is part of เจ้าหนี้หมุนเวียนอื่น there, but
    // the PAR reports it on its own line and leaves it OUT of the payable
    // it measures AP Days against — hence the separate entry.
    apVendorReserve: [[LI, CLB, 'Vendor reserve']],
    apOther: [[LI, CLB, 'Other payable'], [LI, CLB, 'Deposit received'], [LI, CLB, 'ค่าใช้จ่ายค้างจ่าย']],
    prepaid: [[AS, CUR, 'เงินจ่ายล่วงหน้าค่าสินค้า']],
    vendorAR: [[AS, CUR, 'Rebate receivables']],
  };
  // The composed bases each tab reads, in the same order as above.
  BASE.invNet = BASE.invGross.concat(BASE.invAllow);
  BASE.arTh = BASE.arNetCur.concat(BASE.arNonCur);       // Synnex KPI
  BASE.arSet = BASE.arNetCur.concat(BASE.otherRecv);     // SET
  BASE.arTw = BASE.arNetCur.concat(neg(BASE.arAllow));   // Taiwan — gross
  BASE.apSet = BASE.apTrade.concat(BASE.apOther, BASE.apVendorReserve);
  // The PAR's own "Notes & Accounts payable": trade payable together with
  // เจ้าหนี้หมุนเวียนอื่น but WITHOUT the vendor reserve it lists separately,
  // then net of prepayments for purchases ("AP-Prepaid").
  BASE.apTw = BASE.apTrade
    .concat([[LI, CLB, 'Other payable'], [LI, CLB, 'Deposit received']])
    .concat(neg(BASE.prepaid));

  function sumSpec(bs, spec) {
    if (!bs) return null;
    let total = 0;
    for (const [arrName, sectionName, groupName, sign] of spec) {
      const arr = bs[arrName];
      const s = arr && arr.find(x => x.name === sectionName);
      if (!s) continue;
      const gr = s.groups.find(x => x.group === groupName);
      if (gr) total += (sign || 1) * gr.value;
    }
    return total;
  }
  // A period's P&L reads cumulative since the fiscal year start, so its OWN
  // month is that figure minus the same field the month before it — except
  // January, whose YTD already IS just its own month (nothing to subtract).
  function monthlyFlow(key, field) {
    const m = /^\d{4}-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    const pl = plAt(key);
    if (!pl) return null;
    if (+m[1] === 1) return pl[field];
    const prevPl = plAt(shiftMonthKey(key, -1));
    return prevPl ? pl[field] - prevPl[field] : null;
  }
  // n consecutive months' own flow ending at asOfKey, summed from
  // individual monthly flows rather than one file's YTD figure scaled up.
  // Null the moment any one of those months can't be decomposed (not
  // archived, or — for the window's earliest month, when it isn't itself a
  // January — the month right before it isn't archived either).
  function sumFlow(asOfKey, field, n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const f = monthlyFlow(shiftMonthKey(asOfKey, -i), field);
      if (f == null) return null;
      sum += f;
    }
    return sum;
  }
  // Trailing 12 months — the denominator Synnex KPI/SET's real formula uses
  // (revenue/COGS "12 เดือนล่าสุด").
  const ttmFlow = (asOfKey, field) => sumFlow(asOfKey, field, 12);
  // Just the resolved quarter's own 3 months — the denominator Taiwan's
  // real formula uses instead ("Average Revenue Jan-Mar × 12").
  const quarterFlow = (asOfKey, field) => sumFlow(asOfKey, field, 3);
  // Synnex KPI's own averaging: this quarter-end's balance + the SAME
  // month one year ago, ÷2. Needs that year-ago period archived too.
  function thAveraging(key) {
    const yearAgo = shiftMonthKey(key, -12);
    const now = bsAt(key), then = bsAt(yearAgo);
    if (!now || !then) return null;
    const avg2 = spec => (sumSpec(now, spec) + sumSpec(then, spec)) / 2;
    return { ar: avg2(BASE.arTh), inv: avg2(BASE.invNet), ap: avg2(BASE.apTrade) };
  }
  // Taiwan's own averaging (Synnex Thai PAR, sheet "Factor(locked)"): each
  // month contributes its OWN (opening + closing) / 2, and the quarter is
  // the average of those three — so the month before the quarter is part of
  // it too, and Q1 works out to (Dec + 2·Jan + 2·Feb + Mar) / 6 rather than
  // the plain average of three month-ends. Needs 4 consecutive periods.
  function twAveraging(key) {
    const bss = [-3, -2, -1, 0].map(d => bsAt(shiftMonthKey(key, d)));
    if (bss.some(b => !b)) return null;
    const avg = spec => {
      let total = 0;
      for (let i = 1; i < bss.length; i++) total += (sumSpec(bss[i - 1], spec) + sumSpec(bss[i], spec)) / 2;
      return total / (bss.length - 1);
    };
    return { ar: avg(BASE.arTw), inv: avg(BASE.invGross), ap: avg(BASE.apTw), var: avg(BASE.vendorAR) };
  }

  // The single ordered ratio list shared by all 3 tabs — group label, a
  // stable key (used by computeTabMetrics, the trend table and the trend
  // charts), the display label and its unit. Adding/removing a ratio here
  // changes all 3 tabs at once — an optional `only` restricts a row to one
  // tab (used for AR Vendor Days, a genuinely Taiwan-only metric).
  const RATIO_SPEC = [
    { group: 'วงจรเงินสด (Cash Conversion Cycle)', key: 'arDays', label: 'AR Days (DSO)', unit: 'days' },
    // Taiwan-only — the company's own comparison chart shows this cell blank
    // for Synnex KPI/SET (no equivalent metric exists there), so Thailand/
    // SET don't render this row at all.
    { group: 'วงจรเงินสด (Cash Conversion Cycle)', key: 'arVendorDays', label: 'AR Vendor Days', unit: 'days', only: 'tw' },
    { group: 'วงจรเงินสด (Cash Conversion Cycle)', key: 'invDays', label: 'Inventory Days (DIO)', unit: 'days' },
    { group: 'วงจรเงินสด (Cash Conversion Cycle)', key: 'apDays', label: 'AP Days (DPO)', unit: 'days' },
    { group: 'วงจรเงินสด (Cash Conversion Cycle)', key: 'ccc', label: 'Cash Conversion Cycle', unit: 'days' },
    { group: 'สภาพคล่อง (Liquidity)', key: 'currentRatio', label: 'Current Ratio', unit: 'x' },
    { group: 'สภาพคล่อง (Liquidity)', key: 'quickRatio', label: 'Quick Ratio', unit: 'x' },
    { group: 'สภาพคล่อง (Liquidity)', key: 'cashRatio', label: 'Cash Ratio', unit: 'x' },
    { group: 'ความสามารถในการทำกำไร (Profitability)', key: 'grossMargin', label: 'Gross Profit Margin', unit: 'pct' },
    { group: 'ความสามารถในการทำกำไร (Profitability)', key: 'operatingMargin', label: 'Operating Profit Margin', unit: 'pct' },
    { group: 'ความสามารถในการทำกำไร (Profitability)', key: 'netMargin', label: 'Net Profit Margin', unit: 'pct' },
    { group: 'ความสามารถในการทำกำไร (Profitability)', key: 'roa', label: 'ROA', unit: 'pct' },
    { group: 'ความสามารถในการทำกำไร (Profitability)', key: 'roe', label: 'ROE', unit: 'pct' },
    { group: 'ประสิทธิภาพการใช้สินทรัพย์ (Efficiency)', key: 'assetTurnover', label: 'Total Asset Turnover', unit: 'x' },
    { group: 'โครงสร้างเงินทุน (Financial Policy)', key: 'de', label: 'Debt to Equity', unit: 'x' },
    { group: 'โครงสร้างเงินทุน (Financial Policy)', key: 'interestCoverage', label: 'Interest Coverage Ratio', unit: 'x' },
  ];

  function card(rk, value, unit, formula) {
    return `<div class="ratio-card"><div class="rk">${rk}</div><div class="rv">${fmt(value, unit)}</div><div class="rf">${formula}</div></div>`;
  }
  function cycleCard(name, value, formula) {
    return `<div class="ratio-card"><div class="rk">${name}</div><div class="rv">${fmt(value, 'days')}</div>
      <div class="rf">${formula}</div></div>`;
  }
  function cccCard(value, formula) {
    return `<div class="ratio-card" style="border-color:color-mix(in srgb,var(--accent) 40%,var(--glass-brd))"><div class="rk">Cash Conversion Cycle</div><div class="rv" style="color:var(--accent-ink)">${fmt(value, 'days')}</div><div class="rf">${formula}</div></div>`;
  }

  // Renders RATIO_SPEC + a tab's computed metrics into one ratio-grid — the
  // single template all 3 tabs share. containerId doubles as the tab key
  // ('th'/'tw'/'set') so a spec's `only` restriction can be checked here.
  function renderTabCards(containerId, m) {
    let html = '', lastGroup = null;
    for (const spec of RATIO_SPEC) {
      if (spec.only && spec.only !== containerId) continue;
      if (spec.group !== lastGroup) { html += `<div class="rgroup-lbl">${esc(spec.group)}</div>`; lastGroup = spec.group; }
      const e = m[spec.key] || {};
      html += spec.key === 'ccc' ? cccCard(e.value, e.formula)
        : spec.unit === 'days' ? cycleCard(spec.label, e.value, e.formula)
        : card(spec.label, e.value, spec.unit, e.formula);
    }
    $(containerId).innerHTML = html;
  }

  // The one formula engine behind every card on every tab (and every point
  // in the trend charts below — same function, just called once per saved
  // period). `prevBs` is whatever this tab averages against: for the LIVE
  // point that's the imported file's own opening-balance column; for a
  // trend point that's the previous point in the series' closing balance.
  // `ctx` carries the small number of tab-specific inputs that a real,
  // sourced formula genuinely needs (SET's annualizeFactor, the shared
  // periodMonths) — nothing invented just for symmetry.
  function computeTabMetrics(tab, mbs, mpl, prevBs, ctx) {
    ctx = ctx || {};
    const secTot = (arr, name) => { const s = arr.find(x => x.name === name); return s ? s.total : 0; };
    const groupIn = (arr, name, grp) => { const s = arr.find(x => x.name === name); if (!s) return 0; const gr = s.groups.find(x => x.group === grp); return gr ? gr.value : 0; };

    const CA = secTot(mbs.assets, 'Current Assets'), CL = secTot(mbs.liab, 'Current Liabilities');
    // Inventory nets the obsolescence allowance off, matching the published
    // สินค้าคงเหลือ line — Current Assets already carries that allowance, so
    // the quick ratio below has to subtract the net figure, not the gross.
    const inventory = sumSpec(mbs, BASE.invNet);
    const equity = mbs.totalEquity + mbs.netProfit, debt = mbs.totalLiab;
    const arNetCur = sumSpec(mbs, BASE.arNetCur);
    const tradeAP = sumSpec(mbs, BASE.apTrade);
    const otherReceivable = sumSpec(mbs, BASE.otherRecv);
    const cashEquiv = groupIn(mbs.assets, 'Current Assets', 'Cash in Hand')
      + groupIn(mbs.assets, 'Current Assets', 'Cash at Bank - current account')
      + groupIn(mbs.assets, 'Current Assets', 'Cash at Bank - saving accounts')
      + groupIn(mbs.assets, 'Current Assets', 'Short-term investments');
    const prepayment = groupIn(mbs.assets, 'Current Assets', 'Prepayment');
    const interestExpense = -mpl.finance;
    const ebit = mpl.revenue + mpl.cogs + mpl.opEx + mpl.otherIE + mpl.share;

    const avgOf = (curV, prevV) => prevV != null ? (curV + prevV) / 2 : curV;
    const avgSpec = spec => avgOf(sumSpec(mbs, spec), prevBs ? sumSpec(prevBs, spec) : null);
    const avgAssets = avgOf(mbs.totalAssets, prevBs ? prevBs.totalAssets : null);
    const avgEquity = avgOf(equity, prevBs ? (prevBs.totalEquity + prevBs.netProfit) : null);

    const currentRatio = CL ? CA / CL : null;
    const cashRatio = CL ? cashEquiv / CL : null;
    const grossMargin = mpl.revenue ? 100 * mpl.grossProfit / mpl.revenue : null;
    const operatingMargin = mpl.revenue ? 100 * (mpl.grossProfit + mpl.opEx) / mpl.revenue : null;
    const netMargin = mpl.revenue ? 100 * mpl.netProfit / mpl.revenue : null;
    const interestCoverage = interestExpense > 0.5 ? ebit / interestExpense : null;
    const de = equity ? debt / equity : null;

    if (tab === 'th') {
      const months = ctx.periodMonths || 3;
      // "Synnex KPI" (the company's own cash-cycle comparison chart): the
      // REAL formula divides average AR/Inventory/AP (this quarter-end +
      // the same month a year ago, ÷2) by revenue/COGS over a genuine
      // trailing 12 months — both need several months of saved periods to
      // compute exactly (ctx.thAvg, ctx.ttm from render()); short of that,
      // this falls back to ending balance ÷ this file's own YTD flow
      // scaled up by month count, same as before either existed.
      const cogsAbs = Math.abs(mpl.cogs);
      const hasTTM = ctx.ttm && ctx.ttm.revenue != null && ctx.ttm.cogs != null;
      const revenueBasis = hasTTM ? ctx.ttm.revenue : mpl.revenue;
      const cogsBasis = hasTTM ? Math.abs(ctx.ttm.cogs) : cogsAbs;
      const days = hasTTM ? 365 : 365 * months / 12;
      const thAvg = ctx.thAvg;
      // AR here is the published ลูกหนี้การค้า INCLUDING its non-current
      // portion — the comparison chart's own "AR Mar 26" reads that way,
      // and the SET column beside it reads the current portion only.
      const arBase = thAvg ? thAvg.ar : sumSpec(mbs, BASE.arTh),
        invBase = thAvg ? thAvg.inv : inventory, apBase = thAvg ? thAvg.ap : tradeAP;
      const arDays = revenueBasis ? arBase / revenueBasis * days : null;
      const invDays = cogsBasis ? invBase / cogsBasis * days : null;
      const apDays = cogsBasis ? apBase / cogsBasis * days : null;
      const missing = [];
      if (!hasTTM) missing.push(`รายได้/ต้นทุนขาย 12 เดือนล่าสุดจริง (ใช้ยอดสะสม ${months} เดือนของงบ ${ctx.periodLabel || ''} × ${(12 / months).toFixed(2)} แทน)`);
      if (!thAvg) missing.push('งวดเดียวกันปีก่อนสำหรับหาค่าเฉลี่ย (ใช้ยอดปลายงวดแทน)');
      const note = missing.length
        ? `⚠ ยังไม่ตรงสูตร Synnex KPI 100% เพราะยังไม่มี: ${missing.join(' และ ')}`
        : '✓ ตรงกับสูตร Synnex KPI จริง (เฉลี่ยเทียบงวดเดียวกันปีก่อน ÷ รายได้/ต้นทุนขาย 12 เดือนล่าสุดจริง)';
      const arF = `${thAvg ? 'ลูกหนี้การค้าเฉลี่ย' : 'ลูกหนี้การค้า'} ${M(arBase)} ÷ รายได้ × ${days.toFixed(2)} วัน (${note})`;
      const invF = `${thAvg ? 'สินค้าคงเหลือเฉลี่ย' : 'สินค้าคงเหลือ'} ${M(invBase)} ÷ ต้นทุนขาย × ${days.toFixed(2)} วัน (${note})`;
      const apF = `${thAvg ? 'เจ้าหนี้การค้าเฉลี่ย' : 'เจ้าหนี้การค้า'} ${M(apBase)} ÷ ต้นทุนขาย × ${days.toFixed(2)} วัน (${note})`;
      return {
        arDays: { value: arDays, formula: arF, base: arBase },
        invDays: { value: invDays, formula: invF, base: invBase },
        apDays: { value: apDays, formula: apF, base: apBase },
        ccc: { value: (arDays != null && invDays != null && apDays != null) ? arDays + invDays - apDays : null, formula: 'AR Days + Inventory Days − AP Days' },
        currentRatio: { value: currentRatio, formula: 'สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน ✓ ตรงกับสูตร Conso จริง' },
        quickRatio: { value: CL ? (CA - inventory) / CL : null, formula: '(สินทรัพย์หมุนเวียน − สินค้าคงเหลือ) ÷ หนี้สินหมุนเวียน ✓ ตรงกับสูตร Conso จริง' },
        cashRatio: { value: cashRatio, formula: `เงินสด + เงินฝากธนาคาร ${M(cashEquiv)} ÷ หนี้สินหมุนเวียน — ยังไม่พบสูตร Conso เฉพาะ` },
        grossMargin: { value: grossMargin, formula: 'กำไรขั้นต้น ÷ รายได้ — ยังไม่พบสูตร Conso เฉพาะ' },
        operatingMargin: { value: operatingMargin, formula: 'กำไรจากการดำเนินงาน ÷ รายได้ — ยังไม่พบสูตร Conso เฉพาะ' },
        netMargin: { value: netMargin, formula: 'กำไรสุทธิ ÷ รายได้ — ยังไม่พบสูตร Conso เฉพาะ' },
        roa: { value: mbs.totalAssets ? 100 * mbs.netProfit / mbs.totalAssets : null, formula: 'กำไรสุทธิ ÷ สินทรัพย์รวม (ยอดปลายงวด) ✓ ตรงกับสูตร Conso จริง' },
        roe: { value: equity ? 100 * mbs.netProfit / equity : null, formula: 'กำไรสุทธิ ÷ ส่วนของผู้ถือหุ้น (ยอดปลายงวด) — ยังไม่พบสูตร Conso เฉพาะ' },
        assetTurnover: { value: mbs.totalAssets ? mpl.revenue / mbs.totalAssets : null, formula: 'รายได้ (YTD) ÷ สินทรัพย์รวม (ยอดปลายงวด) — ยังไม่ทำเป็นรายปี, ยังไม่พบสูตร Conso เฉพาะ' },
        de: { value: de, formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น ✓ ตรงกับสูตร Conso จริง' },
        interestCoverage: { value: interestCoverage, formula: `EBIT ${M(ebit)} ÷ ดอกเบี้ยจ่าย ${M(interestExpense)} ✓ ตรงกับสูตร Conso จริง` },
      };
    }

    if (tab === 'tw') {
      const months = ctx.periodMonths || 3;
      // Taiwan's own real basis is narrower than Synnex KPI/SET's trailing
      // 12 months: "Average Revenue Jan-Mar × 12" — the CURRENT quarter's
      // own 3 months, averaged then annualised, not the YTD-since-fiscal-
      // year flow scaled up (those only agree at Q1, where YTD IS the
      // quarter). ctx.twFlow carries that quarter's own decomposed 3-month
      // revenue/COGS from render(); short of it, this still falls back to
      // the old YTD×(12/months) approximation, which is the same figure at
      // Q1 and only drifts from the real one at Q2-Q4 if the business is
      // seasonal enough that no one quarter looks like the year average.
      const cogsAbs = Math.abs(mpl.cogs);
      const hasTwFlow = ctx.twFlow && ctx.twFlow.revenue != null && ctx.twFlow.cogs != null;
      const annualRevenue = hasTwFlow ? ctx.twFlow.revenue * 4 : mpl.revenue * (12 / months);
      const annualCogs = hasTwFlow ? Math.abs(ctx.twFlow.cogs) * 4 : cogsAbs * (12 / months);
      const twAvg = ctx.twAvg;
      // Taiwan reads AR and inventory GROSS (before the credit-loss and
      // obsolescence allowances the published statements net off) and
      // payables net of prepayments for purchases — its "AP-Prepaid" line.
      const arBase = twAvg ? twAvg.ar : avgSpec(BASE.arTw),
        invBase = twAvg ? twAvg.inv : avgSpec(BASE.invGross),
        apBase = twAvg ? twAvg.ap : avgSpec(BASE.apTw);
      const arDays = annualRevenue ? arBase / annualRevenue * 365 : null;
      const invDays = annualCogs ? invBase / annualCogs * 365 : null;
      const apDays = annualCogs ? apBase / annualCogs * 365 : null;
      // AR Vendor Days (vendor rebate receivable, "VAR") — real, Taiwan-only
      // metric per the company's own comparison chart (blank for Synnex
      // KPI/SET) — folds into Taiwan's own Cash Conversion Cycle total too,
      // same as the Capital Turn calc under NROIC below.
      const varBase = twAvg && twAvg.var != null ? twAvg.var : avgSpec(BASE.vendorAR);
      const arVendorDays = annualRevenue ? varBase / annualRevenue * 365 : null;
      const ccc = [arDays, invDays, apDays, arVendorDays].every(v => v != null) ? arDays + invDays - apDays + arVendorDays : null;
      const avgNote = ctx.avgNote || '';
      const missing = [];
      if (!hasTwFlow) missing.push('รายได้/ต้นทุนขาย 3 เดือนของไตรมาสนี้แยกจากยอดสะสม (ใช้ยอดสะสมทั้งปี÷เดือนแทน)');
      if (!twAvg) missing.push('งวดก่อนไตรมาสนี้ 1 เดือน (สูตรไต้หวันเฉลี่ยต้นเดือน+ปลายเดือนของทั้ง 3 เดือน จึงต้องมีเดือนก่อนหน้าด้วย)');
      const pNote = missing.length
        ? `⚠ ยังไม่ตรงสูตร PAR/NROIC 100% เพราะยังไม่มี: ${missing.join(' และ ')}`
        : `✓ ตรงกับสูตร PAR/NROIC จริง (เฉลี่ยต้นเดือน+ปลายเดือน ทั้ง 3 เดือนในไตรมาส ${ctx.periodLabel || ''})`;
      return {
        arDays: { base: arBase, value: arDays, formula: `ลูกหนี้การค้าเฉลี่ย (ก่อนหักค่าเผื่อฯ) ${M(arBase)} ÷ รายได้ (รายปี) × 365 วัน (${pNote})` },
        arVendorDays: { base: varBase, value: arVendorDays, formula: `ลูกหนี้เคลม vendor เฉลี่ย ${M(varBase)} ÷ รายได้ (รายปี) × 365 วัน (${pNote})` },
        invDays: { base: invBase, value: invDays, formula: `สินค้าคงเหลือเฉลี่ย (ก่อนหักค่าเผื่อฯ) ${M(invBase)} ÷ ต้นทุนขาย (รายปี) × 365 วัน (${pNote})` },
        apDays: { base: apBase, value: apDays, formula: `(เจ้าหนี้การค้า + เจ้าหนี้หมุนเวียนอื่น − สำรอง vendor − เงินจ่ายล่วงหน้าค่าสินค้า) เฉลี่ย ${M(apBase)} ÷ ต้นทุนขาย (รายปี) × 365 วัน (${pNote})` },
        ccc: { value: ccc, formula: 'AR Days + AR Vendor Days + Inventory Days − AP Days (เฉลี่ยต้นเดือน+ปลายเดือน แทนยอดปลายงวดล้วน)' },
        currentRatio: { value: currentRatio, formula: 'สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน (เหมือนวิธีบริษัท — ชีท KPI ใช้สูตรเดียวกัน)' },
        quickRatio: { value: CL ? (CA - inventory - prepayment) / CL : null, formula: `(สินทรัพย์หมุนเวียน − สินค้าคงเหลือ − เงินจ่ายล่วงหน้า ${M(prepayment)}) ÷ หนี้สินหมุนเวียน ✓ สูตรจริงจากชีท KPI` },
        cashRatio: { value: cashRatio, formula: `เงินสด + เงินฝากธนาคาร ${M(cashEquiv)} ÷ หนี้สินหมุนเวียน (เหมือนวิธีบริษัท)` },
        grossMargin: { value: grossMargin, formula: 'กำไรขั้นต้น ÷ รายได้ (เหมือนวิธีบริษัท — ชีท KPI ใช้สูตรเดียวกัน)' },
        operatingMargin: { value: operatingMargin, formula: 'กำไรจากการดำเนินงาน ÷ รายได้ (เหมือนวิธีบริษัท — ชีท KPI ใช้สูตรเดียวกัน)' },
        netMargin: { value: netMargin, formula: 'กำไรสุทธิ ÷ รายได้ — ยังไม่พบสูตรไต้หวันแยกในไฟล์' },
        roa: { value: mbs.totalAssets ? 100 * mbs.netProfit / mbs.totalAssets : null, formula: 'กำไรสุทธิ ÷ สินทรัพย์รวม (ยอดปลายงวด) — ยังไม่พบสูตรไต้หวันแยกในไฟล์' },
        roe: { value: avgEquity ? 100 * mbs.netProfit / avgEquity : null, formula: `กำไรสุทธิ ÷ ส่วนของผู้ถือหุ้นเฉลี่ย ${M(avgEquity)} ✓ สูตรจริงจากชีท NROIC — ${avgNote}` },
        assetTurnover: { value: mbs.totalAssets ? mpl.revenue / mbs.totalAssets : null, formula: 'รายได้ (YTD) ÷ สินทรัพย์รวม (ยอดปลายงวด) — ยังไม่พบสูตรไต้หวันแยกในไฟล์' },
        de: { value: de, formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น — ยังไม่พบสูตรไต้หวันแยกในไฟล์' },
        interestCoverage: { value: interestCoverage, formula: `EBIT ${M(ebit)} ÷ ดอกเบี้ยจ่าย ${M(interestExpense)} — ยังไม่พบสูตรไต้หวันแยกในไฟล์` },
      };
    }

    // set — real formula: ENDING balance (no averaging; AR includes Other
    // Receivable) ÷ revenue/COGS over the trailing 12 months. Same as
    // Thailand above, the selected quarter supplies the months of flow the
    // imported P&L carries, so the ×365 becomes ×(365 × months/12).
    const annualizeFactor = ctx.annualizeFactor || 1;
    const ytdNote = ctx.ytdNote || '';
    const avgNote = ctx.avgNote || '';
    const monthsSet = ctx.periodMonths || 3;
    const cogsAbsSet = Math.abs(mpl.cogs);
    const hasTTMSet = ctx.ttm && ctx.ttm.revenue != null && ctx.ttm.cogs != null;
    const revenueBasisSet = hasTTMSet ? ctx.ttm.revenue : mpl.revenue;
    const cogsBasisSet = hasTTMSet ? Math.abs(ctx.ttm.cogs) : cogsAbsSet;
    const daysSet = hasTTMSet ? 365 : 365 * monthsSet / 12;
    // AR pairs the published ลูกหนี้การค้า (current portion, net) with
    // ลูกหนี้หมุนเวียนอื่น; AP pairs เจ้าหนี้การค้า with เจ้าหนี้หมุนเวียนอื่น
    // and ค่าใช้จ่ายค้างจ่าย, the mirror of it on the other side.
    const arSet = arNetCur + otherReceivable;
    const apSet = sumSpec(mbs, BASE.apSet);
    const arDays = revenueBasisSet ? arSet / revenueBasisSet * daysSet : null;
    const invDays = cogsBasisSet ? inventory / cogsBasisSet * daysSet : null;
    const apDays = cogsBasisSet ? apSet / cogsBasisSet * daysSet : null;
    const noteSet = hasTTMSet
      ? `(ยอดปลายงวด ÷ รายได้/ต้นทุนขาย 12 เดือนล่าสุดจริง ✓ ตรงกับสูตร SET จริง)`
      : `(ยอดปลายงวด, งบ ${ctx.periodLabel || ''} = ${monthsSet} เดือนสะสม × ${(12 / monthsSet).toFixed(2)} — ⚠ ยังไม่มีงวดย้อนหลังครบ 12 เดือนจริง ใช้ยอดสะสมสเกลแทน)`;
    const arF = `ลูกหนี้การค้า + ลูกหนี้หมุนเวียนอื่น ${M(arSet)} ÷ รายได้ × ${daysSet.toFixed(2)} วัน ${noteSet}`;
    const invF = `สินค้าคงเหลือ ${M(inventory)} ÷ ต้นทุนขาย × ${daysSet.toFixed(2)} วัน ${noteSet}`;
    const apF = `เจ้าหนี้การค้า + เจ้าหนี้หมุนเวียนอื่น + ค่าใช้จ่ายค้างจ่าย ${M(apSet)} ÷ ต้นทุนขาย × ${daysSet.toFixed(2)} วัน ${noteSet}`;
    return {
      arDays: { value: arDays, formula: arF, base: arSet },
      invDays: { value: invDays, formula: invF, base: inventory },
      apDays: { value: apDays, formula: apF, base: apSet },
      ccc: { value: (arDays != null && invDays != null && apDays != null) ? arDays + invDays - apDays : null, formula: 'AR Days + Inventory Days − AP Days' },
      currentRatio: { value: currentRatio, formula: 'สินทรัพย์หมุนเวียน ÷ หนี้สินหมุนเวียน (เหมือนวิธีบริษัท)' },
      quickRatio: { value: CL ? (CA - inventory) / CL : null, formula: '(สินทรัพย์หมุนเวียน − สินค้าคงเหลือ) ÷ หนี้สินหมุนเวียน (เหมือนวิธีบริษัท)' },
      cashRatio: { value: cashRatio, formula: `เงินสด + เงินฝากธนาคาร ÷ หนี้สินหมุนเวียน (เหมือนวิธีบริษัท)` },
      grossMargin: { value: grossMargin, formula: 'กำไรขั้นต้น ÷ รายได้ (เหมือนวิธีบริษัท)' },
      operatingMargin: { value: operatingMargin, formula: 'กำไรจากการดำเนินงาน ÷ รายได้ (เหมือนวิธีบริษัท)' },
      netMargin: { value: netMargin, formula: 'กำไรสุทธิ ÷ รายได้ (เหมือนวิธีบริษัท)' },
      roa: { value: avgAssets ? 100 * ebit * annualizeFactor / avgAssets : null, formula: `EBIT${ytdNote} ÷ สินทรัพย์รวมเฉลี่ย ${M(avgAssets)} ✓ สูตรจริงจาก SET — ${avgNote}` },
      roe: { value: avgEquity ? 100 * mbs.netProfit * annualizeFactor / avgEquity : null, formula: `กำไรสุทธิ${ytdNote} ÷ ส่วนของผู้ถือหุ้นเฉลี่ย ${M(avgEquity)} ✓ สูตรจริงจาก SET — ${avgNote}` },
      assetTurnover: { value: avgAssets ? mpl.revenue * annualizeFactor / avgAssets : null, formula: `รายได้${ytdNote} ÷ สินทรัพย์รวมเฉลี่ย ${M(avgAssets)} ✓ สูตรจริงจาก SET — ${avgNote}` },
      de: { value: de, formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น (เหมือนวิธีบริษัท)' },
      interestCoverage: { value: interestCoverage, formula: `EBIT ${M(ebit)} ÷ ดอกเบี้ยจ่าย ${M(interestExpense)} (เหมือนวิธีบริษัท)` },
    };
  }

  // Quarterly trend charts (Chart.js, already vendored for Cost Center) —
  // one registry keyed by canvas id so re-render() destroys/recreates
  // instead of stacking new chart instances on the same canvas.
  const charts = {};
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* Print each value on its own mark, the way the company's own cash-cycle
     sheet does — these panels double as the table, so a reader shouldn't have
     to hover to read a number. Skipped once the series is long enough that
     the labels would collide. Chart.js ships no datalabels plugin, so this is
     an inline one; text stays in ink tokens, never the series colour. */
  const valueLabels = {
    id: 'cycleValueLabels',
    afterDatasetsDraw(chart, _a, opts) {
      // Past this many columns even the short day labels collide; the
      // per-mark width check below drops the longer money labels sooner.
      if (chart.data.labels.length > 13) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '600 10px ' + cssVar('--sans');
      ctx.textAlign = 'center';
      chart.data.datasets.forEach((ds, di) => {
        if (ds.noLabels) return;
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const v = ds.data[i];
          if (v == null) return;
          const txt = ds.fmt ? ds.fmt(v) : Math.round(v).toLocaleString('en-US');
          if (ds.type === 'line') {
            // Haloed, because the line crosses the bars it is plotted over
            // and its label would otherwise land on top of a bar's own.
            ctx.textBaseline = 'bottom';
            ctx.lineWidth = 3.5;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = opts.halo;
            ctx.strokeText(txt, el.x, el.y - 7);
            ctx.fillStyle = opts.ink;
            ctx.fillText(txt, el.x, el.y - 7);
          } else {
            // Near the base, inside the bar. The line tracks the top of the
            // plot, so anchoring bar labels low keeps the two sets apart —
            // and it is where the company's own sheet puts them. Skipped
            // when the bar is too small to hold the text either way; the
            // value is still in the tooltip and the table under the charts.
            if (Math.abs(el.base - el.y) < 26) return;
            if (ctx.measureText(txt).width > el.width - 3) return;
            ctx.fillStyle = '#fff';
            ctx.textBaseline = 'bottom';
            ctx.fillText(txt, el.x, el.base - 6);
          }
        });
      });
      ctx.restore();
    },
  };

  /* One combo panel: bars for the amount, a line for the ratio it produces,
     and an optional dashed target. `moneyBars` puts the bars on their own
     millions axis opposite the days axis — the layout the company reads every
     month. Two scales invite a false "the lines crossed" reading, so the two
     axes are titled with their unit and tinted to match the marks they carry.
     The cash-cycle panel passes moneyBars:false and everything shares one
     days axis, which needs no such care. */
  function drawCycleChart(canvasId, cfg) {
    const el = $(canvasId);
    if (!el) return;
    if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }
    if (!cfg.labels.length) return;
    const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), faint = cssVar('--faint');
    const daysAxis = cfg.moneyBars ? 'y1' : 'y';
    const datasets = cfg.bars.map(b => ({
      type: 'bar', label: b.label, data: b.data, backgroundColor: b.color,
      yAxisID: cfg.moneyBars ? 'y' : 'y', borderRadius: 4, borderSkipped: 'bottom',
      // A lone bar is wide enough to carry its own value label; grouped bars
      // are not, and the label plugin drops theirs rather than overflow.
      categoryPercentage: .74, barPercentage: cfg.bars.length > 1 ? .92 : .8,
      fmt: cfg.moneyBars ? (v => Math.round(v / 1e6).toLocaleString('en-US')) : (v => v.toFixed(0)),
    }));
    datasets.push({
      type: 'line', label: cfg.line.label, data: cfg.line.data, yAxisID: daysAxis,
      borderColor: muted, backgroundColor: muted, borderWidth: 2,
      pointRadius: 4, pointHoverRadius: 7, tension: .25,
      fmt: v => v.toFixed(0),
    });
    if (cfg.target != null && isFinite(cfg.target)) {
      datasets.push({
        type: 'line', label: `เป้าหมาย ${cfg.target}`, data: cfg.labels.map(() => cfg.target),
        yAxisID: daysAxis, borderColor: cssVar('--warn'), borderWidth: 1.5, borderDash: [5, 4],
        pointRadius: 0, pointHoverRadius: 0, noLabels: true,
      });
    }
    const moneyScale = {
      type: 'linear', position: 'left', beginAtZero: true,
      title: { display: true, text: 'ล้านบาท', color: muted, font: { size: 10 } },
      ticks: { color: muted, font: { size: 10 }, callback: v => (v / 1e6).toLocaleString('en-US') },
      grid: { color: line },
    };
    const daysScale = {
      type: 'linear', position: cfg.moneyBars ? 'right' : 'left', beginAtZero: true,
      title: { display: true, text: 'วัน', color: muted, font: { size: 10 } },
      ticks: { color: muted, font: { size: 10 } },
      grid: cfg.moneyBars ? { drawOnChartArea: false } : { color: line },
    };
    charts[canvasId] = new Chart(el.getContext('2d'), {
      data: { labels: cfg.labels, datasets },
      plugins: [valueLabels],
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 34 } },      // room for the labels above the line's top point
        plugins: {
          cycleValueLabels: { ink, halo: cssVar('--chart-halo') },
          title: { display: true, text: cfg.title, color: ink, font: { size: 12.5, weight: '600' } },
          // Right-aligned: centred, it sits exactly where the line's peak
          // label lands on a 12-column series.
          subtitle: { display: !!cfg.hint, text: cfg.hint || '', color: faint, font: { size: 10 }, align: 'end', padding: { bottom: 2 } },
          legend: { display: true, position: 'bottom', labels: { color: muted, boxWidth: 11, boxHeight: 11, font: { size: 10.5 }, usePointStyle: false } },
          tooltip: {
            callbacks: {
              label: c => c.raw == null ? `${c.dataset.label}: —`
                : `${c.dataset.label}: ` + (c.dataset.yAxisID === daysAxis
                  ? c.raw.toFixed(1) + ' วัน'
                  : Math.round(c.raw).toLocaleString('en-US') + ' บาท'),
            },
          },
        },
        scales: cfg.moneyBars
          ? { x: { ticks: { color: muted, font: { size: 10.5 } }, grid: { display: false } }, y: moneyScale, y1: daysScale }
          : { x: { ticks: { color: muted, font: { size: 10.5 } }, grid: { display: false } }, y: daysScale },
      },
    });
  }

  function destroyAllCharts() {
    for (const id of Object.keys(charts)) { charts[id].destroy(); delete charts[id]; }
  }

  function buildTrendTable(perPointMetrics, tabKey) {
    const rows = [];
    let lastGroup = null;
    for (const spec of RATIO_SPEC) {
      if (spec.only && spec.only !== tabKey) continue;
      if (spec.group !== lastGroup) { rows.push({ header: spec.group }); lastGroup = spec.group; }
      rows.push({ label: spec.label, unit: spec.unit, values: perPointMetrics.map(m => (m[tabKey][spec.key] || {}).value) });
    }
    return rows;
  }

  function renderTrendTable(tblId, labels, rows) {
    // The ratio name column is pinned: with a dozen period columns the table
    // scrolls sideways, and a row of numbers with its label off-screen is
    // unreadable. Latest period first so the eye starts where it matters.
    $(tblId).innerHTML = `<thead><tr><th class="pin">อัตราส่วน</th>${labels.map(l => `<th class="r nw">${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => r.header
        ? `<tr><td class="pin" colspan="${labels.length + 1}" style="padding-top:12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:700">${esc(r.header)}</td></tr>`
        : `<tr><td class="pin nw">${esc(r.label)}</td>${r.values.map(v => `<td class="r nw">${fmt(v, r.unit)}</td>`).join('')}</tr>`
      ).join('')}</tbody>`;
  }

  function render() {
    const saved = Store.listPeriods().slice().sort((a, b) => a.key < b.key ? -1 : 1);
    const q = resolveQuarter(saved);

    // Live TB — still what "ปัจจุบัน" means in the trend series further
    // down, and (only once nothing has ever been archived) still what the
    // top cards themselves read from too. See resolveQuarter above for why
    // the two aren't always the same source anymore.
    const liveG = FS.grouped();
    const liveBs = liveG ? FS.buildBS(liveG) : null, livePl = liveG ? FS.buildPL(liveG) : null;

    const openingBSOf = key => {
      const rows = Store.openingRows(key);
      const g2 = rows ? FS.grouped(rows) : null;
      return g2 ? FS.buildBS(g2) : null;
    };
    const avgNoteFor = openingBS => openingBS
      ? `ยอดเฉลี่ยต้นงวด+ปลายงวด (ยอดยกมาจากไฟล์ที่นำเข้า: ${M(openingBS.totalAssets)})`
      : '⚠ ไฟล์ที่นำเข้าไม่มีคอลัมน์ยอดยกมา (Opening balance) ใช้ยอดปลายงวดแทนค่าเฉลี่ย';

    let cards = null;
    if (q.archived) {
      if (q.period) {
        const prows = Store.finalRows(q.key);
        const pg = prows && prows.length ? FS.grouped(prows) : null;
        if (pg) {
          const openingBS = openingBSOf(q.key);
          const periodMonths = monthsFromKey(q.key) || periodOpt().months;
          const ttmRevenue = ttmFlow(q.key, 'revenue'), ttmCogs = ttmFlow(q.key, 'cogs');
          const qRevenue = quarterFlow(q.key, 'revenue'), qCogs = quarterFlow(q.key, 'cogs');
          cards = {
            bs: FS.buildBS(pg), pl: FS.buildPL(pg), openingBS, avgNote: avgNoteFor(openingBS),
            periodMonths, periodLabel: `${periodOpt().label} · ${q.period.label}`,
            ttm: (ttmRevenue != null && ttmCogs != null) ? { revenue: ttmRevenue, cogs: ttmCogs } : null,
            twFlow: (qRevenue != null && qCogs != null) ? { revenue: qRevenue, cogs: qCogs } : null,
            thAvg: thAveraging(q.key), twAvg: twAveraging(q.key),
          };
        }
      }
    } else if (liveG) {
      const openingBS = openingBSOf();
      cards = { bs: liveBs, pl: livePl, openingBS, avgNote: avgNoteFor(openingBS), periodMonths: periodOpt().months, periodLabel: periodOpt().label };
    }
    const trendDefaultMonths = cards ? cards.periodMonths : periodOpt().months;

    renderPeriodSeg();

    if (!cards) {
      const msg = q.archived
        ? `<div class="t">ยังไม่ได้บันทึกงวดสิ้น ${esc(periodOpt().label)} ของปี ${esc(q.year)}</div><div class="d">งวดที่ต้องมี: <b>${esc(q.key)}</b> — ไปนำเข้าและกด "บันทึกงวดนี้" ที่หน้า <a class="linkish" href="import.html">Import</a></div>`
        : `<div class="t">ยังไม่ได้นำเข้างบทดลอง</div><div class="d">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div>`;
      $('th').innerHTML = $('tw').innerHTML = $('set').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div>${msg}</div></div>`;
      $('banner').innerHTML = '';
      if (!saved.length && !liveG) {
        ['Th', 'Tw', 'Set'].forEach(suffix => { $(`trendEmpty${suffix}`).style.display = ''; $(`trendBody${suffix}`).style.display = 'none'; });
        destroyAllCharts();
        return;
      }
      // Falls through — the trend section below can still have something to
      // show (other saved periods and/or the live TB) even though THIS
      // quarter's own cards don't.
    } else {
      const { bs, pl, openingBS, avgNote, periodMonths, periodLabel, ttm, twFlow, thAvg, twAvg } = cards;
      const annualizeFactor = 12 / periodMonths;
      const ytdNote = annualizeFactor > 1 ? ` × annualize ${annualizeFactor.toFixed(2)} (${periodMonths} เดือน→12)` : '';

      renderTabCards('th', computeTabMetrics('th', bs, pl, null, { periodMonths, periodLabel, ttm, thAvg }));
      renderTabCards('tw', computeTabMetrics('tw', bs, pl, openingBS, { periodMonths, periodLabel, avgNote, twFlow, twAvg }));
      renderTabCards('set', computeTabMetrics('set', bs, pl, openingBS, { annualizeFactor, ytdNote, avgNote, periodMonths, periodLabel, ttm }));
      $('banner').innerHTML = `<div class="check ok" style="margin-bottom:14px"><div class="ico">✓</div><div><div class="t">${q.archived ? `คำนวณจากงวดที่บันทึกไว้ <b>${esc(q.period.label)}</b>` : 'คำนวณจากงบที่โรลอัปสด'}</div>
        <div class="d">DSCR และ LT Debt/EBITDA ต้องใช้ตารางกระแสเงินสด/เงินกู้ — ดูหน้า <a class="linkish" href="cashflow.html">Cash Flow</a></div></div></div>`;
    }

    // ---- Quarterly trend ("แนวโน้มรายไตรมาส") on all 3 tabs — recomputes
    // every ratio above once per period saved via Import's "งวดที่บันทึกไว้"
    // (oldest→newest) plus the live period, mirroring the company's own
    // "xCash Cycle (Conso)" tracking sheet. Averaging pieces chain off the
    // PREVIOUS point in this series' closing balance — a different average
    // than the live cards' own opening-balance-column average above, which
    // is about one file, not a series; the first point has no predecessor
    // so falls back to its own ending balance.
    //
    // Each point uses that period's own FINAL rows (combining + its own
    // journals), not just the raw combine — a workbook dropped straight
    // into an archived period is read the same way the live close is (see
    // import.js), so a period with its own Eliminate/AJE sheets gets the
    // real consolidated figure here instead of a pre-elimination one. A
    // period saved before that (or via the plain "archive this period"
    // button, with no journals of its own) still works: finalRows() falls
    // back to the combine untouched when there's nothing to net against it.
    //
    // Each point also gets its OWN month count instead of the shared Q1–Q4
    // toggle. A saved period's own rows are a year-to-date snapshot exactly
    // like the live TB is, so applying one month count to the whole series
    // scales every point except the one the toggle happens to match — a
    // January point read as if it were 9 months of flow comes out roughly
    // 9× too high. Import's own period key convention is "YYYY-MM" (see
    // the "รหัสงวด เช่น 2026-06" placeholder on that page), so the month
    // is right there in the key; a key that doesn't parse that way (a
    // custom label, from before that convention) falls back to the shared
    // toggle, same as before this existed.
    const trendList = [];
    for (const p of saved) {
      const prows = Store.finalRows(p.key);
      const pg = prows && prows.length ? FS.grouped(prows) : null;
      if (!pg) continue;
      const pMonths = monthsFromKey(p.key);
      trendList.push({ label: p.label, bs: FS.buildBS(pg), pl: FS.buildPL(pg), months: pMonths, monthsGuessed: pMonths == null });
    }
    // "ปัจจุบัน" is always the live TB specifically (not whichever period the
    // top cards above resolved to) — omitted outright when there's no live
    // TB at all, rather than duplicating one of the saved points under a
    // confusing second label.
    if (liveG) trendList.push({ label: 'ปัจจุบัน', bs: liveBs, pl: livePl, months: periodOpt().months, monthsGuessed: false });
    const trendLabels = trendList.map(p => p.label);
    const perPoint = trendList.map((pt, i) => {
      const prevBs = i > 0 ? trendList[i - 1].bs : null;
      const pm = pt.months || trendDefaultMonths;
      const pf = 12 / pm;
      return {
        th: computeTabMetrics('th', pt.bs, pt.pl, null, { periodMonths: pm, periodLabel: pt.label }),
        tw: computeTabMetrics('tw', pt.bs, pt.pl, prevBs, { periodMonths: pm, periodLabel: pt.label }),
        set: computeTabMetrics('set', pt.bs, pt.pl, prevBs, { annualizeFactor: pf, periodMonths: pm, periodLabel: pt.label }),
      };
    });

    function renderTrendTab(suffix, tabKey) {
      const hasEnough = trendList.length >= 2;
      $(`trendEmpty${suffix}`).style.display = hasEnough ? 'none' : '';
      $(`trendBody${suffix}`).style.display = hasEnough ? '' : 'none';
      const monthsNote = document.querySelector(`[data-panel="${tabKey}"] [data-trend-months-note]`);
      if (monthsNote) {
        const guessedLabels = trendList.filter(p => p.monthsGuessed && p.label !== 'ปัจจุบัน').map(p => p.label);
        monthsNote.style.display = hasEnough && guessedLabels.length ? '' : 'none';
        if (guessedLabels.length) {
          monthsNote.innerHTML = `⚠ งวด <b>${esc(guessedLabels.join(', '))}</b> ไม่ได้ตั้งรหัสงวดเป็น <code>YYYY-MM</code> (เช่น 2026-06) เดาจำนวนเดือนไม่ได้ จึงใช้ตัวคูณเดียวกับปุ่ม Q1–Q4 ด้านบนแทน — อาจคลาดเคลื่อนถ้างวดนั้นไม่ได้ครอบคลุมพอดีตามที่ปุ่มเลือกไว้`;
        }
      }
      if (!hasEnough) {
        ['ArDays', 'InvDays', 'ApDays', 'Ccc'].forEach(c => { const id = `chart${c}${suffix}`; if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
        $(`trendTbl${suffix}`).innerHTML = '';
        return;
      }
      const table = buildTrendTable(perPoint, tabKey);
      renderTrendTable(`trendTbl${suffix}`, trendLabels, table);

      // Each panel pairs the balance the ratio was computed FROM (bars, in
      // millions) with the ratio itself (line, in days) — `base` travels out
      // of computeTabMetrics for exactly this, so the bar is literally the
      // numerator of the line above it and stays true to each tab's own
      // formula (SET's AR includes other receivable, Taiwan's is averaged).
      const days = key => perPoint.map(m => (m[tabKey][key] || {}).value);
      const bal = key => perPoint.map(m => (m[tabKey][key] || {}).base);
      const t = Store.cycleTargets();
      const sv = [cssVar('--sv1'), cssVar('--sv2'), cssVar('--sv3')];
      const money = (id, title, key, target, hint) => {
        const bars = bal(key);
        const hasBars = bars.some(v => v != null && v !== 0);
        drawCycleChart(`chart${id}${suffix}`, {
          title, hint, labels: trendLabels, moneyBars: hasBars, target,
          bars: hasBars ? [{ label: title.replace(' Days', '') + ' (ล้านบาท)', data: bars, color: sv[0] }] : [],
          line: { label: title, data: days(key) },
        });
      };
      money('ArDays', 'AR Days', 'arDays', t.ar, 'ยิ่งน้อยยิ่งดี');
      money('InvDays', 'Inventory Days', 'invDays', t.inv, 'ยิ่งน้อยยิ่งดี');
      money('ApDays', 'AP Days', 'apDays', t.ap, 'ยิ่งมากยิ่งดี');
      // Cash cycle: every series is already in days, so they share one axis.
      const cccBars = [
        { label: 'AR Days', data: days('arDays'), color: sv[0] },
        { label: 'Inventory Days', data: days('invDays'), color: sv[1] },
        { label: 'AP Days', data: days('apDays'), color: sv[2] },
      ];
      // Taiwan's extra series goes at the END of the bar order, not beside
      // AR where it belongs by meaning: a fourth hue next to the blue fails
      // colour-blind separation, and after the amber it passes outright.
      if (tabKey === 'tw') cccBars.push({ label: 'AR Vendor Days', data: days('arVendorDays'), color: cssVar('--sv4') });
      drawCycleChart(`chartCcc${suffix}`, {
        title: 'Cash Conversion Cycle', hint: 'ยิ่งน้อยยิ่งดี', labels: trendLabels,
        moneyBars: false, target: t.ccc, bars: cccBars,
        line: { label: 'Cash cycle', data: days('ccc') },
      });
    }

    renderTrendTab('Th', 'th');
    renderTrendTab('Tw', 'tw');
    renderTrendTab('Set', 'set');
  }

  /* Paint the Q1..Q4/ทั้งปี toggle on all 3 tabs from the one shared value,
     and write the note under each. Same control, same wording everywhere —
     only the sentence about what it drives differs, because it genuinely
     does: SET's ROA/ROE/Asset Turnover annualize, Thailand's and Taiwan's
     don't (their sourced formulas use the YTD flow against an ending or
     averaged balance without scaling it up). */
  function renderPeriodSeg() {
    const saved = Store.listPeriods();
    const q = resolveQuarter(saved);
    const opt = periodOpt();
    document.querySelectorAll('[data-period-seg]').forEach(seg => {
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === periodSel));
    });
    document.querySelectorAll('[data-period-note]').forEach(el => {
      const tab = el.closest('.tab-panel').dataset.panel;
      if (q.archived) {
        if (!q.period) {
          el.innerHTML = `⚠ ยังไม่ได้บันทึกงวดสิ้น <b>${esc(opt.label)}</b> ของปี ${esc(q.year)} (ต้องมีงวดรหัส <code>${esc(q.key)}</code>) — ไปนำเข้าและกด "บันทึกงวดนี้" ที่หน้า <a class="linkish" href="import.html">Import</a>`;
          return;
        }
        const months = monthsFromKey(q.key) || opt.months, factor = 12 / months;
        const extra = tab === 'set'
          ? (factor > 1
            ? ` และปรับ ROA/ROE/Total Asset Turnover เป็นรายปี <b>×${factor.toFixed(2)}</b>`
            : ' และไม่ต้องปรับ ROA/ROE/Total Asset Turnover เป็นรายปี (เต็มปีแล้ว)')
          : ' (ROA/ROE/Asset Turnover ของแท็บนี้ใช้ยอดสะสมตรงๆ ตามสูตรบริษัท ไม่ปรับเป็นรายปี)';
        el.innerHTML = `ใช้งวดที่บันทึกไว้ <b>${esc(q.period.label)}</b> (รหัสงวด ${esc(q.key)}) เป็นข้อมูลของ <b>${esc(opt.label)}</b> — งบทดลองสะสมกำไรขาดทุนตั้งแต่ต้นปีบัญชี จึงเท่ากับ <b>${months} เดือน</b>${extra}`;
        return;
      }
      const factor = 12 / opt.months;
      const extra = tab === 'set'
        ? (factor > 1
          ? ` และปรับ ROA/ROE/Total Asset Turnover เป็นรายปี <b>×${factor.toFixed(2)}</b>`
          : ' และไม่ต้องปรับ ROA/ROE/Total Asset Turnover เป็นรายปี (เต็มปีแล้ว)')
        : ' (ROA/ROE/Asset Turnover ของแท็บนี้ใช้ยอดสะสมตรงๆ ตามสูตรบริษัท ไม่ปรับเป็นรายปี)';
      const full = opt.months === 12 ? ' คือเต็มปี' : '';
      el.innerHTML = `เลือกงวดที่งบซึ่งนำเข้าครอบคลุม — งบทดลองสะสมกำไรขาดทุนตั้งแต่ต้นปีบัญชี <b>${esc(opt.label)}</b> จึงเท่ากับ <b>${opt.months} เดือน</b>${full} ใช้แปลงยอดคงเหลือเป็นจำนวนวันในวงจรเงินสด${extra} — ค่านี้ใช้ร่วมกันทั้ง 3 แท็บ (ยังไม่มีงวดที่บันทึกไว้ — บันทึกที่ Import เพื่อให้ปุ่มนี้ดึงจากงวดจริงแทน)`;
    });
  }

  /* Cash-cycle targets: one set shared by the three tabs, same as the period
     toggle, and persisted — a KRI is a standing company target, not something
     to retype every visit. Blank clears the line rather than drawing a zero. */
  function renderKriRow() {
    const t = Store.cycleTargets();
    document.querySelectorAll('[data-kri]').forEach(el => { el.value = t[el.dataset.kri] == null ? '' : t[el.dataset.kri]; });
  }
  document.querySelectorAll('[data-kri]').forEach(el => el.onchange = () => {
    const t = Object.assign({}, Store.cycleTargets());
    const v = parseFloat(el.value);
    if (el.value.trim() === '' || !isFinite(v)) delete t[el.dataset.kri]; else t[el.dataset.kri] = v;
    Store.setCycleTargets(t);
    renderKriRow();
    render();
  });

  $('themeBtn').onclick = () => {
    const r = document.documentElement;
    r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    render();                                  // charts read their colours from CSS variables
  };
  document.querySelectorAll('[data-period-seg] button').forEach(b => b.onclick = () => {
    periodSel = b.dataset.q;
    renderPeriodSeg();
    render();
  });
  $('ratioTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('ratioTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === b.dataset.t));
  });
  renderPeriodSeg();
  renderKriRow();
  render();
})();
