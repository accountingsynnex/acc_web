/* Sign-in for the workspace — one shared account, defined in auth-config.js.

   One credential for the whole team, not an account per machine: the team
   is small, the workspace is per-browser anyway, and a per-machine account
   meant every new laptop started with a setup step and every forgotten
   password meant clearing site data. A fixed pair means the same thing
   works everywhere on day one, and changing it is one commit.

   What it can and cannot do is written at the top of auth-config.js and
   repeated under the form on the sign-in page: the site is static and the
   repository public, so this stops whoever wanders past an open browser,
   not whoever is after the data.

   The password itself is not in the repository — auth-config.js carries a
   PBKDF2-SHA256 hash at 150k iterations over a fixed salt, and what the
   user types is hashed the same way and compared. Only the session lives
   in localStorage, under its own key so Store.clearAll() ("ล้างข้อมูล
   ทั้งหมด" on the Import page) means the workspace, not the sign-in. */
(function (global) {
  const KEY = 'fs-close-auth-v1';
  const LOCK_AFTER = 5;              // wrong passwords before a cool-off
  const LOCK_MS = 30000;

  const enc = new TextEncoder();
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const unhex = s => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));
  // Compared to the end regardless of where it first differs — a
  // length-of-match timing signal is cheap to remove, so remove it.
  const sameHex = (a, b) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  // "synnex", "SYNNEX" and " Synnex " are the same login — the name is a
  // label the team shares, not something to get exactly right under stress.
  const norm = s => String(s || '').trim().toLowerCase();

  const Auth = {
    data: { session: null, fails: 0, lockUntil: null },

    cfg() { return global.AUTH_CONFIG || null; },
    /* The name to type, for the form to show. Deliberately not a secret:
       it is printed on the sign-in page, because a shared login nobody can
       remember the name of just becomes a sticky note on the monitor. */
    userName() { return (this.cfg() || {}).user || ''; },

    load() {
      try { const s = localStorage.getItem(KEY); if (s) this.data = JSON.parse(s); } catch (e) { /* ignore */ }
      if (!this.data || typeof this.data !== 'object') this.data = {};
      if (!('session' in this.data)) this.data.session = null;
      return this;
    },
    persist() {
      if (typeof localStorage === 'undefined') return false;
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { return false; }
    },

    async hash(password, saltHex, iter) {
      const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: unhex(saltHex), iterations: iter || 150000, hash: 'SHA-256' }, key, 256);
      return hex(bits);
    },

    /* Milliseconds still to wait after too many wrong passwords. Kept in
       localStorage rather than memory so closing the tab does not reset it. */
    lockedFor() {
      if (!this.data.lockUntil) return 0;
      return Math.max(0, new Date(this.data.lockUntil).getTime() - Date.now());
    },

    async signIn(name, password) {
      const cfg = this.cfg();
      if (!cfg || !cfg.hash) throw new Error('ยังไม่ได้ตั้งรหัสผ่านในไฟล์ auth-config.js');
      const wait = this.lockedFor();
      if (wait) throw new Error(`ใส่รหัสผิดหลายครั้งเกินไป — รออีก ${Math.ceil(wait / 1000)} วินาที`);

      const okName = norm(name) === norm(cfg.user);
      const okPw = sameHex(await this.hash(password, cfg.salt, cfg.iter), cfg.hash);
      // A wrong name and a wrong password fail identically: telling them
      // apart would hand half the answer to whoever is guessing.
      if (!okName || !okPw) {
        this.data.fails = (this.data.fails || 0) + 1;
        if (this.data.fails >= LOCK_AFTER) { this.data.lockUntil = new Date(Date.now() + LOCK_MS).toISOString(); this.data.fails = 0; }
        this.persist();
        throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      }

      this.data.fails = 0; this.data.lockUntil = null;
      this.data.session = { name: cfg.user, at: new Date().toISOString() };
      this.persist();
      return this.data.session;
    },

    session() { return this.data.session || null; },
    signOut() { this.data.session = null; this.persist(); },

    /* Called by the shell on every page: no session, no page — off to the
       sign-in and back here afterwards. Client-side, so it is the door and
       not the wall; see the note at the top. */
    requireSession(loginHref) {
      if (this.session()) return true;
      const here = location.pathname.split('/').pop() || 'index.html';
      location.replace((loginHref || 'login.html') + '?next=' + encodeURIComponent(here + location.search));
      return false;
    },
  };

  Auth.load();
  global.Auth = Auth;
})(window);
