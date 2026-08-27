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
  const fmt = (v, unit) => v == null ? '—' : (unit === 'x' ? v.toFixed(2) + '×' : unit === 'pct' ? v.toFixed(1) + '%' : unit === 'days' ? v.toFixed(1) + ' วัน' : unit === 'money' ? M(v) : v.toFixed(2));
  const M = n => (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'M';

  // Every formula lives in engine/ratio-engine.js so this page and the
  // Excel export compute the same numbers from the same code.
  const {
    monthsFromKey, shiftMonthKey, bsAt, unreachableGroups,
    RATIO_SPEC, computeTabMetrics, ctxFor,
  } = RatioEngine;


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
  /* Which points the trend series shows. 'month' is every saved period;
     'qy' keeps only the quarter-ends and labels them the way the company's
     own comparison charts do — Q1/Q2/Q3 for March/June/September, and the
     YEAR for December, since a December period's cumulative figures ARE the
     full year and a "Q4" column beside a "2025" one would be the same
     numbers twice. Fewer columns also brings back the value labels on the
     marks, which are dropped past thirteen of them. */
  // Quarter-ends by default: nineteen monthly columns is more than the panel
  // can label, and the company's own comparison charts are quarterly anyway.
  // "รายเดือน" is one click away for anyone who wants every point.
  let trendGroup = 'qy';
  function quarterLabel(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    const mo = +m[2], yy = m[1].slice(2);
    if (mo === 12) return m[1];
    return mo === 3 ? `Q1-${yy}` : mo === 6 ? `Q2-${yy}` : mo === 9 ? `Q3-${yy}` : null;
  }

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
    // Saved periods exist but none is a plain month — a period key can carry
    // a suffix (a cost-centre import lands on "2026-03-cc" so it can't
    // disturb the month the statements are built from), and every month
    // calculation on this page reads a bare "YYYY-MM". With nothing else
    // saved there is no quarter to resolve, so this reads as the pre-archive
    // state rather than asking for a period called "null-03".
    if (!year) return { archived: false };
    const key = `${year}-${QUARTER_END_MONTH[periodSel]}`;
    return { archived: true, year, key, period: Store.getPeriod(key) };
  }



  /* The badge exists for one reason: SET annualizes ROA/ROE/Asset Turnover
     and the other two tabs don't, each per its own sourced formula. At Q2
     that lands SET at exactly twice the others, card beside card, which
     reads as a data error unless the card itself says which basis it is on.
     Only those three carry one; everything else passes no badge. */
  function card(rk, value, unit, formula, badge) {
    const b = badge ? `<span class="rk-badge">${esc(badge)}</span>` : '';
    return `<div class="ratio-card"><div class="rk">${rk}${b}</div><div class="rv">${fmt(value, unit)}</div><div class="rf">${formula}</div></div>`;
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
        : card(spec.label, e.value, spec.unit, e.formula, e.badge);
    }
    $(containerId).innerHTML = html;
  }

  // The one formula engine behind every card on every tab (and every point
  // in the trend charts below — same function, just called once per saved
  // Quarterly trend charts (Chart.js, already vendored for Cost Center) —
  // one registry keyed by canvas id so re-render() destroys/recreates
  // instead of stacking new chart instances on the same canvas.
  const charts = {};
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* Values on the marks, but selectively — the endpoint, the highest and the
     lowest. A number over every column is the anti-pattern this panel used to
     have: nineteen of them collide, so nobody reads any. The axis carries the
     rest, and the tooltip and the table under the charts carry all of it. */
  /* A number on every bar. That is a lot of ink at nineteen periods, so
     rather than dropping most of them (which leaves the reader guessing at
     the ones in between) the labels turn on their side once the columns get
     narrower than a horizontal number needs — every bar keeps its value and
     nothing overlaps. Haloed either way, since the dashed target rule can
     pass straight through where a label sits. */
  const valueLabels = {
    id: 'cycleValueLabels',
    afterDatasetsDraw(chart, _a, opts) {
      const { ctx, chartArea } = chart;
      const ds = chart.data.datasets[0];
      if (!ds || ds.noLabels) return;
      const meta = chart.getDatasetMeta(0);
      if (meta.hidden) return;
      const vals = ds.data.map((v, i) => ({ v, i })).filter(x => x.v != null);
      if (!vals.length) return;
      ctx.save();
      const size = opts.rotate ? 9.5 : 10.5;
      ctx.font = `650 ${size}px ` + cssVar('--sans');
      const slot = chartArea.width / Math.max(1, ds.data.length);
      const widest = Math.max(...vals.map(x => ctx.measureText(x.v.toFixed(0)).width));
      const rotate = opts.rotate && widest + 3 > slot;
      ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
      for (const { v, i } of vals) {
        const el = meta.data[i];
        if (!el) continue;
        const label = v.toFixed(0);
        ctx.save();
        if (rotate) {
          ctx.translate(el.x, el.y - 5);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        } else {
          ctx.translate(el.x, el.y - 6);
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        }
        ctx.strokeStyle = opts.halo;
        ctx.strokeText(label, 0, 0);
        ctx.fillStyle = opts.ink;
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    },
  };

  /* The target rule labelled where it is, rather than as a legend entry — it
     is a threshold, not a series, and the panel has only one series so there
     is no legend box to put it in. The label goes in the right-hand gutter
     (drawDaysChart reserves it) rather than inside the plot: at the rule's
     right end it landed on the newest column, which is the one mark nobody
     can afford to have a sticker over. */
  const targetLabel = {
    id: 'cycleTargetLabel',
    afterDatasetsDraw(chart, _a, opts) {
      if (opts.value == null || !isFinite(opts.value)) return;
      const y = chart.scales.y.getPixelForValue(opts.value);
      if (!isFinite(y)) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.font = '650 10px ' + cssVar('--sans');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = opts.color;
      ctx.fillText(`เป้า ${opts.value}`, chartArea.right + 5, y);
      ctx.restore();
    },
  };

  /* One panel, one measure, one axis: columns in DAYS with the target as a
     dashed rule in the same unit.

     It used to plot the balance as columns on a millions axis with the ratio
     as a line on a days axis opposite it — two scales whose alignment is
     arbitrary, so where the line crossed the columns meant nothing, and at
     nineteen periods the two label sets landed on top of each other. The
     balance the ratio was computed from is still one hover away and still a
     row in the table below; what the panel draws is the number the target is
     set against. */
  function drawDaysChart(canvasId, cfg) {
    const el = $(canvasId);
    if (!el) return;
    if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }
    if (!cfg.labels.length) return;
    const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line'), faint = cssVar('--faint');
    const halo = cssVar('--chart-halo'), warn = cssVar('--warn');
    const hasTarget = cfg.target != null && isFinite(cfg.target);
    const dense = cfg.labels.length > 10;
    // A point whose real formula couldn't be computed (the months it needs
    // aren't archived) is drawn washed out and says so in its tooltip. The
    // series would otherwise mix two methods with nothing to show where it
    // switches, and a step caused by the method would read as a step in the
    // business. Colour alone doesn't carry it — the tooltip and the note
    // under the charts both say which points these are.
    const approx = cfg.approx || [];
    const wash = /^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color + '59' : cfg.color;
    const datasets = [{
      type: 'bar', label: cfg.title, data: cfg.days,
      backgroundColor: cfg.days.map((_, i) => approx[i] ? wash : cfg.color),
      borderRadius: 4, borderSkipped: 'bottom',
      // Capped rather than filling the band, so the leftover is air and
      // neighbours are separated by the surface instead of a stroke.
      maxBarThickness: 24, categoryPercentage: .82, barPercentage: .84,
    }];
    if (hasTarget) {
      datasets.push({
        type: 'line', label: `เป้าหมาย ${cfg.target}`, data: cfg.labels.map(() => cfg.target),
        borderColor: warn, borderWidth: 1.5, borderDash: [5, 4],
        pointRadius: 0, pointHoverRadius: 0, noLabels: true, order: -1,
      });
    }
    charts[canvasId] = new Chart(el.getContext('2d'), {
      data: { labels: cfg.labels, datasets },
      plugins: [valueLabels, targetLabel],
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        // Right gutter: the target rule's own label lives out there, clear of
        // the newest column.
        // Room above the bars for the value labels — more when they stand on
        // end, which is how a dense series keeps one on every bar.
        layout: { padding: { top: dense ? 34 : 22, right: hasTarget ? 44 : 6 } },
        plugins: {
          cycleValueLabels: { ink, halo, rotate: dense },
          cycleTargetLabel: { value: hasTarget ? cfg.target : null, color: warn, halo },
          title: { display: true, text: cfg.title, color: ink, font: { size: 12.5, weight: '600' } },
          // Left-aligned and given its own clearance: right-aligned it landed
          // on the endpoint value label, which is always the rightmost mark.
          subtitle: { display: !!cfg.hint, text: cfg.hint || '', color: faint, font: { size: 10 }, align: 'start', padding: { top: 1, bottom: 8 } },
          // One series: the title names it, so a box with one swatch would
          // only restate the title. The target rule labels itself in place.
          legend: { display: false },
          tooltip: {
            // The target rule is drawn and labelled on the chart; repeating it
            // as a tooltip row above the number being read only pushes the
            // number down the list.
            filter: item => item.datasetIndex === 0,
            callbacks: {
              title: items => items[0].label,
              label: c => `${cfg.title}: ${c.raw == null ? '—' : c.raw.toFixed(1) + ' วัน'}`,
              // The balance the ratio came from, and (on the cash cycle) the
              // three day counts it adds up out of — off the plot, because
              // drawing them would put four measures back on one panel, but
              // one hover away rather than gone.
              afterBody: items => {
                const i = items[0].dataIndex, out = [];
                if (approx[i]) out.push('⚠ สูตรประมาณ (ยังไม่มีเดือนย้อนหลังครบ)');
                const v = cfg.balance && cfg.balance[i];
                if (v != null) out.push(`${cfg.balanceLabel}: ${M(v)}`);
                for (const part of cfg.parts || []) {
                  const d = part.data[i];
                  if (d != null) out.push(`${part.sign === -1 ? '−' : '+'} ${part.label}: ${d.toFixed(1)} วัน`);
                }
                return out;
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: muted, font: { size: 10.5 }, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } },
          y: {
            type: 'linear', position: 'left', beginAtZero: true,
            title: { display: true, text: 'วัน', color: muted, font: { size: 10 } },
            ticks: { color: muted, font: { size: 10 } },
            grid: { color: line },
          },
        },
      },
    });
  }

  function destroyAllCharts() {
    for (const id of Object.keys(charts)) { charts[id].destroy(); delete charts[id]; }
  }

  const BASIS_ROWS = [
    { key: 'arDays', label: 'ลูกหนี้การค้า' },
    { key: 'arVendorDays', label: 'ลูกหนี้เคลม vendor', only: 'tw' },
    { key: 'invDays', label: 'สินค้าคงเหลือ' },
    { key: 'apDays', label: 'เจ้าหนี้การค้า (สุทธิตามสูตร)' },
  ];

  function buildTrendTable(perPointMetrics, tabKey) {
    const rows = [];
    let lastGroup = null;
    for (const spec of RATIO_SPEC) {
      if (spec.only && spec.only !== tabKey) continue;
      if (spec.group !== lastGroup) { rows.push({ header: spec.group }); lastGroup = spec.group; }
      rows.push({ label: spec.label, unit: spec.unit, values: perPointMetrics.map(m => (m[tabKey][spec.key] || {}).value) });
    }
    // The balances the cycle ratios were computed FROM. The panels above draw
    // days only — one measure, one axis each — so the money that used to be a
    // second axis is a row here, per period, in full.
    rows.push({ header: 'ยอดที่ใช้คำนวณวงจรเงินสด (บาท)' });
    for (const b of BASIS_ROWS) {
      if (b.only && b.only !== tabKey) continue;
      rows.push({ label: b.label, unit: 'money', values: perPointMetrics.map(m => (m[tabKey][b.key] || {}).base) });
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

    /* What "the opening balance" means for anything this page averages.

       Two problems with reading the imported file's own opening column,
       both of which put the average on a different footing from the closing
       side it is averaged with:

       - it is built from the combining rows, BEFORE eliminations, while the
         closing position is after them, so intercompany balances inflate
         the opening side only;
       - it is the PRIOR MONTH, not the start of the period. Against a
         six-month flow that is a one-month average — nearly the ending
         balance, with none of the smoothing it claims.

       So when the period that actually starts this one is archived, that
       period's own final (post-elimination) balance sheet is used instead:
       same basis on both sides, and a real period average. The file's
       opening column stays as the fallback, and the note says which of the
       two is in play rather than calling both "ต้นงวด". */
    const openingBSOf = (key, months) => {
      const startKey = key && months ? shiftMonthKey(key, -months) : null;
      const fromPeriod = startKey ? bsAt(startKey) : null;
      if (fromPeriod) return { bs: fromPeriod, source: 'period', key: startKey };
      const rows = Store.openingRows(key);
      const g2 = rows ? FS.grouped(rows) : null;
      return g2 ? { bs: FS.buildBS(g2), source: 'file' } : { bs: null };
    };
    const avgNoteFor = (o, months) => o.source === 'period'
      ? `ยอดเฉลี่ยต้นงวด+ปลายงวด — ต้นงวดใช้งบที่บันทึกไว้ของงวด ${esc(o.key)} (หลังตัดรายการระหว่างกัน ฐานเดียวกับยอดปลายงวด, ครอบคลุม ${months} เดือนพอดี): ${M(o.bs.totalAssets)}`
      : o.bs
        ? `⚠ ยอดเฉลี่ยใช้คอลัมน์ยอดยกมาในไฟล์ (${M(o.bs.totalAssets)}) ซึ่งเป็นยอด<b>สิ้นเดือนก่อนหน้า</b> และเป็นยอด<b>ก่อน</b>ตัดรายการระหว่างกัน คนละฐานกับยอดปลายงวด — บันทึกงวดต้นงวดไว้ด้วยจะได้ค่าเฉลี่ยที่ถูกต้อง`
        : '⚠ ไฟล์ที่นำเข้าไม่มีคอลัมน์ยอดยกมา (Opening balance) ใช้ยอดปลายงวดแทนค่าเฉลี่ย';

    let cards = null;
    if (q.archived) {
      if (q.period) {
        const prows = Store.finalRows(q.key);
        const pg = prows && prows.length ? FS.grouped(prows) : null;
        if (pg) {
          const periodMonths = monthsFromKey(q.key) || periodOpt().months;
          const opening = openingBSOf(q.key, periodMonths);
          const openingBS = opening.bs;
          cards = Object.assign({
            bs: FS.buildBS(pg), pl: FS.buildPL(pg), openingBS, avgNote: avgNoteFor(opening, periodMonths),
            periodLabel: `${periodOpt().label} · ${q.period.label}`,
          }, ctxFor(q.key, periodMonths));
        }
      }
    } else if (liveG) {
      // No period key for the live TB, so there is no archived start to
      // read — the file's own opening column is all there is.
      const opening = openingBSOf();
      cards = { bs: liveBs, pl: livePl, openingBS: opening.bs, avgNote: avgNoteFor(opening, periodOpt().months), periodMonths: periodOpt().months, periodLabel: periodOpt().label };
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
      const missingGroups = unreachableGroups();
      const warn = missingGroups.length
        ? `<div class="check no" style="margin-bottom:14px"><div class="ico">!</div><div><div class="t">มีกลุ่มบัญชีที่หน้านี้ใช้คำนวณแต่ไม่มีอยู่ในผังบัญชี</div>
          <div class="d">อัตราส่วนที่อ้างถึงกลุ่มเหล่านี้จะนับเป็น 0 โดยไม่มีการเตือนในการ์ด — ไปเปลี่ยนชื่อกลุ่มให้ตรงหรือ map บัญชีเข้ากลุ่มนี้ที่หน้า <a class="linkish" href="mapping.html">Mapping</a>: <b>${esc(missingGroups.join(' · '))}</b></div></div></div>`
        : '';
      $('banner').innerHTML = warn + `<div class="check ok" style="margin-bottom:14px"><div class="ico">✓</div><div><div class="t">${q.archived ? `คำนวณจากงวดที่บันทึกไว้ <b>${esc(q.period.label)}</b>` : 'คำนวณจากงบที่โรลอัปสด'}</div>
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
    let groupedOut = 0;
    for (const p of saved) {
      // In quarter mode a period that isn't a quarter-end is left out, as is
      // one whose key can't be read as a month at all — counted so the note
      // below can say how many the view is hiding.
      const qLabel = trendGroup === 'qy' ? quarterLabel(p.key) : null;
      if (trendGroup === 'qy' && !qLabel) { groupedOut++; continue; }
      const prows = Store.finalRows(p.key);
      const pg = prows && prows.length ? FS.grouped(prows) : null;
      if (!pg) continue;
      const pMonths = monthsFromKey(p.key);
      trendList.push({ key: p.key, label: qLabel || p.label, bs: FS.buildBS(pg), pl: FS.buildPL(pg), months: pMonths, monthsGuessed: pMonths == null });
    }
    // "ปัจจุบัน" is always the live TB specifically (not whichever period the
    // top cards above resolved to) — omitted outright when there's no live
    // TB at all, rather than duplicating one of the saved points under a
    // confusing second label.
    if (liveG) trendList.push({ key: null, label: 'ปัจจุบัน', bs: liveBs, pl: livePl, months: periodOpt().months, monthsGuessed: false });
    const trendLabels = trendList.map(p => p.label);
    /* Every point runs the same real formulas the cards do, resolved from
       the periods around THAT point — trailing-12-month revenue and cost of
       sales, Synnex KPI's year-ago average, Taiwan's four-month opening-and-
       closing average. The series used to hand computeTabMetrics nothing but
       the point's own file, so every point took the fallback (that file's
       cumulative flow scaled up by its month count) and the chart read a few
       days above the company's own sheet while the card above it read right.

       The helpers still return null the moment a month they need isn't
       archived, so a point with no history behind it keeps the fallback
       rather than a fabricated figure — `exact` records which is which so
       the note under the charts can say how many points are which. */
    const perPoint = trendList.map((pt, i) => {
      const prevBs = i > 0 ? trendList[i - 1].bs : null;
      const pm = pt.months || trendDefaultMonths;
      const pf = 12 / pm;
      const ctx = ctxFor(pt.key, pm, { periodLabel: pt.label });
      return {
        th: computeTabMetrics('th', pt.bs, pt.pl, null, ctx),
        tw: computeTabMetrics('tw', pt.bs, pt.pl, prevBs, ctx),
        set: computeTabMetrics('set', pt.bs, pt.pl, prevBs, Object.assign({ annualizeFactor: pf }, ctx)),
        exact: { th: !!(ctx.ttm && ctx.thAvg), tw: !!(ctx.twFlow && ctx.twAvg), set: !!ctx.ttm },
      };
    });

    function renderTrendTab(suffix, tabKey) {
      const hasEnough = trendList.length >= 2;
      $(`trendEmpty${suffix}`).style.display = hasEnough ? 'none' : '';
      $(`trendBody${suffix}`).style.display = hasEnough ? '' : 'none';
      const monthsNote = document.querySelector(`[data-panel="${tabKey}"] [data-trend-months-note]`);
      if (monthsNote) {
        const guessedLabels = trendList.filter(p => p.monthsGuessed && p.label !== 'ปัจจุบัน').map(p => p.label);
        const approx = perPoint.filter(m => !m.exact[tabKey]).length;
        // What each tab's real formula needs archived before a point can
        // stop approximating — worth naming, since the fix is to import
        // those months rather than anything on this page.
        const NEEDS = {
          th: 'สูตรจริงต้องมีงบ 12 เดือนก่อนหน้าติดกัน และงวดเดียวกันของปีก่อน',
          tw: 'สูตรจริงต้องมีงบ 4 เดือนติดกันจนถึงงวดนั้น (รวมเดือนก่อนไตรมาส)',
          set: 'สูตรจริงต้องมีงบ 12 เดือนก่อนหน้าติดกัน',
        };
        const parts = [];
        if (groupedOut) parts.push(`แสดงเฉพาะงวดสิ้นไตรมาส — ซ่อนไป <b>${groupedOut}</b> งวด (ธ.ค. แสดงเป็นทั้งปี เพราะงบสะสมถึง ธ.ค. คือ 12 เดือนอยู่แล้ว) กด <b>รายเดือน</b> เพื่อดูครบทุกงวด`);
        if (guessedLabels.length) parts.push(`⚠ งวด <b>${esc(guessedLabels.join(', '))}</b> ไม่ได้ตั้งรหัสงวดเป็น <code>YYYY-MM</code> (เช่น 2026-06) เดาจำนวนเดือนไม่ได้ จึงใช้ตัวคูณเดียวกับปุ่ม Q1–Q4 ด้านบนแทน — อาจคลาดเคลื่อนถ้างวดนั้นไม่ได้ครอบคลุมพอดีตามที่ปุ่มเลือกไว้`);
        if (approx) parts.push(`⚠ <b>${approx}</b> จาก <b>${perPoint.length}</b> จุด (แท่งสีจาง) ยังใช้สูตรประมาณ (ยอดสะสมของงวดนั้นปรับเป็นรายปี) เพราะยังไม่ได้บันทึกเดือนย้อนหลังที่ต้องใช้ — ${NEEDS[tabKey]} · จุดที่เหลือใช้สูตรจริงชุดเดียวกับการ์ดด้านบน`);
        else parts.push('✓ ทุกจุดในกราฟใช้สูตรจริงชุดเดียวกับการ์ดด้านบน');
        monthsNote.style.display = hasEnough ? '' : 'none';
        monthsNote.innerHTML = parts.join('<br>');
      }
      if (!hasEnough) {
        ['ArDays', 'ArVendorDays', 'InvDays', 'ApDays', 'Ccc'].forEach(c => { const id = `chart${c}${suffix}`; if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
        $(`trendTbl${suffix}`).innerHTML = '';
        return;
      }
      const table = buildTrendTable(perPoint, tabKey);
      renderTrendTable(`trendTbl${suffix}`, trendLabels, table);

      // Four panels, one measure each, all four in the same unit — small
      // multiples instead of one panel carrying every series. The balance the
      // ratio was computed from (`base`, which travels out of
      // computeTabMetrics for this) is in the hover and in the table below,
      // so it stays true to each tab's own formula (SET's AR includes other
      // receivable, Taiwan's is averaged) without needing a second axis.
      const days = key => perPoint.map(m => (m[tabKey][key] || {}).value);
      const bal = key => perPoint.map(m => (m[tabKey][key] || {}).base);
      const t = Store.cycleTargets();
      const sv = [cssVar('--sv1'), cssVar('--sv2'), cssVar('--sv3'), cssVar('--sv4'), cssVar('--sv5')];
      // One hue per measure, held across tabs and across re-renders: the AR
      // panel is blue on all three tabs whatever the period filter shows.
      const approxPts = perPoint.map(m => !m.exact[tabKey]);
      const panel = (id, title, key, target, hint, color, balanceLabel) =>
        drawDaysChart(`chart${id}${suffix}`, {
          title, hint, target, color, balanceLabel, approx: approxPts,
          labels: trendLabels, days: days(key), balance: bal(key),
        });
      panel('ArDays', 'AR Days', 'arDays', t.ar, 'ยิ่งน้อยยิ่งดี', sv[0], 'ลูกหนี้การค้า');
      // Taiwan only, and only Taiwan has a canvas for it: the vendor-claim
      // receivable is a real term of that tab's cash cycle, not a footnote to
      // AR, so it gets its own panel rather than sharing the AR one.
      if (tabKey === 'tw') panel('ArVendorDays', 'AR Vendor Days', 'arVendorDays', t.arVendor, 'ยิ่งน้อยยิ่งดี', sv[4], 'ลูกหนี้เคลม vendor');
      panel('InvDays', 'Inventory Days', 'invDays', t.inv, 'ยิ่งน้อยยิ่งดี', sv[1], 'สินค้าคงเหลือ');
      panel('ApDays', 'AP Days', 'apDays', t.ap, 'ยิ่งมากยิ่งดี', sv[2], 'เจ้าหนี้การค้า');
      // The cycle is the three above netted off; the three panels are the
      // breakdown, so this one draws the total only and lists the parts in
      // its hover.
      const parts = [
        { label: 'AR Days', data: days('arDays') },
        { label: 'Inventory Days', data: days('invDays') },
        { label: 'AP Days', data: days('apDays'), sign: -1 },
      ];
      if (tabKey === 'tw') parts.splice(1, 0, { label: 'AR Vendor Days', data: days('arVendorDays') });
      drawDaysChart(`chartCcc${suffix}`, {
        title: 'Cash Conversion Cycle', hint: 'ยิ่งน้อยยิ่งดี', target: t.ccc, color: sv[3],
        labels: trendLabels, days: days('ccc'), parts, approx: approxPts,
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
  // One shared setting across the three tabs, like the KRI boxes above.
  document.querySelectorAll('[data-trend-group] button').forEach(b => b.onclick = () => {
    trendGroup = b.dataset.group;
    document.querySelectorAll('[data-trend-group] button').forEach(x => x.classList.toggle('on', x.dataset.group === trendGroup));
    render();
  });

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
