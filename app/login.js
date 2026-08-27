/* The sign-in page. Two states in one card: the form when signed out, and
   who-you-are when signed in — the second one exists so that landing here
   with a live session is a way back into the app rather than a dead end. */
(function () {
  const $ = id => document.getElementById(id);

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
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  };

  function route() {
    const s = Auth.session();
    $('signInForm').hidden = !!s;
    $('signedIn').hidden = !s;
    if (s) {
      $('whoName').textContent = s.name;
      $('whoAt').textContent = fmtWhen(s.at) ? `· เข้าเมื่อ ${fmtWhen(s.at)}` : '';
    } else {
      // The shared user name is prefilled, not a memory test: it is printed
      // on this page either way, and the password is the part that matters.
      $('siName').value = Auth.userName();
      ($('siName').value ? $('siPw') : $('siName')).focus();
    }
  }

  /* PBKDF2 at 150k iterations takes a moment on purpose — that cost is what
     makes the hash expensive to attack — so the button says what is
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

  $('goBtn').onclick = () => location.replace(NEXT);
  $('signOutBtn').onclick = () => { Auth.signOut(); route(); };

  // A browser with no Web Crypto (very old, or a non-secure context) cannot
  // hash a password at all. Saying so beats failing silently at submit.
  if (!(window.crypto && crypto.subtle)) {
    document.querySelector('.login-card').innerHTML =
      `<div class="login-form"><h1>เบราว์เซอร์นี้ใช้ไม่ได้</h1>
       <p class="login-sub">เบราว์เซอร์นี้ไม่รองรับ Web Crypto จึงตรวจรหัสผ่านไม่ได้ — เปิดด้วย Chrome, Edge หรือ Firefox รุ่นปัจจุบันแทน</p></div>`;
  } else route();

  // The build actually loaded, read off this file's own ?v= — this page has
  // no shell.js to ask, and a second hardcoded copy of the number would
  // drift from it the first time only one of them got bumped.
  const src = (document.querySelector('script[src*="login.js"]') || {}).src || '';
  $('loginVer').textContent = 'build ' + ((src.match(/[?&]v=([^&#]+)/) || [])[1] || '—');
})();
