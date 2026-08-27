/* Shared app shell — renders the sidebar once for every page, so nav lives
   in one place. A page opts in with:  <body data-page="statements">  and
   an empty <aside class="side" id="side"></aside>, then loads this script. */
(function () {
  /* Which build the browser actually has. Every page prints it in the sidebar
     and every app-owned script/stylesheet is requested with it as ?v=, so a
     release can't be half-applied by a cached file — and "is this the new one
     or the old one?" is answerable by looking, not by guessing. Bump this
     string in the same commit as anything worth telling apart. */
  const BUILD = '2026-08-23.15';
  window.APP_BUILD = BUILD;

  /* Nobody signed in? Straight to the sign-in page, before this page paints
     anything. Client-side only — see the note in auth.js about what that
     can and cannot mean — but it is what makes login.html the way in rather
     than a page you could only reach on purpose. */
  if (window.Auth && !Auth.requireSession('login.html')) return;

  const ic = {
    import: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
    tb: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    mapping: '<path d="M8 7h11M8 12h11M8 17h6M4 7h.01M4 12h.01M4 17h.01"/>',
    journals: '<path d="M9 3v18M4 7l5-4 5 4M20 8v13M15 17l5 4"/>',
    conso: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
    statements: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    cashflow: '<path d="M4 19V5m0 14h16M8 15l3-4 3 3 4-6"/>',
    ratios: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    costcenter: '<rect x="3" y="10" width="4" height="10"/><rect x="10" y="6" width="4" height="14"/><rect x="17" y="3" width="4" height="17"/>',
    review: '<path d="M9 12l2 2 4-5M12 3l7 4v5c0 4-3 7-7 9-4-2-7-5-7-9V7z"/>',
  };
  const GROUPS = [
    { label: 'Close cycle', items: [
      ['import', 'Import TB', 'import.html'],
      ['tb', 'Trial Balance', 'tb.html'],
      ['mapping', 'Mapping', 'mapping.html'],
      ['journals', 'Journals', 'journals.html'],
      ['conso', 'Consolidation', 'consolidation.html'],
    ] },
    { label: 'Output', items: [
      ['statements', 'Statements', 'statements.html'],
      ['cashflow', 'Cash Flow', 'cashflow.html'],
      ['ratios', 'Ratios', 'ratios.html'],
      ['costcenter', 'Cost Center', 'costcenter.html'],
      ['review', 'Review', 'review.html'],
    ] },
  ];

  const active = document.body.dataset.page || '';
  const nav = GROUPS.map(g => `
    <nav class="nav-group">
      <div class="nav-label">${g.label}</div>
      <div class="nav">${g.items.map(([key, label, href]) =>
        `<a class="${key === active ? 'on' : ''}" href="${href}">
           <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ic[key]}</svg>${label}</a>`
      ).join('')}</div>
    </nav>`).join('');

  // Whoever is signed in, shown where the hardcoded "Accounting Team" used
  // to sit. Initials come from the name so two people are told apart at a
  // glance on a shared machine.
  const sess = (window.Auth && Auth.session()) || null;
  const who = sess ? sess.name : '';
  const initials = who
    ? who.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : '—';
  // When the session started, not "เข้าสู่ระบบแล้ว" — the name above already
  // says that, and on a machine several people share, how long ago you signed
  // in is the thing worth reading.
  const since = (() => {
    const d = sess && new Date(sess.at);
    return d && !isNaN(d) ? 'เข้าเมื่อ ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'ผู้ใช้งาน';
  })();
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const side = document.getElementById('side');
  if (side) side.innerHTML =
    `<div class="brand"><span class="mark">◈</span><span class="wm">Close Workspace<small>SYNNEX Consolidation</small></span></div>
     ${nav}
     <div class="side-foot">
       <div class="avatar">${esc(initials)}</div>
       <div class="who" title="${esc(who)}">${esc(who || 'ยังไม่ได้เข้าสู่ระบบ')}<small>${esc(since)}</small></div>
       <button class="side-out" id="signOutBtn" title="ออกจากระบบ" aria-label="ออกจากระบบ">
         <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
       </button>
     </div>
     <div class="side-ver" title="เวอร์ชันของไฟล์ที่เบราว์เซอร์โหลดอยู่จริง">build ${BUILD}</div>`;

  const out = document.getElementById('signOutBtn');
  if (out) out.onclick = () => {
    if (!confirm('ออกจากระบบ?\n\nข้อมูลงบที่นำเข้าไว้ยังอยู่ครบ — แค่ต้องเข้าสู่ระบบใหม่')) return;
    Auth.signOut();
    location.replace('login.html');
  };
})();
