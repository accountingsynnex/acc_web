/* Mapping page — assign new (unseen) account codes to an FS group, once.
   Saved mappings persist in Store and auto-apply on Import next month.
   Globals: RULEBOOK, applyRulebook, Store. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => { const a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? '(' + a + ')' : a; };

  // taxonomy: statement -> section -> sorted groups, from rulebook + saved mappings
  function taxonomy() {
    const tax = {};
    const add = (st, se, gr) => {
      if (!st || !se) return;
      (tax[st] = tax[st] || {});
      (tax[st][se] = tax[st][se] || new Set());
      if (gr) tax[st][se].add(gr);
    };
    Object.values(RULEBOOK.rules).forEach(r => add(r.statement, r.section, r.group));
    Object.values(Store.mappings()).forEach(r => add(r.statement, r.section, r.group));
    return tax;
  }
  let TAX = taxonomy();
  const statements = Object.keys(TAX);
  const sectionsOf = st => (TAX[st] ? Object.keys(TAX[st]) : []);
  const groupsOf = (st, se) => (TAX[st] && TAX[st][se] ? [...TAX[st][se]].sort() : []);

  const editOpen = new Set();
  const noteEditOpen = new Set();
  let mappedSearch = '';
  let view = 'code';
  const STATEMENT_LABEL = { BS: 'งบแสดงฐานะการเงิน', PL: 'งบกำไรขาดทุน' };

  const tile = (k, v, s, cls = '') => `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;

  // '' = live; a saved period's key = viewing that archive's own codes
  // instead, via the shared topbar picker (period-picker.js). The mapping
  // OVERRIDES saved below always stay global — one chart of accounts for
  // every period, by design (the page's own copy already says so) — only
  // which codes show up as "new" here changes with the period.
  const period = () => Store.uiPeriod();

  function currentUnmapped() {
    const pk = period();
    const rows = Store.combinedRows(pk ? Store.tbFor(pk) : undefined);
    if (!rows.length) return null;
    return applyRulebook(rows, RULEBOOK, Store.mappings());
  }

  function render() {
    TAX = taxonomy();   // pick up any group just created
    const pk = period();
    const note = $('periodNote');
    if (pk) {
      note.style.display = '';
      note.innerHTML = `⚠ กำลังดูรหัสของงวดที่บันทึกไว้ <b>${esc((Store.getPeriod(pk) || {}).label || pk)}</b> — แต่การจับคู่ที่บันทึกจากหน้านี้ยังคง<b>มีผลกับทุกงวด</b> (รวมงวดปัจจุบันด้วย) ไม่ใช่แค่งวดนี้`;
    } else note.style.display = 'none';
    const res = currentUnmapped();

    if (!res) {
      $('tiles').innerHTML = '';
      $('mapList').innerHTML = `<div class="map-done"><div class="big">ยังไม่ได้นำเข้างบทดลอง</div>
        <div class="muted">ไปที่หน้า <a class="linkish" href="import.html">Import TB</a> เพื่ออัปโหลดไฟล์ก่อน</div></div>`;
    } else {
      const unmapped = res.unmapped;
      const myMapped = Object.keys(Store.mappings()).length;
      $('tiles').innerHTML = [
        tile('รอจับคู่', String(unmapped.length), 'รหัสที่ยังไม่มีใน Rulebook', unmapped.length ? 'flag' : ''),
        tile('จับคู่แล้ว (บันทึกถาวร)', String(myMapped), 'ระบบจะจำไว้ใช้งวดถัดไป'),
        tile('จัดกลุ่มรวมตอนนี้', res.stats.mappedPct + '%', `${res.stats.mapped}/${res.stats.total} รหัส`),
      ].join('');

      if (!unmapped.length) {
        $('mapList').innerHTML = `<div class="map-done"><div class="em">✓</div>
          <div class="big">จับคู่ครบทุกรหัสแล้ว</div>
          <div class="muted">ทุกบัญชีถูกจัดกลุ่มเรียบร้อย — <a class="linkish" href="import.html">กลับไปดูผลจัดกลุ่ม</a></div></div>`;
      } else {
        $('mapList').innerHTML = '<div class="mapstack">' + unmapped
          .slice().sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing))
          .map(row => {
            const st0 = statements[0];
            return `<div class="mapcard" data-code="${esc(row.code)}">
            <div class="head"><span class="code">${esc(row.code)}</span><span class="nm">${esc(row.name)}</span>
              <span class="amt ${row.closing < 0 ? 'neg' : ''}">${money(row.closing)}</span></div>
            <div class="mapform">
              <div class="fld"><label>Statement</label><select class="js-m-st">${statements.map(s => `<option ${s === st0 ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
              <div class="fld"><label>Section</label><select class="js-m-se">${sectionsOf(st0).map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
              <div class="fld"><label>Group (เลือกหรือพิมพ์ใหม่)</label><input class="js-m-gr" list="dl-${esc(row.code)}" placeholder="ชื่อกลุ่ม" />
                <datalist id="dl-${esc(row.code)}">${groupsOf(st0, sectionsOf(st0)[0]).map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
              <button class="btn save">บันทึก</button>
            </div></div>`;
          }).join('') + '</div>';
        wireCards();
      }
    }

    renderMappedSection(res);
  }

  function renderMappedSection(res) {
    if (view === 'note') renderNoteList(); else renderMappedList(res);
  }

  // ---- Already-mapped codes: searchable + editable, so a code that's
  // already in the Rulebook (or a past override) can be re-grouped for a
  // future period too, not just brand-new codes. Saving here writes an
  // override the same way the unmapped-cards form does — applyRulebook
  // already prefers overrides[code] over rules[code], so this just reuses
  // that path against codes that happen to already resolve to a group. ----
  function renderMappedList(res) {
    if (!res) {
      $('mappedList').innerHTML = `<div class="map-done" style="padding:24px"><div class="muted">ต้องนำเข้างบทดลองก่อนถึงจะเห็นยอด — สลับไปมุมมอง "ตาม Note" เพื่อดู/แก้ไขโครงสร้างกลุ่มได้โดยไม่ต้องมีไฟล์</div></div>`;
      return;
    }
    const q = mappedSearch.trim().toLowerCase();
    const rows = res.lines.filter(l => l.status === 'mapped')
      .filter(l => !q || l.code.toLowerCase().includes(q) || (l.name || '').toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code));

    if (!rows.length) {
      $('mappedList').innerHTML = `<div class="map-done" style="padding:24px"><div class="muted">${q ? 'ไม่พบรหัสที่ตรงกับคำค้นหา' : 'ยังไม่มีรหัสที่จัดกลุ่มแล้ว'}</div></div>`;
      return;
    }

    $('mappedList').innerHTML = '<div class="mapstack">' + rows.map(row => {
      const r = row.rule;
      const isOpen = editOpen.has(row.code);
      const hasOverride = !!Store.mappings()[row.code];
      const st0 = r.statement;
      return `<div class="mapcard" data-code="${esc(row.code)}">
        <div class="head" style="cursor:pointer" data-toggleedit="${esc(row.code)}">
          <span class="code">${esc(row.code)}</span><span class="nm">${esc(row.name)}</span>
          <span class="path"><span class="sctn">${esc(r.section)}</span><span class="arw">▸</span><span class="grp">${esc(r.group)}</span></span>
          ${hasOverride ? `<span class="chip good" style="margin-left:8px"><span class="dot"></span>แก้ไขแล้ว</span>` : ''}
          <span class="amt ${row.closing < 0 ? 'neg' : ''}">${money(row.closing)}</span>
        </div>
        ${isOpen ? `<div class="mapform">
          <div class="fld"><label>Statement</label><select class="js-m-st">${statements.map(s => `<option ${s === st0 ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="fld"><label>Section</label><select class="js-m-se">${sectionsOf(st0).map(s => `<option ${s === r.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="fld"><label>Group (คลิกแล้วพิมพ์เพื่อดูตัวเลือกอื่น)</label><input class="js-m-gr" list="dl-${esc(row.code)}" value="${esc(r.group)}" onfocus="this.select()" />
            <datalist id="dl-${esc(row.code)}">${groupsOf(st0, r.section).map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
          <button class="btn save">บันทึก</button>
          ${hasOverride ? `<button class="linkish" data-reset="${esc(row.code)}" style="align-self:end">ล้างการแก้ไข (กลับค่าเดิม)</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('') + '</div>';

    wireMappedCards();
  }

  function wireMappedCards() {
    document.querySelectorAll('#mappedList .mapcard').forEach(card => {
      const code = card.dataset.code;
      card.querySelector('[data-toggleedit]').onclick = e => {
        if (e.target.closest('[data-reset]')) return;
        if (editOpen.has(code)) editOpen.delete(code); else editOpen.add(code);
        renderMappedList(currentUnmapped());
      };
      const stSel = card.querySelector('.js-m-st');
      if (!stSel) return;   // collapsed — no form to wire
      const seSel = card.querySelector('.js-m-se');
      stSel.onchange = () => {
        const secs = sectionsOf(stSel.value);
        seSel.innerHTML = secs.map(s => `<option>${esc(s)}</option>`).join('');
        refreshGroups(card);
      };
      seSel.onchange = () => refreshGroups(card);
      card.querySelector('.save').onclick = e => {
        e.stopPropagation();
        const statement = stSel.value, section = seSel.value;
        const group = card.querySelector('.js-m-gr').value.trim();
        if (!group) { card.querySelector('.js-m-gr').focus(); return; }
        const row = Store.combinedRows(period() ? Store.tbFor(period()) : undefined).find(r => r.code === code);
        Store.setMapping(code, { name: row ? row.name : '', statement, section, group });
        editOpen.delete(code);
        render();
      };
      const resetBtn = card.querySelector('[data-reset]');
      if (resetBtn) resetBtn.onclick = e => {
        e.stopPropagation();
        Store.removeMapping(code);
        editOpen.delete(code);
        render();
      };
    });
  }

  // ---- Note view: same codes, grouped the way the real financial
  // statements number their notes (RULEBOOK.groups is generated in
  // source-workpaper row order — plain numeric-string object-key iteration
  // would sort codes ascending instead). Editing here moves every code in
  // the note at once — reclassify the whole note in one step instead of
  // one code at a time. ----------------------------------------------------
  function effectiveRules() {
    const eff = {};
    for (const [code, rule] of Object.entries(RULEBOOK.rules)) eff[code] = rule;
    for (const [code, rule] of Object.entries(Store.mappings())) eff[code] = rule;
    return eff;
  }

  function orderedNoteGroups() {
    const eff = effectiveRules();
    const known = RULEBOOK.groups.map(g => ({ ...g }));
    const seen = new Set(known.map(g => g.statement + '||' + g.section + '||' + g.group));
    const extra = [];
    for (const rule of Object.values(Store.mappings())) {
      const key = rule.statement + '||' + rule.section + '||' + rule.group;
      if (!seen.has(key)) { seen.add(key); extra.push({ statement: rule.statement, section: rule.section, group: rule.group }); }
    }
    extra.sort((a, b) => (a.statement + a.section + a.group).localeCompare(b.statement + b.section + b.group));

    const byGroup = new Map();
    for (const code in eff) {
      const r = eff[code];
      const key = r.statement + '||' + r.section + '||' + r.group;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(code);
    }

    return known.concat(extra)
      .map(g => ({ ...g, key: g.statement + '||' + g.section + '||' + g.group, codes: (byGroup.get(g.statement + '||' + g.section + '||' + g.group) || []).sort() }))
      .filter(g => g.codes.length);
  }

  function renderNoteList() {
    const groups = orderedNoteGroups().map((g, i) => ({ ...g, note: i + 1 }));
    const q = mappedSearch.trim().toLowerCase();
    const rows = !q ? groups : groups.filter(g =>
      String(g.note) === q || g.group.toLowerCase().includes(q) || g.section.toLowerCase().includes(q) ||
      g.codes.some(c => c.toLowerCase().includes(q)));

    if (!rows.length) {
      $('mappedList').innerHTML = `<div class="map-done" style="padding:24px"><div class="muted">ไม่พบ Note ที่ตรงกับคำค้นหา</div></div>`;
      return;
    }

    const eff = effectiveRules();
    $('mappedList').innerHTML = '<div class="mapstack">' + rows.map(g => {
      const isOpen = noteEditOpen.has(g.key);
      return `<div class="mapcard" data-notekey="${esc(g.key)}">
        <div class="head" style="cursor:pointer" data-togglenote="${esc(g.key)}">
          <span class="code">Note ${g.note}</span>
          <span class="nm">${esc(g.group)}</span>
          <span class="path"><span class="sctn">${esc(g.section)}</span><span class="arw">▸</span><span class="grp">${esc(STATEMENT_LABEL[g.statement] || g.statement)}</span></span>
          <span class="spacer" style="margin-left:auto"></span>
          <span class="muted" style="font-size:12px">${g.codes.length} รหัส</span>
        </div>
        <div style="padding:0 16px 14px">${g.codes.map(c => `<span class="code-pill">${esc(c)}</span>`).join('')}</div>
        ${isOpen ? `<div class="mapform" style="padding:0 16px 16px">
          <div class="fld"><label>Statement</label><select class="js-n-st">${statements.map(s => `<option ${s === g.statement ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="fld"><label>Section</label><select class="js-n-se">${sectionsOf(g.statement).map(s => `<option ${s === g.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="fld"><label>Group (คลิกแล้วพิมพ์เพื่อดูตัวเลือกอื่น)</label><input class="js-n-gr" list="dl-note-${esc(g.key)}" value="${esc(g.group)}" onfocus="this.select()" />
            <datalist id="dl-note-${esc(g.key)}">${groupsOf(g.statement, g.section).map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist></div>
          <button class="btn save">ย้ายทั้ง Note (${g.codes.length} รหัส)</button>
        </div>` : ''}
      </div>`;
    }).join('') + '</div>';

    document.querySelectorAll('#mappedList .mapcard[data-notekey]').forEach(card => {
      const key = card.dataset.notekey;
      const g = groups.find(x => x.key === key);
      card.querySelector('[data-togglenote]').onclick = () => {
        if (noteEditOpen.has(key)) noteEditOpen.delete(key); else noteEditOpen.add(key);
        renderNoteList();
      };
      const stSel = card.querySelector('.js-n-st');
      if (!stSel) return;
      const seSel = card.querySelector('.js-n-se');
      stSel.onchange = () => {
        seSel.innerHTML = sectionsOf(stSel.value).map(s => `<option>${esc(s)}</option>`).join('');
        const dl = card.querySelector('datalist');
        dl.innerHTML = groupsOf(stSel.value, seSel.value).map(x => `<option value="${esc(x)}"></option>`).join('');
      };
      seSel.onchange = () => {
        const dl = card.querySelector('datalist');
        dl.innerHTML = groupsOf(stSel.value, seSel.value).map(x => `<option value="${esc(x)}"></option>`).join('');
      };
      card.querySelector('.save').onclick = () => {
        const statement = stSel.value, section = seSel.value;
        const group = card.querySelector('.js-n-gr').value.trim();
        if (!group) { card.querySelector('.js-n-gr').focus(); return; }
        for (const code of g.codes) {
          const cur = eff[code] || {};
          Store.setMapping(code, { name: cur.name || '', statement, section, group });
        }
        noteEditOpen.delete(key);
        render();
      };
    });
  }

  function refreshGroups(card) {
    const st = card.querySelector('.js-m-st').value;
    const se = card.querySelector('.js-m-se').value;
    const dl = card.querySelector('datalist');
    dl.innerHTML = groupsOf(st, se).map(g => `<option value="${esc(g)}"></option>`).join('');
  }

  function wireCards() {
    document.querySelectorAll('#mapList .mapcard').forEach(card => {
      const stSel = card.querySelector('.js-m-st');
      const seSel = card.querySelector('.js-m-se');
      stSel.onchange = () => {
        const secs = sectionsOf(stSel.value);
        seSel.innerHTML = secs.map(s => `<option>${esc(s)}</option>`).join('');
        refreshGroups(card);
      };
      seSel.onchange = () => refreshGroups(card);
      card.querySelector('.save').onclick = () => {
        const code = card.dataset.code;
        const statement = stSel.value, section = seSel.value;
        const group = card.querySelector('.js-m-gr').value.trim();
        if (!group) { card.querySelector('.js-m-gr').focus(); return; }
        const row = Store.combinedRows(period() ? Store.tbFor(period()) : undefined).find(r => r.code === code);
        Store.setMapping(code, { name: row ? row.name : '', statement, section, group });
        render();  // this code leaves the unmapped list; taxonomy may gain a new group next render
      };
    });
  }

  // Backup / restore of the chart of accounts. Import lands in the override
  // layer, so every per-code edit and "reset to default" still behaves the
  // same afterwards.
  $('exportMapBtn').onclick = () => {
    const payload = Store.exportMappings(RULEBOOK);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chart-of-accounts-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('importMapBtn').onclick = () => $('importMapInput').click();
  $('importMapInput').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const existing = Object.keys(Store.mappings()).length;
    if (existing && !confirm('การโหลดผังจากไฟล์จะแทนที่การแก้ไขเดิมทั้งหมด ' + existing + ' รหัส ต้องการดำเนินการต่อหรือไม่?')) {
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let n;
      try {
        n = Store.importMappings(JSON.parse(reader.result));
      } catch (err) {
        alert('โหลดไฟล์ไม่สำเร็จ: ' + err.message);
        return;
      } finally {
        e.target.value = '';
      }
      alert('โหลดผังบัญชีแล้ว ' + n + ' รหัส');
      render();
    };
    reader.onerror = () => { alert('อ่านไฟล์ไม่ได้'); e.target.value = ''; };
    reader.readAsText(file);
  };

  $('nextBtn').onclick = () => { location.href = 'import.html'; };
  $('themeBtn').onclick = () => { const r = document.documentElement; r.setAttribute('data-theme', r.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
  $('mappedSearch').oninput = e => { mappedSearch = e.target.value; renderMappedSection(currentUnmapped()); };
  $('viewSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
    view = b.dataset.v;
    $('viewSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderMappedSection(currentUnmapped());
  });

  render();
})();
