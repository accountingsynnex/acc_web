/* Historical financial-statement inputs, read out of a board-pack workbook.

   The trend charts normally recompute every point from a saved trial
   balance, and nobody keeps ten quarters of trial balances in a browser.
   A board pack does carry that history — but as a summary block: one
   column per period, one row per figure (total assets, revenue, cost of
   sales, receivables, …).

   This reads that block. Deliberately ONLY the inputs, never the ratios
   the workbook also states next to them: the point is for this app to do
   the arithmetic, so its own per-tab formulas apply and a number on the
   page is always one it computed. A row like "AR Days" or "Cash cycle"
   is ignored even when present.

   Pure functions, no DOM: usable in the browser and in Node. */
(function (global) {
  const norm = s => String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[*()]/g, ' ').replace(/\s+/g, ' ').trim();

  /* figure -> exact labels that name it, English or Thai (the same pack
     labels the same figure both ways). Exact, not prefix: "Finance cost"
     and "Finance Cost Year" are different rows, as are "Net operating
     income" and "Net operating income year". */
  const ROWS = [
    ['totalAssets', ['total assets', 'สินทรัพย์รวม']],
    ['totalLiab', ['total liabilities', 'หนี้สินรวม']],
    ['totalEquity', ['total equity', 'ส่วนของผู้ถือหุ้น']],
    ['revenue', ['total revenues', 'total revenue', 'รายได้รวม']],
    ['cogs', ['total cogs', 'total cost of sales', 'ต้นทุนขาย']],
    ['netIncome', ['net income', 'net profit', 'กำไรสุทธิ']],
    ['pbt', ['pbt', 'profit before tax', 'กำไรก่อนภาษี']],
    ['financeCost', ['finance cost', 'finance costs', 'ดอกเบี้ยจ่าย']],
    ['opIncome', ['net operating income', 'operating income']],
    ['ar', ['ar', 'trade receivables', 'ลูกหนี้การค้า']],
    ['inv', ['inventory', 'inventories', 'สินค้าคงเหลือ']],
    ['ap', ['ap', 'trade payable', 'trade payables', 'เจ้าหนี้การค้า']],
  ];
  // Enough of the set to be worth importing at all.
  const REQUIRED = ['revenue', 'cogs', 'ar', 'inv', 'ap'];

  /* Does this header cell name a reporting period? Covers the shapes these
     packs use: a bare year and Q1-26 / Q1'26 / Q1/2569. Anything else in
     the header row (a units column, a KPI column, a working column) is
     left out of the series. */
  function periodLabel(cell) {
    if (cell == null || cell === '') return null;
    if (typeof cell === 'number') {
      return (Number.isInteger(cell) && cell >= 1990 && cell <= 2100) ? String(cell) : null;
    }
    if (cell instanceof Date) return null;            // a monthly column, not a reporting period
    const s = String(cell).trim();
    if (!s) return null;
    if (/^(fy\s*)?(19|20)\d{2}$/i.test(s)) return s;
    if (/q\s*[1-4]\s*['\-/]?\s*\d{2,4}/i.test(s)) return s;
    if (/ไตรมาส|งบปี/.test(s)) return s;
    return null;
  }

  /* How many months of profit and loss a column carries. These packs state
     each quarter on its own (the year column equals the sum of its four
     quarters), unlike a trial balance where the figures accumulate — so a
     quarter column is 3 months and a year column is 12. */
  function monthsFor(label) {
    return /q\s*[1-4]|ไตรมาส/i.test(String(label)) ? 3 : 12;
  }

  const isNum = v => typeof v === 'number' && isFinite(v);

  /* Read one sheet (2-D matrix). Returns null when it carries no such
     block — the caller sweeps a whole workbook and keeps the best. */
  function parseFsSheet(matrix) {
    if (!matrix || !matrix.length) return null;

    // Which row holds which figure. A workbook may state the same figure in
    // more than one block (a stale one above, the live one below); the last
    // match wins, and empty columns in it simply read as gaps.
    const found = {};
    for (let r = 0; r < matrix.length; r++) {
      const cells = matrix[r] || [];
      let li = -1;
      for (let c = 0; c < cells.length; c++) {
        if (cells[c] != null && String(cells[c]).trim() !== '') { li = c; break; }
      }
      if (li === -1 || isNum(cells[li])) continue;
      const label = norm(cells[li]);
      const hit = ROWS.find(([, names]) => names.includes(label));
      if (!hit) continue;
      if (!cells.some(isNum)) continue;
      found[hit[0]] = r;
    }
    if (!REQUIRED.every(k => found[k] != null)) return null;

    // The period header. A sheet can have several (one per block) and they
    // don't always span the same columns, so score each by how much of the
    // data it actually covers and keep the best.
    const dataRows = Object.values(found);
    let best = null;
    for (let r = 0; r < matrix.length; r++) {
      const cells = matrix[r] || [];
      const cols = [];
      for (let i = 0; i < cells.length; i++) {
        const label = periodLabel(cells[i]);
        if (label != null) cols.push({ i, label });
      }
      if (cols.length < 2) continue;
      const live = cols.filter(c => dataRows.some(dr => isNum((matrix[dr] || [])[c.i])));
      if (!best || live.length > best.length) best = live;
    }
    if (!best || best.length < 2) return null;

    const series = { labels: best.map(c => c.label), months: best.map(c => monthsFor(c.label)) };
    for (const [key, r] of Object.entries(found)) {
      series[key] = best.map(c => {
        const v = (matrix[r] || [])[c.i];
        return isNum(v) ? v : null;
      });
    }
    // A period is only usable when every required figure is present.
    const keep = series.labels.map((_, i) => REQUIRED.every(k => series[k][i] != null && series[k][i] !== 0));

    /* Drop a column that repeats another's figures under a different name.
       These packs park the year-to-date total in the Q4 column as well as
       in the year column, so the two are identical — but a quarter label
       would have this read 12 months of revenue as 3 and put the cash cycle
       out by a factor of four. The later column wins, because that is the
       one whose label matches what the numbers actually are. */
    const seen = new Map();
    series.labels.forEach((_, i) => {
      if (!keep[i]) return;
      const sig = REQUIRED.map(k => series[k][i]).join('|');
      if (seen.has(sig)) keep[seen.get(sig)] = false;
      seen.set(sig, i);
    });

    const dropped = keep.filter(k => !k).length;
    if (!keep.some(Boolean)) return null;
    for (const key of Object.keys(series)) series[key] = series[key].filter((_, i) => keep[i]);
    series.dropped = dropped;
    return series;
  }

  /* Sweep a whole workbook: [{name, matrix}] -> {sheet, series} or null.
     Keeps the sheet whose block covers the most periods, so a pack with a
     stale copy of the same block still imports the live one. */
  function parseFsWorkbook(sheets) {
    let best = null;
    for (const sh of sheets) {
      const series = parseFsSheet(sh.matrix);
      if (!series) continue;
      if (!best || series.labels.length > best.series.labels.length) best = { sheet: sh.name, series };
    }
    return best;
  }

  const FsHistory = { parseFsSheet, parseFsWorkbook, periodLabel, monthsFor, ROWS, REQUIRED };
  global.FsHistory = FsHistory;
  if (typeof module !== 'undefined') module.exports = FsHistory;
})(typeof window !== 'undefined' ? window : globalThis);
