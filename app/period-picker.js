/* Shared "which period am I viewing" picker for the topbar — every page
   except Import (its own switcher WRITES into a period, a different job)
   and Ratios (its own Q1-Q4 quarter resolution, unrelated to this) load
   this. Backed by Store.uiPeriod()/setUiPeriod() so picking a period here
   carries across normal navigation: this app has no client-side router,
   every page load reads Store fresh from localStorage.

   Each page's own script reads Store.uiPeriod() itself wherever it needs
   the periodKey — this file only owns the dropdown and reacts to it. */
(function () {
  const mount = document.getElementById('viewPeriod');
  if (!mount) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wrap = mount.closest('.selectish') || mount;

  // Cost Center is the one page cost-centre periods belong to, so it lists
  // them alongside the ordinary ones; everywhere else they stay out of sight.
  const scope = document.body.dataset.page === 'costcenter' ? 'all' : 'main';
  const allowCC = scope === 'all';

  function paint() {
    const periods = Store.listPeriods(scope);
    // Same allowance as the list: Store.uiPeriod() hands every other page ''
    // for a cost-centre period, so asking without the flag here would reset
    // Cost Center's own dropdown to the live period on every load. Leaving
    // the stored key alone is also what lets Cost Center come back to the
    // month it was last on after a trip through the other pages.
    let current = Store.uiPeriod(allowCC);
    if (current && !periods.some(p => p.key === current)) {
      // The period this was left on got deleted (e.g. from Import's list) —
      // fall back to live rather than silently re-creating an empty period
      // of that name the next time something reads it.
      current = '';
      Store.setUiPeriod('');
    }
    mount.innerHTML = `<option value="">งวดปัจจุบัน (กำลังทำงาน)</option>` +
      periods.map(p => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('');
    mount.value = current;
    wrap.classList.toggle('viewing-archive', !!current);
    wrap.title = current ? `กำลังดูงวดที่บันทึกไว้: ${periods.find(p => p.key === current).label} — ไม่ใช่งวดปัจจุบัน` : '';
  }
  paint();
  mount.onchange = () => { Store.setUiPeriod(mount.value); location.reload(); };
})();
