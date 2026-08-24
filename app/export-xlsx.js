/* Excel export — the whole close as one workbook, shaped like the company's
   own Conso workpaper so an accountant can carry on in Excel.

   Why it mirrors that file rather than dumping tables: the people who read
   this already know where everything sits in SYNCONSO_WP. The sheet names,
   the column blocks (each company, then its own ADJ/RJE, then after-adj,
   then Total, Eliminate, Conso, audit AJE/RJE, Conso after) and the
   section → group → account hierarchy are all theirs. What changes is where
   the numbers come from: the app's own imported trial balances and journals
   instead of hand-linked formulas.

   Values are written as numbers, not strings, so the file is workable the
   moment it opens — no re-typing, no text-to-columns. Nothing is written as
   a formula: a formula would recompute against cells this file doesn't
   carry (the source workbook's other 30 sheets) and quietly disagree with
   the app.

   Globals: XLSX (vendor), Store, FS, RULEBOOK, applyRulebook (group-engine),
   RatioEngine, CashFlowEngine. */
(function (global) {
  const COMPANY = 'SYNNEX (THAILAND) PUBLIC CO., LTD. AND ITS SUBSIDARIES';
  const MONEY = '#,##0.00';

  // Section captions the workpaper prints above each block, in its words.
  const TH_SECTION = {
    'Current Assets': 'สินทรัพย์หมุนเวียน',
    'Non-current Assets': 'สินทรัพย์ไม่หมุนเวียน',
    'Current Liabilities': 'หนี้สินหมุนเวียน',
    'Non-current Liabilities': 'หนี้สินไม่หมุนเวียน',
    Equity: 'ส่วนของผู้ถือหุ้น',
    Revenue: 'รายได้จากการดำเนินงาน',
    'Cost of Sales': 'ต้นทุนจากการดำเนินงาน',
    'Operating Expenses': 'ค่าใช้จ่ายในการดำเนินงาน',
    'Other Income / Expense': 'รายได้ (ค่าใช้จ่าย) อื่น',
    'Finance Costs': 'ต้นทุนทางการเงิน',
    'Share of Profit': 'ส่วนแบ่งกำไรจากเงินลงทุน',
    'Income Tax': 'ภาษีเงินได้',
  };
  // Which way each section is printed. The workpaper shows liabilities,
  // equity, revenue and costs all as positive magnitudes and leaves contra
  // accounts negative inside their own section, so the sign is a property of
  // the section, not of the balance.
  const INCOME_SECTIONS = ['Revenue', 'Other Income / Expense', 'Share of Profit'];
  const signOf = section => (FS.LIAB.includes(section) || FS.EQUITY.includes(section) || INCOME_SECTIONS.includes(section)) ? -1 : 1;

  /* Which company an adjustment sheet belongs to. The workpaper puts each
     company's ADJ/RJE column immediately right of that company's own
     balance, so the export has to know that "AJE+RJE-Synnex" is SYN's.
     Audit and elimination entries belong to no single company and land in
     the consolidated block instead. */
  const ENTITY_ALIASES = { SYN: ['SYNNEX', 'SYN'], SVP: ['SVP', 'SERVICE POINT', 'SERVICEPOINT'], SYNIN: ['SYNIN', 'INCUBATION', 'SYNNEX INC'], SWOP: ['SWOP', 'SWOPMART'] };
  function entityOfSource(source, entities) {
    const s = String(source || '').toUpperCase();
    if (s.includes('AUDIT') || s.includes('ELIMI')) return null;
    // Longest alias first: "SYNNEX INC" must not be read as "SYNNEX".
    const hits = [];
    for (const ent of entities) for (const a of (ENTITY_ALIASES[ent] || [ent])) if (s.includes(a)) hits.push({ ent, len: a.length });
    hits.sort((x, y) => y.len - x.len);
    return hits.length ? hits[0].ent : null;
  }
  const isElimination = src => String(src || '').toUpperCase().includes('ELIMI');
  const entityName = code => { const e = RULEBOOK.entities.find(x => x.code === code); return e ? e.name : code; };

  /* The sheet title, spelled out. "AJE+RJE-Synnex" is clear to whoever
     works in the source workbook every month and opaque to everyone else
     who is handed the file — and this export exists precisely to be handed
     around. The tab keeps the short name so it still matches the workpaper. */
  const AJE_RJE = 'AJE (Adjusting Journal Entries — รายการปรับปรุง) + RJE (Reclassifying Journal Entries — รายการจัดประเภทใหม่)';
  function sourceTitle(src, entities) {
    if (isElimination(src)) return `${src} — รายการตัดรายการระหว่างกันในการจัดทำงบการเงินรวม (Consolidation Elimination Entries)`;
    const ent = entityOfSource(src, entities);
    return ent
      ? `${src} — ${AJE_RJE} ของ ${entityName(ent)} (${ent}) · ปรับที่ระดับบริษัท ก่อนรวมงบ`
      : `${src} — ${AJE_RJE} ระดับงบการเงินรวม จากผู้สอบบัญชี · ปรับหลังตัดรายการระหว่างกัน`;
  }

  const num = (v, z) => ({ v: typeof v === 'number' && isFinite(v) ? v : 0, t: 'n', z: z || MONEY });
  const txt = v => ({ v: v == null ? '' : String(v), t: 's' });
  const blank = () => null;

  /* Everything one period holds, keyed by account: each company's own
     balance, each journal source's net effect on that account (with the
     entry numbers that produced it, which is what the workpaper's little
     "Elimiate#24" reference column carries), and the rule that files the
     account under a statement, section and group. */
  function collect(pk) {
    const entities = RULEBOOK.entities.map(e => e.code).filter(c => Store.entitiesLoaded(pk).includes(c));
    const names = new Map(), byEnt = {}, bySrc = {};
    for (const ent of entities) {
      const m = byEnt[ent] = new Map();
      for (const r of Store.tb(ent, pk).rows) {
        m.set(r.code, (m.get(r.code) || 0) + r.closing);
        if (r.name) names.set(r.code, r.name);
      }
    }
    for (const j of Store.enabledJournals(pk)) {
      const src = j.source || 'Journal';
      const m = bySrc[src] = bySrc[src] || new Map();
      const ref = String(j.id).split('::').pop();
      for (const l of j.lines) {
        const cur = m.get(l.code) || { amount: 0, refs: [] };
        cur.amount += l.amount;
        if (!cur.refs.includes(ref)) cur.refs.push(ref);
        m.set(l.code, cur);
        if (l.name && !names.has(l.code)) names.set(l.code, l.name);
      }
    }
    const codes = new Set(names.keys());
    for (const m of Object.values(byEnt)) for (const c of m.keys()) codes.add(c);
    for (const m of Object.values(bySrc)) for (const c of m.keys()) codes.add(c);

    const res = applyRulebook([...codes].map(c => ({ code: c, name: names.get(c) || c, closing: 0 })), RULEBOOK, Store.mappings());
    const ruleOf = new Map(res.lines.map(l => [l.code, l.rule]));

    // Groups in the order the rulebook itself lists them, so two exports of
    // different months put the same line in the same place.
    const groupOrder = new Map();
    let n = 0;
    for (const r of Object.values(RULEBOOK.rules)) { const k = r.section + '||' + r.group; if (!groupOrder.has(k)) groupOrder.set(k, n++); }

    const rows = [...codes].map(code => ({
      code, name: names.get(code) || code, rule: ruleOf.get(code) || null,
      ent: Object.fromEntries(entities.map(e => [e, byEnt[e].get(code) || 0])),
      src: Object.fromEntries(Object.keys(bySrc).map(s => [s, bySrc[s].get(code) || null])),
    }));
    const sources = Object.keys(bySrc);
    return { entities, sources, rows, groupOrder, ruleOf, names };
  }

  /* One statement sheet in the workpaper's column layout. `kind` is 'BS' or
     'PL'; everything else — which sections, in what order, which way up —
     follows from FS, so the export can never show a section the app itself
     doesn't build. */
  function statementSheet(d, kind, meta) {
    const sections = kind === 'BS' ? FS.ASSET.concat(FS.LIAB, FS.EQUITY) : FS.PL_ORDER;
    const entSources = {}, consoSources = [], auditSources = [];
    for (const s of d.sources) {
      const ent = entityOfSource(s, d.entities);
      if (ent) (entSources[ent] = entSources[ent] || []).push(s);
      else if (isElimination(s)) consoSources.push(s);
      else auditSources.push(s);
    }

    // Header: a company's balance, then its own adjustments, then its
    // after-adjustment total; then the consolidation blocks.
    const head = ['', '', '', 'รหัสบัญชี', 'ชื่อบัญชี'];
    const cols = [];                                   // how to fill each numeric column
    for (const ent of d.entities) {
      head.push(ent); cols.push({ kind: 'ent', ent });
      for (const s of (entSources[ent] || [])) { head.push(s + ' (อ้างอิง)', s); cols.push({ kind: 'ref', src: s }, { kind: 'src', src: s }); }
      if (entSources[ent]) { head.push(ent + ' After Adj.'); cols.push({ kind: 'after', ent }); }
    }
    head.push('Total'); cols.push({ kind: 'total' });
    for (const s of consoSources) { head.push(s + ' (อ้างอิง)', s); cols.push({ kind: 'ref', src: s }, { kind: 'src', src: s }); }
    head.push('Conso'); cols.push({ kind: 'conso' });
    for (const s of auditSources) { head.push(s + ' (อ้างอิง)', s); cols.push({ kind: 'ref', src: s }, { kind: 'src', src: s }); }
    if (auditSources.length) { head.push('Conso after AJE+RJE'); cols.push({ kind: 'final' }); }

    // Per-row amounts for every numeric column, at the account level; the
    // group and section rows are the same columns summed.
    const amountsFor = row => {
      const out = {};
      let total = 0;
      for (const e of d.entities) { out['ent:' + e] = row.ent[e]; total += row.ent[e]; }
      for (const s of d.sources) out['src:' + s] = row.src[s] ? row.src[s].amount : 0;
      for (const e of d.entities) {
        out['after:' + e] = row.ent[e] + (entSources[e] || []).reduce((t, s) => t + out['src:' + s], 0);
      }
      out.total = total;
      out.conso = total + [].concat(...d.entities.map(e => entSources[e] || []), consoSources).reduce((t, s) => t + out['src:' + s], 0);
      out.final = out.conso + auditSources.reduce((t, s) => t + out['src:' + s], 0);
      return out;
    };
    const zero = () => { const o = {}; for (const e of d.entities) { o['ent:' + e] = 0; o['after:' + e] = 0; } for (const s of d.sources) o['src:' + s] = 0; o.total = 0; o.conso = 0; o.final = 0; return o; };
    const add = (acc, v) => { for (const k of Object.keys(acc)) acc[k] += v[k]; return acc; };

    const aoa = [
      [txt(COMPANY)],
      [txt(kind === 'BS' ? 'CONSOLIDATED BALANCE SHEET' : 'CONSOLIDATED STATEMENT OF PROFIT OR LOSS')],
      [txt(`YTD ended ${meta.periodLabel}`)],
      [txt('ส่งออกจาก FS Close Workspace · build ' + (global.APP_BUILD || '') + ' · ' + meta.generatedAt)],
      [],
      head.map(txt),
    ];
    const line = (labelCells, a, sign, z) => {
      const r = labelCells.map(c => (c == null ? blank() : txt(c)));
      while (r.length < 5) r.push(blank());
      for (const c of cols) {
        if (c.kind === 'ref') { r.push(c.refs ? txt(c.refs) : blank()); continue; }
        const key = c.kind === 'ent' ? 'ent:' + c.ent : c.kind === 'src' ? 'src:' + c.src : c.kind === 'after' ? 'after:' + c.ent : c.kind;
        r.push(num(sign * a[key], z));
      }
      return r;
    };

    const grand = zero();
    for (const sectionName of sections) {
      const inSection = d.rows.filter(r => r.rule && r.rule.section === sectionName);
      if (!inSection.length) continue;
      const sign = signOf(sectionName);
      aoa.push([txt(TH_SECTION[sectionName] || sectionName), txt(sectionName)]);
      const groups = [...new Set(inSection.map(r => r.rule.group))]
        .sort((a, b) => (d.groupOrder.get(sectionName + '||' + a) ?? 1e9) - (d.groupOrder.get(sectionName + '||' + b) ?? 1e9));
      const secTotal = zero();
      for (const group of groups) {
        const accounts = inSection.filter(r => r.rule.group === group).sort((a, b) => String(a.code).localeCompare(String(b.code)));
        const groupTotal = zero();
        const accRows = [];
        for (const r of accounts) {
          const a = amountsFor(r);
          add(groupTotal, a);
          const cells = [null, null, null, r.code, r.name];
          const rowCells = cells.map(c => (c == null ? blank() : txt(c)));
          for (const c of cols) {
            if (c.kind === 'ref') { const hit = r.src[c.src]; rowCells.push(hit && hit.refs.length ? txt(hit.refs.join(', ')) : blank()); continue; }
            const key = c.kind === 'ent' ? 'ent:' + c.ent : c.kind === 'src' ? 'src:' + c.src : c.kind === 'after' ? 'after:' + c.ent : c.kind;
            rowCells.push(num(sign * a[key]));
          }
          accRows.push(rowCells);
        }
        aoa.push(line([null, null, group], groupTotal, sign));
        accRows.forEach(r => aoa.push(r));
        add(secTotal, groupTotal);
      }
      aoa.push(line([`รวม${TH_SECTION[sectionName] || sectionName}`], secTotal, sign));
      aoa.push([]);
      add(grand, secTotal);
    }
    if (kind === 'BS') {
      // Assets against liabilities + equity + the period's own profit, which
      // is where a balance sheet built from a trial balance actually ties.
      const assets = zero(), le = zero();
      for (const r of d.rows) {
        if (!r.rule) continue;
        const a = amountsFor(r);
        if (FS.ASSET.includes(r.rule.section)) add(assets, a);
        else if (FS.LIAB.includes(r.rule.section) || FS.EQUITY.includes(r.rule.section)) add(le, a);
        else if (r.rule.statement === 'PL') { const p = amountsFor(r); for (const k of Object.keys(le)) le[k] += p[k]; }
      }
      aoa.push(line(['รวมสินทรัพย์'], assets, 1));
      aoa.push(line(['รวมหนี้สินและส่วนของผู้ถือหุ้น (รวมกำไรสำหรับงวด)'], le, -1));
      const diff = zero();
      for (const k of Object.keys(diff)) diff[k] = assets[k] + le[k];
      aoa.push(line(['ผลต่าง (ต้องเป็น 0)'], diff, 1));
    } else {
      const net = zero();
      for (const r of d.rows) { if (r.rule && r.rule.statement === 'PL') add(net, amountsFor(r)); }
      aoa.push(line(['กำไร (ขาดทุน) สำหรับงวด'], net, -1));
    }
    return aoa;
  }

  // A company's trial balance exactly as imported: the numbers every other
  // sheet is derived from, so a reviewer can trace one back.
  function tbSheet(ent, pk, meta) {
    const tb = Store.tb(ent, pk);
    const res = applyRulebook(tb.rows, RULEBOOK, Store.mappings());
    const rule = new Map(res.lines.map(l => [l.code, l.rule]));
    const aoa = [
      [txt(COMPANY)], [txt('TRIAL BALANCE — ' + ent)],
      [txt(`YTD ended ${meta.periodLabel}`)], [txt('ไฟล์ต้นทาง: ' + (tb.fileName || '—'))], [],
      ['รหัสบัญชี', 'ชื่อบัญชี', 'ยอดยกมา', 'ยอดคงเหลือ', 'Statement', 'Section', 'Group'].map(txt),
    ];
    let sumO = 0, sumC = 0;
    for (const r of tb.rows.slice().sort((a, b) => String(a.code).localeCompare(String(b.code)))) {
      const ru = rule.get(r.code);
      sumO += r.opening || 0; sumC += r.closing || 0;
      aoa.push([txt(r.code), txt(r.name), r.opening == null ? blank() : num(r.opening), num(r.closing),
        txt(ru ? ru.statement : ''), txt(ru ? ru.section : ''), txt(ru ? ru.group : 'UNMAPPED')]);
    }
    aoa.push([txt('รวม'), blank(), num(sumO), num(sumC)]);
    return aoa;
  }

  // One sheet per journal source, laid out entry by entry the way the
  // workpaper's own Eliminate / AJE+RJE sheets read.
  function journalSheet(src, pk, meta, entities) {
    const js = Store.journals(pk).filter(j => (j.source || 'Journal') === src);
    const aoa = [
      [txt(COMPANY)], [txt(sourceTitle(src, entities))], [txt(`YTD ended ${meta.periodLabel}`)], [],
      ['เลขที่', 'คำอธิบาย', 'รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต', 'สุทธิ', 'ใช้งาน'].map(txt),
    ];
    for (const j of js) {
      const ref = String(j.id).split('::').pop();
      for (const l of j.lines) {
        aoa.push([txt(ref), txt(j.description), txt(l.code), txt(l.name),
          l.amount > 0 ? num(l.amount) : blank(), l.amount < 0 ? num(-l.amount) : blank(),
          num(l.amount), txt(j.enabled === false ? 'ปิด' : 'เปิด')]);
      }
      aoa.push([blank(), txt('รวมรายการ ' + ref), blank(), blank(), blank(), blank(), num(j.net)]);
    }
    return aoa;
  }

  function cashFlowSheet(pk, meta) {
    const g = FS.grouped(null, pk);
    const openingRows = Store.openingRows(pk);
    const aoa = [[txt(COMPANY)], [txt('งบกระแสเงินสด (วิธีทางอ้อม)')], [txt(`YTD ended ${meta.periodLabel}`)], []];
    if (!g || !openingRows) {
      aoa.push([txt('⚠ คำนวณไม่ได้: ต้องมีคอลัมน์ยอดยกมา (Opening balance) ในไฟล์ที่นำเข้า')]);
      return aoa;
    }
    const bs = FS.buildBS(g), pl = FS.buildPL(g);
    const og = FS.grouped(openingRows);
    const r = CashFlowEngine.computeCashFlow(bs, pl, FS.buildBS(og), FS.buildPL(og));
    aoa.push([txt('รายการ'), txt('บาท')]);
    const push = (label, v, indent) => aoa.push([txt((indent ? '    ' : '') + label), v == null ? blank() : num(v)]);
    push('กระแสเงินสดจากกิจกรรมดำเนินงาน');
    push('กำไรสำหรับงวด', r.netProfit, 1);
    push('รายการปรับกระทบกำไรเป็นเงินสดรับ (จ่าย)');
    r.addback.forEach(x => push(x.label, x.value, 1));
    push('กำไรก่อนการเปลี่ยนแปลงในสินทรัพย์และหนี้สินดำเนินงาน', r.profitBeforeWC);
    push('การเปลี่ยนแปลงในสินทรัพย์และหนี้สินดำเนินงาน');
    r.workingCapital.forEach(x => push(x.label, x.value, 1));
    push('กระแสเงินสดจากกิจกรรมดำเนินงานก่อนภาษี', r.cfoBeforeTax);
    push('จ่ายภาษีเงินได้', -r.taxPaid, 1);
    push('กระแสเงินสดสุทธิจากกิจกรรมดำเนินงาน', r.cfo);
    aoa.push([]);
    push('กระแสเงินสดจากกิจกรรมลงทุน');
    r.investing.forEach(x => push(x.label, x.value, 1));
    push('กระแสเงินสดสุทธิจากกิจกรรมลงทุน', r.cfi);
    aoa.push([]);
    push('กระแสเงินสดจากกิจกรรมจัดหาเงิน');
    r.financing.forEach(x => push(x.label, x.value, 1));
    push('กระแสเงินสดสุทธิจากกิจกรรมจัดหาเงิน', r.cff);
    aoa.push([]);
    push('ผลต่างที่ยังไม่ระบุ', r.unexplained);
    push('เงินสดและรายการเทียบเท่าเงินสดเพิ่มขึ้น (ลดลง) สุทธิ', r.netIncrease);
    push('เงินสดและรายการเทียบเท่าเงินสดต้นงวด', r.cashOpen);
    push('เงินสดและรายการเทียบเท่าเงินสดปลายงวด', r.cashNow);
    return aoa;
  }

  /* P&L by month. A trial balance states the P&L cumulatively from the start
     of the fiscal year, so each month is its own file minus the one before
     it — January excepted, where the cumulative figure already is the month.
     Only months actually archived get a column; a month whose predecessor is
     missing can't be decomposed and is left out rather than shown as a
     year-to-date figure standing in for one month. */
  function monthlyPLSheet(pk, meta) {
    const R = RatioEngine;
    const keys = Store.listPeriods().map(p => p.key).filter(k => R.monthsFromKey(k)).sort();
    const usable = keys.filter(k => R.monthsFromKey(k) === 1 || keys.includes(R.shiftMonthKey(k, -1)));
    const aoa = [[txt(COMPANY)], [txt('CONSOLIDATED PROFIT OR LOSS — รายเดือน (ยอดของเดือนนั้นเอง ไม่ใช่ยอดสะสม)')],
      [txt(`งวดที่บันทึกไว้และแยกเป็นรายเดือนได้ ${usable.length} เดือน`)], []];
    if (!usable.length) {
      aoa.push([txt('⚠ ยังไม่มีงวดรายเดือนที่บันทึกไว้ — บันทึกงวดรหัส YYYY-MM ที่หน้า Import ก่อน')]);
      return aoa;
    }
    // Each month's own flow per account.
    const flows = {};
    for (const k of usable) {
      const cur = new Map(Store.finalRows(k).map(r => [r.code, r.closing]));
      const prev = R.monthsFromKey(k) === 1 ? new Map() : new Map(Store.finalRows(R.shiftMonthKey(k, -1)).map(r => [r.code, r.closing]));
      const m = new Map();
      for (const [code, v] of cur) m.set(code, v - (prev.get(code) || 0));
      flows[k] = m;
    }
    const codes = new Set();
    Object.values(flows).forEach(m => m.forEach((_, c) => codes.add(c)));
    const names = new Map(Store.finalRows(usable[usable.length - 1]).map(r => [r.code, r.name]));
    const res = applyRulebook([...codes].map(c => ({ code: c, name: names.get(c) || c, closing: 0 })), RULEBOOK, Store.mappings());
    const ruleOf = new Map(res.lines.map(l => [l.code, l.rule]));

    aoa.push(['Section', 'Group', 'รหัสบัญชี', 'ชื่อบัญชี'].concat(usable).map(txt));
    for (const sectionName of FS.PL_ORDER) {
      const rows = [...codes].filter(c => { const r = ruleOf.get(c); return r && r.section === sectionName; });
      if (!rows.length) continue;
      const sign = signOf(sectionName);
      const secTot = usable.map(() => 0);
      aoa.push([txt(TH_SECTION[sectionName] || sectionName), txt(sectionName)]);
      const groups = [...new Set(rows.map(c => ruleOf.get(c).group))];
      for (const group of groups) {
        const accs = rows.filter(c => ruleOf.get(c).group === group).sort((a, b) => String(a).localeCompare(String(b)));
        const gTot = usable.map(() => 0);
        const lines = accs.map(code => {
          const vals = usable.map((k, i) => { const v = sign * (flows[k].get(code) || 0); gTot[i] += v; return v; });
          return [blank(), blank(), txt(code), txt(names.get(code) || code)].concat(vals.map(v => num(v)));
        });
        aoa.push([blank(), txt(group), blank(), blank()].concat(gTot.map(v => num(v))));
        lines.forEach(l => aoa.push(l));
        gTot.forEach((v, i) => { secTot[i] += v; });
      }
      aoa.push([txt('รวม' + (TH_SECTION[sectionName] || sectionName)), blank(), blank(), blank()].concat(secTot.map(v => num(v))));
    }
    return aoa;
  }

  /* The ratio sheet, computed by the same engine the Ratios page uses — all
     three columns the company compares (Synnex KPI, Taiwan, SET), each with
     the formula text that says which basis it is on and whether the periods
     its real formula needs were archived. */
  function ratioSheet(pk, meta) {
    const R = RatioEngine;
    const TAB_LABEL = { th: 'SYNNEX Thailand (Conso/MD&A)', tw: 'SYNNEX Taiwan (PAR/NROIC)', set: 'SET' };
    const g = FS.grouped(null, pk);
    const aoa = [[txt(COMPANY)], [txt('NFS + Ratio')], [txt(`YTD ended ${meta.periodLabel}`)], []];
    if (!g) { aoa.push([txt('⚠ ยังไม่ได้นำเข้างบทดลอง')]); return aoa; }
    const months = R.monthsFromKey(pk) || 12;
    const bs = FS.buildBS(g), pl = FS.buildPL(g);
    const startKey = pk ? R.shiftMonthKey(pk, -months) : null;
    const openingBS = startKey ? R.bsAt(startKey) : null;
    const ctx = R.ctxFor(pk, months, {
      periodLabel: meta.periodLabel, annualizeFactor: 12 / months,
      avgNote: openingBS ? `ต้นงวดจากงวด ${startKey}` : 'ไม่มีงวดต้นงวดที่บันทึกไว้ ใช้ยอดปลายงวดแทน',
      ytdNote: ` (ยอดสะสม ${months} เดือน)`,
    });
    const metrics = { th: R.computeTabMetrics('th', bs, pl, null, ctx), tw: R.computeTabMetrics('tw', bs, pl, openingBS, ctx), set: R.computeTabMetrics('set', bs, pl, openingBS, ctx) };
    aoa.push(['กลุ่ม', 'อัตราส่วน', 'หน่วย'].concat(R.TABS.map(t => TAB_LABEL[t])).concat(['สูตร / ที่มา (Thailand)', 'สูตร / ที่มา (Taiwan)', 'สูตร / ที่มา (SET)']).map(txt));
    let lastGroup = null;
    for (const spec of R.RATIO_SPEC) {
      if (spec.group !== lastGroup) { aoa.push([txt(spec.group)]); lastGroup = spec.group; }
      const cells = [blank(), txt(spec.label), txt(spec.unit === 'days' ? 'วัน' : spec.unit === 'pct' ? '%' : spec.unit === 'x' ? 'เท่า' : '')];
      for (const t of R.TABS) {
        const e = (metrics[t] || {})[spec.key];
        cells.push(!e || e.value == null || (spec.only && spec.only !== t) ? blank() : num(e.value, spec.unit === 'days' || spec.unit === 'pct' ? '#,##0.0' : '#,##0.00'));
      }
      for (const t of R.TABS) { const e = (metrics[t] || {})[spec.key]; cells.push(txt(e && e.formula ? String(e.formula).replace(/<[^>]+>/g, '') : '')); }
      aoa.push(cells);
    }
    aoa.push([]);
    aoa.push([txt('ยอดที่ใช้คำนวณวงจรเงินสด (บาท)')]);
    const BASIS = [['ลูกหนี้การค้า', 'arDays'], ['ลูกหนี้เคลม vendor', 'arVendorDays'], ['สินค้าคงเหลือ', 'invDays'], ['เจ้าหนี้การค้า (สุทธิตามสูตร)', 'apDays']];
    for (const [label, key] of BASIS) {
      aoa.push([blank(), txt(label), txt('บาท')].concat(R.TABS.map(t => {
        const e = (metrics[t] || {})[key];
        return e && e.base != null ? num(e.base) : blank();
      })));
    }
    aoa.push([]);
    aoa.push([txt('Bank covenant')]);
    const covenant = [
      ['D/E ratio (ttb <= 3)', bs.totalEquity + bs.netProfit ? bs.totalLiab / (bs.totalEquity + bs.netProfit) : null, '#,##0.00'],
      ['Debt', bs.totalLiab, MONEY],
      ['Equity', bs.totalEquity + bs.netProfit, MONEY],
      ['Current ratio (ttb >= 1.1)', null, '#,##0.00'],
    ];
    const cur = s => { const x = bs.assets.concat(bs.liab).find(a => a.name === s); return x ? x.total : 0; };
    covenant[3][1] = cur('Current Liabilities') ? cur('Current Assets') / cur('Current Liabilities') : null;
    covenant.push(['Current assets', cur('Current Assets'), MONEY], ['Current liabilities', cur('Current Liabilities'), MONEY]);
    covenant.forEach(([label, v, z]) => aoa.push([blank(), txt(label), blank(), v == null ? blank() : num(v, z)]));
    return aoa;
  }

  // Department and cost-centre detail, from the cost-centre period that
  // matches this one when the accountant has imported one.
  function costCenterSheet(pk, meta) {
    const ccKey = (pk || '') + Store.CC_SUFFIX;
    const d = Store.deptRows(Store.getPeriod(ccKey) ? ccKey : pk);
    const aoa = [[txt(COMPANY)], [txt('Cost Center — แยกตามหน่วยงาน')], [txt(`งวด ${meta.periodLabel}`)], []];
    if (!d || !d.rows || !d.rows.length) { aoa.push([txt('⚠ งวดนี้ไม่มีข้อมูลมิติหน่วยงาน — นำเข้าไฟล์ TB Dep & CC ที่หน้า Cost Center')]); return aoa; }
    aoa.push(['หน่วยงาน (Department)', 'Cost Center', 'รหัสบัญชี', 'ชื่อบัญชี', 'ยอดคงเหลือ'].map(txt));
    const nameOf = code => { const r = Store.finalRows(pk).find(x => x.code === code); return r ? r.name : code; };
    for (const r of d.rows.slice().sort((a, b) => (a.dept + a.cc + a.code).localeCompare(b.dept + b.cc + b.code))) {
      aoa.push([txt((d.deptNames && d.deptNames[r.dept]) || r.dept), txt((d.ccNames && d.ccNames[r.dept + ' ' + r.cc]) || r.cc || ''), txt(r.code), txt(nameOf(r.code)), num(r.closing)]);
    }
    return aoa;
  }

  function infoSheet(d, pk, meta) {
    const aoa = [
      [txt(COMPANY)], [txt('FS Close Workspace — ส่งออกเพื่อทำงานต่อใน Excel')], [],
      [txt('งวด'), txt(meta.periodLabel)],
      [txt('รหัสงวด'), txt(pk || '(งวดปัจจุบัน ยังไม่บันทึก)')],
      [txt('สร้างเมื่อ'), txt(meta.generatedAt)],
      [txt('เวอร์ชันโปรแกรม'), txt(global.APP_BUILD || '—')],
      [txt('บริษัทในงบรวม'), txt(d.entities.join(' · '))],
      [txt('รายการปรับปรุง/ตัดบัญชีที่เปิดใช้'), txt(d.sources.map(s => `${s} (${Store.enabledJournals(pk).filter(j => (j.source || 'Journal') === s).length})`).join(' · ') || 'ไม่มี')],
      [],
      [txt('ชีทในไฟล์นี้')],
      [txt('Conso BS'), txt('งบแสดงฐานะการเงิน แยกคอลัมน์รายบริษัท → ปรับปรุงของบริษัทนั้น → หลังปรับปรุง → รวม → ตัดรายการ → งบรวม → AJE/RJE ผู้สอบ → งบรวมหลังปรับ')],
      [txt('Conso PL'), txt('งบกำไรขาดทุน โครงสร้างคอลัมน์เดียวกับ Conso BS')],
      [txt('Conso PL (month)'), txt('งบกำไรขาดทุนรายเดือน — ยอดของเดือนนั้นเอง แยกจากยอดสะสมแล้ว')],
      [txt('Cash Flow'), txt('งบกระแสเงินสดวิธีทางอ้อม คำนวณจากยอดต้นงวด/ปลายงวด')],
      [txt('NFS+Ratio'), txt('อัตราส่วนทั้ง 3 ชุด (Synnex KPI / Taiwan / SET) พร้อมสูตรที่ใช้ และ bank covenant')],
      [txt('TB <บริษัท>'), txt('งบทดลองรายบริษัทตามที่นำเข้า พร้อมกลุ่มที่จัดให้')],
      [txt('Eliminate / AJE+RJE-*'), txt('รายการตัดบัญชีและปรับปรุง แยกตามแหล่งที่มา ทีละรายการ')],
      [txt('Cost Center'), txt('ยอดแยกตามหน่วยงานและ cost center (ถ้ามีการนำเข้า)')],
      [],
      [txt('คำย่อในชื่อชีทและหัวคอลัมน์')],
      [txt('AJE'), txt('Adjusting Journal Entry — รายการปรับปรุง: ทำให้ตัวเลขเปลี่ยน (กำไรหรือยอดรวมขยับ) เช่น ปรับ cut-off การขาย ปรับภาษีเงินได้')],
      [txt('RJE'), txt('Reclassifying Journal Entry — รายการจัดประเภทใหม่: ย้ายจากบรรทัดหนึ่งไปอีกบรรทัด ยอดรวมและกำไรไม่เปลี่ยน เช่น ย้ายลูกหนี้หมุนเวียนไปไม่หมุนเวียน')],
      [txt('CAJE'), txt('รายการปรับปรุงที่ลงที่ระดับงบการเงินรวม (ตามที่ใช้ในไฟล์ Conso ของบริษัท) — ควรยืนยันความหมายกับผู้สอบบัญชีที่ออกรายการ')],
      [txt('Eliminate'), txt('รายการตัดรายการระหว่างกัน — ตัดยอดที่บริษัทในกลุ่มทำกันเอง ออกจากงบการเงินรวม')],
      [txt('After Adj.'), txt('ยอดของบริษัทนั้นหลังรายการปรับปรุง/จัดประเภทใหม่ของบริษัทนั้นเอง')],
      [txt('Conso'), txt('ยอดงบการเงินรวม = ทุกบริษัทรวมกัน หลังปรับปรุงระดับบริษัท และหลังตัดรายการระหว่างกัน')],
      [],
      [txt('รายการปรับปรุงในงวดนี้ แยกตามแหล่งที่มา')],
      [],
      [txt('หมายเหตุ')],
      [txt('• ทุกตัวเลขเป็นค่าคงที่ ไม่ใช่สูตร — แก้ไขต่อได้ทันที และจะไม่คำนวณใหม่ให้ต่างจากในเว็บ')],
      [txt('• เครื่องหมาย: หนี้สิน ส่วนของผู้ถือหุ้น รายได้ และต้นทุน แสดงเป็นค่าบวกตามแบบของไฟล์ Conso')],
      [txt('• ยอดในชีท Conso คือยอดหลังรายการที่ "เปิดใช้งาน" ที่หน้า Journals เท่านั้น')],
    ];
    // Every source that actually has entries this period, spelled out.
    const notesAt = aoa.findIndex(r => r.length === 1 && r[0] && r[0].v === 'หมายเหตุ');
    const list = d.sources.map(src => [txt(src), txt(sourceTitle(src, d.entities).replace(src + ' — ', '')
      + ` · ${Store.journals(pk).filter(j => (j.source || 'Journal') === src).length} รายการ`)]);
    aoa.splice(notesAt - 1, 0, ...list);
    return aoa;
  }

  const sheetName = s => String(s).replace(/[\\/?*[\]:]/g, '-').slice(0, 31);

  function build(pk) {
    const meta = {
      periodLabel: pk ? ((Store.getPeriod(pk) || {}).label || pk) : 'งวดปัจจุบัน',
      generatedAt: new Date().toLocaleString('th-TH'),
    };
    const d = collect(pk);
    const wb = XLSX.utils.book_new();
    const put = (name, aoa, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => (r || []).map(c => (c === null ? null : c))));
      if (widths) ws['!cols'] = widths.map(w => ({ wch: w }));
      XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
    };
    const stmtWidths = [22, 22, 30, 12, 40].concat(new Array(40).fill(16));
    put('_Export info', infoSheet(d, pk, meta), [30, 90]);
    put('Conso BS', statementSheet(d, 'BS', meta), stmtWidths);
    put('Conso PL', statementSheet(d, 'PL', meta), stmtWidths);
    put('Conso PL (month)', monthlyPLSheet(pk, meta), [22, 30, 12, 40].concat(new Array(24).fill(15)));
    put('Cash Flow', cashFlowSheet(pk, meta), [62, 20]);
    put('NFS+Ratio', ratioSheet(pk, meta), [30, 26, 8, 16, 16, 16, 70, 70, 70]);
    for (const ent of d.entities) put('TB ' + ent, tbSheet(ent, pk, meta), [12, 42, 18, 18, 12, 22, 28]);
    for (const src of d.sources) put(src, journalSheet(src, pk, meta, d.entities), [14, 42, 12, 40, 18, 18, 18, 8]);
    put('Cost Center', costCenterSheet(pk, meta), [28, 28, 12, 40, 18]);
    return { wb, meta };
  }

  function download(pk) {
    const { wb, meta } = build(pk);
    const stamp = (pk || 'current').replace(/[^\w-]/g, '');
    XLSX.writeFile(wb, `FS_Conso_${stamp}.xlsx`, { compression: true });
    return meta;
  }


  /* ---- Reading one back in -------------------------------------------

     The point of exporting into the workpaper's shape is that someone can
     work in it. So the file comes back: drop the same workbook on Import and
     the period it came from is rebuilt from it.

     Only the sheets that hold INPUT are read — the trial balance per company
     and the journal sheets. Conso BS, Conso PL, Cash Flow and the ratios are
     computed from those, so reading them back would either duplicate what
     the app recomputes or, if someone typed over a total, contradict it. A
     figure edited on a statement sheet is therefore ignored; the way to move
     a number is to edit it on the TB or in a journal entry, which is also
     the only way that keeps the statements internally consistent.

     One thing beyond the numbers does come back: the Statement / Section /
     Group columns on each TB sheet. Retyping a group there is the natural
     way to reclassify an account in Excel, so a value that differs from the
     rulebook is offered as a chart-of-accounts override — never applied
     silently, since it changes every period, not just this one. */

  const DERIVED_SHEETS = ['_Export info', 'Conso BS', 'Conso PL', 'Conso PL (month)', 'Cash Flow', 'NFS+Ratio', 'Cost Center'];
  const cellText = v => (v == null ? '' : String(v).trim());
  const cellNum = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = parseFloat(String(v).replace(/[,\s]/g, '').replace(/[()]/g, m => (m === '(' ? '-' : '')));
    return isFinite(n) ? n : null;
  };
  const rowsOf = ws => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  // Where the table starts, found by its own header text rather than a fixed
  // row, so an extra title line someone inserted doesn't break the read.
  function headerRow(aoa, first) {
    for (let i = 0; i < Math.min(aoa.length, 30); i++) {
      const row = (aoa[i] || []).map(cellText);
      if (row.includes(first)) return { i, cols: row };
    }
    return null;
  }

  function parseTbSheet(aoa) {
    const h = headerRow(aoa, 'รหัสบัญชี');
    if (!h) return null;
    const at = name => h.cols.indexOf(name);
    const ci = { code: at('รหัสบัญชี'), name: at('ชื่อบัญชี'), opening: at('ยอดยกมา'), closing: at('ยอดคงเหลือ'), st: at('Statement'), se: at('Section'), gr: at('Group') };
    const rows = [], rules = {};
    for (let i = h.i + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const code = cellText(r[ci.code]);
      if (!code || code === 'รวม') continue;
      const closing = cellNum(r[ci.closing]);
      if (closing == null) continue;
      const name = cellText(r[ci.name]);
      rows.push({ code, name, closing, opening: ci.opening === -1 ? null : cellNum(r[ci.opening]) });
      const st = cellText(r[ci.st]), se = cellText(r[ci.se]), gr = cellText(r[ci.gr]);
      if (st && se && gr && gr !== 'UNMAPPED') rules[code] = { name, statement: st, section: se, group: gr };
    }
    return { rows, rules };
  }

  function parseJournalSheet(sheet, aoa) {
    const h = headerRow(aoa, 'เลขที่');
    if (!h) return [];
    const at = name => h.cols.indexOf(name);
    const ci = { ref: at('เลขที่'), desc: at('คำอธิบาย'), code: at('รหัสบัญชี'), name: at('ชื่อบัญชี'), dr: at('เดบิต'), cr: at('เครดิต'), net: at('สุทธิ'), on: at('ใช้งาน') };
    const byRef = new Map();
    for (let i = h.i + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const ref = cellText(r[ci.ref]), code = cellText(r[ci.code]);
      // The per-entry total line carries no account; it's recomputed anyway.
      if (!ref || !code) continue;
      const amount = ci.net !== -1 && cellNum(r[ci.net]) != null
        ? cellNum(r[ci.net])
        : (cellNum(r[ci.dr]) || 0) - (cellNum(r[ci.cr]) || 0);
      if (!amount && amount !== 0) continue;
      const cur = byRef.get(ref) || { id: `${sheet}::${ref}`, source: sheet, description: cellText(r[ci.desc]), lines: [], enabled: cellText(r[ci.on]) !== 'ปิด' };
      cur.lines.push({ code, name: cellText(r[ci.name]), amount });
      if (!cur.description) cur.description = cellText(r[ci.desc]);
      byRef.set(ref, cur);
    }
    return [...byRef.values()].map(j => Object.assign(j, { net: j.lines.reduce((t, l) => t + l.amount, 0) }));
  }

  /* What an exported workbook holds, or why it can't be read. Never touches
     the store — the caller shows this first and asks. */
  function parse(wb, fileName) {
    const names = wb.SheetNames || [];
    // The cover sheet is what makes a workbook ours, and Import routes a
    // dropped file here on finding it. Matched loosely — Excel lets someone
    // rename a sheet, and "_export info" should still be the same sheet.
    const infoName = names.find(n => String(n).trim().replace(/[\s_-]+/g, ' ').toUpperCase() === ' EXPORT INFO');
    const info = infoName ? wb.Sheets[infoName] : null;
    if (!info) {
      return { ok: false, error: 'ไฟล์นี้ไม่ใช่ไฟล์ที่ส่งออกจากโปรแกรมนี้ (ไม่มีชีท "_Export info")\n\n'
        + 'ถ้าเป็นไฟล์ Conso ต้นฉบับ ระบบจะอ่านเป็น Workpaper ให้เองเมื่อวางในกล่องนำเข้า — '
        + 'ทางนี้ใช้กับไฟล์ที่กดส่งออกจากหน้า Review แล้วเอาไปแก้ใน Excel' };
    }
    const entityCodes = RULEBOOK.entities.map(e => e.code);
    const tbSheets = names.filter(n => /^TB /.test(n) && entityCodes.includes(n.slice(3).trim()));
    if (!tbSheets.length) return { ok: false, error: 'ไฟล์ส่งออกนี้ไม่มีชีทงบทดลอง (TB SYN / TB SVP / …) ให้นำกลับเข้ามา' };
    // The period the file came from, read off its own cover sheet.
    let periodKey = '', periodLabel = '', build = '';
    {
      for (const row of rowsOf(info)) {
        const k = cellText((row || [])[0]), v = cellText((row || [])[1]);
        if (k === 'รหัสงวด' && !/^\(/.test(v)) periodKey = v;
        if (k === 'งวด') periodLabel = v;
        if (k === 'เวอร์ชันโปรแกรม') build = v;
      }
    }
    const entities = {}, rules = {}, warnings = [];
    for (const sheet of tbSheets) {
      const code = sheet.slice(3).trim();
      const parsed = parseTbSheet(rowsOf(wb.Sheets[sheet]));
      if (!parsed || !parsed.rows.length) { warnings.push(`${sheet}: ไม่พบแถวบัญชี`); continue; }
      entities[code] = { rows: parsed.rows, fileName: `${fileName} › ${sheet}` };
      Object.assign(rules, parsed.rules);
    }
    if (!Object.keys(entities).length) return { ok: false, error: 'อ่านชีทงบทดลองไม่ได้: ' + warnings.join(' · ') };

    const journalSheets = names.filter(n => !DERIVED_SHEETS.includes(n) && !/^TB /.test(n));
    let journals = [];
    for (const sheet of journalSheets) {
      const js = parseJournalSheet(sheet, rowsOf(wb.Sheets[sheet]));
      if (js.length) journals = journals.concat(js); else warnings.push(`${sheet}: ไม่พบรายการ`);
    }

    // Which of the retyped groups actually differ from what the app would
    // do on its own — the rest are just the export's own output coming back.
    const current = Object.assign({}, RULEBOOK.rules, Store.mappings());
    const overrides = {};
    for (const [code, rule] of Object.entries(rules)) {
      const now = current[code];
      if (!now || now.statement !== rule.statement || now.section !== rule.section || now.group !== rule.group) overrides[code] = rule;
    }
    return {
      ok: true, periodKey, periodLabel, build, warnings,
      entities, journals, overrides,
      counts: {
        entities: Object.keys(entities).length,
        rows: Object.values(entities).reduce((t, e) => t + e.rows.length, 0),
        journals: journals.length,
        journalSources: [...new Set(journals.map(j => j.source))],
        overrides: Object.keys(overrides).length,
      },
    };
  }

  /* Write a parsed workbook into a period. Only the entities and journal
     sources the file actually carries are replaced, so re-importing a file
     that holds one company doesn't remove the others, and journals typed by
     hand on the Journals page survive (setJournals is scoped to the sources
     passed to it). */
  function restore(parsed, { periodKey = '', applyOverrides = false } = {}) {
    for (const [code, e] of Object.entries(parsed.entities)) Store.setTB(code, e.fileName, e.rows, periodKey);
    const sources = parsed.counts.journalSources;
    if (sources.length) Store.setJournals(parsed.journals, sources, periodKey);
    let applied = 0;
    if (applyOverrides) for (const [code, rule] of Object.entries(parsed.overrides)) { Store.setMapping(code, rule); applied++; }
    return { periodKey, applied };
  }

  global.ConsoExport = { build, download, collect, entityOfSource, parse, restore };
  if (typeof module !== 'undefined') module.exports = global.ConsoExport;
})(typeof window !== 'undefined' ? window : globalThis);
