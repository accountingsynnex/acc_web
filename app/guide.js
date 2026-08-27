/* The user guide — opens by itself the first time someone reaches the app,
   and is reachable from the sidebar after that.

   Built on <dialog>, not a hand-rolled overlay: the browser gives focus
   containment, Esc to close, inert content behind, and ::backdrop for free,
   and gets them right in ways a div with a high z-index usually does not.

   VERSION is what "the first time" is measured against, not a date. Bump it
   when the guide says something materially new and every user should be
   shown it once more; leave it alone for a typo, or the whole team gets a
   popup for a comma. */
(function () {
  const KEY = 'fs-close-guide-v1';
  const VERSION = 1;

  /* Not on a page that is on its way to the sign-in screen. shell.js has
     already called location.replace() by the time this runs, and popping a
     guide over a page the user is being bounced off is both useless and
     briefly visible. */
  if (window.Auth && !Auth.session()) return;

  const seen = () => {
    try { return Number(localStorage.getItem(KEY)) || 0; } catch (e) { return VERSION; }
  };
  const markSeen = () => { try { localStorage.setItem(KEY, String(VERSION)); } catch (e) { /* ignore */ } };

  const step = (n, page, href, what) =>
    `<li><span class="g-n">${n}</span><div><a href="${href}">${page}</a><p>${what}</p></div></li>`;

  const HTML = `
    <div class="g-head">
      <div>
        <h2>คู่มือการใช้งาน</h2>
        <p>เว็บนี้ทำหน้าที่แทนไฟล์ Conso ใน Excel — นำเข้างบทดลอง แล้วออกงบการเงินรวมให้</p>
      </div>
      <button class="g-x" type="button" data-close aria-label="ปิด">✕</button>
    </div>

    <div class="g-body">
      <section class="g-facts">
        <div><b>ทุกอย่างอยู่ในเบราว์เซอร์เครื่องนี้</b> ไม่มีเซิร์ฟเวอร์ ไม่ได้ส่งข้อมูลออกไปไหน — และไม่ตามไปเครื่องอื่น</div>
        <div><b>คำนวณสดทุกครั้ง</b> แก้ mapping หรือรายการตัดบัญชีแล้ว งบทุกหน้าขยับตามทันที</div>
        <div><b>ไม่มีปุ่ม save</b> ทุกอย่างบันทึกเองอัตโนมัติ</div>
      </section>

      <h3>ลำดับการปิดงบ</h3>
      <ol class="g-steps">
        ${step(1, 'Import TB', 'import.html',
          'ลากไฟล์ Workpaper งบรวมทั้งไฟล์ (.xlsx) มาวาง ระบบแยก TB ทุกบริษัท (SYN · SVP · SYNIN · SWOP) ให้เอง พร้อมอ่านชีต Eliminate / AJE+RJE ไปด้วย · ลากหลายไฟล์พร้อมกันได้ เช่น 12 เดือนทั้งปี แต่ละไฟล์จะกลายเป็นงวดของตัวเอง')}
        ${step(2, 'Trial Balance', 'tb.html',
          'ตรวจว่ายอดที่อ่านเข้ามาครบและตรงกับต้นทาง ก่อนจะไปยุ่งกับอะไรต่อ')}
        ${step(3, 'Mapping', 'mapping.html',
          'ระบบจับคู่รหัสบัญชีเข้ากลุ่มให้อัตโนมัติจาก Rulebook — คุณตรวจเฉพาะ<b>รหัสใหม่ที่ยังไม่เคยเจอ</b> ที่แก้ไว้จะจำไว้ใช้เดือนถัดไป')}
        ${step(4, 'Journals', 'journals.html',
          'รายการตัดบัญชีระหว่างกัน (Eliminate) และรายการปรับปรุง (AJE / RJE) เปิด-ปิดทีละรายการเพื่อดูผลกระทบได้')}
        ${step(5, 'Consolidation', 'consolidation.html',
          'ดูยอดรวมก่อนตัด → รายการตัด → ยอดหลังตัด เรียงให้เห็นทีละขั้น')}
      </ol>

      <h3>ดูผลลัพธ์</h3>
      <ul class="g-out">
        <li><a href="statements.html">Statements</a> งบดุลและงบกำไรขาดทุนรวม</li>
        <li><a href="cashflow.html">Cash Flow</a> งบกระแสเงินสด (วิธีทางอ้อม)</li>
        <li><a href="ratios.html">Ratios</a> อัตราส่วนทางการเงิน + แนวโน้มรายไตรมาส และวงจรเงินสด (AR / Inventory / AP days)</li>
        <li><a href="costcenter.html">Cost Center</a> ค่าใช้จ่ายรายแผนกและศูนย์ต้นทุน เทียบ Budget ได้ถ้านำเข้าไฟล์งบประมาณ</li>
        <li><a href="review.html">Review</a> ตรวจความผิดปกติของงบ · เช็กลิสต์ก่อนปิด · <b>ส่งออก Excel ครบทุกงบ</b></li>
      </ul>

      <h3>เรื่องที่ควรรู้</h3>
      <dl class="g-tips">
        <dt>งวดที่ดูอยู่</dt>
        <dd>กล่องเลือกงวดบนหัวตารางคือตัวกำหนดว่าทุกหน้ากำลังแสดงงวดไหน — <b>งวดปัจจุบัน</b> คืองวดที่กำลังทำงานอยู่ ส่วนงวดอื่นคืองวดที่บันทึกไว้แล้ว เลือกครั้งเดียวใช้ได้ทุกหน้า</dd>

        <dt>แก้ใน Excel แล้วเอากลับเข้ามา</dt>
        <dd>ส่งออกไฟล์จากหน้า Review → แก้ยอดในชีต <b>TB &lt;บริษัท&gt;</b> หรือรายการในชีต <b>Eliminate / AJE+RJE-*</b> → ลากไฟล์กลับมาวางที่หน้า Import ระบบคำนวณงบใหม่ทั้งหมดจากที่แก้ (ชีตงบเป็นผลลัพธ์ ระบบไม่อ่านกลับ) — เก็บไฟล์นั้นไว้ก็ใช้เป็นตัวสำรองข้อมูลได้</dd>

        <dt>Budget</dt>
        <dd>นำเข้าที่หน้า Cost Center · งบเป็นตัวเลขทั้งปี ระบบจะเทียบตามสัดส่วนเดือนที่ผ่านมาให้ (มิ.ย. = 6/12) และสลับดูแบบทั้งปีได้</dd>

        <dt>ตรวจความผิดปกติ</dt>
        <dd>หน้า Review ไล่เช็กงบให้เอง เช่น งบดุลไม่สมดุล · รายการปรับปรุงที่ซ้ำกัน · ยอดที่ขยับผิดปกติจากงวดก่อน · อัตราส่วนที่หลุดเงื่อนไข</dd>

        <dt>พื้นที่เก็บข้อมูล</dt>
        <dd>เบราว์เซอร์จำกัดไว้ราว 5 MB ดูมาตรวัดได้ที่หน้า Import — ถ้าใกล้เต็ม ให้ลบงวดเก่าที่ไม่ได้ใช้ออก ไม่งั้นนำเข้าเพิ่มไม่ได้</dd>
      </dl>
    </div>

    <div class="g-foot">
      <span class="g-note">เปิดคู่มือนี้อีกได้จากปุ่ม <b>คู่มือการใช้งาน</b> ที่แถบข้าง</span>
      <button class="btn" type="button" data-close>เริ่มใช้งาน</button>
    </div>`;

  const dlg = document.createElement('dialog');
  dlg.className = 'guide';
  dlg.setAttribute('aria-label', 'คู่มือการใช้งาน');
  dlg.innerHTML = HTML;
  document.body.appendChild(dlg);

  // Closing by any route counts as read — the ✕, the button, Esc, or a click
  // on the backdrop. Nobody should meet this popup twice by pressing Escape.
  const close = () => { markSeen(); if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', markSeen);
  dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });   // backdrop only
  // A link inside the guide is navigation, so let the page change rather
  // than leaving the guide to reopen on arrival.
  dlg.querySelectorAll('a[href]').forEach(a => { a.onclick = () => markSeen(); });

  function open() {
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('.g-body').scrollTop = 0;
  }
  window.Guide = { open, close };

  // The way back in, in the sidebar the shell has already drawn.
  const side = document.getElementById('side');
  const foot = side && side.querySelector('.side-foot');
  if (foot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-guide';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M4 5a2 2 0 012-2h5v18H6a2 2 0 01-2-2zM20 5a2 2 0 00-2-2h-5v18h5a2 2 0 002-2z"/></svg>คู่มือการใช้งาน`;
    btn.onclick = open;
    side.insertBefore(btn, foot);
  }

  if (seen() < VERSION) open();
})();
