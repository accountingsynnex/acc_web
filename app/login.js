/* The sign-in page. Three states in one card, because they are the same
   question at different moments: a fresh workspace has nobody yet (set up
   the first account), a signed-out one asks who you are, and a signed-in
   one is where accounts are added or a password changed — the only place
   that can be, since adding an account requires already being in. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Where to land after signing in. Only a bare page name from this folder
  // is honoured — ?next= arrives from the URL, so an absolute or
  // cross-origin one would be an open redirect wearing our own door.
  const NEXT = (() => {
    const raw = new URLSearchParams(location.search).get('next') || '';
    return /^[a-z0-9_-]+\.html(\?[^#]*)?$/i.test(raw) ? raw : 'import.html';
  })();

  const say = (el, text, kind) => {
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'login-msg ' + (kind || 'bad');
    el.textContent = text;
  };

  const fmtWhen = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  };

  function show(which) {
    for (const id of ['signInForm', 'setupForm', 'signedIn']) $(id).hidden = id !== which;
    if (which === 'signedIn') paintSignedIn();
    const focus = { signInForm: 'siName', setupForm: 'suName' }[which];
    if (focus) $(focus).focus();
  }

  function paintSignedIn() {
    const s = Auth.session();
    $('whoName').textContent = s ? s.name : '';
    $('whoAt').textContent = s && fmtWhen(s.at) ? `· เข้าเมื่อ ${fmtWhen(s.at)}` : '';
    const users = Auth.users();
    $('userList').innerHTML = `<div class="lu-head">ผู้ใช้บนเครื่องนี้ (${users.length})</div>`
      + users.map(u => {
        const me = s && u.name === s.name;
        return `<div class="lu-row"><span class="lu-name">${esc(u.name)}${me ? ' <span class="lu-me">คุณ</span>' : ''}</span>
          <span class="lu-when">${u.lastLogin ? 'เข้าล่าสุด ' + esc(fmtWhen(u.lastLogin)) : 'ยังไม่เคยเข้า'}</span>
          ${me || users.length < 2 ? '' : `<button class="linkish lu-rm" data-rm="${esc(u.name)}">ลบ</button>`}</div>`;
      }).join('');
  }

  function route() {
    if (Auth.session()) show('signedIn');
    else if (Auth.hasUsers()) show('signInForm');
    else show('setupForm');
  }

  /* PBKDF2 at 150k iterations takes a moment on purpose — that cost is what
     makes a stolen hash expensive to attack — so the button says what is
     happening instead of looking stuck, and cannot be double-submitted. */
  async function busy(btn, label, fn) {
    const was = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = was; }
  }

  $('signInForm').onsubmit = async e => {
    e.preventDefault();
    say($('siMsg'), '');
    await busy($('siBtn'), 'กำลังตรวจสอบ…', async () => {
      try {
        await Auth.signIn($('siName').value, $('siPw').value);
        location.replace(NEXT);
      } catch (err) {
        $('siPw').value = '';
        say($('siMsg'), err.message);
        $('siPw').focus();
      }
    });
  };

  $('setupForm').onsubmit = async e => {
    e.preventDefault();
    say($('suMsg'), '');
    if ($('suPw').value !== $('suPw2').value) { say($('suMsg'), 'รหัสผ่านสองช่องไม่ตรงกัน'); $('suPw2').focus(); return; }
    await busy($('suBtn'), 'กำลังสร้าง…', async () => {
      try {
        await Auth.addUser($('suName').value, $('suPw').value);
        await Auth.signIn($('suName').value, $('suPw').value);
        location.replace(NEXT);
      } catch (err) { say($('suMsg'), err.message); }
    });
  };

  $('goBtn').onclick = () => location.replace(NEXT);
  $('signOutBtn').onclick = () => { Auth.signOut(); $('manage').hidden = true; route(); };

  /* Add-user and change-password share one slot under the buttons rather
     than each getting a page: both are short, both are rare, and both only
     exist for someone already signed in. */
  function panel(html, onSubmit) {
    const box = $('manage');
    box.hidden = false;
    box.innerHTML = `<form class="login-mini">${html}<div class="login-msg" id="mgMsg" hidden></div>
      <div class="mini-act"><button class="btn" type="submit" id="mgBtn">ยืนยัน</button>
      <button class="linkish" type="button" id="mgCancel">ยกเลิก</button></div></form>`;
    box.querySelector('#mgCancel').onclick = () => { box.hidden = true; box.innerHTML = ''; };
    box.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      say($('mgMsg'), '');
      await busy($('mgBtn'), 'กำลังบันทึก…', async () => {
        try {
          await onSubmit();
          box.hidden = true; box.innerHTML = '';
          paintSignedIn();
        } catch (err) { say($('mgMsg'), err.message); }
      });
    };
    const first = box.querySelector('input');
    if (first) first.focus();
  }

  $('addUserBtn').onclick = () => panel(
    `<div class="fld"><label for="nuName">ชื่อผู้ใช้ใหม่</label><input type="text" id="nuName" autocomplete="off" autocapitalize="off" spellcheck="false" required /></div>
     <div class="fld"><label for="nuPw">รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)</label><input type="password" id="nuPw" autocomplete="new-password" required /></div>
     <div class="fld"><label for="nuPw2">ยืนยันรหัสผ่าน</label><input type="password" id="nuPw2" autocomplete="new-password" required /></div>`,
    async () => {
      if ($('nuPw').value !== $('nuPw2').value) throw new Error('รหัสผ่านสองช่องไม่ตรงกัน');
      await Auth.addUser($('nuName').value, $('nuPw').value);
    });

  $('chPwBtn').onclick = () => panel(
    `<div class="fld"><label for="cpOld">รหัสผ่านเดิม</label><input type="password" id="cpOld" autocomplete="current-password" required /></div>
     <div class="fld"><label for="cpNew">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label><input type="password" id="cpNew" autocomplete="new-password" required /></div>
     <div class="fld"><label for="cpNew2">ยืนยันรหัสผ่านใหม่</label><input type="password" id="cpNew2" autocomplete="new-password" required /></div>`,
    async () => {
      if ($('cpNew').value !== $('cpNew2').value) throw new Error('รหัสผ่านใหม่สองช่องไม่ตรงกัน');
      await Auth.changePassword(Auth.session().name, $('cpOld').value, $('cpNew').value);
    });

  $('userList').onclick = e => {
    const btn = e.target.closest('[data-rm]');
    if (!btn) return;
    const name = btn.dataset.rm;
    if (!confirm(`ลบผู้ใช้ "${name}" ออกจากเครื่องนี้?\n\nข้อมูลงบการเงินไม่ถูกลบ — ลบเฉพาะสิทธิ์เข้าใช้งานของคนนี้`)) return;
    try { Auth.removeUser(name); paintSignedIn(); } catch (err) { alert(err.message); }
  };

  // A browser with no Web Crypto (very old, or a non-secure context) cannot
  // hash a password at all. Saying so beats failing silently at submit.
  if (!(window.crypto && crypto.subtle)) {
    document.querySelector('.login-card').innerHTML =
      `<div class="login-form"><h1>เบราว์เซอร์นี้ใช้ไม่ได้</h1>
       <p class="login-sub">เบราว์เซอร์นี้ไม่รองรับ Web Crypto จึงเข้ารหัสรหัสผ่านไม่ได้ — เปิดด้วย Chrome, Edge หรือ Firefox รุ่นปัจจุบันแทน</p></div>`;
  } else route();

  // The build actually loaded, read off this file's own ?v= — this page has
  // no shell.js to ask, and a second hardcoded copy of the number would
  // drift from it the first time only one of them got bumped.
  const src = (document.querySelector('script[src*="login.js"]') || {}).src || '';
  $('loginVer').textContent = 'build ' + ((src.match(/[?&]v=([^&#]+)/) || [])[1] || '—');
})();
