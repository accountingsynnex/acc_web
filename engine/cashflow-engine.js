/* Cash Flow (indirect method) — computed LIVE from the rolled-up BS/P&L for
   the period covered by whatever TB was imported, not a frozen snapshot.
   Pure function, same style as fs.js.

   Key subtlety verified against a real company's June-2026 TB: its
   "Opening balance" column is the balance one month earlier (end of the
   PRIOR month), not the start of the fiscal year — P&L accounts still read
   cumulative-since-fiscal-year-start at any snapshot (that's how nominal
   accounts work until the year-end close), so this period's own P&L flow
   has to be taken as closingPL − openingPL, exactly like a BS balance's
   movement — never read pl.netProfit (or any PL group) directly off the
   closing snapshot alone, or it silently mixes a 6-months-cumulative flow
   into what's otherwise a 1-month balance-sheet comparison. Whatever
   period length the imported TB's own opening/closing actually spans is
   the period this function reports on — it doesn't assume a month, a
   quarter or a year.

   This is a best-effort estimate, not an audited statement — a real
   indirect cash flow needs manual rollforward schedules (fixed-asset
   additions/disposals split from depreciation, dividend receivable
   movement, NCI dividend split, ...) that a plain trial balance doesn't
   carry, and some accounts (e.g. trade-finance / import L/C facilities)
   may follow a company-specific classification policy (operating vs
   financing) that can't be inferred from the TB alone. Verified against
   one real month: "profit before working capital changes" and the overall
   CFO/CFI/CFF-vs-actual-cash-change tie were both far closer once the
   period-flow subtlety above was fixed, but a real, unreconciled gap
   remained — carried below as an explicit disclosed line, not folded
   silently into "FX effect."

   Every group name referenced below comes straight from RULEBOOK (see
   engine/rulebook.js) — this file has no rulebook of its own, it just
   knows which of THAT rulebook's group names are non-cash P&L add-backs,
   which current-liability groups are financing rather than operating, etc.
   A different chart of accounts needs this classification updated to
   match its own rulebook's group names. */
