/* Sign-in for the workspace — accounts and the current session.

   What this is honestly for: this app is a static site with no server, so
   everything it holds lives in this browser's localStorage. A sign-in here
   cannot keep a determined person out of that data — they can read the
   files, open devtools, or type a page's URL directly. What it does do is
   put a name on the close and stop a passer-by at a shared machine from
   landing straight in the numbers. Treat it as the lock on an office door,
   not as encryption.

   Passwords are never stored. Each account keeps a random 16-byte salt and
   a PBKDF2-SHA256 hash at 150k iterations, so the stored value cannot be
   read back into a password and two people who pick the same one still get
   different hashes.

   Kept under its own localStorage key, deliberately: Store.clearAll() wipes
   the workspace, and signing every user out plus deleting their accounts is
   not what "ล้างข้อมูลทั้งหมด" means. */
(function (global) {
  const KEY = 'fs-close-auth-v1';
  const ITER = 150000;
  const LOCK_AFTER = 5;              // failed attempts before a cool-off
  const LOCK_MS = 30000;

  const enc = new TextEncoder();
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const unhex = s => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));
  // Compared byte by byte to the end regardless of where it first differs —
  // a length-of-match timing signal is cheap to remove, so remove it.
  const sameHex = (a, b) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };

  // Account names are matched case- and space-insensitively ("Somchai" is
  // the same person as "somchai"), but shown back the way they were typed.
  const idOf = name => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const Auth = {
    data: { users: {}, session: null },

    load() {
      try { const s = localStorage.getItem(KEY); if (s) this.data = JSON.parse(s); } catch (e) { /* ignore */ }
      if (!this.data || typeof this.data !== 'object') this.data = {};
      if (!this.data.users) this.data.users = {};
      if (!('session' in this.data)) this.data.session = null;
      return this;
    },
    persist() {
      if (typeof localStorage === 'undefined') return false;
      try { localStorage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { return false; }
    },

    async hash(password, saltHex) {
      const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: unhex(saltHex), iterations: ITER, hash: 'SHA-256' }, key, 256);
      return hex(bits);
    },

    users() { return Object.values(this.data.users).map(u => ({ name: u.name, createdAt: u.createdAt, lastLogin: u.lastLogin })); },
    hasUsers() { return Object.keys(this.data.users).length > 0; },
    userCount() { return Object.keys(this.data.users).length; },

    /* Adding an account. The first one is the setup step on a fresh
       workspace; after that only someone already signed in adds another, so
       an unattended browser cannot quietly grow a second way in. */
    async addUser(name, password) {
      const id = idOf(name);
      if (!id) throw new Error('ใส่ชื่อผู้ใช้ด้วย');
      if (String(password || '').length < 6) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
      if (this.data.users[id]) throw new Error(`มีผู้ใช้ชื่อ "${this.data.users[id].name}" อยู่แล้ว`);
      if (this.hasUsers() && !this.session()) throw new Error('ต้องเข้าสู่ระบบก่อนถึงจะเพิ่มผู้ใช้ได้');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      this.data.users[id] = {
        name: String(name).trim(), salt, iter: ITER,
        hash: await this.hash(password, salt),
        createdAt: new Date().toISOString(), lastLogin: null,
      };
      this.persist();
      return this.data.users[id].name;
    },

    async changePassword(name, oldPassword, newPassword) {
      const u = this.data.users[idOf(name)];
      if (!u) throw new Error('ไม่พบผู้ใช้นี้');
      if (!sameHex(await this.hash(oldPassword, u.salt), u.hash)) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
      if (String(newPassword || '').length < 6) throw new Error('รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
      u.salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      u.iter = ITER;
      u.hash = await this.hash(newPassword, u.salt);
      this.persist();
    },

    removeUser(name) {
      const id = idOf(name);
      if (!this.data.users[id]) throw new Error('ไม่พบผู้ใช้นี้');
      if (this.userCount() < 2) throw new Error('ลบไม่ได้ — ต้องเหลือผู้ใช้อย่างน้อย 1 คน');
      delete this.data.users[id];
      if (this.session() && idOf(this.session().name) === id) this.signOut();
      this.persist();
    },

    /* How long the cool-off after too many wrong passwords still has to run,
       in ms. Counted per account and kept in the same store, so closing the
       tab does not reset it. */
    lockedFor(name) {
      const u = this.data.users[idOf(name)];
      if (!u || !u.lockUntil) return 0;
      return Math.max(0, new Date(u.lockUntil).getTime() - Date.now());
    },

    async signIn(name, password) {
      const u = this.data.users[idOf(name)];
      // A wrong name and a wrong password fail the same way on purpose:
      // telling them apart would confirm who has an account here.
      const fail = () => { throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); };
      if (!u) fail();
      const wait = this.lockedFor(name);
      if (wait) throw new Error(`ใส่รหัสผิดหลายครั้งเกินไป — รออีก ${Math.ceil(wait / 1000)} วินาที`);
      if (!sameHex(await this.hash(password, u.salt), u.hash)) {
        u.fails = (u.fails || 0) + 1;
        if (u.fails >= LOCK_AFTER) { u.lockUntil = new Date(Date.now() + LOCK_MS).toISOString(); u.fails = 0; }
        this.persist();
        fail();
      }
      u.fails = 0; delete u.lockUntil;
      u.lastLogin = new Date().toISOString();
      this.data.session = { name: u.name, at: u.lastLogin };
      this.persist();
      return this.data.session;
    },

    session() { return this.data.session || null; },
    signOut() { this.data.session = null; this.persist(); },

    /* Called by the shell on every page. Sends anyone without a session to
       the sign-in page and stops the page rendering behind it. Client-side,
       so it is a door and not a wall — see the note at the top. */
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
