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

  // SET tab basis toggle — 2 named bases: "รายไตรมาส" annualizes a quarter's
  // flow ×4 (assumes the imported TB covers 3 months), "เต็มปี" takes the
  // flow as-is (assumes the imported TB already covers a full year). Only
  // SET's ROA/ROE/Asset Turnover formula needs this (it pairs a flow
  // against an average balance, so it has to know the period length to
  // annualize) — Thailand/Taiwan's own formulas don't average that way, so
  // they have no equivalent toggle.
  let setBasis = 'quarter';
  // How many months the imported TB covers. Every cash-cycle formula here
  // turns a balance into days by dividing by a flow, so all three tabs need
  // it and it's a property of the imported file, not of a tab — one shared
  // value, with an input on each tab that reads and writes it.
  let periodMonths = 3;

  // Thailand ("Synnex KPI" in the company's own comparison chart) and SET's
  // real cash-cycle formulas both divide by revenue/COGS over the trailing
  // 12 months — Thailand also averages the balance against the SAME quarter
  // one year ago, SET uses the ending balance. Both need the same 2 saved
  // periods (Import → "งวดที่บันทึกไว้"): the same quarter one year ago, and
  // the most recently completed full fiscal year — from which trailing
  // revenue/COGS = FY total − that year-ago YTD + this period's own YTD.
  // Until both are saved they fall back to annualising the imported
  // period's own revenue/COGS, which is an approximation and says so.
  let cycleTtmPriorYear = '', cycleTtmFY = '';

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
      // Real "Synnex KPI" formula (the company's own cash-cycle comparison
      // chart): average the balance against the SAME quarter one year ago,
      // divide by revenue/COGS over the trailing 12 months. Falls back to
      // annualising the imported period's own flow (an approximation,
      // disclosed as such) until both reference periods are saved.
      let arDays, invDays, apDays, arF, invF, apF;
      if (ctx.ttmRevenue && ctx.ttmCogs && ctx.priorBsCycle) {
        const priorAR = groupIn(ctx.priorBsCycle.assets, 'Current Assets', 'Trade receivables');
        const priorInv = groupIn(ctx.priorBsCycle.assets, 'Current Assets', 'Inventories');
        const priorAP = groupIn(ctx.priorBsCycle.liab, 'Current Liabilities', 'Trade payable');
        const avgARyoy = (grossAR + priorAR) / 2, avgInvYoy = (inventory + priorInv) / 2, avgAPyoy = (tradeAP + priorAP) / 2;
        const ttmCogsAbs = Math.abs(ctx.ttmCogs);
        arDays = avgARyoy / ctx.ttmRevenue * 365;
        invDays = avgInvYoy / ttmCogsAbs * 365;
        apDays = avgAPyoy / ttmCogsAbs * 365;
        arF = `ลูกหนี้การค้าเฉลี่ย(เทียบปีก่อน) ${M(avgARyoy)} ÷ รายได้ 12 เดือนล่าสุด ${M(ctx.ttmRevenue)} × 365 ✓ สูตรจริงจากผัง Synnex KPI`;
        invF = `สินค้าคงเหลือเฉลี่ย(เทียบปีก่อน) ${M(avgInvYoy)} ÷ ต้นทุนขาย 12 เดือนล่าสุด ${M(ttmCogsAbs)} × 365 ✓ สูตรจริงจากผัง Synnex KPI`;
        apF = `เจ้าหนี้การค้าเฉลี่ย(เทียบปีก่อน) ${M(avgAPyoy)} ÷ ต้นทุนขาย 12 เดือนล่าสุด ${M(ttmCogsAbs)} × 365 ✓ สูตรจริงจากผัง Synnex KPI`;
      } else {
        // No reference periods saved yet: annualise the imported period's own
        // revenue/COGS. Same shape as the real formula, just a rougher flow.
        const days = 365 * months / 12, cogsAbs = Math.abs(mpl.cogs);
        arDays = mpl.revenue ? grossAR / mpl.revenue * days : null;
        invDays = cogsAbs ? inventory / cogsAbs * days : null;
        apDays = cogsAbs ? tradeAP / cogsAbs * days : null;
        const note = `(ประมาณจากงบ ${months} เดือนที่นำเข้า — ยังไม่ได้เลือกงวดปีก่อน+งบเต็มปีล่าสุด)`;
        arF = `ลูกหนี้การค้า ${M(grossAR)} ÷ รายได้ × ${days.toFixed(2)} ${note}`;
        invF = `สินค้าคงเหลือ ${M(inventory)} ÷ ต้นทุนขาย × ${days.toFixed(2)} ${note}`;
        apF = `เจ้าหนี้การค้า ${M(tradeAP)} ÷ ต้นทุนขาย × ${days.toFixed(2)} ${note}`;
      }
      return {
        arDays: { value: arDays, formula: arF },
        invDays: { value: invDays, formula: invF },
        apDays: { value: apDays, formula: apF },
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
      return {
        arDays: { value: arDays, formula: `ลูกหนี้การค้าเฉลี่ย ${M(avgAR)} ÷ รายได้ × ${dayMultiplier.toFixed(2)} ✓ สูตรจริงจาก PAR/NROIC` },
        arVendorDays: { value: arVendorDays, formula: `ลูกหนี้เคลม vendor เฉลี่ย ${M(avgVAR)} ÷ รายได้ × ${dayMultiplier.toFixed(2)} ✓ สูตรจริงจาก PAR/NROIC` },
        invDays: { value: invDays, formula: `สินค้าคงเหลือเฉลี่ย ${M(avgInv)} ÷ ต้นทุนขาย × ${dayMultiplier.toFixed(2)} ✓ สูตรจริงจาก PAR/NROIC` },
        apDays: { value: apDays, formula: `เจ้าหนี้การค้าเฉลี่ย ${M(avgAP)} ÷ ต้นทุนขาย × ${dayMultiplier.toFixed(2)} ✓ สูตรจริงจาก PAR/NROIC` },
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
    // Receivable) ÷ revenue/COGS over the trailing 12 months. Same 2
    // reference periods as Thailand above; same fallback (the imported
    // period's own flow, annualised) until both are saved.
    const annualizeFactor = ctx.annualizeFactor || 1;
    const ytdNote = ctx.ytdNote || '';
    const avgNote = ctx.avgNote || '';
    let arDays, invDays, apDays, arF, invF, apF;
    if (ctx.ttmRevenue && ctx.ttmCogs) {
      const ttmCogsAbs = Math.abs(ctx.ttmCogs);
      arDays = (grossAR + otherReceivable) / ctx.ttmRevenue * 365;
      invDays = inventory / ttmCogsAbs * 365;
      apDays = tradeAP / ttmCogsAbs * 365;
      arF = `ลูกหนี้การค้า + ลูกหนี้อื่น ${M(grossAR + otherReceivable)} (ปลายงวด) ÷ รายได้ 12 เดือนล่าสุด ${M(ctx.ttmRevenue)} × 365 ✓ สูตรจริงจาก SET`;
      invF = `สินค้าคงเหลือ ${M(inventory)} (ปลายงวด) ÷ ต้นทุนขาย 12 เดือนล่าสุด ${M(ttmCogsAbs)} × 365 ✓ สูตรจริงจาก SET`;
      apF = `เจ้าหนี้การค้า ${M(tradeAP)} (ปลายงวด) ÷ ต้นทุนขาย 12 เดือนล่าสุด ${M(ttmCogsAbs)} × 365 ✓ สูตรจริงจาก SET`;
    } else {
      const days = 365 * (ctx.periodMonths || 3) / 12, cogsAbsSet = Math.abs(mpl.cogs);
      arDays = mpl.revenue ? (grossAR + otherReceivable) / mpl.revenue * days : null;
      invDays = cogsAbsSet ? inventory / cogsAbsSet * days : null;
      apDays = cogsAbsSet ? tradeAP / cogsAbsSet * days : null;
      const noteSet = `(ปลายงวด, ประมาณจากงบ ${ctx.periodMonths || 3} เดือนที่นำเข้า — ยังไม่ได้เลือกงวดปีก่อน+งบเต็มปีล่าสุด)`;
      arF = `ลูกหนี้การค้า + ลูกหนี้อื่น ${M(grossAR + otherReceivable)} ÷ รายได้ × ${days.toFixed(2)} ${noteSet}`;
      invF = `สินค้าคงเหลือ ${M(inventory)} ÷ ต้นทุนขาย × ${days.toFixed(2)} ${noteSet}`;
      apF = `เจ้าหนี้การค้า ${M(tradeAP)} ÷ ต้นทุนขาย × ${days.toFixed(2)} ${noteSet}`;
    }
    return {
      arDays: { value: arDays, formula: arF },
      invDays: { value: invDays, formula: invF },
      apDays: { value: apDays, formula: apF },
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
  function drawTrendChart(canvasId, title, labels, data) {
    const el = $(canvasId);
    if (!el) return;
    if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }
    if (!labels.length) return;
    const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), accent = cssVar('--accent');
    const datasets = [{ label: title, data, borderColor: accent, backgroundColor: accent, tension: .25, pointRadius: 4, pointHoverRadius: 6 }];
    charts[canvasId] = new Chart(el.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        maintainAspectRatio: false,
        plugins: {
          title: { display: true, text: title, color: ink, font: { size: 12.5, weight: '600' } },
          legend: { display: false },
          tooltip: { callbacks: { label: c => c.raw == null ? '—' : c.raw.toFixed(1) + ' วัน' } },
        },
        scales: {
          x: { ticks: { color: muted, font: { size: 10.5 } }, grid: { display: false } },
          y: { ticks: { color: muted, font: { size: 10.5 } }, grid: { color: line } },
        },
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

    const annualizeFactor = setBasis === 'quarter' ? 4 : 1;
    const ytdNote = setBasis === 'quarter' ? ` × annualize ${annualizeFactor.toFixed(2)} (3 เดือน→12)` : '';

    // Cash-cycle's own reference periods (Thailand + SET both need trailing-
    // 12-month revenue/COGS = latest full FY − same quarter last year (YTD)
    // + this period (YTD); Thailand also needs that same-quarter-last-year
    // balance to average against). Falls back inside computeTabMetrics to
    // the imported period's own flow when either period isn't saved yet.
    let ttmRevenue = null, ttmCogs = null, priorBsCycle = null;
    const cyclePriorRows = cycleTtmPriorYear ? Store.periodCombinedRows(cycleTtmPriorYear) : null;
    const cycleFyRows = cycleTtmFY ? Store.periodCombinedRows(cycleTtmFY) : null;
    if (cyclePriorRows && cyclePriorRows.length && cycleFyRows && cycleFyRows.length) {
      const priorG = FS.grouped(cyclePriorRows), priorBS = FS.buildBS(priorG), priorPL = FS.buildPL(priorG);
      const fyPL = FS.buildPL(FS.grouped(cycleFyRows));
      ttmRevenue = fyPL.revenue - priorPL.revenue + pl.revenue;
      ttmCogs = fyPL.cogs - priorPL.cogs + pl.cogs;
      priorBsCycle = priorBS;
    }

    renderTabCards('th', computeTabMetrics('th', bs, pl, null, { ttmRevenue, ttmCogs, priorBsCycle, periodMonths }));
    renderTabCards('tw', computeTabMetrics('tw', bs, pl, openingBS, { periodMonths, avgNote }));
    renderTabCards('set', computeTabMetrics('set', bs, pl, openingBS, { annualizeFactor, ytdNote, avgNote, ttmRevenue, ttmCogs, periodMonths }));

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
        th: computeTabMetrics('th', pt.bs, pt.pl, null, { periodMonths }),
        tw: computeTabMetrics('tw', pt.bs, pt.pl, prevBs, { periodMonths }),
        set: computeTabMetrics('set', pt.bs, pt.pl, prevBs, { annualizeFactor, periodMonths }),
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
      const specLabel = key => RATIO_SPEC.find(s => s.key === key).label;
      const rowFor = key => table.find(r => r.label === specLabel(key));
      const arRow = rowFor('arDays'), invRow = rowFor('invDays'), apRow = rowFor('apDays'), cccRow = rowFor('ccc');
      drawTrendChart(`chartArDays${suffix}`, 'AR Days', trendLabels, arRow.values);
      drawTrendChart(`chartInvDays${suffix}`, 'Inventory Days', trendLabels, invRow.values);
      drawTrendChart(`chartApDays${suffix}`, 'AP Days', trendLabels, apRow.values);
      drawTrendChart(`chartCcc${suffix}`, 'Cash Conversion Cycle', trendLabels, cccRow.values);
    }

    renderTrendTab('Th', 'th');
    renderTrendTab('Tw', 'tw');
    renderTrendTab('Set', 'set');

    $('banner').innerHTML = `<div class="check ok" style="margin-bottom:14px"><div class="ico">✓</div><div><div class="t">คำนวณจากงบที่โรลอัปสด</div>
      <div class="d">DSCR และ LT Debt/EBITDA ต้องใช้ตารางกระแสเงินสด/เงินกู้ — ดูหน้า <a class="linkish" href="cashflow.html">Cash Flow</a></div></div></div>`;

    $('setQuarterNote').style.display = setBasis === 'quarter' ? '' : 'none';
    $('setFullyearNote').style.display = setBasis === 'fullyear' ? '' : 'none';
    $('setBasisToggle').querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', b.dataset.basis === setBasis);
      b.onclick = () => { setBasis = b.dataset.basis; render(); };
    });
    ['twMonths', 'thMonths', 'setMonths'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.value = periodMonths;
      el.oninput = e => {
        const v = parseInt(e.target.value, 10);
        if (v >= 1 && v <= 12) { periodMonths = v; render(); }
      };
    });

    // Cash-cycle reference-period pickers — identical control shown on both
    // Thailand and SET tabs (both formulas need the same 2 periods), kept
    // in sync since they share the same module-level state.
    const cyclePeriods = Store.listPeriods();
    const cycleOpts = cyclePeriods.length
      ? cyclePeriods.map(p => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('')
      : `<option value="">— ยังไม่มีงวดบันทึกไว้ —</option>`;
    ['Th', 'Set'].forEach(suffix => {
      const priorSel = $(`cycleTtmPriorYear${suffix}`), fySel = $(`cycleTtmFY${suffix}`);
      if (!priorSel || !fySel) return;
      priorSel.innerHTML = `<option value="">— เลือกงวด —</option>` + cycleOpts;
      fySel.innerHTML = `<option value="">— เลือกงวด —</option>` + cycleOpts;
      priorSel.value = cycleTtmPriorYear;
      fySel.value = cycleTtmFY;
      priorSel.onchange = e => { cycleTtmPriorYear = e.target.value; render(); };
      fySel.onchange = e => { cycleTtmFY = e.target.value; render(); };
    });
  }

  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  $('ratioTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('ratioTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === b.dataset.t));
  });
  render();
})();