(function (global) {
  const CASH_GROUPS = ['Cash in Hand', 'Cash at Bank - current account', 'Cash at Bank - saving accounts'];

  const ADDBACK_PL_GROUPS = [
    ['Operating Expenses', 'Depreciation'],
    ['Operating Expenses', 'Amortization'],
    ['Operating Expenses', 'Bad Debt'],
    ['Cost of Sales', 'Inventory provision'],
    ['Other Income / Expense', 'Unrealized foreign exchange gain (loss)'],
  ];
  const FINANCING_CL_GROUPS = [
    'เงินเบิกเกินบัญชีและเงินกู้ยืมระยะสั้นจากสถาบันการเงิน',
    'เงินกู้ยืมระยะสั้นจากกิจการที่เกี่ยวข้องกัน',
    'ส่วนของเงินกู้ยืมระยะยาวจากสถาบันการเงินที่ถึงกำหนดชำระภายในหนึ่งปี',
    'ส่วนของหนี้สินตามสัญญาเช่าที่ถึงกำหนดชำระภายในหนึ่งปี',
  ];
  const TAX_PAYABLE_GROUP = 'ภาษีเงินได้นิติบุคคลค้างจ่าย';
  const INVESTING_CA_GROUPS = ['เงินให้กู้ยืมระยะสั้น', 'Short-term investments'];
  const OTHER_NCA_EXCL = ['Cost', 'Accumulative Depreciation', 'สินทรัพย์ไม่มีตัวตน', 'เงินลงทุนในบริษัทย่อย', 'เงินลงทุนในบริษัทร่วม', 'เงินให้กู้ยืมระยะยาว', 'Loan&Advance to relate company'];
  const BORROW_CL_GROUPS = ['เงินเบิกเกินบัญชีและเงินกู้ยืมระยะสั้นจากสถาบันการเงิน', 'เงินกู้ยืมระยะสั้นจากกิจการที่เกี่ยวข้องกัน', 'ส่วนของเงินกู้ยืมระยะยาวจากสถาบันการเงินที่ถึงกำหนดชำระภายในหนึ่งปี'];

  function groupIn(arr, name, grp) { const s = arr.find(x => x.name === name); if (!s) return 0; const g = s.groups.find(x => x.group === grp); return g ? g.value : 0; }
  function groupsExcl(arr, name, excl) { const s = arr.find(x => x.name === name); if (!s) return []; return s.groups.filter(g => !excl.includes(g.group)); }
  function plGroup(pl, sectionName, groupName) { const s = pl.sections.find(x => x.name === sectionName); if (!s) return 0; const g = s.groups.find(x => x.group === groupName); return g ? g.value : 0; }
  function plSecTotal(pl, sectionName) { const s = pl.sections.find(x => x.name === sectionName); return s ? s.total : 0; }
  function cashOf(bs) { return CASH_GROUPS.reduce((s, g) => s + groupIn(bs.assets, 'Current Assets', g), 0); }

  // Turn two cumulative-since-fiscal-year-start P&L snapshots into this
  // period's own flow — subtracts every matching section/group, not just
  // the netProfit total, since the add-back logic below needs specific
  // group values on the SAME (this-period-only) basis.
  function periodPL(closingPL, openingPL) {
    const sections = closingPL.sections.map(closeSec => {
      const openSec = openingPL.sections.find(s => s.name === closeSec.name) || { groups: [], total: 0 };
      const groups = closeSec.groups.map(g => {
        const openG = openSec.groups.find(x => x.group === g.group);
        return { group: g.group, value: g.value - (openG ? openG.value : 0) };
      });
      return { name: closeSec.name, groups, total: closeSec.total - openSec.total };
    });
    return { sections, netProfit: closingPL.netProfit - openingPL.netProfit };
  }

  function makeSection() {
    const rows = []; let total = 0;
    return { add(label, value) { if (value) { rows.push({ label, value }); total += value; } return value; }, rows, get total() { return total; } };
  }

  // `closingPL`/`openingPL` = FS.buildPL() run on the closing/opening rows
  // respectively (both cumulative-since-fiscal-year-start readings — this
  // function takes their difference internally, see periodPL above).
  function computeCashFlow(bs, closingPL, openingBs, openingPL) {
    /* Without an opening position there is no movement to derive, and this
       statement is nothing but movement. Every caller already checks for
       opening balances before reaching here, so this states the contract
       rather than fixing a live bug — a future caller gets null back instead
       of a TypeError from inside periodPL. */
    if (!bs || !closingPL || !openingBs || !openingPL) return null;
    const pl = periodPL(closingPL, openingPL);
    const netProfit = pl.netProfit;

    const addback = makeSection();
    for (const [sec, grp] of ADDBACK_PL_GROUPS) { const v = plGroup(pl, sec, grp); if (v) addback.add(grp, -v); }
    const financeCosts = plSecTotal(pl, 'Finance Costs');
    const taxExpense = plSecTotal(pl, 'Income Tax');
    const shareOfProfit = plSecTotal(pl, 'Share of Profit');
    const interestIncome = plGroup(pl, 'Other Income / Expense', 'Interest income');
    addback.add('ต้นทุนทางการเงิน (ดอกเบี้ยจ่าย)', -financeCosts);
    addback.add('ภาษีเงินได้', -taxExpense);
    if (shareOfProfit) addback.add('ส่วนแบ่งกำไร(ขาดทุน)จากบริษัทร่วม/ย่อย (วิธีส่วนได้เสีย)', -shareOfProfit);
    if (interestIncome) addback.add('ดอกเบี้ยรับ (แสดงในกิจกรรมลงทุนแทน)', -interestIncome);

    const empBenefitNow = groupIn(bs.liab, 'Non-current Liabilities', 'ประมาณการหนี้สินสำหรับผลประโยชน์พนักงาน');
    const empBenefitOpen = groupIn(openingBs.liab, 'Non-current Liabilities', 'ประมาณการหนี้สินสำหรับผลประโยชน์พนักงาน');
    addback.add('เปลี่ยนแปลงประมาณการหนี้สินผลประโยชน์พนักงาน', empBenefitNow - empBenefitOpen);
    const deferredTaxLiabNow = groupIn(bs.liab, 'Non-current Liabilities', 'หนี้สินภาษีเงินได้รอการตัดบัญชี');
    const deferredTaxLiabOpen = groupIn(openingBs.liab, 'Non-current Liabilities', 'หนี้สินภาษีเงินได้รอการตัดบัญชี');
    addback.add('เปลี่ยนแปลงหนี้สินภาษีเงินได้รอการตัดบัญชี', deferredTaxLiabNow - deferredTaxLiabOpen);

    const profitBeforeWC = netProfit + addback.total;

    const wc = makeSection();
    const caNow = groupsExcl(bs.assets, 'Current Assets', [...CASH_GROUPS, ...INVESTING_CA_GROUPS]);
    const caOpen = groupsExcl(openingBs.assets, 'Current Assets', [...CASH_GROUPS, ...INVESTING_CA_GROUPS]);
    for (const g of caNow) { const ov = (caOpen.find(x => x.group === g.group) || { value: 0 }).value; wc.add(g.group, -(g.value - ov)); }
    const clNow = groupsExcl(bs.liab, 'Current Liabilities', [...FINANCING_CL_GROUPS, TAX_PAYABLE_GROUP]);
    const clOpen = groupsExcl(openingBs.liab, 'Current Liabilities', [...FINANCING_CL_GROUPS, TAX_PAYABLE_GROUP]);
    for (const g of clNow) { const ov = (clOpen.find(x => x.group === g.group) || { value: 0 }).value; wc.add(g.group, g.value - ov); }

    const cfoBeforeTax = profitBeforeWC + wc.total;
    const taxPayableNow = groupIn(bs.liab, 'Current Liabilities', TAX_PAYABLE_GROUP);
    const taxPayableOpen = groupIn(openingBs.liab, 'Current Liabilities', TAX_PAYABLE_GROUP);
    const taxPaid = -taxExpense - (taxPayableNow - taxPayableOpen);
    const cfo = cfoBeforeTax - taxPaid;

    const inv = makeSection();
    const ppeCostNow = groupIn(bs.assets, 'Non-current Assets', 'Cost'), ppeCostOpen = groupIn(openingBs.assets, 'Non-current Assets', 'Cost');
    inv.add('ที่ดิน อาคารและอุปกรณ์ (สุทธิ ซื้อ−จำหน่าย ที่ราคาทุน)', -(ppeCostNow - ppeCostOpen));
    const intangNow = groupIn(bs.assets, 'Non-current Assets', 'สินทรัพย์ไม่มีตัวตน'), intangOpen = groupIn(openingBs.assets, 'Non-current Assets', 'สินทรัพย์ไม่มีตัวตน');
    const amortization = plGroup(pl, 'Operating Expenses', 'Amortization');
    inv.add('สินทรัพย์ไม่มีตัวตน (สุทธิ ซื้อ−ตัดจำหน่าย, ปรับด้วยค่าตัดจำหน่ายแล้ว)', -((intangNow - intangOpen) + amortization));
    const investNow = groupIn(bs.assets, 'Non-current Assets', 'เงินลงทุนในบริษัทย่อย') + groupIn(bs.assets, 'Non-current Assets', 'เงินลงทุนในบริษัทร่วม');
    const investOpen = groupIn(openingBs.assets, 'Non-current Assets', 'เงินลงทุนในบริษัทย่อย') + groupIn(openingBs.assets, 'Non-current Assets', 'เงินลงทุนในบริษัทร่วม');
    inv.add('เงินลงทุนในบริษัทย่อย/บริษัทร่วม (สุทธิ ปรับด้วยส่วนแบ่งกำไรวิธีส่วนได้เสียแล้ว)', -((investNow - investOpen) - shareOfProfit));
    const loansNow = groupIn(bs.assets, 'Current Assets', 'เงินให้กู้ยืมระยะสั้น') + groupIn(bs.assets, 'Non-current Assets', 'เงินให้กู้ยืมระยะยาว') + groupIn(bs.assets, 'Non-current Assets', 'Loan&Advance to relate company');
    const loansOpen = groupIn(openingBs.assets, 'Current Assets', 'เงินให้กู้ยืมระยะสั้น') + groupIn(openingBs.assets, 'Non-current Assets', 'เงินให้กู้ยืมระยะยาว') + groupIn(openingBs.assets, 'Non-current Assets', 'Loan&Advance to relate company');
    inv.add('เงินให้กู้ยืมแก่กิจการที่เกี่ยวข้องกัน/อื่น (สุทธิ)', -(loansNow - loansOpen));
    const stiNow = groupIn(bs.assets, 'Current Assets', 'Short-term investments'), stiOpen = groupIn(openingBs.assets, 'Current Assets', 'Short-term investments');
    inv.add('เงินลงทุนระยะสั้น (สุทธิ)', -(stiNow - stiOpen));
    if (interestIncome) inv.add('ดอกเบี้ยรับ', interestIncome);
    const otherNcaNow = groupsExcl(bs.assets, 'Non-current Assets', OTHER_NCA_EXCL);
    const otherNcaOpen = groupsExcl(openingBs.assets, 'Non-current Assets', OTHER_NCA_EXCL);
    let otherNcaDelta = 0;
    for (const g of otherNcaNow) otherNcaDelta += g.value - (otherNcaOpen.find(x => x.group === g.group) || { value: 0 }).value;
    inv.add('สินทรัพย์ไม่หมุนเวียนอื่น (สุทธิ, ประมาณ)', -otherNcaDelta);

    const fin = makeSection();
    const borrowNow = BORROW_CL_GROUPS.reduce((s, g) => s + groupIn(bs.liab, 'Current Liabilities', g), 0) + groupIn(bs.liab, 'Non-current Liabilities', 'เงินกู้ยืมระยะยาวจากสถาบันการเงิน');
    const borrowOpen = BORROW_CL_GROUPS.reduce((s, g) => s + groupIn(openingBs.liab, 'Current Liabilities', g), 0) + groupIn(openingBs.liab, 'Non-current Liabilities', 'เงินกู้ยืมระยะยาวจากสถาบันการเงิน');
    fin.add('เงินกู้ยืมจากสถาบันการเงิน/กิจการที่เกี่ยวข้องกัน (สุทธิ รับ−ชำระ)', borrowNow - borrowOpen);
    const leaseNow = groupIn(bs.liab, 'Current Liabilities', 'ส่วนของหนี้สินตามสัญญาเช่าที่ถึงกำหนดชำระภายในหนึ่งปี') + groupIn(bs.liab, 'Non-current Liabilities', 'หนี้สินตามสัญญาเช่า');
    const leaseOpen = groupIn(openingBs.liab, 'Current Liabilities', 'ส่วนของหนี้สินตามสัญญาเช่าที่ถึงกำหนดชำระภายในหนึ่งปี') + groupIn(openingBs.liab, 'Non-current Liabilities', 'หนี้สินตามสัญญาเช่า');
    fin.add('หนี้สินตามสัญญาเช่า (สุทธิ)', leaseNow - leaseOpen);
    const shareNow = groupIn(bs.equity, 'Equity', 'ทุนที่ออกและชำระแล้ว') + groupIn(bs.equity, 'Equity', 'ส่วนเกินทุนหุ้นทุนซื้อคืน') + groupIn(bs.equity, 'Equity', 'ส่วนเกินมูลค่าหุ้นสามัญ');
    const shareOpen = groupIn(openingBs.equity, 'Equity', 'ทุนที่ออกและชำระแล้ว') + groupIn(openingBs.equity, 'Equity', 'ส่วนเกินทุนหุ้นทุนซื้อคืน') + groupIn(openingBs.equity, 'Equity', 'ส่วนเกินมูลค่าหุ้นสามัญ');
    fin.add('ทุนเรือนหุ้น/ส่วนเกินมูลค่าหุ้น (สุทธิ)', shareNow - shareOpen);
    const retainedNow = groupIn(bs.equity, 'Equity', 'Retained profit') + groupIn(bs.equity, 'Equity', 'Profit/loss for current month') + groupIn(bs.equity, 'Equity', 'จัดสรรแล้ว');
    const retainedOpen = groupIn(openingBs.equity, 'Equity', 'Retained profit') + groupIn(openingBs.equity, 'Equity', 'Profit/loss for current month') + groupIn(openingBs.equity, 'Equity', 'จัดสรรแล้ว');
    fin.add('เงินปันผลจ่าย (ประมาณจากการเปลี่ยนแปลงกำไรสะสม)', -((retainedNow - retainedOpen) - netProfit));
    if (financeCosts) fin.add('ดอกเบี้ยจ่าย', financeCosts);

    const cfi = inv.total, cff = fin.total;
    const cashNow = cashOf(bs), cashOpen = cashOf(openingBs);
    const netIncrease = cashNow - cashOpen;
    // Whatever CFO+CFI+CFF doesn't explain — FX translation, trade-finance
    // facilities that may follow a different classification policy than
    // assumed here, or any other unmodeled reclass. Disclosed explicitly,
    // not folded silently into a named line.
    const unexplained = netIncrease - (cfo + cfi + cff);

    return {
      netProfit, addback: addback.rows, profitBeforeWC,
      workingCapital: wc.rows, cfoBeforeTax, taxPaid, cfo,
      investing: inv.rows, cfi,
      financing: fin.rows, cff,
      unexplained, netIncrease, cashOpen, cashNow,
    };
  }

  global.CashFlowEngine = { computeCashFlow };
  if (typeof module !== 'undefined') module.exports = global.CashFlowEngine;
})(typeof window !== 'undefined' ? window : globalThis);
