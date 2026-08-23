/* Anomaly detection over a close — the checks a reviewer would run by eye,
   run every time the Review page opens.

   The existing closing gates answer "is this arithmetically complete?" —
   does the trial balance sum to zero, is every code mapped, does the balance
   sheet tie. All necessary, none of them able to say that a number is
   WRONG. A balanced trial balance with revenue booked one month twice, or a
   bank account sitting in credit, or receivables that doubled overnight, is
   still balanced.

   So these checks look at the numbers themselves, and at the same numbers a
   month earlier. Each one names the figure it objected to and where to go
   and look, because a warning nobody can act on is worse than no warning.

   Two principles the thresholds follow:

   - Materiality scales with the company. Every limit here is a fraction of
     total assets, not a baht figure, so the same rule works on a 18-billion
     consolidation and on one subsidiary.
   - A rule that fires on a normal close is worse than useless, because the
     one that matters then sits in a list nobody reads. Where the accounting
     legitimately produces a "wrong-looking" number — contra accounts,
     contra-revenue groups netted inside revenue — the check is narrowed
     rather than left to be dismissed by hand.

   Globals: Store, FS, RULEBOOK, applyRulebook (group-engine), RatioEngine,
   CashFlowEngine (optional — the cash-flow check is skipped without it). */
(function (global) {
  const HIGH = 'high', MED = 'medium', LOW = 'low';
  const M = n => (n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'M';
  const B = n => Math.round(n).toLocaleString('en-US');
  const pct = n => (n * 100).toFixed(1) + '%';

  // Groups whose whole job is to carry a credit inside an asset section (or
  // the reverse). Their sign is correct when it looks wrong.
  const CONTRA = /allowance|provision|ค่าเผื่อ|สำรอง|acc\.? ?depn|accumulat|depreciation|amorti|ตัดจำหน่าย|ค่าเสื่อม/i;
  // Cash and bank, where a credit balance is never right — it is an
  // overdraft and belongs on the other side. The company's own workpaper
  // reclassifies exactly this every month (SYN ADJ/RJE#6).
  const CASH_GROUPS = /^cash (in hand|at bank)/i;

  const isCash = group => CASH_GROUPS.test(String(group || ''));
  // Accounts whose whole purpose is to appear for one close and go: cut-off,
  // adjustment and suspense lines. They come and go every month by design,
  // so their appearing or vanishing is noted, not warned about.
  const TEMPORARY = /cut ?off|adjust|suspense|clearing|ปรับปรุง|พักรายการ/i;

  /* Which period to compare against: the month before this one when it is
     archived, else the newest archived period that isn't this one. Returns
     null when there is nothing to compare with — every period-over-period
     check then reports itself as skipped rather than silently passing. */
  function priorKeyOf(pk) {
    const R = global.RatioEngine;
    const archived = Store.listPeriods().map(p => p.key).sort();
    if (pk && R && R.monthsFromKey(pk)) {
      const prev = R.shiftMonthKey(pk, -1);
      if (archived.includes(prev)) return prev;
      // Only ever compare backwards. The newest archived period is the right
      // fallback for the live close and nonsense for an old one — Dec 2024
      // measured against Jun 2026 flags the eighteen months in between as
      // this month's movement.
      const earlier = archived.filter(k => k < pk);
      return earlier.length ? earlier[earlier.length - 1] : null;
    }
    const others = archived.filter(k => k !== pk);
    return others.length ? others[others.length - 1] : null;
  }

  const groupsOf = bs => []
    .concat(...bs.assets.map(s => s.groups.map(g => ({ section: s.name, side: 'asset', ...g }))))
    .concat(...bs.liab.map(s => s.groups.map(g => ({ section: s.name, side: 'liab', ...g }))))
    .concat(...bs.equity.map(s => s.groups.map(g => ({ section: s.name, side: 'equity', ...g }))));

  function scan(pk) {
    const F = [];
    const add = (severity, id, title, detail, extra) => F.push(Object.assign({ severity, id, title, detail }, extra || {}));
    const skipped = [];

    const rows = Store.finalRows(pk);
    if (!rows.length) return { findings: [], skipped: ['ยังไม่ได้นำเข้างบทดลอง'], checks: 0, materiality: 0 };
    const g = FS.grouped(null, pk);
    const bs = FS.buildBS(g), pl = FS.buildPL(g);
    // 0.2% of total assets. Small enough to catch a real error, large enough
    // that rounding and genuine small movements stay quiet.
    const mat = Math.max(1e6, Math.abs(bs.totalAssets) * 0.002);
    const entities = Store.entitiesLoaded(pk);
    const priorKey = priorKeyOf(pk);
    const R = global.RatioEngine;

    // ---- 1. the balance sheet itself
    if (Math.abs(bs.diff) > 1) {
      add(HIGH, 'bs-diff', 'งบดุลไม่สมดุล',
        `สินทรัพย์ ${B(bs.totalAssets)} ≠ หนี้สิน+ทุน ${B(bs.totalLE)} · ผลต่าง ${B(bs.diff)} บาท`,
        { where: { href: 'consolidation.html', label: 'ดูงบรวม' } });
    }

    // ---- 2. each company's own trial balance
    const off = entities.map(e => ({ e, net: Store.tb(e, pk).rows.reduce((t, r) => t + r.closing, 0) })).filter(x => Math.abs(x.net) > 5);
    if (off.length) {
      add(HIGH, 'tb-unbalanced', 'งบทดลองรายบริษัทไม่สมดุล',
        off.map(x => `${x.e}: เดบิต−เครดิต = ${B(x.net)}`).join(' · '),
        { where: { href: 'tb.html', label: 'ดู Trial Balance' } });
    }

    // ---- 3. accounts the rulebook has never seen
    const res = applyRulebook(rows, RULEBOOK, Store.mappings());
    const unmappedBig = res.unmapped
      .map(code => ({ code, closing: (rows.find(r => r.code === code) || {}).closing || 0 }))
      .filter(x => Math.abs(x.closing) > 0)
      .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
    // Only when a balance is actually falling outside the statements. An
    // unmapped code carrying zero changes nothing, and the closing gates
    // below already count them — repeating it here every single month is how
    // this list gets ignored.
    if (unmappedBig.length) {
      add(unmappedBig.some(x => Math.abs(x.closing) > mat) ? HIGH : MED, 'unmapped',
        `มีรหัสบัญชีที่ยังไม่ได้จัดกลุ่มและมียอด ${unmappedBig.length} รหัส`,
        `ยอดที่ยังไม่เข้างบ: ${unmappedBig.slice(0, 5).map(x => `${x.code} (${M(x.closing)})`).join(' · ')}${unmappedBig.length > 5 ? ` และอีก ${unmappedBig.length - 5} รหัส` : ''}`,
        { where: { href: 'mapping.html', label: 'ไปจับคู่' } });
    }

    // ---- 4. journal entries that don't balance on their own
    const bad = Store.enabledJournals(pk).filter(j => Math.abs(j.net) > 1);
    if (bad.length) {
      // Split by source and check whether that source's odd entries cancel
      // out. A pair like Elimiate#2 (-8,084,637) and Elimiate#22 (+8,084,637)
      // is one entry written in two halves — normal practice, and reporting
      // it as an error every month is how a checklist stops being read.
      const bySource = {};
      for (const j of bad) (bySource[j.source || ''] = bySource[j.source || ''] || []).push(j);
      const offsetting = [], real = [];
      for (const [src, list] of Object.entries(bySource)) {
        const net = list.reduce((t, j) => t + j.net, 0);
        (Math.abs(net) <= 1 ? offsetting : real).push({ src, list, net });
      }
      const refs = list => list.map(j => `${String(j.id).split('::').pop()} (${B(j.net)})`).join(' · ');
      for (const x of real) {
        add(Math.abs(x.net) > mat ? HIGH : MED, 'journal-net',
          `${x.src || 'รายการปรับปรุง'}: เดบิตไม่เท่าเครดิต รวม ${B(x.net)} บาท`,
          `${x.list.length} รายการที่ยอดไม่เป็นศูนย์ และหักล้างกันไม่หมด — ${refs(x.list.slice(0, 6))}`,
          { where: { href: 'journals.html', label: 'ดู Journals' } });
      }
      if (offsetting.length) {
        add(LOW, 'journal-net-offset',
          `มีรายการที่เขียนแยกเป็นสองขา ${offsetting.reduce((t, x) => t + x.list.length, 0)} รายการ`,
          offsetting.map(x => `${x.src}: ${refs(x.list.slice(0, 4))}`).join(' · ')
            + ' — ยอดในชุดเดียวกันหักล้างกันครบ ถือว่าปกติ',
          { where: { href: 'journals.html', label: 'ดู Journals' } });
      }
    }

    // ---- 5. cash and bank in credit
    const cashNeg = rows
      .map(r => ({ r, rule: (Store.mappings()[r.code] || RULEBOOK.rules[r.code]) }))
      .filter(x => x.rule && isCash(x.rule.group) && x.r.closing < -1)
      .sort((a, b) => a.r.closing - b.r.closing);
    if (cashNeg.length) {
      add(cashNeg.some(x => Math.abs(x.r.closing) > mat) ? MED : LOW, 'cash-credit',
        `บัญชีเงินสด/เงินฝาก ${cashNeg.length} บัญชีมียอดติดลบ`,
        cashNeg.slice(0, 5).map(x => `${x.r.code} ${x.r.name} = ${B(x.r.closing)}`).join(' · ')
          + ' — ยอดติดลบของบัญชีธนาคารคือเงินเบิกเกินบัญชี ควรจัดประเภทไปฝั่งหนี้สิน (RJE)',
        { where: { href: 'journals.html', label: 'ตั้งรายการจัดประเภท' } });
    }

    // ---- 6. a group sitting on the wrong side
    // Balance sheet only: the revenue section legitimately carries
    // contra-revenue groups (cash discount paid, agent revenue) that are
    // negative by design, so a sign rule there would fire every month.
    const wrongSide = groupsOf(bs).filter(x => !CONTRA.test(x.group) && x.value < -mat);
    if (wrongSide.length) {
      add(MED, 'wrong-side', `มี ${wrongSide.length} กลุ่มบัญชีที่ยอดอยู่ผิดด้าน`,
        wrongSide.slice(0, 6).map(x => `${x.section} › ${x.group} = ${M(x.value)}`).join(' · ')
          + ' — ยอดติดลบในกลุ่มที่ไม่ใช่ค่าเผื่อ/สำรอง มักหมายถึงบัญชีถูกจัดกลุ่มผิดด้าน',
        { where: { href: 'statements.html', label: 'ดูงบการเงิน' } });
    }

    // ---- 7. cumulative profit and loss going backwards
    // A trial balance states the P&L from the start of the fiscal year, so
    // revenue and cost can only rise from month to month. A fall means the
    // wrong file, the wrong period, or a reversal worth explaining.
    if (priorKey && R && R.monthsFromKey(pk) && R.monthsFromKey(priorKey) && R.monthsFromKey(pk) > R.monthsFromKey(priorKey)) {
      const prevPl = R.plAt(priorKey);
      if (prevPl) {
        const drops = [
          ['รายได้', pl.revenue, prevPl.revenue],
          ['ต้นทุนขาย', Math.abs(pl.cogs), Math.abs(prevPl.cogs)],
        ].filter(([, now, before]) => before - now > mat);
        if (drops.length) {
          add(HIGH, 'ytd-backwards', 'ยอดสะสมตั้งแต่ต้นปีลดลงจากงวดก่อน',
            drops.map(([label, now, before]) => `${label}: ${M(before)} (${priorKey}) → ${M(now)} ลดลง ${M(before - now)}`).join(' · ')
              + ' — งบทดลองสะสมจากต้นปีบัญชี ยอดจึงไม่ควรลดลง ตรวจว่านำเข้าไฟล์ถูกงวดหรือมีการกลับรายการ',
            { where: { href: 'import.html', label: 'ตรวจไฟล์ที่นำเข้า' } });
        }
      }
    } else if (!priorKey) {
      skipped.push('การเทียบกับงวดก่อนหน้า (ยังไม่มีงวดอื่นที่บันทึกไว้)');
    }

    // ---- 8-10. what moved, what vanished, what appeared
    if (priorKey) {
      /* January restarts the cumulative profit and loss, so every P&L account
         "falls" by a year's worth against December. That is the convention
         working, not a movement — so when the comparison crosses the fiscal
         year, only balance-sheet accounts are compared. */
      const sameYear = !(R && R.monthsFromKey(pk) === 1);
      const ruleOf = code => Store.mappings()[code] || RULEBOOK.rules[code] || null;
      const inScope = code => { if (sameYear) return true; const ru = ruleOf(code); return !ru || ru.statement !== 'PL'; };
      const prev = new Map(Store.finalRows(priorKey).filter(r => inScope(r.code)).map(r => [r.code, r.closing]));
      const now = new Map(rows.filter(r => inScope(r.code)).map(r => [r.code, r.closing]));
      const priorRows = Store.finalRows(priorKey);
      const nameOf = code => {
        const hit = rows.find(r => r.code === code) || priorRows.find(r => r.code === code);
        return hit && hit.name && hit.name !== code ? hit.name : '';
      };
      if (!sameYear) skipped.push('การเทียบบัญชีกำไรขาดทุนกับเดือนก่อน (ข้ามปีบัญชี ยอดสะสมเริ่มนับใหม่)');

      const gone = [...prev.entries()].filter(([code, v]) => Math.abs(v) > mat && Math.abs(now.get(code) || 0) < 1);
      const goneReal = gone.filter(([code]) => !TEMPORARY.test(nameOf(code)));
      if (gone.length) {
        add(goneReal.length ? MED : LOW, 'account-gone', `${gone.length} บัญชีที่มียอดในงวดก่อน หายไปในงวดนี้`,
          gone.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([code, v]) => `${code} ${nameOf(code)} (${M(v)} ในงวด ${priorKey})`).join(' · ')
            + (goneReal.length ? '' : ' — ทั้งหมดเป็นบัญชีพักรายการ/ปรับปรุง ซึ่งมีแล้วหายเป็นปกติ'),
          { where: { href: 'tb.html', label: 'ดู Trial Balance' } });
      }
      const fresh = [...now.entries()].filter(([code, v]) => Math.abs(v) > mat && !prev.has(code));
      if (fresh.length) {
        add(LOW, 'account-new', `${fresh.length} บัญชีใหม่ที่ไม่มีในงวดก่อน`,
          fresh.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([code, v]) => `${code} ${nameOf(code)} = ${M(v)}`).join(' · '),
          { where: { href: 'tb.html', label: 'ดู Trial Balance' } });
      }
      // Movements big in BOTH senses: a fifth of the balance and material.
      // Both the change and the base have to be material, or the percentage
      // is arithmetic on noise: 0.1M -> 377M is a 400,000% "increase" and
      // tells the reader nothing that "appeared" doesn't already say.
      // Balance sheet only. A profit-and-loss account states the year to
      // date, so February against January doubles it and December against
      // November is up a twelfth — every P&L line would be "a big move"
      // every month, which says nothing. Their movement is judged by the
      // ratio and cash-cycle checks instead.
      const isBS = code => { const ru = ruleOf(code); return ru && ru.statement !== 'PL'; };
      const movers = [...now.entries()]
        .filter(([code]) => isBS(code))
        .map(([code, v]) => ({ code, now: v, before: prev.get(code), delta: v - (prev.get(code) || 0) }))
        .filter(x => x.before != null && Math.abs(x.before) > mat && Math.abs(x.delta) > mat && Math.abs(x.delta) > Math.abs(x.before) * 0.5)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      if (movers.length) {
        add(LOW, 'big-move', `${movers.length} บัญชีเปลี่ยนแปลงเกินครึ่งหนึ่งของยอดเดิม และเกิน ${M(mat)}`,
          movers.slice(0, 5).map(x => `${x.code} ${nameOf(x.code)}: ${M(x.before)} → ${M(x.now)} (${pct(x.delta / Math.abs(x.before))})`).join(' · ')
            + ' — ไม่ได้ผิดเสมอไป แต่ควรอธิบายได้',
          { where: { href: 'tb.html', label: 'ดู Trial Balance' } });
      }
    }

    // ---- 11. bank covenants
    const equity = bs.totalEquity + bs.netProfit;
    const sec = n => { const s = bs.assets.concat(bs.liab).find(x => x.name === n); return s ? s.total : 0; };
    const CA = sec('Current Assets'), CL = sec('Current Liabilities');
    const de = equity ? bs.totalLiab / equity : null;
    const cr = CL ? CA / CL : null;
    const breaches = [];
    if (de != null && de > 3) breaches.push(`D/E = ${de.toFixed(2)} (เงื่อนไข ttb ≤ 3)`);
    if (cr != null && cr < 1.1) breaches.push(`Current ratio = ${cr.toFixed(2)} (เงื่อนไข ttb ≥ 1.1)`);
    if (breaches.length) {
      add(HIGH, 'covenant', 'อัตราส่วนหลุดเงื่อนไขเงินกู้ (bank covenant)', breaches.join(' · '),
        { where: { href: 'ratios.html', label: 'ดู Ratios' } });
    }

    // ---- 12. cash cycle outside its own history
    if (R && R.RATIO_SPEC) {
      const keys = Store.listPeriods().map(p => p.key).filter(k => R.monthsFromKey(k)).sort().slice(-13);
      const series = {};
      for (const k of keys) {
        const kb = R.bsAt(k), kp = R.plAt(k);
        if (!kb || !kp) continue;
        const m = R.computeTabMetrics('th', kb, kp, null, R.ctxFor(k, R.monthsFromKey(k)));
        for (const key of ['arDays', 'invDays', 'apDays']) {
          const v = (m[key] || {}).value;
          if (v != null) (series[key] = series[key] || []).push({ k, v });
        }
      }
      const LABEL = { arDays: 'AR Days', invDays: 'Inventory Days', apDays: 'AP Days' };
      const out = [];
      for (const [key, pts] of Object.entries(series)) {
        if (pts.length < 4) continue;
        const last = pts[pts.length - 1];
        if (pk && last.k !== pk) continue;                 // only judge the period being reviewed
        const past = pts.slice(0, -1).map(x => x.v).sort((a, b) => a - b);
        const median = past[Math.floor(past.length / 2)];
        if (!median) continue;
        const ratio = last.v / median;
        if (ratio > 1.4 || ratio < 0.6) out.push(`${LABEL[key]} = ${last.v.toFixed(1)} วัน เทียบค่ากลาง ${past.length} งวดก่อน ${median.toFixed(1)} วัน (${pct(ratio - 1)})`);
      }
      if (out.length) {
        add(MED, 'cycle-outlier', 'วงจรเงินสดต่างจากช่วงปกติของบริษัทเอง', out.join(' · '),
          { where: { href: 'ratios.html', label: 'ดู Ratios' } });
      }
      if (!Object.keys(series).length) skipped.push('การเทียบวงจรเงินสดกับค่ากลางย้อนหลัง (ต้องมีงวดรหัส YYYY-MM หลายงวด)');
    }

    // ---- 13. what the cash flow couldn't explain
    const openingRows = Store.openingRows(pk);
    if (openingRows && global.CashFlowEngine) {
      const og = FS.grouped(openingRows);
      const cf = CashFlowEngine.computeCashFlow(bs, pl, FS.buildBS(og), FS.buildPL(og));
      if (Math.abs(cf.unexplained) > mat) {
        const big = Math.abs(cf.unexplained) > Math.abs(bs.totalAssets) * 0.02;
        add(big ? MED : LOW, 'cf-unexplained', 'งบกระแสเงินสดยังกระทบยอดไม่ครบ',
          `ผลต่างที่ยังระบุไม่ได้ ${B(cf.unexplained)} บาท เทียบกับเงินสดที่เปลี่ยนแปลงสุทธิ ${B(cf.netIncrease)}`
            + ' — เป็นข้อจำกัดของการคำนวณแบบทางอ้อมจากยอดต้นงวด/ปลายงวด (ไม่ได้ไล่จากรายการจริง)'
            + ' ยังไม่ควรใช้เป็นงบกระแสเงินสดฉบับส่ง',
          { where: { href: 'cashflow.html', label: 'ดูงบกระแสเงินสด' } });
      }
    } else if (!openingRows) {
      skipped.push('งบกระแสเงินสด (ไฟล์ที่นำเข้าไม่มีคอลัมน์ยอดยกมา)');
    }

    // ---- 14. the same entry posted twice
    const seen = new Map(), dupes = [];
    for (const j of Store.enabledJournals(pk)) {
      const sig = (j.source || '') + '|' + j.lines.map(l => l.code + ':' + Math.round(l.amount)).sort().join(',');
      if (!j.lines.length) continue;
      const ref = String(j.id).split('::').pop();
      if (seen.has(sig)) dupes.push([seen.get(sig), ref, j.lines.reduce((t, l) => t + Math.abs(l.amount), 0) / 2, j.description || '']);
      else seen.set(sig, ref);
    }
    if (dupes.length) {
      add(MED, 'journal-dupe', `รายการปรับปรุงที่เหมือนกันทุกบรรทัด ${dupes.length} คู่`,
        dupes.slice(0, 5).map(([a, b, amt, desc]) => `${a} ≡ ${b} (${M(amt)})${desc ? ` — ${desc}` : ''}`).join(' · ') + ' — บรรทัดและจำนวนเงินเหมือนกันทุกบรรทัด อาจลงซ้ำ',
        { where: { href: 'journals.html', label: 'ดู Journals' } });
    }

    const order = { [HIGH]: 0, [MED]: 1, [LOW]: 2 };
    F.sort((a, b) => order[a.severity] - order[b.severity]);
    return {
      findings: F, skipped, materiality: mat, priorKey,
      checks: 14,
      counts: { high: F.filter(x => x.severity === HIGH).length, medium: F.filter(x => x.severity === MED).length, low: F.filter(x => x.severity === LOW).length },
    };
  }

  global.AnomalyEngine = { scan, HIGH, MED, LOW };
  if (typeof module !== 'undefined') module.exports = global.AnomalyEngine;
})(typeof window !== 'undefined' ? window : globalThis);
