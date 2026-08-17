/* Financial-statement builder — roll the grouped TB up into BS and P&L.
   Shared by Statements, Ratios, Cash Flow. Pure (reads Store + engine).

   Sign convention of the raw TB: debit +, credit -. So assets are +,
   liabilities/equity/revenue are -, expenses are +. For presentation we
   flip liabilities/equity/PL so income reads positive and expenses read
   negative; net profit = -(sum of PL). The BS then ties when the period's
   net profit is added to the equity side. */
(function (global) {
  const ASSET = ['Current Assets', 'Non-current Assets'];
  const LIAB = ['Current Liabilities', 'Non-current Liabilities'];
  const EQUITY = ['Equity'];
  const PL_ORDER = ['Revenue', 'Cost of Sales', 'Operating Expenses', 'Other Income / Expense', 'Finance Costs', 'Share of Profit', 'Income Tax'];

  function grouped(rows, periodKey) {
    // Default to the final (post-elimination/adjustment) position so every
    // page automatically reflects the true consolidated numbers once
    // journals are loaded; pass rows explicitly (e.g. a single entity's TB)
    // to bypass that. periodKey only matters on that default path — it
    // reads an ARCHIVED period's own final rows instead of the live one, for
    // pages under the shared period picker (Statements, Cash Flow, ...).
    const combined = rows || Store.finalRows(periodKey);
    if (!combined.length) return null;
    const res = applyRulebook(combined, RULEBOOK, Store.mappings());
    const secMap = {};                       // section -> { statement, groups:{group:sum} }
    for (const [key, sum] of Object.entries(res.groups)) {
      const [st, se, gr] = key.split('||');
      (secMap[se] = secMap[se] || { statement: st, groups: {} });
      secMap[se].groups[gr] = (secMap[se].groups[gr] || 0) + sum;
    }
    return { res, secMap };
  }

  function section(g, name, sign) {
    const s = g.secMap[name];
    if (!s) return { name, groups: [], total: 0, empty: true };
    const groups = Object.entries(s.groups)
      .map(([group, v]) => ({ group, value: sign * v }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return { name, groups, total: groups.reduce((t, x) => t + x.value, 0) };
  }

  function buildPL(g) {
    const sections = PL_ORDER.map(n => (g.secMap[n] ? section(g, n, -1) : null)).filter(Boolean);
    const secTotal = n => { const s = sections.find(x => x.name === n); return s ? s.total : 0; };
    const revenue = secTotal('Revenue'), cogs = secTotal('Cost of Sales');
    return {
      sections, revenue, cogs, grossProfit: revenue + cogs,
      opEx: secTotal('Operating Expenses'), otherIE: secTotal('Other Income / Expense'),
      finance: secTotal('Finance Costs'), share: secTotal('Share of Profit'), tax: secTotal('Income Tax'),
      netProfit: sections.reduce((t, s) => t + s.total, 0),
    };
  }

  function buildBS(g) {
    const assets = ASSET.map(n => section(g, n, 1));
    const liab = LIAB.map(n => section(g, n, -1));
    const equity = EQUITY.map(n => section(g, n, -1));
    const sum = arr => arr.reduce((t, s) => t + s.total, 0);
    const totalAssets = sum(assets), totalLiab = sum(liab), totalEquity = sum(equity);
    const netProfit = buildPL(g).netProfit;
    const totalLE = totalLiab + totalEquity + netProfit;
    return { assets, liab, equity, totalAssets, totalLiab, totalEquity, netProfit, totalLE, diff: totalAssets - totalLE };
  }

  global.FS = { grouped, buildBS, buildPL, ASSET, LIAB, EQUITY, PL_ORDER };
  if (typeof module !== 'undefined') module.exports = global.FS;
})(typeof window !== 'undefined' ? window : globalThis);
