/* =====================================================================
 * js/feat-profile.js — feature "profile" (โปรไฟล์ของฉัน) → App.register
 *
 * R1b track P1 (R1b-SPEC §4.2, §6.3). One screen, opened from the profile card at the top of เมนู (the core turns
 * that card into a button while this feature is visible), plus the avatar cache that feeds UiKit.avatars for every
 * screen. Uses only App.core (developer note of the registry section in js/app.js) and UiKit; no shared file is
 * touched.
 *
 *  id 'profile' · nav place 'none' · parent 'menu' (header ←, เมนู stays highlighted) · visible while the server
 *  announces 'avatar' or 'password' (core.serverHas). On a Code.gs older than 3.0 nothing is shown and nothing is sent.
 *
 * Screen (sections render only for what the server offers):
 *  - header card: large avatar (with a camera button when 'avatar'), name, group, role
 *  - รูปโปรไฟล์ ('avatar'): choose a picture (native file input: camera or library) → UiKit.image.compress (centre
 *    square, 192 px, ≤ 24,000 base64 characters) → preview → setAvatar; remove (with a confirmation). Every failure has
 *    its own message (not an image / cannot decode e.g. HEIC on a browser without it / too large after compression /
 *    server TOO_LARGE or VALIDATION / offline / connection lost); a logout or an expired session meanwhile shows and
 *    stores nothing.
 *  - รหัสผ่านของฉัน ('password'): masked; "แสดงรหัสผ่าน" asks the server (getMyPassword) on EVERY tap and shows the answer
 *    for 30 s with a countdown and "ซ่อน". The value only ever lives in one text node of this screen: it is never put in
 *    a variable that outlives the call, an attribute, storage, a cache, history or a log, and the node is dropped when
 *    it hides (ซ่อน, timeout, leaving the screen, the app going to the background, logout, a password change).
 *    {stored:false} → one sentence + "ยืนยันรหัสผ่านปัจจุบัน" (confirmPassword: wrong password, lockout, a password that
 *    cannot be stored). "เปลี่ยนรหัสผ่าน" opens the existing sheet (core.openPasswordChange()).
 *  - รูปโปรไฟล์ของทีม (Supervisor + 'avatar'): people with a picture, each with "ลบรูป" (setAvatar {name, data: ''}).
 *
 * Avatar cache (all screens): core.domain('profile', {persist: true}) holds {name: v} of the pictures this device has
 * (its version = the server's versions.profile they belong to; persisted per user in ipd_dom:profile). When the
 * heartbeat's versions.profile is non-empty and differs, getAvatars{known} brings only the changes; pictures go to
 * core.media store 'blobs' as `avatar:<name>` → {user, name, v, mime, data} (survive a restart, work offline until
 * logout) and are published with UiKit.avatars.set(name, blob: URL). Startup restores the cached pictures before the
 * first network answer; a picture missing from the media store is fetched again. An empty server version (no
 * pictures at all) or an old server clears them without a request. reset() (logout, new login, expired session)
 * revokes every URL this file created and drops all state; the core wipes the media stores and the registry.
 *
 * Public surface: none (no provide()). DOM hooks for tests: [data-pf="head|photo|photoBody|photoError|password|pwBody|
 * pwValue|pwCountdown|pwBar|pwError|team|teamBody"], buttons [data-pf-act="…"], #pfPhotoInput, #pfPwConfirm.
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function') return;   // app.js did not start (boot guard): nothing to attach to

  const AVATAR_SIDE = 192;              // R1b-SPEC §0.6: square JPEG, target 192 px
  const AVATAR_CHARS = 24000;           // client bound (the server accepts 30,000)
  const SERVER_CHARS = 30000;           // the largest picture accepted from the server
  const MAX_SIDE = 512;                 // FIX-CL CL-9 (same rule as the server): no picture wider or taller than this
  const MAX_FILE_BYTES = 30 * 1024 * 1024;   // a bigger file is refused before decoding (memory of older phones)
  const REVEAL_MS = 30000;              // how long a revealed password stays on screen
  const MEDIA_STORE = 'blobs';
  const KEY_PREFIX = 'avatar:';
  // CL-9: JPEG only (the app always uploads JPEG; a PNG / WebP could carry a picture that decodes to hundreds of MB)
  const MIMES = ['image/jpeg'];
  const MAGIC = { 'image/jpeg': '/9j/' };
  const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const MASK = '••••••••';
  const NAME_MAX = 100;

  const MSG = {
    preparing: 'กำลังเตรียมรูป…',
    fileTooBig: 'ไฟล์รูปใหญ่เกินไป (เกิน 30 MB) กรุณาเลือกรูปอื่น',
    // FIX-CL CL-24: what to try next (a HEIC photo from some phones cannot be opened by every browser)
    imageFailed: 'เปิดรูปนี้ไม่ได้ (เช่น รูปแบบ HEIC จากบางเครื่อง) — ลองถ่ายภาพหน้าจอของรูปนั้นแล้วเลือกภาพหน้าจอแทน หรือเลือกรูปอื่น',
    photoSaved: '✅ บันทึกรูปโปรไฟล์แล้ว',
    photoRemoved: '🗑️ ลบรูปโปรไฟล์แล้ว',
    noInternet: 'ไม่มีอินเทอร์เน็ต — เชื่อมต่อแล้วลองอีกครั้ง',
    tooLarge: 'เซิร์ฟเวอร์ไม่รับรูปนี้เพราะใหญ่เกินไป กรุณาเลือกรูปอื่น',
    pickAnother: ' กรุณาเลือกรูปอื่น',
    otherBrowser: 'ลองเลือกรูปอื่น หรือเปิดแอปด้วย Chrome หรือ Safari แล้วลองใหม่',
    noJpeg: 'เบราว์เซอร์นี้แปลงรูปให้เป็นแบบที่ระบบรับไม่ได้ — ลองเปิดแอปด้วย Chrome หรือ Safari แล้วเลือกรูปอีกครั้ง',
    viewsNote: 'ทุกครั้งที่กดดูรหัสผ่านจะถูกบันทึกไว้ (Supervisor เห็นในประวัติ) และดูได้ไม่เกิน 5 ครั้งต่อชั่วโมง — ถ้าใช้เครื่องร่วมกับผู้อื่น อย่าลืมออกจากระบบ',
    removeOwn: 'ลบรูปโปรไฟล์ของคุณใช่หรือไม่?\nทุกคนจะเห็นเป็นตัวอักษรย่อแทน',
    removeOther: name => 'ลบรูปโปรไฟล์ของ "' + name + '" ใช่หรือไม่?\nเจ้าของรูปตั้งรูปใหม่เองได้ภายหลัง',
    countdown: s => 'ซ่อนอัตโนมัติใน ' + s + ' วินาที',
    notStored: 'ระบบยังไม่ได้เก็บรหัสผ่านของคุณไว้ให้ดู — ยืนยันรหัสผ่านปัจจุบันหนึ่งครั้ง แล้วครั้งต่อไปจะกดดูได้เลย',
    // FIX-CL CL-19
    pwHint: 'ดูรหัสผ่านของคุณได้ขณะที่ยังเข้าสู่ระบบอยู่ (เช่น เพื่อเข้าใช้บนเครื่องอื่น)',
    forgot: 'จำรหัสไม่ได้? แจ้ง Supervisor ให้รีเซ็ตรหัสผ่าน — ใส่ผิดหลายครั้งจะถูกล็อก 10 นาที',
    masked: 'รหัสผ่านซ่อนอยู่',
    confirmEmpty: 'กรุณากรอกรหัสผ่านปัจจุบัน',
    confirmed: '✅ ยืนยันรหัสผ่านแล้ว',
    confirmedLater: '✅ ยืนยันรหัสผ่านแล้ว — กด "แสดงรหัสผ่าน" เพื่อดู',
    pwOffline: 'ไม่มีอินเทอร์เน็ต — ดูรหัสผ่านได้เมื่อเชื่อมต่ออินเทอร์เน็ต',
    smallPrint: 'รหัสผ่านนี้เก็บไว้ในระบบของหน่วยงาน ผู้ดูแลระบบจึงเห็นได้ — อย่าใช้รหัสเดียวกับที่ใช้ที่อื่น เช่น อีเมลหรือธนาคาร'
  };

  let C = null;                 // App.core (set in init)
  let dom = null;               // core.domain('profile'): data {name: v} of the pictures held on this device
  let root = null;              // the screen's <section>
  let built = false;            // the skeleton exists in root (reset() empties it)
  let ref = {};                 // elements of the skeleton by data-pf name
  let gen = 0;                  // bumped by reset() and purge(): async avatar work of an older generation stops
  let restoring = null;         // promise of the startup restore from the media store (sync waits for it)
  const pub = new Map();        // name → blob: URL this file created and published in UiKit.avatars

  /** The own picture flow. result: {base64, mime, width, height, chars} waiting in the preview. */
  const pic = { seq: 0, busy: false, result: null, url: '', error: '' };
  /** The password card. mode: 'masked' | 'shown' | 'confirm'. The password itself is never kept here. */
  const pw = { seq: 0, mode: 'masked', until: 0, timer: null };

  /* ------------------------------------------------------------------ small helpers */
  function kit() { return C.Kit; }
  function k() { return C.Kit.cls; }
  function esc(s) { return C.esc(s); }
  function icon(name, cls) { return C.Kit.icon(name, cls || 'w-5 h-5'); }
  function norm(name) { return String(name === undefined || name === null ? '' : name).replace(/\s+/g, ' ').trim(); }
  function me() { return C.myName() || (C.state.session ? C.state.session.name : '') || ''; }
  function mediaKey(name) { return KEY_PREFIX + name; }
  function isCurrent() { return built && C.current() === 'profile'; }
  function revoke(url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
  function quiet(p) { return Promise.resolve(p).catch(() => undefined); }
  function apiCode(e) { return e && e.name === 'ApiError' ? e.code : ''; }
  function sessionError(e) { const c = apiCode(e); return c === 'AUTH_REQUIRED' || c === 'PASSWORD_CHANGE_REQUIRED'; }
  function offline() { return navigator.onLine === false; }

  /**
   * A picture as the server (or the media store) describes it — validated BEFORE it is published or stored (CL-9): JPEG
   * base64 with the right magic bytes, a readable frame header and at most MAX_SIDE px per side (read from the header,
   * never decoded).
   */
  function validPicture(name, v, mime, data) {
    return typeof name === 'string' && !!name && name.length <= NAME_MAX &&
      typeof v === 'string' && !!v && v.length <= 200 &&
      MIMES.indexOf(mime) >= 0 &&
      typeof data === 'string' && data.length > 0 && data.length <= SERVER_CHARS && data.length % 4 === 0 &&
      B64.test(data) && data.indexOf(MAGIC[mime]) === 0 && sizeOk(data);
  }

  /** The JPEG frame header is readable and neither side is larger than MAX_SIDE. */
  function sizeOk(data) {
    const s = kit().image.jpegSize ? kit().image.jpegSize(data) : null;
    return !!s && s.width <= MAX_SIDE && s.height <= MAX_SIDE;
  }

  /** The domain's {name: v}, cleaned (a persisted copy is data from localStorage, not trusted blindly). No prototype: a
   *  name such as "constructor" must not hit Object.prototype. */
  function known() {
    const out = Object.create(null);
    const d = dom && dom.data;
    if (!d || typeof d !== 'object') return out;
    Object.keys(d).slice(0, 500).forEach(n => {
      const name = norm(n);
      if (name && name.length <= NAME_MAX && typeof d[n] === 'string' && d[n]) out[name] = d[n];
    });
    return out;
  }
  function holdsAny() { return pub.size > 0 || Object.keys(known()).length > 0 || !!(dom && dom.version); }

  /* ------------------------------------------------------------------ the avatar registry */
  /** Publishes a picture under `name` (a new blob: URL; the previous one of this file is revoked). → bool */
  function publish(name, mime, data) {
    let url;
    try { url = kit().image.toObjectUrl(data, mime); } catch (e) { return false; }
    const old = pub.get(name);
    pub.set(name, url);
    kit().avatars.set(name, url);
    if (old && old !== url) revoke(old);
    return true;
  }

  /** Removes `name`'s picture from the registry (whoever set it) and revokes this file's URL for it. */
  function unpublish(name) {
    const old = pub.get(name);
    pub.delete(name);
    if (kit().avatars.get(name)) kit().avatars.set(name, null);
    if (old) revoke(old);
  }

  function rememberLocal(name, v) {
    dom.touch(d => {
      const next = Object.assign({}, d && typeof d === 'object' ? d : {});
      if (v) next[name] = v; else delete next[name];
      return next;
    });
  }

  /** A picture the server accepted from this device (own upload): registry, media store, known map. */
  function adoptOwn(name, v, mime, data) {
    if (!validPicture(name, v, mime, data) || !publish(name, mime, data)) return;
    quiet(C.media.put(MEDIA_STORE, mediaKey(name), { user: me(), name, v, mime, data }));
    rememberLocal(name, v);
  }

  /** A picture removed by this device (own or, for the Supervisor, someone else's). */
  function dropLocal(name) {
    unpublish(name);
    quiet(C.media.del(MEDIA_STORE, mediaKey(name)));
    rememberLocal(name, '');
  }

  /* ------------------------------------------------------------------ restore at startup, sync on the heartbeat */
  /**
   * A remembered session: the pictures of the known map come back from the media store before the first network
   * answer. Entries of another user, of another version or that are not a valid picture are deleted; known pictures
   * that are missing (e.g. the browser dropped the database) make the domain version '' so the next sync fetches them.
   */
  async function restoreFromMedia(alive, myGen) {
    const want = known();
    const names = Object.keys(want);
    if (!names.length || C.serverMode() === 'old') return;
    const user = me();
    let keys;
    try { keys = await C.media.keys(MEDIA_STORE); } catch (e) { keys = []; }
    if (!alive() || myGen !== gen) return;
    const ours = (keys || []).filter(key => typeof key === 'string' && key.indexOf(KEY_PREFIX) === 0);
    const entries = await Promise.all(ours.map(key => C.media.get(MEDIA_STORE, key).then(v => ({ key, v }), () => ({ key, v: null }))));
    if (!alive() || myGen !== gen) return;
    const have = Object.create(null);
    entries.forEach(({ key, v }) => {
      const ok = !!v && typeof v === 'object' && v.user === user && validPicture(v.name, v.v, v.mime, v.data) &&
        key === mediaKey(v.name) && want[v.name] === v.v;
      if (!ok) { quiet(C.media.del(MEDIA_STORE, key)); return; }
      if (publish(v.name, v.mime, v.data)) have[v.name] = true;
    });
    const missing = names.filter(n => !have[n]);
    if (missing.length) {
      dom.commit(dom.begin(), '', d => {
        const next = Object.assign({}, d && typeof d === 'object' ? d : {});
        missing.forEach(n => { delete next[n]; });
        return next;
      });
    }
  }

  function startRestore() {
    const alive = C.alive(), myGen = gen;
    const p = C.track(restoreFromMedia(alive, myGen).catch(e => console.error('[profile] restoring pictures failed:', e)));
    restoring = p;
    p.then(() => {
      if (restoring !== p) return;
      restoring = null;
      sync();
    });
  }

  /** onStale (every heartbeat while the server's version differs) and after the restore: fetch only the changes. */
  function sync() {
    if (restoring || !dom || !C.state.session || !C.serverHas('avatar')) return;
    if (!dom.remote || dom.remote === dom.version) return;
    dom.load(fetchAvatars);
  }

  /** getAvatars{known} → registry + media store; resolves {version, data} for the domain (null = nothing to apply). */
  async function fetchAvatars() {
    const alive = C.alive(), myGen = gen, user = me();
    const target = dom.remote;
    const have = known();
    const res = await C.call('getAvatars', { known: have });
    if (!alive() || myGen !== gen) return null;
    const next = Object.assign(Object.create(null), have);
    const writes = [];
    const list = res && Array.isArray(res.avatars) ? res.avatars : [];
    const removed = res && Array.isArray(res.removed) ? res.removed : [];
    list.forEach(a => {
      if (!a || typeof a !== 'object' || typeof a.name !== 'string') return;
      const name = norm(a.name);
      if (!name) return;
      if (!validPicture(name, a.v, a.mime, a.data) || !publish(name, a.mime, a.data)) {
        // not something this app shows (wrong type, bad data): no picture for that person until it changes again
        if (next[name] || pub.has(name)) { unpublish(name); writes.push(quiet(C.media.del(MEDIA_STORE, mediaKey(name)))); }
        delete next[name];
        return;
      }
      next[name] = a.v;
      writes.push(quiet(C.media.put(MEDIA_STORE, mediaKey(name), { user, name, v: a.v, mime: a.mime, data: a.data })));
    });
    removed.forEach(n => {
      if (typeof n !== 'string') return;
      const name = norm(n);
      if (!name) return;
      unpublish(name);
      delete next[name];
      writes.push(quiet(C.media.del(MEDIA_STORE, mediaKey(name))));
    });
    await Promise.all(writes);
    if (!alive() || myGen !== gen) return null;
    return { version: target, data: next };
  }

  /** No pictures any more (the server reports an empty version, or it is older than 3.0): drop them, no request. */
  function purge() {
    gen++;
    const names = new Set(Array.from(pub.keys()).concat(Object.keys(known())));
    names.forEach(unpublish);
    dom.commit(dom.begin(), '', () => ({}));
    C.media.keys(MEDIA_STORE).then(keys => {
      (keys || []).forEach(key => { if (typeof key === 'string' && key.indexOf(KEY_PREFIX) === 0) quiet(C.media.del(MEDIA_STORE, key)); });
    }, () => undefined);
  }

  /** After every getData answer (payload {from, to, changed}). */
  function onData(p) {
    if (!p || typeof p !== 'object' || !Object.prototype.hasOwnProperty.call(p, 'changed') || !C.state.session) return;
    const old = C.serverMode() === 'old' || !C.serverHas('avatar');
    if ((old || dom.remote === '') && holdsAny()) purge();
  }

  /* ------------------------------------------------------------------ markup */
  function sectionHead(iconName, tone, id, title, hint) {
    return `<div class="${k().cardHead}"><span class="${k().listIcon} ${tone}">${icon(iconName)}</span>` +
      `<div class="min-w-0 flex-1"><h2 id="${id}" class="${k().titleCard}">${esc(title)}</h2>` +
      `<p class="${k().textMeta}">${esc(hint)}</p></div></div>`;
  }

  function skeletonHtml() {
    const c = k();
    return `<div class="space-y-4 md:max-w-2xl md:mx-auto">` +
      `<section data-pf="head" class="relative bg-white border-2 border-brand-100 rounded-3xl overflow-hidden" aria-label="โปรไฟล์"></section>` +
      `<section data-pf="photo" class="${c.card} relative space-y-3 hidden" aria-labelledby="pfPhotoTitle">` +
      sectionHead('camera', c.listIconBrand, 'pfPhotoTitle', 'รูปโปรไฟล์', 'ทุกคนในทีมจะเห็นรูปนี้ข้างชื่อของคุณ') +
      `<div data-pf="photoBody" class="space-y-3"></div>` +
      `<p data-pf="photoError" class="${c.fieldError} hidden" role="alert"></p>` +
      `<input type="file" id="pfPhotoInput" accept="image/*" class="sr-only" tabindex="-1" aria-hidden="true">` +
      `</section>` +
      `<section data-pf="password" class="${c.card} space-y-3 hidden" aria-labelledby="pfPwTitle">` +
      sectionHead('key', c.listIconSun, 'pfPwTitle', 'รหัสผ่านของฉัน', MSG.pwHint) +
      `<div data-pf="pwBody" class="space-y-3"></div>` +
      // the error line sits here, or — in the confirm state — right under the field (setPwMode moves this node)
      `<p data-pf="pwError" id="pfPwError" class="${c.fieldError} hidden" role="alert"></p>` +
      `<button type="button" data-pf-act="pw-change" class="${c.btn} ${c.btnSecondary} w-full">${icon('lock')}เปลี่ยนรหัสผ่าน</button>` +
      `<p class="flex items-start gap-2 ${c.textCaption}">${icon('info', 'w-4 h-4 shrink-0')}<span class="min-w-0">${esc(MSG.smallPrint)}</span></p>` +
      `<p class="flex items-start gap-2 ${c.textCaption}" data-pf="viewsNote">${icon('eye', 'w-4 h-4 shrink-0')}<span class="min-w-0">${esc(MSG.viewsNote)}</span></p>` +
      `</section>` +
      `<section data-pf="team" class="${c.card} space-y-3 hidden" aria-labelledby="pfTeamTitle">` +
      sectionHead('users', c.listIconLilac, 'pfTeamTitle', 'รูปโปรไฟล์ของทีม', 'Supervisor ลบรูปที่ไม่เหมาะสมได้ (ตั้งรูปแทนคนอื่นไม่ได้)') +
      `<div data-pf="teamBody"></div>` +
      `</section>` +
      `</div>`;
  }

  function groupText() {
    const name = me();
    const u = C.state.user;
    const s = C.staff().filter(x => x.name === name)[0];
    const g = (u && u.group) || (s && s.group) || '';
    return g === 'backup' ? 'ทีมแทนเวร' : g ? 'คนประจำ' : 'ผู้ใช้งาน';
  }

  /** A label that opens the native file picker (camera or library); keyboard: Enter / Space (see onKey). */
  function pickerLabel(cls, inner, aria) {
    return `<label for="pfPhotoInput" role="button" tabindex="0" data-pf-pick class="${cls} cursor-pointer"` +
      (aria ? ` aria-label="${esc(aria)}"` : '') + `>${inner}</label>`;
  }

  function headHtml() {
    const c = k(), name = me();
    const camera = C.serverHas('avatar') && !pic.busy
      ? `<span class="absolute right-0 bottom-0">${pickerLabel(c.iconBtnRound, icon('camera'), 'เปลี่ยนรูปโปรไฟล์')}</span>` : '';
    const role = C.isSup() ? kit().pill('Supervisor', 'pending', 'crown') : kit().pill('เจ้าหน้าที่', 'neutral', 'user');
    return `<div class="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-accent-300 via-lilac-300 to-brand-300" aria-hidden="true">` +
      `<span class="absolute top-3 left-3">${kit().deco('star', 'w-4 h-4 text-white')}</span>` +
      `<span class="absolute top-3 right-3">${kit().deco('heart', 'w-4 h-4 text-white')}</span></div>` +
      `<div class="relative flex flex-col items-center gap-2 px-4 pt-4 pb-4 text-center">` +
      `<div class="relative">${kit().avatar(name, 'xl', { label: true, cls: 'ring-2 ring-white' })}${camera}</div>` +
      `<div class="min-w-0 max-w-full"><p class="${c.titleScreen} break-words">${esc(name || '-')}</p>` +
      `<p class="${c.textMeta}">${esc(groupText())}</p></div>` +
      `<div>${name ? role : ''}</div></div>`;
  }

  function photoHtml() {
    const c = k(), name = me();
    if (pic.busy) {
      return `<div class="flex items-center gap-3" role="status"><span class="${c.avatar} ${c.avatarXl} animate-pulse bg-lilac-100" aria-hidden="true"></span>` +
        `<p class="${c.textBody}">${esc(MSG.preparing)}</p></div>`;
    }
    if (pic.result && pic.url) {
      // CL-23: words, not pixel / KB numbers
      return `<div class="flex items-center gap-4">` +
        `<span class="${c.avatar} ${c.avatarXl} ${c.avatarTint1}" data-initials="" data-pf="preview"><img src="${esc(pic.url)}" alt="ตัวอย่างรูปโปรไฟล์ใหม่" draggable="false"></span>` +
        `<div class="min-w-0 flex-1 space-y-1"><p class="${c.titleCard}">ตัวอย่างรูปใหม่</p>` +
        `<p class="${c.textMeta}">ตัดเป็นสี่เหลี่ยมและย่อขนาดแล้ว พร้อมบันทึก</p>` +
        `<p>${kit().pill('ยังไม่ได้บันทึก', 'pending')}</p></div></div>` +
        `<div class="flex flex-wrap gap-2">` +
        `<button type="button" data-pf-act="photo-save" class="${c.btn} ${c.btnPrimary} flex-1">${icon('check')}บันทึกรูป</button>` +
        `<button type="button" data-pf-act="photo-cancel" class="${c.btn} ${c.btnSecondary} flex-1">ยกเลิก</button></div>` +
        pickerLabel(c.btn + ' ' + c.btnGhost + ' w-full', icon('image') + 'เลือกรูปอื่น');
    }
    const has = !!known()[name];
    return `<div class="flex flex-wrap gap-2">` +
      pickerLabel(c.btn + ' ' + c.btnTonal + ' flex-1', icon('image') + (has ? 'เปลี่ยนรูป' : 'เลือกรูป')) +
      (has ? `<button type="button" data-pf-act="photo-remove" class="${c.btn} ${c.btnSecondary} flex-1">${icon('trash')}ลบรูป</button>` : '') +
      `</div><p class="${c.textCaption}">ถ่ายรูปใหม่หรือเลือกจากคลังภาพ ระบบจะตัดเป็นสี่เหลี่ยมจัตุรัสตรงกลางและย่อขนาดให้เอง</p>`;
  }

  function teamHtml() {
    const c = k(), mine = me(), have = known();
    const names = C.staff().map(s => s.name).filter(n => n !== mine && have[n]);
    if (!names.length) return `<p class="${c.textMeta}">ยังไม่มีใครในทีมตั้งรูปโปรไฟล์</p>`;
    return `<ul class="divide-y divide-brand-100">` + names.map(n =>
      `<li class="flex items-center gap-3 py-2" data-pf-member="${esc(n)}">${kit().avatar(n, 'md')}` +
      `<span class="flex-1 min-w-0 text-sm font-medium leading-6 text-ink-900 break-words">${esc(n)}</span>` +
      // CL-23: a column of coral icons was noisy — the neutral row action (the confirmation is the danger step)
      `<button type="button" data-pf-act="team-remove" data-name="${esc(n)}" class="${c.rowAction}" aria-label="${esc('ลบรูปโปรไฟล์ของ ' + n)}">` +
      `${icon('trash')}<span>ลบรูป</span></button></li>`).join('') + `</ul>`;
  }

  /* ------------------------------------------------------------------ skeleton and render */
  function ensureBuilt() {
    if (built || !root) return;
    root.innerHTML = skeletonHtml();
    ref = {};
    root.querySelectorAll('[data-pf]').forEach(el => { ref[el.getAttribute('data-pf')] = el; });
    ref.file = root.querySelector('#pfPhotoInput');
    built = true;
    setPwMode('masked');
  }

  function renderPhoto() {
    if (!built) return;
    C.setHtml(ref.photoBody, photoHtml());
    ref.file.disabled = pic.busy;
    C.setHtml(ref.photoError, pic.error ? icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5') + `<span class="min-w-0">${esc(pic.error)}</span>` : '');
    C.setVisible(ref.photoError, !!pic.error);
  }

  function renderAll() {
    if (!built) return;
    const av = C.serverHas('avatar'), pwOn = C.serverHas('password');
    C.setHtml(ref.head, headHtml());
    C.setVisible(ref.photo, av);
    renderPhoto();
    if (!pwOn && pw.mode !== 'masked') hidePassword();
    C.setVisible(ref.password, pwOn);
    C.setVisible(ref.team, av && C.isSup());
    if (av && C.isSup()) C.setHtml(ref.teamBody, teamHtml());
  }

  /* ------------------------------------------------------------------ own picture */
  function imageError(e) {
    if (e && e.code === 'decode') return MSG.imageFailed;   // CL-24: the next step to try (HEIC, a broken file)
    if (e && e.code && e.message && typeof e.code === 'string' && apiCode(e) === '') return e.message;   // UiKit's Thai messages
    return MSG.imageFailed;
  }

  function discardPreview() {
    pic.seq++;
    pic.busy = false;
    pic.result = null;
    if (pic.url) revoke(pic.url);
    pic.url = '';
  }

  function setPhotoError(msg) {
    pic.error = msg || '';
    renderPhoto();
  }

  async function onFileChosen(input) {
    const file = input.files && input.files[0];
    input.value = '';   // the same file can be chosen again
    if (!file || !C.serverHas('avatar')) return;
    discardPreview();
    pic.error = '';
    if (file.size > MAX_FILE_BYTES) { setPhotoError(MSG.fileTooBig); return; }
    const alive = C.alive(), my = pic.seq;
    pic.busy = true;
    renderAll();
    let r = null, err = null;
    try {
      r = await C.track(kit().image.compress(file, { square: true, maxSide: AVATAR_SIDE, maxChars: AVATAR_CHARS, mime: 'image/jpeg' }));
    } catch (e) { err = e; }
    if (!alive() || my !== pic.seq) return;
    pic.busy = false;
    // CL-9: the own upload follows the same rule as everything received (a browser that cannot encode JPEG falls back to PNG)
    if (!err && r && r.mime !== 'image/jpeg') { pic.error = MSG.noJpeg; renderAll(); return; }   // the browser fell back to PNG
    if (!err && !(r && MIMES.indexOf(r.mime) >= 0 && typeof r.base64 === 'string' && r.chars <= AVATAR_CHARS && sizeOk(r.base64))) err = new Error('');
    if (err) { pic.error = imageError(err); renderAll(); return; }
    try { pic.url = kit().image.toObjectUrl(r.base64, r.mime); } catch (e) { pic.error = MSG.imageFailed; renderAll(); return; }
    pic.result = r;
    renderAll();
  }

  function writeError(e, retryHint) {
    if (sessionError(e)) return '';   // the core handles the session (logout / forced password change)
    if (!e || e.name !== 'ApiError') return 'เกิดข้อผิดพลาด: ' + ((e && e.message) || String(e));
    if (e.code === 'TOO_LARGE') return MSG.tooLarge;
    if (C.Api.isTransient(e)) return e.code === 'BUSY' ? e.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ' + retryHint;
    // Code.gs 3.0 (BK-5) refuses anything but a JPEG of at most 512 px — the app converts every picture to that, so a refusal
    // means this browser could not: the server's words, then what the user can still try
    if (e.code === 'VALIDATION') return 'บันทึกรูปนี้ไม่ได้: ' + (e.message || 'ไฟล์รูปไม่ถูกต้อง') + ' — ' + MSG.otherBrowser;
    return e.message || 'เกิดข้อผิดพลาด';
  }

  async function savePhoto(btn) {
    const r = pic.result;
    if (!r || !C.serverHas('avatar')) return;
    if (offline()) { setPhotoError(MSG.noInternet); return; }
    const alive = C.alive(), my = pic.seq, name = me();
    let ans = null;
    setPhotoError('');
    await C.withBusy(btn, 'กำลังบันทึก…', async () => {
      try { ans = await C.userCall('setAvatar', { mime: r.mime, data: r.base64 }); }
      catch (e) { if (alive()) setPhotoError(writeError(e, 'ลองกด "บันทึกรูป" อีกครั้ง')); }
    });
    if (!alive() || !ans) return;
    if (my === pic.seq) discardPreview();
    adoptOwn(name, typeof ans.v === 'string' ? ans.v : '', r.mime, r.base64);
    renderAll();
    C.toast(MSG.photoSaved);
  }

  async function removeOwn(btn) {
    const alive = C.alive(), name = me();
    if (!(await C.confirm(MSG.removeOwn, { title: 'ลบรูปโปรไฟล์', danger: true, okLabel: 'ลบรูป', icon: 'trash' }))) return;
    if (!alive() || !built) return;
    if (offline()) { setPhotoError(MSG.noInternet); return; }
    let ok = false;
    setPhotoError('');
    await C.withBusy(btn, 'กำลังลบ…', async () => {
      try { await C.userCall('setAvatar', { mime: '', data: '' }); ok = true; }
      catch (e) { if (alive()) setPhotoError(writeError(e, 'ลองอีกครั้ง')); }
    });
    if (!alive() || !ok) return;
    dropLocal(name);
    renderAll();
    C.toast(MSG.photoRemoved);
  }

  async function removeMember(btn) {
    const name = norm(btn.getAttribute('data-name'));
    if (!name || !C.isSup()) return;
    const alive = C.alive();
    if (!(await C.confirm(MSG.removeOther(name), { title: 'ลบรูปโปรไฟล์', danger: true, okLabel: 'ลบรูป', icon: 'trash' }))) return;
    if (!alive() || !C.isSup()) return;
    if (!C.requireInternet()) return;
    let ok = false;
    await C.withBusy(btn, '…', async () => {
      try { await C.userCall('setAvatar', { name, mime: '', data: '' }); ok = true; }
      catch (e) {
        if (!alive()) return;
        const msg = writeError(e, 'ลองอีกครั้ง');
        if (msg) C.toast('⚠️ ' + msg, 0, { error: true });
      }
    });
    if (!alive() || !ok) return;
    dropLocal(name);
    renderAll();
    C.toast(MSG.photoRemoved);
  }

  /* ------------------------------------------------------------------ own password */
  function pwBodyHtml(mode) {
    const c = k();
    if (mode === 'confirm') {
      // CL-11: a form with the user name (a hidden autocomplete="username" field — the pattern the password managers document), so a password manager never offers to save a password
      // without a user name on a shared phone; the submit is handled in onSubmit (never sent anywhere by the browser).
      // CL-19: what to do when the password is forgotten (and the lockout), the error right under the field.
      return `<div class="${c.note}">${icon('info', 'w-5 h-5 shrink-0 mt-0.5 text-accent-700')}<span class="min-w-0">${esc(MSG.notStored)}</span></div>` +
        `<form data-pf="pwForm" class="space-y-3" action="#" novalidate>` +
        `<input type="text" name="username" autocomplete="username" value="${esc(me())}" readonly hidden>` +
        `<div class="space-y-1.5"><label for="pfPwConfirm" class="${c.label}">ยืนยันรหัสผ่านปัจจุบัน</label>` +
        `<input type="password" id="pfPwConfirm" name="current-password" class="${c.input}" autocomplete="current-password" autocapitalize="off" spellcheck="false" maxlength="64" aria-describedby="pfPwError pfPwForgot">` +
        `<span data-pf-slot="error"></span>` +
        `<p id="pfPwForgot" class="flex items-start gap-1.5 ${c.textMeta}">${icon('info', 'w-4 h-4 shrink-0 mt-0.5')}<span class="min-w-0">${esc(MSG.forgot)}</span></p></div>` +
        `<div class="flex flex-wrap gap-2">` +
        `<button type="button" data-pf-act="pw-confirm" class="${c.btn} ${c.btnPrimary} flex-1">${icon('check')}ยืนยัน</button>` +
        `<button type="button" data-pf-act="pw-cancel" class="${c.btn} ${c.btnSecondary} flex-1">ยกเลิก</button></div></form>`;
    }
    const shown = mode === 'shown';
    const box = shown ? 'bg-sun-50 border-sun-200' : 'bg-ink-50 border-ink-100';
    // CL-19: the revealed value in a monospaced face (0/O and 1/l/I differ, slashed zero); the masked box is read as words,
    // not as a row of bullets
    return `<div class="flex items-center gap-3 px-4 py-3 rounded-2xl border-2 ${box}">` +
      icon(shown ? 'eye' : 'lock', 'w-5 h-5 shrink-0 text-ink-500') +
      (shown
        ? `<span data-pf="pwValue" class="${c.secretValue} flex-1 min-w-0 ${c.wrapAnywhere}" translate="no"></span>`
        : `<span data-pf="pwValue" class="flex-1 min-w-0 font-display text-lg font-medium leading-7 text-ink-500 tracking-wide" aria-hidden="true">${MASK}</span>` +
          `<span class="sr-only">${esc(MSG.masked)}</span>`) + `</div>` +
      (shown
        ? `<div class="space-y-1.5"><p data-pf="pwCountdown" class="${c.textMeta}" role="timer" aria-live="off">${esc(MSG.countdown(Math.round(REVEAL_MS / 1000)))}</p>` +
          `<div class="h-1.5 rounded-full bg-sun-100 overflow-hidden" aria-hidden="true"><div data-pf="pwBar" class="h-full rounded-full bg-sun-500" style="width:100%"></div></div></div>` +
          `<button type="button" data-pf-act="pw-hide" class="${c.btn} ${c.btnSecondary} w-full">${icon('eye-off')}ซ่อน</button>`
        : `<button type="button" data-pf-act="pw-show" class="${c.btn} ${c.btnTonal} w-full">${icon('eye')}แสดงรหัสผ่าน</button>`);
  }

  /**
   * Rebuilds the password body (the old nodes — a shown password or a typed one included — are dropped). The error line
   * moves under the field in the confirm state and back under the body otherwise (CL-19). CL-15: when the focus was on a
   * control of the old body (now gone), it moves to `focusSel` of the new one (else to the card's first button).
   */
  function setPwMode(mode, focusSel) {
    pw.mode = mode;
    if (!built) return;
    const active = document.activeElement;
    const hadFocus = !!active && (ref.pwBody.contains(active) || active === document.body);
    if (ref.pwError && ref.pwBody.contains(ref.pwError)) ref.pwBody.parentNode.insertBefore(ref.pwError, ref.pwBody.nextSibling);
    ref.pwBody.innerHTML = pwBodyHtml(mode);
    ['pwValue', 'pwCountdown', 'pwBar'].forEach(n => { ref[n] = ref.pwBody.querySelector('[data-pf="' + n + '"]'); });
    const slot = ref.pwBody.querySelector('[data-pf-slot="error"]');
    if (slot && ref.pwError) slot.replaceWith(ref.pwError);
    if (hadFocus && isCurrent() && focusSel !== false) {
      const target = (focusSel && ref.pwBody.querySelector(focusSel)) || ref.pwBody.querySelector('button');
      if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
    }
  }

  /**
   * FIX-CL CL-11: the message of a failed reveal / confirm. RATE_LIMITED (the server allows a few views per hour) says when to
   * try again: from the error's details (retryAt: ISO time, or retryAfter / retryAfterSec / retryAfterMs) when the server
   * gives them, else the server's own Thai message, else "within an hour".
   */
  function pwErrorText(e) {
    if (!e || e.name !== 'ApiError') return 'เกิดข้อผิดพลาด';
    if (e.code !== 'RATE_LIMITED') return e.message || 'เกิดข้อผิดพลาด';
    // Code.gs 3.0 (BK-4): details {retryAt: ISO} — the clock time is shown as it is (never "in N minutes": the phone's
    // clock may differ from the server's); the other keys are accepted for a later server
    const d = e.details && typeof e.details === 'object' ? e.details : {};
    let at = NaN;
    if (typeof d.retryAt === 'string' || typeof d.retryAt === 'number') at = new Date(d.retryAt).getTime();
    else if (Number(d.retryAfterMs) > 0) at = Date.now() + Number(d.retryAfterMs);
    else if (Number(d.retryAfterSec) > 0) at = Date.now() + Number(d.retryAfterSec) * 1000;
    else if (Number(d.retryAfter) > 0) at = Date.now() + Number(d.retryAfter) * (Number(d.retryAfter) > 10000 ? 1 : 1000);
    const head = 'ดูรหัสผ่านได้ไม่เกิน 5 ครั้งต่อชั่วโมง ระบบจึงพักการแสดงรหัสผ่านไว้ชั่วคราว';
    if (isFinite(at)) {
      const t = new Date(at);
      const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      return head + ' — ลองใหม่ได้หลังเวลา ' + hhmm + ' น.';
    }
    const own = String(e.message || '');
    if (/[฀-๿]/.test(own) && /\d/.test(own)) return own;   // the server's Thai message already says when
    return head + ' — ลองใหม่ได้ภายใน 1 ชั่วโมง';
  }

  function setPwError(msg) {
    if (!built) return;
    ref.pwError.innerHTML = msg ? icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5') + `<span class="min-w-0">${esc(msg)}</span>` : '';
    C.setVisible(ref.pwError, !!msg);
  }

  /** Hides a shown password at once (and cancels a reveal still waiting for the server). */
  function hidePassword() {
    pw.seq++;
    clearTimeout(pw.timer);
    pw.timer = null;
    pw.until = 0;
    if (pw.mode === 'shown') setPwMode('masked', '[data-pf-act="pw-show"]');
  }

  function leaveConfirm() {
    if (pw.mode === 'confirm') setPwMode('masked', '[data-pf-act="pw-show"]');
  }

  /** Shows `value` in the one text node of the shown state for REVEAL_MS (the countdown runs). */
  function showPassword(value) {
    setPwMode('shown', '[data-pf-act="pw-hide"]');
    ref.pwValue.textContent = value;
    pw.until = Date.now() + REVEAL_MS;
    tick();
  }

  function tick() {
    clearTimeout(pw.timer);
    pw.timer = null;
    if (pw.mode !== 'shown') return;
    const left = pw.until - Date.now();
    if (left <= 0) { hidePassword(); return; }
    if (ref.pwCountdown) ref.pwCountdown.textContent = MSG.countdown(Math.ceil(left / 1000));
    if (ref.pwBar) ref.pwBar.style.width = Math.max(0, Math.min(100, left / REVEAL_MS * 100)).toFixed(1) + '%';
    pw.timer = setTimeout(tick, Math.min(1000, left));
  }

  async function revealPassword(btn) {
    if (!C.serverHas('password')) return;
    hidePassword();
    setPwError('');
    if (offline()) { setPwError(MSG.pwOffline); return; }
    const alive = C.alive(), my = pw.seq;
    let data = null;
    await C.withBusy(btn, 'กำลังโหลด…', async () => {
      try { data = await C.userCall('getMyPassword', {}); }
      catch (e) {
        if (!alive() || my !== pw.seq || sessionError(e)) return;
        setPwError(pwErrorText(e));
      }
    });
    // left the screen, hid, logged out, the app went to the background, a sheet opened over the screen or the session ended
    // while waiting: the answer is dropped unseen
    if (!data || !alive() || my !== pw.seq || !isCurrent() || !canShowSecret()) return;
    if (data.stored === true && typeof data.password === 'string' && data.password) {
      showPassword(data.password);
    } else if (data.stored === false) {
      setPwMode('confirm', '#pfPwConfirm');
    }
  }

  async function confirmPassword(btn) {
    const input = built ? ref.pwBody.querySelector('#pfPwConfirm') : null;
    if (!input) return;
    const value = input.value;
    if (!value.trim()) { setPwError(MSG.confirmEmpty); return; }
    if (offline()) { setPwError(MSG.pwOffline); return; }
    const alive = C.alive(), my = pw.seq;
    let ok = false;
    setPwError('');
    await C.withBusy(btn, 'กำลังยืนยัน…', async () => {
      try { await C.userCall('confirmPassword', { password: value }); ok = true; }
      catch (e) {
        if (!alive() || sessionError(e)) return;
        setPwError(pwErrorText(e));
      }
    });
    if (input.isConnected) input.value = '';   // typed passwords never stay in the page
    if (!alive() || !ok || !isCurrent() || pw.mode !== 'confirm') return;
    // the same lifetime rule as a reveal (reviewer 2 finding 4): after the app went to the background, a sheet opened over the
    // screen or a hide meanwhile, the password is not drawn — the confirm worked, the next tap shows it
    if (my !== pw.seq || !canShowSecret()) {
      setPwMode('masked', false);
      C.toast(MSG.confirmedLater);
      return;
    }
    // CL-19: the server accepted it as the current password — show it directly (no second tap, no extra request)
    showPassword(value);
    C.toast(MSG.confirmed);
  }

  /** A password may be drawn only while the app is in the foreground and no sheet or dialog covers the screen. */
  function canShowSecret() {
    if (document.visibilityState === 'hidden' || document.hidden) return false;
    const top = C.Kit.sheet && typeof C.Kit.sheet.top === 'function' ? C.Kit.sheet.top() : null;
    return !top;
  }

  /* ------------------------------------------------------------------ events */
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-pf-act]') : null;
    if (!b || !root || !root.contains(b) || b.disabled) return;
    switch (b.getAttribute('data-pf-act')) {
      case 'photo-save': C.spawn(() => savePhoto(b)); break;
      case 'photo-cancel': discardPreview(); pic.error = ''; renderAll(); break;
      case 'photo-remove': C.spawn(() => removeOwn(b)); break;
      case 'team-remove': C.spawn(() => removeMember(b)); break;
      case 'pw-show': C.spawn(() => revealPassword(b)); break;
      case 'pw-hide': hidePassword(); break;
      case 'pw-confirm': C.spawn(() => confirmPassword(b)); break;
      case 'pw-cancel': setPwError(''); setPwMode('masked', '[data-pf-act="pw-show"]'); break;
      case 'pw-change': hidePassword(); leaveConfirm(); setPwError(''); C.openPasswordChange(); break;
      default: break;
    }
  }

  function onKey(e) {
    if (e.defaultPrevented) return;
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-pf-pick') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      if (ref.file && !ref.file.disabled) ref.file.click();
    } else if (t && t.id === 'pfPwConfirm' && e.key === 'Enter') {
      e.preventDefault();
      const b = ref.pwBody && ref.pwBody.querySelector('[data-pf-act="pw-confirm"]');
      if (b && !b.disabled) C.spawn(() => confirmPassword(b));
    }
  }

  function onChange(e) {
    if (e.target && e.target.id === 'pfPhotoInput') C.spawn(() => onFileChosen(e.target));
  }

  /** The confirm form is never submitted by the browser: Enter / a password manager's submit runs the confirm instead. */
  function onSubmit(e) {
    const form = e.target;
    if (!form || form.getAttribute('data-pf') !== 'pwForm') return;
    e.preventDefault();
    const b = ref.pwBody && ref.pwBody.querySelector('[data-pf-act="pw-confirm"]');
    if (b && !b.disabled) C.spawn(() => confirmPassword(b));
  }

  /** The app goes to the background (app switcher, lock screen): a shown password hides first. */
  function onPageHidden() {
    if (document.visibilityState === 'hidden' || document.hidden) hidePassword();
  }

  /* ------------------------------------------------------------------ registration */
  App.register({
    id: 'profile',
    title: 'โปรไฟล์ของฉัน',
    icon: 'user',
    nav: { place: 'none' },
    parent: 'menu',
    visible: c => c.serverHas('avatar') || c.serverHas('password'),

    init(c) {
      C = c;
      dom = c.domain('profile', { persist: true, empty: {} });
      dom.onStale(() => sync());
      c.on('login', p => { if (p && p.restored) startRestore(); });
      c.on('data', onData);
      document.addEventListener('visibilitychange', onPageHidden);
      window.addEventListener('pagehide', () => hidePassword());
      // FIX-CL CL-8: any sheet or dialog that opens over the screen (the forced password change after
      // PASSWORD_CHANGE_REQUIRED, the change-password sheet, a question) hides a shown password at once
      if (c.Kit.sheet && typeof c.Kit.sheet.onChange === 'function') {
        // …and an answer still on its way is dropped (hidePassword bumps pw.seq): nothing is drawn behind a sheet (reviewer 2)
        c.Kit.sheet.onChange((stack, ev) => { if (ev && ev.type === 'open') hidePassword(); });
      }
      if (c.state.session) startRestore();   // registered after the session started (late registration)
    },

    mount(el) {
      root = el;
      root.addEventListener('click', onClick);
      root.addEventListener('keydown', onKey);
      root.addEventListener('change', onChange);
      root.addEventListener('submit', onSubmit);
    },

    render(el) {
      root = el;
      ensureBuilt();
      renderAll();
    },

    show() {
      ensureBuilt();
      renderAll();
    },

    hide() {
      hidePassword();
      leaveConfirm();
      setPwError('');
      if (pic.result || pic.busy) { discardPreview(); pic.error = ''; renderPhoto(); }
    },

    canLeave() {
      return pic.result ? 'ยังไม่ได้บันทึกรูปโปรไฟล์ที่เลือกไว้ — ออกจากหน้านี้หรือไม่?' : true;
    },

    reset() {
      gen++;
      hidePassword();
      pw.mode = 'masked';
      discardPreview();
      pic.error = '';
      restoring = null;
      pub.forEach(url => revoke(url));   // the core clears UiKit.avatars right after the resets
      pub.clear();
      if (root) root.innerHTML = '';
      built = false;
      ref = {};
    }
  });
})();
