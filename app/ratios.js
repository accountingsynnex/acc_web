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

  // Which period the imported figures cover — ONE control, identical on all
  // 3 tabs (Q1 · Q2 · Q3 · Q4), replacing both the free-typed month count
  // and SET's separate รายไตรมาส/เต็มปี toggle. It's a property of the
  // imported file, not of a tab, so the three toggles share one value.
  //
  // P&L accounts in a trial balance read cumulative since the start of the
  // fiscal year, so the quarter picked IS the month count: at Q2 the P&L
  // already carries 6 months. That's what both things the toggle drives
  // need — turning a balance into days (every tab's cash cycle) and
  // annualising a flow (SET's ROA/ROE/Asset Turnover) — so picking the
  // quarter now determines them exactly instead of by a typed guess.
  //
  // There is no separate "full year" option because Q4 already is one: at
  // Q4 the cumulative P&L covers all 12 months, so a full-year button would
  // compute exactly the same numbers under a second name.
  const PERIOD_OPTS = [
    { key: 'q1', label: 'Q1', months: 3 },
    { key: 'q2', label: 'Q2', months: 6 },
    { key: 'q3', label: 'Q3', months: 9 },
    { key: 'q4', label: 'Q4', months: 12 },
  ];
  let periodSel = 'q1';
  const periodOpt = () => PERIOD_OPTS.find(o => o.key === periodSel) || PERIOD_OPTS[0];

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
    const inventory = groupIn(mbs.assets, 'Current Assets', 'Inventories');
    const equity = mbs.totalEquity + mbs.netProfit, debt = mbs.totalLiab;
    const grossAR = groupIn(mbs.assets, 'Current Assets', 'Trade receivables');
    const tradeAP = groupIn(mbs.liab, 'Current Liabilities', 'Trade payable');
    const otherReceivable = groupIn(mbs.assets, 'Current Assets', 'Other receivable');
    const cashEquiv = groupIn(mbs.assets, 'Current Assets', 'Cash in Hand')
      + groupIn(mbs.assets, 'Current Assets', 'Cash at Bank - current account')
      + groupIn(mbs.assets, 'Current Assets', 'Cash at Bank - saving accounts')
      + groupIn(mbs.assets, 'Current Assets', 'Short-term investments');
    const prepayment = groupIn(mbs.assets, 'Current Assets', 'Prepayment');
    const interestExpense = -mpl.finance;
    const ebit = mpl.revenue + mpl.cogs + mpl.opEx + mpl.otherIE + mpl.share;

    const avgOf = (curV, prevV) => prevV != null ? (curV + prevV) / 2 : curV;
    const avgAR = avgOf(grossAR, prevBs ? groupIn(prevBs.assets, 'Current Assets', 'Trade receivables') : null);
    const avgInv = avgOf(inventory, prevBs ? groupIn(prevBs.assets, 'Current Assets', 'Inventories') : null);
    const avgAP = avgOf(tradeAP, prevBs ? groupIn(prevBs.liab, 'Current Liabilities', 'Trade payable') : null);
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
      // "Synnex KPI" (the company's own cash-cycle comparison chart) divides
      // by revenue/COGS over the trailing 12 months. The selected quarter
      // says how many months of flow the imported P&L carries, so the same
      // shape falls out of the file itself: ending balance ÷ flow-to-date
      // × the days those months represent. It differs from a true trailing
      // 12 months when the year is seasonal, which the card says outright.
      const days = 365 * months / 12, cogsAbs = Math.abs(mpl.cogs);
      const arDays = mpl.revenue ? grossAR / mpl.revenue * days : null;
      const invDays = cogsAbs ? inventory / cogsAbs * days : null;
      const apDays = cogsAbs ? tradeAP / cogsAbs * days : null;
      const note = `(งบ ${ctx.periodLabel || ''} = ${months} เดือนสะสม — ผัง Synnex KPI จริงใช้ยอดเฉลี่ยเทียบงวดเดียวกันปีก่อน ÷ รายได้ 12 เดือนล่าสุด)`;
      const arF = `ลูกหนี้การค้า ${M(grossAR)} ÷ รายได้ × ${days.toFixed(2)} วัน ${note}`;
      const invF = `สินค้าคงเหลือ ${M(inventory)} ÷ ต้นทุนขาย × ${days.toFixed(2)} วัน ${note}`;
      const apF = `เจ้าหนี้การค้า ${M(tradeAP)} ÷ ต้นทุนขาย × ${days.toFixed(2)} วัน ${note}`;
      return {
        arDays: { value: arDays, formula: arF, base: grossAR },
        invDays: { value: invDays, formula: invF, base: inventory },
        apDays: { value: apDays, formula: apF, base: tradeAP },
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
      const cogsAbs = Math.abs(mpl.cogs);
      const dayMultiplier = 365 * months / 12;
      const arDays = mpl.revenue ? avgAR / mpl.revenue * dayMultiplier : null;
      const invDays = cogsAbs ? avgInv / cogsAbs * dayMultiplier : null;
      const apDays = cogsAbs ? avgAP / cogsAbs * dayMultiplier : null;
      // AR Vendor Days (vendor rebate receivable, "VAR") — real, Taiwan-only
      // metric per the company's own comparison chart (blank for Synnex
      // KPI/SET) — folds into Taiwan's own Cash Conversion Cycle total too,
      // same as the Capital Turn calc under NROIC below.
      const grossVAR = groupIn(mbs.assets, 'Current Assets', 'Rebate receivables');
      const avgVAR = avgOf(grossVAR, prevBs ? groupIn(prevBs.assets, 'Current Assets', 'Rebate receivables') : null);
      const arVendorDays = mpl.revenue ? avgVAR / mpl.revenue * dayMultiplier : null;
      const ccc = [arDays, invDays, apDays, arVendorDays].every(v => v != null) ? arDays + invDays - apDays + arVendorDays : null;
      const avgNote = ctx.avgNote || '';
      const pNote = `(งบ ${ctx.periodLabel || ''} = ${months} เดือนสะสม)`;
      return {
        arDays: { base: avgAR, value: arDays, formula: `ลูกหนี้การค้าเฉลี่ย ${M(avgAR)} ÷ รายได้ × ${dayMultiplier.toFixed(2)} วัน ✓ สูตรจริงจาก PAR/NROIC ${pNote}` },
        arVendorDays: { base: avgVAR, value: arVendorDays, formula: `ลูกหนี้เคลม vendor เฉลี่ย ${M(avgVAR)} ÷ รายได้ × ${dayMultiplier.toFixed(2)} วัน ✓ สูตรจริงจาก PAR/NROIC ${pNote}` },
        invDays: { base: avgInv, value: invDays, formula: `สินค้าคงเหลือเฉลี่ย ${M(avgInv)} ÷ ต้นทุนขาย × ${dayMultiplier.toFixed(2)} วัน ✓ สูตรจริงจาก PAR/NROIC ${pNote}` },
        apDays: { base: avgAP, value: apDays, formula: `เจ้าหนี้การค้าเฉลี่ย ${M(avgAP)} ÷ ต้นทุนขาย × ${dayMultiplier.toFixed(2)} วัน ✓ สูตรจริงจาก PAR/NROIC ${pNote}` },
        ccc: { value: ccc, formula: 'AR Days + AR Vendor Days + Inventory Days − AP Days (ค่าเฉลี่ยต้นงวด+ปลายงวด แทนยอดปลายงวดล้วน)' },
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
    const daysSet = 365 * monthsSet / 12, cogsAbsSet = Math.abs(mpl.cogs);
    const arDays = mpl.revenue ? (grossAR + otherReceivable) / mpl.revenue * daysSet : null;
    const invDays = cogsAbsSet ? inventory / cogsAbsSet * daysSet : null;
    const apDays = cogsAbsSet ? tradeAP / cogsAbsSet * daysSet : null;
    const noteSet = `(ยอดปลายงวด, งบ ${ctx.periodLabel || ''} = ${monthsSet} เดือนสะสม — SET จริงใช้รายได้/ต้นทุนขาย 12 เดือนล่าสุด)`;
    const arF = `ลูกหนี้การค้า + ลูกหนี้อื่น ${M(grossAR + otherReceivable)} ÷ รายได้ × ${daysSet.toFixed(2)} วัน ${noteSet}`;
    const invF = `สินค้าคงเหลือ ${M(inventory)} ÷ ต้นทุนขาย × ${daysSet.toFixed(2)} วัน ${noteSet}`;
    const apF = `เจ้าหนี้การค้า ${M(tradeAP)} ÷ ต้นทุนขาย × ${daysSet.toFixed(2)} วัน ${noteSet}`;
    return {
      arDays: { value: arDays, formula: arF, base: grossAR + otherReceivable },
      invDays: { value: invDays, formula: invF, base: inventory },
      apDays: { value: apDays, formula: apF, base: tradeAP },
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
      if (chart.data.labels.length > 10) return;
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
        layout: { padding: { top: 26 } },      // room for the labels above the line's top point
        plugins: {
          cycleValueLabels: { ink, halo: cssVar('--chart-halo') },
          title: { display: true, text: cfg.title, color: ink, font: { size: 12.5, weight: '600' } },
          subtitle: { display: !!cfg.hint, text: cfg.hint || '', color: faint, font: { size: 10 }, padding: { bottom: 4 } },
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
    $(tblId).innerHTML = `<thead><tr><th>อัตราส่วน</th>${labels.map(l => `<th class="r">${esc(l)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => r.header
        ? `<tr><td colspan="${labels.length + 1}" style="padding-top:12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:700">${esc(r.header)}</td></tr>`
        : `<tr><td>${esc(r.label)}</td>${r.values.map(v => `<td class="r">${fmt(v, r.unit)}</td>`).join('')}</tr>`
      ).join('')}</tbody>`;
  }

  function render() {
    const g = FS.grouped();
    if (!g) {
      $('banner').innerHTML = `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">ยังไม่ได้นำเข้างบทดลอง</div><div class="d">ไปที่ <a class="linkish" href="import.html">Import TB</a> ก่อน</div></div></div>`;
      $('th').innerHTML = ''; $('tw').innerHTML = ''; $('set').innerHTML = '';
      ['Th', 'Tw', 'Set'].forEach(suffix => { $(`trendEmpty${suffix}`).style.display = ''; $(`trendBody${suffix}`).style.display = 'none'; });
      destroyAllCharts();
      return;
    }
    const bs = FS.buildBS(g), pl = FS.buildPL(g);

    // Opening balances (the imported file's own opening-balance column) —
    // used as the LIVE point's averaging partner for Taiwan/SET below.
    const openingRows = Store.openingRows();
    const openingG = openingRows ? FS.grouped(openingRows) : null;
    const openingBS = openingG ? FS.buildBS(openingG) : null;
    const avgNote = openingBS
      ? `ยอดเฉลี่ยต้นงวด+ปลายงวด (ยอดยกมาจากไฟล์ที่นำเข้า: ${M(openingBS.totalAssets)})`
      : '⚠ ไฟล์ที่นำเข้าไม่มีคอลัมน์ยอดยกมา (Opening balance) ใช้ยอดปลายงวดแทนค่าเฉลี่ย';

    const opt = periodOpt(), periodMonths = opt.months, periodLabel = opt.label;
    const annualizeFactor = 12 / periodMonths;
    const ytdNote = annualizeFactor > 1 ? ` × annualize ${annualizeFactor.toFixed(2)} (${periodMonths} เดือน→12)` : '';

    renderTabCards('th', computeTabMetrics('th', bs, pl, null, { periodMonths, periodLabel }));
    renderTabCards('tw', computeTabMetrics('tw', bs, pl, openingBS, { periodMonths, periodLabel, avgNote }));
    renderTabCards('set', computeTabMetrics('set', bs, pl, openingBS, { annualizeFactor, ytdNote, avgNote, periodMonths, periodLabel }));

    // ---- Quarterly trend ("แนวโน้มรายไตรมาส") on all 3 tabs — recomputes
    // every ratio above once per period saved via Import's "งวดที่บันทึกไว้"
    // (oldest→newest) plus the live period, mirroring the company's own
    // "xCash Cycle (Conso)" tracking sheet. Averaging pieces chain off the
    // PREVIOUS point in this series' closing balance — a different average
    // than the live cards' own opening-balance-column average above, which
    // is about one file, not a series; the first point has no predecessor
    // so falls back to its own ending balance.
    const saved = Store.listPeriods().slice().sort((a, b) => a.key < b.key ? -1 : 1);
    const trendList = [];
    for (const p of saved) {
      const prows = Store.periodCombinedRows(p.key);
      const pg = prows && prows.length ? FS.grouped(prows) : null;
      if (!pg) continue;
      trendList.push({ label: p.label, bs: FS.buildBS(pg), pl: FS.buildPL(pg) });
    }
    trendList.push({ label: 'ปัจจุบัน', bs, pl });
    const trendLabels = trendList.map(p => p.label);
    const perPoint = trendList.map((pt, i) => {
      const prevBs = i > 0 ? trendList[i - 1].bs : null;
      return {
        th: computeTabMetrics('th', pt.bs, pt.pl, null, { periodMonths, periodLabel }),
        tw: computeTabMetrics('tw', pt.bs, pt.pl, prevBs, { periodMonths, periodLabel }),
        set: computeTabMetrics('set', pt.bs, pt.pl, prevBs, { annualizeFactor, periodMonths, periodLabel }),
      };
    });

    function renderTrendTab(suffix, tabKey) {
      const hasEnough = trendList.length >= 2;
      $(`trendEmpty${suffix}`).style.display = hasEnough ? 'none' : '';
      $(`trendBody${suffix}`).style.display = hasEnough ? '' : 'none';
      if (!hasEnough) {
        ['ArDays', 'InvDays', 'ApDays', 'Ccc'].forEach(c => { const id = `chart${c}${suffix}`; if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
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
      const money = (id, title, key, target, hint) => drawCycleChart(`chart${id}${suffix}`, {
        title, hint, labels: trendLabels, moneyBars: true, target,
        bars: [{ label: title.replace(' Days', '') + ' (ล้านบาท)', data: bal(key), color: sv[0] }],
        line: { label: title, data: days(key) },
      });
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

    $('banner').innerHTML = `<div class="check ok" style="margin-bottom:14px"><div class="ico">✓</div><div><div class="t">คำนวณจากงบที่โรลอัปสด</div>
      <div class="d">DSCR และ LT Debt/EBITDA ต้องใช้ตารางกระแสเงินสด/เงินกู้ — ดูหน้า <a class="linkish" href="cashflow.html">Cash Flow</a></div></div></div>`;

  }

  /* Paint the Q1..Q4/ทั้งปี toggle on all 3 tabs from the one shared value,
     and write the note under each. Same control, same wording everywhere —
     only the sentence about what it drives differs, because it genuinely
     does: SET's ROA/ROE/Asset Turnover annualize, Thailand's and Taiwan's
     don't (their sourced formulas use the YTD flow against an ending or
     averaged balance without scaling it up). */
  function renderPeriodSeg() {
    const opt = periodOpt(), factor = 12 / opt.months;
    document.querySelectorAll('[data-period-seg]').forEach(seg => {
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === periodSel));
    });
    document.querySelectorAll('[data-period-note]').forEach(el => {
      const tab = el.closest('.tab-panel').dataset.panel;
      const extra = tab === 'set'
        ? (factor > 1
          ? ` และปรับ ROA/ROE/Total Asset Turnover เป็นรายปี <b>×${factor.toFixed(2)}</b>`
          : ' และไม่ต้องปรับ ROA/ROE/Total Asset Turnover เป็นรายปี (เต็มปีแล้ว)')
        : ' (ROA/ROE/Asset Turnover ของแท็บนี้ใช้ยอดสะสมตรงๆ ตามสูตรบริษัท ไม่ปรับเป็นรายปี)';
      const full = opt.months === 12 ? ' คือเต็มปี' : '';
      el.innerHTML = `เลือกงวดที่งบซึ่งนำเข้าครอบคลุม — งบทดลองสะสมกำไรขาดทุนตั้งแต่ต้นปีบัญชี <b>${esc(opt.label)}</b> จึงเท่ากับ <b>${opt.months} เดือน</b>${full} ใช้แปลงยอดคงเหลือเป็นจำนวนวันในวงจรเงินสด${extra} — ค่านี้ใช้ร่วมกันทั้ง 3 แท็บ`;
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
