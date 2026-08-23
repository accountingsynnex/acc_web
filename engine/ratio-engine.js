/* The ratio engine — every formula behind the Ratios page, and the same
   ones the Excel export writes into its "NFS+Ratio" sheet.

   It lives outside app/ratios.js so those two can't drift: an export that
   recomputed the company's cash-cycle formulas on its own would agree with
   the page only until the next time one of them was corrected. Everything
   here is a pure read of Store + FS + RULEBOOK, so any page that loads the
   store can call it.

   Sourced formulas, per column: Synnex KPI (the company's own cash-cycle
   comparison chart), Taiwan (Synnex Thai PAR, NROIC/KPI sheets), SET (the
   published statements). Each helper returns null rather than an estimate
   when a period it needs isn't archived, so a caller can tell "computed the
   real formula" from "fell back to the approximation". */
(function (global) {
  const M = n => (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'M';

  const monthsFromKey = key => {
    const m = /^\d{4}-(\d{2})$/.exec(String(key || ''));
    const n = m ? +m[1] : NaN;
    return n >= 1 && n <= 12 ? n : null;
  };

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

  // The groups computeTabMetrics reads directly rather than through a spec.
  const CASH_GROUPS = ['Cash in Hand', 'Cash at Bank - current account', 'Cash at Bank - saving accounts', 'Short-term investments'];
  const PREPAY_GROUP = 'Prepayment';

  /* Every group this page looks up by name, checked against the names the
     grouping engine can actually produce (the bundled rulebook plus the
     user's own mappings, which is exactly how the Mapping page builds its
     picker). A name that appears in neither can never be matched, so the
     lookup silently contributes zero and a cash-cycle card reads a
     confident, wrong "0.0 วัน" — the failure this catches. A group that
     exists but happens to be empty this period is a real zero and is not
     reported. */
  function unreachableGroups() {
    const known = new Set();
    Object.values(RULEBOOK.rules || {}).forEach(r => r && known.add(r.group));
    Object.values(Store.mappings() || {}).forEach(r => r && known.add(r.group));
    const wanted = new Set(CASH_GROUPS.concat(PREPAY_GROUP));
    for (const spec of Object.values(BASE)) for (const [, , group] of spec) wanted.add(group);
    return [...wanted].filter(g => !known.has(g)).sort();
  }

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
    const cashEquiv = CASH_GROUPS.reduce((t, g) => t + groupIn(mbs.assets, CUR, g), 0);
    const prepayment = groupIn(mbs.assets, CUR, PREPAY_GROUP);
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
        roa: { badge: `ยอดสะสม ${months} เดือน · ไม่ปรับรายปี`, value: mbs.totalAssets ? 100 * mbs.netProfit / mbs.totalAssets : null, formula: 'กำไรสุทธิ ÷ สินทรัพย์รวม (ยอดปลายงวด) ✓ ตรงกับสูตร Conso จริง' },
        roe: { badge: `ยอดสะสม ${months} เดือน · ไม่ปรับรายปี`, value: equity ? 100 * mbs.netProfit / equity : null, formula: 'กำไรสุทธิ ÷ ส่วนของผู้ถือหุ้น (ยอดปลายงวด) — ยังไม่พบสูตร Conso เฉพาะ' },
        assetTurnover: { badge: `ยอดสะสม ${months} เดือน · ไม่ปรับรายปี`, value: mbs.totalAssets ? mpl.revenue / mbs.totalAssets : null, formula: 'รายได้ (YTD) ÷ สินทรัพย์รวม (ยอดปลายงวด) — ยังไม่ทำเป็นรายปี, ยังไม่พบสูตร Conso เฉพาะ' },
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
        roa: { badge: `ยอดสะสม ${months} เดือน · ไม่ปรับรายปี`, value: mbs.totalAssets ? 100 * mbs.netProfit / mbs.totalAssets : null, formula: 'กำไรสุทธิ ÷ สินทรัพย์รวม (ยอดปลายงวด) — ยังไม่พบสูตรไต้หวันแยกในไฟล์' },
        roe: { badge: `ยอดสะสม ${months} เดือน · ไม่ปรับรายปี`, value: avgEquity ? 100 * mbs.netProfit / avgEquity : null, formula: `กำไรสุทธิ ÷ ส่วนของผู้ถือหุ้นเฉลี่ย ${M(avgEquity)} ✓ สูตรจริงจากชีท NROIC — ${avgNote}` },
        assetTurnover: { badge: `ยอดสะสม ${months} เดือน · ไม่ปรับรายปี`, value: mbs.totalAssets ? mpl.revenue / mbs.totalAssets : null, formula: 'รายได้ (YTD) ÷ สินทรัพย์รวม (ยอดปลายงวด) — ยังไม่พบสูตรไต้หวันแยกในไฟล์' },
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
      roa: { badge: annualizeFactor > 1 ? `ปรับเป็นรายปี ×${annualizeFactor.toFixed(2)}` : 'เต็มปีแล้ว · ไม่ต้องปรับ', value: avgAssets ? 100 * ebit * annualizeFactor / avgAssets : null, formula: `EBIT${ytdNote} ÷ สินทรัพย์รวมเฉลี่ย ${M(avgAssets)} ✓ สูตรจริงจาก SET — ${avgNote}` },
      roe: { badge: annualizeFactor > 1 ? `ปรับเป็นรายปี ×${annualizeFactor.toFixed(2)}` : 'เต็มปีแล้ว · ไม่ต้องปรับ', value: avgEquity ? 100 * mbs.netProfit * annualizeFactor / avgEquity : null, formula: `กำไรสุทธิ${ytdNote} ÷ ส่วนของผู้ถือหุ้นเฉลี่ย ${M(avgEquity)} ✓ สูตรจริงจาก SET — ${avgNote}` },
      assetTurnover: { badge: annualizeFactor > 1 ? `ปรับเป็นรายปี ×${annualizeFactor.toFixed(2)}` : 'เต็มปีแล้ว · ไม่ต้องปรับ', value: avgAssets ? mpl.revenue * annualizeFactor / avgAssets : null, formula: `รายได้${ytdNote} ÷ สินทรัพย์รวมเฉลี่ย ${M(avgAssets)} ✓ สูตรจริงจาก SET — ${avgNote}` },
      de: { value: de, formula: 'หนี้สินรวม ÷ ส่วนของผู้ถือหุ้น (เหมือนวิธีบริษัท)' },
      interestCoverage: { value: interestCoverage, formula: `EBIT ${M(ebit)} ÷ ดอกเบี้ยจ่าย ${M(interestExpense)} (เหมือนวิธีบริษัท)` },
    };
  }

  /* The inputs a real, sourced formula needs that a single period's file
     can't supply — resolved from the periods around `key`. Both the cards
     and every point in the trend series go through this, which is what
     keeps them showing the same number for the same period. */
  function ctxFor(key, months, extra) {
    const ttmRevenue = key ? ttmFlow(key, 'revenue') : null, ttmCogs = key ? ttmFlow(key, 'cogs') : null;
    const qRevenue = key ? quarterFlow(key, 'revenue') : null, qCogs = key ? quarterFlow(key, 'cogs') : null;
    return Object.assign({
      periodMonths: months,
      ttm: (ttmRevenue != null && ttmCogs != null) ? { revenue: ttmRevenue, cogs: ttmCogs } : null,
      twFlow: (qRevenue != null && qCogs != null) ? { revenue: qRevenue, cogs: qCogs } : null,
      thAvg: key ? thAveraging(key) : null,
      twAvg: key ? twAveraging(key) : null,
    }, extra || {});
  }

  global.RatioEngine = {
    M, monthsFromKey, shiftMonthKey, plAt, bsAt, BASE, sumSpec, CASH_GROUPS, PREPAY_GROUP,
    unreachableGroups, monthlyFlow, sumFlow, ttmFlow, quarterFlow, thAveraging, twAveraging,
    RATIO_SPEC, computeTabMetrics, ctxFor, TABS: ['th', 'tw', 'set'],
  };
  if (typeof module !== 'undefined') module.exports = global.RatioEngine;
})(typeof window !== 'undefined' ? window : globalThis);
