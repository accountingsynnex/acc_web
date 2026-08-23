/* Shared app shell — renders the sidebar once for every page, so nav lives
   in one place. A page opts in with:  <body data-page="statements">  and
   an empty <aside class="side" id="side"></aside>, then loads this script. */
(function () {
  /* Which build the browser actually has. Every page prints it in the sidebar
     and every app-owned script/stylesheet is requested with it as ?v=, so a
     release can't be half-applied by a cached file — and "is this the new one
     or the old one?" is answerable by looking, not by guessing. Bump this
     string in the same commit as anything worth telling apart. */
  const BUILD = '2026-08-23.7';
  window.APP_BUILD = BUILD;

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

  const side = document.getElementById('side');
  if (side) side.innerHTML =
    `<div class="brand"><span class="mark">◈</span><span class="wm">Close Workspace<small>SYNNEX Consolidation</small></span></div>
     ${nav}
     <div class="side-foot"><div class="avatar">AT</div><div class="who">Accounting Team<small>Preparer</small></div></div>
     <div class="side-ver" title="เวอร์ชันของไฟล์ที่เบราว์เซอร์โหลดอยู่จริง">build ${BUILD}</div>`;
})();
