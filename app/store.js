/* Shared workspace state across pages (Import, Mapping, ...).
   Holds the uploaded trial balances and the user's saved mappings, and
   persists them to localStorage so learned mappings survive reloads and
   auto-apply next month. Small on purpose — data + persistence only. */
(function (global) {
  const KEY = 'fs-close-workspace-v1';

  const Store = {
    data: { tb: {}, mappings: {} },   // tb: entity -> {fileName, rows}; mappings: code -> rule

    load() {
      try { const s = localStorage.getItem(KEY); if (s) this.data = JSON.parse(s); } catch (e) { /* ignore */ }
      if (!this.data.tb) this.data.tb = {};
      if (!this.data.mappings) this.data.mappings = {};
      if (!this.data.journals) this.data.journals = [];
      if (!this.data.periods) this.data.periods = {};
      if (!this.data.workbooks) this.data.workbooks = {};
      // No eliminations ship with the app. They're the user's own data —
      // entered on the Journals page, parsed from an uploaded workbook's
      // Eliminate/AJE sheets, or restored from a journals .json export.
      return this;
    },
    /* Browsers cap localStorage at about 5 MB, and a department-level TB for
       several months gets there. A failed write used to be swallowed, which
       looks like nothing happened until a reload shows the period back to
       what it was — so the failure is reported once instead, loudly enough
       that the import can be split up or older periods removed. */
    persist() {
      // No localStorage at all (Node, or a browser with storage disabled) —
      // nothing to report, the app just runs without persistence.
      if (typeof localStorage === 'undefined') return false;
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); this.storageFull = false; return true; }
      catch (e) {
        if (this.storageFull) return false;          // already told them; don't nag per row
        this.storageFull = true;
        const msg = 'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม — ข้อมูลที่เพิ่งนำเข้ายังไม่ถูกบันทึก\n\n'
          + 'ลบงวดเก่าที่ไม่ได้ใช้ออกที่หน้า Import (ส่วน "งวดที่บันทึกไว้") แล้วนำเข้าใหม่';
        if (typeof alert === 'function') alert(msg); else console.warn(msg, e);
        return false;
      }
    },

    /* How much of the browser's store this workspace is taking, so the
       Import page can show it before a write fails rather than after.
       `limit` is the usual ~5 MB cap — not readable from the browser, so it
       stands as the figure the bar is drawn against. */
    usage() {
      let bytes = 0;
      try { bytes = (localStorage.getItem(KEY) || '').length; } catch (e) { /* ignore */ }
      const periods = {};
      for (const [key, p] of Object.entries(this.data.periods || {})) periods[key] = JSON.stringify(p).length;
      return { bytes, limit: 5 * 1024 * 1024, live: JSON.stringify(this.data.tb || {}).length, periods };
    },

    /* Everything this workspace holds, gone: trial balances, saved periods,
       journals, chart-of-accounts overrides, budget. Nothing ships with the
       app, so this really is back to a first visit — the caller warns. */
    clearAll() {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      this.data = { tb: {}, mappings: {} };
      this.storageFull = false;
      this.load();
    },

    // Which period the read-only report pages (TB, Consolidation,
    // Statements, Cash Flow, Cost Center, Review) and Journals/Mapping's
    // own views are currently showing — '' is the live period, the same
    // convention every periodKey argument below already uses. Only Import
    // (its own "กำลังนำเข้าให้งวด" switcher, for WRITING into a period) and
    // Ratios (its own Q1-Q4 quarter resolution) are unaffected by this.
    // Persisted like everything else, so picking a period on one page
    // carries across normal navigation — this app has no client-side
    // router; every page load reads Store fresh from localStorage.
    uiPeriod() { return this.data.uiPeriod || ''; },
    setUiPeriod(key) { this.data.uiPeriod = key || ''; this.persist(); },

    // Every TB accessor below takes an optional trailing periodKey, so pages
    // that only ever work on the live/current period (Mapping, Journals,
    // Consolidation, Statements, ...) can keep calling them exactly as
    // before, while Import can target an archived period directly — e.g.
    // uploading last year's same-month TB straight into that period instead
    // of overwriting the live one and archiving a copy. tbFor() creates an
    // empty period on first use, so picking a brand-new period key on the
    // Import page "just works" without a separate create step.
    tbFor(periodKey) {
      if (!periodKey) return this.data.tb;
      if (!this.data.periods[periodKey]) this.data.periods[periodKey] = { key: periodKey, label: periodKey, savedAt: new Date().toISOString(), tb: {}, journals: [] };
      if (!this.data.periods[periodKey].journals) this.data.periods[periodKey].journals = [];   // a period archived before journals were per-period
      return this.data.periods[periodKey].tb;
    },
    // Same trailing-periodKey convention as tbFor: '' (the default) is the
    // live journal set, anything else is that archived period's own —
    // uploading a workbook straight into a saved period now reads its
    // Eliminate/AJE sheets too, instead of only ever the live close's.
    journalsFor(periodKey) {
      if (!periodKey) return this.data.journals;
      this.tbFor(periodKey);   // ensures the period (and its journals array) exists
      return this.data.periods[periodKey].journals;
    },
    /* Department rows go to storage as bare [code, dept, cc, closing] tuples.
       A department-level TB is tens of thousands of rows, and as objects the
       four field names cost more than the values do — packing them roughly
       halves what a period takes, which is the difference between a year of
       them fitting in the browser's ~5 MB and not. The opening balance is
       dropped on the way in: only closing is ever read back. */
    setTB(entity, fileName, rows, periodKey, deptRows, deptSource, dimNames) {
      const dept = deptRows && deptRows.length ? deptRows.map(r => [r.code, r.dept, r.cc || '', r.closing]) : undefined;
      this.tbFor(periodKey)[entity] = {
        fileName, rows,
        deptRows: dept,
        deptSource: dept ? (deptSource || '') : undefined,
        // Dimension labels, held once per entity rather than on every row —
        // see labelDims. Absent on a TB imported before that split, which
        // deptRows() below still reads by falling back to the row's own copy.
        dimNames: dept ? dimNames : undefined,
      };
      if (periodKey) this.data.periods[periodKey].savedAt = new Date().toISOString();
      this.persist();
    },

    /* Department-level expense detail, if any loaded TB carried a Department
       column. Aggregated across entities by (code, dept, cost centre) — the
       shape the Cost Center page needs. `deptNames`/`ccNames` map a dimension
       code to its readable label. */
    deptRows(periodKey) {
      const tb = this.tbFor(periodKey);
      const byKey = new Map(), deptNames = {}, ccNames = {}, sources = [];
      for (const ent of Object.keys(tb)) {
        const src = tb[ent].deptSource;
        if (src && !sources.includes(src)) sources.push(src);
        const dims = tb[ent].dimNames || { dept: {}, cc: {} };
        Object.assign(deptNames, dims.dept);
        Object.assign(ccNames, dims.cc);
        // The account's own name lives on the deduped rows, so the department
        // rows don't repeat it — one lookup covers all of them.
        const nameOfCode = {};
        for (const r of tb[ent].rows || []) nameOfCode[r.code] = r.name;
        for (const raw of (tb[ent].deptRows || [])) {
          // Packed tuple, or the object shape a TB imported before the pack
          // still carries — nothing re-reads the workbook, so both are read.
          const packed = Array.isArray(raw);
          const code = packed ? raw[0] : raw.code;
          const dpt = packed ? raw[1] : raw.dept;
          // Cost centre is the optional second level under a department: only
          // some exports carry it, so '' here means "this export stops at the
          // department" and every reader can treat one shape as the other.
          const cc = (packed ? raw[2] : raw.cc) || '';
          const closing = packed ? raw[3] : raw.closing;
          if (!packed) {
            if (raw.deptName && deptNames[dpt] == null) deptNames[dpt] = raw.deptName;
            if (cc && raw.ccName && ccNames[dpt + ' ' + cc] == null) ccNames[dpt + ' ' + cc] = raw.ccName;
          }
          const key = code + ' ' + dpt + ' ' + cc;
          const cur = byKey.get(key);
          if (cur) cur.closing += closing;
          else byKey.set(key, { code, dept: dpt, cc, name: (packed ? '' : raw.name) || nameOfCode[code] || code, closing });
        }
      }
      const rows = [...byKey.values()];
      return { rows, deptNames, ccNames, sources, hasCC: rows.some(r => r.cc) };
    },
    hasDeptData(periodKey) { const tb = this.tbFor(periodKey); return Object.keys(tb).some(e => (tb[e].deptRows || []).length); },

    /* Cost-centre budget: {"<code> <dept>": amount} plus a dept-only
       fallback {" <dept>": amount}. Imported as its own file — no
       accounting system exports budget alongside actuals. */
    setBudget(rec, fileName) {
      // `rec` is what parseBudget returned: the detail rows (account ×
      // department × cost centre), the (account, department) rollup earlier
      // versions stored under `map`, and the budget year. Kept whole so the
      // cost-centre view has a line of its own to compare against; a record
      // saved by an older build carries only `map` and still reads.
      this.data.budget = Object.assign({ fileName, savedAt: new Date().toISOString() }, rec && rec.rows ? rec : { map: rec });
      this.persist();
    },
    budget() { return this.data.budget || null; },
    clearBudget() { delete this.data.budget; this.persist(); },

    /* Cash-cycle targets (the "KRI" line on the Ratios trend charts) as
       {ar, inv, ap, ccc} in days. Each company sets its own, so none ship
       with the app — an unset target simply draws no line. */
    setCycleTargets(t) { this.data.cycleTargets = t; this.persist(); },
    cycleTargets() { return this.data.cycleTargets || {}; },
    /* A note of which workbook the current import came from, keyed by period
       ('' = the live one). The TB rows themselves already carry the file name,
       but they can't say when the file was read, how many journals came with
       it, or that it was ever dropped at all once its entities are removed —
       so the Import page can show "this file is already loaded" after a reload
       instead of an untouched drop zone, and offer to take it back out.
       Metadata only: no rows, so it costs nothing in localStorage. */
    setWorkbook(periodKey, rec) { this.data.workbooks[periodKey || ''] = rec; this.persist(); },
    workbook(periodKey) { return this.data.workbooks[periodKey || ''] || null; },
    clearWorkbook(periodKey) { delete this.data.workbooks[periodKey || '']; this.persist(); },

    removeTB(entity, periodKey) { delete this.tbFor(periodKey)[entity]; this.persist(); },
    tb(entity, periodKey) { return this.tbFor(periodKey)[entity] || null; },
    entitiesLoaded(periodKey) { return Object.keys(this.tbFor(periodKey)); },
    hasData(periodKey) { return this.entitiesLoaded(periodKey).length > 0; },

    setMapping(code, rule) { this.data.mappings[code] = rule; this.persist(); },
    removeMapping(code) { delete this.data.mappings[code]; this.persist(); },
    mappings() { return this.data.mappings; },

    /* Chart of accounts as a portable file. Two layers feed the grouping:
       the bundled RULEBOOK (defaults, never written to) and these user
       overrides (which win — see applyRulebook). Export flattens both into
       one self-contained set so it survives a cleared cache, moves between
       machines, and lets a different company load its own chart over the
       bundled one without touching code. Import writes into the OVERRIDE
       layer only, so per-code editing and "reset to default" keep working
       exactly as before. */
    exportMappings(rulebook) {
      const merged = {};
      const base = (rulebook && rulebook.rules) || {};
      for (const [code, r] of Object.entries(base)) merged[code] = { name: r.name, statement: r.statement, section: r.section, group: r.group };
      for (const [code, r] of Object.entries(this.data.mappings)) merged[code] = { name: r.name, statement: r.statement, section: r.section, group: r.group };
      return {
        kind: 'fs-close-workspace/mappings',
        version: 1,
        exportedAt: new Date().toISOString(),
        mappings: merged,
      };
    },
    /* Replaces the override layer wholesale (restore semantics). Returns the
       count; throws on a payload that isn't a mappings export. */
    importMappings(payload) {
      const src = payload && payload.mappings && typeof payload.mappings === 'object' ? payload.mappings
        : (payload && typeof payload === 'object' && !payload.kind && !Array.isArray(payload) ? payload : null);
      if (!src) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์ผังบัญชี (mappings) ที่ export จากระบบนี้');
      const clean = {};
      for (const [code, r] of Object.entries(src)) {
        if (!r || !r.statement || !r.section || !r.group) continue;
        clean[String(code)] = { name: r.name || '', statement: String(r.statement), section: String(r.section), group: String(r.group) };
      }
      const n = Object.keys(clean).length;
      if (!n) throw new Error('ไม่พบรหัสบัญชีที่ใช้ได้ในไฟล์นี้');
      this.data.mappings = clean;
      this.persist();
      return n;
    },

    // Journals (eliminations / adjustments). Each has { id, description, source,
    // lines:[{code,name,amount}], net, enabled }. Merged by id so re-importing a
    // workbook refreshes them without duplicating. Every method here follows
    // the same trailing-periodKey convention as the TB accessors above.
    journals(periodKey) { return this.journalsFor(periodKey); },
    enabledJournals(periodKey) { return this.journalsFor(periodKey).filter(j => j.enabled !== false); },
    /* Replace the journals belonging to `sources` (the sheet names just
       re-scanned from an imported workbook) with `list`, preserving each
       kept id's enabled state. Journals from other sources — e.g. entries
       added by hand on the Journals page — are left untouched, so a future
       import of a bare TB/GL file (no Eliminate/AJE sheets) never wipes
       them out. Pass no `sources` to upsert without removing anything. */
    setJournals(list, sources, periodKey) {
      const current = this.journalsFor(periodKey);
      const byId = new Map(current.map(j => [j.id, j]));
      const scope = sources ? new Set(sources) : null;
      // Drop anything the incoming batch replaces — both by source (the
      // sheets just re-scanned) AND by id. The id check matters because a
      // journal restored from a .json export, or hand-entered, can carry an
      // id the workbook also produces; without it the two would coexist and
      // the same elimination would be applied twice.
      const incoming = new Set(list.map(j => j.id));
      const kept = scope
        ? current.filter(j => !scope.has(j.source) && !incoming.has(j.id))
        : [];
      const merged = list.map(j => {
        const prev = byId.get(j.id);
        return Object.assign({ enabled: prev ? prev.enabled : true }, j);
      });
      const next = kept.concat(merged);
      if (!periodKey) this.data.journals = next; else this.data.periods[periodKey].journals = next;
      this.persist();
    },

    /* Journals as a portable file — eliminations are the user's own data and
       the only copy lives in this browser's localStorage, so they need a way
       to back them up, move to another machine, or hand a colleague the same
       set. Optional periodKey backs up/restores that ARCHIVED period's own
       journals instead of the live set — the export/import buttons are the
       one place the whole set is replaced wholesale, so pointing that at the
       wrong period (a page-wide period picker left on an archive) would
       otherwise silently wipe or dump the wrong journals. */
    exportJournals(periodKey) {
      return {
        kind: 'fs-close-workspace/journals',
        version: 1,
        exportedAt: new Date().toISOString(),
        journals: this.journalsFor(periodKey),
      };
    },
    /* Replaces the whole journal set (restore semantics — what you want when
       recovering a backup). Returns the number imported; throws on a payload
       that isn't a journals export, so the caller can show a real message
       instead of silently wiping the list. */
    importJournals(payload, periodKey) {
      const list = payload && Array.isArray(payload.journals) ? payload.journals
        : (Array.isArray(payload) ? payload : null);
      if (!list) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์รายการตัดบัญชี (journals) ที่ export จากระบบนี้');
      const clean = list.filter(j => j && j.id && Array.isArray(j.lines)).map(j => ({
        id: String(j.id),
        no: j.no || '',
        description: j.description || '',
        source: j.source || 'นำเข้าจากไฟล์',
        lines: j.lines
          .filter(l => l && l.code != null && isFinite(Number(l.amount)))
          .map(l => ({ code: String(l.code), name: l.name || '', amount: Number(l.amount) })),
        net: 0,
        enabled: j.enabled !== false,
      })).filter(j => j.lines.length);
      for (const j of clean) j.net = j.lines.reduce((s, l) => s + l.amount, 0);
      if (!clean.length) throw new Error('ไม่พบรายการที่ใช้ได้ในไฟล์นี้');
      if (!periodKey) this.data.journals = clean; else { this.tbFor(periodKey); this.data.periods[periodKey].journals = clean; }
      this.persist();
      return clean.length;
    },
    addJournal(j, periodKey) { this.journalsFor(periodKey).push(Object.assign({ enabled: true }, j)); this.persist(); },
    updateJournal(id, patch, periodKey) {
      const j = this.journalsFor(periodKey).find(x => x.id === id);
      if (j) { Object.assign(j, patch); this.persist(); }
    },
    removeJournal(id, periodKey) {
      const next = this.journalsFor(periodKey).filter(j => j.id !== id);
      if (!periodKey) this.data.journals = next; else this.data.periods[periodKey].journals = next;
      this.persist();
    },
    /* Drop every journal that came from the given sheets — the undo half of a
       workbook import. Scoped by source on purpose: entries keyed in by hand on
       the Journals page, or restored from a .json export, carry a different
       source and survive. Returns how many were removed. */
    removeJournalsBySource(sources, periodKey) {
      const scope = new Set(sources || []);
      if (!scope.size) return 0;
      const current = this.journalsFor(periodKey);
      const before = current.length;
      const next = current.filter(j => !scope.has(j.source));
      if (!periodKey) this.data.journals = next; else this.data.periods[periodKey].journals = next;
      this.persist();
      return before - next.length;
    },
    toggleJournal(id, on, periodKey) { const j = this.journalsFor(periodKey).find(x => x.id === id); if (j) { j.enabled = on; this.persist(); } },
    clearJournals(periodKey) {
      if (!periodKey) this.data.journals = []; else this.data.periods[periodKey].journals = [];
      this.persist();
    },

    /* Combining rows: aggregate every loaded entity's TB by account code.
       Carries `opening` through too (null unless every entity's file had an
       opening-balance column) for SET-style ratios that average the period's
       beginning and ending balance instead of using the ending balance alone.
       Pass an alternate tb map (e.g. from an archived period) to aggregate
       that snapshot instead of the live one — same shape as this.data.tb. */
    combinedRows(tb) {
      const src = tb || this.data.tb;
      const byCode = new Map();
      for (const ent of Object.keys(src)) {
        for (const r of src[ent].rows) {
          const cur = byCode.get(r.code);
          if (cur) { cur.closing += r.closing; cur.opening = (cur.opening == null || r.opening == null) ? null : cur.opening + r.opening; }
          else byCode.set(r.code, { code: r.code, name: r.name, closing: r.closing, opening: r.opening == null ? null : r.opening });
        }
      }
      return [...byCode.values()];
    },

    /* Period archive — snapshots of past closes, kept around so ratios that
       genuinely need more than the current period (SET's real ROA/ROE/Asset
       Turnover formula: trailing-12-month flow ÷ average of the balance now
       and the balance at the same quarter last year) have something to pull
       from. Archiving copies the live tb map as-is; each entity's rows
       (closing/opening) travel with it, so periodCombinedRows() can run the
       same aggregation as combinedRows() against any saved period. */
    archivePeriod(key, label) {
      if (!key) return;
      this.data.periods[key] = {
        key, label: label || key, savedAt: new Date().toISOString(),
        tb: JSON.parse(JSON.stringify(this.data.tb)),
        journals: JSON.parse(JSON.stringify(this.data.journals)),
      };
      this.persist();
    },
    /* A cost-centre import writes periods of its own, keyed with this suffix
       (see month-import.js). They hold one company's trial balance and no
       eliminations, so they are the Cost Center page's business and nobody
       else's — a consolidated statement or a cash-cycle trend built on one
       would be wrong, not merely partial. Every reader gets them filtered
       out unless it asks, so a page that forgets to think about them stays
       correct. */
    CC_SUFFIX: '-cc',
    isCostCentrePeriod(key) { return String(key || '').endsWith(this.CC_SUFFIX); },

    /* scope: 'main' (the default) leaves cost-centre periods out, 'cc' is
       only those, 'all' is everything — for Import, which lists them to be
       deleted, and Cost Center, which is what they are for. */
    listPeriods(scope) {
      const all = Object.values(this.data.periods).sort((a, b) => a.key < b.key ? 1 : -1);
      if (scope === 'all') return all;
      const wantCC = scope === 'cc';
      return all.filter(p => this.isCostCentrePeriod(p.key) === wantCC);
    },
    getPeriod(key) { return this.data.periods[key] || null; },
    removePeriod(key) { delete this.data.periods[key]; this.persist(); },
    setPeriodLabel(key, label) { if (this.data.periods[key]) { this.data.periods[key].label = label; this.persist(); } },
    periodCombinedRows(key) {
      const p = this.getPeriod(key);
      return p ? this.combinedRows(p.tb) : null;
    },

    /* Opening-balance equivalent of combinedRows(), reshaped so it can be
       fed straight into FS.grouped()/buildBS() (closing := opening). Returns
       null if any loaded entity's file had no opening-balance column for
       some account — a partially-averaged ratio would be more misleading
       than clearly falling back to ending-balance-only. Optional periodKey
       does what it does everywhere else here: an archived period's own
       opening column, for averaging against ITS OWN ending balance rather
       than the live TB's. */
    openingRows(periodKey) {
      const rows = periodKey ? this.periodCombinedRows(periodKey) : this.combinedRows();
      if (!rows || !rows.length || rows.some(r => r.opening == null)) return null;
      return rows.map(r => ({ code: r.code, name: r.name, closing: r.opening }));
    },

    /* Final rows: combining + the net effect of enabled journals (the true
       consolidated position). Falls back to combining when no journals.
       Optional periodKey does for this what it does for every TB accessor
       above — an archived period carries its own journals now (a workbook
       dropped straight into one is read the same way the live close is), so
       its trend point can be the real consolidated figure instead of the
       raw pre-elimination combine. */
    finalRows(periodKey) {
      const base = periodKey ? this.periodCombinedRows(periodKey) : this.combinedRows();
      const byCode = new Map((base || []).map(r => [r.code, { code: r.code, name: r.name, closing: r.closing }]));
      for (const j of this.enabledJournals(periodKey)) {
        for (const l of j.lines) {
          const cur = byCode.get(l.code);
          if (cur) cur.closing += l.amount;
          else byCode.set(l.code, { code: l.code, name: l.name || '(journal)', closing: l.amount });
        }
      }
      return [...byCode.values()];
    },
  };

  Store.load();
  global.Store = Store;
  if (typeof module !== 'undefined') module.exports = { Store };
})(typeof window !== 'undefined' ? window : globalThis);
