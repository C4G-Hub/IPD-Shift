/* =====================================================================
 * js/app.js — state, rendering and event handlers → window.App
 *
 * Rules of the house (see SPEC §6):
 *  - The JS `state` object is the single source of truth. The DOM is only
 *    ever written from state; handlers never read data back from the DOM
 *    (except the value the user just picked/typed in the control they used).
 *  - Every user-derived string goes through esc() before touching innerHTML.
 *    No inline handlers; events are delegated via data-* attributes; CSS
 *    selectors are never built from names.
 *  - Calendar dates come from Utils (local time) — never toISOString().
 *  - A failed request does not make the app "offline": Api retries transient failures itself, the
 *    connection state (state.conn) turns 'reconnecting' and only 3 failed calls in a row (or the device
 *    reporting no network) make it 'offline'. Writes are refused locally only without a network.
 * ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* boot guard (R1a fix A-F1) — before anything touches Utils/UiKit     */
  /* ------------------------------------------------------------------ */
  /*
   * During an update the v2.2 service worker (stale-while-revalidate, file by file) can pair this file with a page
   * it was not built for: an old cached index.html (no js/ui-kit.js, no new shell markup), or a page whose other
   * scripts did not load (offline). Then this file must not throw: it shows "กำลังอัปเดตแอป…" and recovers.
   *  - The new index.html has an inline boot guard (window.__ipdBoot): hand over to it (it re-checks the files and
   *    reloads when they answer).
   *  - An old index.html has none: show the same message here, ask the service worker to update, fetch the page
   *    with cache:'reload' (which also refreshes the old worker's copy) and reload once the answer is this
   *    release's page, or when a new worker takes control. Automatic reloads share the sessionStorage counter
   *    ipd_boot_retry with the inline guard: after 2 only the "โหลดใหม่" button remains. init() clears the counter.
   * APP_BUILD = sw.js VERSION = the ?v= of index.html's scripts = js/api.js CLIENT_VERSION (tests/sw.test.js).
   */
  const APP_BUILD = '3.4.1';
  const BOOT_RETRY_KEY = 'ipd_boot_retry';
  // R1b: also a page of another release (its inline guard names its own build, e.g. a v2.9 index.html served from the HTTP cache
  // whose ?v=2.9.0 URLs now answer with these files): its markup is not this release's — the guard of that page takes over
  const otherPage = !!(window.__ipdBoot && window.__ipdBoot.build && window.__ipdBoot.build !== APP_BUILD);
  // R2: js/plan-engine.js (loaded before this file) is part of the release too — without it the plan screens cannot work
  if (otherPage || !window.UiKit || !window.Utils || !window.Api || !window.PlanEngine || !document.getElementById('appShell') || !document.getElementById('navDock')) {
    try { bootRescue(); } catch (e) { /* never throw from the guard */ }
    return;
  }

  function bootRescue() {
    if (window.__ipdBoot && typeof window.__ipdBoot.fail === 'function') { window.__ipdBoot.fail('host'); return; }
    const MAX_AUTO = 2, POLL_MS = 5000;
    let timer = 0, reloading = false;
    const tries = () => { try { return parseInt(sessionStorage.getItem(BOOT_RETRY_KEY), 10) || 0; } catch (e) { return MAX_AUTO; } };
    const reloadPage = () => { if (typeof window.__ipdTestReload === 'function') window.__ipdTestReload(); else location.reload(); };
    const note = () => {
      const el = document.getElementById('bootUpdateNote');
      if (el) el.textContent = tries() >= MAX_AUTO ? 'ถ้ายังไม่หาย แตะ "โหลดใหม่"' : 'แอปจะโหลดใหม่เองเมื่อเชื่อมต่อได้';
    };
    const autoReload = () => {
      if (reloading) return;
      const n = tries();
      if (n >= MAX_AUTO) { note(); return; }
      try { sessionStorage.setItem(BOOT_RETRY_KEY, String(n + 1)); } catch (e) { note(); return; }
      reloading = true;
      clearTimeout(timer);
      reloadPage();
    };
    // the message: plain inline styles (the stylesheet of the old page may not match this release)
    let box = document.getElementById('bootUpdate');
    if (!box && document.body) {
      box = document.createElement('div');
      box.id = 'bootUpdate';
      box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:#FFFBF2;color:#1A2C63;font:16px/1.6 Sarabun,"Noto Sans Thai","Leelawadee UI",Thonburi,sans-serif;text-align:center;';
      const card = document.createElement('div');
      card.style.cssText = 'max-width:22rem;background:#fff;border:2px solid #FFE3EF;border-radius:20px;padding:24px 20px;';
      const text = document.createElement('p');
      text.id = 'bootUpdateText';
      text.style.cssText = 'margin:0 0 8px;font-size:17px;font-weight:600;';
      text.textContent = 'กำลังอัปเดตแอปเป็นรุ่นใหม่ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วเปิดใหม่';
      const sub = document.createElement('p');
      sub.id = 'bootUpdateNote';
      sub.style.cssText = 'margin:0 0 16px;font-size:14px;color:#475569;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'bootUpdateBtn';
      btn.style.cssText = 'min-height:48px;padding:0 24px;border:0;border-radius:16px;background:#DB2777;color:#fff;font:inherit;font-weight:600;cursor:pointer;';
      btn.textContent = 'โหลดใหม่';
      btn.addEventListener('click', () => { try { sessionStorage.removeItem(BOOT_RETRY_KEY); } catch (e) { /* ignore */ } reloadPage(); });
      card.appendChild(text);
      card.appendChild(sub);
      card.appendChild(btn);
      box.appendChild(card);
      document.body.appendChild(box);
      // the old page's own content (and its broken controls) stays behind the message
    }
    note();
    if (tries() >= MAX_AUTO) return;
    // a new service worker that takes control serves this release's page from its precache
    const sw = navigator.serviceWorker;
    if (sw && typeof sw.addEventListener === 'function') {
      sw.addEventListener('controllerchange', autoReload);
      if (typeof sw.getRegistration === 'function') {
        sw.getRegistration().then(reg => (reg && typeof reg.update === 'function' ? reg.update() : null)).catch(() => {});
      }
    }
    // the page as the server has it now (the old worker answers from its cache and refreshes that copy meanwhile)
    const pageUrl = /^https?:$/.test(location.protocol) ? location.href.split('#')[0] : './index.html';
    const marker = 'js/app.js?v=' + APP_BUILD;
    const poll = () => {
      clearTimeout(timer);
      if (reloading || typeof window.fetch !== 'function') return;
      window.fetch(pageUrl, { cache: 'reload' })
        .then(r => (r && r.ok ? r.text() : ''))
        .then(t => { if (t.indexOf(marker) >= 0) autoReload(); else timer = setTimeout(poll, POLL_MS); },
          () => { timer = setTimeout(poll, POLL_MS); });
    };
    window.addEventListener('online', poll);
    poll();
  }

  const U = window.Utils;
  const Api = window.Api;
  const Kit = window.UiKit;            // js/ui-kit.js (loaded before this file): dialogs, sheet stack, icons, recipes

  /* ------------------------------------------------------------------ */
  /* constants                                                           */
  /* ------------------------------------------------------------------ */
  /**
   * FIX-CL CL-7: the offline copy of v3 has its own key — a v2.9 page (after a rollback of the web app) reads `ipd_cache_v2`
   * and would treat pending and doctor-visit rows as absences. The v2 copy is read once at the first v3 start (moved to the
   * new key) and removed; logout and an expired session remove both.
   */
  const LS = { apiUrl: 'ipd_api_url', session: 'ipd_session', cache: 'ipd_cache_v3', cacheV2: 'ipd_cache_v2' };
  const LEGACY_KEYS = ['rad_schedules', 'rad_staff', 'rad_passwords', 'rad_supervisor_single', 'rad_current_user'];
  const LEGACY_SECRET_KEYS = ['rad_passwords', 'rad_current_user'];   // plaintext passwords; the import never needs them
  const ALL = '__ALL__';               // "everyone" in the summary/export pickers (reserved: never a staff name)
  const GONE = 'gone';                 // group of people who appear in the data but are no longer active
  const GONE_LABEL = ' (ลบแล้ว)';
  const MAX_CHUNK_DAYS = 400;          // server limit per getData call (inclusive)
  const MAX_REPORT_DAYS = 731;         // summary / export range cap (≈ 2 years)
  const REFRESH_EVERY_MS = 90000;      // background refresh while visible
  const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];   // after a failed refresh, before the 90 s cadence resumes
  const OFFLINE_AFTER_FAILURES = 3;    // calls in a row that failed transiently before the app shows "offline"
  const STALE_AFTER_MS = 30000;        // refresh on focus when older than this
  const REMARK_MAX = 2000;
  const BLOB_URL_TTL_MS = 40000;       // a download prompt may wait for the user before it reads the blob URL
  const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  /** Subresource integrity of exactly that file (R1a fix B-5; sha384 computed from the cdnjs file, whose sha512 matches the
   *  value cdnjs publishes). The script runs in the app's origin, next to the session token: a changed file must not run. */
  const HTML2CANVAS_SRI = 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H';
  const DIAG_TIMEOUT_MS = 20000;       // per connection check
  const DIAG_SLOW_MS = 10000;          // a check that answers after this is reported as slow
  const DIAG_CDN_URLS = ['https://fonts.googleapis.com/css2?family=Sarabun&display=swap', HTML2CANVAS_URL];

  const MSG = {
    noInternet: 'ไม่มีอินเทอร์เน็ต — ยังบันทึกไม่ได้',
    writeFailed: 'บันทึกไม่สำเร็จเพราะเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ระบบจะตรวจสอบข้อมูลล่าสุดให้อัตโนมัติ',
    retrying: 'เซิร์ฟเวอร์ตอบช้า กำลังลองใหม่…',
    oldServer: 'เซิร์ฟเวอร์ (Code.gs) ยังเป็นเวอร์ชันเก่า กรุณาอัปเดตตามคู่มือ',
    updateCodeGs: 'ต้องอัปเดต Code.gs เป็นเวอร์ชันล่าสุดก่อน',
    serverV3: 'เซิร์ฟเวอร์ (Code.gs) ยังเป็นรุ่นก่อน 3.0 — อัปเดต Code.gs ตามคู่มือเพื่อเปิดใช้การลาหาหมอแบบระบุเวลา การอนุมัติลาพักร้อน และรูปโปรไฟล์',
    // R3-SPEC §4.2: the เมนู note of the Supervisor — a 3.0 server (features without 'plan'), a 3.1 server ('plan' but no 'chat')
    serverV31: 'เซิร์ฟเวอร์ (Code.gs) ยังเป็นรุ่น 3.0 — อัปเดต Code.gs เป็น 3.2 ตามคู่มือเพื่อเปิดใช้ระบบจัดเวร Dashboard แจ้งปัญหา และแชท',
    serverV32: 'เซิร์ฟเวอร์ (Code.gs) ยังเป็นรุ่น 3.1 — อัปเดต Code.gs เป็น 3.2 ตามคู่มือเพื่อเปิดใช้ Dashboard แจ้งปัญหา และแชท',
    leaveRequested: '📨 ส่งคำขอแล้ว — รอ Supervisor อนุมัติ',
    requestDeleted: '🗑️ ลบคำขอแล้ว',
    requestCancelled: '🗑️ ยกเลิกคำขอแล้ว',
    // FIX-CL CL-24: one sentence each, wherever they appear
    partialNote: 'ลาเฉพาะช่วงเวลา — นอกช่วงนี้ยังปฏิบัติงานตามตาราง',
    pendingNote: 'ยังไม่ใช่วันลาจนกว่า Supervisor จะอนุมัติ',
    countsSaved: '✅ บันทึกจำนวนคนแล้ว',
    imageToolFailed: '⚠️ โหลดเครื่องมือสร้างภาพไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    imageFailed: '⚠️ สร้างภาพไม่สำเร็จ กรุณาลองใหม่',
    sessionExpired: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    pwChangedRelogin: 'เปลี่ยนรหัสผ่านสำเร็จแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่',
    discardDraft: 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขหรือไม่?',
    // native-dialog mode (window.confirm, tests) only: the in-app sheet asks with Thai buttons (conflictText, C-M3)
    conflict: 'ข้อมูลวันนี้ถูกแก้ไขจากเครื่องอื่นแล้ว\nกด OK เพื่อบันทึกทับด้วยข้อมูลของคุณ หรือ Cancel เพื่อโหลดข้อมูลล่าสุด',
    leaveSaved: '✅ บันทึกสถานะสำเร็จ',
    supOnly: '⚠️ เฉพาะ Supervisor เท่านั้น',
    ownLeaveOnly: '⚠️ คุณสามารถแก้ไขวันลาได้เฉพาะของตนเองเท่านั้น',
    setupNetwork: 'เชื่อมต่อไม่ได้ — ตรวจสอบอินเทอร์เน็ต หรือ URL / การตั้งค่า Who has access ต้องเป็น Anyone',
    transferSaveFirst: 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก\nกด OK เพื่อบันทึกก่อนโอนสิทธิ์ หรือ Cancel เพื่อเลือกทิ้งการแก้ไข',   // native mode
    transferSaveFirstSheet: 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก\nบันทึกการแก้ไขก่อนโอนสิทธิ์ หรือไม่บันทึก?',
    transferDiscard: 'ทิ้งการแก้ไข Station ที่ยังไม่ได้บันทึก แล้วโอนสิทธิ์ต่อใช่หรือไม่?',
    shareFailed: '⚠️ แชร์ไฟล์ไม่สำเร็จ — ดาวน์โหลดไฟล์แทนแล้ว'
  };

  /** Placeholders of the station cards and the leave rows while the selected day is loading / not on this device. */
  const LOADING_HTML = '<div class="' + Kit.cls.card + ' col-span-full">' + Kit.skeleton(4) + '</div>';
  /** The selected day is not on this device (and could not be loaded). */
  function missingHtml(date) {
    return '<div class="' + Kit.cls.card + ' col-span-full" data-missing="1">' +
      Kit.empty({ icon: 'cloud-off', title: withDay('ยังไม่มีข้อมูลของ', date, 'ในเครื่อง'), hint: 'แตะปุ่มรีเฟรช (ลูกศรวน) ด้านบนเพื่อโหลดอีกครั้ง' }) + '</div>';
  }
  function msgNotLoaded(date) { return withDay('⏳ ยังไม่มีข้อมูลล่าสุดของ', date, ' กรุณารอให้โหลดเสร็จ (หรือกด 🔄)'); }
  const GRP_BASE = 'grp-btn shrink-0 ' + Kit.cls.chip + ' ';
  const REMARK_VIEW_BASE = 'whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 rounded-2xl border-2 px-3.5 py-2.5 ';
  /** Leave sheet option tiles (UiKit.cls.tile + on/off): ปกติ spans both columns. */
  const LV_TILE = 'lv-chip ' + Kit.cls.tile + ' ';
  const LV_TILE_TIGHT = 'lv-chip ' + Kit.cls.tileTight + ' ';   // the doctor-visit tiles (CL-20)
  const VERDICT_BASE = 'text-xs font-medium leading-relaxed p-2.5 rounded-xl border ';
  const VERDICT_TONE = {
    ok: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    fail: 'bg-coral-50 border-coral-200 text-coral-700'
  };
  /** The header's connection pill: label (full), short (tight header), icon (narrowest: icon + dot, never colour alone). */
  const SYNC_LOOK = {
    online: { color: '#10b981', label: 'ออนไลน์', short: 'ออนไลน์', icon: 'cloud' },
    syncing: { color: '#f2a93b', label: 'กำลังซิงก์…', short: 'ซิงก์…', icon: 'cloud' },
    reconnecting: { color: '#f2a93b', label: 'กำลังเชื่อมต่อใหม่…', short: 'ต่อใหม่…', icon: 'cloud-off' },
    offline: { color: '#94a3b8', label: 'ออฟไลน์', short: 'ออฟไลน์', icon: 'cloud-off' }
  };
  /** Fixed width of the shared image (#captureArea) when it is drawn: the JPG looks the same from every screen. */
  const CAPTURE_WIDTH = 420;
  const ERROR_TOAST_MS = 6000;         // an error toast stays at least this long (≥ 5 s, C-M6) unless tapped away
  const DIAG_ICON = { ok: '✅', warn: '⚠️', fail: '⛔', skip: '➖', run: '⏳' };   // R3 FIX-CL L-8: no cross glyph
  /** R2: the fill order of the daily proposal when the server announced none (PlanEngine.DEFAULT_PRIORITY). */
  const DEFAULT_PLAN_PRIORITY = Object.freeze(window.PlanEngine.DEFAULT_PRIORITY.slice());
  const PLAN_SLOT_ORDERS = ['coverage', 'priority'];

  /* ------------------------------------------------------------------ */
  /* state (shape per SPEC §6.4) + transient UI bookkeeping             */
  /* ------------------------------------------------------------------ */
  const state = {
    apiUrl: '',
    session: null,            // {token, name, expiresAt}
    user: null,               // {name, group, isSupervisor, mustChangePassword}
    supervisor: '',
    staff: [],                // active staff [{name, group}] regular first, then backup
    days: {},                 // {[date]: Day}
    // {[date]: {[name]: Leave}} — name maps have no prototype (see nameMap). R1b: a v3 server sends LeaveV3 rows
    // {date, staff, type, recordedBy, recordedAt, detail, status, decidedBy, decidedAt, note} — approved, partial-day
    // and pending rows of everyone, rejected rows only to their owner and the Supervisor; an older server only the
    // blocking rows without status (= approved). Whether a row makes someone absent: Utils.isAbsent, nothing else.
    leaves: {},
    // R1b: the server's `requests` (frozen LeaveV3[], sorted by date then recordedAt; rows of the last 30 days and later):
    // the Supervisor gets every pending row, anyone else their own pending and rejected rows. [] on an older server.
    requests: [],
    // R1b `rules` of the heartbeat (null = not announced, e.g. an older server); R2: planPriority (the 7 station ids in fill
    // order) and planSlotOrder ('coverage' | 'priority') — the defaults until a 3.1 server announces its Config (applyRules)
    rules: defaultRules(),
    loaded: [],               // merged [{from, to}] ranges fetched from the server this session
    selectedDate: U.todayStr(),
    stationCounts: U.normalizeStationCounts(null),   // {[stationId]: people required} (supervisor setting)
    draft: null,              // {date, baseVersion, assignments:{[stationId]: string[]}, remark, base} ('' = empty slot;
                              // base = the saved day the draft was started from: draftSnapshot)
    filter: 'all',
    clipboard: null,          // {fromDate, assignments, remark}
    conn: 'online',           // 'online' | 'reconnecting' | 'offline'
    lastSync: null,           // ms timestamp of the last successful getData
    audit: {}                 // {[date]: Audit[]}
  };

  const ui = {
    tab: 'station',           // id of the current screen (a registered feature, see the registry section)
    tabParams: undefined,     // params of the last core.go() to the current screen
    shownTab: '',             // screen whose show() ran last (hide()/show() follow ui.tab in renderTabs)
    screenTitle: null,        // R3: {tab, text} — core.setScreenTitle(): the header title of that screen until it changes
    dateAsking: false,        // setSelectedDate is asking whether to drop unsaved station edits
    epoch: 0,                 // bumps on login/logout → late responses from an old session are dropped
    pending: 0,               // tracked async flows (for App.idle)
    userWaits: 0,             // flows waiting for the user's answer to a dialog (askUser) — not "busy" for App.idle
    fetchingRanges: [],       // [{from, to}] of getData calls in progress (loading placeholders)
    rangeReqs: {},            // in-flight getData chunks keyed "from|to"
    refreshing: null,
    writeSeq: 0,              // increments on every local write merge
    touched: {},              // {[date]: writeSeq} — protects fresh writes from stale getData responses
    // FIX-CL CL-2: own leave writes on a date that was NOT loaded (the approval inbox, an offline copy):
    // {[date]: {[staff]: {seq, leave|null, day|null}}} — replayed over every getData answer that started before them
    unloadedWrites: {},
    staffSeq: 0,              // increments on every own staff/role/user/station-count write — same protection for those
    windowVersions: {},       // {"from|to": dataVersion} of the refreshed window — lets the next poll ask "changed?"
    failStreak: 0,            // calls in a row that finally failed transiently
    connReason: '',           // why state.conn is not 'online': 'device' (no network) | 'server'
    retryStep: 0,             // index into RETRY_DELAYS_MS
    retryTimer: null,
    oldServerWarned: false,
    countsDraft: null,        // {[stationId]: n} while #stationCountsModal is open
    diag: null,               // {running, at, rows:[{key, label, status, ms, note, code}], verdict:{tone, text}}
    dayBusy: null,            // date whose Day write (save / paste / clear) is in flight: its editor is locked
    calMonth: '',             // 'YYYY-MM' shown by the leave calendar ('' = the selected date's month)
    calPlanMonth: '',         // R3 F-1: the month whose holidays the calendar last asked use('plan').ensure for
    calPlanMoved: false,      // R3 F-1: that ensure widened the plan range past the selected date's window (restored on leaving)
    reorder: null,            // R3 F-2: {date, station} — the station card of วันนี้ in "จัดลำดับ" mode (Supervisor)
    cacheLoaded: [],          // ranges present in the offline cache (display only)
    cacheSavedAt: null,
    apiUrlSource: '',         // 'config' | 'local' | ''
    loginUsers: [],
    loginUsersLoading: false,
    loginUsersError: '',
    loginUsersPromise: null,
    pwForced: false,
    pwChangeRetried: false,   // the password change in flight is being sent again (see onSessionError)
    setupCancelable: false,
    pendingLeave: null,       // {staff, date, type} — the option picked in the leave sheet, not saved yet
    leaveSheet: null,         // {staff, date, locked} while the leave sheet (#confirmLeaveModal) is open
    leaveSaving: false,
    auditLoading: {},
    auditFailed: {},
    staffBusy: false,
    staffSig: null,
    importResult: null,
    legacyKey: null,
    legacy: null,
    summaryPlaceholder: '',
    toastTimer: null,
    usedBefore: false,        // a session or offline copy existed when the app started (an update, not a new device)
    serverVersion: '',        // Code.gs version from the last ping (connection check / setup); '' = not known
    serverMode: '',           // R1b: '' not known yet · 'v3' the server announces `features` · 'old' it answered without
    requestsSeq: 0,           // increments on every local change of state.requests (older getData answers keep away)
    leaveTime: null,          // the leave sheet's custom time range while typed: {start, end} ('' = empty field)
    leaveTimeError: '',       // the error line of the leave sheet's time step
    leaveBusy: '',             // the leave sheet's action in flight: 'save' | 'rerequest' | 'delete' | 'approved' | 'rejected'
    // R2: dates whose daily proposal the Supervisor dismissed ("เริ่มจากช่องว่าง", memory only): {[date]: true}
    proposalOff: {},
    // R2: the duty sent as saveDay.duty with the next save of that date (core.station.setDutyPatch): {date, duty} | null
    dutyPatch: null
  };

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  /** Test/debug handle (SPEC §6.9). Defined before init so harnesses can find it early; the registry section adds
   *  App.core and App.register (the API of feature files). */
  window.App = {
    build: APP_BUILD,         // R1b: the inline guard of index.html checks it (a js/app.js of another release → the update message)
    state,
    ready,
    idle,
    refresh: () => refresh(),
    render: () => render(),
    ui
  };

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */
  const $ = id => document.getElementById(id);
  const esc = U.escapeHtml;
  const cfg = () => window.APP_CONFIG || {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* quota / private mode */ } }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function lsGetJson(k) { const s = lsGet(k); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }

  /** Show/hide via both the Tailwind `hidden` class and inline display (works with or without Tailwind). */
  function setVisible(el, on) {
    if (!el) return;
    el.classList.toggle('hidden', !on);
    el.style.display = on ? '' : 'none';
  }
  /**
   * The seven modals are sheets of the UiKit stack (registerModals): open = no `hidden` class + `flex`, closing sets
   * `hidden` synchronously; the stack adds focus handling and Escape (one Escape closes only the top sheet).
   */
  function showModal(id) { if ($(id)) Kit.sheet.open(id); }
  function hideModal(id) { if ($(id)) Kit.sheet.close(id); }
  function isShown(id) { const m = $(id); return !!m && !m.classList.contains('hidden'); }

  /**
   * Replace innerHTML only when the markup actually changed (no DOM churn on no-op renders). FIX-CL CL-5: markup that differs
   * only in avatar pictures (UiKit.avatar's <img>) counts as unchanged — the pictures on the page are patched in place by
   * onAvatarChange (UiKit.avatars.refresh), so a picture arriving never replaces a focused picker, a scrolled list or an
   * open control.
   */
  function setHtml(el, html) {
    if (!el) return;
    if (el._html === html) return;
    if (typeof el._html === 'string' && el._html && withoutAvatarImgs(el._html) === withoutAvatarImgs(html)) {
      el._html = html;
      return;
    }
    el.innerHTML = html;
    el._html = html;
  }
  const AVATAR_IMG_RE = /<img src="[^"]*" alt="" data-uk-avatar-img="1" draggable="false">/g;
  function withoutAvatarImgs(html) {
    return typeof html === 'string' && html.indexOf('data-uk-avatar-img') >= 0 ? html.replace(AVATAR_IMG_RE, '') : html;
  }

  /** textContent only when it changed (no DOM churn on no-op renders). */
  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

  /** "วันนี้" only when the date is today, else "วันที่ 25 พ.ย. 2569" (C-M2; opts as Utils.thaiDateShort, e.g. {year:false}). */
  function dayRef(date, opts) {
    return date === U.todayStr() ? 'วันนี้' : 'วันที่ ' + U.thaiDateShort(date, opts);
  }
  /** before + dayRef(date) + after, with a space after a date that ends in a number ("…2569 ในเครื่อง"). */
  function withDay(before, date, after, opts) {
    const ref = dayRef(date, opts);
    const a = after || '';
    return before + ref + (a && /\d$/.test(ref) && !/^\s/.test(a) ? ' ' : '') + a;
  }
  /** "พรุ่งนี้" / "เมื่อวาน" / "อีก 3 วัน" / "3 วันที่แล้ว" relative to today ('' for today). */
  function relativeDay(date) {
    const n = U.daysBetweenInclusive(U.todayStr(), date) - 1;
    if (!isFinite(n) || n === 0) return '';
    if (n === 1) return 'พรุ่งนี้';
    if (n === -1) return 'เมื่อวาน';
    return n > 0 ? 'อีก ' + n + ' วัน' : (-n) + ' วันที่แล้ว';
  }
  const nativeDialogs = () => !!cfg().NATIVE_DIALOGS;

  /**
   * The toast (C-M6): centred under the header (below the update notice when that shows), as wide as its text up to
   * min(28rem, 100vw − 2rem). An error stays at least 5 s; any toast closes when tapped.
   * opts.error marks an error (also detected: a text starting with ⚠️ / ⛔ / "เกิดข้อผิดพลาด").
   */
  function toast(msg, ms, opts) {
    const t = $('toast');
    if (!t) return;
    const text = String(msg == null ? '' : msg);
    const error = !!(opts && opts.error) || /^(⚠️|⛔|เกิดข้อผิดพลาด)/.test(text);
    t.textContent = text;
    t.toggleAttribute('data-long', text.length > 40 || text.indexOf('\n') >= 0);
    t.dataset.tone = error ? 'error' : 'info';
    t.style.opacity = '1';
    t.classList.remove('pointer-events-none');
    placeFloaters();
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(hideToast, Math.max(ms || 2200, error ? ERROR_TOAST_MS : 0));
  }
  function hideToast() {
    const t = $('toast');
    if (!t) return;
    clearTimeout(ui.toastTimer);
    t.style.opacity = '0';
    t.classList.add('pointer-events-none');
  }

  /**
   * Disable a button and show a busy label while fn runs. A logout / new login releases every busy button at once
   * (releaseBusyButtons); a flow of the old session that ends later then leaves the button alone.
   */
  let busySeq = 0;
  async function withBusy(btn, label, fn) {
    if (!btn) return fn();
    if (btn.dataset.busy === '1') return undefined;
    const token = String(++busySeq);
    btn._idleHtml = btn.innerHTML;
    btn.dataset.busy = '1';
    btn.dataset.busyToken = token;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = label || '…';
    try { return await fn(); }
    finally {
      if (btn.dataset.busyToken === token) releaseBusy(btn);
      renderDayControls();   // some buttons also stay disabled while their day is not loaded
    }
  }
  function releaseBusy(btn) {
    if (typeof btn._idleHtml === 'string') btn.innerHTML = btn._idleHtml;
    btn.disabled = false;
    delete btn.dataset.busy;
    delete btn.dataset.busyToken;
    btn.removeAttribute('aria-busy');
  }
  function releaseBusyButtons() { document.querySelectorAll('[data-busy="1"]').forEach(releaseBusy); }

  /** A check that stays true while the session current at call time is still current (no logout / re-login). */
  function sessionAlive() {
    const epoch = ui.epoch;
    return () => epoch === ui.epoch && !!state.session;
  }

  /** Name-keyed map without a prototype: names such as "constructor" must not hit Object.prototype. */
  function nameMap(src) { return Object.assign(Object.create(null), src); }
  const NO_LEAVES = Object.freeze(nameMap());

  /** Count an async flow as "pending" for App.idle(). */
  function track(p) {
    ui.pending++;
    return Promise.resolve(p).then(v => { ui.pending--; return v; }, e => { ui.pending--; throw e; });
  }
  /** Run an async handler (synchronously started), track it, and route errors to handleError (with opts). */
  function spawn(fn, opts) {
    let p;
    try { p = fn(); } catch (e) { p = Promise.reject(e); }
    return track(p).catch(e => handleError(e, opts));
  }
  const WRITE = { write: true };   // spawn option of handlers that send a write

  /** A call the user is waiting for: when Api retries it, the user is told why it takes longer. */
  function userCall(action, params, opts) {
    return Api.call(action, params, Object.assign({ onRetry: () => toast(MSG.retrying, 4000) }, opts));
  }

  const deviceOffline = () => navigator.onLine === false;

  /**
   * A question to the user (UiKit dialog: a sheet, or window.confirm/prompt with APP_CONFIG.NATIVE_DIALOGS).
   * Waiting for the answer is not work in progress, so App.idle() may resolve while the question is open.
   */
  function askUser(p) {
    ui.userWaits++;
    return Promise.resolve(p).finally(() => { ui.userWaits--; });
  }
  function confirmUser(message, opts) { return askUser(Kit.confirm(message, opts)); }
  function promptUser(message, defaultValue, opts) { return askUser(Kit.prompt(message, defaultValue, opts)); }

  /** Resolves when no request is in flight and no tracked flow runs (flows waiting for the user's answer excepted). */
  function idle() {
    return new Promise(resolve => {
      const check = () => {
        if (Api.inflight === 0 && ui.pending - ui.userWaits <= 0) resolve();
        else setTimeout(check, 10);
      };
      setTimeout(check, 0);
    });
  }

  function normRemark(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n'); }

  /* ------------------------------------------------------------------ */
  /* domain selectors (pure reads of state)                              */
  /* ------------------------------------------------------------------ */
  function isSup() { return !!(state.user && state.user.isSupervisor); }
  function myName() { return state.user ? state.user.name : ''; }
  function activeSet() { return new Set(state.staff.map(s => s.name)); }
  function groupLabel(g) { return g === 'backup' ? 'ทีมแทนเวร' : g === GONE ? 'ไม่อยู่ในระบบ' : 'คนประจำ'; }
  function nameLabel(name, act) { return act.has(name) ? name : name + GONE_LABEL; }
  function leavesOn(date) { return state.leaves[date] || NO_LEAVES; }

  function orderStaff(list) {
    const clean = (Array.isArray(list) ? list : [])
      .filter(s => s && typeof s.name === 'string' && s.name)
      .map(s => ({ name: s.name, group: s.group === 'backup' ? 'backup' : 'regular' }));
    return clean.filter(s => s.group === 'regular').concat(clean.filter(s => s.group === 'backup'));
  }

  function emptyAssignments() {
    const a = {};
    U.STATIONS.forEach(st => { a[st.id] = []; });
    return a;
  }

  function normalizeDay(d) {
    if (!d || typeof d !== 'object') return null;
    const a = emptyAssignments();
    const src = d.assignments || {};
    U.STATIONS.forEach(st => { if (Array.isArray(src[st.id])) a[st.id] = src[st.id].filter(n => typeof n === 'string' && n); });
    return {
      date: d.date,
      assignments: a,
      remark: typeof d.remark === 'string' ? d.remark : '',
      version: parseInt(d.version, 10) || 0,
      updatedBy: d.updatedBy || '',
      updatedAt: d.updatedAt || ''
    };
  }

  function currentVersion(date) { const d = state.days[date]; return d ? (d.version | 0) : 0; }

  /** People a station needs (the supervisor's setting). */
  function required(stId) { return state.stationCounts[stId]; }
  function savedCount(date, stId) { const d = state.days[date]; return d ? d.assignments[stId].length : 0; }
  /** Slots of a station on a date: the required number, or more when more people are already saved there. */
  function slotCount(date, stId) { return Math.max(required(stId), savedCount(date, stId)); }

  /** Keeps every filled slot where it is; pads to n slots and drops only empty slots beyond n. */
  function fitSlots(list, n) {
    const out = list.slice();
    while (out.length > n && !out[out.length - 1]) out.pop();
    while (out.length < n) out.push('');
    return out;
  }

  /**
   * Saved assignments for a date as slots ('' = empty). Nothing saved is ever cut off: people deleted since
   * stay (the day is history, and the server accepts them on that date as long as they are already saved there,
   * A4), and so do people beyond a count that was lowered later.
   */
  function storedSlots(date) {
    const day = state.days[date];
    const out = {};
    U.STATIONS.forEach(st => { out[st.id] = fitSlots((day && day.assignments[st.id]) || [], slotCount(date, st.id)); });
    return out;
  }

  /** Names a slot of `date` may hold: active staff plus people already saved on that day. */
  function assignableSet(date) {
    const names = activeSet();
    const day = state.days[date];
    if (day) U.STATIONS.forEach(st => day.assignments[st.id].forEach(n => names.add(n)));
    return names;
  }
  function storedRemark(date) { const d = state.days[date]; return d ? normRemark(d.remark) : ''; }

  function hasDraftFor(date) { return !!(state.draft && state.draft.date === date); }
  /**
   * What the station editor shows: the supervisor's draft (fitted to the current counts) if any, else — R2 — the daily
   * proposal while one is active for the date (a computed view, never stored: R2-SPEC §0.17, §4.2), else the saved day.
   * Staff never reach the proposer.
   */
  function viewSlots(date) {
    if (isSup() && hasDraftFor(date)) {
      const out = {};
      U.STATIONS.forEach(st => { out[st.id] = fitSlots(state.draft.assignments[st.id] || [], slotCount(date, st.id)); });
      return out;
    }
    const p = currentProposal(date);
    return p ? slotsFrom(date, p.assignments) : storedSlots(date);
  }

  /**
   * R2: the daily proposal of `date` while it is active, else null. Active = the Supervisor (not forced to change the
   * password), a proposer is set, no draft of that date, not dismissed (ui.proposalOff), today or later, no saved names
   * (!isPlannedDay) and the day's data is on this device (dayView ready/cached) — and the proposer answers with
   * assignments. Working day and "the month has a roster" are the proposer's own conditions (it returns null).
   */
  function currentProposal(date) {
    if (!proposer || !isSup() || ui.pwForced || !U.isValidYmd(date) || hasDraftFor(date) || ui.proposalOff[date]) return null;
    if (date < U.todayStr() || isPlannedDay(date)) return null;
    const view = dayView(date);
    if (view !== 'ready' && view !== 'cached') return null;
    let p = null;
    try { p = proposer(date); } catch (e) { console.error('[core] the proposer failed:', e); return null; }
    return p && typeof p === 'object' && p.assignments && typeof p.assignments === 'object' ? p : null;
  }
  function proposalActive(date) { return !!currentProposal(date); }

  /**
   * Slot arrays for `date` from proposed / applied assignments ({[stationId]: string[]}): only names the date may hold
   * (assignableSet), each person once (first slot wins), fitted to the slot count (fitSlots).
   */
  function slotsFrom(date, assignments) {
    const keep = assignableSet(date);
    const used = new Set();
    const out = {};
    U.STATIONS.forEach(st => {
      const src = assignments && Array.isArray(assignments[st.id]) ? assignments[st.id] : [];
      const list = src.map(n => {
        if (typeof n !== 'string' || !n || !keep.has(n) || used.has(n)) return '';
        used.add(n);
        return n;
      });
      out[st.id] = fitSlots(list, slotCount(date, st.id));
    });
    return out;
  }

  /** The station editor of `date` shows something unsaved: a dirty draft or (R2) an active proposal. */
  function unsavedOn(date) { return isSup() && ((hasDraftFor(date) && isDraftDirty()) || proposalActive(date)); }

  /**
   * A draft that is no longer different from the saved day is dropped; when it was started from the proposal, the
   * proposal does not come back by itself (the Supervisor took over the day: "แสดงข้อเสนอ" restores it).
   */
  function dropCleanDraft() {
    if (!state.draft || isDraftDirty()) return;
    if (state.draft.fromProposal) ui.proposalOff[state.draft.date] = true;
    state.draft = null;
  }
  function viewRemark(date) { return (isSup() && hasDraftFor(date)) ? normRemark(state.draft.remark) : storedRemark(date); }

  function compactSlots(slots) {
    const out = {};
    U.STATIONS.forEach(st => { out[st.id] = ((slots && slots[st.id]) || []).filter(Boolean); });
    return out;
  }

  function isDraftDirty() {
    const d = state.draft;
    if (!d) return false;
    return JSON.stringify(compactSlots(d.assignments)) !== JSON.stringify(compactSlots(storedSlots(d.date))) ||
      normRemark(d.remark) !== storedRemark(d.date);
  }

  /**
   * The Supervisor's draft of `date`, created on the first edit. R2: it starts from what the editor shows (viewSlots — the
   * proposal while one is active, so the first edit freezes the proposal into the draft); baseVersion / base stay those of
   * the saved day. A proposal-seeded draft is dirty (isDraftDirty compares with the saved day); heartbeats never change it.
   */
  function ensureDraft(date) {
    if (hasDraftFor(date)) return state.draft;
    const p = currentProposal(date);
    state.draft = { date, baseVersion: currentVersion(date), assignments: p ? slotsFrom(date, p.assignments) : storedSlots(date),
      remark: storedRemark(date), base: draftSnapshot(date), fromProposal: !!p };
    return state.draft;
  }

  /**
   * FIX-CL CL-1: a frozen copy of the saved day of `date` as it is now ({date, version, remark, assignments}). The draft keeps
   * the one it started from (draft.base), so an own write can always be compared with the version the draft is based on —
   * also when the local copy of that day was replaced meanwhile (a heartbeat that already carried the write).
   */
  function draftSnapshot(date) {
    const d = state.days[date];
    const assignments = {};
    U.STATIONS.forEach(st => { assignments[st.id] = d && Array.isArray(d.assignments[st.id]) ? d.assignments[st.id].slice() : []; });
    return Object.freeze({ date, version: d ? (d.version | 0) : 0, remark: d ? d.remark : '', assignments: Object.freeze(assignments) });
  }

  function removeFromDraft(name) {
    if (!state.draft) return;
    Object.keys(state.draft.assignments).forEach(k => {
      state.draft.assignments[k] = state.draft.assignments[k].map(n => (n === name ? '' : n));
    });
    if (!isDraftDirty()) state.draft = null;
  }

  /**
   * The saved day the draft was started from (draft.base, CL-1), or — for a draft without one — the local copy while it is
   * still that version (for rebaseDraft).
   */
  function draftBase() {
    const d = state.draft;
    if (!d) return null;
    if (d.base && d.base.date === d.date && d.base.version === d.baseVersion) return d.base;
    const day = state.days[d.date];
    return day && day.version === d.baseVersion ? day : null;
  }

  /**
   * Our own write (auto-unassign by setLeave / decideLeave, deleteStaff) removed `name` from the draft's day on the server.
   * When the stored day is now exactly `base` minus that name, the draft already contains that change: move
   * it onto the new version so the next save is not a false "edited on another device" CONFLICT.
   * base: the draft's own base when omitted (CL-1: every caller — the leave sheet, the inbox, a CONFLICT answer — gets it).
   */
  function rebaseDraft(name, base) {
    const b = base || draftBase();
    const now = b && hasDraftFor(b.date) ? state.days[b.date] : null;
    if (!now || now.version !== b.version + 1 || now.remark !== b.remark) return;
    const same = U.STATIONS.every(st =>
      JSON.stringify((b.assignments[st.id] || []).filter(n => n !== name)) === JSON.stringify(now.assignments[st.id]));
    if (same) {
      state.draft.baseVersion = now.version;
      state.draft.base = draftSnapshot(b.date);
    }
  }

  /**
   * Leave ROWS of ACTIVE staff on a date, in server order: {[name]: Leave} — every status (R1b: approved, partial-day,
   * pending, and the rejected rows this user may see). "Absent" is a separate question: absentLeaves / Utils.isAbsent.
   */
  function activeLeaves(date) {
    const map = leavesOn(date);
    const act = activeSet();
    const out = nameMap();
    Object.keys(map).forEach(n => { if (act.has(n) && map[n] && map[n].type) out[n] = map[n]; });
    return out;
  }

  /** The people who are ABSENT on a date (Utils.isAbsent: approved + full-day): {[name]: Leave}. */
  function absentLeaves(date) {
    const rows = activeLeaves(date);
    const out = nameMap();
    Object.keys(rows).forEach(n => { if (U.isAbsent(rows[n])) out[n] = rows[n]; });
    return out;
  }

  /** "คนที่ N" queues of the QUEUE_TYPES among a date's rows (Utils.queueOrder: rejected rows hold no place). */
  function queuesOf(rows) {
    const queues = {};
    U.QUEUE_TYPES.forEach(t => { queues[t] = U.queueOrder(rows, t); });
    return queues;
  }
  function rankIn(queues, type, name) { return queues[type] ? queues[type].indexOf(name) + 1 : 0; }

  /**
   * The date's ABSENT people in staff display order: [{name, type, rank}] — rank = "คนที่ N" of a queue type, else 0.
   * (core.leaveList; partial-day and pending rows are not in it — see leaveLines.)
   */
  function leaveList(date) {
    return leaveLines(date).absent.map(l => ({ name: l.name, type: l.type, rank: l.rank }));
  }

  /**
   * Everything a screen shows about a date's leaves, in staff display order (rejected rows are ignored everywhere):
   * {absent: [{name, type, rank, leave, info}], partial: [...], pending: [...]} — info = Utils.leaveInfo(leave).
   */
  function leaveLines(date) {
    const rows = activeLeaves(date);
    const queues = queuesOf(rows);
    const out = { absent: [], partial: [], pending: [] };
    state.staff.forEach(s => {
      const leave = rows[s.name];
      if (!leave) return;
      const info = U.leaveInfo(leave);
      const line = { name: s.name, type: leave.type, rank: rankIn(queues, leave.type, s.name), leave, info };
      if (info.blocking) out.absent.push(line);
      else if (info.partial) out.partial.push(line);
      else if (info.pending) out.pending.push(line);
    });
    return out;
  }

  /** Active staff, then people who appear in [from, to] but are no longer active (their history is kept). */
  function reportStaff(from, to) {
    const act = activeSet();
    const gone = [];
    const note = n => { if (!act.has(n) && gone.indexOf(n) < 0) gone.push(n); };
    U.eachDate(from, to).forEach(date => {
      const day = state.days[date];
      if (day) U.STATIONS.forEach(st => day.assignments[st.id].forEach(note));
      const lv = leavesOn(date);
      Object.keys(lv).forEach(n => { if (U.leaveStatus(lv[n]) !== 'rejected') note(n); });   // a rejected row is ignored
    });
    return state.staff.concat(gone.map(name => ({ name, group: GONE })));
  }
  function personLabel(s) { return s.group === GONE ? s.name + GONE_LABEL : s.name; }

  /** An own write of `date` was merged: older getData answers must not undo it, and polls must re-read it. */
  function markTouched(date) {
    ui.writeSeq++;
    ui.touched[date] = ui.writeSeq;
    Object.keys(ui.windowVersions).forEach(key => {
      const [from, to] = key.split('|');
      if (from <= date && date <= to) delete ui.windowVersions[key];
    });
    emit('data', { date, local: true });
  }

  /* ------------------------------------------------------------------ */
  /* date ranges                                                         */
  /* ------------------------------------------------------------------ */
  /** First day of the previous month … last day of the next month. */
  function windowFor(date) {
    const d = U.parseYmd(date) || U.parseYmd(U.todayStr());
    const y = d.getFullYear(), m = d.getMonth();
    return { from: U.ymd(new Date(y, m - 1, 1)), to: U.ymd(new Date(y, m + 2, 0)) };
  }

  function inRanges(ranges, date) { return (ranges || []).some(r => r && r.from <= date && date <= r.to); }

  function missingRanges(from, to) {
    const out = [];
    let cur = from;
    const sorted = state.loaded.slice().sort((a, b) => U.compareYmd(a.from, b.from));
    for (const r of sorted) {
      if (r.to < cur) continue;
      if (r.from > to) break;
      if (r.from > cur) out.push({ from: cur, to: U.addDays(r.from, -1) });
      cur = U.addDays(r.to, 1);
      if (cur > to) return out;
    }
    if (cur <= to) out.push({ from: cur, to });
    return out;
  }

  function chunkRange(from, to, maxDays) {
    const out = [];
    let cur = from;
    while (cur <= to) {
      let end = U.addDays(cur, maxDays - 1);
      if (end > to) end = to;
      out.push({ from: cur, to: end });
      cur = U.addDays(end, 1);
    }
    return out;
  }

  function addLoaded(from, to) {
    const all = state.loaded.concat([{ from, to }]).sort((a, b) => U.compareYmd(a.from, b.from));
    const merged = [];
    all.forEach(r => {
      const last = merged[merged.length - 1];
      if (last && r.from <= U.addDays(last.to, 1)) { if (r.to > last.to) last.to = r.to; }
      else merged.push({ from: r.from, to: r.to });
    });
    state.loaded.length = 0;
    merged.forEach(r => state.loaded.push(r));
  }

  /**
   * What is known about a date: 'ready' (fetched from the server this session), 'cached' (only the offline
   * copy: shown read-only), 'loading' or 'missing' (nothing to show). Editing, copying, pasting onto and
   * clearing a day need 'ready' — acting on an empty or stale snapshot would overwrite the real day.
   */
  function dayView(date) {
    if (inRanges(state.loaded, date)) return 'ready';
    if (inRanges(ui.cacheLoaded, date)) return 'cached';
    return inRanges(ui.fetchingRanges, date) || (!!state.session && !state.user) ? 'loading' : 'missing';
  }
  function canEditDay(date) { return isSup() && dayView(date) === 'ready' && ui.dayBusy !== date; }
  /** There is something to show for the date (fresh or from the offline copy). */
  function dayKnown(date) { return !!state.user && ['ready', 'cached'].indexOf(dayView(date)) >= 0; }

  /** Guard for day writes: the date's fresh data must be loaded and no other write of that day in flight. */
  function requireDayReady(date) {
    if (dayView(date) !== 'ready') { toast(msgNotLoaded(date)); return false; }
    return ui.dayBusy !== date;
  }

  /* ------------------------------------------------------------------ */
  /* persistence                                                         */
  /* ------------------------------------------------------------------ */
  function resolveApiUrl() {
    const fromCfg = String(cfg().API_URL || '').trim();
    if (fromCfg) return { url: fromCfg, source: 'config' };
    const fromLs = String(lsGet(LS.apiUrl) || '').trim();
    if (fromLs) return { url: fromLs, source: 'local' };
    return { url: '', source: '' };
  }

  function expiryMs(v) { if (typeof v === 'number') return v; const t = Date.parse(v); return isNaN(t) ? null : t; }

  function loadSession() {
    const s = lsGetJson(LS.session);
    if (!s || typeof s.token !== 'string' || !s.token || typeof s.name !== 'string' || !s.name) return null;
    const exp = expiryMs(s.expiresAt);
    if (exp !== null && exp <= Date.now()) {
      // expired on this device (R1a fix B-4): the offline copy goes with it, exactly as on a logout
      lsRemove(LS.session);
      lsRemove(LS.cache);
      lsRemove(LS.cacheV2);
      clearUserStorage();   // ipd_dom:* and ipd_draft:*
      wipeUserMedia();
      return null;
    }
    return { token: s.token, name: s.name, expiresAt: s.expiresAt };
  }
  function saveSession(s) { lsSet(LS.session, JSON.stringify(s)); }

  function persistCache() {
    if (!state.session || !state.user) return;
    lsSet(LS.cache, JSON.stringify({
      savedAt: new Date().toISOString(),
      user: state.user, supervisor: state.supervisor, staff: state.staff, stationCounts: state.stationCounts,
      days: state.days, leaves: state.leaves, loaded: state.loaded,
      // R1b: what the server announced (an offline start shows the same screens), and this user's requests
      requests: state.requests, rules: state.rules, serverMode: ui.serverMode, features: Object.keys(serverFeatures)
    }));
  }

  /** Render immediately from the offline cache (if it belongs to this user). */
  function restoreCache(name) {
    const c = lsGetJson(LS.cache);
    if (!c || !c.user || c.user.name !== name) return false;
    state.user = Object.assign({}, c.user);
    state.supervisor = typeof c.supervisor === 'string' ? c.supervisor : '';
    state.staff = orderStaff(c.staff);
    state.stationCounts = U.normalizeStationCounts(c.stationCounts);
    const days = {};
    Object.keys(c.days || {}).forEach(k => { const d = normalizeDay(c.days[k]); if (d && U.isValidYmd(k)) days[k] = Object.assign(d, { date: k }); });
    state.days = days;
    const leaves = {};
    if (c.leaves && typeof c.leaves === 'object') {
      Object.keys(c.leaves).forEach(k => { if (U.isValidYmd(k)) leaves[k] = nameMap(c.leaves[k]); });
    }
    state.leaves = leaves;
    state.loaded.length = 0;   // cache is not authoritative: everything is refetched on demand
    ui.cacheLoaded = Array.isArray(c.loaded) ? c.loaded : [];
    ui.cacheSavedAt = c.savedAt || null;
    // R1b (absent in a v2.9 copy: nothing changes, the first answer decides)
    if (c.serverMode === 'v3' && Array.isArray(c.features)) setServerFeatures(c.features);
    if (c.rules && typeof c.rules === 'object') applyRules(c.rules);
    if (c.serverMode === 'v3' && Array.isArray(c.requests)) setRequests(c.requests);   // CL-4: only what a v3 server listed
    return true;
  }

  function clearDataState() {
    state.user = null;
    state.supervisor = '';
    state.staff = [];
    state.stationCounts = U.normalizeStationCounts(null);
    state.days = {};
    state.leaves = {};
    state.loaded.length = 0;
    state.draft = null;
    state.clipboard = null;
    state.audit = {};
    state.lastSync = null;
    state.requests = [];
    state.rules = defaultRules();
    ui.requestsSeq++;
    clearServerFeatures();   // the next answer announces them again (the server may have changed meanwhile)
    ui.leaveTime = null;
    ui.leaveTimeError = '';
    ui.leaveBusy = '';
    ui.proposalOff = {};
    ui.dutyPatch = null;
    ui.cacheLoaded = [];
    ui.cacheSavedAt = null;
    ui.touched = {};
    ui.unloadedWrites = {};
    ui.rangeReqs = {};
    ui.windowVersions = {};
    ui.oldServerWarned = false;
    ui.countsDraft = null;
    resetRetries();
    ui.auditLoading = {};
    ui.auditFailed = {};
    ui.pendingLeave = null;
    ui.leaveSheet = null;
    ui.importResult = null;
    ui.staffSig = null;
    ui.dayBusy = null;
    ui.tabParams = undefined;
    // in-flight / busy state of the previous session (R1a fix A-F4): its requests may still be running, but they
    // must not block or dim anything for the next user (their own completion checks the session first)
    ui.leaveSaving = false;
    ui.staffBusy = false;
    ui.dateAsking = false;
    ui.refreshing = null;
    ui.fetchingRanges = [];
    ui.pwChangeRetried = false;
    releaseBusyButtons();
    const leaveSave = $('confirmLeaveBtn');
    if (leaveSave) { leaveSave.disabled = true; leaveSave.textContent = 'บันทึก'; }
    // a new session starts on today (header date, week strip, leave calendar month)
    state.selectedDate = U.todayStr();
    ui.calMonth = '';
    ui.calPlanMonth = '';
    ui.calPlanMoved = false;
    ui.reorder = null;
    resetUserUi();
    resetCore();   // registered features: reset(), domains, ipd_dom:* / ipd_draft:*, banners, badges, chat media
  }

  /**
   * Markup that is written once (summary result, audit, staff list, import result, dialogs' inputs) would
   * otherwise keep the previous user's data on a shared device; everything else re-renders from state.
   */
  function resetUserUi() {
    setHtml($('leaveSummaryContent'), ui.summaryPlaceholder);
    setHtml($('auditLogContent'), '');
    if ($('auditCount')) $('auditCount').textContent = '…';
    if ($('auditLogBox')) $('auditLogBox').open = false;
    setHtml($('staffListContainer'), '');
    setHtml($('importResult'), '');
    setHtml($('leaveCalendar'), '');
    setHtml($('calDayDetail'), '');
    setHtml($('calMonthTotal'), '');
    setHtml($('calHolidays'), '');
    setVisible($('calHolidays'), false);
    ui.calMonth = '';
    $('transferTargetSelect').innerHTML = '<option value="">-- เลือกผู้รับสิทธิ์ --</option>';
    renderTransferBtn();   // "โอนสิทธิ์ให้ {ชื่อ}" names a person
    ['newStaffName', 'newStaffPass', 'pwOld', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
    // R1a fix B-3: the leave sheet (person, date, status, "บันทึกโดย …", data-staff on the tiles), the day's leave
    // list, the my-day / my-leave cards and the leave rows also name people; render() skips them while nobody is
    // logged in, so they are emptied here
    ['confirmLeaveText', 'leaveOptions', 'leaveSheetNote', 'stationLeaves', 'myDayCard', 'myLeaveRow', 'leaveContainer',
      'myRequestsList', 'leaveTimePresets', 'menuServerNote'].forEach(id => setHtml($(id), ''));
    ['stationLeaveCount', 'leaveCountBadge', 'myRequestsCount', 'leaveTimeError'].forEach(id => { if ($(id)) $(id).textContent = ''; });
    ['leaveTimeStart', 'leaveTimeEnd'].forEach(id => { if ($(id)) $(id).value = ''; });
    ['myRequestsCard', 'leaveTimeStep', 'menuServerNote'].forEach(id => setVisible($(id), false));
    const myDay = $('myDayCard');
    if (myDay) { delete myDay.dataset.myStations; delete myDay.dataset.myDay; delete myDay.dataset.myLeave; }
  }

  /* ------------------------------------------------------------------ */
  /* server → state                                                      */
  /* ------------------------------------------------------------------ */
  /** Apply user / supervisor / staff from any response; re-derives role-dependent state. */
  function applyServerInfo(user, supervisor, staff) {
    const wasSup = isSup();
    if (user && typeof user === 'object') state.user = Object.assign({}, user);
    if (typeof supervisor === 'string') state.supervisor = supervisor;
    else if (user && user.isSupervisor) state.supervisor = user.name;              // e.g. changePassword response
    else if (user && state.supervisor === user.name) state.supervisor = '';       // server says: no longer supervisor
    if (Array.isArray(staff)) state.staff = orderStaff(staff);
    if (state.user && state.supervisor) state.user.isSupervisor = (state.user.name === state.supervisor);

    if (!isSup()) { state.draft = null; state.clipboard = null; }
    if (state.draft) {
      const keep = assignableSet(state.draft.date);
      Object.keys(state.draft.assignments).forEach(k => {
        state.draft.assignments[k] = state.draft.assignments[k].map(n => (keep.has(n) ? n : ''));
      });
      if (!isDraftDirty()) state.draft = null;
    }
    ensureVisibleTab();   // a screen this user may no longer see (e.g. staff/summary after losing the role) → station
    if (state.user && state.user.mustChangePassword && !ui.pwForced) openPasswordModal(true);
    if (wasSup !== isSup()) emit('role', { isSup: isSup() });
  }

  function adoptDay(date, day) {
    const d = normalizeDay(day);
    if (d) { d.date = date; state.days[date] = d; } else delete state.days[date];
  }

  /**
   * user / supervisor / staff / station counts of a getData answer — unless an own staff, role or count write
   * finished after that request started (staffSeq). A server without station counts means the defaults.
   */
  function applyDataInfo(data, staffSeq) {
    if (staffSeq !== ui.staffSeq) return;
    state.stationCounts = U.normalizeStationCounts(data.stationCounts);
    applyServerInfo(data.user, data.supervisor, data.staff);
  }

  /* ---------- R1b heartbeat fields: versions, features, rules, requests ---------- */
  /**
   * The fields a v3 server adds to getData (both the full and the `unchanged` answer) and to ping. A field that is
   * missing changes nothing — except `features`: an answer without it comes from a server older than 3.0, so nothing
   * new may be shown or sent (serverHas() → false for everything) and the Supervisor is told to update Code.gs.
   * opts.requests: also take `requests` (full getData answers only); opts.reqSeq: ui.requestsSeq when the fetch started.
   * → true when something the screens show changed.
   */
  function applyServerExtras(data, opts) {
    if (!data || typeof data !== 'object') return false;
    const o = opts || {};
    // CL-25: an answer that carries the server version (ping always; any other answer that may carry it later)
    if (typeof data.version === 'string' && /^\d+\.\d+/.test(data.version) && data.version !== ui.serverVersion) ui.serverVersion = data.version;
    let changed = setServerFeatures(Array.isArray(data.features) ? data.features : null);
    if (ui.serverMode === 'old' && state.requests.length) {
      // CL-4: a server rolled back to 2.x never sends `requests` — what the v3 server listed is stale now (memory, banners,
      // badges, "คำขอของฉัน", and with the next persistCache the offline copy too)
      ui.requestsSeq++;
      changed = setRequests([]) || changed;
    }
    if (data.rules && typeof data.rules === 'object') changed = applyRules(data.rules) || changed;
    if (data.versions && typeof data.versions === 'object') {
      Object.keys(data.versions).forEach(name => { if (name !== 'core') setRemoteVersion(name, data.versions[name]); });
    }
    if (o.requests && Array.isArray(data.requests) && o.reqSeq === ui.requestsSeq) changed = setRequests(data.requests) || changed;
    return changed;
  }

  /** list: the server's `features` (null = the server announced none, i.e. it is older than 3.0). → changed? */
  function setServerFeatures(list) {
    const mode = Array.isArray(list) ? 'v3' : 'old';
    const next = (list || []).filter(f => typeof f === 'string' && f).sort().join('\n');
    const before = Object.keys(serverFeatures).sort().join('\n');
    if (next === before && ui.serverMode === mode) return false;
    clearServerFeatures();
    if (next) next.split('\n').forEach(f => { serverFeatures[f] = true; });
    ui.serverMode = mode;
    return true;
  }
  function clearServerFeatures() {
    Object.keys(serverFeatures).forEach(k => { delete serverFeatures[k]; });
    ui.serverMode = '';
  }

  function defaultRules() {
    return { vacationAutoSlots: null, planPriority: DEFAULT_PLAN_PRIORITY, planSlotOrder: 'coverage' };
  }
  /** A valid permutation of the 7 station ids (frozen), else the default order (R2-SPEC §4.2). */
  function planPriorityOf(list) {
    const ids = U.STATIONS.map(st => st.id);
    const ok = Array.isArray(list) && list.length === ids.length && ids.every(id => list.indexOf(id) >= 0);
    return ok ? Object.freeze(list.slice()) : DEFAULT_PLAN_PRIORITY;
  }

  /**
   * The heartbeat's `rules` (and setPlanSettings' answer): each known field that is present and valid is taken, the
   * others keep their value. → true when something changed.
   */
  function applyRules(rules) {
    const next = Object.assign({}, state.rules);
    const n = rules.vacationAutoSlots;
    if (Number.isInteger(n) && n >= 0) next.vacationAutoSlots = n;
    if (rules.planPriority !== undefined) next.planPriority = planPriorityOf(rules.planPriority);
    if (rules.planSlotOrder !== undefined) next.planSlotOrder = PLAN_SLOT_ORDERS.indexOf(rules.planSlotOrder) >= 0 ? rules.planSlotOrder : 'coverage';
    if (next.vacationAutoSlots === state.rules.vacationAutoSlots && next.planSlotOrder === state.rules.planSlotOrder &&
      next.planPriority.join() === state.rules.planPriority.join()) return false;
    state.rules = next;
    return true;
  }

  /** A leave row as the server sends it (LeaveV3, or the v2 shape): a valid date, a staff name and a type. */
  function validLeaveRow(l) {
    return !!l && typeof l === 'object' && U.isValidYmd(l.date) && typeof l.staff === 'string' && !!l.staff &&
      typeof l.type === 'string' && !!l.type;
  }

  /** Replaces state.requests (sorted by date, then recordedAt); emits 'data' {requests: true} when it changed. */
  function setRequests(list) {
    const next = (Array.isArray(list) ? list : []).filter(validLeaveRow).map(l => Object.freeze(Object.assign({}, l)))
      .sort((a, b) => U.compareYmd(a.date, b.date) || (String(a.recordedAt) < String(b.recordedAt) ? -1 : String(a.recordedAt) > String(b.recordedAt) ? 1 : 0));
    if (JSON.stringify(next) === JSON.stringify(state.requests)) return false;
    state.requests = Object.freeze(next);
    emit('data', { requests: true });
    return true;
  }

  /**
   * An own leave write (setLeave / decideLeave answer) changes state.requests at once: the row belongs there when it is
   * pending (the Supervisor sees everyone's, anyone else their own) or — for anyone but the Supervisor — their own
   * rejected row. `leave` null: the row of (date, staff) is gone.
   */
  function updateRequestFor(date, staff, leave) {
    const me = myName();
    const st = U.leaveStatus(leave);
    const belongs = !!leave && (st === 'pending' ? (isSup() || leave.staff === me) : st === 'rejected' && !isSup() && leave.staff === me);
    const rest = state.requests.filter(r => !(r.date === date && r.staff === staff));
    ui.requestsSeq++;   // a getData answer that was read before this write must not bring the old list back
    setRequests(belongs ? rest.concat([leave]) : rest);
  }

  /** seq / staffSeq: ui.writeSeq / ui.staffSeq when the fetch started (older answers must not undo our writes). */
  function mergeData(data, from, to, seq, staffSeq) {
    applyDataInfo(data, staffSeq);
    const rf = (data.range && data.range.from) || from;
    const rt = (data.range && data.range.to) || to;
    const keep = d => (ui.touched[d] || 0) > seq;   // written locally after this fetch started
    Object.keys(state.days).forEach(d => { if (d >= rf && d <= rt && !keep(d)) delete state.days[d]; });
    Object.keys(state.leaves).forEach(d => { if (d >= rf && d <= rt && !keep(d)) delete state.leaves[d]; });
    (data.days || []).forEach(day => {
      if (!day || !U.isValidYmd(day.date) || keep(day.date)) return;
      adoptDay(day.date, day);
    });
    (data.leaves || []).forEach(l => {
      if (!l || !U.isValidYmd(l.date) || !l.staff || keep(l.date)) return;
      (state.leaves[l.date] = state.leaves[l.date] || nameMap())[l.staff] = l;
    });
    replayUnloadedWrites(rf, rt, seq, keep);
    addLoaded(rf, rt);
    if (state.draft && !isDraftDirty()) state.draft = null;   // clean draft → follow the server
  }

  /**
   * CL-2: own leave writes made while their date was not loaded ("parked" in ui.unloadedWrites). The ordering rules, by
   * REQUEST sequence (ui.writeSeq when a getData was sent, compared with the write's seq) and by DAY version:
   *  1. An answer requested BEFORE a parked write may not contain it: the written row is laid over it (set or removed) and
   *     the write's day (an auto-unassign) replaces the answer's day when its version is the same or newer. The write stays
   *     parked — every further older answer gets the same overlay, in write order.
   *  2. An answer requested AFTER a parked write contains it: that answer is merged as it is, the write leaves the parking
   *     and the date becomes protected exactly like a date written while loaded (ui.touched[date] = the write's seq): from
   *     then on every answer requested before that write keeps the local copy of the date (mergeData keep()), so an older
   *     answer that arrives last can never take the write back, move the person back onto a station or lower the day's
   *     version. (Before the second rule existed, such an answer won — reviewer 2 finding 1.)
   *  3. Two writes for the same person while parked: the later row wins; the later day wins when it has one, else the earlier
   *     write's day is kept (the server took the person off the day with the first write — reviewer 2 finding 3).
   *  4. A day is never replaced by an older version (here and in applyLeaveWrite's loaded path).
   */
  function replayUnloadedWrites(rf, rt, seq, keep) {
    const replay = [];
    const protect = {};
    Object.keys(ui.unloadedWrites).forEach(date => {
      if (date < rf || date > rt) return;
      const rows = ui.unloadedWrites[date];
      Object.keys(rows).forEach(staff => {
        if (rows[staff].seq > seq) replay.push(Object.assign({ date, staff }, rows[staff]));
        else {
          protect[date] = Math.max(protect[date] || 0, rows[staff].seq);
          delete rows[staff];
        }
      });
      if (!Object.keys(rows).length) delete ui.unloadedWrites[date];
    });
    replay.sort((a, b) => a.seq - b.seq).forEach(w => {
      if (keep(w.date)) return;   // a write of the loaded date came later: the local copy already holds everything
      putLeaveRow(w.date, w.staff, w.leave);
      if (w.day && (w.day.version | 0) >= currentVersion(w.date)) adoptDay(w.date, w.day);
    });
    // rule 2 (after this answer was merged, so it applies to the answers that come after it)
    Object.keys(protect).forEach(date => { ui.touched[date] = Math.max(ui.touched[date] || 0, protect[date]); });
  }

  /** Sets (leave) or removes (null) the row of (date, staff) in state.leaves. */
  function putLeaveRow(date, staff, leave) {
    const map = state.leaves[date] = state.leaves[date] || nameMap();
    if (leave) map[staff] = leave;
    else delete map[staff];
    if (!Object.keys(map).length) delete state.leaves[date];
  }

  /**
   * One getData request. `poll`: this is the refresh of the selected date's window — when the window is
   * loaded and its dataVersion known, the server is only asked whether anything changed (knownVersion); an
   * "unchanged" answer carries no days/leaves, just user/staff/counts. Resolves false for "unchanged".
   */
  async function fetchChunk(from, to, poll) {
    const alive = sessionAlive(), seq = ui.writeSeq, staffSeq = ui.staffSeq, reqSeq = ui.requestsSeq;
    const key = from + '|' + to;
    const params = { from, to };
    if (poll && ui.windowVersions[key] && !missingRanges(from, to).length) params.knownVersion = ui.windowVersions[key];
    const data = (await Api.call('getData', params)) || {};
    if (!alive()) return false;
    const unchanged = data.unchanged === true;
    applyServerExtras(data, { requests: !unchanged, reqSeq });
    if (unchanged) applyDataInfo(data, staffSeq);
    else {
      mergeData(data, from, to, seq, staffSeq);
      if (poll && typeof data.dataVersion === 'string') ui.windowVersions[key] = data.dataVersion;
    }
    state.lastSync = Date.now();
    persistCache();
    warnIfOldServer();
    emit('data', { from, to, changed: !unchanged });
    return !unchanged;
  }

  /**
   * Make sure [from, to] is loaded (fetch only missing parts unless force; `poll` see fetchChunk). Throws
   * ApiError. Resolves true when data was (re)loaded, false when nothing was fetched or nothing changed.
   */
  async function ensureRange(from, to, opts) {
    // while the password must be changed every data action is refused (A1); loading resumes after the change
    if (!state.session || ui.pwForced || !U.isValidYmd(from) || !U.isValidYmd(to) || from > to) return false;
    const force = !!(opts && opts.force);
    const poll = !!(opts && opts.poll);
    const parts = force ? [{ from, to }] : missingRanges(from, to);
    if (!parts.length) return false;
    const chunks = [];
    parts.forEach(p => chunkRange(p.from, p.to, MAX_CHUNK_DAYS).forEach(c => chunks.push(c)));
    const span = { from, to };
    ui.fetchingRanges.push(span);
    render();
    let changed = false;
    try {
      for (const c of chunks) {
        const key = c.from + '|' + c.to;
        let p = force ? null : ui.rangeReqs[key];
        if (!p) {
          p = fetchChunk(c.from, c.to, poll);
          ui.rangeReqs[key] = p;
          const clear = () => { if (ui.rangeReqs[key] === p) delete ui.rangeReqs[key]; };
          p.then(clear, clear);
        }
        if (await p) changed = true;
      }
    } finally {
      const i = ui.fetchingRanges.indexOf(span);   // gone when a logout / new login reset the list meanwhile
      if (i >= 0) ui.fetchingRanges.splice(i, 1);
      render();
    }
    return changed;
  }

  /**
   * Force-reload the window around the selected date. Resolves true/false (never rejects). A refresh already
   * in flight is shared, unless `restart`: after our own write it may have been read before that write.
   * opts.silent: no message on failure (background); opts.quiet: no message for connection problems (the
   * header shows those, and retries are scheduled).
   */
  function refresh(opts) {
    opts = opts || {};
    if (!state.session || ui.pwForced) return Promise.resolve(false);
    if (ui.refreshing && !opts.restart) return ui.refreshing;
    const w = windowFor(state.selectedDate);
    const p = track(ensureRange(w.from, w.to, { force: true, poll: true }).then(changed => {
      resetRetries();
      if (changed) {   // the audit trail can only have changed with the data
        state.audit = {};
        ui.auditFailed = {};
      }
      return true;
    }, e => {
      if (Api.isTransient(e)) scheduleRetry();
      if (!opts.silent) handleError(e, { noRefresh: true, quiet: opts.quiet });
      return false;
    }).then(ok => {
      if (ui.refreshing === p) ui.refreshing = null;
      render();
      return ok;
    }));
    ui.refreshing = p;
    return p;
  }

  /** After a failed refresh (or write): refresh again in 5, 15, 30 and 60 s, then the normal 90 s cadence. */
  function scheduleRetry() {
    const ms = RETRY_DELAYS_MS[ui.retryStep];
    if (ui.retryTimer || ms === undefined || deviceOffline()) return;   // no network: the 'online' event refreshes
    ui.retryStep++;
    ui.retryTimer = setTimeout(() => {
      ui.retryTimer = null;
      refresh({ silent: true });
    }, ms);
  }

  function resetRetries() {
    clearTimeout(ui.retryTimer);
    ui.retryTimer = null;
    ui.retryStep = 0;
  }

  /**
   * Api.onStatus: any answer from the server means online. A transient failure means "reconnecting" (data
   * stays, editing goes on) until OFFLINE_AFTER_FAILURES calls in a row failed; no network at all is offline.
   */
  function onApiStatus(ev) {
    if (ev.type === 'success') {
      ui.failStreak = 0;
      setConn('online', '');
      return;
    }
    if (ev.type === 'failed') ui.failStreak++;
    if (deviceOffline()) setConn('offline', 'device');
    else setConn(ui.failStreak >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting', 'server');
  }

  function setConn(conn, reason) {
    if (state.conn === conn && ui.connReason === reason) return;
    state.conn = conn;
    ui.connReason = reason;
    renderSyncStatus();
    renderOfflineBanner();
  }

  /** Tells a supervisor once per session that Code.gs is still the old version (no echo, no station counts). */
  function warnIfOldServer() {
    if (Api.serverVersionOk !== false || !isSup() || ui.oldServerWarned) return;
    ui.oldServerWarned = true;
    toast(MSG.oldServer, 5000);
  }

  /* ------------------------------------------------------------------ */
  /* errors                                                              */
  /* ------------------------------------------------------------------ */
  /**
   * opts.write: a write failed — after a connection problem its input (e.g. the station draft) is kept and the
   * latest data is fetched again soon (the write may have landed); opts.quiet: no message for connection
   * problems; opts.noRefresh: no refresh after FORBIDDEN / CONFLICT.
   */
  function handleError(e, opts) {
    opts = opts || {};
    if (!e) return;
    if (e.name !== 'ApiError') {
      console.error(e);
      toast('เกิดข้อผิดพลาด: ' + (e.message || String(e)), 0, { error: true });
      return;
    }
    if (Api.isTransient(e)) {
      if (opts.write) {
        toast(e.code === 'BUSY' ? e.message : MSG.writeFailed, 5000, { error: true });
        if (!ui.retryTimer) ui.retryStep = 0;   // the write may have landed: check again soon, even after a long outage
        scheduleRetry();
      } else if (!opts.quiet) toast(e.message, 0, { error: true });
      return;
    }
    switch (e.code) {
      case 'AUTH_REQUIRED':
      case 'PASSWORD_CHANGE_REQUIRED':
        return;   // Api.onAuthError already handled the session (or the reply was for an old token)
      case 'FORBIDDEN':
      case 'CONFLICT':
        toast(e.message, 0, { error: true });
        if (!opts.noRefresh) refresh();
        return;
      default:
        toast(e.message || 'เกิดข้อผิดพลาด', 0, { error: true });
    }
  }

  /** The non-forced password sheet — เมนู's "เปลี่ยนรหัสผ่าน" and the profile screen's (core.openPasswordChange) are this one routine. */
  function openPasswordChange() { if (state.session && !ui.pwForced) openPasswordModal(false); }

  /**
   * "<recorded by> · 18 พ.ย. 08:30 น." of a leave row (escaped HTML); the time never breaks — a lone "น." on its own line looked
   * broken (I1). Same text as [recordedBy, thaiStampShort(recordedAt)].join(' · ').
   */
  function metaHtml(leave) {
    return [leave.recordedBy ? esc(leave.recordedBy) : '',
      leave.recordedAt ? `<span class="whitespace-nowrap">${esc(U.thaiStampShort(leave.recordedAt))}</span>` : ''].filter(Boolean).join(' · ');
  }

  /** Api.onAuthError: the current session is no longer valid, or must set a new password first (A1). */
  function onSessionError(e) {
    if (!state.session) return;
    if (e.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (state.user) state.user.mustChangePassword = true;
      if (!ui.pwForced) { openPasswordModal(true); render(); }
      return;
    }
    // A retried password change whose first attempt went through finds its old token revoked: the change
    // itself succeeded, only its answer (with the new token) was lost.
    const msg = ui.pwChangeRetried ? MSG.pwChangedRelogin : MSG.sessionExpired;
    doLogout();
    toast(msg, 4000);
  }
  function isSessionError(e) { return !!e && (e.code === 'AUTH_REQUIRED' || e.code === 'PASSWORD_CHANGE_REQUIRED'); }

  /** Writes are refused locally only when the device has no network at all; otherwise they are attempted. */
  function requireInternet() {
    if (!deviceOffline()) return true;
    toast(MSG.noInternet);
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* startup / session                                                   */
  /* ------------------------------------------------------------------ */
  async function startup() {
    const src = resolveApiUrl();
    state.apiUrl = src.url;
    ui.apiUrlSource = src.source;
    if (!state.apiUrl) { openSetupModal(false); render(); return; }
    Api.configure(state.apiUrl);
    await startSession();
  }

  /**
   * A remembered session shows the offline copy at once and then makes ONE request, getData (it also returns
   * the user, role, staff and counts). AUTH_REQUIRED logs out and PASSWORD_CHANGE_REQUIRED opens the forced
   * modal (both via Api.onAuthError); a connection problem keeps the copy on screen and retries later.
   */
  async function startSession() {
    const session = loadSession();
    if (!session) {
      showLogin();
      render();
      await ui.loginUsersPromise;
      return;
    }
    ui.epoch++;
    state.session = session;
    Api.setToken(session.token);
    restoreCache(session.name);
    restoreDomains();
    hideModal('loginModal');
    emit('login', { name: session.name, restored: true });
    render();
    await refresh({ quiet: true });
    if (state.session && !state.user) {
      // nothing cached and nothing loaded: show this person's (empty) view instead of an endless "loading"
      state.user = { name: session.name, group: '', isSupervisor: false, mustChangePassword: false };
      render();
    }
    if (ui.loginUsersPromise) await ui.loginUsersPromise;   // logged out meanwhile: the login list is loading
  }

  /** Opens the login modal and reloads the user list (a shared device may sit on this screen for hours). */
  function showLogin() {
    $('loginPassword').value = '';
    resetLoginPasswordToggle();
    showLoginError('');
    setVisible($('loginSettingsLink'), ui.apiUrlSource === 'local');
    renderLoginSelect();
    // phones: focus on the title (no on-screen keyboard over the form); a desktop: straight into the name list
    const desktop = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;
    Kit.sheet.open('loginModal', { initialFocus: desktop ? '#loginUserSelect' : '[data-sheet-title]' });
    reloadLoginUsers();
  }

  /** kind 'list' marks a list-loading error, which a later successful load clears again. */
  function showLoginError(msg, kind) {
    const el = $('loginError');
    el.textContent = msg || '';
    el.dataset.kind = kind || '';
    setVisible(el, !!msg);
  }

  /** (Re)loads the login list; calls made while a load is running share it. */
  function reloadLoginUsers() {
    if (!ui.loginUsersPromise) {
      ui.loginUsersPromise = track(loadLoginUsers()).then(() => { ui.loginUsersPromise = null; });
    }
    return ui.loginUsersPromise;
  }

  async function loadLoginUsers() {
    ui.loginUsersLoading = true;
    ui.loginUsersError = '';
    renderLoginSelect();
    try {
      const d = await Api.call('listUsers');
      ui.loginUsers = Array.isArray(d && d.users) ? d.users.filter(u => u && typeof u.name === 'string') : [];
      if ($('loginError').dataset.kind === 'list') showLoginError('');
    } catch (e) {
      ui.loginUsersError = (e && e.message) || 'โหลดรายชื่อไม่สำเร็จ';
    } finally {
      ui.loginUsersLoading = false;
      renderLoginSelect();
    }
  }

  function renderLoginSelect() {
    const sel = $('loginUserSelect');
    const prev = sel.value;
    let html;
    if (ui.loginUsersLoading && !ui.loginUsers.length) {
      html = '<option value="">กำลังโหลดรายชื่อ…</option>';
    } else {
      const opt = u => `<option value="${esc(u.name)}">${esc(u.name)}${u.isSupervisor ? ' ⭐ (Supervisor)' : ''}</option>`;
      const reg = ui.loginUsers.filter(u => u.group !== 'backup');
      const bak = ui.loginUsers.filter(u => u.group === 'backup');
      html = '<option value="">-- เลือกชื่อของคุณ --</option>' +
        (reg.length ? `<optgroup label="คนประจำ">${reg.map(opt).join('')}</optgroup>` : '') +
        (bak.length ? `<optgroup label="ทีมแทนเวร">${bak.map(opt).join('')}</optgroup>` : '');
    }
    setHtml(sel, html);
    if (prev && ui.loginUsers.some(u => u.name === prev)) sel.value = prev;
    $('loginReloadBtn').disabled = ui.loginUsersLoading;
    if (ui.loginUsersError && !ui.loginUsersLoading) showLoginError('โหลดรายชื่อไม่สำเร็จ: ' + ui.loginUsersError, 'list');
  }

  async function handleLogin() {
    const name = $('loginUserSelect').value;
    const password = $('loginPassword').value.trim();
    if (!name) { showLoginError('กรุณาเลือกชื่อผู้ใช้งาน'); return; }
    if (!password) { showLoginError('กรุณาใส่รหัสผ่าน'); return; }
    showLoginError('');
    let d = null;
    await withBusy($('loginBtn'), 'กำลังเข้าสู่ระบบ…', async () => {
      try { d = await userCall('login', { name, password }); }
      catch (e) { showLoginError(e.message || 'เข้าสู่ระบบไม่สำเร็จ'); }
    });
    if (!d || !d.token || !d.user) return;
    $('loginPassword').value = '';
    resetLoginPasswordToggle();
    beginSession(d);
    if (state.user.mustChangePassword) openPasswordModal(true);   // before render: no data calls meanwhile (A1)
    render();
    if (ui.pwForced) return;
    toast(`👋 ยินดีต้อนรับคุณ ${state.user.name}`);
    await refresh({ quiet: true });
    maybeShowWhatsNew();
  }

  function beginSession(d) {
    ui.epoch++;
    closeSessionSheets();
    clearDataState();
    const user = d.user;
    state.session = { token: d.token, name: user.name, expiresAt: d.expiresAt };
    saveSession(state.session);
    Api.setToken(d.token);
    const listedSup = (ui.loginUsers.find(u => u.isSupervisor) || {}).name || '';
    state.supervisor = user.isSupervisor ? user.name : (listedSup !== user.name ? listedSup : '');
    state.user = Object.assign({}, user);
    state.staff = orderStaff(ui.loginUsers);   // provisional until getData answers
    ui.tab = 'station';
    hideModal('loginModal');
    emit('login', { name: user.name, restored: false });
  }

  function doLogout() {
    lsRemove(LS.session);
    lsRemove(LS.cache);
    lsRemove(LS.cacheV2);
    Api.setToken(null);
    ui.epoch++;
    state.session = null;
    closeSessionSheets();
    clearDataState();
    ui.pwForced = false;
    ui.tab = 'station';
    hideModal('passwordModal');
    hideModal('confirmLeaveModal');
    hideModal('transferModal');
    hideModal('stationCountsModal');
    hideModal('dayToolsModal');
    hideModal('whatsNewModal');
    showLogin();
    render();
    emit('logout', {});
  }

  /**
   * Sheets and in-app questions belong to the session that opened them (R1a fix A-F2): on logout and before a new
   * login every open sheet and UiKit dialog is closed (a question resolves with its cancel value, so the flow that
   * awaits it stops at its sessionAlive() check). The login and setup screens are device level and stay.
   */
  function closeSessionSheets() {
    Kit.sheet.stack().slice().reverse().forEach(el => {
      if (el.id === 'loginModal' || el.id === 'setupModal') return;
      Kit.sheet.close(el);
    });
    ui.dateAsking = false;
  }

  async function onLogoutClick() {
    const msg = isDraftDirty()
      ? 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก — ต้องการออกจากระบบใช่หรือไม่?'
      : 'ต้องการออกจากระบบใช่หรือไม่?';
    const epoch = ui.epoch;
    if (!(await confirmUser(msg, { title: 'ออกจากระบบ', okLabel: 'ออกจากระบบ', icon: 'log-out' }))) return;
    if (epoch !== ui.epoch) return;   // the session ended meanwhile (e.g. it expired while the question was open)
    doLogout();
    toast('🚪 ออกจากระบบเรียบร้อย');
  }

  /* ---------- password modal ---------- */
  function openPasswordModal(forced) {
    ui.pwForced = !!forced;
    const who = state.session ? state.session.name : myName();   // known even before the first getData answered
    $('pwTitle').textContent = forced ? 'ตั้งรหัสผ่านใหม่ก่อนใช้งาน' : 'เปลี่ยนรหัสผ่าน';
    $('pwDesc').textContent = forced
      ? `คุณ ${who} ยังใช้รหัสผ่านเริ่มต้นหรือรหัสที่ถูกรีเซ็ต กรุณาตั้งรหัสผ่านใหม่ (4–64 ตัวอักษร และห้ามใช้ 1234)`
      : `ผู้ใช้: ${who}`;
    ['pwOld', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
    pwError('');
    setVisible($('pwCancelBtn'), !forced);
    setVisible($('pwCloseBtn'), !forced);
    setVisible($('pwLogoutBtn'), !!forced);
    showModal('passwordModal');
  }

  function closePasswordModal() {
    if (ui.pwForced) return;
    hideModal('passwordModal');
    ['pwOld', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
  }

  function pwError(msg) { const el = $('pwError'); el.textContent = msg || ''; setVisible(el, !!msg); }

  async function onPwSave() {
    const oldP = $('pwOld').value.trim();
    const newP = $('pwNew').value.trim();
    const conf = $('pwConfirm').value.trim();
    if (!oldP) { pwError('กรุณากรอกรหัสผ่านเดิม'); return; }
    const pe = U.validatePassword(newP);
    if (pe) { pwError(pe); return; }
    if (newP === '1234') { pwError('ห้ามใช้รหัสผ่านเริ่มต้น (1234) กรุณาตั้งรหัสผ่านใหม่'); return; }
    if (newP !== conf) { pwError('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'); return; }
    if (deviceOffline()) { pwError(MSG.noInternet); return; }
    pwError('');
    const alive = sessionAlive();   // "ออกจากระบบ" stays available while the change is in flight
    let res = null;
    const retried = () => { ui.pwChangeRetried = true; toast(MSG.retrying, 4000); };
    await withBusy($('pwSaveBtn'), 'กำลังบันทึก…', async () => {
      try { res = await userCall('changePassword', { oldPassword: oldP, newPassword: newP }, { onRetry: retried }); }
      catch (e) {
        if (isSessionError(e) || !alive()) return;
        pwError(e.message);
      } finally {
        ui.pwChangeRetried = false;
      }
    });
    if (!res || !res.token || !alive()) return;
    const wasForced = ui.pwForced;
    const user = res.user || state.user;
    state.session = { token: res.token, name: user.name, expiresAt: res.expiresAt };
    saveSession(state.session);
    Api.setToken(res.token);
    ui.pwForced = false;
    ui.staffSeq++;
    ui.auditFailed = {};   // reads refused before the change (old token, forced change) may be retried now
    applyServerInfo(Object.assign({}, user, { mustChangePassword: false }));
    hideModal('passwordModal');
    ['pwOld', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
    persistCache();
    render();
    toast('🔑 เปลี่ยนรหัสผ่านสำเร็จ');
    if (wasForced) {
      await refresh({ quiet: true });
      maybeShowWhatsNew();
    }
  }

  /* ---------- setup modal ---------- */
  function openSetupModal(cancelable) {
    ui.setupCancelable = !!cancelable;
    $('setupApiUrl').value = state.apiUrl || '';
    setupMsg('', '');
    setVisible($('setupCancelBtn'), !!cancelable);
    setVisible($('setupCloseBtn'), !!cancelable);
    showModal('setupModal');
  }

  function setupMsg(msg, kind) {
    const el = $('setupError');
    el.textContent = msg || '';
    el.className = 'text-xs font-medium text-center p-2 rounded-xl ' +
      (kind === 'warn' ? 'text-amber-800 bg-amber-50 border border-amber-200' : 'text-coral-700 bg-coral-50 border border-coral-200');
    setVisible(el, !!msg);
  }

  async function onSetupSave() {
    const url = $('setupApiUrl').value.trim();
    if (!url) { setupMsg('กรุณาวาง URL ของ Web App', 'error'); return; }
    let parsed = null;
    try { parsed = new URL(url); } catch (e) { parsed = null; }
    const localDev = parsed && parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname);
    if (!parsed || (parsed.protocol !== 'https:' && !localDev)) { setupMsg('URL ต้องขึ้นต้นด้วย https://', 'error'); return; }
    const looksRight = /^https:\/\/script\.google\.com\/(macros|a\/macros\/[^/]+)\/s\/[^/]+\/exec\/?$/.test(url);
    if (!looksRight) setupMsg('คำเตือน: URL นี้ไม่ใช่รูปแบบ https://script.google.com/macros/s/.../exec — กำลังลองเชื่อมต่อ…', 'warn');
    else setupMsg('', '');

    let ok = false;
    await withBusy($('setupSaveBtn'), 'กำลังทดสอบ…', async () => {
      const prevUrl = Api.url;
      Api.configure(url);
      try {
        const d = await Api.call('ping');
        if (!d || !d.version) throw new Api.ApiError('BAD_DEPLOYMENT', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง');
        ui.serverVersion = String(d.version);
        ok = true;
      } catch (e) {
        Api.configure(prevUrl);
        // A browser reports a deployment that is not shared with "Anyone" as a CORS failure, i.e. NETWORK.
        setupMsg(e.code === 'NETWORK' ? MSG.setupNetwork : 'เชื่อมต่อไม่สำเร็จ: ' + (e.message || e), 'error');
      }
    });
    if (!ok) return;

    const changed = url !== state.apiUrl;
    lsSet(LS.apiUrl, url);
    if (!String(cfg().API_URL || '').trim()) { state.apiUrl = url; ui.apiUrlSource = 'local'; }
    hideModal('setupModal');
    toast('✅ เชื่อมต่อเซิร์ฟเวอร์สำเร็จ');
    if (changed && state.session) { doLogout(); return; }   // different backend → start over
    if (!state.session) await startSession();
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */
  let renderDepth = 0;
  let renderAgain = false;

  /**
   * Renders everything from state: the legacy screens (always, they are read across tabs), the chrome, banners and
   * the current feature screen. A render() requested while rendering (e.g. by a feature hook) runs right after.
   */
  function render() {
    if (renderDepth) { renderAgain = true; return; }
    renderDepth++;
    try {
      let rounds = 0;
      do {
        renderAgain = false;
        renderOnce();
      } while (renderAgain && ++rounds < 3);
    } finally {
      renderDepth--;
    }
  }

  function renderOnce() {
    renderDateInputs();
    renderRole();
    renderTabs();
    renderStationTab();
    renderLeaveTab();
    renderStaffTab();
    renderSummaryTab();
    renderMenu();
    renderChrome();
    renderSyncStatus();
    renderOfflineBanner();
    renderBanners();
    renderCurrentFeature();
  }

  function renderDateInputs() {
    const d = state.selectedDate;
    $('headerDate').textContent = headerDateText(d);
    if ($('currentDate').value !== d) $('currentDate').value = d;
    if ($('leaveTargetDate').value !== d) $('leaveTargetDate').value = d;
    const img = $('summaryImageDate');   // รายงานและส่งออก: the date of the image preview (A-F3)
    if (img && img.value !== d) img.value = d;
    renderBeCaptions();
  }

  /** The Buddhist-era date under every native date input (the picker itself shows the device's calendar) — Minor 1. */
  function renderBeCaptions() {
    document.querySelectorAll('[data-be-for]').forEach(p => {
      const inp = $(p.dataset.beFor);
      setText(p, inp && U.isValidYmd(inp.value) ? U.thaiDateShort(inp.value, { weekday: true }) : '');
    });
  }

  function renderSyncStatus() {
    const el = $('syncStatus');
    if (!el) return;
    const st = state.conn === 'online' && Api.inflight > 0 ? 'syncing' : state.conn;
    if (el.dataset.state !== st || !el._look) {
      const look = SYNC_LOOK[st];
      el.dataset.state = st;
      el._look = st;
      el.querySelector('[data-role="dot"]').style.color = look.color;
      setText(el.querySelector('[data-role="label"]'), look.label);
      const short = el.querySelector('[data-role="short"]');
      if (short) setText(short, look.short);
      const ic = el.querySelector('[data-role="icon"]');
      if (ic) setHtml(ic, Kit.icon(look.icon, 'w-5 h-5'));
      el.setAttribute('aria-label', 'สถานะการเชื่อมต่อ: ' + look.label);
    }
    fitHeader();
  }

  /**
   * C-M1: the header date (or title) never gives way. When the row is too tight the sync pill steps down instead:
   * full (dot + label) → short (dot + short label) → icon (state icon + dot; the label stays for screen readers) →
   * tight (also without the chevron) → nopill (narrow phones; the pill steps out of the row and the date is one step
   * smaller — a non-online state is still shown by the line / banner under the header, and the connection check stays
   * in เมนู) → mini (R3: the extreme, 320 px at a large text size with the chat icon in the header: the date one more
   * step smaller, and as a last resort it ends in "…" inside its column — it never runs under the header icons; the
   * "X-RAY IPD" wordmark caption is hidden rather than cut — R3 FIX-CL L-10). The wordmark must fit at every level too.
   * Measured once per width / text / state / font / header entries (memo), so render() stays cheap.
   */
  const FIT_LEVELS = ['full', 'short', 'icon', 'tight', 'nopill', 'mini'];
  let fitMemo = Object.create(null), fitMemoSize = 0;
  function fitHeader() {
    const main = $('headerMain'), pill = $('syncStatus'), dateLine = $('headerDateLine'), title = $('headerTitle'), cap = $('headerCaption');
    if (!main || !pill || !dateLine || !title) return;
    const dated = !dateLine.classList.contains('hidden');
    const line = dated ? dateLine : title;
    const root = document.documentElement;
    const key = [window.innerWidth, root.classList.contains('no-webfont'), getComputedStyle(root).fontSize, dated,
      line.textContent, cap ? cap.textContent : '', pill.dataset.state, isShown('headerBackBtn'), isShown('headerNav'),
      document.querySelectorAll('#headerNav > .nav-btn:not(.hidden)').length].join('|');
    const apply = lv => { if (pill.dataset.fit !== lv) pill.dataset.fit = lv; if (main.dataset.fit !== lv) main.dataset.fit = lv; };
    if (fitMemo[key]) { apply(fitMemo[key]); return; }
    if (!main.clientWidth) { apply('full'); return; }   // not laid out (e.g. no stylesheet yet): nothing to measure
    // R3 FIX-CL L-10: the wordmark caption counts too — it is never cut to "X-R…": the pill steps out first, and at mini the
    // wordmark is hidden (index.html: #headerMain[data-fit="mini"] #headerCaption[data-wordmark])
    const capFits = () => !cap || !cap.dataset.wordmark || !cap.offsetWidth || cap.scrollWidth <= cap.clientWidth + 0.5;
    const fits = () => (dated ? dateLine.offsetWidth <= main.clientWidth - 4 + 0.5 : title.scrollWidth <= title.clientWidth + 0.5) && capFits();
    let lv = FIT_LEVELS[0];
    for (let i = 0; i < FIT_LEVELS.length; i++) {
      lv = FIT_LEVELS[i];
      apply(lv);
      if (fits()) break;
    }
    if (++fitMemoSize > 64) { fitMemo = Object.create(null); fitMemoSize = 1; }
    fitMemo[key] = lv;
  }

  /**
   * Minor 9: without the web fonts (Mitr never loaded: blocked, offline first run) display text gets weight 600
   * (html.no-webfont, see the inline <style>), because the system Thai fonts have no 500 and would fall back to 400.
   */
  function webFontLoaded() {
    const fonts = document.fonts;
    if (!fonts || typeof fonts.forEach !== 'function') return false;
    let ok = false;
    fonts.forEach(f => { if (!ok && /mitr/i.test(String(f.family)) && f.status === 'loaded') ok = true; });
    return ok;
  }
  function syncWebFontFlag() {
    const root = document.documentElement;
    const off = !webFontLoaded();
    if (root.classList.contains('no-webfont') === off) return;
    root.classList.toggle('no-webfont', off);
    fitHeader();
  }
  function watchWebFonts() {
    syncWebFontFlag();
    const fonts = document.fonts;
    if (!fonts) return;
    if (typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', syncWebFontFlag);
    if (fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(syncWebFontFlag, () => {});
  }

  function renderOfflineBanner() {
    const b = $('offlineBanner');
    if (!b) return;
    setVisible(b, state.conn === 'offline');
    // a non-online state is never shown by the (possibly icon-only) pill alone: reconnecting gets its own line (C-M1)
    setVisible($('connLine'), state.conn === 'reconnecting');
    const t = state.lastSync || (ui.cacheSavedAt ? Date.parse(ui.cacheSavedAt) : null);
    const since = 'แสดงข้อมูลล่าสุดเมื่อ ' + (t ? U.thaiStamp(t) : '-');
    $('offlineText').textContent = ui.connReason === 'device'
      ? 'ไม่มีอินเทอร์เน็ต — ' + since
      : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ' + since + ' • ระบบกำลังลองใหม่อัตโนมัติ';
    syncLayout();
  }

  /** "พฤ. 26 พ.ย. 2569" — the header's form of the date: short weekday, so it always fits (C-M1). */
  function headerDateText(date) {
    return U.thaiDateShort(date, { weekday: true });
  }

  /**
   * Keeps the content clear of the fixed chrome whatever its height: below the header (+ week strip / offline
   * banner), above the bottom bar and the save bar (phones; from md: up the bar is a left rail). The toast and
   * the update notice sit just under the header, never over the save bar or a sheet's buttons. While the update
   * notice is shown the content starts below it too (I1: it covered the first banner and its button).
   */
  function syncLayout() {
    const h = $('appHeader'), m = $('appMain'), ub = $('updateBanner');
    if (!h || !m) return;
    const ht = h.offsetHeight;
    const notice = ub && !ub.classList.contains('hidden') && ub.offsetHeight > 0 ? ub.offsetHeight + 8 : 0;
    if (ht > 0) m.style.paddingTop = (ht + 16 + notice) + 'px';
    placeFloaters();
    fitHeader();
    const dock = $('navDock'), bar = $('saveBar');
    const rail = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches;
    const dockH = !dock || rail ? 0 : dock.offsetHeight;
    if (bar) bar.style.bottom = dockH + 'px';
    const barH = bar && !bar.classList.contains('hidden') ? bar.offsetHeight : 0;
    m.style.paddingBottom = (dockH + barH + 24) + 'px';
  }

  /**
   * The update notice sits just under the header and the toast under it (never on top of each other, C-M6). In a
   * phone's landscape (max-height 500 px) the header scrolls away, so both sit at the top edge.
   */
  function placeFloaters() {
    const h = $('appHeader'), t = $('toast'), ub = $('updateBanner');
    if (!h || !t) return;
    const fixedHeader = getComputedStyle(h).position === 'fixed' && h.offsetHeight > 0;
    let top = fixedHeader ? h.offsetHeight + 8 : 12;
    if (ub) {
      ub.style.top = top + 'px';
      if (!ub.classList.contains('hidden')) top += ub.offsetHeight + 8;
    }
    t.style.top = top + 'px';
  }

  function renderRole() {
    const sup = isSup();
    const badge = $('roleBadge');
    // the Supervisor's tag in the tool row of วันนี้ (why the stations show pickers); staff see no tag
    setHtml(badge, sup ? `<span class="${Kit.cls.tagBrand} gap-1">${Kit.icon('crown', 'w-3.5 h-3.5')}Supervisor</span>` : '');
    setVisible(badge, sup);
    setVisible($('stationSaveBtn'), sup);
    setVisible($('stationCountsBtn'), sup);
    setVisible($('auditLogBox'), sup);
    setVisible($('staffControlBox'), sup);
    setVisible($('summaryTargetSelectContainer'), sup);
    // the nav entries (#navStaffBtn, #navSummaryBtn, …) follow the registry: renderTabs → renderNav
    $('currentSupDisplay').textContent = `ผู้ถือสิทธิ์ปัจจุบัน: ${state.supervisor ? 'คุณ ' + state.supervisor : '-'}`;
  }

  /** Current screen (falls back to station when it may not be shown), its hide()/show(), panels and nav entries. */
  function renderTabs() {
    ensureVisibleTab();
    syncShownFeature();
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + ui.tab));
    // a child screen (e.g. รายชื่อบุคลากร under เมนู) keeps its parent's bar entry highlighted
    const owner = barOwner(ui.tab);
    document.querySelectorAll('.nav-btn').forEach(b => {
      const bar = b.dataset.navPlace === 'bar';
      const on = bar ? b.dataset.tab === owner : b.dataset.tab === ui.tab;
      if (bar) {
        b.classList.toggle('text-brand-700', on);     // UiKit.cls.navOn
        b.classList.toggle('text-slate-500', !on);    // UiKit.cls.navOff
      }
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    renderNav();
  }

  /* ---------- chrome (R1a-B2): header, week strip, save bar, เมนู ---------- */
  /** The bar entry that represents `id`: the screen itself, or the nearest ancestor (def.parent) in the bar. */
  function barOwner(id) {
    let f = featById[id];
    for (let i = 0; f && f.place !== 'bar' && i < 8; i++) f = f.parent ? featById[f.parent] : null;
    return f ? f.id : id;
  }

  /** A screen below another one (not in the bar, not วันนี้): the header shows ← instead of the avatar. */
  function isChildScreen(id) {
    const f = featById[id];
    return !!f && f.id !== 'station' && f.place !== 'bar';
  }

  /**
   * The chrome of this version needs its markup: an index.html of another version (e.g. a stale copy next to a new
   * app.js) must not break every render, so a missing piece is skipped.
   */
  function hasMarkup(ids) { return ids.every(id => !!$(id)); }
  const HEADER_IDS = ['headerBackBtn', 'headerAvatarBtn', 'headerAvatar', 'headerDateLine', 'headerTitle', 'headerCaption', 'currentDate'];
  const MENU_IDS = ['menuAvatar', 'menuName', 'menuGroup', 'menuRole', 'menuVersion'];

  function renderChrome() {
    if (hasMarkup(HEADER_IDS)) renderHeader();
    if (hasMarkup(['weekStrip', 'weekDays'])) renderWeekStrip();
    if (hasMarkup(['saveBar'])) renderSaveBar();
    renderBottomNav();
    syncHistory();
  }

  /**
   * R3-SPEC §4.2: a screen with chrome.bottomNav false (the chat room, whose composer sits at the bottom) hides the phone's
   * bottom bar (#navDock below md:; the left rail of wider screens stays) and with it the space kept for it (syncLayout).
   */
  function renderBottomNav() {
    const dock = $('navDock');
    if (!dock) return;
    const f = featById[ui.tab];
    const off = !!f && f.chrome.bottomNav === false;
    if (dock.classList.contains('max-md:hidden') === off) return;
    dock.classList.toggle('max-md:hidden', off);
    if (off) dock.dataset.bottomNav = 'off'; else delete dock.dataset.bottomNav;
    syncLayout();
  }

  /** R3: core.setScreenTitle(text | null) — the header title of the current screen until the screen changes. */
  function setScreenTitle(text) {
    const t = typeof text === 'string' ? text.trim() : '';
    ui.screenTitle = t ? { tab: ui.tab, text: t } : null;
    if (hasMarkup(HEADER_IDS)) renderHeader();
  }

  /**
   * Left: the user's avatar (→ เมนู), or ← on a child screen. Middle: on screens about a date (def.chrome.date) the
   * caption (the wordmark "X-RAY IPD" on วันนี้, else the screen title) above the selected date (tap = native date
   * picker #currentDate); on other screens the screen title (#headerDate stays in the DOM). Right: #syncStatus and
   * #refreshBtn.
   */
  function renderHeader() {
    const f = featById[ui.tab];
    const child = !!state.session && isChildScreen(ui.tab);
    setVisible($('headerBackBtn'), child);
    setVisible($('headerAvatarBtn'), !child);
    const who = myName() || (state.session ? state.session.name : '');
    setHtml($('headerAvatar'), Kit.avatar(who || '?', 'md', { cls: 'ring-2 ring-white' }));
    const dated = !f || f.chrome.date;
    setVisible($('headerDateLine'), dated);
    setVisible($('currentDate'), dated);
    setVisible($('headerTitle'), !dated);
    // the caption is the wordmark "X-RAY IPD" (display font, letter-spaced) except on dated screens other than
    // วันนี้, where it names the screen (Thai text is never letter-spaced)
    const screenCaption = dated && f && f.id !== 'station';
    const custom = ui.screenTitle && ui.screenTitle.tab === ui.tab ? ui.screenTitle.text : '';   // R3: core.setScreenTitle
    $('headerCaption').textContent = screenCaption ? custom || f.title : 'X-RAY IPD';
    $('headerCaption').classList.toggle('tracking-[0.12em]', !screenCaption);
    if (screenCaption) delete $('headerCaption').dataset.wordmark; else $('headerCaption').dataset.wordmark = '1';
    setText($('headerTitle'), custom || (f ? f.title : 'เวร IPD'));
    fitHeader();
  }

  /**
   * The seven days (Sunday–Saturday) of the selected date's week. ‹ › move one day (crossing into the next week
   * shows that week); a tap on a day selects it.
   */
  function renderWeekStrip() {
    const strip = $('weekStrip');
    const f = featById[ui.tab];
    const on = !!state.user && !!f && f.chrome.weekStrip;
    const was = !strip.classList.contains('hidden');
    setVisible(strip, on);
    if (was !== on) syncLayout();
    if (!on) return;
    const sel = state.selectedDate;
    const today = U.todayStr();
    const start = U.addDays(sel, -U.parseYmd(sel).getDay());
    const k = Kit.cls;
    let html = '';
    for (let i = 0; i < 7; i++) {
      const date = U.addDays(start, i);
      const isSel = date === sel;
      const isToday = date === today;
      const weekend = i === 0 || i === 6;
      const cellCls = k.dayCell + ' ' + (isSel ? k.dayCellOn : isToday ? k.dayCellToday : k.dayCellOff);
      const numCls = k.dayNum + (weekend && !isSel ? ' ' + k.dayWeekend : '');
      const label = U.thaiDate(date) + (isToday ? ' (วันนี้)' : '');
      html += `<button type="button" class="${cellCls}" data-date="${date}" aria-pressed="${isSel}" aria-label="${esc(label)}"` +
        `${isToday ? ' aria-current="date" data-today="1"' : ''}>` +
        `<span class="${k.dayLabel}">${U.THAI_WEEKDAYS_SHORT[i]}</span><span class="${numCls}">${Number(date.slice(8, 10))}</span></button>`;
    }
    setHtml($('weekDays'), html);
  }

  function onWeekDayClick(e) {
    const b = e.target && e.target.closest ? e.target.closest('.week-day[data-date]') : null;
    if (b) spawn(() => setSelectedDate(b.dataset.date));
  }

  /** The save bar: Supervisor, on วันนี้, while the selected day's data is loaded (i.e. the day can be edited). */
  function saveBarOn() {
    return isSup() && !ui.pwForced && ui.tab === 'station' && dayView(state.selectedDate) === 'ready';
  }

  function renderSaveBar() {
    const bar = $('saveBar');
    const on = saveBarOn();
    const was = !bar.classList.contains('hidden');
    setVisible(bar, on);
    if (!on && isShown('dayToolsModal')) hideModal('dayToolsModal');
    renderSaveLook();
    if (was !== on) syncLayout();
  }

  /** Replaces the tokens of `from` that `to` does not have by the tokens of `to` (recipe swap, shared tokens stay). */
  function swapCls(el, from, to) {
    const keep = new Set(to.split(/\s+/).filter(Boolean));
    from.split(/\s+/).filter(t => t && !keep.has(t)).forEach(t => el.classList.remove(t));
    keep.forEach(t => el.classList.add(t));
  }

  /**
   * C-M4: with nothing unsaved the save bar is compact (≈52 px: ⋯ and a secondary "บันทึก", no pill); while the draft is
   * dirty it is the full bar with the primary button and the "ยังไม่ได้บันทึก" pill.
   */
  function renderSaveLook() {
    const btn = $('stationSaveBtn'), inner = $('saveBarInner');
    if (!btn || !inner) return;
    const dirty = unsavedOn(state.selectedDate);   // R2: an active proposal is unsaved too
    const look = dirty ? 'dirty' : 'clean';
    if (btn.dataset.look === look) return;
    btn.dataset.look = look;
    swapCls(btn, dirty ? Kit.cls.saveBtnClean : Kit.cls.saveBtnDirty, dirty ? Kit.cls.saveBtnDirty : Kit.cls.saveBtnClean);
    swapCls(inner, dirty ? 'py-1' : 'py-2.5', dirty ? 'py-2.5' : 'py-1');
  }

  function openDayTools() {
    if (!isSup()) { toast(MSG.supOnly); return; }
    renderDayControls();
    showModal('dayToolsModal');
  }

  /**
   * The day tools name the selected day — "วันนี้" only when it is today (C-M2); "วางข้อมูล" is disabled (aria) with
   * its reason while nothing is copied (Minor 12; the button stays clickable: its handler explains).
   */
  function renderDayTools() {
    if (!$('dayToolsTitle')) return;
    const date = state.selectedDate;
    const today = date === U.todayStr();
    const rel = relativeDay(date);
    setText($('dayToolsTitle'), today ? 'เครื่องมือของวันนี้' : 'เครื่องมือของวันที่ ' + U.thaiDateShort(date));
    setText($('dayToolsDate'), U.thaiDate(date) + (rel ? ' · ' + rel : ''));
    setText($('copyDayLabel'), withDay('คัดลอกข้อมูล', date, '', { year: false }));
    setText($('pasteDayLabel'), withDay('วางข้อมูลลง', date, '', { year: false }));
    setText($('clearDayLabel'), withDay('ล้างข้อมูลทั้งหมดของ', date, '', { year: false }));
    const paste = $('pasteDayBtn');
    const noClip = !state.clipboard;
    if (paste) {
      if (noClip) paste.setAttribute('aria-disabled', 'true'); else paste.removeAttribute('aria-disabled');
      setVisible($('pasteDayHint'), noClip);
    }
    const tools = $('dayToolsBtn');
    if (tools) {
      const label = withDay('เครื่องมือของ', date, ' (คัดลอก วาง แชร์ภาพ ล้างข้อมูล)', { year: false });
      if (tools.getAttribute('aria-label') !== label) tools.setAttribute('aria-label', label);
    }
  }

  /** เมนู: profile card, the sections' visibility (from the nav entries they hold) and the version row. */
  function renderMenu() {
    if (!hasMarkup(MENU_IDS)) return;
    const name = myName() || (state.session ? state.session.name : '');
    setHtml($('menuAvatar'), name ? Kit.avatar(name, 'lg') : '');
    $('menuName').textContent = name || '-';
    const me = state.staff.find(s => s.name === name);
    const group = (state.user && state.user.group) || (me && me.group) || '';
    $('menuGroup').textContent = group ? groupLabel(group) : (name ? 'ผู้ใช้งาน' : '-');
    setHtml($('menuRole'), !name ? '' : isSup() ? Kit.pill('Supervisor', 'pending', 'crown') : Kit.pill('เจ้าหน้าที่', 'neutral', 'user'));
    setHtml($('menuVersion'), `<span class="block">แอป ${esc(Api.clientVersion)}</span>` +
      `<span class="block whitespace-nowrap">เซิร์ฟเวอร์ ${esc(serverVersionLabel())}</span>`);
    renderMenuProfile(!!name);
    renderMenuSections();
  }

  /**
   * R1b: the profile card opens the "profile" screen while that feature is registered and visible (a v3 server; a
   * chevron shows it); otherwise (an older server) the card is plain. "เปลี่ยนรหัสผ่าน" stays in the card either way. The
   * Supervisor of an older server gets one line (#menuServerNote) saying Code.gs must be updated.
   */
  function renderMenuProfile(named) {
    const head = $('menuProfileHead');
    const profile = featById.profile;
    const open = named && !!profile && featureVisible(profile);
    if (head) {
      head.classList.toggle('cursor-pointer', open);
      head.classList.toggle('active:bg-brand-50', open);
      if (open) {
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.setAttribute('aria-label', 'โปรไฟล์ของฉัน — ' + (myName() || (state.session ? state.session.name : '')));
      } else {
        ['role', 'tabindex', 'aria-label'].forEach(a => head.removeAttribute(a));
      }
      head.dataset.profile = open ? '1' : '';
    }
    setVisible($('menuProfileChevron'), open);
    // "เปลี่ยนรหัสผ่าน" stays in เมนู either way (the profile screen may offer it too, via core.openPasswordChange)
    const note = $('menuServerNote');
    if (note) {
      const sup = !!state.user && isSup();
      // R2-SPEC §3.3 / R3-SPEC §4.2: a 3.0 server (features without 'plan') and a 3.1 server ('plan' but no 'chat') get their own
      // line: the screens of the newer features stay hidden until Code.gs 3.2
      const v3 = ui.serverMode === 'v3';
      const msg = !sup ? '' : ui.serverMode === 'old' ? MSG.serverV3 : v3 && !serverHas('plan') ? MSG.serverV31 : v3 && !serverHas('chat') ? MSG.serverV32 : '';
      setHtml(note, msg ? `${Kit.icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5 text-amber-700')}<span class="min-w-0">${esc(msg)}</span>` : '');
      note.dataset.server = msg === MSG.serverV31 ? '3.0' : msg === MSG.serverV32 ? '3.1' : msg ? 'old' : '';
      setVisible(note, !!msg);
    }
  }

  function onMenuProfileOpen(e) {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const head = $('menuProfileHead');
    if (!head || head.dataset.profile !== '1') return;
    if (e.type === 'keydown') e.preventDefault();
    spawn(() => go('profile'));
  }

  /**
   * The exact server version comes with a ping (connection check, setup) or any answer that carries `version`; no extra
   * request is sent for it. FIX-CL CL-25: until then the heartbeat already tells the generation — a server that announces
   * `features` is 3.x, one that answers without them is older than 3.0 — so the row never says "not checked" while the app
   * is online with v3 data.
   */
  function serverVersionLabel() {
    if (ui.serverVersion) return ui.serverVersion;
    if (ui.serverMode === 'v3') return '3.x';
    if (ui.serverMode === 'old') return Api.serverVersionOk === false ? 'เก่ากว่า 2.1.0' : 'เก่ากว่า 3.0';
    return Api.serverVersionOk === false ? 'เก่ากว่า 2.1.0' : '— ยังไม่ได้ตรวจ';   // Minor 13: not a bare dash
  }

  function renderMenuSections() {
    document.querySelectorAll('#menuNav [data-menu-section]').forEach(sec => {
      const list = sec.querySelector('[data-menu-list]');
      const any = !!list && Array.prototype.some.call(list.children,
        c => !c.hidden && !c.classList.contains('hidden') && c.style.display !== 'none');
      sec.hidden = !any;   // the attribute (space-y-* ignores [hidden] siblings)
    });
  }

  /* ---------- station tab ---------- */
  function renderStationTab() {
    const container = $('stationsContainer');
    const date = state.selectedDate;
    const view = dayView(date);
    if (!state.user) setHtml(container, '');
    else if (view === 'loading') setHtml(container, LOADING_HTML);
    else if (view === 'missing') setHtml(container, missingHtml(date));
    else {
      if (ui.reorder && (ui.reorder.date !== date || !isSup())) ui.reorder = null;   // R3 F-2: the mode belongs to one date
      const card = { sup: isSup(), locked: !canEditDay(date), onLeave: absentLeaves(date), rows: activeLeaves(date),
        act: activeSet(), me: myName(), planned: isPlannedDay(date), pairs: isSup() ? avoidPairsNow() : [], proposal: proposalActive(date),
        problem: problemCardInfo(), date };
      const slots = viewSlots(date);
      card.training = trainingLinesNow(date, slots);   // R5: a trainee already placed in a station's slots is not repeated there
      setHtml(container, U.STATIONS.map(st => stationCardHtml(st, slots, card)).join(''));
    }
    renderMyDay();
    renderStationNote();
    renderStationPanels();
    renderStationLeaves();
    renderRemark();
    renderDraftBadge();
    renderAudit();
    renderDayControls();
  }

  /** A day with a saved plan (at least one saved name). Shortages of an unplanned day are not an alarm (Minor 7). */
  function isPlannedDay(date) {
    const d = state.days[date];
    return !!d && U.STATIONS.some(st => (d.assignments[st.id] || []).some(Boolean));
  }

  /** One calm line over the stations of an unplanned day — unless "ของฉันวันนี้" already says exactly that. */
  function renderStationNote() {
    const el = $('stationNote');
    if (!el) return;
    const date = state.selectedDate;
    const myDay = $('myDayCard');
    const proposed = proposalActive(date);   // R2 FIX I-6: the slots already hold the proposal — say so, not "choose people"
    const on = !!state.user && dayKnown(date) && !isPlannedDay(date) && (proposed || !(myDay && myDay.dataset.myDay === 'unplanned'));
    setVisible(el, on);
    el.dataset.proposal = proposed ? '1' : '';
    setHtml(el, !on ? '' : proposed
      ? `${Kit.icon('wand', 'w-5 h-5 shrink-0 mt-0.5 text-amber-700')}<span class="min-w-0">ระบบเสนอคนไว้แล้ว (ยังไม่ได้บันทึก) — ตรวจแล้วกดบันทึก</span>`
      : `${Kit.icon('clock', 'w-5 h-5 shrink-0 mt-0.5 text-amber-700')}<span class="min-w-0">${esc(withDay('ยังไม่ได้จัดเวรของ', date))}` +
        ` — ${isSup() ? 'เลือกคนในแต่ละ Station แล้วกดบันทึก' : 'Supervisor ยังไม่ได้บันทึกตาราง'}</span>`);
  }

  /** The station's tinted title chip (colours of Utils.STATIONS; the h3's first child is the name text node). */
  function stationChipHtml(st, tag) {
    const t = tag || 'span';
    return `<${t} class="${Kit.cls.stationChip}" style="background:${st.bg};color:${st.text}">${esc(st.name).replace('/', '/<wbr>')}</${t}>`;
  }

  /**
   * One station: a white card with the station's colour as a left edge and a tinted title chip, the line
   * "ต้องการ N คน" + "(ขาด N)" (or "ครบ"), then the people (chips) or, for the Supervisor, one native picker per slot.
   * card: {sup, locked (pickers disabled), onLeave (ABSENT people: never offered), rows (every leave row: a doctor visit
   * or a pending request is shown as a tag but never blocks), act (active names), me}.
   */
  function stationCardHtml(st, slots, card) {
    const { sup, locked, onLeave, rows, act, me, planned, pairs, proposal, problem, date, training } = card;
    const soft = n => {   // a non-blocking leave of n: {text (option / tag), tone 'partial'|'pending'} or null
      const info = rows && rows[n] ? U.leaveInfo(rows[n]) : null;
      if (!info || info.blocking) return null;
      if (info.partial) return { text: info.timeText ? 'หาหมอ ' + info.timeText : info.label, long: info.type + (info.timeText ? ' ' + info.timeText : ''), tone: 'partial' };
      if (info.pending) return { text: 'รออนุมัติ', long: 'ขอ' + info.type + ' · รออนุมัติ', tone: 'pending' };
      return null;
    };
    const k = Kit.cls;
    const list = slots[st.id] || [];
    const filled = list.filter(Boolean);
    const need = required(st.id);
    const short = need - filled.length;
    // R3 FIX-CL L-1: "ปัญหาค้าง N" (the already-loaded problem domain, no request) beside the title chip — tap → แจ้งปัญหา
    // of this station; the "แจ้งปัญหา" chip itself sits at the card's bottom-right, below the slots (never by the pills)
    const open = problem && problem.open ? problem.open[st.id] || 0 : 0;
    const openPill = open > 0
      ? `<button type="button" class="${PROBLEM_OPEN_BTN}" data-problem-open="${st.id}" aria-label="${esc('ปัญหาค้าง ' + open + ' เรื่อง — ' + st.name)}">` +
        `<span class="${k.pill} ${k.pillPending}">ปัญหาค้าง ${open}</span></button>`
      : '';
    const head =
      `<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">` +
        `<h3 class="${k.stationChip}" style="background:${st.bg};color:${st.text}">${esc(st.name)}</h3>` +
        openPill +
        `<span class="ml-auto inline-flex items-center gap-1.5">` +
          `<span class="station-need ${k.stationNeed}">ต้องการ ${need} คน</span>` +
          (short > 0   // coral only for a SAVED day that is short; a day nobody planned yet is neutral (Minor 7)
            ? `<span class="station-short ${k.pill} ${planned ? k.pillDanger : k.pillNeutral}">(ขาด ${short})</span>`
            : `<span class="${k.pill} ${k.pillOk}">${Kit.icon('check', 'w-3.5 h-3.5')}ครบ</span>`) +
        `</span>` +
      `</div>`;
    // R3 F-2: "จัดลำดับ" (Supervisor, ≥ 2 people, editable day) switches this card into the reorder mode; "เสร็จ" back
    const reorderOn = !!(sup && ui.reorder && ui.reorder.date === date && ui.reorder.station === st.id && filled.length >= 2);
    const sortBtn = !sup || filled.length < 2 || (locked && !reorderOn) ? ''
      : reorderOn
        ? `<button type="button" class="${REORDER_DONE_BTN}" data-reorder-done="${st.id}" aria-label="${esc('เสร็จ — จัดลำดับ ' + st.name)}">เสร็จ</button>`
        : `<button type="button" class="${REORDER_BTN}" data-reorder-start="${st.id}" aria-label="${esc('จัดลำดับ ' + st.name)}">` +
          `${Kit.icon('sort', 'w-4 h-4 shrink-0')}จัดลำดับ</button>`;
    const problemBtn = problem
      ? `<button type="button" class="${PROBLEM_BTN}" data-problem-station="${st.id}" aria-label="${esc('แจ้งปัญหา ' + st.name)}">` +
        `${Kit.icon('inbox', 'w-4 h-4 shrink-0')}แจ้งปัญหา</button>`
      : '';
    const foot = problemBtn || sortBtn
      ? `<div class="flex flex-wrap items-center justify-end gap-2 mt-1.5 -mb-1 -mx-1.5" data-station-foot>${sortBtn ? `<span class="mr-auto">${sortBtn}</span>` : ''}${problemBtn}</div>`
      : '';
    let body;
    if (reorderOn) {
      body = reorderBodyHtml(st, filled, date, locked, act);
    } else if (sup) {
      const pos = new Map();   // name → "stationId:index" of the slot holding it
      U.STATIONS.forEach(s => (slots[s.id] || []).forEach((n, i) => { if (n) pos.set(n, s.id + ':' + i); }));
      body = '<div class="mt-2.5 space-y-2">' + list.map((cur, i) => {
        const here = st.id + ':' + i;
        // a person deleted since stays in their saved slot (history) but is never offered anywhere else
        const gone = cur && !act.has(cur) ? `<option value="${esc(cur)}" selected>${esc(cur + GONE_LABEL)}</option>` : '';
        const opts = state.staff
          .filter(s => s.name === cur || (!onLeave[s.name] && (!pos.has(s.name) || pos.get(s.name) === here)))
          .map(s => {
            const sf = !onLeave[s.name] && soft(s.name);
            // the picked person's doctor visit / request is the line under the picker (the closed picker would cut it off)
            const tag = onLeave[s.name] ? ' (ลา: ' + esc(onLeave[s.name].type) + ')' : sf && s.name !== cur ? ' (' + esc(sf.tone === 'pending' ? sf.long : sf.text) + ')' : '';
            return `<option value="${esc(s.name)}"${s.name === cur ? ' selected' : ''}>${esc(s.name)}${tag}</option>`;
          })
          .join('');
        const lead = cur ? Kit.avatar(cur, 'sm') : `<span class="${k.slotEmpty}" aria-hidden="true">${i + 1}</span>`;
        const curSoft = cur && !onLeave[cur] ? soft(cur) : null;
        const warn = cur && onLeave[cur]
          ? `<p class="flex items-center gap-1.5 pl-[42px] text-xs font-medium leading-4 text-coral-700">${Kit.icon('alert-triangle', 'w-3.5 h-3.5')}ลา: ${esc(onLeave[cur].type)} — แต่ยังอยู่ใน Station นี้</p>`
          : curSoft   // R1b: a doctor visit / a pending request is only a note — the person stays assignable
            ? `<p class="${k.slotNote} ${curSoft.tone === 'partial' ? k.slotNotePartial : k.slotNotePending}" data-slot-note="${curSoft.tone}">` +
              `${Kit.icon(curSoft.tone === 'partial' ? 'stethoscope' : 'clock', 'w-3.5 h-3.5')}${esc(curSoft.long)}</p>`
            : '';
        return `<div class="${k.slotRow}">${lead}` +
          `<select class="station-select ${proposal && cur ? PROPOSED_SELECT : k.select}"${proposal && cur ? ' data-proposed="1"' : ''} data-station="${st.id}" data-index="${i}" aria-label="${esc(st.name)} คนที่ ${i + 1}${proposal && cur ? ' (ข้อเสนอ ยังไม่ได้บันทึก)' : ''}"${locked ? ' disabled' : ''}>` +
          `<option value=""${cur ? '' : ' selected'}>-- เลือกคนที่ ${i + 1} --</option>${gone}${opts}</select></div>${warn}`;
      }).join('') + '</div>' + avoidPairLines(filled, pairs);
    } else {
      body = `<div class="station-names mt-2.5 flex flex-wrap gap-2" data-station="${st.id}">` +
        (filled.length
          ? filled.map(n => {
            const look = onLeave[n] ? k.personChipLeave : n === me ? k.personChipMe : k.personChip;
            const sf = onLeave[n] ? null : soft(n);
            const tip = onLeave[n] ? ` title="${esc('ลา: ' + onLeave[n].type)}"` : sf ? ` title="${esc(sf.long)}"` : '';
            return `<span class="station-name ${look}"${tip}>${Kit.avatar(n, 'xs')}<span class="min-w-0 break-words">${esc(nameLabel(n, act))}</span>` +
              (onLeave[n] ? Kit.icon('calendar-off', 'w-4 h-4 shrink-0') : '') +
              (sf ? `<span class="${k.inlineTag} ${sf.tone === 'partial' ? k.inlineTagPartial : k.inlineTagPending}" data-leave-tag="${sf.tone}">${esc(sf.text)}</span>` : '') +
              '</span>';
          }).join('')
          : `<span class="${k.personEmpty}">ยังไม่ได้จัดสรร</span>`) +
        '</div>';
    }
    // R5-SPEC §3.4: the trainees training here today (never students): one muted line — not a slot, never counted or saved
    const trainees = training && Array.isArray(training[st.id]) && training[st.id].length
      ? `<p class="mt-2 text-xs font-medium leading-5 text-slate-500 break-words" data-training-line="${st.id}">ฝึกงาน: ${training[st.id].map(esc).join(', ')}</p>`
      : '';
    return `<div class="station-card ${k.stationCard}" data-station-card="${st.id}">` +
      `<span class="${k.stationEdge}" style="background:${st.border}" aria-hidden="true"></span>${head}${body}${trainees}${foot}</div>`;
  }

  /**
   * R3 F-2: the reorder mode of one station card — one row per assigned person (avatar, name; on Portable the line this order
   * gives them, "สาย N") with 44 px move buttons ขึ้น / ลง (disabled at the ends and while the day is locked). Empty slots
   * are not listed: they stay after the people.
   */
  function reorderBodyHtml(st, people, date, locked, act) {
    const k = Kit.cls;
    const lines = st.id === 'portable' ? portableLinesOf(date, people) : null;
    const move = (dir, n, off) => `<button type="button" class="${k.iconBtnRound}" data-reorder-move="${dir}" data-reorder-station="${st.id}" data-name="${esc(n)}"` +
      ` aria-label="${esc('ย้าย ' + n + (dir === 'up' ? ' ขึ้น' : ' ลง'))}"${off ? ' disabled' : ''}>${Kit.icon(dir === 'up' ? 'chevron-up' : 'chevron-down', 'w-5 h-5')}</button>`;
    return `<ol class="mt-2.5 space-y-2" data-reorder="${st.id}">` + people.map((n, i) => {
      const line = lines ? lines.get(n) : 0;
      return `<li class="${k.slotRow}" data-reorder-row="${esc(n)}">${Kit.avatar(n, 'sm')}` +
        `<span class="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1"><span class="min-w-0 font-medium text-ink-900 break-words">${esc(nameLabel(n, act))}</span>` +
        (line ? `<span class="${k.pill} ${k.pillNeutral}" data-reorder-line="${line}">สาย ${line}</span>` : '') + `</span>` +
        `<span class="shrink-0 inline-flex items-center gap-1.5">${move('up', n, locked || i === 0)}${move('down', n, locked || i === people.length - 1)}</span></li>`;
    }).join('') + '</ol>';
  }
  /**
   * R3 F-2: Portable people in this order → the line each one works (name → line number; not listed = no line): planned line
   * techs keep their lines whatever the order, substitutes take the vacant lines in order (PlanEngine.resolveLines on
   * use('plan').linesFor(date) — the stored duty's lines, else the month's plan). null without plan data.
   */
  function portableLinesOf(date, people) {
    const plan = serverHas('plan') ? use('plan') : null;
    const PE = window.PlanEngine;
    if (!plan || typeof plan.linesFor !== 'function' || !PE || typeof PE.resolveLines !== 'function') return null;
    let lines = null;
    try { lines = plan.linesFor(date); } catch (e) { console.error('[core] linesFor failed:', e); return null; }
    const sorted = (Array.isArray(lines) ? lines : []).filter(l => l && Number.isInteger(l.line) && l.line >= 1).slice().sort((a, b) => a.line - b.line);
    if (!sorted.length) return null;
    const workers = PE.resolveLines(sorted, people).workers;
    const out = new Map();
    workers.forEach((n, i) => { if (n) out.set(n, sorted[i].line); });
    return out;
  }
  /** R3 F-2: "จัดลำดับ" — a ghost chip like "แจ้งปัญหา"; "เสร็จ" — the tonal button of the same height. */
  const REORDER_BTN = Kit.cls.btn + ' ' + Kit.cls.btnGhost + ' ' + Kit.cls.btnCompact + ' gap-1.5 px-3';
  const REORDER_DONE_BTN = Kit.cls.btn + ' ' + Kit.cls.btnTonal + ' ' + Kit.cls.btnCompact;

  /** R3 FIX-CL L-1: a labelled ghost chip (ink text, a small inbox icon, 44 px tall) at the card's bottom-right. */
  const PROBLEM_BTN = Kit.cls.btn + ' ' + Kit.cls.btnGhost + ' ' + Kit.cls.btnCompact + ' gap-1.5 px-3';
  /** The "ปัญหาค้าง N" pill as a 44 px target; -my-1.5 keeps the card head as tall as the station chip. */
  const PROBLEM_OPEN_BTN = 'inline-flex items-center h-11 -my-1.5 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
  /** R3-SPEC §4.2: the station cards carry the "แจ้งปัญหา" button while the server has 'problem' and a feature provides
   *  'problems.report' (js/feat-problems.js). */
  function problemButtonOn() { return serverHas('problem') && typeof use('problems.report') === 'function'; }
  /** The station cards' problem payload: false (no button), else {open: {stationId: n}} from the already-loaded domain. */
  function problemCardInfo() {
    if (!problemButtonOn()) return false;
    const svc = use('problems');
    let open = {};
    try { open = svc && typeof svc.openSummary === 'function' ? (svc.openSummary() || {}).byStation || {} : {}; } catch (e) { open = {}; }
    return { open };
  }

  /**
   * R3 F-2: "จัดลำดับ" / "เสร็จ" / ขึ้น / ลง. A move edits the draft exactly like a picker change (ensureDraft; the people of
   * the station in the new order, empty slots after them; the sticky save bar shows it as unsaved; nothing is sent until
   * บันทึก). Focus stays on the same control (or its partner once it is disabled at an end).
   */
  function onReorderClick(btn) {
    if (!state.user || !isSup() || btn.disabled) return;
    const date = state.selectedDate;
    const container = $('stationsContainer');
    let focus = [];
    if (btn.hasAttribute('data-reorder-start')) {
      const sid = btn.getAttribute('data-reorder-start');
      if (!U.stationById(sid) || !canEditDay(date)) return;
      ui.reorder = { date, station: sid };
      focus = ['[data-reorder-done="' + sid + '"]'];
    } else if (btn.hasAttribute('data-reorder-done')) {
      const sid = btn.getAttribute('data-reorder-done');
      ui.reorder = null;
      focus = ['[data-reorder-start="' + sid + '"]'];
    } else {
      const sid = btn.getAttribute('data-reorder-station') || '';
      const name = btn.getAttribute('data-name') || '';
      const dir = btn.getAttribute('data-reorder-move') === 'up' ? 'up' : 'down';
      if (!moveInStation(date, sid, name, dir === 'up' ? -1 : 1)) return;
      const sel = d => '[data-reorder-move="' + d + '"][data-reorder-station="' + sid + '"][data-name="' + cssAttr(name) + '"]';
      focus = [sel(dir), sel(dir === 'up' ? 'down' : 'up')];
    }
    container._html = null;
    renderStationTab();
    renderPreview();
    for (let i = 0; i < focus.length; i++) {
      const el = container.querySelector(focus[i]);
      if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } break; }
    }
  }
  /** A value quoted for a [attr="…"] selector. */
  function cssAttr(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  /** R3 F-2: moves `name` one place up (-1) / down (+1) among the people of station `sid` in the draft. → bool (moved) */
  function moveInStation(date, sid, name, step) {
    const st = U.stationById(sid);
    if (!st || !name || !canEditDay(date)) return false;
    const shown = viewSlots(date)[st.id].filter(Boolean);
    const i = shown.indexOf(name);
    if (i < 0 || i + step < 0 || i + step >= shown.length) return false;
    const draft = ensureDraft(date);
    draft.assignments = viewSlots(date);   // the slots as shown (fitted to the current counts), like a picker change
    const slots = draft.assignments[st.id];
    const order = slots.filter(Boolean);
    const a = order.indexOf(name), b = a + step;
    if (a < 0 || b < 0 || b >= order.length) return false;
    order[a] = order[b];
    order[b] = name;
    draft.assignments[st.id] = order.concat(slots.map(() => '')).slice(0, Math.max(slots.length, order.length));
    dropCleanDraft();
    return true;
  }

  /** A tap on a station card's "แจ้งปัญหา" button → use('problems.report')(stationId) (needs a network, like every write). */
  function onStationClick(e) {
    const ro = e.target && e.target.closest ? e.target.closest('[data-reorder-start], [data-reorder-done], [data-reorder-move]') : null;
    if (ro) { onReorderClick(ro); return; }
    const pill = e.target && e.target.closest ? e.target.closest('[data-problem-open]') : null;
    if (pill && state.user) {
      const sid = pill.getAttribute('data-problem-open');
      if (U.STATIONS.some(st => st.id === sid) && problemButtonOn()) spawn(() => go('problems', { station: sid, status: 'open' }));
      return;
    }
    const btn = e.target && e.target.closest ? e.target.closest('[data-problem-station]') : null;
    if (!btn || !state.user) return;
    const id = btn.getAttribute('data-problem-station');
    const report = problemButtonOn() ? use('problems.report') : null;
    if (!report || !U.STATIONS.some(st => st.id === id) || !requireInternet()) return;
    spawn(() => report(id));
  }

  /**
   * R2-SPEC §0.27 "ห้ามอยู่คู่กัน" (Supervisor only): the pairs of js/plan-data.js (getPlan gives them to the Supervisor only)
   * while the server has the plan feature; [] otherwise or when the provider fails.
   */
  function avoidPairsNow() {
    if (!serverHas('plan')) return [];
    const plan = use('plan');
    if (!plan || typeof plan.avoidPairs !== 'function') return [];
    try { const list = plan.avoidPairs(); return Array.isArray(list) ? list : []; } catch (e) { console.error('[core] avoidPairs failed:', e); return []; }
  }
  /**
   * R5-SPEC §3.4: {[stationId]: [names]} of the trainees at each station on `date` — use('training.station')(date, slots)
   * (js/feat-training.js: working days only, trainees only, without a trainee whose own staff account already sits in that
   * station's slots — the slots as this card shows them) while the server has 'training'; {} otherwise or when it fails.
   */
  function trainingLinesNow(date, slots) {
    if (!serverHas('training')) return {};
    const fn = use('training.station');
    if (typeof fn !== 'function') return {};
    try { const m = fn(date, slots || {}); return m && typeof m === 'object' ? m : {}; } catch (e) { console.error('[core] training.station failed:', e); return {}; }
  }
  /** A coral warning line per pair that sits in this station (draft, proposal or saved day) — a warning, never a block. */
  function avoidPairLines(names, pairs) {
    if (!pairs || !pairs.length || names.length < 2) return '';
    return pairs.filter(p => Array.isArray(p) && names.indexOf(p[0]) >= 0 && names.indexOf(p[1]) >= 0).map(p =>
      `<p class="flex items-center gap-1.5 mt-2 text-xs font-medium leading-4 text-coral-700" data-avoid-pair="1">${Kit.icon('alert-triangle', 'w-3.5 h-3.5 shrink-0')}` +
      `<span class="min-w-0 break-words">ห้ามอยู่คู่กัน: ${esc(p[0])} · ${esc(p[1])}</span></p>`).join('');
  }

  /** R2 FIX I-6: a picker holding a proposed (unsaved) name — the select recipe with the draft tint of ตารางเวร. */
  const PROPOSED_SELECT = Kit.cls.select.replace('border-ink-200', 'border-sun-300').replace('bg-white', 'bg-sun-50');

  /** "25 พ.ย." — day + month (no year), for card titles. */
  function shortDateText(date) {
    return U.thaiDateShort(date, { year: false });
  }

  /**
   * "ของฉันวันนี้" — the answer first: my station(s) or my leave on the selected date, derived from what is loaded
   * (no request). States (data-my-day): loading · missing (not on this device) · unplanned (nothing saved for the
   * day yet) · free (the day is planned, I am not in it) · assigned · leave · leave-assigned (on leave but still in a
   * station). The Supervisor sees the stations as edited (the unsaved draft, marked as such).
   */
  function renderMyDay() {
    const box = $('myDayCard');
    if (!box) return;
    const me = myName();
    const on = !!state.user && !!me;
    setVisible(box, on);
    if (!on) { setHtml(box, ''); return; }
    const k = Kit.cls;
    const date = state.selectedDate;
    const view = dayView(date);
    const title = date === U.todayStr() ? 'ของฉันวันนี้' : 'ของฉัน · ' + shortDateText(date);
    const head = `<div class="flex items-center gap-3 min-w-0 pr-6">${Kit.avatar(me, 'md')}` +
      `<div class="min-w-0 flex-1"><h2 class="${k.titleCard}">${esc(title)}</h2><p class="${k.textMeta} break-words">${esc(me)}</p></div></div>` +
      `<span class="absolute top-3 right-3" aria-hidden="true">${Kit.deco('sparkle', 'w-4 h-4 ' + k.decoStar)}</span>`;
    const line = (iconName, tone, main, sub) =>
      `<div class="flex items-start gap-3"><span class="${k.listIcon} ${tone}">${Kit.icon(iconName, 'w-5 h-5')}</span>` +
      `<div class="min-w-0 flex-1 pt-1.5"><p class="text-sm font-medium leading-6 text-ink-900">${main}</p>` +
      (sub ? `<p class="${k.textMeta} mt-0.5">${sub}</p>` : '') + '</div></div>';
    let state1, body, myLeave = '';
    if (view === 'loading') {
      state1 = 'loading';
      body = Kit.skeleton(2);
    } else if (view === 'missing') {
      state1 = 'missing';
      body = line('cloud-off', k.listIconNeutral, esc(withDay('ยังไม่มีข้อมูลของ', date, 'ในเครื่อง')), 'แตะปุ่มรีเฟรชด้านบนเพื่อโหลดอีกครั้ง');
    } else {
      const slots = viewSlots(date);
      const mine = U.STATIONS.filter(st => (slots[st.id] || []).indexOf(me) >= 0);
      const planned = U.STATIONS.some(st => (slots[st.id] || []).some(Boolean));
      const row = activeLeaves(date)[me];
      const info = U.leaveInfo(row);
      const leave = info.blocking ? row : null;   // only an approved full-day leave makes me absent (Utils.isAbsent)
      const draft = unsavedOn(date);   // R2: an active proposal reads like a draft ("ยังไม่ได้บันทึก")
      const chips = mine.map(st => stationChipHtml(st)).join('');
      const mates = mine.length ? U.STATIONS.filter(st => mine.indexOf(st) >= 0)
        .reduce((all, st) => all.concat(slots[st.id].filter(n => n && n !== me)), []) : [];
      const draftTag = draft ? ` <span class="${k.pill} ${k.pillPending}">ยังไม่ได้บันทึก</span>` : '';   // one wording (Minor 6)
      if (leave) {
        const ranked = leaveList(date).filter(l => l.name === me)[0];
        const label = leave.type + (ranked && ranked.rank ? ` (คนที่ ${ranked.rank})` : '');
        state1 = mine.length ? 'leave-assigned' : 'leave';
        body = line('calendar-off', k.listIconDanger, `ลา: <span class="text-coral-700">${esc(label)}</span>`,
          leave.recordedBy ? 'บันทึกโดย ' + esc(leave.recordedBy) : '');
        if (mine.length) {
          body += `<div class="${k.banner} ${k.bannerWarn} mt-3">${Kit.icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}` +
            `<div class="min-w-0 flex flex-wrap items-center gap-1.5">ยังมีชื่ออยู่ที่ ${chips}${draftTag}` +
            `<span class="w-full">${isSup() ? 'นำชื่อออกจาก Station ก่อนบันทึก' : 'แจ้ง Supervisor ให้แก้ไข'}</span></div></div>`;
        }
      } else if (mine.length) {
        state1 = 'assigned';
        body = `<div class="flex items-start gap-3"><span class="${k.listIcon} ${k.listIconBrand}">${Kit.icon('calendar-check', 'w-5 h-5')}</span>` +
          `<div class="min-w-0 flex-1"><p class="${k.textMeta}">คุณอยู่ที่</p>` +
          `<div class="mt-1 flex flex-wrap items-center gap-2">${chips}${draftTag}</div>` +
          (mates.length ? `<p class="${k.textMeta} mt-2 break-words">ร่วมกับ ${mates.map(esc).join(' · ')}</p>` : '') +
          '</div></div>';
      } else if (planned) {
        state1 = 'free';
        body = line('user', k.listIconNeutral, esc(withDay('', date, ' ยังไม่มีชื่อคุณใน Station', { year: false })),
          draft ? 'ตามที่แก้ไขไว้ (ยังไม่ได้บันทึก)' : 'ดูทั้งหมดได้ในรายการ Station');
      } else {
        state1 = 'unplanned';
        body = line('clock', k.listIconSun, esc(withDay('ยังไม่ได้จัดเวรของ', date)),
          isSup() ? 'เลือกคนในแต่ละ Station แล้วกดบันทึก' : esc(withDay('Supervisor ยังไม่ได้บันทึกตารางของ', date, '', { year: false })));
      }
      // R1b: a doctor visit or a pending request does not change where I work — it is one more line under the answer
      if (info.partial) {
        myLeave = 'partial';
        body += `<div class="mt-3">` + line('stethoscope', k.listIconInfo,
          `${esc(info.type)} <span class="whitespace-nowrap text-accent-800">${esc(info.timeText)}</span>`,
          esc(MSG.partialNote)) + '</div>';
      } else if (info.pending) {
        myLeave = 'pending';
        const ranked = leaveLines(date).pending.filter(l => l.name === me)[0];
        body += `<div class="mt-3">` + line('clock', k.listIconSun,
          `ขอ${esc(info.type)}${ranked && ranked.rank ? ` (คนที่ ${ranked.rank})` : ''} · <span class="text-amber-800">รออนุมัติ</span>`,
          esc(MSG.pendingNote)) + '</div>';
      } else if (leave) myLeave = 'leave';
      // R2: my Portable line / lunch duty / special mission of the day (feat-roster's 'plan.myDay'; stored duties only)
      const planLines = myPlanLines(date, me);
      if (planLines.length) {
        body += `<div class="mt-3 space-y-3" data-my-plan="${planLines.length}">` +
          planLines.map(l => line(l.icon, PLAN_TONE[l.tone] || k.listIconBrand, esc(l.main), l.sub ? esc(l.sub) : '') + telLinkHtml(l.tel)).join('') + '</div>';
      }
      if (view === 'cached') body += `<p class="${k.textCaption} mt-2">ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)</p>`;
      box.dataset.myStations = mine.map(st => st.id).join(',');
    }
    if (view === 'loading' || view === 'missing') box.dataset.myStations = '';
    box.dataset.myDay = state1;
    box.dataset.myLeave = myLeave;   // R1b: '' | 'leave' (absent) | 'partial' | 'pending'
    setHtml(box, head + `<div class="mt-3 pt-3 border-t-2 border-brand-50">${body}</div>`);
  }

  /** R2: tones of the "ของฉันวันนี้" plan lines → the list-icon recipes (complete literals, UiKit.cls). */
  const PLAN_TONE = {
    brand: Kit.cls.listIconBrand, info: Kit.cls.listIconInfo, lilac: Kit.cls.listIconLilac,
    sun: Kit.cls.listIconSun, danger: Kit.cls.listIconDanger, neutral: Kit.cls.listIconNeutral
  };
  const MY_PLAN_MAX = 8;
  /**
   * R2: the lines of use('plan.myDay')(date, name) → [{icon, tone, main, sub}] (plain text; escaped by the caller), only
   * while the server has the plan feature. A failing or missing provider gives no lines (never breaks วันนี้).
   */
  function myPlanLines(date, name) {
    if (!serverHas('plan')) return [];
    const call = (id, gate) => {
      const fn = gate ? use(id) : null;
      if (typeof fn !== 'function') return [];
      try { const l = fn(date, name); return Array.isArray(l) ? l : []; } catch (e) { console.error('[core] ' + id + ' failed:', e); return []; }
    };
    // R5-SPEC §3.4: + use('training.myDay') ("ฝึกงาน <Station>" of a trainee linked to my account) while the server has 'training'
    const list = call('plan.myDay', true).concat(call('training.myDay', serverHas('training')));
    return list.filter(l => l && typeof l === 'object' && typeof l.main === 'string' && l.main).slice(0, MY_PLAN_MAX).map(l => ({
      icon: typeof l.icon === 'string' && l.icon ? l.icon : 'calendar-check',
      tone: typeof l.tone === 'string' ? l.tone : 'brand',
      main: l.main,
      sub: typeof l.sub === 'string' ? l.sub : '',
      tel: telOf(l.tel)
    }));
  }
  /**
   * R2 FIX I-7: a plan line's optional `tel` — a phone number with digits only after removing spaces, dashes, dots and
   * brackets, optionally a leading "+", 9–15 digits → the digits ('' for anything else: never a link from bad data).
   */
  function telOf(v) {
    if (typeof v !== 'string') return '';
    const t = v.replace(/[\s\-().]/g, '');
    return /^\+?\d{9,15}$/.test(t) ? t : '';
  }
  /** "0812345678" → "081-234-5678" (10-digit Thai mobile / 9-digit landline), anything else as it is. */
  function phoneText(t) {
    if (/^0\d{9}$/.test(t)) return t.slice(0, 3) + '-' + t.slice(3, 6) + '-' + t.slice(6);
    if (/^0\d{8}$/.test(t)) return t.slice(0, 2) + '-' + t.slice(2, 5) + '-' + t.slice(5);
    return t;
  }
  /** The 44 px tel: link under a plan line (indented under the text, past the icon). */
  function telLinkHtml(t) {
    if (!t) return '';
    return `<div class="pl-12 mt-1"><a href="tel:${esc(t)}" class="${Kit.cls.btn} ${Kit.cls.btnTonal} whitespace-nowrap" data-my-plan-tel="${esc(t)}" ` +
      `aria-label="${esc('โทร ' + phoneText(t))}">${Kit.icon('phone', 'w-4 h-4')}<span>${esc(phoneText(t))}</span></a></div>`;
  }

  /** Who is on leave on the selected date — shown to every role (not while the day is loading or unknown). */
  function renderStationLeaves() {
    const date = state.selectedDate;
    const known = dayKnown(date);
    setVisible($('stationLeavesCard'), known);
    if (!known) {   // hidden, and empty: names of another day / user must not stay in the DOM (B-3)
      setHtml($('stationLeaves'), '');
      $('stationLeaveCount').textContent = '';
      return;
    }
    const lines = leaveLines(date);
    // CL-16: the count says what it counts — "N คน" while the list holds only absences, else every non-zero kind
    $('stationLeaveCount').textContent = leaveCountsText(lines);
    setHtml($('stationLeaves'), lines.absent.length + lines.partial.length + lines.pending.length
      ? linesHtml(lines)
      : `<p class="${Kit.cls.textMeta}">${esc(withDay('ไม่มีรายการลา', date))}</p>`);
  }

  /**
   * CL-16: what a list of leaveLines holds — "3 คน" when it holds only absences (the long-standing wording), else
   * "ลาทั้งวัน 3 · ลาบางช่วง 1 · รออนุมัติ 1" with only the non-zero parts.
   */
  function leaveCountsText(lines) {
    const a = lines.absent.length, p = lines.partial.length, q = lines.pending.length;
    if (!p && !q) return a + ' คน';
    return [a ? 'ลาทั้งวัน ' + a : '', p ? 'ลาบางช่วง ' + p : '', q ? 'รออนุมัติ ' + q : ''].filter(Boolean).join(' · ');
  }

  /** Absent people, then doctor visits, then pending requests (leaveLines) as leaveItemHtml entries. */
  function linesHtml(lines) {
    return lines.absent.map(leaveItemHtml).join('') + lines.partial.map(leaveItemHtml).join('') + lines.pending.map(leaveItemHtml).join('');
  }

  /**
   * "• ชื่อ: ประเภท (คนที่ N)" as text (the station card's and the calendar day list's entry, a test contract): drawn
   * as avatar + name + a status pill; the bullet and the colon stay in the text for screen readers only. R1b: a doctor
   * visit reads "• ชื่อ: ลาหาหมอตอนเช้า 09:00–11:00 น." (sky pill), a pending request "• ชื่อ: พักร้อน (คนที่ 3) · รออนุมัติ"
   * (yellow pill) — l.info = Utils.leaveInfo of the row (absent entries may omit it).
   */
  function leaveItemHtml(l) {
    const info = l.info || null;
    const k = Kit.cls;
    let pill;
    if (info && info.partial) {
      pill = `<span class="${k.pill} ${k.pillPartial}" data-leave-line="partial">${Kit.icon('stethoscope', 'w-3.5 h-3.5')}${esc(l.type)}${info.timeText ? ' ' + esc(info.timeText) : ''}</span>`;
    } else if (info && info.pending) {
      pill = `<span class="${k.pill} ${k.pillPending}" data-leave-line="pending">${Kit.icon('clock', 'w-3.5 h-3.5')}${esc(l.type)}${l.rank ? ` (คนที่ ${l.rank})` : ''} · รออนุมัติ</span>`;
    } else {
      pill = `<span class="${k.pill} ${k.pillDanger}">${esc(l.type)}${l.rank ? ` (คนที่ ${l.rank})` : ''}</span>`;
    }
    // name and pill share a wrapping line: a long pill (a doctor visit with its time) moves under the name instead of
    // squeezing it
    return `<div class="flex items-center gap-2.5 min-w-0"><span class="sr-only">• </span>${Kit.avatar(l.name, 'sm')}` +
      `<span class="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">` +
      `<span class="min-w-0 text-sm font-medium leading-6 text-ink-900 break-words">${esc(l.name)}<span class="sr-only">: </span></span>` +
      `<span class="ml-auto">${pill}</span></span></div>`;
  }

  /** Supervisors edit the remark in the textarea; everyone else reads it in #remarkView. */
  function renderRemark() {
    const sup = isSup();
    const date = state.selectedDate;
    const ta = $('dailyRemark');
    const edit = canEditDay(date);
    const want = sup ? viewRemark(date) : '';
    if (normRemark(ta.value) !== want) ta.value = want;
    const ph = withDay('เพิ่มหมายเหตุของ', date, '…', { year: false });
    if (ta.placeholder !== ph) ta.placeholder = ph;
    ta.readOnly = !edit;
    ta.style.backgroundColor = edit ? '' : '#F1F4FB';   // ink-50 while the day cannot be edited
    setVisible(ta, sup);

    const view = $('remarkView');
    const known = dayKnown(date);
    const remark = known ? viewRemark(date) : '';
    setText(view, remark || (known ? withDay('ไม่มีหมายเหตุสำหรับ', date) : '-'));
    view.className = REMARK_VIEW_BASE + (remark ? 'bg-sun-50 border-sun-200 text-ink-900' : 'bg-white border-ink-100 text-slate-500');
    setVisible(view, !sup);
  }

  /** Save / copy / paste / clear work on the selected day's data, so they wait until it is loaded. */
  function renderDayControls() {
    const date = state.selectedDate;
    const ready = isSup() && dayView(date) === 'ready';
    const set = (id, off) => { const b = $(id); if (b && b.dataset.busy !== '1') b.disabled = off; };
    set('copyDayBtn', !ready);
    ['stationSaveBtn', 'pasteDayBtn', 'clearDayBtn'].forEach(id => set(id, !ready || ui.dayBusy === date));
    renderDayTools();
  }

  function renderDraftBadge() {
    setVisible($('draftBadge'), unsavedOn(state.selectedDate));   // R2: also while the proposal is shown (not saved yet)
    renderSaveLook();
  }

  /**
   * Audit lines (polish): names never break mid-word — every known name (active staff and the actors) is kept on one
   * line; the time is Buddhist-era (Minor 1).
   */
  let nameRe = null, nameReSig = null;
  function keepNames(escapedText, extra) {
    const names = state.staff.map(s => s.name).concat(extra || []).filter(n => n && n.length > 1);
    const sig = names.join('\n');
    if (sig !== nameReSig) {
      nameReSig = sig;
      const parts = names.map(esc).sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      nameRe = parts.length ? new RegExp(parts.join('|'), 'g') : null;
    }
    return nameRe ? escapedText.replace(nameRe, m => `<span class="whitespace-nowrap">${m}</span>`) : escapedText;
  }

  /**
   * The audit trail of the selected day (collapsed <details> with a count) is loaded once that day's data is (so
   * startup makes one request).
   */
  function renderAudit() {
    if (!isSup()) return;
    const date = state.selectedDate;
    const box = $('auditLogContent');
    const entries = state.audit[date];
    const note = t => `<p class="text-slate-500">${t}</p>`;
    const loading = note('กำลังโหลด…');
    let count = '…';
    if (entries) {
      count = entries.length + ' รายการ';
      setHtml(box, entries.length
        ? entries.map(a => `<div class="flex gap-2.5"><span class="mt-1.5 w-2 h-2 shrink-0 rounded-full bg-lilac-300" aria-hidden="true"></span>` +
          `<p class="min-w-0 break-words">${keepNames(esc(auditText(a)), entries.map(x => x.actor))} — <strong class="font-semibold text-ink-900 whitespace-nowrap">${esc(a.actor)}</strong>` +
          ` เมื่อ <span class="whitespace-nowrap">${esc(U.thaiStamp(a.timestamp))}</span></p></div>`).join('')
        : note(esc(withDay('ยังไม่มีประวัติการแก้ไขใน', date))));
    } else if (ui.auditLoading[date] || inRanges(ui.fetchingRanges, date)) {
      setHtml(box, loading);
    } else if (ui.auditFailed[date] || dayView(date) !== 'ready') {
      count = '-';
      setHtml(box, note('โหลดประวัติไม่สำเร็จ (แตะปุ่มรีเฟรชด้านบนเพื่อลองใหม่)'));
    } else {
      setHtml(box, loading);
      loadAudit(date);
    }
    const c = $('auditCount');
    if (c) c.textContent = count;
  }

  /**
   * FIX-CL CL-11: one readable Thai line per audit entry, whatever the server version wrote. The server's Thai detail is used
   * when there is one (the technical "(image/jpeg, N ตัวอักษร)" of a picture change is dropped); an entry without a Thai
   * detail — an action this app version does not know yet, or VIEW_PASSWORD — gets a label, never a blank or an English code.
   */
  const AUDIT_LABEL = {
    VIEW_PASSWORD: 'ดูรหัสผ่านของตนเองในแอป',
    ADMIN: 'งานดูแลระบบจาก Apps Script editor',
    STORE_PASSWORD: 'บันทึกรหัสผ่านลงชีต',
    APPROVE_LEAVE: 'อนุมัติลาพักร้อน',
    REJECT_LEAVE: 'ไม่อนุมัติลาพักร้อน',
    SET_AVATAR: 'เปลี่ยนรูปโปรไฟล์',
    RESET_PASSWORD: 'รีเซ็ตรหัสผ่าน',
    CHANGE_PASSWORD: 'เปลี่ยนรหัสผ่าน',
    SET_LEAVE: 'บันทึกการลา',
    CLEAR_LEAVE: 'ยกเลิกการลา',
    SAVE_DAY: 'บันทึกตารางเวร',
    CLEAR_DAY: 'ล้างข้อมูลทั้งวัน',
    AUTO_UNASSIGN: 'นำออกจาก Station อัตโนมัติ'
  };
  function auditText(a) {
    const detail = String(a && a.detail != null ? a.detail : '').trim();
    const action = String(a && a.action || '');
    if (/[฀-๿]/.test(detail)) {
      // no technical leftovers: the picture's type and size, the word "hash" (Code.gs 3.0 STORE_PASSWORD after an owner's edit)
      return detail.replace(/\s*\(image\/[a-z]+,[^)]*\)\s*$/i, '').replace(/สร้าง hash จากรหัสผ่าน/g, 'ตั้งรหัสผ่านตามที่');
    }
    if (AUDIT_LABEL[action]) return AUDIT_LABEL[action];
    return detail || 'มีการแก้ไขข้อมูล';
  }

  function loadAudit(date) {
    if (ui.auditLoading[date] || !state.session || ui.pwForced) return;
    ui.auditLoading[date] = true;
    const epoch = ui.epoch;
    track(Api.call('getAudit', { date, limit: 20 })).then(d => {
      if (epoch === ui.epoch) state.audit[date] = Array.isArray(d && d.entries) ? d.entries : [];
    }, () => {
      if (epoch === ui.epoch) ui.auditFailed[date] = true;
    }).then(() => {
      delete ui.auditLoading[date];
      if (epoch === ui.epoch && date === state.selectedDate) renderAudit();
    });
  }

  /* ---------- leave tab ---------- */
  /**
   * การลา: the calendar, then my own row ("สถานะของฉัน", the first .leave-row of the page), then everybody else as
   * compact rows (avatar, name, group tag, status pill with data-status, queue rank, who recorded it). A tap on a row
   * opens the leave sheet (#confirmLeaveModal). Every row is rendered; the group filter only hides rows.
   */
  function renderLeaveTab() {
    const date = state.selectedDate;
    renderLeaveCalendar();
    document.querySelectorAll('.grp-btn').forEach(b => {
      const on = b.dataset.f === state.filter;
      b.className = GRP_BASE + (on ? Kit.cls.chipOn : Kit.cls.chipOff);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const container = $('leaveContainer');
    const own = $('myLeaveRow');
    const hint = $('leaveListHint');
    if (!state.user) {
      setHtml(container, '');
      setHtml(own, '');
      setVisible(hint, false);
      $('leaveCountBadge').textContent = '0 คน';
      renderMyRequests();
      renderLeaveSheet();
      return;
    }
    const leaves = activeLeaves(date);
    $('leaveCountBadge').textContent = 'ลา ' + Object.keys(absentLeaves(date)).length + ' คน';   // absent people only (R1b)
    renderMyRequests();
    const view = dayView(date);
    const me = myName();
    const sup = isSup();
    const mine = state.staff.find(s => s.name === me);
    setVisible($('myLeaveCard'), !!mine);
    if (view === 'loading' || view === 'missing') {
      setHtml(container, view === 'loading' ? LOADING_HTML : missingHtml(date));
      setHtml(own, view === 'loading' ? Kit.skeleton(2) : '');
      setVisible(hint, false);
      renderLeaveSheet();
      return;
    }
    const queues = queuesOf(leaves);
    setHtml(own, mine ? leaveRowHtml(mine, leaves[me], me, sup, queues, true) : '');
    const others = state.staff.filter(s => s.name !== me);
    setHtml(container, `<div class="${Kit.cls.list}">` + others.map(s => leaveRowHtml(s, leaves[s.name], me, sup, queues, false)).join('') + '</div>');
    hint.textContent = sup ? 'แตะชื่อเพื่อบันทึกหรือเปลี่ยนสถานะการลา' : 'แก้ไขได้เฉพาะของตนเอง · แตะชื่อเพื่อดูรายละเอียด';
    setVisible(hint, true);
    renderLeaveSheet();
  }

  /**
   * The status of a leave row as a pill (word + icon, never colour alone): "ปกติ" (no row), the type with its queue rank
   * (absent: coral), a doctor visit with its time (sky, "ลาหาหมอตอนเช้า 09:00–11:00"), a pending request (yellow,
   * "พักร้อน · รออนุมัติ") or a rejected one (neutral, "พักร้อน · ไม่อนุมัติ"). The pill carries data-leave-status.
   */
  function leaveStatusPill(leave, rank, quietNormal) {
    const info = U.leaveInfo(leave);
    const k = Kit.cls;
    const TONE = { neutral: k.pillNeutral, pending: k.pillPending, partial: k.pillPartial, danger: k.pillDanger, rejected: k.pillRejected };
    const p = (text, tone, icon) => `<span class="${k.pill} ${TONE[tone]}" data-tone="${tone}" data-leave-status="${info.status || 'none'}">` +
      `${icon ? Kit.icon(icon, 'w-3.5 h-3.5') : ''}${esc(text)}</span>`;
    if (!info.type) return quietNormal ? '' : p('ปกติ', 'neutral', '');
    const r = rank ? ` · คนที่ ${rank}` : '';
    // CL-22: one tone per status everywhere — rejected soft coral, pending sun, partial-day accent; CL-24: a time range
    // always ends with "น."
    if (info.rejected) return p(info.type + ' · ไม่อนุมัติ', 'rejected', 'calendar-off');
    if (info.pending) return p(info.type + r + ' · รออนุมัติ', 'pending', 'clock');
    if (info.partial) return p(info.type + (info.timeText ? ' ' + info.timeText : ''), 'partial', 'stethoscope');
    return p(info.type + r, 'danger', 'calendar-off');
  }

  /**
   * One person's row: a button (data-staff, data-group, data-status = the leave type or '' for ปกติ — a rejected request
   * counts as ปกติ —, data-leave-status = approved | pending | rejected | '' (R1b), data-locked when this user may not
   * change it). own: the prominent own row in "สถานะของฉัน" (never hidden by the group filter).
   */
  function leaveRowHtml(s, leave, me, sup, queues, own) {
    const k = Kit.cls;
    const isOwner = s.name === me;
    const canEdit = sup || isOwner;
    const info = U.leaveInfo(leave);
    const cur = leave && !info.rejected ? leave.type : '';
    const rank = cur ? rankIn(queues, cur, s.name) : 0;
    const meta = leave ? [leave.recordedBy || '', U.thaiStampShort(leave.recordedAt)].filter(Boolean).join(' · ') : '';
    const hide = !own && state.filter !== 'all' && s.group !== state.filter;
    const tags = (isOwner ? `<span class="${k.tagBrand}">คุณ (ของฉัน)</span>` : '') +
      (s.group === 'backup' ? `<span class="${k.tag}">แทนเวร</span>` : '');
    // Minor 15: someone else's row shows a pill only for a leave, and no lock (the hint line above the list says why)
    const trail = canEdit ? Kit.icon('chevron-right', 'w-5 h-5 shrink-0 text-ink-300') : '';
    const said = info.rejected ? info.type + ' ไม่อนุมัติ' : info.pending ? info.type + (rank ? ' คนที่ ' + rank : '') + ' รออนุมัติ'
      : info.partial ? info.type + (info.timeText ? ' ' + info.timeText : '') : cur ? cur + (rank ? ' คนที่ ' + rank : '') : 'ปกติ';
    const label = s.name + (isOwner ? ' (คุณ)' : '') + ' — ' + said + (canEdit ? '' : ' (แก้ไขไม่ได้)');
    return `<button type="button" class="leave-row ${k.leaveRow}${own ? ' rounded-2xl border-2 border-brand-100 bg-brand-50/40' : ''}" ` +
        `data-staff="${esc(s.name)}" data-group="${esc(s.group)}" data-status="${esc(cur)}" data-leave-status="${info.status}"${canEdit ? '' : ' data-locked="1"'} ` +
        `aria-label="${esc(label)}"${hide ? ' hidden style="display:none"' : ''}>` +
      Kit.avatar(s.name, own ? 'md' : 'sm') +
      `<span class="min-w-0 flex-1">` +
        // name (+ tags) and the status pill share a wrapping line: a long pill moves under the name instead of squeezing it
        `<span class="flex flex-wrap items-center gap-x-2 gap-y-1">` +
          `<span class="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1"><span class="leave-name font-medium text-ink-900 break-words">${esc(s.name)}</span>${tags}</span>` +
          (own || leave ? `<span class="shrink-0 ml-auto">${leaveStatusPill(leave, rank)}</span>` : '') +
        `</span>` +
        `<span class="meta-badge block ${k.textMeta} mt-0.5${meta ? '' : ' hidden'}" data-staff-meta="${esc(s.name)}">${meta ? 'บันทึกโดย ' + metaHtml(leave) : ''}</span>` +
        (own && !meta && canEdit ? `<span class="block ${k.textMeta} mt-0.5">แตะเพื่อบันทึกหรือเปลี่ยนสถานะ</span>` : '') +
      `</span>${trail}` +
    `</button>`;
  }

  /**
   * R1b "คำขอของฉัน": my own pending and rejected requests on any date the server lists (state.requests — the last 30 days
   * and later), newest date last. Each row opens that date's leave sheet. Hidden while there is none (always on an older
   * server; for the Supervisor the list holds other people's requests, which the approval inbox shows instead).
   */
  function renderMyRequests() {
    const card = $('myRequestsCard');
    if (!card) return;
    const me = myName();
    // CL-4: never on a server older than 3.0 (its answers carry no requests: whatever is still in memory is stale)
    const mine = state.user && ui.serverMode !== 'old' ? state.requests.filter(r => r.staff === me && U.leaveStatus(r) !== 'approved') : [];
    setVisible(card, mine.length > 0);
    if (!mine.length) { setHtml($('myRequestsList'), ''); setText($('myRequestsCount'), ''); return; }
    const k = Kit.cls;
    const pending = mine.filter(r => U.leaveStatus(r) === 'pending').length;
    // CL-22 / CL-24: the badge in the tone of what it counts (pending = sun, only rejections = soft coral), counted in "คำขอ"
    const countEl = $('myRequestsCount');
    setText(countEl, pending ? 'รออนุมัติ ' + pending : 'ไม่อนุมัติ ' + mine.length + ' คำขอ');
    const countCls = k.pill + ' ' + (pending ? k.pillPending : k.pillRejected);
    if (countEl && countEl.className !== countCls) countEl.className = countCls;
    setHtml($('myRequestsList'), mine.map(r => {
      const info = U.leaveInfo(r);
      const when = U.thaiDateShort(r.date, { weekday: true });
      const sub = info.rejected
        ? ['ไม่อนุมัติ' + (r.decidedBy ? ' โดย ' + r.decidedBy : ''), r.note ? 'เหตุผล: ' + r.note : ''].filter(Boolean).join(' · ')
        : (r.recordedAt ? 'ส่งคำขอเมื่อ ' + U.thaiStampShort(r.recordedAt) : 'รอ Supervisor อนุมัติ');
      // CL-24: the rejected row's accessible name includes the reason shown on screen
      const said = info.type + ' ' + U.thaiDate(r.date) + ' — ' + (info.rejected ? 'ไม่อนุมัติ' + (r.note ? ' เหตุผล: ' + r.note : '') : 'รออนุมัติ');
      return `<button type="button" class="request-row ${k.leaveRow}" data-date="${esc(r.date)}" data-staff="${esc(r.staff)}" data-request-status="${info.status}" ` +
          `aria-label="${esc(said)}">` +
        `<span class="${k.listIcon} ${info.rejected ? k.listIconDanger : k.listIconSun}">${Kit.icon(info.rejected ? 'calendar-off' : 'clock', 'w-5 h-5')}</span>` +
        `<span class="min-w-0 flex-1">` +
          `<span class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="font-medium text-ink-900 whitespace-nowrap">${esc(when)}</span>` +
          `${leaveStatusPill(r, 0)}</span>` +
          `<span class="block ${k.textMeta} mt-0.5 whitespace-pre-line break-words [overflow-wrap:anywhere]">${esc(sub)}</span>` +
        `</span>${Kit.icon('chevron-right', 'w-5 h-5 shrink-0 text-ink-300')}</button>`;
    }).join(''));
  }

  function onMyRequestClick(e) {
    const row = e.target && e.target.closest ? e.target.closest('.request-row[data-date]') : null;
    if (row) spawn(() => openLeaveFor(row.dataset.date, row.dataset.staff));
  }

  function setFilter(f) {
    if (['all', 'regular', 'backup'].indexOf(f) < 0) f = 'all';
    state.filter = f;
    renderLeaveTab();
  }

  /* ---------- the leave sheet (#confirmLeaveModal): option tiles for one person and date ---------- */
  /**
   * Opens the sheet of `staff` for the selected date. Editable for the Supervisor and for one's own row; any other
   * row opens read-only and says why (ui.leaveSheet.locked). The pick is kept in ui.pendingLeave until บันทึก.
   */
  function openLeaveSheet(staff) {
    if (!state.user || ui.leaveSaving || !activeSet().has(staff)) return;
    const date = state.selectedDate;
    if (!dayKnown(date)) return;
    ui.leaveSheet = { staff, date, locked: !(isSup() || staff === myName()) };
    ui.pendingLeave = null;
    ui.leaveTime = null;
    ui.leaveTimeError = '';
    ui.leaveBusy = '';
    showModal('confirmLeaveModal');
    renderLeaveSheet();
  }

  /**
   * R1b: opens the leave sheet of (date, staff) from anywhere (คำขอของฉัน, the approval inbox via core.openLeave): selects
   * the date, makes sure its data is loaded, then opens the sheet. → Promise<boolean> (false when it could not open).
   */
  async function openLeaveFor(date, staff) {
    if (!state.user || !U.isValidYmd(date) || !activeSet().has(staff)) return false;
    const alive = sessionAlive();
    if (!(await setSelectedDate(date)) || !alive()) return false;
    if (!dayKnown(date)) {
      const w = windowFor(date);
      try { await ensureRange(w.from, w.to); } catch (e) { if (!alive()) return false; handleError(e, { quiet: true }); }
      if (!alive() || state.selectedDate !== date) return false;
    }
    if (!dayKnown(date)) { toast(msgNotLoaded(date)); return false; }
    if (isShown('confirmLeaveModal')) closeConfirmLeave();
    openLeaveSheet(staff);
    return isShown('confirmLeaveModal');
  }

  /** The leave types the sheet offers: the doctor-visit types only when the server has them (serverHas('leave2')). */
  function sheetTypes(curType) {
    const list = serverHas('leave2') ? U.LEAVE_TYPES.slice() : U.LEAVE_TYPES.filter(t => !U.isPartialType(t));
    if (curType && list.indexOf(curType) < 0) list.push(curType);   // never hide the person's current type
    return list;
  }

  /** What the person has now, for picking: {type, detail} — a rejected request counts as ปกติ ({type: ''}). */
  function sheetCurrent(leave) {
    const info = U.leaveInfo(leave);
    if (!info.type || info.rejected) return { type: '', detail: '' };
    return { type: info.type, detail: info.kind === 'partial' ? (U.parseTimeRange(leave.detail) || {}).value || '' : '' };
  }

  /** The picked option: ui.pendingLeave, else the current one. */
  function sheetPick(sh, cur) {
    const p = ui.pendingLeave;
    return p && p.staff === sh.staff ? { type: p.type, detail: p.detail || '' } : cur;
  }

  /**
   * Other people's vacations that hold one of the date's automatic slots: every non-rejected พักร้อน row of someone else
   * (the server's rule, DESIGN-backend-data §B.3 — all rows, also of people no longer active).
   */
  function vacationsTaken(date, staff) {
    const map = leavesOn(date);
    return Object.keys(map).filter(n => n !== staff && map[n] && map[n].type === 'พักร้อน' && U.leaveStatus(map[n]) !== 'rejected').length;
  }

  /** The pick will become a pending request (staff member, vacation, the automatic slots of that date are taken). */
  function willBePending(sh, pick, cur) {
    if (!pick || pick.type !== 'พักร้อน' || cur.type === 'พักร้อน' || isSup() || !serverHas('approval')) return false;
    const slots = state.rules.vacationAutoSlots;
    return Number.isInteger(slots) && vacationsTaken(sh.date, sh.staff) >= slots;
  }

  /** CL-20: the doctor-visit tiles carry a short label (never wraps at 360 px or 130 % text); the full type stays their
   *  accessible name and the wording of every pill. */
  const TILE_LABEL = { 'ลาหาหมอตอนเช้า': 'หาหมอ (เช้า)', 'ลาหาหมอตอนบ่าย': 'หาหมอ (บ่าย)' };

  /**
   * CL-15: the leave sheet re-renders its tiles, presets and status box on every pick — focus stays on "the same" control
   * (found again by its data-val / data-time / data-leave-act), else on the sheet's title, never on <body>.
   */
  const SHEET_FOCUS_ATTRS = ['data-val', 'data-time', 'data-leave-act'];
  function sheetFocusKey() {
    const a = document.activeElement;
    const modal = $('confirmLeaveModal');
    if (!a || !modal || !modal.contains(a) || a.id) return null;
    for (const attr of SHEET_FOCUS_ATTRS) {
      if (a.hasAttribute(attr)) return { node: a, sel: '#confirmLeaveModal [' + attr + '="' + String(a.getAttribute(attr)).replace(/["\\]/g, '\\$&') + '"]' };
    }
    return null;
  }
  function restoreSheetFocus(key) {
    if (!key || key.node.isConnected || !isShown('confirmLeaveModal')) return;
    const el = document.querySelector(key.sel);
    const target = el && !el.disabled ? el : $('confirmLeaveTitle');
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
  }

  /** The pick is a pending request that the Supervisor decides in this sheet (อนุมัติ / ไม่อนุมัติ in the status box). */
  function sheetIsDecision(sh, leave) {
    return !!leave && !sh.locked && isSup() && U.leaveStatus(leave) === 'pending' && leave.type === 'พักร้อน' &&
      typeof use('leave.decide') === 'function';
  }

  function renderLeaveSheet() {
    const sh = ui.leaveSheet;
    if (!sh || !isShown('confirmLeaveModal')) return;
    if (!state.user || !activeSet().has(sh.staff)) { closeConfirmLeave(); return; }
    const focusKey = sheetFocusKey();
    const k = Kit.cls;
    const leaves = activeLeaves(sh.date);
    const leave = leaves[sh.staff] || null;
    const info = U.leaveInfo(leave);
    const cur = sheetCurrent(leave);
    const p = ui.pendingLeave;
    const pick = sheetPick(sh, cur);
    const queues = queuesOf(leaves);
    const curRank = info.type && !info.rejected ? rankIn(queues, info.type, sh.staff) : 0;
    const meta = leave ? [leave.recordedBy || '', U.thaiStampShort(leave.recordedAt)].filter(Boolean).join(' · ') : '';
    const busy = ui.leaveSaving;
    const pendingSoon = !!p && willBePending(sh, pick, cur);
    const deciding = sheetIsDecision(sh, leave);
    $('confirmLeaveTitle').textContent = sh.locked ? 'สถานะการลา' : 'บันทึกการลา';
    // the status pill wraps under the name and date when it is long (a request, a doctor visit with its time)
    let html = `<div class="flex items-center gap-3 min-w-0">${Kit.avatar(sh.staff, 'md')}` +
      `<div class="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1"><div class="min-w-0">` +
      `<p class="font-display text-base font-medium leading-6 text-ink-900 break-words">${esc(sh.staff)}</p>` +
      `<p class="${k.textMeta}">${esc(U.thaiDate(sh.date))}</p></div><span class="ml-auto">${leaveStatusPill(leave, curRank)}</span></div></div>` +
      (meta ? `<p class="${k.textCaption}">บันทึกโดย ${metaHtml(leave)}</p>` : '');
    html += leaveStatusBoxHtml(sh, leave, info, busy);
    if (p) {
      const queue = queues[p.type] ? queues[p.type].filter(n => n !== sh.staff).length : 0;
      const partialPick = U.isPartialType(p.type);
      const what = p.type === '' ? (info.pending ? 'ปกติ (ยกเลิกคำขอ)' : 'ปกติ (ยกเลิกวันลา)') : p.type + (partialPick && p.detail ? ' ' + U.formatTimeRange(p.detail) : '');
      if (pendingSoon) {
        // CL-18: the third (or later) vacation — ONE notice that says what happens, not an info line plus a warning
        const slots = state.rules.vacationAutoSlots;
        const why = slots === 0 ? 'ทุกคำขอพักร้อนต้องให้ Supervisor อนุมัติ'   // CL-6
          : withDay('', sh.date, 'มีผู้ลาพักร้อนแล้ว ' + vacationsTaken(sh.date, sh.staff) + ' คน') + ' คำขอนี้จะส่งให้ Supervisor อนุมัติ';
        html += `<div class="${k.banner} ${k.bannerWarn}" data-leave-pick data-vacation-notice role="status">${Kit.icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}` +
          `<p class="min-w-0">เปลี่ยนเป็น <strong class="font-semibold">${esc(what)}</strong> — <span data-vacation-why>${esc(why)}</span>` +
          ` · กด "ส่งคำขอ" เพื่อยืนยัน</p></div>`;
      } else {
        html += `<div class="${k.banner} ${k.bannerInfo}" data-leave-pick>${Kit.icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<p class="min-w-0">` +
          `เปลี่ยนเป็น <strong class="font-semibold">${esc(what)}</strong>` +
          (queues[p.type] ? ` — จะเป็นคนที่ ${queue + 1} ของ${esc(p.type)}${esc(dayRef(sh.date, { year: false }))}` : '') +
          (partialPick && !p.detail ? ' — เลือกช่วงเวลาด้านล่าง' : ' · กด "บันทึก" เพื่อยืนยัน') +
          `</p></div>`;
      }
    }
    setHtml($('confirmLeaveText'), html);
    const note = $('leaveSheetNote');
    setHtml(note, sh.locked
      ? `<div class="${k.note}">${Kit.icon('lock', 'w-5 h-5 shrink-0 mt-0.5 text-ink-500')}<p class="min-w-0">แก้ไขได้เฉพาะสถานะของตนเอง — หากข้อมูลไม่ถูกต้อง แจ้ง Supervisor</p></div>`
      : '');
    setVisible(note, sh.locked);
    // CL-18: a rejected request is not "ปกติ was chosen": no tile is on until the owner picks one
    const onType = p ? pick.type : info.rejected ? null : pick.type;
    setHtml($('leaveOptions'), [''].concat(sheetTypes(cur.type)).map(val => {
      const on = val === onType;
      const rank = val && val === cur.type ? curRank : 0;
      const partialTile = U.isPartialType(val);
      const label = val === '' ? 'ปกติ' : TILE_LABEL[val] || val;
      return `<button type="button" class="${partialTile ? LV_TILE_TIGHT : LV_TILE}${on ? k.tileOn : k.tileOff}${val === '' ? ' col-span-2' : ''}" ` +
        `data-staff="${esc(sh.staff)}" data-val="${esc(val)}" aria-pressed="${on ? 'true' : 'false'}"` +
        `${label !== (val || 'ปกติ') ? ` aria-label="${esc(val + (rank ? ' (คนที่ ' + rank + ')' : ''))}"` : ''}${sh.locked || busy ? ' disabled' : ''}>` +
        (on ? Kit.icon('check', 'w-4 h-4 shrink-0') : partialTile ? Kit.icon('stethoscope', 'w-4 h-4 shrink-0 text-accent-700') : '') +
        `<span>${esc(label)}</span>` +
        (rank ? `<span class="text-xs font-medium">(คนที่ ${rank})</span>` : '') + '</button>';
    }).join(''));
    renderLeaveTime(sh, pick);
    const save = $('confirmLeaveBtn');
    // CL-18: while the sheet is the Supervisor's decision (and nothing else is picked) the footer is a single "ปิด"
    const onlyClose = sh.locked || (deciding && !p);
    setVisible(save, !onlyClose);
    if (!ui.leaveSaving) {
      save.disabled = !p || (U.isPartialType(p.type) && !p.detail);
      save.textContent = pendingSoon ? 'ส่งคำขอ' : 'บันทึก';
    }
    $('confirmLeaveCancelBtn').textContent = onlyClose ? 'ปิด' : 'ยกเลิก';
    restoreSheetFocus(focusKey);
  }

  /**
   * R1b: the current row's status, under the person — pending (when it was asked; for the Supervisor "รอคุณอนุมัติ" with the
   * decide buttons of core.use('leave.decide'), for its owner "ยกเลิกคำขอ"), rejected (by whom, when, the reason; for its owner
   * "ขอใหม่" / "ลบคำขอ"), approved by the Supervisor past the automatic slots (by whom, the note), a doctor visit (its time).
   * '' for an ordinary approved row.
   */
  function leaveStatusBoxHtml(sh, leave, info, busy) {
    if (!leave || !info.type) return '';
    const k = Kit.cls;
    const box = (tone, icon, iconTone, main, sub, extra, key) =>
      `<div class="${k.statusBox} ${tone}" data-leave-box="${key}"><span class="${k.listIcon} ${iconTone}">${Kit.icon(icon, 'w-5 h-5')}</span>` +
      `<div class="min-w-0 flex-1 space-y-0.5"><p class="font-medium">${main}</p>${sub ? `<p class="${k.textMeta} break-words">${sub}</p>` : ''}${extra || ''}</div></div>`;
    const by = (who, at) => [who ? 'โดย ' + esc(who) : '', at ? esc(U.thaiStamp(at)) : ''].filter(Boolean).join(' · ');
    const reason = leave.note ? `<p class="text-sm leading-6 text-ink-800 whitespace-pre-line break-words [overflow-wrap:anywhere]">เหตุผล: ${esc(leave.note)}</p>` : '';
    const btn = (key, look, icon, label) => {
      const on = ui.leaveBusy === key;
      return `<button type="button" class="${k.btn} ${look} flex-1 min-w-0" data-leave-act="${key}"${busy ? ' disabled' : ''}${on ? ' aria-busy="true"' : ''}>` +
        (on ? 'กำลังบันทึก…' : (icon ? Kit.icon(icon, 'w-5 h-5') : '') + `<span class="truncate">${label}</span>`) + '</button>';
    };
    if (info.pending) {
      const decide = sheetIsDecision(sh, leave);
      const own = !decide && sh.staff === myName() && !sh.locked;
      const acts = decide ? `<div class="flex gap-2 pt-2">${btn('rejected', k.btnSecondary, '', 'ไม่อนุมัติ')}${btn('approved', k.btnPrimary, 'check', 'อนุมัติ')}</div>`
        : own ? `<div class="flex gap-2 pt-2">${btn('cancel', k.btnSecondary, '', 'ยกเลิกคำขอ')}</div>` : '';
      return box(k.statusBoxPending, 'clock', k.listIconSun, isSup() ? 'รอคุณอนุมัติ' : 'รอ Supervisor อนุมัติ',
        (leave.recordedAt ? 'ส่งคำขอเมื่อ ' + `<span class="whitespace-nowrap">${esc(U.thaiStamp(leave.recordedAt))}</span>` + ' · ' : '') + esc(MSG.pendingNote), acts, 'pending');
    }
    if (info.rejected) {
      const own = sh.staff === myName() && !sh.locked;
      const acts = own ? `<div class="flex gap-2 pt-2">${btn('delete', k.btnSecondary, 'trash', 'ลบคำขอ')}${btn('rerequest', k.btnPrimary, 'refresh', 'ขอใหม่')}</div>` : '';
      return box(k.statusBoxRejected, 'calendar-off', k.listIconDanger, 'ไม่อนุมัติ', by(leave.decidedBy, leave.decidedAt), reason + acts, 'rejected');
    }
    if (info.partial) {
      return box(k.statusBoxPartial, 'stethoscope', k.listIconInfo, esc(info.type) + (info.timeText ? ` <span class="whitespace-nowrap">${esc(info.timeText)}</span>` : ''),
        esc(MSG.partialNote), '', 'partial');
    }
    if (leave.decidedBy) {   // the Supervisor approved a request past the automatic slots
      return box(k.statusBoxOk, 'check-circle', 'bg-emerald-100 text-emerald-800', 'อนุมัติแล้ว', by(leave.decidedBy, leave.decidedAt), reason, 'approved');
    }
    return '';
  }

  /**
   * The time step under the tiles while a doctor-visit type is picked: preset chips of that type, then the two time inputs
   * (showing the picked range; left alone while the user is typing a custom one: ui.leaveTime) and the error line.
   * CL-12: an empty field shows the hint "เลือกเวลา" (iOS draws nothing in an empty time field): data-empty on the input.
   */
  function renderLeaveTime(sh, pick) {
    const step = $('leaveTimeStep');
    if (!step) return;
    const on = !!sh && !sh.locked && U.isPartialType(pick.type);
    setVisible(step, on);
    if (!on) {
      setHtml($('leaveTimePresets'), '');
      ui.leaveTime = null;
      return;
    }
    const k = Kit.cls;
    const busy = ui.leaveSaving;
    const presets = U.PARTIAL_TIME_PRESETS[pick.type] || [];
    setText($('leaveTimeLabel'), pick.type === 'ลาหาหมอตอนบ่าย' ? 'ช่วงเวลาที่ลา (บ่าย)' : 'ช่วงเวลาที่ลา (เช้า)');
    setHtml($('leaveTimePresets'), presets.map(v => {
      const sel = v === pick.detail;
      return `<button type="button" class="${k.timeChip} ${sel ? k.chipOn : k.chipOff}" data-time="${esc(v)}" aria-pressed="${sel ? 'true' : 'false'}"` +
        `${busy ? ' disabled' : ''}>${esc(U.formatTimeRange(v, { unit: false }))}</button>`;
    }).join(''));
    const start = $('leaveTimeStart'), end = $('leaveTimeEnd');
    if (!ui.leaveTime) {   // not typing: the inputs show the picked range
      const r = U.parseTimeRange(pick.detail);
      if (start.value !== (r ? r.start : '')) start.value = r ? r.start : '';
      if (end.value !== (r ? r.end : '')) end.value = r ? r.end : '';
    }
    markEmptyTimes();
    start.disabled = busy;
    end.disabled = busy;
    const err = ui.leaveTimeError || '';
    setText($('leaveTimeError'), err);
    setVisible($('leaveTimeError'), !!err);
    [start, end].forEach(el => el.setAttribute('aria-invalid', err ? 'true' : 'false'));
  }

  /** CL-12: data-empty="1" on an empty time field — its hint "เลือกเวลา" shows and the native "--:--" is hidden (index.html). */
  function markEmptyTimes() {
    ['leaveTimeStart', 'leaveTimeEnd'].forEach(id => {
      const el = $(id);
      // a half-typed field on a desktop (hours only) still has value '' but validity.badInput: it is not empty (reviewer 2)
      if (el) el.setAttribute('data-empty', el.value || (el.validity && el.validity.badInput) ? '0' : '1');
    });
  }

  /**
   * CL-12: after a doctor-visit tile is picked the time step comes into view inside the sheet (it starts below the fold at
   * 360×640 and in landscape). An instant scroll: a smooth one can be cut short by the re-render that follows a pick.
   */
  function revealTimeStep() {
    const step = $('leaveTimeStep');
    if (!step || step.classList.contains('hidden') || typeof step.scrollIntoView !== 'function') return;
    try { step.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { step.scrollIntoView(false); }
  }

  /* ---------- leave calendar: how many people are on leave on each day of a month ---------- */
  /** Cell colours by number of people on leave (index = count, the last one for "4 or more"). */
  const CAL_HEAT_BG = ['bg-white', 'bg-rose-50', 'bg-rose-100', 'bg-rose-200', 'bg-rose-300'];
  const CAL_HEAT_BORDER = ['border-ink-100', 'border-rose-200', 'border-rose-300', 'border-rose-300', 'border-rose-400'];
  const CAL_SCOPE = { regular: ' (เฉพาะคนประจำ)', backup: ' (เฉพาะทีมแทนเวร)' };

  function calMonth() { return ui.calMonth || U.monthKey(state.selectedDate); }

  /**
   * R3 F-1: the Supervisor's holidays (ตั้งค่าการจัดเวร → วันหยุด) for the leave calendar — use('plan').holidays() (Map
   * date → name; the persisted plan domain, so the offline copy too; empty on a server without 'plan', which wipes it).
   */
  function calHolidays() {
    const plan = use('plan');
    if (!plan || typeof plan.holidays !== 'function') return new Map();
    try { const m = plan.holidays(); return m instanceof Map ? m : new Map(); } catch (e) { console.error('[core] holidays failed:', e); return new Map(); }
  }
  /**
   * R3 F-1: the shown month's holidays come with the plan data — use('plan').ensure(monthStart, monthEnd) once per shown
   * month, only while the server has 'plan' and the plan range does not cover that month yet (no new action; ensure never
   * rejects and redraws when its answer is applied). A far month may reset the plan range (≤ 186 days): leaving การลา puts
   * it back around the selected date (restoreCalPlanRange, as ตารางเวร does — FIX-RO R-1).
   * R3 FIX-CL2 Q-1: plan.covers() alone decides — the selected date's month ± 1 is NOT always held (a far month resets the
   * range), so a month of that window that is not covered asks for the whole window back (วันนี้ reads it too); any other
   * month asks for itself.
   */
  function ensureCalHolidays(month) {
    if (!state.session || !serverHas('plan') || ui.calPlanMonth === month) return;
    const plan = use('plan');
    if (!plan || typeof plan.ensure !== 'function') return;
    ui.calPlanMonth = month;
    const r = U.monthRange(month);
    try { if (typeof plan.covers === 'function' && plan.covers(r.from, r.to)) return; } catch (e) { return; }
    const sel = U.monthKey(state.selectedDate);
    const lo = U.addMonths(sel, -1), hi = U.addMonths(sel, 1);
    if (month >= lo && month <= hi) {
      track(Promise.resolve(plan.ensure(lo + '-01', U.monthRange(hi).to)).catch(() => false));
      return;
    }
    ui.calPlanMoved = true;
    track(Promise.resolve(plan.ensure(r.from, r.to)).catch(() => false));
  }
  function restoreCalPlanRange() {
    const plan = use('plan');
    if (!ui.calPlanMoved || !plan || typeof plan.ensure !== 'function' || !state.session) return;
    ui.calPlanMoved = false;
    ui.calPlanMonth = '';
    const m = U.monthKey(state.selectedDate);
    track(Promise.resolve(plan.ensure(U.addMonths(m, -1) + '-01', U.monthRange(U.addMonths(m, 1)).to)).catch(() => false));
  }
  /** R3 F-1: the holiday marker of a calendar cell (a short bar: unlike the circle / diamond of the leave markers). */
  const CAL_HOLIDAY_MARK = 'block w-2.5 h-1 rounded-full bg-coral-600';
  const CAL_HOLIDAY_MARK_SEL = 'block w-2.5 h-1 rounded-full bg-white';
  const CAL_HOLIDAY_LEGEND = 'inline-block align-middle mr-1.5 w-2.5 h-1 rounded-full bg-coral-600';
  /**
   * R3 FIX-CL2 Q-4: a holiday name for the month list — every space-separated part an inline-block (moved to the next line
   * whole instead of being cut by the Thai line breaker, which does not know names such as "ชนกาธิเบศร"; a part longer
   * than the whole line still wraps inside, never overflows).
   */
  function calHolidayName(name) {
    return String(name).split(/\s+/).filter(Boolean).map(p => `<span class="inline-block max-w-full">${esc(p)}</span>`).join(' ');
  }

  /** leaveList(date) limited to the group filter of the leave tab (queue ranks stay those of everyone). */
  function filteredLeaveList(date) {
    return filteredLines(date).absent;
  }

  /** leaveLines(date) limited to the group filter of the leave tab (R1b: absent, partial and pending lines). */
  function filteredLines(date) {
    const lines = leaveLines(date);
    if (state.filter === 'all') return lines;
    const groups = new Map(state.staff.map(s => [s.name, s.group]));
    const keep = l => groups.get(l.name) === state.filter;
    return { absent: lines.absent.filter(keep), partial: lines.partial.filter(keep), pending: lines.pending.filter(keep) };
  }

  function renderLeaveCalendar() {
    const box = $('leaveCalendar');
    if (!state.user) { setHtml(box, ''); return; }
    const month = calMonth();
    const today = U.todayStr();
    $('calMonthLabel').textContent = U.thaiMonthYear(month);

    let loading = false, missing = false, knownDays = 0, total = 0, partials = 0, pendings = 0;
    const byType = nameMap();
    ensureCalHolidays(month);
    const hol = calHolidays();
    const monthHol = [];
    const cells = U.monthGrid(month).flat().map((date, i) => {
      if (!date) return '<div class="h-14" aria-hidden="true"></div>';
      const view = dayView(date);
      const known = view === 'ready' || view === 'cached';
      if (view === 'loading') loading = true;
      else if (!known) missing = true;
      else knownDays++;
      const lines = known ? filteredLines(date) : { absent: [], partial: [], pending: [] };
      const list = lines.absent;   // only ABSENT people count (R1b); doctor visits and pending requests are markers
      list.forEach(l => { byType[l.type] = (byType[l.type] || 0) + 1; });
      total += list.length;
      partials += lines.partial.length;
      pendings += lines.pending.length;
      const holiday = hol.has(date) ? String(hol.get(date) || '') : null;
      if (holiday !== null) monthHol.push([date, holiday]);
      return calDayHtml(date, known ? list.length : null, i % 7 === 0, date === today, date === state.selectedDate,
        { partial: lines.partial.length, pending: lines.pending.length, holiday });
    });
    const head = U.THAI_WEEKDAYS_SHORT.map((d, i) =>
      `<div class="text-xs font-medium leading-6 ${i === 0 ? 'text-coral-600' : 'text-slate-500'}">${d}</div>`).join('');
    setHtml(box, `<div class="grid grid-cols-7 gap-1 text-center">${head}${cells.join('')}</div>`);
    // R3 F-1: the heading "วันหยุดเดือนนี้" under the calendar (hidden without holidays); its leading mark is the cells'
    // holiday marker, so the heading is also the marker's legend. FIX-CL2 Q-4: one holiday per line ("5 ธ.ค. <name>"): the
    // date never wraps, the name only breaks at its spaces (each space-separated part is kept whole when it fits)
    const holEl = $('calHolidays');
    setHtml(holEl, monthHol.length
      ? `<p><span class="${CAL_HOLIDAY_LEGEND}" data-cal-holiday-legend aria-hidden="true"></span>วันหยุดเดือนนี้</p>` +
        `<ul class="mt-0.5 space-y-0.5" data-cal-holiday-list>` +
        monthHol.map(h => `<li class="flex items-baseline gap-x-1.5" data-cal-holiday-item="${h[0]}">` +
          `<span class="shrink-0 whitespace-nowrap tabular-nums" data-cal-holiday-date="${h[0]}">${esc(U.thaiDateShort(h[0], { year: false }))}</span>` +
          (h[1] ? ' <span class="min-w-0" data-cal-holiday-name>' + calHolidayName(h[1]) + '</span>' : '') + '</li>').join('') +
        `</ul>`
      : '');
    setVisible(holEl, monthHol.length > 0);

    const status = $('calStatus');
    setHtml(status, loading ? `${Kit.icon('clock', 'w-4 h-4 shrink-0')}<span>กำลังโหลดข้อมูลของเดือนนี้…</span>`
      : missing ? `${Kit.icon('cloud-off', 'w-4 h-4 shrink-0')}<span>ยังไม่มีข้อมูลบางวันของเดือนนี้ในเครื่อง</span> <button type="button" data-cal="retry" class="${Kit.cls.btn} ${Kit.cls.btnTonal} ${Kit.cls.btnCompact}">โหลดอีกครั้ง</button>`
      : '');
    setVisible(status, loading || missing);

    const scope = CAL_SCOPE[state.filter] || '';
    const types = U.LEAVE_TYPES.concat(Object.keys(byType).filter(t => U.LEAVE_TYPES.indexOf(t) < 0))
      .filter(t => byType[t]).map(t => `${t} ${byType[t]}`);
    // Minor 8: never "ไม่มีการลา" for days that are not on this device
    const partial = loading || missing;
    const totalHead = partial ? `รวมเท่าที่มีข้อมูล${scope}` : `รวมทั้งเดือน${scope}`;
    // each "type N" stays on one line ("Off In charge 2", "ลาป่วย 2")
    setHtml($('calMonthTotal'), esc(!knownDays && partial
      ? `รวมทั้งเดือน${scope}: ${loading ? 'กำลังโหลดข้อมูล…' : 'ยังไม่มีข้อมูลของเดือนนี้ในเครื่อง'}`
      : total ? `${totalHead}: ลา ${total} ครั้ง · `
        : partial ? `${totalHead}: ยังไม่พบการลา (ข้อมูลยังไม่ครบทั้งเดือน)` : `${totalHead}: ไม่มีการลา`) +
      (knownDays && total ? types.map(t => `<span class="whitespace-nowrap">${esc(t)}</span>`).join(' · ') : '') +
      // R1b: doctor visits (still at work) and pending requests are not leave days: their own line, never in the total
      (knownDays && (partials || pendings) ? '<span class="block mt-0.5 font-normal" data-cal-extra>' +
        [partials ? `<span class="whitespace-nowrap">ลาบางช่วง (ยังทำงาน) ${partials} ครั้ง</span>` : '',
          pendings ? `<span class="whitespace-nowrap">รออนุมัติ ${pendings} คำขอ</span>` : ''].filter(Boolean).join(' · ') + '</span>' : ''));
    setVisible($('calMarkLegend'), ui.serverMode === 'v3' && serverHas('leave2'));
    renderCalDayDetail(month);
  }

  /** count: people on leave (null = that day's data is not on this device). */
  /**
   * One day of the leave calendar — the week strip's selection language (C-M5): the selected day is filled brand-600
   * with a white number (an inner fill, so the heat colour of the cell stays in its class), today when not selected has
   * an accent ring and an accent-700 number, keyboard focus is an offset ink ring.
   */
  function calDayHtml(date, count, sunday, isToday, selected, extra) {
    const k = Kit.cls;
    const ex = extra || {};
    // CL-13: a doctor visit is a circle, a pending request a diamond (shape and colour), in their own row under the number;
    // white on the selected (brand-600) day
    // R3 F-1: a holiday's short bar leads the markers' row (it never sits on the number, even at 320 px)
    const marks = (typeof ex.holiday === 'string' ? `<span class="${selected ? CAL_HOLIDAY_MARK_SEL : CAL_HOLIDAY_MARK}" data-cal-holiday data-mark="holiday"></span>` : '') +
      (ex.partial ? `<span class="${selected ? k.calMarkPartialSel : k.calMarkPartial}" data-mark="partial"></span>` : '') +
      (ex.pending ? `<span class="${selected ? k.calMarkPendingSel : k.calMarkPending}" data-mark="pending"></span>` : '');
    const said = [ex.partial ? `ลาบางช่วง ${ex.partial} คน` : '', ex.pending ? `รออนุมัติ ${ex.pending} คำขอ` : ''].filter(Boolean).join(' · ');
    // R3 F-1: a holiday (ex.holiday = its name, '' when unnamed; null = none) — the number in the Sunday tone, a short bar
    // marker in the markers' row, and "วันหยุด: <name>" in the cell's label
    const holiday = typeof ex.holiday === 'string';
    const i = count === null ? -1 : Math.min(count, CAL_HEAT_BG.length - 1);
    const bg = i < 0 ? 'bg-cream-50 border-dashed' : CAL_HEAT_BG[i];
    const border = isToday && !selected ? k.calCellToday : i < 0 ? 'border-ink-200' : CAL_HEAT_BORDER[i];
    // CL-13: a Sunday number on a strongly tinted day (3+ people) sits on a white chip (AA for 12 px text)
    const num = k.calNum + ' ' + (selected ? k.calNumSel : isToday ? k.calNumToday : sunday || holiday ? (i >= 3 ? k.calNumSundayTint : k.calNumSunday) : 'text-ink-700');
    const label = U.thaiDate(date) + (isToday ? ' (วันนี้)' : '') + (holiday ? ' · วันหยุด' + (ex.holiday ? ': ' + ex.holiday : '') : '') +
      (count === null ? ' — ยังไม่มีข้อมูล' : count ? ` — ลา ${count} คน` : ' — ไม่มีผู้ลา') + (said ? ' · ' + said : '');
    return `<button type="button" class="${k.calCell} ${bg} ${border}" ` +
        `data-date="${date}" data-count="${count === null ? '' : count}" aria-pressed="${selected ? 'true' : 'false'}"` +
        `${isToday ? ' aria-current="date" data-today="1"' : ''}${holiday ? ' data-holiday="1"' : ''} aria-label="${esc(label)}" title="${esc(label)}">` +
      (selected ? `<span class="${k.calSelFill}" data-cal-selected aria-hidden="true"></span>` : '') +
      `<span class="${num}">${Number(date.slice(8))}</span>` +
      // CL-13: below 360 px the cell shows only the number of people ("คน" is in the cell's label)
      (count ? `<span class="${selected ? k.calCountSel : k.calCount}">${count}<span class="max-[359px]:hidden"> คน</span></span>` : '') +
      (marks ? `<span class="${k.calMarks}" data-cal-marks aria-hidden="true">${marks}</span>` : '') +
    `</button>`;
  }

  /** Who is on leave on the selected date, when that date is in the month on screen. */
  function renderCalDayDetail(month) {
    const el = $('calDayDetail');
    const date = state.selectedDate;
    const muted = t => `<p class="text-[0.8125rem] leading-5 text-slate-500">${t}</p>`;
    if (U.monthKey(date) !== month) {
      setHtml(el, muted('แตะวันที่ในปฏิทินเพื่อดูรายชื่อผู้ลา'));
      return;
    }
    const title = `<p class="font-display text-sm font-medium leading-6 text-ink-900">${esc(U.thaiDate(date))}`;
    // R3 F-1: the selected day's holiday as its own line under the day header ("วันหยุด: <name>")
    const hol = calHolidays();
    const holLine = hol.has(date)
      ? `<p class="text-[0.8125rem] font-medium leading-5 text-coral-700 break-words" data-cal-holiday-line>${esc('วันหยุด' + (hol.get(date) ? ': ' + hol.get(date) : ''))}</p>`
      : '';
    if (!dayKnown(date)) {
      setHtml(el, title + '</p>' + holLine + muted('ยังไม่มีข้อมูลในเครื่อง'));
      return;
    }
    const lines = filteredLines(date);
    // CL-16: the day header says what the list below counts — mixed kinds on a line of their own, each part unbroken
    const mixed = lines.partial.length || lines.pending.length;
    const counts = mixed
      ? '</p><p class="text-[0.8125rem] font-medium leading-5 text-slate-600" data-cal-counts>' +
        leaveCountsText(lines).split(' · ').map(t => `<span class="whitespace-nowrap">${esc(t)}</span>`).join(' · ') + '</p>'
      : ` — <span data-cal-counts>ลา ${lines.absent.length} คน</span></p>`;
    setHtml(el, title + counts + holLine +
      (lines.absent.length + lines.partial.length + lines.pending.length ? linesHtml(lines) : muted('ไม่มีผู้ลา')));
  }

  /** Shows `month` at once (whatever is loaded) and fetches its missing days. */
  function showCalMonth(month) {
    if (!month) return;
    ui.calMonth = month;
    ui.calPlanMonth = '';   // R3 F-1: ask the plan for this month's holidays again (also on โหลดอีกครั้ง)
    renderLeaveCalendar();
    if (!state.session) return;
    const r = U.monthRange(month);
    track(ensureRange(r.from, r.to)).then(() => renderLeaveTab(), e => {
      renderLeaveTab();
      if (Api.isTransient(e)) scheduleRetry();
      handleError(e, { quiet: true });
    });
  }

  function onCalendarClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('.cal-day, [data-cal]') : null;
    if (!t) return;
    if (t.classList.contains('cal-day')) { spawn(() => setSelectedDate(t.dataset.date)); return; }
    const action = t.dataset.cal;
    if (action === 'prev' || action === 'next') showCalMonth(U.addMonths(calMonth(), action === 'next' ? 1 : -1));
    else if (action === 'retry') showCalMonth(calMonth());
    else if (action === 'today') {
      const today = U.todayStr();
      ui.calMonth = U.monthKey(today);
      spawn(() => setSelectedDate(today));
      renderLeaveTab();
    }
  }

  /* ---------- staff tab ---------- */
  /** รายชื่อบุคลากร: one list card per group; each row = avatar, name (+ tags) and labelled icon buttons. */
  function renderStaffTab() {
    renderImportCard();
    if (!isSup()) return;
    const k = Kit.cls;
    $('staffCountBadge').textContent = state.staff.length + ' คน';
    const me = myName();
    const action = (act, iconName, word, title, look, hidden) =>
      `<button type="button" data-action="${act}" class="${look}${hidden ? ' hidden' : ''}" title="${esc(title)}" aria-label="${esc(title)}"` +
      `${hidden ? ' disabled aria-hidden="true" style="display:none"' : ''}>${Kit.icon(iconName, 'w-5 h-5')}<span>${word}</span></button>`;
    // the Supervisor's row keeps the columns of the others: an empty slot where the delete button would be (Minor 4)
    const slot = `<span class="inline-block min-w-[52px] h-12" aria-hidden="true"></span>`;
    const block = (title, list) =>
      `<section class="space-y-2"><h3 class="flex items-center gap-2 px-1 font-display text-[0.8125rem] font-medium leading-5 tracking-wide text-ink-500">${esc(title)}<span class="${k.tag}">${list.length} คน</span></h3>` +
      (list.length
        ? `<div class="${k.list}">` + list.map(s => {
          const isSupRow = s.name === state.supervisor;
          const mine = s.name === me;
          return `<div class="staff-item flex items-center gap-3 pl-4 pr-2 py-2 min-h-[64px]" data-staff="${esc(s.name)}" data-group="${s.group}">` +
            Kit.avatar(s.name, 'sm') +
            `<div class="min-w-0 flex-1"><p class="text-sm font-medium leading-6 text-ink-900 break-words">${esc(s.name)}</p>` +
            (isSupRow || mine ? `<p class="flex flex-wrap gap-1 mt-0.5">` +
              (isSupRow ? `<span class="${k.pill} ${k.pillPending}">${Kit.icon('crown', 'w-3.5 h-3.5')}Supervisor</span>` : '') +
              (mine ? `<span class="${k.tagBrand}">คุณ</span>` : '') + '</p>' : '') +
            `</div>` +
            `<div class="flex items-center shrink-0">` +
              // every action names the person; "ย้าย" says where to; delete is neutral until its danger confirmation
              action('reset-password', 'key', 'รหัส', mine ? 'เปลี่ยนรหัสผ่านของฉัน' : 'ตั้งรหัสผ่านใหม่ของ ' + s.name, k.rowAction, false) +
              action('move', 'swap', s.group === 'backup' ? 'ไปประจำ' : 'ไปแทนเวร',
                'ย้าย ' + s.name + (s.group === 'backup' ? ' ไปคนประจำ' : ' ไปทีมแทนเวร'), k.rowAction + ' w-16', false) +   // one width for both labels: the columns line up
              (isSupRow ? slot : action('delete', 'trash', 'ลบ', 'ลบ ' + s.name, k.rowAction, false)) +
            `</div></div>`;
        }).join('') + '</div>'
        : `<div class="${k.card}"><p class="${k.textMeta} text-center">ยังไม่มีรายชื่อในกลุ่มนี้</p></div>`) +
      '</section>';
    const c = $('staffListContainer');
    setHtml(c, block('นักรังสีการแพทย์ประจำ', state.staff.filter(s => s.group === 'regular')) +
      block('ทีมแทนเวร', state.staff.filter(s => s.group === 'backup')));
    c.classList.toggle('opacity-60', ui.staffBusy);
    c.classList.toggle('pointer-events-none', ui.staffBusy);
    c.setAttribute('aria-busy', ui.staffBusy ? 'true' : 'false');
  }

  function legacyInfo() {
    const rs = lsGet('rad_schedules'), rst = lsGet('rad_staff');
    const key = (rs === null ? -1 : rs.length) + ':' + (rst === null ? -1 : rst.length);
    if (ui.legacyKey === key && ui.legacy) return ui.legacy;
    let days = 0, staffCount = 0;
    try { const o = rs ? JSON.parse(rs) : null; if (o && typeof o === 'object') days = Object.keys(o).filter(k => U.isValidYmd(k)).length; } catch (e) { /* corrupt */ }
    try {
      const o = rst ? JSON.parse(rst) : null;
      if (o && typeof o === 'object') staffCount = (Array.isArray(o.regular) ? o.regular.length : 0) + (Array.isArray(o.backup) ? o.backup.length : 0);
    } catch (e) { /* corrupt */ }
    ui.legacyKey = key;
    ui.legacy = { has: rs !== null || rst !== null, days, staffCount };
    return ui.legacy;
  }

  function renderImportCard() {
    const card = $('importCard');
    const info = legacyInfo();
    setVisible(card, isSup() && info.has);
    if (!isSup() || !info.has) return;
    $('importInfo').textContent =
      `พบข้อมูลจากแอปเวอร์ชันเดิมที่บันทึกไว้ในเครื่องนี้: ตารางเวร ${info.days} วัน` +
      (info.staffCount ? ` และรายชื่อ ${info.staffCount} คน` : '') +
      ' — กดนำเข้าเพื่อย้ายขึ้นระบบกลาง (Google Sheets) ให้ทุกคนเห็นข้อมูลเดียวกัน (รายชื่อใหม่จะได้รหัสผ่านเริ่มต้น 1234)';
    const res = $('importResult');
    setHtml(res, ui.importResult ? importResultHtml(ui.importResult) : '');
    setVisible(res, !!ui.importResult);
    setVisible($('clearLegacyBtn'), !!ui.importResult);
  }

  function importResultHtml(r) {
    const added = Array.isArray(r.addedStaff) ? r.addedStaff : [];
    const skipped = Array.isArray(r.skipped) ? r.skipped : [];
    let h = `<div class="flex items-center gap-1.5 font-semibold text-emerald-700">${Kit.icon('check-circle', 'w-4 h-4')}นำเข้าเรียบร้อย</div>` +
      `<div>• เพิ่มรายชื่อใหม่ ${added.length} คน${added.length ? ': ' + esc(added.join(', ')) : ''}</div>` +
      `<div>• ตารางเวร (Station/หมายเหตุ) ${r.daysWritten | 0} วัน</div>` +
      `<div>• บันทึกการลา ${r.leavesWritten | 0} รายการ</div>` +
      `<div>• นำผู้ลาออกจาก Station ที่มีอยู่แล้ว ${r.unassigned | 0} รายการ</div>`;
    if (skipped.length) {
      h += `<details><summary class="cursor-pointer min-h-[44px] flex items-center text-amber-800 font-semibold">ข้าม ${skipped.length} รายการ (แตะเพื่อดูเหตุผล)</summary>` +
        '<ul class="pl-4 list-disc text-slate-600">' + skipped.slice(0, 50).map(s => `<li>${esc(s)}</li>`).join('') +
        (skipped.length > 50 ? `<li>…และอีก ${skipped.length - 50} รายการ</li>` : '') + '</ul></details>';
    }
    return h;
  }

  /* ---------- summary tab ---------- */
  function renderStaffSelects() {
    const sig = state.staff.map(s => s.name).join('\n');
    if (ui.staffSig === sig) return;
    ui.staffSig = sig;
    fillSelect($('summaryTargetStaff'), `<option value="${ALL}">-- แสดงทั้งหมดทุกรายชื่อ --</option>` +
      state.staff.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join(''));
    fillSelect($('exportTargetStaff'), `<option value="${ALL}">-- ทุกคนรวมในไฟล์เดียว (ภาพรวมทั้งหมด) --</option>` +
      state.staff.map(s => `<option value="${esc(s.name)}">เฉพาะคุณ ${esc(s.name)}</option>`).join(''));
  }

  function fillSelect(sel, html) {
    const prev = sel.value;
    sel.innerHTML = html;
    if (prev && Array.prototype.some.call(sel.options, o => o.value === prev)) sel.value = prev;
  }

  function renderSummaryTab() {
    renderStaffSelects();
    renderPreview();
    renderCopiedStatus();
  }

  /**
   * The capture area (#captureArea, the picture staff post in LINE) for the selected date — reflects the draft if present.
   * Inline styles only (html2canvas); colours are the theme tokens. Each station row: label (the pastel station chip;
   * no "(ขาด N)" since 3.1.1 — the owner's call: the shortage is shown in the app, not in the posted picture) | the names.
   * Text stays at least 12 px with AA contrast (Minor 2).
   */
  const IMG_FONT = "font-family:'Mitr','Sarabun','Noto Sans Thai','Leelawadee UI','Thonburi',sans-serif;";
  function renderPreview() {
    const date = state.selectedDate;
    $('displayDate').textContent = 'ประจำ' + U.thaiDate(date);
    // R2: the shared picture never shows an unsaved proposal (only a draft the Supervisor made)
    const slots = state.user && !proposalActive(date) ? viewSlots(date) : storedSlots(date);
    const act = activeSet();
    setHtml($('resultStations'), U.STATIONS.map(st => {
      const arr = (slots[st.id] || []).filter(Boolean);
      // label | names on one line at the exported width; in a narrow preview the names wrap under the label.
      // 3.1.1 (owner, style C): every station chip fills the label column, so all chips have the same length, name centred
      return `<div style="display:flex; flex-wrap:wrap; align-items:flex-start; gap:4px 10px; padding:8px 10px; border-radius:16px; background:#FFFFFF; border:1.5px solid #FFE3EF;">` +
        `<div style="flex:0 0 auto; width:38%; min-width:134px; max-width:142px; display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding-top:1px;">` +
          `<span style="display:block; width:100%; box-sizing:border-box; text-align:center; padding:2px 10px; border-radius:12px; background:${st.bg}; color:${st.text}; ${IMG_FONT} font-size:13px; font-weight:500; line-height:20px;">${esc(st.name).replace('/', '/<wbr>')}</span></div>` +
        `<div style="flex:1 1 150px; min-width:0; display:flex; flex-wrap:wrap; gap:2px 12px; padding-top:1px;">` +
        (arr.length ? arr.map(a => `<span style="font-size:15px; font-weight:600; line-height:22px; color:#1A2C63;">${esc(nameLabel(a, act))}</span>`).join(' ')
          : '<span style="font-size:13px; line-height:22px; color:#64748b;">ยังไม่ได้จัดสรร</span>') +
        `</div></div>`;
    }).join(''));

    // absent people first (the count of the day), then partial-day absences with their time only (FIX-CL CL-10: the picture
    // is posted outside the app — a neutral "ลาบางช่วง", never the health-related type; pending requests are not leave days
    // and are not listed at all)
    const lines = leaveLines(date);
    // one table row per person (owner, 3.1.1): the status stands right after the names, in one aligned column, as plain
    // coloured text (no pill); #resultLeaves is display:table. In a narrow preview the status wraps inside its cell.
    const imgLine = (l, color, text, kind) => `<div style="display:table-row;"${kind ? ` data-img-leave="${kind}"` : ''}>` +
      `<span style="display:table-cell; vertical-align:top; padding:2px 16px 2px 0; font-weight:600; white-space:nowrap;"><span style="color:${color};">• </span>${esc(l.name)}</span>` +
      `<span style="display:table-cell; vertical-align:top; padding:2px 0; font-weight:600; color:${color};">${esc(text)}</span></div>`;
    setHtml($('resultLeaves'), lines.absent.length + lines.partial.length
      ? lines.absent.map(l => imgLine(l, '#B32A45', l.type + (l.rank ? ` (คนที่ ${l.rank})` : ''), '')).join('') +
        lines.partial.map(l => imgLine(l, '#116C99', 'ลาบางช่วง' + (l.info.timeText ? ' ' + l.info.timeText : ''), 'partial')).join('')
      : `<span style="color:#475569;">${esc(withDay('ไม่มีรายการลา', date))}</span>`);

    const rv = (state.user ? viewRemark(date) : '').trim();
    const rc = $('resultRemarkContainer');
    $('resultRemarkText').textContent = rv;
    rc.style.display = rv ? 'block' : 'none';
  }

  function renderCopiedStatus() {
    const c = state.clipboard;
    const st = $('copiedStatusText');
    setText(st, c
      ? `📋 คัดลอกข้อมูลของวันที่ ${U.thaiDateShort(c.fromDate)} ไว้แล้ว`
      : 'สถานะคลิปบอร์ด: ยังไม่มีข้อมูลที่คัดลอก');
    setVisible(st, !!c);   // without a copy, "วางข้อมูล" itself says so (Minor 12)
    renderDayTools();
  }

  /* ------------------------------------------------------------------ */
  /* handlers — date                                                     */
  /* ------------------------------------------------------------------ */
  /**
   * Selects `date` everywhere. → Promise<boolean>: true when `date` is the selected date afterwards. Unsaved station
   * edits of another date are only dropped after the user agreed (UiKit.confirm: a sheet, or window.confirm with
   * APP_CONFIG.NATIVE_DIALOGS). While that question is open the date inputs keep showing the current date and
   * further date changes are ignored (resolve false). Without that question everything happens synchronously.
   */
  async function setSelectedDate(date) {
    if (ui.dateAsking || !U.isValidYmd(date)) { renderDateInputs(); return false; }
    if (date === state.selectedDate) { renderDateInputs(); return true; }
    if (state.draft && state.draft.date !== date) {
      if (isDraftDirty()) {
        renderDateInputs();   // revert the input the user changed while the question is open
        const alive = sessionAlive();
        ui.dateAsking = true;
        let ok = false;
        try { ok = await confirmUser(MSG.discardDraft, { title: 'ทิ้งการแก้ไข?', okLabel: 'ทิ้งการแก้ไข', danger: true, icon: 'alert-triangle' }); }
        finally { if (alive()) ui.dateAsking = false; }   // a new session has its own flag (reset by closeSessionSheets)
        if (!ok || !alive()) { renderDateInputs(); return false; }
      }
      state.draft = null;
    }
    state.selectedDate = date;
    if (ui.dutyPatch && ui.dutyPatch.date !== date) ui.dutyPatch = null;   // R2: the patch belongs to the next save of its date
    ui.calMonth = U.monthKey(date);   // the leave calendar follows a date picked anywhere
    render();
    if (state.session) {
      const w = windowFor(date);
      track(ensureRange(w.from, w.to)).then(() => render(), e => {
        render();
        if (Api.isTransient(e)) scheduleRetry();   // the day shows "not loaded"; the header shows the connection
        handleError(e, { quiet: true });
      });
    }
    emit('date', { date });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* handlers — station                                                  */
  /* ------------------------------------------------------------------ */
  function onStationChange(e) {
    const sel = e.target && e.target.closest ? e.target.closest('.station-select') : null;
    if (!sel) return;
    const container = $('stationsContainer');
    container._html = null;   // force the DOM back in line with state
    const date = state.selectedDate;
    if (!canEditDay(date)) { renderStationTab(); return; }
    const st = U.stationById(sel.dataset.station);
    const idx = parseInt(sel.dataset.index, 10);
    if (!st || !(idx >= 0 && idx < viewSlots(date)[st.id].length)) { renderStationTab(); return; }
    const val = sel.value;
    if (val && !assignableSet(date).has(val)) { renderStationTab(); return; }
    const draft = ensureDraft(date);
    draft.assignments = viewSlots(date);   // the slots as shown (fitted to the current counts)
    if (val) {   // a person can hold only one slot
      U.STATIONS.forEach(s => {
        draft.assignments[s.id] = draft.assignments[s.id].map((n, i) => (n === val && !(s.id === st.id && i === idx) ? '' : n));
      });
    }
    draft.assignments[st.id][idx] = val;
    dropCleanDraft();
    renderStationTab();
    renderPreview();
  }

  function onRemarkInput() {
    const date = state.selectedDate;
    if (!canEditDay(date)) { renderRemark(); return; }
    const draft = ensureDraft(date);
    draft.remark = normRemark($('dailyRemark').value);
    dropCleanDraft();
    renderDraftBadge();
    renderPreview();
  }

  async function onSaveStation() {
    if (!requireInternet()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    await withBusy($('stationSaveBtn'), 'กำลังบันทึก…', saveSelectedDay);
  }

  /** Saves the station editor of the selected date. Resolves the saveDay response, or null if nothing was saved. */
  async function saveSelectedDay() {
    const date = state.selectedDate;
    if (!requireDayReady(date)) return null;
    const remark = viewRemark(date);
    if (remark.length > REMARK_MAX) { toast(`⚠️ หมายเหตุยาวได้ไม่เกิน ${REMARK_MAX} ตัวอักษร`); return null; }
    const assignments = compactSlots(viewSlots(date));
    const base = hasDraftFor(date) ? state.draft.baseVersion : currentVersion(date);
    return withDayLock(date, () => saveDayFlow(date, assignments, remark, base, '✅ บันทึกข้อมูลเรียบร้อย'));
  }

  /** Locks the date's station editor while a write of that day runs: edits made meanwhile would be lost. */
  async function withDayLock(date, fn) {
    const epoch = ui.epoch;
    ui.dayBusy = date;
    renderStationTab();
    try { return await fn(); }
    finally {
      if (epoch === ui.epoch && ui.dayBusy === date) ui.dayBusy = null;   // else reset by a logout / new login
      render();
    }
  }

  /** saveDay with the CONFLICT dialog (SPEC §6.6). Returns the response or null when nothing was saved. */
  async function saveDayFlow(date, assignments, remark, baseVersion, okMsg) {
    const alive = sessionAlive();
    // R2: a duty repair accepted in the proposal panel (core.station.setDutyPatch) goes with this save, in the same lock
    const patch = ui.dutyPatch && ui.dutyPatch.date === date && serverHas('plan') ? ui.dutyPatch.duty : null;
    const params = { date, assignments, remark, baseVersion };
    if (patch) params.duty = patch;
    let res;
    try {
      res = await userCall('saveDay', params);
    } catch (e) {
      if (!alive()) return null;
      if (!e || e.code !== 'CONFLICT') throw e;
      const details = e.details && typeof e.details === 'object' ? e.details : {};
      const serverDay = details.day ? details.day : null;
      if (patch) {
        if (ui.dutyPatch && ui.dutyPatch.date === date) ui.dutyPatch = null;   // a CONFLICT drops the patch
        if (Object.prototype.hasOwnProperty.call(details, 'duty') && (serverDay ? (parseInt(serverDay.version, 10) || 0) : 0) === (baseVersion | 0)) {
          // the day is as this draft knows it — the DUTY was changed on another device: nothing was written; the draft
          // stays, the plan data is refreshed and the Supervisor checks the repair again before saving
          const plan = use('plan');
          if (plan) {
            try { if (details.duty && typeof details.duty === 'object') plan.adoptDuty(details.duty); } catch (e2) { console.error('[core] adoptDuty failed:', e2); }
            if (typeof plan.refresh === 'function') spawn(() => plan.refresh(), { quiet: true });
          }
          render();
          toast('ตารางเวรของวันนี้เพิ่งถูกแก้จากเครื่องอื่น — ตรวจแล้วกดบันทึกอีกครั้ง', 5000);
          return null;
        }
      }
      // C-M3: in the app's own sheet the choice has Thai labels (overwrite = danger, focus starts on "load the latest");
      // window.confirm (native-dialog mode) keeps the old text with its OK / Cancel wording
      const overwrite = await confirmUser(nativeDialogs() ? MSG.conflict : conflictText(date), {
        title: 'ข้อมูลถูกแก้ไขจากเครื่องอื่น', okLabel: 'บันทึกทับ', cancelLabel: 'โหลดข้อมูลล่าสุด', danger: true, icon: 'alert-triangle'
      });
      if (!alive()) return null;   // the session ended while the question was open
      if (overwrite) {
        res = await userCall('saveDay', { date, assignments, remark, baseVersion: serverDay ? (parseInt(serverDay.version, 10) || 0) : 0 });
        spawn(() => refresh());
      } else {
        adoptDay(date, serverDay);
        if (hasDraftFor(date)) state.draft = null;
        delete state.audit[date];
        markTouched(date);
        persistCache();
        render();
        toast(withDay('🔄 โหลดข้อมูลล่าสุดของ', date, 'แล้ว'));
        spawn(() => refresh());
        return null;
      }
    }
    if (!alive()) return null;
    adoptDay(date, res.day);
    if (hasDraftFor(date)) state.draft = null;
    if (ui.dutyPatch && ui.dutyPatch.date === date) ui.dutyPatch = null;   // R2: saved (or not needed any more)
    if (patch && res.duty && typeof res.duty === 'object') {
      const plan = use('plan');
      try { if (plan) plan.adoptDuty(res.duty); } catch (e) { console.error('[core] adoptDuty failed:', e); }
    }
    delete state.audit[date];
    markTouched(date);
    persistCache();
    render();
    // a duty warning (R2: {kind, name, type}) is told in words like the day's own warnings (strings)
    const warnings = (Array.isArray(res.warnings) ? res.warnings : []).map(w => (typeof w === 'string' ? w
      : w && typeof w === 'object' && w.name ? w.name + ' มีวันลา' + (w.type ? ' (' + w.type + ')' : '') + (w.kind === 'mission' ? ' — ภารกิจพิเศษ' : w.kind === 'lunch' ? ' — เวรกลางวัน' : '') : ''))
      .filter(Boolean);
    const head = res.unchanged && !warnings.length ? okMsg + ' (ไม่มีการเปลี่ยนแปลง)' : okMsg;
    toast(warnings.length ? head + '\n⚠️ ' + warnings.join('\n⚠️ ') : head, warnings.length ? 5000 : 2200);
    // warnings = the server knows leaves this device has not seen yet: fetch the date again
    if (warnings.length) spawn(() => ensureRange(date, date, { force: true }), { quiet: true });
    return res;
  }

  function conflictText(date) {
    return withDay('ข้อมูลของ', date, ' ถูกแก้ไขจากเครื่องอื่นแล้ว') +
      '\nบันทึกทับด้วยข้อมูลของคุณ (การแก้ไขจากเครื่องอื่นจะหายไป) หรือโหลดข้อมูลล่าสุดมาดูก่อน?';
  }

  /* ------------------------------------------------------------------ */
  /* handlers — leave                                                    */
  /* ------------------------------------------------------------------ */
  /** A tap on a row of การลา (own row or the list): opens that person's leave sheet. */
  function onLeaveRowClick(e) {
    const row = e.target && e.target.closest ? e.target.closest('.leave-row[data-staff]') : null;
    if (row) openLeaveSheet(row.dataset.staff);
  }

  /**
   * A tap on an option tile of the leave sheet: picks it (บันทึก saves). Someone else's row (a forced click on a
   * locked sheet) is refused with the reason; without a network nothing can be saved, so the sheet closes. A doctor-visit
   * type (R1b) also needs a time range: the time step appears and keeps the current range when the type is unchanged.
   */
  function onLeaveOptionClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('.lv-chip') : null;
    if (!t || t.disabled) return;
    const sh = ui.leaveSheet;
    if (!sh || ui.leaveSaving || !state.user) return;
    const staff = t.dataset.staff;
    const val = t.dataset.val || '';
    if (staff !== sh.staff) return;
    if (sh.locked || !(isSup() || staff === myName())) { toast(MSG.ownLeaveOnly); closeConfirmLeave(); return; }
    if (!activeSet().has(staff)) return;
    const row = activeLeaves(sh.date)[staff];
    const cur = sheetCurrent(row);
    if (val !== '' && sheetTypes(cur.type).indexOf(val) < 0) return;
    if (!requireInternet()) { closeConfirmLeave(); return; }
    ui.leaveTime = null;
    ui.leaveTimeError = '';
    // back to what is saved (a doctor visit keeps its range) — for a rejected request ปกติ is a real pick (it removes the row)
    if (val === cur.type && !(val === '' && U.leaveStatus(row) === 'rejected')) ui.pendingLeave = null;
    else ui.pendingLeave = { staff, date: sh.date, type: val, detail: '' };
    renderLeaveSheet();
    if (U.isPartialType(val)) revealTimeStep();   // CL-12
  }

  /** R1b: the picked doctor-visit range changed to `detail` ('' = not valid yet). Equal to what is saved → nothing to save. */
  function setLeaveDetail(detail) {
    const sh = ui.leaveSheet;
    if (!sh || sh.locked || ui.leaveSaving) return;
    const cur = sheetCurrent(activeLeaves(sh.date)[sh.staff]);
    const pick = sheetPick(sh, cur);
    if (!U.isPartialType(pick.type)) return;
    ui.pendingLeave = pick.type === cur.type && detail && detail === cur.detail
      ? null : { staff: sh.staff, date: sh.date, type: pick.type, detail };
  }

  /** A preset chip of the time step. */
  function onLeaveTimePreset(e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-time]') : null;
    if (!b || b.disabled || !U.parseTimeRange(b.dataset.time)) return;
    ui.leaveTime = null;   // the inputs follow the preset
    ui.leaveTimeError = '';
    setLeaveDetail(U.parseTimeRange(b.dataset.time).value);
    renderLeaveSheet();
  }

  /**
   * The two time inputs (custom range). While typing the inputs are left alone (ui.leaveTime); the range counts once both
   * times are valid and start < end. The error shows when both are filled and they do not fit (or on a forced save).
   */
  function onLeaveTimeInput(e) {
    const sh = ui.leaveSheet;
    if (!sh || sh.locked || ui.leaveSaving) return;
    const start = $('leaveTimeStart').value, end = $('leaveTimeEnd').value;
    ui.leaveTime = { start, end };
    const pickType = sheetPick(sh, sheetCurrent(activeLeaves(sh.date)[sh.staff])).type;
    const err = U.validateTimeRange(start, end, pickType);   // within 08:00–16:00 and the morning / afternoon rule
    setLeaveDetail(err ? '' : U.joinTimeRange(start, end));
    ui.leaveTimeError = err && start && end ? err : '';   // a half-filled range only blocks บันทึก (asked again on a forced save)
    renderLeaveSheet();
  }

  function closeConfirmLeave() {
    if (ui.leaveSaving) return;
    ui.pendingLeave = null;
    ui.leaveSheet = null;
    ui.leaveTime = null;
    ui.leaveTimeError = '';
    hideModal('confirmLeaveModal');
  }

  async function onConfirmLeave() {
    const p = ui.pendingLeave;
    if (!p || ui.leaveSaving) return;
    if (U.isPartialType(p.type) && !U.parseTimeRange(p.detail)) {   // the button is disabled then; a forced click explains
      ui.leaveTimeError = U.validateTimeRange(($('leaveTimeStart') || {}).value, ($('leaveTimeEnd') || {}).value, p.type) || 'กรุณาเลือกช่วงเวลาที่ลา';
      renderLeaveSheet();
      return;
    }
    await submitLeave(p, 'save');
  }

  /**
   * The leave sheet's writes: บันทึก (the pick), and for the owner of a rejected request "ขอใหม่" (the same type again —
   * a new queue position) and "ลบคำขอ" (type ''). setLeave carries `detail` only for a doctor-visit type (only offered by
   * a server with 'leave2'). A VALIDATION refusal of a time range keeps the sheet open with the message under the times.
   */
  async function submitLeave(p, busyKey) {
    if (!p || ui.leaveSaving) return;
    if (!requireInternet()) { closeConfirmLeave(); return; }
    const btn = $('confirmLeaveBtn');
    const label = btn.textContent;
    const alive = sessionAlive();
    const base = draftBase();
    const params = { date: p.date, staff: p.staff, type: p.type };
    if (U.isPartialType(p.type)) params.detail = p.detail;
    ui.leaveSaving = true;
    ui.leaveBusy = busyKey;
    btn.disabled = true;
    if (busyKey === 'save') btn.textContent = 'กำลังบันทึก…';
    renderLeaveSheet();
    let res = null, err = null;
    try { res = await userCall('setLeave', params); }
    catch (e) { err = e; }
    finally {
      if (alive() || !ui.leaveSaving) {   // never end a save that the next session started meanwhile
        ui.leaveSaving = false;
        ui.leaveBusy = '';
        btn.disabled = false;
        btn.textContent = label;
      }
    }
    if (!alive()) { renderLeaveSheet(); return; }   // the next user's sheet (if open) decides its own button state
    if (err && err.code === 'VALIDATION' && params.detail !== undefined && isShown('confirmLeaveModal')) {
      ui.leaveTimeError = err.message;
      renderLeaveSheet();
      return;
    }
    closeConfirmLeave();
    if (err) throw err;
    applyLeaveWrite(res || {}, p, base);
    const st = U.leaveStatus(res && res.leave);
    toast(busyKey === 'delete' ? MSG.requestDeleted : busyKey === 'cancel' ? MSG.requestCancelled
      : st === 'pending' ? MSG.leaveRequested : MSG.leaveSaved, st === 'pending' ? 3500 : 2200);
  }

  /** R1b: the buttons of the status line (rejected: ขอใหม่ / ลบคำขอ; pending, Supervisor: อนุมัติ / ไม่อนุมัติ). */
  function onLeaveSheetAction(e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-leave-act]') : null;
    const sh = ui.leaveSheet;
    if (!b || b.disabled || !sh || ui.leaveSaving || !state.user) return;
    const leave = activeLeaves(sh.date)[sh.staff];
    const act = b.dataset.leaveAct;
    if (act === 'approved' || act === 'rejected') { spawn(() => decideFromSheet(act), WRITE); return; }
    // CL-18: the owner of a pending request cancels it from its status box
    if (act === 'cancel') {
      if (!leave || U.leaveStatus(leave) !== 'pending' || sh.staff !== myName() || sh.locked) return;
      spawn(() => submitLeave({ staff: sh.staff, date: sh.date, type: '', detail: '' }, 'cancel'), WRITE);
      return;
    }
    if (!leave || U.leaveStatus(leave) !== 'rejected' || sh.staff !== myName() || sh.locked) return;
    const p = act === 'rerequest' ? { staff: sh.staff, date: sh.date, type: leave.type, detail: leave.detail || '' }
      : act === 'delete' ? { staff: sh.staff, date: sh.date, type: '', detail: '' } : null;
    if (p) spawn(() => submitLeave(p, act), WRITE);
  }

  /**
   * The Supervisor's อนุมัติ / ไม่อนุมัติ on a pending vacation: calls the provider of 'leave.decide' (feature "approval")
   * with {date, staff, decision, leave}. The provider sends decideLeave (asking for the optional reason first), shows the
   * result toast and resolves the server's answer {leave, day} — applied here — or a falsy value when the user cancelled.
   * A rejection is shown by the usual error handling; the sheet stays open then.
   * While the provider asks its own question the sheet is only locked (buttons disabled); the pressed button says
   * "กำลังบันทึก…" once the provider calls req.onSending() — right before its request goes out.
   */
  async function decideFromSheet(decision) {
    const sh = ui.leaveSheet;
    const fn = use('leave.decide');
    if (!sh || ui.leaveSaving || typeof fn !== 'function' || !isSup()) return;
    const leave = activeLeaves(sh.date)[sh.staff];
    if (!leave || U.leaveStatus(leave) !== 'pending') return;
    if (!requireInternet()) return;
    const alive = sessionAlive();
    const base = draftBase();
    const at = { date: sh.date, staff: sh.staff };
    ui.leaveSaving = true;
    ui.leaveBusy = '';
    renderLeaveSheet();
    const onSending = () => {
      if (!alive() || !ui.leaveSaving || ui.leaveSheet !== sh) return;
      ui.leaveBusy = decision;
      renderLeaveSheet();
    };
    let res = null, err = null;
    try { res = await fn({ date: at.date, staff: at.staff, decision, leave: cloneJson(leave), onSending }, core); }
    catch (e) { err = e; }
    finally {
      if (alive()) { ui.leaveSaving = false; ui.leaveBusy = ''; }
    }
    if (!alive()) return;
    if (err) { renderLeaveSheet(); refocusSheetAction(decision); throw err; }
    if (!res) { renderLeaveSheet(); refocusSheetAction(decision); return; }   // cancelled (e.g. the reason prompt)
    if (typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'leave')) applyLeaveWrite(res, at, base);
    if (ui.leaveSheet && ui.leaveSheet.staff === at.staff && ui.leaveSheet.date === at.date) closeConfirmLeave();
  }

  /** CL-15: a cancelled / failed decision returns the focus to its button (the dialog closed while the sheet was locked). */
  function refocusSheetAction(key) {
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && a !== $('confirmLeaveTitle')) return;
    const b = document.querySelector('#confirmLeaveText [data-leave-act="' + key + '"]');
    if (b && !b.disabled) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }

  /**
   * Applies the answer of a leave write — setLeave or decideLeave: {leave: LeaveV3 | v2 leave | null, day} — to the state
   * (also core.applyLeaveResult for feature files): the row of (date, staff) is replaced or removed, an auto-unassigned
   * day is adopted, a person who is now ABSENT leaves the Supervisor's unsaved draft (base: draftBase() from before the
   * call, so the draft can move onto the new version, CON-1), state.requests follows, the date counts as written locally.
   * at: {date, staff} of the request (used when the answer has no leave). → true when applied.
   */
  function applyLeaveWrite(res, at, base) {
    if (!state.session) return false;
    const r = res && typeof res === 'object' ? res : {};
    const leave = r.leave && typeof r.leave === 'object' && r.leave.type ? r.leave : null;
    const date = leave && U.isValidYmd(leave.date) ? leave.date : at && at.date;
    const staff = (leave && leave.staff) || (at && at.staff);
    if (!U.isValidYmd(date) || typeof staff !== 'string' || !staff) return false;
    const day = r.day && typeof r.day === 'object' ? r.day : null;
    const view = dayView(date);
    if (view !== 'ready') {
      // CL-2: the date is not loaded (or only from the offline copy): it must not count as loaded with just this row. The
      // write waits in ui.unloadedWrites and is laid over the next answer for that date; an offline copy shows it meanwhile.
      ui.writeSeq++;
      const parked = ui.unloadedWrites[date] = ui.unloadedWrites[date] || nameMap();
      const prev = parked[staff];
      // rule 3 of replayUnloadedWrites: a later write without a day keeps the day an earlier write brought
      const keepDay = !day && prev && prev.day ? prev.day : day && prev && prev.day && (prev.day.version | 0) > (day.version | 0) ? prev.day : day;
      parked[staff] = { seq: ui.writeSeq, leave, day: keepDay };
      if (view === 'cached') {
        putLeaveRow(date, staff, leave);
        if (day && (day.version | 0) >= currentVersion(date)) adoptDay(date, day);
      }
      if (ui.serverMode === 'v3') updateRequestFor(date, staff, leave);
      delete state.audit[date];
      emit('data', { date, local: true });
      persistCache();
      render();
      return true;
    }
    const b = base || draftBase();   // CL-1: before the day is replaced — the inbox and a CONFLICT answer pass no base
    putLeaveRow(date, staff, leave);
    // never an older day than the local one (two decisions whose answers arrive in reverse order — reviewer 2 finding 6)
    if (day && (day.version | 0) >= currentVersion(date)) adoptDay(date, day);
    // the server takes an absent person off the day (answering `day`) — except when approving a request dated before today
    // (Code.gs 3.0 BK-7: history is kept, no `day`): then the draft keeps the person too
    if (U.isAbsent(leave) && hasDraftFor(date) && (day || date >= U.todayStr())) {
      removeFromDraft(staff);
      rebaseDraft(staff, b);
    }
    if (ui.serverMode === 'v3') updateRequestFor(date, staff, leave);
    delete state.audit[date];
    markTouched(date);
    persistCache();
    render();
    return true;
  }

  async function onSummary() {
    const from = $('summaryStartDate').value, to = $('summaryEndDate').value;
    const box = $('leaveSummaryContent');
    const fail = msg => setHtml(box, `<p class="${Kit.cls.banner} ${Kit.cls.bannerDanger}">${Kit.icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(msg)}</span></p>`);
    if (!state.user) return;
    if (!from || !to || !U.isValidYmd(from) || !U.isValidYmd(to)) { fail('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด'); return; }
    if (from > to) { fail('วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด'); return; }
    if (U.daysBetweenInclusive(from, to) > MAX_REPORT_DAYS) { fail('ช่วงเวลาต้องไม่เกิน 2 ปี'); return; }
    const pick = isSup() ? $('summaryTargetStaff').value : myName();
    const alive = sessionAlive();
    setHtml(box, Kit.skeleton(3));
    let note = '';
    await withBusy($('summaryBtn'), 'กำลังโหลด…', async () => {
      // always refetch: the range may have been loaded long ago and changed on other devices since
      try { await ensureRange(from, to, { force: true }); }
      catch (e) {
        if (Api.isTransient(e)) note = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — แสดงเฉพาะข้อมูลที่มีในเครื่อง อาจไม่ครบถ้วน';
        else if (isSessionError(e)) return;
        else { setHtml(box, ''); throw e; }
      }
      if (!alive()) return;
      const people = reportStaff(from, to).filter(s => !pick || pick === ALL || s.name === pick);
      setHtml(box, leaveSummaryHtml(from, to, people, note));
      toast('📊 โหลดสรุปวันลาสำเร็จ');
    });
  }

  /**
   * people: [{name, group}] (reportStaff) — the summary lists their leave dates by type. Only ABSENT days count in "รวม N
   * วัน" (R1b); doctor visits (with their times) and pending requests follow as their own lines; rejected rows are ignored.
   */
  function leaveSummaryHtml(from, to, people, note) {
    const k = Kit.cls;
    const byName = new Map(people.map(s => [s.name, nameMap()]));
    const extras = new Map(people.map(s => [s.name, { partial: nameMap(), pending: nameMap() }]));
    U.eachDate(from, to).forEach(date => {
      const day = leavesOn(date);
      Object.keys(day).forEach(name => {
        const l = day[name], types = byName.get(name);
        if (!types || !l || !l.type) return;
        const info = U.leaveInfo(l);
        if (info.blocking) (types[l.type] = types[l.type] || []).push(date);
        else if (info.partial || info.pending) {
          const bag = extras.get(name)[info.partial ? 'partial' : 'pending'];
          (bag[l.type] = bag[l.type] || []).push(U.thaiDateShort(date) + (info.timeLabel ? ' ' + info.timeLabel : ''));
        }
      });
    });
    const typeRank = t => { const i = U.LEAVE_TYPES.indexOf(t); return i < 0 ? 99 : i; };
    let any = false;
    let html = '<div class="space-y-2.5">';
    people.forEach(s => {
      const dates = byName.get(s.name);
      const types = Object.keys(dates).sort((a, b) => typeRank(a) - typeRank(b));
      const ex = extras.get(s.name);
      const partialTypes = Object.keys(ex.partial).sort((a, b) => typeRank(a) - typeRank(b));
      const pendingTypes = Object.keys(ex.pending).sort((a, b) => typeRank(a) - typeRank(b));
      if (!types.length && !partialTypes.length && !pendingTypes.length) return;
      any = true;
      const total = types.reduce((n, t) => n + dates[t].length, 0);
      const extraLine = (t, list, tone, prefix, kind) => `<div class="text-[0.8125rem] leading-5" data-summary-extra="${kind}">` +
        `<span class="font-semibold ${tone}">${esc(prefix + t)}</span>` +
        ` <span class="text-slate-500">(${list.length} ครั้ง):</span> <span class="text-slate-600 break-words">${list.map(esc).join(', ')}</span></div>`;
      html += `<div class="rounded-2xl border-2 border-ink-100 bg-white p-3 space-y-2" data-summary-staff="${esc(s.name)}">` +
        `<div class="flex items-center gap-2.5 min-w-0">${Kit.avatar(s.name, 'sm')}` +
        `<span class="min-w-0 flex-1 font-medium text-ink-900 break-words">${esc(personLabel(s))}</span>` +
        `<span class="${k.pill} ${k.pillNeutral}">รวม ${total} วัน</span></div>` +
        '<div class="space-y-1.5">' +
        types.map(t => `<div class="text-[0.8125rem] leading-5"><span class="font-semibold text-coral-700">${esc(t)}</span>` +
          ` <span class="text-slate-500">(${dates[t].length} ครั้ง):</span> <span class="text-slate-600 break-words">${dates[t].map(d => esc(U.thaiDateShort(d))).join(', ')}</span></div>`).join('') +
        partialTypes.map(t => extraLine(t, ex.partial[t], 'text-accent-800', '', 'partial')).join('') +
        pendingTypes.map(t => extraLine(t, ex.pending[t], 'text-amber-800', 'รออนุมัติ: ', 'pending')).join('') +
        '</div></div>';
    });
    if (!any) html += `<p class="text-[0.8125rem] leading-5 text-slate-500 text-center py-2">ไม่มีประวัติการลาในช่วงเวลาดังกล่าว</p>`;
    if (note) html += `<p class="${k.banner} ${k.bannerWarn} text-[0.8125rem] leading-5">${Kit.icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5')}<span>${esc(note)}</span></p>`;
    return html + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* handlers — staff management                                         */
  /* ------------------------------------------------------------------ */
  function applyStaffResult(res) {
    ui.staffSeq++;   // a getData that started before this write must not bring the old list / role back
    applyServerInfo(null, res && res.supervisor, res && res.staff);
    persistCache();
    render();
  }

  async function staffOp(fn) {
    if (ui.staffBusy) return;
    const epoch = ui.epoch;
    ui.staffBusy = true;
    renderStaffTab();
    try { await fn(); }
    finally {
      if (epoch === ui.epoch) ui.staffBusy = false;   // else a logout / new login already reset it
      renderStaffTab();
    }
  }

  async function onAddStaff() {
    if (!requireInternet()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    const raw = $('newStaffName').value;
    const err = U.validateName(raw);
    if (err) { toast('⚠️ ' + err); return; }
    const name = U.normalizeName(raw);
    const pass = $('newStaffPass').value.trim();
    if (pass) { const pe = U.validatePassword(pass); if (pe) { toast('⚠️ ' + pe); return; } }
    if (state.staff.some(s => s.name === name)) { toast('⚠️ มีชื่อนี้ในระบบแล้ว'); return; }
    const checked = document.querySelector('input[name="newStaffGroup"]:checked');
    const group = checked && checked.value === 'backup' ? 'backup' : 'regular';
    const alive = sessionAlive();
    await withBusy($('addStaffBtn'), 'กำลังเพิ่ม…', async () => {
      const res = await userCall('addStaff', { name, group, password: pass });
      if (!alive()) return;
      applyStaffResult(res);
      $('newStaffName').value = '';
      $('newStaffPass').value = '';
      toast(`✅ เพิ่ม "${name}" เรียบร้อย (ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก)`);
    });
  }

  function onStaffListClick(e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!btn || btn.disabled) return;
    const item = btn.closest('.staff-item');
    if (!item) return;
    const name = item.dataset.staff;
    if (!isSup()) { toast(MSG.supOnly); return; }
    if (!state.staff.some(s => s.name === name)) return;
    switch (btn.dataset.action) {
      case 'reset-password': spawn(() => resetPasswordFlow(name), WRITE); break;
      case 'move': spawn(() => moveStaffFlow(name), WRITE); break;
      case 'delete': spawn(() => deleteStaffFlow(name), WRITE); break;
      default: break;
    }
  }

  async function resetPasswordFlow(name) {
    if (name === myName()) { openPasswordModal(false); return; }
    if (!requireInternet()) return;
    const alive = sessionAlive();
    const ans = await promptUser(`ตั้งรหัสผ่านใหม่ให้คุณ "${name}"`, undefined, {
      title: 'ตั้งรหัสผ่านใหม่', okLabel: 'ตั้งรหัสผ่าน', hint: 'ถ้าเว้นว่างไว้ รหัสผ่านเริ่มต้นคือ 1234', nativeHint: 'เว้นว่าง = 1234'
    });
    if (ans === null || ans === undefined || !alive()) return;
    const np = String(ans).trim();   // (the prompt's helper text says that empty = 1234)
    if (np) { const pe = U.validatePassword(np); if (pe) { toast('⚠️ ' + pe); return; } }
    await staffOp(async () => {
      await userCall('resetPassword', { name, newPassword: np });
      if (!alive()) return;
      toast(`🔑 ตั้งรหัสผ่านใหม่ให้ "${name}" แล้ว${np ? '' : ' (1234)'} — ต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งถัดไป`, 3500);
    });
  }

  async function moveStaffFlow(name) {
    if (!requireInternet()) return;
    const alive = sessionAlive();
    await staffOp(async () => {
      const res = await userCall('moveStaff', { name });
      if (!alive()) return;
      applyStaffResult(res);
      const s = state.staff.find(x => x.name === name);
      toast(`↔️ ย้าย "${name}" ไปกลุ่ม${groupLabel(s ? s.group : '')}แล้ว`);
    });
  }

  async function deleteStaffFlow(name) {
    if (!requireInternet()) return;
    if (name === state.supervisor) { toast('⚠️ ไม่สามารถลบ Supervisor ได้ กรุณาโอนสิทธิ์ให้ผู้อื่นก่อน'); return; }
    const alive = sessionAlive();
    if (!(await confirmUser(`ต้องการลบ "${name}" ออกจากระบบใช่หรือไม่?`, { title: 'ลบรายชื่อ', okLabel: 'ลบ', danger: true, icon: 'trash' }))) return;
    if (!alive()) return;
    let base = null, deleted = false;
    await staffOp(async () => {
      base = draftBase();
      const res = await userCall('deleteStaff', { name });
      if (!alive()) return;
      // the server removes the name from today's and future days only; a past day keeps it (history)
      if (state.draft && state.draft.date >= U.todayStr()) removeFromDraft(name);
      applyStaffResult(res);
      state.audit = {};
      deleted = true;
      toast(`🗑️ ลบ "${name}" แล้ว`);
    });
    if (!deleted) return;
    await refresh({ restart: true });   // pull the cleaned future stations/leaves
    rebaseDraft(name, base);
  }

  function openTransferModal() {
    if (!isSup()) { toast(MSG.supOnly); return; }
    const sel = $('transferTargetSelect');
    sel.innerHTML = '<option value="">-- เลือกผู้รับสิทธิ์ --</option>' +
      state.staff.filter(s => s.name !== myName()).map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    renderTransferBtn();
    showModal('transferModal');
  }

  /** C-M7: the confirm button names the person ("โอนสิทธิ์ให้ {ชื่อ}", danger tone). */
  function renderTransferBtn() {
    const btn = $('transferConfirmBtn'), sel = $('transferTargetSelect');
    if (!btn || !sel || btn.dataset.busy === '1') return;
    setHtml(btn, `<span class="truncate">${esc(sel.value ? 'โอนสิทธิ์ให้ ' + sel.value : 'โอนสิทธิ์')}</span>`);
  }

  async function onTransfer() {
    if (!requireInternet()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    const target = $('transferTargetSelect').value;
    if (!target) { toast('⚠️ กรุณาเลือกผู้รับสิทธิ์ก่อน'); return; }
    const alive = sessionAlive();
    await withBusy($('transferConfirmBtn'), 'กำลังโอน…', async () => {
      if (!(await settleDraftBeforeTransfer(alive)) || !alive()) return;
      let res;
      try { res = await userCall('transferSupervisor', { target }); }
      catch (e) {
        if (e.code !== 'FORBIDDEN') throw e;
        // Not the supervisor (any more). A retried transfer whose first attempt went through is refused like
        // this too, so look at the server's state before calling it a failure.
        await refresh({ restart: true });
        if (!alive()) return;
        if (state.supervisor !== target) { toast(e.message); return; }
        res = { supervisor: target, staff: state.staff };
      }
      if (!alive()) return;
      hideModal('transferModal');
      state.audit = {};
      applyStaffResult({ supervisor: (res && res.supervisor) || target, staff: res && res.staff });
      toast(`👑 โอนสิทธิ์ Supervisor ให้คุณ "${state.supervisor}" สำเร็จ (คุณกลายเป็น Staff แล้ว)`, 3500);
    });
  }

  /** After a transfer this device can no longer save, so a dirty draft is saved first or knowingly discarded. */
  async function settleDraftBeforeTransfer(alive) {
    if (!isDraftDirty()) return true;
    const saveFirst = await confirmUser(nativeDialogs() ? MSG.transferSaveFirst : MSG.transferSaveFirstSheet,
      { title: 'โอนสิทธิ์ Supervisor', okLabel: 'บันทึกแล้วโอนสิทธิ์', cancelLabel: 'ไม่บันทึก' });
    if (!alive()) return false;
    if (saveFirst) return !!(await saveSelectedDay());
    const discard = await confirmUser(MSG.transferDiscard, { title: 'ทิ้งการแก้ไข?', okLabel: 'ทิ้งการแก้ไข', danger: true, icon: 'alert-triangle' });
    return discard && alive();
  }

  /* ---------- legacy import ---------- */
  function buildImportPayload() {
    const staff = { regular: [], backup: [] };
    const rst = lsGetJson('rad_staff');
    if (rst && typeof rst === 'object') {
      ['regular', 'backup'].forEach(g => { if (Array.isArray(rst[g])) staff[g] = rst[g].filter(n => typeof n === 'string'); });
    }
    const schedules = {};
    const rs = lsGetJson('rad_schedules');
    if (rs && typeof rs === 'object') {
      Object.keys(rs).forEach(date => {
        const d = rs[date];
        if (!d || typeof d !== 'object') return;
        schedules[date] = {   // history[] (old device-local audit) is dropped on purpose
          leaves: d.leaves && typeof d.leaves === 'object' ? d.leaves : {},
          assignments: d.assignments && typeof d.assignments === 'object' ? d.assignments : {},
          remark: typeof d.remark === 'string' ? d.remark : ''
        };
      });
    }
    return { staff, schedules };
  }

  async function onImport() {
    if (!requireInternet()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    if (!legacyInfo().has) { toast('ไม่พบข้อมูลเดิมในเครื่องนี้'); return; }
    const payload = buildImportPayload();
    const overwrite = !!$('importOverwrite').checked;
    const alive = sessionAlive();
    await withBusy($('importBtn'), 'กำลังนำเข้า…', async () => {
      const res = await userCall('importLocal', { payload, overwrite }, { timeoutMs: 180000 });
      if (!alive()) return;
      ui.importResult = res || {};
      state.loaded.length = 0;   // many dates changed server-side: refetch on demand
      state.audit = {};
      render();
      toast('✅ นำเข้าข้อมูลสำเร็จ');
      await refresh({ restart: true });   // a refresh started before the import would bring pre-import data
    });
  }

  async function onClearLegacy() {
    const alive = sessionAlive();
    if (!(await confirmUser('ต้องการลบข้อมูลของแอปเวอร์ชันเดิมที่เก็บในเครื่องนี้ใช่หรือไม่? (ข้อมูลบนระบบกลางจะไม่ถูกลบ)', { title: 'ลบข้อมูลเดิม', okLabel: 'ลบ', danger: true, icon: 'trash' }))) return;
    if (!alive() || !isSup()) return;   // asked in another session: nobody confirmed it in this one
    LEGACY_KEYS.forEach(lsRemove);
    ui.importResult = null;
    ui.legacyKey = null;
    ui.legacy = null;
    render();
    toast('🧹 ลบข้อมูลเดิมในเครื่องนี้แล้ว');
  }

  /* ------------------------------------------------------------------ */
  /* handlers — summary / export / clipboard / images                    */
  /* ------------------------------------------------------------------ */
  async function onExport() {
    if (!isSup()) { toast(MSG.supOnly); return; }
    const from = $('exportStartDate').value, to = $('exportEndDate').value;
    const target = $('exportTargetStaff').value || ALL;
    if (!from || !to || !U.isValidYmd(from) || !U.isValidYmd(to)) { toast('⚠️ กรุณาเลือกช่วงเวลาเริ่มต้นและสิ้นสุด'); return; }
    if (from > to) { toast('⚠️ วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด'); return; }
    if (U.daysBetweenInclusive(from, to) > MAX_REPORT_DAYS) { toast('⚠️ ช่วงเวลาต้องไม่เกิน 2 ปี'); return; }
    const alive = sessionAlive();
    await withBusy($('exportBtn'), 'กำลังเตรียมไฟล์…', async () => {
      await ensureRange(from, to, { force: true });   // a report must not reuse a range loaded long ago
      if (!alive()) return;
      const list = reportStaff(from, to).filter(s => target === ALL || s.name === target);
      if (!list.length) { toast('⚠️ ไม่พบรายชื่อที่เลือก'); return; }
      const csv = U.buildCsv(buildExportRows(from, to, list));
      const filename = `รายงานเวร-และวันลา_${target === ALL ? 'ทั้งหมด' : target}_${from}_ถึง_${to}.csv`;
      if (await saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename)) toast('📥 ดาวน์โหลดรายงานสำเร็จ');
    });
  }

  /**
   * The CSV's สถานะการลา (R1b): an absent day = the type; a doctor visit = "ลาหาหมอตอนเช้า 09:00-11:00"; a pending request
   * = "พักร้อน (รออนุมัติ)"; no row or a rejected one = "ปกติ".
   */
  function csvLeave(l) {
    const info = U.leaveInfo(l);
    if (info.blocking) return info.type;
    if (info.partial) return info.type + (info.start ? ' ' + info.start + '-' + info.end : '');
    if (info.pending) return info.type + ' (รออนุมัติ)';
    return 'ปกติ';
  }

  /** list: [{name, group}] from reportStaff. '—' marks "no station" (a plain '-' would be read as a formula). */
  function buildExportRows(from, to, list) {
    const rows = [['วันที่', 'ชื่อ', 'กลุ่ม', 'สถานะการลา', 'Station ที่ปฏิบัติงาน', 'หมายเหตุประจำวัน']];
    U.eachDate(from, to).forEach(date => {
      const day = state.days[date];
      const leaves = leavesOn(date);
      const remark = day ? day.remark : '';
      list.forEach(s => {
        const l = leaves[s.name];
        const stations = day ? U.STATIONS.filter(st => day.assignments[st.id].indexOf(s.name) >= 0).map(st => st.name) : [];
        rows.push([date, personLabel(s), groupLabel(s.group), csvLeave(l), stations.length ? stations.join(' / ') : '—', remark]);
      });
    });
    return rows;
  }

  /**
   * Saves a generated file. A home-screen app on iOS cannot download blobs reliably, so there (when the
   * system can share files) the share sheet is offered instead; a failed share falls back to a download.
   * Resolves true when the caller's success message applies (not after a cancel or a fallback, which
   * already has its own toast).
   */
  async function saveFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (window.navigator.standalone === true && canShareFile(file)) {
      const shared = await shareFile(file, { title: filename });
      if (shared !== 'failed') return shared === 'shared';
      downloadBlob(blob, filename);
      return false;
    }
    downloadBlob(blob, filename);
    return true;
  }

  function canShareFile(file) {
    return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] });
  }

  /** → 'shared' | 'cancelled' | 'failed' (then a toast says the file is downloaded instead). */
  async function shareFile(file, extra) {
    try {
      await navigator.share(Object.assign({ files: [file] }, extra));
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      toast(MSG.shareFailed, 3500);
      return 'failed';
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, BLOB_URL_TTL_MS);
  }

  function onCopyDay() {
    if (!isSup()) { toast(MSG.supOnly); return; }
    const date = state.selectedDate;
    if (dayView(date) !== 'ready') { toast(msgNotLoaded(date)); return; }   // an unloaded day would copy as empty
    // R2 FIX I-3: an untouched proposal is not the Supervisor's choice — the saved day is copied (a draft is, as before)
    state.clipboard = { fromDate: date, assignments: compactSlots(proposalActive(date) ? storedSlots(date) : viewSlots(date)), remark: viewRemark(date) };
    renderCopiedStatus();
    toast(`📋 คัดลอกข้อมูลของวันที่ ${U.thaiDateShort(date)} แล้ว`);
  }

  async function onPasteDay() {
    if (!requireInternet()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    const clip = state.clipboard;
    if (!clip) { toast('⚠️ ยังไม่มีข้อมูลที่ถูกคัดลอก กรุณากดคัดลอกก่อน'); return; }
    const date = state.selectedDate;
    if (!requireDayReady(date)) return;
    const alive = sessionAlive();
    // the question always names the day (C-M2): "วันนี้ (25 พ.ย. 2569)" or "วันที่ 25 พ.ย. 2569"
    const today = date === U.todayStr();
    const target = today ? `วันนี้ (${U.thaiDateShort(date)})` : `วันที่ ${U.thaiDateShort(date)}`;
    if (!(await confirmUser(`ต้องการวางข้อมูลตารางเวรและหมายเหตุของวันที่ ${U.thaiDateShort(clip.fromDate)} ลงใน${target} ใช่หรือไม่? ` +
      `(สถานะวันลาของ${today ? 'วันนี้' : 'วันนั้น'}จะยังคงอยู่ตามเดิม)`, { title: 'วางข้อมูลลง' + dayRef(date), okLabel: 'วางข้อมูล' }))) return;
    if (!alive() || state.selectedDate !== date || !isSup() || !requireDayReady(date)) return;   // changed while the question was open
    // keep only people the target day may hold, not on leave that date, each person once, within capacity
    // (the server's rule: the required count, or the number already saved there when that is larger)
    const allowed = assignableSet(date);
    const onLeave = absentLeaves(date);   // R1b: a doctor visit or a pending request does not stop a paste
    const used = new Set();
    const assignments = {};
    U.STATIONS.forEach(st => {
      const cap = slotCount(date, st.id);
      assignments[st.id] = [];
      ((clip.assignments && clip.assignments[st.id]) || []).forEach(n => {
        if (allowed.has(n) && !onLeave[n] && !used.has(n) && assignments[st.id].length < cap) {
          used.add(n);
          assignments[st.id].push(n);
        }
      });
    });
    const remark = normRemark(clip.remark).slice(0, REMARK_MAX);
    await withBusy($('pasteDayBtn'), 'กำลังวาง…', () => withDayLock(date, () =>
      saveDayFlow(date, assignments, remark, currentVersion(date), withDay('📌 วางข้อมูลลง', date, ' สำเร็จ'))));
  }

  async function onClearDay() {
    if (!requireInternet()) return;
    if (!isSup()) { toast('⚠️ เฉพาะ Supervisor เท่านั้นที่ล้างข้อมูลได้'); return; }
    const date = state.selectedDate;
    if (!requireDayReady(date)) return;
    const alive = sessionAlive();
    // a destructive question always names the day (C-M2)
    const day = date === U.todayStr() ? `วันนี้ (${U.thaiDateShort(date)})` : `วันที่ ${U.thaiDateShort(date)}`;
    if (!(await confirmUser(`ต้องการล้างข้อมูลการจัดเวร การลา และหมายเหตุของ${day} ทั้งหมดใช่หรือไม่?`,
      { title: 'ล้างข้อมูล' + dayRef(date), okLabel: 'ล้างข้อมูล', danger: true, icon: 'trash' }))) return;
    if (!alive() || state.selectedDate !== date || !isSup() || !requireDayReady(date)) return;   // changed while the question was open
    await withBusy($('clearDayBtn'), 'กำลังล้าง…', () => withDayLock(date, async () => {
      const res = await userCall('clearDay', { date });
      if (!alive()) return;
      adoptDay(date, res && res.day);   // the emptied row keeps counting versions (A3); null = the date had no row
      delete state.leaves[date];
      if (hasDraftFor(date)) state.draft = null;
      delete state.audit[date];
      markTouched(date);
      persistCache();
      render();
      toast('🗑️ ล้างข้อมูลเรียบร้อย');
    }));
  }

  let html2canvasLoading = null;

  /**
   * html2canvas (≈200 KB) is loaded on the first image save/share instead of with the page. A failed load
   * is forgotten, so the next tap tries again.
   */
  function loadHtml2canvas() {
    if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
    if (!html2canvasLoading) {
      html2canvasLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.integrity = HTML2CANVAS_SRI;   // checked by the browser; a CORS answer is required (sw.js precaches it in CORS mode)
        s.crossOrigin = 'anonymous';
        s.src = HTML2CANVAS_URL;
        s.onload = () => (typeof window.html2canvas === 'function' ? resolve(window.html2canvas) : reject(new Error('html2canvas missing')));
        s.onerror = () => { s.remove(); reject(new Error('html2canvas did not load')); };
        document.head.appendChild(s);
      }).catch(e => {
        html2canvasLoading = null;
        throw e;
      });
    }
    return html2canvasLoading;
  }

  /** The capture area as a JPEG file, or null (with a toast) when it cannot be drawn. */
  function captureImage(date) {
    // the preview lives on the รายงาน screen; shared from วันนี้ (day tools) it is drawn from an off-screen stage
    return captureNode($('captureArea'), `เวร-IPD-${date}.jpg`);
  }

  /**
   * `node` drawn by html2canvas at CAPTURE_WIDTH (staged off-screen; a node that is not in the document is staged and
   * removed again) → a File named `filename` (PNG when the name ends in .png, else JPEG), or null with a toast.
   * R4: opts {width, scale} (core.shareImage) — the stage width in CSS px (200–2000, default CAPTURE_WIDTH) and the
   * html2canvas scale (1–4, default 3).
   */
  async function captureNode(node, filename, opts) {
    const o = captureOpts(opts);
    let draw;
    try { draw = await loadHtml2canvas(); }
    catch (e) { toast(MSG.imageToolFailed, 4000); return null; }
    if (!node) { toast(MSG.imageFailed); return null; }
    const png = /\.png$/i.test(filename);
    const type = png ? 'image/png' : 'image/jpeg';
    const restore = stageCaptureArea(node, o.width);
    const unfix = baselineFix();
    await new Promise(r => setTimeout(r, 0));   // let the staged width settle
    try {
      const canvas = await draw(node, { scale: o.scale, backgroundColor: '#ffffff', useCORS: true });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, png ? undefined : 0.95));
      if (blob) return new File([blob], filename, { type });
    } catch (e) { /* reported below */ }
    finally { restore(); unfix(); }
    toast(MSG.imageFailed);
    return null;
  }

  /**
   * R2 core.shareImage(node, filename, opts?) → Promise<bool>: the capture logic of the day picture for any node (e.g. a
   * month table built off-screen with inline styles, like #captureArea), saved with saveFile; true when it was saved.
   * R4: opts {width, scale} — e.g. the unit-format month pictures of ตารางเวร use {width: 880, scale: 2}; without opts
   * the day picture's 420 px / scale 3.
   * One image at a time (a second call while one is drawing resolves false).
   */
  async function shareImage(node, filename, opts) {
    if (imageBusy) return false;
    let ok = false;
    await oneImageAtATime(async () => {
      const name = typeof filename === 'string' && filename ? filename : 'ตารางเวร.png';
      const file = await captureNode(node, name, opts);
      if (file && await saveFile(file, file.name)) { toast('⬇️ บันทึกภาพเรียบร้อย'); ok = true; }
    });
    return ok;
  }

  /**
   * html2canvas measures the text baseline with an <img> placed in THIS document that must sit on the baseline; the
   * stylesheet's preflight makes every img a block, which drew all text of the picture about 7 px too low (found in the
   * real export). While drawing, imgs are inline again (the app shows no <img> of its own; avatar photos are absolute).
   * → a function that removes the rule.
   */
  function baselineFix() {
    const st = document.createElement('style');
    st.textContent = 'img{display:inline-block!important;vertical-align:baseline!important}';
    document.head.appendChild(st);
    return () => st.remove();
  }

  /**
   * The picture is always drawn at CAPTURE_WIDTH (it looks the same from วันนี้ and from รายงาน, on a phone and on a PC):
   * the capture area moves into a stage outside the viewport for the drawing (html2canvas can only draw what is
   * rendered; on the รายงาน screen a placeholder of the same height keeps the page still). → restore() puts it back.
   */
  /** R4: {width, scale} of a capture — out-of-range or missing values fall back to CAPTURE_WIDTH / 3. */
  function captureOpts(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const w = Number(o.width), sc = Number(o.scale);
    return {
      width: Number.isFinite(w) && w >= 200 && w <= 2000 ? Math.round(w) : CAPTURE_WIDTH,
      scale: Number.isFinite(sc) && sc >= 1 && sc <= 4 ? sc : 3
    };
  }
  function stageCaptureArea(area, width) {
    if (!area) return () => {};
    const stageW = width || CAPTURE_WIDTH;
    const parent = area.parentNode;
    if (!parent) {   // R2: a node built for the picture only (core.shareImage): staged, then taken out again
      const tmp = document.createElement('div');
      tmp.setAttribute('aria-hidden', 'true');
      tmp.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + stageW + 'px;pointer-events:none;';
      document.body.appendChild(tmp);
      tmp.appendChild(area);
      return () => { if (area.parentNode === tmp) tmp.removeChild(area); tmp.remove(); };
    }
    const h = area.getClientRects().length ? area.offsetHeight : 0;
    const hold = document.createElement('div');
    hold.setAttribute('aria-hidden', 'true');
    hold.style.height = h + 'px';
    parent.insertBefore(hold, area);
    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + stageW + 'px;pointer-events:none;';
    document.body.appendChild(stage);
    stage.appendChild(area);
    return () => {
      parent.insertBefore(area, hold);
      hold.remove();
      stage.remove();
    };
  }

  /**
   * One image at a time (R1a fix A-S1): "บันทึกภาพ JPG" / "แชร์รูป" while another save or share is still drawing or
   * sharing is ignored, so the capture area is staged and put back exactly once.
   */
  let imageBusy = false;
  async function oneImageAtATime(fn) {
    if (imageBusy) return;
    imageBusy = true;
    try { await fn(); } finally { imageBusy = false; }
  }

  function onSaveImage() {
    return oneImageAtATime(async () => {
      const file = await captureImage(state.selectedDate);
      if (file && await saveFile(file, file.name)) toast('⬇️ บันทึกภาพเรียบร้อย');
    });
  }

  function onShareImage() {
    return oneImageAtATime(async () => {
      const date = state.selectedDate;
      const file = await captureImage(date);
      if (!file) return;
      if (!canShareFile(file)) { downloadBlob(file, file.name); toast('⬇️ บันทึกภาพเรียบร้อย'); return; }
      if (await shareFile(file, { title: 'ตารางเวร IPD', text: U.thaiDate(date) }) === 'failed') downloadBlob(file, file.name);
    });
  }

  /** 🔄 in the header and "ลองใหม่" in the offline banner. */
  async function onRefreshClick(btn, busyLabel) {
    if (!state.session) return;
    await withBusy(btn, busyLabel, async () => {
      const ok = await refresh();
      if (ok) toast('🔄 อัปเดตข้อมูลล่าสุดแล้ว');
    });
  }

  /* ------------------------------------------------------------------ */
  /* station counts (#stationCountsModal, Supervisor)                    */
  /* ------------------------------------------------------------------ */
  function openStationCountsModal() {
    if (!isSup()) { toast(MSG.supOnly); return; }
    ui.countsDraft = Object.assign({}, state.stationCounts);
    renderStationCounts();
    showModal('stationCountsModal');
  }

  function closeStationCountsModal() {
    ui.countsDraft = null;
    hideModal('stationCountsModal');
  }

  function renderStationCounts() {
    const d = ui.countsDraft;
    setHtml($('stationCountsList'), d ? U.STATIONS.map(st => countRowHtml(st, d[st.id])).join('') : '');
  }

  /** A white row like everywhere else: the station chip, then "ลด" N "เพิ่ม" (words, the station in the label) — Minor 5. */
  function countRowHtml(st, n) {
    const step = (delta, word, label, off) =>
      `<button type="button" class="${Kit.cls.stepBtn}" data-station="${st.id}" data-step="${delta}" ` +
      `aria-label="${label} ${esc(st.name)}"${off ? ' disabled' : ''}>${word}</button>`;
    return `<div class="${Kit.cls.countRow}" data-count-row="${st.id}">` +
      `<span class="min-w-0 flex-1">${stationChipHtml(st)}</span>` +
      `<div class="flex items-center gap-1.5 shrink-0">` +
        step(-1, 'ลด', 'ลดจำนวนคน', n <= U.STATION_COUNT_MIN) +
        `<span class="w-9 text-center font-display text-lg font-semibold leading-7 text-ink-900 tabular-nums" data-count-value="${st.id}" aria-live="polite">${n}</span>` +
        step(1, 'เพิ่ม', 'เพิ่มจำนวนคน', n >= U.STATION_COUNT_MAX) +
      `</div></div>`;
  }

  function onCountStep(e) {
    const b = e.target && e.target.closest ? e.target.closest('.count-step') : null;
    const d = ui.countsDraft;
    if (!b || b.disabled || !d || !U.stationById(b.dataset.station)) return;
    const n = d[b.dataset.station] + (Number(b.dataset.step) || 0);
    d[b.dataset.station] = Math.min(U.STATION_COUNT_MAX, Math.max(U.STATION_COUNT_MIN, n));
    renderStationCounts();
  }

  /** Sends only the changed counts. Days already holding more people keep them (server and slots alike). */
  async function onSaveStationCounts() {
    const d = ui.countsDraft;
    if (!d || !requireInternet()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    const counts = {};
    U.STATIONS.forEach(st => { if (d[st.id] !== state.stationCounts[st.id]) counts[st.id] = d[st.id]; });
    if (!Object.keys(counts).length) { closeStationCountsModal(); return; }
    const alive = sessionAlive();
    await withBusy($('stationCountsSaveBtn'), 'กำลังบันทึก…', async () => {
      let res;
      try { res = await userCall('setStationCounts', { counts }); }
      catch (e) {
        if (e.code !== 'UNKNOWN_ACTION') throw e;
        toast(MSG.updateCodeGs, 4000);   // Code.gs is still the version without station counts
        return;
      }
      if (!alive()) return;
      ui.staffSeq++;   // a getData that started before this write must not bring the old counts back
      state.stationCounts = U.normalizeStationCounts(res.stationCounts);
      closeStationCountsModal();
      persistCache();
      render();
      toast(MSG.countsSaved);
    });
  }

  /* ------------------------------------------------------------------ */
  /* connection check (#diagModal) — works before login, no token needed */
  /* ------------------------------------------------------------------ */
  const DIAG_STEPS = [
    { key: 'device', label: () => 'อินเทอร์เน็ตของเครื่อง', run: diagDevice },
    { key: 'app', label: () => `หน้าเว็บของแอป (${location.host || location.protocol})`, run: diagAppPage },
    { key: 'script', label: () => 'เซิร์ฟเวอร์ Google Apps Script (script.google.com)', run: diagScript, slowMs: DIAG_SLOW_MS },
    { key: 'echo', label: () => 'ช่องทางรับคำตอบ (script.googleusercontent.com)', run: diagEcho, slowMs: DIAG_SLOW_MS },
    { key: 'cdn', label: () => '(ไม่จำเป็นต่อการใช้งาน) fonts.googleapis.com, cdnjs.cloudflare.com', run: diagCdn }
  ];
  const DIAG_NO_URL = { status: 'skip', note: 'ยังไม่ได้ตั้งค่า URL ของ Web App' };

  function openDiag() {
    renderDiag();
    showModal('diagModal');
  }

  /** Runs the checks one after another; each row shows its result as soon as it is known. */
  async function runDiag() {
    if (ui.diag && ui.diag.running) return;
    ui.diag = { running: true, at: Date.now(), rows: [], verdict: null };
    const d = ui.diag;
    renderDiag();
    for (const step of DIAG_STEPS) {
      const row = { key: step.key, label: step.label(), status: 'run', ms: null, note: '', code: '' };
      d.rows.push(row);
      renderDiag();
      const started = Date.now();
      const res = await step.run(d.rows);
      Object.assign(row, res);
      if (res.status !== 'skip') row.ms = Date.now() - started;
      if (row.status === 'ok' && step.slowMs && row.ms > step.slowMs) {
        row.status = 'warn';
        row.slow = true;   // the verdict tells "slow" apart from other ⚠️ (e.g. an unexpected HTTP status)
        row.note += ' แต่ตอบช้า';
      }
      renderDiag();
    }
    d.verdict = diagVerdict(d.rows);
    d.running = false;
    renderDiag();
  }

  function renderDiag() {
    const d = ui.diag;
    setHtml($('diagResults'), d
      ? d.rows.map(diagRowHtml).join('')
      : '<p class="text-sm leading-6 text-slate-500 text-center py-2">กด "เริ่มตรวจสอบ" เพื่อทดสอบการเชื่อมต่อทีละขั้น</p>');
    const v = $('diagVerdict');
    v.textContent = d && d.verdict ? d.verdict.text : '';
    v.className = VERDICT_BASE + (d && d.verdict ? VERDICT_TONE[d.verdict.tone] : '');
    setVisible(v, !!(d && d.verdict));
    const run = $('diagRunBtn');
    run.disabled = !!(d && d.running);
    setHtml(run, d && d.running ? 'กำลังตรวจสอบ…'
      : d ? Kit.icon('refresh', 'w-5 h-5') + 'ตรวจสอบอีกครั้ง' : Kit.icon('activity', 'w-5 h-5') + 'เริ่มตรวจสอบ');
    $('diagCopyBtn').disabled = !d || d.running;
  }

  function diagRowHtml(r) {
    return `<div class="diag-row flex items-start gap-2.5 p-3 rounded-2xl bg-cream-50 border-2 border-cream-100" data-diag="${r.key}" data-status="${r.status}">` +
      `<span class="shrink-0 text-sm leading-6">${DIAG_ICON[r.status]}</span>` +
      `<div class="min-w-0 flex-1">` +
        `<div class="flex justify-between gap-2 text-sm font-semibold leading-6 text-ink-900"><span class="min-w-0">${esc(r.label)}</span>` +
          (r.ms === null ? '' : `<span class="shrink-0 text-xs font-medium leading-6 text-slate-500 tabular-nums">${r.ms} ms</span>`) + `</div>` +
        (r.note ? `<p class="text-[0.8125rem] text-slate-500 leading-5">${esc(r.note)}</p>` : '') +
      `</div></div>`;
  }

  /** fetch with a time limit, so a check that hangs cannot hold up the next ones. */
  async function diagFetch(url, init) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DIAG_TIMEOUT_MS);
    try { return await fetch(url, Object.assign({ signal: ctrl.signal }, init)); }
    finally { clearTimeout(timer); }
  }

  function diagDevice() {
    return deviceOffline()
      ? { status: 'fail', note: 'เครื่องนี้ไม่ได้เชื่อมต่อ Wi-Fi หรืออินเทอร์เน็ตมือถือ' }
      : { status: 'ok', note: 'เครื่องเชื่อมต่อเครือข่ายอยู่' };
  }

  /** `diag` in the query keeps the service worker out of the way: this must reach the real web server. */
  async function diagAppPage() {
    try {
      const res = await diagFetch('manifest.json?diag=' + Date.now(), { cache: 'no-store' });
      return res.ok ? { status: 'ok', note: 'โหลดไฟล์ของแอปได้' } : { status: 'warn', note: 'เว็บเซิร์ฟเวอร์ตอบกลับ HTTP ' + res.status };
    } catch (e) {
      return { status: 'fail', note: 'โหลดไฟล์ของแอปไม่ได้ — เครือข่ายนี้อาจใช้อินเทอร์เน็ตไม่ได้' };
    }
  }

  /** Only the first hop: Google's redirect to the answer host counts as reachable (it is not followed). */
  async function diagScript() {
    if (!Api.url) return DIAG_NO_URL;
    try {
      const res = await diagFetch(Api.url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ping' }),
        redirect: 'manual', cache: 'no-store'
      });
      if (res.type === 'opaqueredirect' || (res.status >= 200 && res.status < 300)) return { status: 'ok', note: 'เข้าถึงได้' };
      return { status: 'warn', note: 'ตอบกลับ HTTP ' + res.status };
    } catch (e) {
      return { status: 'fail', note: 'เข้าถึงไม่ได้ — เครือข่ายนี้อาจบล็อก script.google.com' };
    }
  }

  /** A whole ping through Api (redirect followed, envelope checked), one attempt. */
  async function diagEcho(rows) {
    if (!Api.url) return DIAG_NO_URL;
    try {
      const d = await Api.call('ping', {}, { attempts: 1, timeoutMs: DIAG_TIMEOUT_MS });
      if (d && d.version) ui.serverVersion = String(d.version);
      // R1b: the ping also announces the server's features (a server older than 3.0 announces none)
      if (state.session && d && typeof d === 'object' && setServerFeatures(Array.isArray(d.features) ? d.features : null)) render();
      return { status: 'ok', note: 'เซิร์ฟเวอร์ตอบกลับปกติ (เวอร์ชัน ' + (d.version || '-') + ')' };
    } catch (e) {
      const firstHopOk = rows.some(r => r.key === 'script' && (r.status === 'ok' || r.status === 'warn'));
      const blocked = e.code === 'NETWORK' && firstHopOk;
      return { status: 'fail', code: e.code, note: blocked ? 'โดเมน script.googleusercontent.com น่าจะถูกบล็อกโดยเครือข่ายนี้' : e.message };
    }
  }

  /** HEAD requests are not handled by the service worker, so a cached copy cannot hide a blocked host. */
  async function diagCdn() {
    const failed = [];
    for (const url of DIAG_CDN_URLS) {
      try { await diagFetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }); }
      catch (e) { failed.push(new URL(url).host); }
    }
    return failed.length
      ? { status: 'warn', note: 'เข้าถึง ' + failed.join(', ') + ' ไม่ได้ — แอปยังใช้งานได้ (ใช้ฟอนต์ของเครื่อง และอาจบันทึกภาพไม่ได้)' }
      : { status: 'ok', note: 'เข้าถึงได้' };
  }

  function diagVerdict(rows) {
    const s = {};
    rows.forEach(r => { s[r.key] = r; });
    if (s.device.status === 'fail') return { tone: 'fail', text: 'เครื่องนี้ไม่ได้เชื่อมต่ออินเทอร์เน็ต — เปิด Wi-Fi หรืออินเทอร์เน็ตมือถือแล้วลองใหม่' };
    if (s.app.status === 'fail' && s.script.status !== 'ok') return { tone: 'fail', text: 'เชื่อมต่อเครือข่ายไม่ได้ — ตรวจสอบ Wi-Fi หรืออินเทอร์เน็ตของเครื่องแล้วลองใหม่' };
    if (s.script.status === 'skip') return { tone: 'warn', text: 'ยังไม่ได้ตั้งค่า URL ของ Web App จึงตรวจได้เฉพาะอินเทอร์เน็ตของเครื่อง' };
    if (s.script.status === 'fail') return { tone: 'fail', text: 'เข้าถึง script.google.com ไม่ได้ — เครือข่ายนี้อาจบล็อก Google Apps Script ลองใช้อินเทอร์เน็ตมือถือ หรือแจ้งฝ่าย IT' };
    if (s.echo.status === 'fail') {
      return { tone: 'fail', text: s.echo.code === 'NETWORK'
        ? 'ส่งคำขอถึง Google ได้แต่รับคำตอบไม่ได้ — ' + s.echo.note + ' ลองใช้อินเทอร์เน็ตมือถือ หรือแจ้งฝ่าย IT ให้อนุญาตโดเมนนี้'
        : 'เซิร์ฟเวอร์ตอบกลับผิดปกติ: ' + s.echo.note + ' — ลองใหม่อีกครั้งในอีกสักครู่' };
    }
    if (s.script.slow || s.echo.slow) {
      return { tone: 'warn', text: 'เชื่อมต่อได้ แต่เซิร์ฟเวอร์ Google ตอบช้า — เมื่อไม่สำเร็จ แอปจะลองใหม่ให้อัตโนมัติ' };
    }
    // a ⚠️ first hop that is not slow (e.g. Google's transient HTTP 404 page) while the full ping worked: usable
    return { tone: 'ok', text: 'เชื่อมต่อเซิร์ฟเวอร์ได้ตามปกติ' + (s.cdn.status === 'ok' ? '' : ' (ฟอนต์/เครื่องมือสร้างภาพโหลดไม่ได้ แต่ไม่กระทบการใช้งาน)') };
  }

  /** Plain-text report for support: versions, times, host names and results only — no token, URL or names. */
  function diagReport() {
    const d = ui.diag;
    const lines = [
      'เวร IPD — ผลตรวจสอบการเชื่อมต่อ',
      'เวอร์ชันแอป: ' + Api.clientVersion,
      'เวลา: ' + U.thaiStamp(d.at),
      'เบราว์เซอร์: ' + navigator.userAgent,
      'สถานะในแอป: ' + SYNC_LOOK[state.conn].label + ' (ล้มเหลวติดกัน ' + ui.failStreak + ' ครั้ง)'
    ];
    d.rows.forEach(r => lines.push(DIAG_ICON[r.status] + ' ' + r.label + (r.ms === null ? '' : ' — ' + r.ms + ' ms') + (r.note ? ' — ' + r.note : '')));
    lines.push('สรุป: ' + d.verdict.text);
    return lines.join('\n');
  }

  async function onDiagCopy() {
    if (!ui.diag || ui.diag.running) return;
    try {
      await navigator.clipboard.writeText(diagReport());
      toast('📋 คัดลอกผลการตรวจแล้ว');
    } catch (e) {
      toast('คัดลอกไม่สำเร็จ — กรุณาบันทึกภาพหน้าจอแทน');
    }
  }

  /** A new service worker took over a page that already had one (an update, not the first install). */
  function watchForUpdate() {
    const sw = navigator.serviceWorker;
    if (!sw || !sw.controller) return;
    sw.addEventListener('controllerchange', () => { setVisible($('updateBanner'), true); syncLayout(); }, { once: true });
  }

  /* ------------------------------------------------------------------ */
  /* feature registry and core API → App.register, App.core             */
  /* ------------------------------------------------------------------ */
  /*
   * DEVELOPER NOTE (R1a-B1, apiLevel 1) — the only surface feature files (js/feat-*.js, loaded after this file) use.
   * Load order (R3-SPEC §4.1, R5): config.js → utils.js → api.js → ui-kit.js → xlsx-lite.js → plan-engine.js →
   * training-engine.js → app.js → plan-data.js → feat-profile.js → feat-approval.js → feat-roster.js → feat-plan-settings.js →
   * feat-backup.js → feat-dashboard.js → feat-problems.js → feat-chat.js → feat-training.js. R5: window.TrainingEngine is NOT
   * required by the boot guard (feat-training.js checks it; without it no training screen / วันนี้ line). A feature file registers at load time (before init) or later
   * ("late registration" works the same way). window.PlanEngine (pure engine) is loaded before this file; the boot guard
   * requires it. R3: window.XlsxLite (js/xlsx-lite.js) is NOT required — a feature checks it and hides its Excel button
   * without it; Api.newId() makes the client ids of R3 writes (a photo's fileId, a chat message's cid).
   *
   * App.register(def) → true, or false (rejected: invalid/duplicate id, or def.needs > core.apiLevel — then the
   * "มีเวอร์ชันใหม่" banner is shown). def fields (all optional except id):
   *   id         /^[a-z][a-z0-9-]{0,31}$/; the screen is <section id="tab-ID" class="tab-panel" data-feature="ID">,
   *              created in #appMain by the registry (never edit index.html for a feature)
   *   title      label of the nav entry (Thai)             icon   UiKit icon name of the nav entry
   *   needs      core.apiLevel the feature needs (default 1)
   *   nav        { place: 'bar'|'menu'|'header'|'none' (default 'none'), section: 'mine'|'sup'|'system'|…, order }
   *              → <button class="nav-btn" data-tab="ID" data-nav-place="…"> in #bottomNav / #menuNav /
   *              #headerNav (none: reachable through core.go only). Lower order first (legacy 10–40, default 100).
   *              R3 (I2): a header entry is a 44 × 44 px icon button (px, like the avatar and ↻ — never wider at a large
   *              text size); the header row (C-M1, fitHeader) makes room for it by stepping the sync pill down: full →
   *              short → icon → tight → nopill (also a smaller date) → mini (the extreme: a smaller date still, which
   *              ends in "…" inside its column rather than running under the icons). The chat icon (order 10) is the
   *              one header entry of R3; with it the pill leaves the row on narrow phones (≈ 320 px; ≤ 375 px at 130 %).
   *              The bar holds วันนี้ (10), การลา (20), R2 ตารางเวร (25, only while the server has 'plan') and เมนู (90);
   *              keep the bar at 3–4 entries.
   *              place 'menu' → a row in the เมนู screen, in the list of nav.section: 'mine' (ของฉัน), 'sup'
   *              (งานหัวหน้า: รายชื่อบุคลากร 30, รายงานและส่งออก 40), 'system' (ระบบ: your rows come before the fixed
   *              ones — connection check 900, what's new 910, version 920, logout 990); any other section → 'other'
   *              (เพิ่มเติม). A section without a visible row is hidden. เมนู's bar badge = the sum of its rows' badges.
   *   parent     screen core.back() returns to (default 'station'). Give a screen opened from เมนู parent: 'menu':
   *              the header then shows ← (any screen that is not in the bar does) and เมนู stays highlighted.
   *   chrome     { date: bool, weekStrip: bool } (default both false): the header shows the selected date (tap =
   *              date picker) instead of the screen title; the week strip shows under the header (วันนี้ only).
   *              R3: bottomNav: false hides the phone's bottom bar (#navDock below md:, data-bottom-nav="off"; the left
   *              rail of md: and up stays) and the space kept for it while the screen is current (the chat room);
   *              R3 (I2): such a screen enters with an opacity-only fade (data-enter="opacity") instead of the shared
   *              translateY fade, so its sticky children (the composer) are in place from the first frame
   *   visible(c) → bool: role/capability gate (default true). A current screen that turns invisible falls back to
   *              'station' at the next render; its nav entry is hidden.
   *   badge(c)   → number shown on the nav entry (else the value of core.badges.set(id, n))
   *   badgeLabel(n) → R3 FIX-CL L-13: the count badge's spoken name (aria-label), default "N รายการ"
   *   init(c)    once, when the app starts (or at registration when it already started)
   *   mount(root, c)   once before the first render/show (again after a logout when the feature has no reset)
   *   render(root, c)  on every app render while the screen is current (only the current feature renders)
   *   show(c, params)  when the screen becomes current (also on core.go(id, params) to the current screen)
   *   hide(c)    when another screen becomes current
   *   canLeave(c) → true | a message (asked with UiKit.confirm before leaving) | false (stay)
   *   back(c)    → R3 F-3: true when the screen handled a "back" itself (an inner view closed: the team person view returns
   *              to its list); anything else → the usual back to `parent`. Called (sync, only while the screen is current)
   *              by core.back() — i.e. the header ←, Android/browser back (after an open sheet closed) and features
   *              calling c.back(). Never navigate inside it; keep it cheap.
   *   reset(c)  on logout and before a new login (clearDataState): drop memory and DOM written for the old user.
   *              Without reset the registry empties the root and mounts again later.
   *   Isolation: every hook (and visible/badge) runs in try/catch; a returned Promise is tracked (App.idle) and its
   *   rejection caught. A failure marks the feature broken for this page load: its root shows an error card
   *   ([data-feature-error]), its later hooks are skipped (a failing visible() also hides it); the app keeps working.
   *   The four legacy screens (station, leave, staff, summary) are registered by app.js itself, keep their
   *   index.html markup and are always rendered by render().
   *
   * App.core (frozen):
   *   apiLevel 1 · U (Utils) · Api · Kit (UiKit) · state (App.state — READ ONLY for features)
   *   isSup() · myName() · staff() (copy of the active staff [{name, group}]) · serverHas(name) (R1b: the `features` of
   *     the last getData / ping answer: 'leave2', 'approval', 'avatar', 'password', R2 'plan' (Code.gs 3.1), R3 'stats'
   *     (personal profile fields + both dashboards), 'problem', 'chat' (Code.gs 3.2); all false on a Code.gs older than 3.0)
   *     — an R3 screen is shown (and an R3 request sent) only while its flag is present
   *     · serverMode() → '' (not known yet) | 'v3' | 'old'
   *   spawn(fn, opts) (run + track + handleError) · track(promise) · alive() → () => bool (session still the same)
   *     — every async flow goes through these so App.idle() sees it
   *   call(action, params, opts) (Api.call) · userCall(…) (same, with the "server slow, retrying" toast) ·
   *     R3 (I2): opts.requestId — the caller's own requestId ([A-Za-z0-9_-]{16,64}, e.g. Api.newId()) to send the SAME
   *     write again in a later call (the server replays a write by requestId for 600 s: e.g. a problem report whose
   *     answer was lost is not stored twice); anything else → a fresh id ·
   *     withBusy(btn, label, fn) · requireInternet() · handleError(e, opts) · toast(msg, ms)
   *   confirm(msg, opts) → Promise<bool> · prompt(msg, default, opts) → Promise<string|null> — UiKit.confirm/prompt
   *     (sheets; window.confirm/prompt with APP_CONFIG.NATIVE_DIALOGS) that do not keep App.idle() busy while open;
   *     use these instead of UiKit's directly inside tracked flows
   *   esc(s) · setHtml(el, html) (no-op when unchanged) · setVisible(el, on) · render()
   *   go(id, params) → Promise<bool> (true when `id` is current afterwards; a screen the user may not see opens
   *     'station') · back() → Promise<bool> · current() → id · features(place?) → [{id, title, icon, place,
   *     section, order, parent, legacy, visible, badge, error}] in nav order (for building nav/menu UIs)
   *   selectedDate() · setSelectedDate(ymd) → Promise<bool>
   *   ensureRange(from, to, opts) · dayView(date) → 'ready'|'cached'|'loading'|'missing' · leavesOn(date) ·
   *     leaveList(date) → [{name, type, rank}] of the ABSENT people · leaveLines(date) → {absent, partial, pending} lines
   *     [{name, type, rank, leave, info}] · isAbsent(leave) (= Utils.isAbsent) · saveFile(blob, filename) → Promise<bool>
   *   R2 FIX I-8: messages.serverV31 — the one wording of the 3.0-server notice (เมนู note; use it for other screens too);
   *     R3: its text now names Code.gs 3.2, and messages.serverV32 is the 3.1-server notice ('plan' but no 'chat': "…ยังเป็น
   *     รุ่น 3.1 — อัปเดต Code.gs เป็น 3.2 … Dashboard แจ้งปัญหา และแชท"). #menuServerNote (Supervisor, a v3 server) shows
   *     serverV31 with data-server="3.0" or serverV32 with data-server="3.1"; nothing on a server with 'chat'.
   *   R3: setScreenTitle(text | null) — the header title of the CURRENT screen (instead of def.title) until the screen
   *     changes (core.go to another screen, or to the same one with params, clears it before show() runs); null restores
   *     def.title. E.g. the chat room: setScreenTitle(peer) in show().
   *   R3: the station cards of วันนี้ carry a "แจ้งปัญหา" chip (R3 FIX-CL L-1: a labelled ghost button with a small inbox
   *     icon, 44 px tall, aria-label "แจ้งปัญหา <Station>", data-problem-station="<id>", in its own row at the card's
   *     bottom-right below the slots — never next to the need/short pills; the h3's first child stays the name text node)
   *     while serverHas('problem') AND use('problems.report') is a function; a tap (logged in, online — requireInternet())
   *     runs use('problems.report')(stationId) through spawn(). With use('problems').openSummary() (the already-loaded
   *     domain, no request) a station with open problems also shows the pill "ปัญหาค้าง N" beside its title chip
   *     ([data-problem-open="<id>"], 44 px target) → go('problems', {station, status: 'open'}).
   *   R3 F-2 (Supervisor): a station card with ≥ 2 people on an editable day has "จัดลำดับ" ([data-reorder-start="<id>"],
   *     icon sort, bottom-left of the card's last row [data-station-foot]); it switches THAT card (ui.reorder = {date,
   *     station}; ends on another date / role / logout) into a reorder list [data-reorder="<id>"] — one row per person
   *     ([data-reorder-row="<name>"]) with 44 px ขึ้น / ลง ([data-reorder-move="up|down"][data-reorder-station][data-name],
   *     aria-label "ย้าย <name> ขึ้น|ลง", disabled at the ends and while locked) and "เสร็จ" ([data-reorder-done]) back to the
   *     pickers. A move edits the draft like a picker change (ensureDraft → viewSlots → the station's people in the new order,
   *     empty slots after them; dirty save bar; saved only by บันทึก) — the saved order is what the picture, the staff chips
   *     and the pickers show. On Portable each row shows the line that order gives ("สาย N", [data-reorder-line]):
   *     PlanEngine.resolveLines(use('plan').linesFor(date), people) — planned line techs keep their lines, substitutes
   *     take the vacant lines in order. .station-select[data-station][data-index] and data-station-card are unchanged.
   *   R3 F-1: the leave calendar shows use('plan').holidays() for everyone — the number in the Sunday tone, a short bar
   *     marker first in the markers' row (.cal-day[data-holiday] [data-cal-holiday]), "วันหยุด: <name>" in the cell's
   *     label and the selected day's detail ([data-cal-holiday-line]), and #calHolidays: the heading "วันหยุดเดือนนี้" and
   *     one holiday per line ([data-cal-holiday-item="<date>"] "5 ธ.ค. <name>", FIX-CL2 Q-4; hidden when none). A shown
   *     month the plan range does not cover asks use('plan').ensure once (server 'plan' only, no new action; offline = the
   *     cached plan domain): the selected date's month ± 1 window when the month is inside it (FIX-CL2 Q-1: a far month may
   *     have reset the range), else that month; leaving การลา restores the plan range around the selected date (as ตารางเวร does).
   *   R2 (I2): openStationCounts() — the station-counts sheet (Supervisor) · refresh() → Promise<bool> — a heartbeat now
   *     (getData of the selected date's window; never rejects; e.g. after a write whose new plan version must be learnt)
   *   R2: shareImage(node, filename, opts?) → Promise<bool> — node drawn by html2canvas at 420 px (R4: opts {width, scale}
   *     e.g. {width: 880, scale: 2}; default 420 / 3) (staged off-screen; a node not in
   *     the document is staged and removed again; inline styles only, like #captureArea), PNG when filename ends in .png,
   *     else JPEG; saved with saveFile (toast on success). applyRules(rules) → bool — e.g. setPlanSettings' answer
   *     {planPriority, planSlotOrder} into state.rules (+ offline copy, render).
   *   R1b: applyLeaveResult({leave, day}, {date, staff}) → bool — applies a setLeave / decideLeave answer to the state
   *     (row, auto-unassigned day, draft, state.requests, render) · openLeave(date, staff) → Promise<bool> (selects the
   *     date, loads it, opens the leave sheet) · openPasswordChange() (the non-forced password sheet)
   *   state.requests (frozen LeaveV3[]: the Supervisor gets every pending row, anyone else their own pending + rejected,
   *     last 30 days and later; on('data') fires with {requests: true} when it changes) · state.rules.vacationAutoSlots ·
   *     R2 state.rules.planPriority (frozen permutation of the 7 station ids; default PlanEngine.DEFAULT_PRIORITY) ·
   *     state.rules.planSlotOrder ('coverage' default | 'priority')
   *   domain(name, {persist, empty}) → a per-feature data slice (same object for the same name):
   *     .data .version .remote .loading .error (read-only getters)
   *     .begin() → ticket; .commit(ticket, version, fn(data) → newData|undefined) → bool — applies nothing (false)
   *       when touch() or a logout/login happened after begin(), or nobody is logged in
   *     .touch(fn?) — a local write: mutate/replace data now and invalidate older tickets
   *     .load(fetchFn(version) → Promise<{version, data}|null (unchanged)>) → Promise<bool>; never rejects (the
   *       error is in .error); one load at a time
   *     .onStale(fn) → unsubscribe; .setRemote(v) — the server's version (fn runs when it differs from .version);
   *       R1b: every getData answer (full or unchanged) calls setRemote(versions[name]) for each domain of that name (e.g.
   *       'profile' ← versions.profile; '' while that domain is empty); a domain created later starts with that remote
   *     persist: true keeps {user, v, savedAt, data} in localStorage ipd_dom:<name> (restored for the same user
   *     after a reload). Logout resets every domain to `empty` and removes ipd_dom:*.
   *   store.draft.get/set/remove(key) — JSON in ipd_draft:<user>:<key> (unsent input; removed on logout)
   *   store.prefs.get(key, dflt) / set(key, value) — device preferences in ipd_prefs (kept on logout)
   *   media — IndexedDB "ipd-media" (stores blobs, chat, outbox), opened lazily on first use; an in-memory map
   *     when IndexedDB is unavailable. get/put/del(store, key[, value]), keys(store), clear(store) → Promises,
   *     all tracked; ready() → Promise<'idb'|'memory'>; mode() → '' (not opened yet) | 'idb' | 'memory'.
   *     The connection closes on versionchange (a deletion is never blocked). Logout (and an expired session) clears every store when
   *     it was used. IndexedDB runs on real time: tests must poll, never assume.
   *   poll.every(id, ms, fn(c)) → cancel(): fn runs every ms (≥ 1 s) while visible and logged in; same id replaces
   *   on(evt, fn(payload, c)) → unsubscribe; evt 'login' {name, restored} · 'logout' · 'role' {isSup} ·
   *     'date' {date} · 'data' {from, to, changed} | {date, local} | {domain} · 'visible' · 'online'
   *   provide(name, fn) · provide(name, null) withdraws it (only replacing a live provider warns) · use(name) → fn | null
   *     (R2: fn may also be an object — js/plan-data.js provides 'plan', its API object; see the header of that file)
   *     (cross-feature services). 'leave.decide' (R1b): fn({date, staff, decision: 'approved'|'rejected', leave,
   *     onSending}, core) → Promise of the decideLeave answer {leave, day} (the leave sheet applies it and closes) or a
   *     falsy value (cancelled, or the request was decided / cancelled elsewhere and the provider showed the fresh state:
   *     the sheet stays); it asks for the optional reason, calls onSending() right before its request goes out (the sheet
   *     is only locked until then, "กำลังบันทึก…" from then on), sends decideLeave with expect = leave's status and shows
   *     the result toast itself; a rejection is shown by handleError. Without a provider the sheet has no buttons.
   *   station.setProposer(fn(date) → {assignments, notes, unfilled, lines} | null) — R2: the daily proposal (R2-SPEC §0.17,
   *     §4.2). viewSlots(date) shows proposer(date).assignments (fitted to the slot counts, names the date may not hold
   *     dropped) while the proposal is ACTIVE: the Supervisor, a proposer, no draft of the date, not dismissed, today or
   *     later, no saved names, day data on this device (ready/cached), proposer answers non-null (it returns null without a
   *     roster or on a non-working day, and must be cheap: memoise it). The first edit seeds the draft from it
   *     (ensureDraft); the save bar and #draftBadge show it as unsaved; "บันทึก" saves it; leaving the date asks nothing;
   *     the shared picture (#captureArea) shows the saved day. Staff never reach the proposer.
   *     station.proposal(date?) → the active proposal | null · station.dismissProposal(date?, off = true) (memory only;
   *     false shows it again) · station.applyToDraft(date, assignments) → bool (selected + editable date only; creates or
   *     replaces the draft; dropped when equal to the saved day) · station.setDutyPatch(date, duty | null) — the duty sent
   *     as saveDay.duty with the next save of that date (server 'plan' only; cleared on success, CONFLICT, date change,
   *     logout; a duty CONFLICT keeps the draft, refreshes the plan and tells the Supervisor to check and save again; the
   *     day-CONFLICT dialog's "บันทึกทับ" resends without it; the answer's duty goes to use('plan').adoptDuty) ·
   *     station.dutyPatch(date?) → its copy | null · station.save() → Promise ("บันทึก") · station.view(date?) →
   *     {slots, stored, planned, draft, proposal, editable, remark} (copies)
   *     station.addPanel({id, order, render(el, c)}) — extra card on วันนี้ (in #stationPanels)
   *   R2 services read by the core: 'plan' (js/plan-data.js) · 'plan.myDay' fn(date, name) → [{icon, tone: 'brand'|'info'|
   *     'lilac'|'sun'|'danger'|'neutral', main, sub, tel?}] (plain text, max 8; FIX I-7: tel = a phone number, digits with
   *     an optional leading + after removing spaces/dashes, 9–15 digits — drawn as a 44 px tel: link under the line,
   *     anything else ignored) appended to "ของฉันวันนี้" while the server has
   *     'plan'. #menuServerNote tells the Supervisor of a 3.0 / 3.1 server to update Code.gs to 3.2 (see messages above).
   *   R5 services (Code.gs 3.4, read only while serverHas('training')): 'training.station' fn(date, slots) → {[stationId]: [names]}
   *     (js/feat-training.js: the trainees at each station on a working day — never students, nor one already in that station's slots) drawn as one muted line
   *     "ฝึกงาน: <names>" ([data-training-line="<id>"]) under the people of that station card — not a slot, never counted,
   *     never part of saveDay / the proposal / the day picture; 'training.myDay' fn(date, name) → plan lines like 'plan.myDay'
   *     ("ฝึกงาน <Station>" of a trainee linked to my account: "<first name>(Trainee)", the full name or the nickname), appended after them in "ของฉันวันนี้".
   *   R3 services: 'problems.report' fn(stationId) (js/feat-problems.js; turns the station-card button on) · 'problems'
   *     {ensure, list, openSummary} (the team dashboard reads it). saveFile(blob, filename) is unchanged; an .xlsx blob
   *     (XlsxLite.build) has the type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.
   *   banners.set(id, {text, tone: 'info'|'ok'|'warn'|'danger', icon, order, screens: [ids], actionLabel,
   *     action(c), dismissLabel, onDismiss(c)} | null) — shown in #bannerSlot above the screens; with dismissLabel AND
   *     onDismiss a text button "ซ่อน" (aria-label = dismissLabel, [data-banner-dismiss]; R3 L-8: no cross glyph) sits next to the action and calls onDismiss only
   *     (remembering the dismissal is the feature's job) · badges.set(id, n) · badges.get(id)
   *   confirm / prompt opts (UiKit 1.5): detail {title, text, avatar, tone} (framed block above the message), maxLength
   *     (prompt: limit + live counter), data {key: value} (data-* on the dialog, e.g. to find and close it)
   *   Logout (and a new login) clears banners, badges, domains, drafts and calls every feature's reset; R1b: also every
   *   media store (blobs, outbox, chat) and the UiKit.avatars registry (after the resets). Avatars: UiKit.avatars.set(name,
   *   url) — every avatar on the page is patched in place (UiKit.avatars.refresh), no render needed.
   *
   * Shell (R1a-B2): Android/browser back (APP_CONFIG.HISTORY_NAV !== false) closes the top sheet, then goes to the
   * current screen's parent (core.back(); R3 F-3: def.back(c) of the screen first); App.shell.onPopState /
   * App.shell.handleBack expose that logic to tests.
   * "มีอะไรใหม่" is the WHATS_NEW structure below (edit it every release); it opens once per version after an
   * update (APP_CONFIG.WHATS_NEW !== false; the seen version is core.store.prefs 'whatsNewSeen').
   * Sheets: give a feature's own sheet the markup of the index.html modals (wrapper + [data-sheet-panel] +
   * [data-sheet-title] tabindex=-1 + [data-sheet-close]) and open it with UiKit.sheet.open(el, {initialFocus:
   * '[data-sheet-title]'}) so no on-screen keyboard pops up.
   */
  const API_LEVEL = 1;
  const FEATURE_ID = /^[a-z][a-z0-9-]{0,31}$/;
  const NAV_PLACES = ['bar', 'menu', 'header', 'none'];
  const NAV_SLOT = { bar: 'bottomNav', menu: 'menuNav', header: 'headerNav' };
  const NAV_ORDER_DEFAULT = 100;
  const MENU_SECTIONS = ['mine', 'sup', 'system'];   // lists in เมนู (#menuNav); any other nav.section → 'other'
  /** CL-14: nav entries that show a dot (no count) — id → spoken label (core.badges.dot). */
  const dotLabels = Object.create(null);
  /** Nav entries of registered features (the legacy entries are in index.html with the same look). */
  const NAV_BTN = {
    bar: Kit.cls.navItem + ' ' + Kit.cls.navItemRail + ' ' + Kit.cls.navOff,
    // R3 (I2): 44 px like #headerAvatarBtn / #refreshBtn (UiKit's hdrIconBtn is w-11 = 2.75rem, 57 px at 130 % text,
    // which pushed the header date under the chat icon at 320 px — C-M1)
    header: 'nav-btn relative inline-flex items-center justify-center w-[44px] h-[44px] shrink-0 rounded-full text-ink-900 active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800 disabled:opacity-60',
    menu: 'nav-btn ' + Kit.cls.listRow
  };
  /** Where a nav entry's count badge sits: next to the bar icon, on the header icon's corner, inline in a menu row. */
  const NAV_BADGE_BOX = {
    // CL-23: on the corner of the icon pill (inside .nav-ic), so it never sits on the label — also in the landscape bar,
    // where icon and label stand side by side
    bar: 'absolute -top-1.5 -right-1 pointer-events-none',
    barDot: 'absolute -top-0.5 right-1 pointer-events-none',
    // R3 FIX-CL L-10: on the button's corner, so the 20 px icon's outline stays visible (like the เมนู badge in the bar)
    header: 'absolute -top-1 -right-1 pointer-events-none',
    menu: 'shrink-0 pointer-events-none'
  };
  const LEGACY_SCREENS = [
    { id: 'station', title: 'วันนี้', icon: 'calendar-check', nav: { place: 'bar', order: 10 }, chrome: { date: true, weekStrip: true } },
    { id: 'leave', title: 'การลา', icon: 'calendar-off', nav: { place: 'bar', order: 20 }, chrome: { date: true } },
    { id: 'staff', title: 'รายชื่อบุคลากร', icon: 'users', nav: { place: 'menu', section: 'sup', order: 30 }, parent: 'menu', visible: c => c.isSup() },
    { id: 'summary', title: 'รายงานและส่งออก', icon: 'download', nav: { place: 'menu', section: 'sup', order: 40 }, parent: 'menu', visible: c => c.isSup() }
  ];
  const DOM_PREFIX = 'ipd_dom:';
  const DRAFT_PREFIX = 'ipd_draft:';
  const PREFS_KEY = 'ipd_prefs';
  const MEDIA_DB = 'ipd-media';
  const MEDIA_DB_VERSION = 1;
  const MEDIA_STORES = ['blobs', 'chat', 'outbox'];
  const MEDIA_CHAT_MARK = 'ipd_media:chat';   // set when the chat store got data, so a logout knows it must open and clear it
  const MEDIA_USED_MARK = 'ipd_media:used';   // R1b: set when ANY store got data (avatars, photos, outbox, chat): cleared at logout

  const features = [];                       // registration order
  const featById = Object.create(null);
  let coreStarted = false;                   // init() attached the registered features; later ones attach at once
  const listeners = Object.create(null);     // event → [fn]
  const services = Object.create(null);
  const bannerDefs = Object.create(null);
  const badgeCounts = Object.create(null);
  const panelDefs = [];                      // [{id, order, render, el, failed}]
  let proposer = null;                       // R2: the daily proposal (station.setProposer)
  const serverFeatures = Object.create(null);   // R1b: the `features` of the last getData / ping answer (see applyServerExtras)
  const domains = Object.create(null);       // name → {d (internal), api}
  const remoteVersions = Object.create(null);   // R1b: name → the server's `versions[name]` (domains created later start with it)
  const polls = Object.create(null);         // id → cancel
  const media = { db: null, opening: null, mode: '', mem: null, puts: 0 };   // puts: count of put() calls (see wipeUserMedia)

  function cloneJson(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }

  /* ---------- registration ---------- */
  function register(def) { return addFeature(def, false); }

  function addFeature(def, legacy) {
    const id = def && typeof def === 'object' ? String(def.id || '') : '';
    if (!FEATURE_ID.test(id)) { console.warn('App.register: invalid feature id', id); return false; }
    if (featById[id] || (!legacy && document.getElementById('tab-' + id))) {
      console.warn('App.register: "' + id + '" is already registered');
      return false;
    }
    const needs = def.needs === undefined ? 1 : Number(def.needs);
    if (!(needs <= API_LEVEL)) {
      console.warn('App.register: "' + id + '" needs core API level ' + def.needs + ', this app has ' + API_LEVEL);
      setVisible($('updateBanner'), true);   // a newer feature file than app.js: reloading fetches the matching app
      if (coreStarted) syncLayout();
      return false;
    }
    const nav = def.nav && typeof def.nav === 'object' ? def.nav : {};
    const f = {
      id, def, legacy: !!legacy,
      title: String(def.title || id),
      icon: typeof def.icon === 'string' ? def.icon : '',
      place: NAV_PLACES.indexOf(nav.place) >= 0 ? nav.place : 'none',
      section: typeof nav.section === 'string' ? nav.section : '',
      order: typeof nav.order === 'number' && isFinite(nav.order) ? nav.order : NAV_ORDER_DEFAULT,
      parent: typeof def.parent === 'string' ? def.parent : '',
      chrome: {
        date: !!(def.chrome && def.chrome.date),             // the header shows the selected date (else the title)
        weekStrip: !!(def.chrome && def.chrome.weekStrip),   // the week strip under the header
        bottomNav: !(def.chrome && def.chrome.bottomNav === false)   // R3: false hides the phone's bottom bar (chat room)
      },
      root: null, navBtn: null, started: false, mounted: false, error: null
    };
    features.push(f);
    featById[id] = f;
    if (coreStarted) {
      attachFeature(f);
      render();
    }
    return true;
  }

  /** At init: the screens registered so far get their DOM, init() and mount(). */
  function startCore() {
    coreStarted = true;
    features.slice().forEach(attachFeature);
  }

  function attachFeature(f) {
    if (f.started) return;
    if (f.legacy) {
      f.root = $('tab-' + f.id);
      f.navBtn = document.querySelector('#bottomNav .nav-btn[data-tab="' + f.id + '"], #menuNav .nav-btn[data-tab="' + f.id + '"]');
      if (f.navBtn) {
        f.navBtn.dataset.navPlace = f.place;
        f.navBtn.dataset.navOrder = String(f.order);
      }
      f.started = true;
      return;
    }
    const root = document.createElement('section');
    root.id = 'tab-' + f.id;
    root.className = 'tab-panel space-y-3';
    root.dataset.feature = f.id;
    // R3 (I2): a screen without the bottom bar (the chat room: a sticky composer) enters with an opacity-only fade —
    // the shared translateY fade would offset its sticky children while it runs (index.html .tab-panel[data-enter])
    if (!f.chrome.bottomNav) root.dataset.enter = 'opacity';
    const main = $('appMain');
    main.insertBefore(root, $('menuNav') && $('menuNav').parentNode === main ? $('menuNav') : null);
    f.root = root;
    f.navBtn = createNavButton(f);
    f.started = true;
    callHook(f, 'init', () => f.def.init && f.def.init(core));
    mountFeature(f);
  }

  /** The element a nav entry goes into: the bar / header slot, or the เมนู list of its nav.section. */
  function navSlot(f) {
    if (f.place !== 'menu') return $(NAV_SLOT[f.place] || '');
    const nav = $('menuNav');
    if (!nav) return null;
    const list = sec => nav.querySelector('[data-menu-section="' + sec + '"] [data-menu-list]');
    return (MENU_SECTIONS.indexOf(f.section) >= 0 && list(f.section)) || list('other') || nav;
  }

  function createNavButton(f) {
    const slot = navSlot(f);
    if (!slot) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = NAV_BTN[f.place];
    b.dataset.tab = f.id;
    b.dataset.navPlace = f.place;
    b.dataset.navOrder = String(f.order);
    if (f.section) b.dataset.navSection = f.section;
    const icon = f.icon ? Kit.icon(f.icon, f.place === 'bar' ? 'w-6 h-6' : 'w-5 h-5') : '';
    if (f.place === 'bar') {
      b.innerHTML = `<span class="${Kit.cls.navIcon}">${icon}</span><span class="max-w-full truncate px-1">${esc(f.title)}</span>`;
    } else if (f.place === 'header') {
      b.setAttribute('aria-label', f.title);
      b.title = f.title;
      b.innerHTML = icon || esc(f.title);
    } else {
      b.innerHTML = `<span class="${Kit.cls.listIcon} ${Kit.cls.listIconBrand}">${icon}</span>` +
        `<span class="flex-1 min-w-0">${esc(f.title)}</span>` + Kit.icon('chevron-right', Kit.cls.listChevron);
    }
    // by nav.order among the entries (and fixed rows such as เมนู's system rows) that carry data-nav-order
    const next = Array.prototype.find.call(slot.querySelectorAll('[data-nav-order]'),
      n => n.parentNode === slot && Number(n.dataset.navOrder) > f.order);
    slot.insertBefore(b, next || null);
    return b;
  }

  /** Runs one hook of a feature in isolation (sync throw or async rejection → the feature is marked broken). */
  function callHook(f, phase, fn) {
    if (f.error) return undefined;
    let r;
    try { r = fn(); } catch (e) { featureFailed(f, phase, e); return undefined; }
    if (r && typeof r.then === 'function') track(r).catch(e => featureFailed(f, phase, e));
    return r;
  }

  function featureFailed(f, phase, e) {
    console.error('[feature ' + f.id + '] ' + phase + ' failed:', e);
    if (f.error) return;
    f.error = { phase, message: (e && e.message) || String(e) };
    if (f.root && !f.legacy) {
      const html = featureErrorHtml(f);
      f.root.innerHTML = html;
      f.root._html = html;
    }
  }

  function featureErrorHtml(f) {
    return `<div class="${Kit.cls.banner} ${Kit.cls.bannerDanger}" data-feature-error="${esc(f.id)}" role="alert">` +
      `${Kit.icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>ส่วน "${esc(f.title)}" ทำงานผิดพลาด — ส่วนอื่นของแอปยังใช้งานได้ตามปกติ ลองโหลดหน้าใหม่อีกครั้ง</span></div>`;
  }

  function mountFeature(f) {
    if (f.legacy || f.mounted || f.error || !f.root) return;
    f.mounted = true;
    if (typeof f.def.mount === 'function') callHook(f, 'mount', () => f.def.mount(f.root, core));
  }

  function featureVisible(f) {
    if (!f || !f.started || !f.root) return false;
    if (f.error && f.error.phase === 'visible') return false;
    if (typeof f.def.visible !== 'function') return true;
    try { return !!f.def.visible(core); } catch (e) { featureFailed(f, 'visible', e); return false; }
  }

  function featureBadge(f) {
    if (typeof f.def.badge !== 'function') return badgeCounts[f.id] || 0;
    if (f.error) return 0;
    try { return Math.max(0, Math.floor(Number(f.def.badge(core)) || 0)); } catch (e) { featureFailed(f, 'badge', e); return 0; }
  }

  function navSorted(list) {
    return list.slice().sort((a, b) => a.order - b.order || features.indexOf(a) - features.indexOf(b));
  }

  function featureList(place) {
    return navSorted(features.filter(f => f.started && (!place || f.place === place))).map(f => Object.freeze({
      id: f.id, title: f.title, icon: f.icon, place: f.place, section: f.section, order: f.order, parent: f.parent,
      legacy: f.legacy, visible: featureVisible(f), badge: featureVisible(f) ? featureBadge(f) : 0,
      error: f.error ? f.error.phase : ''
    }));
  }

  /* ---------- screens and navigation ---------- */
  function ensureVisibleTab() {
    if (!coreStarted || featureVisible(featById[ui.tab])) return;
    ui.tab = 'station';
    ui.tabParams = undefined;
  }

  /** hide() of the screen shown before, mount()/show() of the current one (whoever changed ui.tab). */
  function syncShownFeature() {
    if (ui.shownTab === ui.tab) return;
    const prev = featById[ui.shownTab];
    const next = featById[ui.tab];
    ui.shownTab = ui.tab;
    ui.screenTitle = null;   // R3: a title set with core.setScreenTitle() belongs to the screen that set it (show() may set it again)
    if (prev && prev.id === 'leave' && isShown('confirmLeaveModal')) closeConfirmLeave();   // the sheet belongs to การลา
    if (prev && prev.id === 'leave') restoreCalPlanRange();   // R3 F-1: the plan range back around the selected date
    if (prev && !prev.legacy && typeof prev.def.hide === 'function') callHook(prev, 'hide', () => prev.def.hide(core));
    if (next && !next.legacy) {
      mountFeature(next);
      if (typeof next.def.show === 'function') callHook(next, 'show', () => next.def.show(core, ui.tabParams));
    }
  }

  function renderCurrentFeature() {
    const f = featById[ui.tab];
    if (!f || f.legacy || f.error || !f.root) return;
    mountFeature(f);
    if (typeof f.def.render === 'function') callHook(f, 'render', () => f.def.render(f.root, core));
  }

  /** Visibility and badges of every nav entry; the bottom bar gets one column per visible entry. */
  function renderNav() {
    let header = 0;
    features.forEach(f => {
      const b = f.navBtn;
      if (!b) return;
      const vis = featureVisible(f);
      setVisible(b, vis);
      if (vis && f.place === 'header') header++;
      const n = vis ? featureBadge(f) : 0;
      renderNavBadge(b, n, f.place, vis ? dotLabels[f.id] || '' : '', n ? featureBadgeLabel(f, n) : '');
    });
    // the bar is a grid-flow-col grid (UiKit.cls.navInner): one equal column per visible entry, nothing to count
    setVisible($('headerNav'), header > 0);   // a class, not the hidden attribute: .flex would override [hidden]
    renderMenuSections();
  }

  /** A count badge (n > 0), or a dot (dot = its spoken label) when there is no count; nothing otherwise. */
  /** R3 FIX-CL L-13: def.badgeLabel(n) → the badge's spoken name (e.g. "ข้อความที่ยังไม่อ่าน 4 ข้อความ"); '' = "N รายการ". */
  function featureBadgeLabel(f, n) {
    if (typeof f.def.badgeLabel !== 'function' || f.error) return '';
    try { const v = f.def.badgeLabel(n); return typeof v === 'string' ? v.trim() : ''; } catch (e) { featureFailed(f, 'badgeLabel', e); return ''; }
  }
  function renderNavBadge(btn, n, place, dot, label) {
    let el = btn.querySelector('[data-nav-badge]');
    if (!n && !dot) { if (el) el.remove(); return; }
    const kind = n ? 'count' : 'dot';
    if (el && el.dataset.navBadge !== kind) { el.remove(); el = null; }
    if (!el) {
      el = document.createElement('span');
      el.dataset.navBadge = kind;
      btn.classList.add('relative');
      const ic = place === 'bar' ? btn.querySelector('.nav-ic') : null;
      if (ic) {
        ic.classList.add('relative');
        el.className = kind === 'dot' ? NAV_BADGE_BOX.barDot : NAV_BADGE_BOX.bar;
        ic.appendChild(el);
      } else {
        el.className = NAV_BADGE_BOX[place] || NAV_BADGE_BOX.header;
        const chevron = place === 'menu' ? btn.querySelector('svg[data-icon="chevron-right"]') : null;
        btn.insertBefore(el, chevron);
      }
    }
    setHtml(el, n ? Kit.badge(n) : `<span class="${Kit.cls.navDot}" role="status" aria-label="${esc(dot)}"></span>`);
    const inner = n && label ? el.firstElementChild : null;
    if (inner && inner.getAttribute('aria-label') !== label) inner.setAttribute('aria-label', label);
  }

  /**
   * → Promise<boolean> (true when `id` is the current screen afterwards). An unknown id changes nothing; a screen
   * the user may not see opens station instead (as v2 did for staff/summary). The current feature's canLeave()
   * may ask first.
   */
  function go(id, params) {
    const want = featById[String(id)];
    if (!want || !want.started || !want.root) return Promise.resolve(false);
    const cur = featById[ui.tab];
    let leave = true;
    if (cur && cur !== want && !cur.legacy && !cur.error && typeof cur.def.canLeave === 'function') {
      try { leave = cur.def.canLeave(core); } catch (e) { featureFailed(cur, 'canLeave', e); leave = true; }
    }
    if (leave === false) return Promise.resolve(false);
    if (typeof leave === 'string' && leave) {
      const epoch = ui.epoch;   // a logout / new login while the question is open cancels the navigation
      return track(confirmUser(leave, { okLabel: 'ออกจากหน้านี้' }).then(ok => (ok && epoch === ui.epoch ? switchTo(want.id, params) : false)));
    }
    return Promise.resolve(switchTo(want.id, params));
  }

  function switchTo(id, params) {
    const target = featureVisible(featById[id]) ? id : 'station';
    if (target === ui.tab && params !== undefined) ui.shownTab = '';   // show(c, params) runs again
    ui.tab = target;
    ui.tabParams = params;
    renderTabs();
    renderChrome();
    renderBanners();
    renderCurrentFeature();
    // R3 FIX-CL2 Q-2: วันนี้ (legacy) is drawn again on arrival — a domain change made while another screen was shown (e.g.
    // the problem domain behind the "ปัญหาค้าง N" pill, changed on แจ้งปัญหา) never reached its cards
    if (ui.tab === 'station' && state.user) renderStationTab();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* ignore */ }
    return ui.tab === id;
  }

  /**
   * To the current screen's parent (default station). → Promise<boolean>; false on station.
   * R3 F-3: the current screen's def.back(c) runs first (the header ←, Android/browser back and core.back() all come here);
   * when it returns true the screen handled the back itself (e.g. the team person view returns to its list) and nothing
   * else happens.
   */
  function back() {
    const f = featById[ui.tab];
    if (screenBack(f)) return Promise.resolve(true);
    const parent = f && f.parent && featById[f.parent] ? f.parent : 'station';
    return parent === ui.tab ? Promise.resolve(false) : go(parent);
  }
  /** R3 F-3: def.back(c) of a registered screen → true only when it returned exactly true (a throw marks it broken). */
  function screenBack(f) {
    if (!f || f.legacy || f.error || typeof f.def.back !== 'function') return false;
    try { return f.def.back(core) === true; } catch (e) { featureFailed(f, 'back', e); return false; }
  }

  /* ---------- events and services ---------- */
  function onEvent(evt, fn) {
    if (typeof fn !== 'function') return () => {};
    (listeners[evt] = listeners[evt] || []).push(fn);
    return () => {
      const l = listeners[evt];
      const i = l ? l.indexOf(fn) : -1;
      if (i >= 0) l.splice(i, 1);
    };
  }

  /** Synchronous; a listener that throws (or rejects) is logged and never breaks the app flow that emitted. */
  function emit(evt, payload) {
    const l = listeners[evt];
    if (!l || !l.length) return;
    l.slice().forEach(fn => {
      try {
        const r = fn(payload, core);
        if (r && typeof r.then === 'function') track(r).catch(e => console.error('[core] "' + evt + '" listener failed:', e));
      } catch (e) {
        console.error('[core] "' + evt + '" listener failed:', e);
      }
    });
  }

  /** provide(name, fn) registers a service; provide(name, null) withdraws it (no warning; only replacing one warns). */
  function provide(name, fn) {
    // R2: a service may also be an object (js/plan-data.js provides 'plan' = its API object)
    if (typeof fn !== 'function' && !(fn && typeof fn === 'object')) { delete services[name]; return; }
    if (services[name] && services[name] !== fn) console.warn('core.provide: "' + name + '" replaced');
    services[name] = fn;
  }
  function use(name) { return services[name] || null; }
  function serverHas(name) { return serverFeatures[String(name)] === true; }

  function pollEvery(id, ms, fn) {
    id = String(id);
    if (polls[id]) polls[id]();
    const period = Math.max(1000, Number(ms) || REFRESH_EVERY_MS);
    let timer = null, stopped = false;
    const cancel = () => {
      stopped = true;
      clearTimeout(timer);
      if (polls[id] === cancel) delete polls[id];
    };
    const tick = () => {
      timer = setTimeout(() => {
        if (stopped) return;
        const run = document.visibilityState === 'visible' && !!state.session && !ui.pwForced;
        const p = run ? track(Promise.resolve().then(() => fn(core))).catch(e => {
          if (e && e.name === 'ApiError') handleError(e, { quiet: true });
          else console.error('[core] poll "' + id + '" failed:', e);
        }) : Promise.resolve();
        p.then(() => { if (!stopped) tick(); });
      }, period);
    };
    polls[id] = cancel;
    tick();
    return cancel;
  }

  /* ---------- banners, badges, station hooks ---------- */
  const BANNER_TONE = { info: Kit.cls.bannerInfo, ok: Kit.cls.bannerOk, warn: Kit.cls.bannerWarn, danger: Kit.cls.bannerDanger };

  function renderBanners() {
    const slot = $('bannerSlot');
    if (!slot) return;
    const list = Object.keys(bannerDefs).map(id => ({ id, d: bannerDefs[id] }))
      .filter(b => !Array.isArray(b.d.screens) || b.d.screens.indexOf(ui.tab) >= 0)
      .sort((a, b) => (Number(a.d.order) || 0) - (Number(b.d.order) || 0));
    slot.hidden = !list.length;
    setHtml(slot, list.map(b => {
      const d = b.d;
      const icon = d.icon ? Kit.icon(d.icon, 'w-5 h-5 mt-0.5') : '';
      const act = d.actionLabel && typeof d.action === 'function'
        ? `<button type="button" class="${Kit.cls.btn} ${Kit.cls.btnTonal} shrink-0" data-banner-action="${esc(b.id)}">${esc(d.actionLabel)}</button>` : '';
      const tone = BANNER_TONE[d.tone] || BANNER_TONE.info;
      if (!(d.dismissLabel && typeof d.onDismiss === 'function')) {
        // CL-23: from 640 px the text and the action button line up (centred) instead of the button floating mid-height
        return `<div class="${Kit.cls.banner} ${tone}${act ? ' sm:items-center' : ''}" data-banner="${esc(b.id)}" role="status">` +
          `${icon}<div class="flex-1 min-w-0 whitespace-pre-line">${esc(d.text)}</div>${act}</div>`;
      }
      // R1b: with a dismiss the row wraps on a phone — the text keeps at least 9.5rem; the action and the dismiss stay together
      // at the right. R3 FIX-CL L-8: the dismiss is the text button "ซ่อน" (no cross glyph); dismissLabel stays its spoken name
      const x = `<button type="button" class="${Kit.cls.btn} ${Kit.cls.btnGhost} ${Kit.cls.btnCompact} -mr-1.5" data-banner-dismiss="${esc(b.id)}" aria-label="${esc(d.dismissLabel)}">ซ่อน</button>`;
      return `<div class="${Kit.cls.banner} ${tone} flex-wrap" data-banner="${esc(b.id)}" role="status">` +
        `${icon}<div class="flex-1 min-w-0 basis-[9.5rem] whitespace-pre-line">${esc(d.text)}</div>` +
        `<div class="flex items-center gap-2 ml-auto shrink-0">${act}${x}</div></div>`;
    }).join(''));
  }

  function onBannerClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const x = t.closest('[data-banner-dismiss]');
    const dx = x && bannerDefs[x.dataset.bannerDismiss];
    if (dx && typeof dx.onDismiss === 'function') { spawn(() => dx.onDismiss(core)); return; }
    const b = t.closest('[data-banner-action]');
    const d = b && bannerDefs[b.dataset.bannerAction];
    if (d && typeof d.action === 'function') spawn(() => d.action(core));
  }

  const banners = Object.freeze({
    set(id, def) {
      id = String(id);
      if (def && typeof def === 'object') bannerDefs[id] = def;
      else delete bannerDefs[id];
      if (coreStarted) renderBanners();
    }
  });

  const badges = Object.freeze({
    set(id, n) {
      const v = Math.max(0, Math.floor(Number(n) || 0));
      if (v) badgeCounts[String(id)] = v;
      else delete badgeCounts[String(id)];
      if (coreStarted) renderNav();
    },
    get(id) {
      const f = featById[String(id)];
      return f && f.started && typeof f.def.badge === 'function' ? featureBadge(f) : (badgeCounts[String(id)] || 0);
    },
    /** CL-14: a dot on a nav entry (e.g. การลา while an own rejection is not dismissed); label = what it means (spoken). */
    dot(id, label) {
      const k = String(id);
      const v = label ? String(label) : '';
      if ((dotLabels[k] || '') === v) return;
      if (v) dotLabels[k] = v; else delete dotLabels[k];
      if (coreStarted) renderNav();
    }
  });

  /** Extra cards on วันนี้ (station.addPanel), each in its own element that the panel keeps between renders. */
  function renderStationPanels() {
    const box = $('stationPanels');
    if (!box) return;
    box.hidden = !panelDefs.length;
    panelDefs.forEach((p, i) => {
      if (!p.el) {
        p.el = document.createElement('div');
        p.el.dataset.panel = p.id;
      }
      if (box.children[i] !== p.el) box.insertBefore(p.el, box.children[i] || null);
      if (p.failed) return;
      try { p.render(p.el, core); } catch (e) {
        p.failed = true;
        console.error('[panel ' + p.id + '] render failed:', e);
        p.el.innerHTML = `<div class="${Kit.cls.banner} ${Kit.cls.bannerDanger}" data-panel-error="${esc(p.id)}">${Kit.icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>แสดงส่วนนี้ไม่ได้</span></div>`;
      }
    });
  }

  const station = Object.freeze({
    setProposer(fn) {
      proposer = typeof fn === 'function' ? fn : null;
      if (coreStarted) render();
    },
    /** R2: the active proposal of `date` (default: the selected date) — what the editor shows while untouched — or null. */
    proposal(date) { return currentProposal(date === undefined ? state.selectedDate : String(date)); },
    /** R2: off (default true) hides the proposal of `date` ("เริ่มจากช่องว่าง"); false shows it again. Memory only. */
    dismissProposal(date, off) {
      const d = String(date === undefined ? state.selectedDate : date);
      if (!U.isValidYmd(d)) return false;
      if (off === false) delete ui.proposalOff[d];
      else ui.proposalOff[d] = true;
      if (coreStarted) render();
      return true;
    },
    /**
     * R2: replaces the editor's content of `date` (the selected date, editable: canEditDay) with `assignments`
     * ({[stationId]: string[]}, '' = empty slot; names the date may not hold are dropped). Creates the draft (based on the
     * saved day) or replaces its slots; a result equal to the saved day drops the draft. → true, or false when refused.
     */
    applyToDraft(date, assignments) {
      const d = String(date);
      if (d !== state.selectedDate || !canEditDay(d) || !assignments || typeof assignments !== 'object') return false;
      if (state.draft && state.draft.date !== d) return false;
      const draft = ensureDraft(d);
      draft.assignments = slotsFrom(d, assignments);
      draft.fromProposal = true;   // the panel's content: a later clean draft does not bring the proposal back
      dropCleanDraft();
      render();
      return true;
    },
    /**
     * R2: `duty` ({lines, lunch, mission, missionNext, note?, baseVersion}) is sent as saveDay.duty with the next save of
     * `date` (only while the server has 'plan'); null withdraws it. Cleared after that save, on a CONFLICT, when another
     * date is selected and at logout. → true, or false for an invalid date.
     */
    setDutyPatch(date, duty) {
      const d = String(date);
      if (!U.isValidYmd(d)) return false;
      if (duty && typeof duty === 'object') ui.dutyPatch = { date: d, duty: cloneJson(duty) };
      else if (ui.dutyPatch && ui.dutyPatch.date === d) ui.dutyPatch = null;
      return true;
    },
    /** R2: the duty patch waiting for the next save of `date` (a copy), or null. */
    dutyPatch(date) {
      const d = String(date === undefined ? state.selectedDate : date);
      return ui.dutyPatch && ui.dutyPatch.date === d ? cloneJson(ui.dutyPatch.duty) : null;
    },
    /** R2: "บันทึก" of the station editor (the save bar's button): saves what the editor shows. → Promise (never rejects). */
    save() { return spawn(onSaveStation, WRITE); },
    /**
     * R2: what the station editor of `date` holds (copies): {slots (viewSlots: draft / proposal / saved day, '' = empty
     * slot), stored (the saved day as slots), planned (a saved name exists), draft (a dirty draft of the date),
     * proposal (the proposal is what it shows), editable (canEditDay), remark (as shown)}.
     */
    view(date) {
      const d = String(date === undefined ? state.selectedDate : date);
      if (!U.isValidYmd(d)) return null;
      return Object.freeze({
        slots: cloneJson(viewSlots(d)), stored: cloneJson(storedSlots(d)), planned: isPlannedDay(d),
        draft: isSup() && hasDraftFor(d) && isDraftDirty(), proposal: proposalActive(d), editable: canEditDay(d),
        remark: viewRemark(d)
      });
    },
    addPanel(def) {
      if (!def || !FEATURE_ID.test(String(def.id || '')) || typeof def.render !== 'function') {
        console.warn('core.station.addPanel: needs {id, render}');
        return false;
      }
      const old = panelDefs.findIndex(p => p.id === def.id);
      if (old >= 0) {
        if (panelDefs[old].el) panelDefs[old].el.remove();
        panelDefs.splice(old, 1);
      }
      panelDefs.push({ id: def.id, order: Number(def.order) || 0, render: def.render, el: null, failed: false });
      panelDefs.sort((a, b) => a.order - b.order);
      if (coreStarted) renderStationPanels();
      return true;
    }
  });

  /* ---------- domains (per-feature data slices with the stale-write guard) ---------- */
  function domain(name, opts) {
    name = String(name || '');
    if (!FEATURE_ID.test(name)) throw new Error('core.domain: invalid name "' + name + '"');
    if (domains[name]) return domains[name].api;
    const o = opts || {};
    const d = { name, persist: !!o.persist, empty: o.empty === undefined ? null : cloneJson(o.empty), seq: 0,
      data: null, version: '', remote: remoteVersions[name] || '', loading: false, error: null, loadingP: null, stale: [] };
    d.data = cloneJson(d.empty);
    const api = Object.freeze({
      get name() { return d.name; },
      get data() { return d.data; },
      get version() { return d.version; },
      get remote() { return d.remote; },
      get loading() { return d.loading; },
      get error() { return d.error; },
      begin() { return Object.freeze({ domain: d.name, epoch: ui.epoch, seq: d.seq }); },
      commit(ticket, version, fn) {
        if (!ticket || ticket.domain !== d.name || ticket.epoch !== ui.epoch || ticket.seq !== d.seq || !state.session) return false;
        if (typeof fn === 'function') {
          const r = fn(d.data);
          if (r !== undefined) d.data = r;
        }
        d.version = version === undefined || version === null ? '' : String(version);
        d.error = null;
        persistDomain(d);
        emit('data', { domain: d.name });
        renderForDomain(d.name);
        return true;
      },
      touch(fn) {
        d.seq++;
        if (typeof fn === 'function') {
          const r = fn(d.data);
          if (r !== undefined) d.data = r;
        }
        persistDomain(d);
        renderForDomain(d.name);
      },
      load(fetchFn) {
        if (d.loadingP) return d.loadingP;
        const ticket = api.begin();
        d.loading = true;
        d.error = null;
        let started;
        try { started = fetchFn(d.version); } catch (e) { started = Promise.reject(e); }
        const p = track(Promise.resolve(started).then(res => {
          if (res === null || res === undefined) return false;   // unchanged
          return api.commit(ticket, res.version, () => res.data);
        }, e => {
          if (ticket.epoch === ui.epoch) d.error = e;
          return false;
        }).then(ok => {
          if (d.loadingP === p) { d.loading = false; d.loadingP = null; }
          renderForDomain();
          return ok;
        }));
        d.loadingP = p;
        renderForDomain();
        return p;
      },
      onStale(fn) {
        if (typeof fn !== 'function') return () => {};
        d.stale.push(fn);
        return () => { const i = d.stale.indexOf(fn); if (i >= 0) d.stale.splice(i, 1); };
      },
      setRemote(v) {
        d.remote = v === undefined || v === null ? '' : String(v);
        if (!d.remote || d.remote === d.version) return;
        d.stale.slice().forEach(fn => {
          try { fn(api); } catch (e) { console.error('[domain ' + d.name + '] onStale listener failed:', e); }
        });
      }
    });
    domains[name] = { d, api };
    if (state.session) restoreDomain(d);
    return api;
  }

  /**
   * CL-5: a feature's data slice changed (e.g. the profile's avatar map) — only what may show it is drawn again: nav entries
   * and their badges, banners and the current registered screen. The four legacy screens never read a domain, and pictures
   * reach every avatar through UiKit.avatars.refresh, so no full render() (no replaced pickers, no lost focus or scroll).
   */
  function renderForDomain(name) {
    if (!coreStarted) return;
    renderNav();
    renderBanners();
    renderCurrentFeature();
    // R3 FIX-CL L-1: the station cards' "ปัญหาค้าง N" follows the problem domain while วันนี้ (a legacy screen) is shown
    if (name === 'problem' && ui.tab === 'station' && state.user) renderStationTab();
  }

  function persistDomain(d) {
    if (!d.persist || !state.session) return;
    lsSet(DOM_PREFIX + d.name, JSON.stringify({ user: state.session.name, v: d.version, savedAt: new Date().toISOString(), data: d.data }));
  }

  function restoreDomain(d) {
    if (!d.persist || !state.session) return;
    const s = lsGetJson(DOM_PREFIX + d.name);
    if (!s || s.user !== state.session.name) return;
    d.data = s.data === undefined ? cloneJson(d.empty) : s.data;
    d.version = typeof s.v === 'string' ? s.v : '';
  }

  /** A remembered session after a reload: persisted domains of this user come back. */
  function restoreDomains() { Object.keys(domains).forEach(n => restoreDomain(domains[n].d)); }

  function resetDomain(d) {
    d.seq++;
    d.data = cloneJson(d.empty);
    d.version = '';
    d.remote = '';
    d.loading = false;
    d.loadingP = null;
    d.error = null;
  }

  /* ---------- localStorage slices (core.store) ---------- */
  function draftKey(key) {
    const user = state.session && state.session.name;
    return user && key ? DRAFT_PREFIX + user + ':' + key : null;
  }

  const store = Object.freeze({
    draft: Object.freeze({
      get(key) { const k = draftKey(key); return k ? lsGetJson(k) : null; },
      set(key, value) {
        const k = draftKey(key);
        if (!k) return false;
        if (value === undefined || value === null || value === '') lsRemove(k);
        else lsSet(k, JSON.stringify(value));
        return true;
      },
      remove(key) { const k = draftKey(key); if (k) lsRemove(k); }
    }),
    prefs: Object.freeze({
      get(key, dflt) {
        const p = lsGetJson(PREFS_KEY);
        return p && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, key) ? p[key] : dflt;
      },
      set(key, value) {
        const cur = lsGetJson(PREFS_KEY);
        const p = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
        if (value === undefined) delete p[key];
        else p[key] = value;
        lsSet(PREFS_KEY, JSON.stringify(p));
      }
    })
  });

  /** ipd_dom:* and ipd_draft:* belong to the user who was logged in (ipd_prefs stays). */
  function clearUserStorage() {
    const keys = [];
    try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) { return; }
    keys.forEach(k => { if (typeof k === 'string' && (k.indexOf(DOM_PREFIX) === 0 || k.indexOf(DRAFT_PREFIX) === 0)) lsRemove(k); });
  }

  /* ---------- IndexedDB (core.media) ---------- */
  /** → Promise<IDBDatabase|null>; null = in-memory mode for the rest of this page load. */
  function mediaOpen() {
    if (media.mode === 'memory') return Promise.resolve(null);
    if (media.db) return Promise.resolve(media.db);
    if (media.opening) return media.opening;
    media.opening = new Promise(resolve => {
      let idb = null;
      try { idb = window.indexedDB || null; } catch (e) { idb = null; }
      if (!idb || typeof idb.open !== 'function') { resolve(null); return; }
      let req;
      try { req = idb.open(MEDIA_DB, MEDIA_DB_VERSION); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        MEDIA_STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
      };
      req.onsuccess = () => {
        const db = req.result;
        // another page (or BootApp.clearAppStorage) deletes or upgrades the database: never block it
        db.onversionchange = () => { db.close(); if (media.db === db) media.db = null; };
        db.onclose = () => { if (media.db === db) media.db = null; };
        resolve(db);
      };
      req.onerror = e => { if (e && e.preventDefault) e.preventDefault(); resolve(null); };
      // onblocked: an older connection is still open somewhere; keep waiting for it to close
    }).then(db => {
      media.opening = null;
      if (db) {
        media.db = db;
        media.mode = 'idb';
      } else {
        media.mode = 'memory';
        if (!media.mem) {
          media.mem = {};
          MEDIA_STORES.forEach(s => { media.mem[s] = new Map(); });
        }
      }
      return db;
    });
    return media.opening;
  }

  /** One tracked operation on `storeName` (IndexedDB transaction, or the in-memory map). */
  function mediaRun(storeName, write, idbFn, memFn, retried) {
    if (MEDIA_STORES.indexOf(storeName) < 0) return Promise.reject(new Error('core.media: unknown store "' + storeName + '"'));
    return track(mediaOpen().then(db => {
      if (!db) return memFn(media.mem[storeName]);
      return new Promise((resolve, reject) => {
        let tx, req;
        try {
          tx = db.transaction(storeName, write ? 'readwrite' : 'readonly');
          req = idbFn(tx.objectStore(storeName));
        } catch (e) {
          if (!retried && e && e.name === 'InvalidStateError') {   // closed meanwhile (versionchange): open again
            if (media.db === db) media.db = null;
            resolve(mediaRun(storeName, write, idbFn, memFn, true));
          } else reject(e);
          return;
        }
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error || (req && req.error) || new Error('IndexedDB error'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      });
    }));
  }

  const mediaApi = Object.freeze({
    mode() { return media.mode; },
    ready() { return track(mediaOpen()).then(() => media.mode); },
    get(storeName, key) { return mediaRun(storeName, false, s => s.get(key), m => m.get(key)); },
    put(storeName, key, value) {
      media.puts++;
      if (storeName === 'chat') lsSet(MEDIA_CHAT_MARK, '1');
      lsSet(MEDIA_USED_MARK, '1');
      return mediaRun(storeName, true, s => s.put(value, key), m => { m.set(key, value); }).then(() => undefined);
    },
    del(storeName, key) { return mediaRun(storeName, true, s => s.delete(key), m => { m.delete(key); }).then(() => undefined); },
    keys(storeName) { return mediaRun(storeName, false, s => s.getAllKeys(), m => Array.from(m.keys())); },
    clear(storeName) { return mediaRun(storeName, true, s => s.clear(), m => { m.clear(); }).then(() => undefined); }
  });

  /**
   * Per-user media never outlive the session on a shared device (R1b, R1a Review B item 7): at logout and when the
   * session expired, every store (avatars and photos in blobs, the outbox, chat) is emptied, so nothing a user uploaded
   * or queued can be shown to — or sent under the token of — the next user. Avatars are downloaded again after a login.
   */
  function wipeUserMedia() {
    if (!media.db && media.mode !== 'memory' && !lsGet(MEDIA_CHAT_MARK) && !lsGet(MEDIA_USED_MARK)) return;   // never used: do not open IndexedDB
    const puts = media.puts;
    Promise.all(MEDIA_STORES.map(st => mediaApi.clear(st))).then(() => {
      // FIX-CL CL-8: the next user may have started writing while the stores were cleared (their put runs after the clear):
      // then the marks are theirs now — erasing them would let a later expired-session start skip the wipe of their data
      if (media.puts !== puts) return;
      lsRemove(MEDIA_CHAT_MARK);
      lsRemove(MEDIA_USED_MARK);
    }, e => console.error('[core] clearing user media failed:', e));
  }

  /** R1b: the server's version of a domain (versions[name] of the heartbeat) → that domain's setRemote (its onStale fires). */
  function setRemoteVersion(name, v) {
    if (!FEATURE_ID.test(String(name))) return;
    remoteVersions[name] = v === undefined || v === null ? '' : String(v);
    if (domains[name]) domains[name].api.setRemote(remoteVersions[name]);
  }

  /* ---------- logout / new login ---------- */
  function resetCore() {
    Object.keys(domains).forEach(n => resetDomain(domains[n].d));
    Object.keys(remoteVersions).forEach(k => { delete remoteVersions[k]; });
    clearUserStorage();
    wipeUserMedia();
    Object.keys(bannerDefs).forEach(k => { delete bannerDefs[k]; });
    Object.keys(badgeCounts).forEach(k => { delete badgeCounts[k]; });
    Object.keys(dotLabels).forEach(k => { delete dotLabels[k]; });
    features.forEach(f => {
      if (f.legacy || !f.started) return;
      if (typeof f.def.reset === 'function') callHook(f, 'reset', () => f.def.reset(core));
      else if (f.root && !f.error) {
        f.root.innerHTML = '';
        f.root._html = '';
        f.mounted = false;
      }
    });
    Kit.avatars.clear();   // after the features' reset (a feature may revoke its blob: URLs there); refreshed by the listener
  }

  /**
   * R1b: UiKit.avatars is the one avatar registry. When it changes, every avatar on the page is patched in place
   * (UiKit.avatars.refresh, once per microtask for all names that changed) — no full render() per picture.
   */
  let avatarPatch = null;
  function onAvatarChange(name) {
    if (!avatarPatch) {
      avatarPatch = new Set();
      Promise.resolve().then(() => {
        const names = avatarPatch;
        avatarPatch = null;
        try {
          if (names.has(null)) Kit.avatars.refresh(document);
          else names.forEach(n => Kit.avatars.refresh(document, n));
        } catch (e) { console.error('[core] avatar refresh failed:', e); }
      });
    }
    avatarPatch.add(name === undefined ? null : name);
  }

  /** The app's modals join the UiKit sheet stack; Escape asks each modal's own close routine. */
  function registerModals() {
    const opts = {
      setupModal: { onRequestClose: () => { if (ui.setupCancelable) hideModal('setupModal'); } },
      loginModal: { dismissible: false },
      passwordModal: { onRequestClose: closePasswordModal },   // refuses while the change is forced
      transferModal: {},
      confirmLeaveModal: { onRequestClose: closeConfirmLeave },
      stationCountsModal: { onRequestClose: closeStationCountsModal },
      diagModal: {},
      dayToolsModal: { backdrop: true },
      whatsNewModal: { backdrop: true }
    };
    // focus goes to the sheet's title, not to its first input: opening a sheet must not pop the on-screen keyboard
    Object.keys(opts).forEach(id => {
      if ($(id)) Kit.sheet.register(id, Object.assign({ initialFocus: '[data-sheet-title]' }, opts[id]));
    });
    Kit.sheet.onChange(() => syncHistory());
    // when a sheet closes and its opener is gone (re-rendered, or the row left the list) with no single element replacing it,
    // focus goes to the current screen's first heading — never to another person's row (reviewer 2)
    if (typeof Kit.sheet.setFallbackFocus === 'function') Kit.sheet.setFallbackFocus(screenHeading);
  }

  /** The current screen's first heading (made focusable), or the header title. */
  function screenHeading() {
    const f = featById[ui.tab];
    const h = (f && f.root && f.root.querySelector('h1, h2, h3')) || $('headerTitle');
    if (h && !h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    return h;
  }

  /** A sheet that Escape / Android back may close (the login, a forced password change and a first setup may not). */
  function sheetDismissible(el) {
    if (!el) return false;
    if (el.id === 'loginModal') return false;
    if (el.id === 'passwordModal') return !ui.pwForced;
    if (el.id === 'setupModal') return ui.setupCancelable;
    return true;
  }

  /* ---------- app shell (R1a-B2): markup recipes, เมนู, what's new, back navigation ---------- */
  /**
   * index.html markup helpers, applied once at start: data-kit="key …" prepends the UiKit.cls recipes to the
   * element's classes; <i data-ic="name" class="…"> becomes UiKit.icon(name, class); <i data-deco="star|heart|sparkle"
   * class="…"> becomes UiKit.deco(name, class) (a small filled decoration glyph, theme v2).
   */
  function applyKit(root) {
    (root || document).querySelectorAll('[data-kit]').forEach(el => {
      if (el._kit) return;
      el._kit = true;
      const kit = el.getAttribute('data-kit').split(/\s+/).filter(Boolean).map(k => Kit.cls[k] || '').filter(Boolean).join(' ');
      const own = el.getAttribute('class');
      el.setAttribute('class', own ? kit + ' ' + own : kit);
    });
    (root || document).querySelectorAll('i[data-deco]').forEach(el => {
      const tpl = document.createElement('template');
      tpl.innerHTML = Kit.deco ? Kit.deco(el.getAttribute('data-deco'), el.getAttribute('class') || '') : '';
      if (tpl.content.firstElementChild) el.replaceWith(tpl.content.firstElementChild); else el.remove();
    });
    (root || document).querySelectorAll('i[data-ic]').forEach(el => {
      const tpl = document.createElement('template');
      tpl.innerHTML = Kit.icon(el.getAttribute('data-ic'), el.getAttribute('class') || '');
      if (tpl.content.firstElementChild) el.replaceWith(tpl.content.firstElementChild);
    });
  }

  /** The เมนู screen: a registered feature (App.register) whose markup lives in index.html (#menuContent). */
  const MENU_DEF = {
    id: 'menu', title: 'เมนู', icon: 'menu',
    nav: { place: 'bar', order: 90 },
    // the sum of the badges of the entries it holds (e.g. approvals from R1b on)
    badge: () => featureList('menu').reduce((n, f) => n + (f.visible ? f.badge : 0), 0),
    mount(root) {
      const el = $('menuContent');
      if (!el) return;
      root.appendChild(el);
      el.hidden = false;
    },
    reset() {   // nothing of the previous user may stay in the DOM of a shared device (render rewrites the rest)
      if (!hasMarkup(MENU_IDS)) return;
      setHtml($('menuAvatar'), '');
      $('menuName').textContent = '-';
      $('menuGroup').textContent = '-';
      setHtml($('menuRole'), '');
    }
  };

  /**
   * "มีอะไรใหม่" — edit this one structure for every release. Shown from เมนู at any time, and once per version after
   * an update (never on a first-ever login on a device) unless APP_CONFIG.WHATS_NEW === false. An item with `sup: true`
   * is listed only for the Supervisor (R3 FIX-CL L-8: staff cannot open Dashboard ทีม).
   */
  // R4.1 (WHATS_NEW 3.4.1, owner request 2026-11-27): the new item first; the items of 3.4 and 3.3 stay below for phones
  // that skip those releases
  const WHATS_NEW = Object.freeze({
    version: '3.4.1',
    title: 'มีอะไรใหม่',
    subtitle: 'เวอร์ชัน 3.4.1 — รูปตารางเวรในทุกหัวข้อ',
    items: Object.freeze([
      { icon: 'image', title: 'รูปตารางเวรในทุกหัวข้อ', text: 'ตารางเวร: แต่ละหัวข้อแสดงรูปตารางแบบของหน่วยงาน พร้อมปุ่มบันทึกรูป PNG — แตะรูปเพื่อดูขนาดเต็ม · ของฉัน มีรูป ตารางเวรของฉัน (สาย Portable เวรกลางวัน ภารกิจพิเศษ และวันลาของคุณทั้งเดือน) · ตารางแบบรายการอยู่ใต้ปุ่ม ดูแบบรายการ' },
      { icon: 'school', title: 'ตารางวนเทคใหม่', text: 'เมนู → ตารางฝึกงาน: ตารางวน IPD/OPD 6 เดือนของเทคใหม่ (IPD · Portable · ER) และส่งออกเป็นรูปแบบตารางของหน่วยงาน — เทคที่ฝึกอยู่ขึ้นในการ์ด Station ของวันนี้' },
      { icon: 'users', title: 'ตารางหมุนเวียนนักศึกษาฝึกงาน', text: 'Supervisor จัดนักศึกษาหลายมหาวิทยาลัยพร้อมกัน IPD (IPD, ER, Portable) และ OPD อย่างละครึ่ง นับเฉพาะวันทำการ — ดูได้ว่าวันไหนใครอยู่ที่ไหน' },
      { icon: 'image', title: 'ส่งออกตารางเวรเป็นรูป', text: 'ตารางเวร → ส่งออกเป็นรูป: รูปแบบตารางของหน่วยงาน 5 แบบ — ตารางรายชื่อประจำ Station, Portable, ภารกิจพิเศษ, เวรกลางวัน X-RAY IPD และ ER เป็นไฟล์ PNG' },
      { icon: 'clock', title: 'เวรกลางวันเทค 2 คน', text: 'เวรกลางวันใส่เทคคนที่ 2 และจุดประจำได้ (เช่น ER, ภูมิ 2) — ขึ้นในตาราง กลางวัน และในเวรของฉัน' }
    ])
  });
  const WHATS_NEW_SEEN = 'whatsNewSeen';   // core.store.prefs key: the version whose notes were shown on this device

  function openWhatsNew() {
    $('whatsNewTitle').textContent = WHATS_NEW.title;
    $('whatsNewVersion').textContent = WHATS_NEW.subtitle;
    const tones = [Kit.cls.listIconBrand, Kit.cls.listIconInfo, Kit.cls.listIconLilac, Kit.cls.listIconSun];
    setHtml($('whatsNewList'), WHATS_NEW.items.filter(it => !it.sup || isSup()).map((it, i) =>
      `<li class="flex items-start gap-3"><span class="${Kit.cls.listIcon} ${tones[i % tones.length] || ''}">${Kit.icon(it.icon, 'w-5 h-5')}</span>` +
      `<div class="min-w-0 flex-1"><p class="font-display text-[0.9375rem] font-medium leading-6 text-ink-900">${esc(it.title)}</p>` +
      `<p class="text-sm leading-6 text-slate-600">${esc(it.text).split('Google Sheet ของหน่วย').join('<span class="whitespace-nowrap">Google Sheet ของหน่วย</span>').split('ข้อมูลผู้ป่วย').join('<span class="whitespace-nowrap">ข้อมูลผู้ป่วย</span>')}</p></div></li>`).join(''));
    showModal('whatsNewModal');
  }

  /**
   * After a login / an app start with a session: the notes of this version, once. A device without a recorded
   * version is new to the app unless it was used before this version (a v2.2 session or cache was found at start),
   * so a first-ever login records the version silently.
   */
  function maybeShowWhatsNew() {
    if (cfg().WHATS_NEW === false || !state.session || ui.pwForced || Kit.sheet.top()) return;
    const seen = store.prefs.get(WHATS_NEW_SEEN, '');
    if (seen === WHATS_NEW.version) return;
    store.prefs.set(WHATS_NEW_SEEN, WHATS_NEW.version);
    if (seen || ui.usedBefore) openWhatsNew();
  }

  /*
   * Android back / browser back (APP_CONFIG.HISTORY_NAV !== false): while there is something to go back from — a
   * sheet that may be closed, or a screen other than วันนี้ — one extra history entry ("guard") is kept; a back
   * press pops it, handleBack() closes the top sheet or goes to the screen's parent, and a new guard is pushed if
   * there is still something to go back from. A guard that is no longer needed is popped again (ignored pop).
   */
  const hist = { guard: false, ignore: 0 };
  function historyOn() {
    return cfg().HISTORY_NAV !== false && !!window.history && typeof window.history.pushState === 'function';
  }
  function canGoBack() {
    const top = Kit.sheet.top();
    if (top) return sheetDismissible(top);
    return !!state.session && ui.tab !== 'station';
  }
  function syncHistory() {
    if (!historyOn()) return;
    const need = canGoBack();
    try {
      if (need && !hist.guard) {
        window.history.pushState({ ipdShell: 1 }, '');
        hist.guard = true;
      } else if (!need && hist.guard) {
        hist.guard = false;
        hist.ignore++;
        window.history.back();
      }
    } catch (e) { /* history unavailable (sandboxed frame): back simply leaves the page */ }
  }

  /** One "back": the top sheet closes (if it may), else the current screen returns to its parent. → Promise<bool> */
  function handleBack() {
    const top = Kit.sheet.top();
    if (top) return Promise.resolve(sheetDismissible(top) && Kit.sheet.closeTop());
    if (!state.session || ui.tab === 'station') return Promise.resolve(false);
    return back();
  }

  /** The popstate listener (attached only with HISTORY_NAV on; tests call it directly). */
  function onPopState(e) {
    const onGuard = !!(e && e.state && e.state.ipdShell);
    if (hist.ignore > 0) {
      hist.ignore--;
      hist.guard = onGuard;
      syncHistory();
      return Promise.resolve(false);
    }
    hist.guard = onGuard;
    return track(handleBack()).then(done => { syncHistory(); return done; });
  }

  /** The password show/hide eye of the login screen. */
  function toggleLoginPassword() {
    const input = $('loginPassword'), btn = $('loginPwToggle');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    btn.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
    setHtml(btn, Kit.icon(show ? 'eye-off' : 'eye', 'w-5 h-5'));
  }

  function resetLoginPasswordToggle() {
    if ($('loginPassword').type !== 'password') toggleLoginPassword();
  }

  const core = Object.freeze({
    apiLevel: API_LEVEL,
    U, Api, Kit, state,
    isSup, myName, staff: () => state.staff.slice(), serverHas, serverMode: () => ui.serverMode,
    spawn, track, alive: sessionAlive,
    call: (action, params, opts) => Api.call(action, params, opts), userCall, withBusy,
    requireInternet, handleError, toast, confirm: confirmUser, prompt: promptUser,
    esc, setHtml, setVisible, render: () => render(),
    go, back, current: () => ui.tab, features: featureList,
    selectedDate: () => state.selectedDate,
    setSelectedDate: date => track(setSelectedDate(date)),
    ensureRange, dayView, leavesOn, leaveList, leaveLines, isAbsent: U.isAbsent, saveFile,
    shareImage: (node, filename, opts) => track(shareImage(node, filename, opts)),
    // R2 (I2): the station-counts sheet (Supervisor; the same routine as วันนี้'s button) and a heartbeat now (the window of
    // the selected date is read again: versions → domains such as 'plan' refetch) → Promise<bool>, never rejects
    // R2 FIX I-8: the one wording of the 3.0-server notice (เมนู's note; the settings empty state uses the same text)
    // R3: serverV32 — the 3.1-server notice (features with 'plan' but without 'chat'); both name Code.gs 3.2
    messages: Object.freeze({ serverV31: MSG.serverV31, serverV32: MSG.serverV32 }),
    setScreenTitle,
    openStationCounts: () => openStationCountsModal(),
    refresh: () => refresh({ silent: true }),
    // R2: setPlanSettings' answer ({planPriority, planSlotOrder}) → state.rules (and the offline copy); → changed?
    applyRules: rules => {
      if (!rules || typeof rules !== 'object' || !applyRules(rules)) return false;
      persistCache();
      render();
      return true;
    },
    applyLeaveResult: (res, at) => applyLeaveWrite(res, at), openLeave: (date, staff) => track(openLeaveFor(date, staff)),
    openPasswordChange,
    domain, store, media: mediaApi,
    poll: Object.freeze({ every: pollEvery }),
    on: onEvent, provide, use,
    station, banners, badges
  });

  LEGACY_SCREENS.forEach(def => addFeature(def, true));
  register(MENU_DEF);
  window.App.core = core;
  window.App.register = register;
  /** Shell internals for tests/debugging: the back logic and the release notes. */
  window.App.shell = Object.freeze({ onPopState, handleBack, openWhatsNew, whatsNew: WHATS_NEW });

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */
  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
  function onEnter(id, fn) { on(id, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fn(); } }); }

  let hadKeyboard = false;   // the last interaction was a key press (for the header date's focus ring)
  function bindEvents() {
    // setup / login / password
    on('setupSaveBtn', 'click', () => spawn(onSetupSave));
    onEnter('setupApiUrl', () => spawn(onSetupSave));
    on('setupCancelBtn', 'click', () => { if (ui.setupCancelable) hideModal('setupModal'); });
    on('loginBtn', 'click', () => spawn(handleLogin));
    onEnter('loginPassword', () => spawn(handleLogin));
    on('loginReloadBtn', 'click', () => { showLoginError(''); reloadLoginUsers(); });
    on('loginSettingsLink', 'click', () => openSetupModal(true));
    on('loginDiagLink', 'click', openDiag);
    on('setupDiagLink', 'click', openDiag);
    on('pwSaveBtn', 'click', () => spawn(onPwSave));
    ['pwOld', 'pwNew', 'pwConfirm'].forEach(id => onEnter(id, () => spawn(onPwSave)));
    on('pwCancelBtn', 'click', closePasswordModal);
    on('pwLogoutBtn', 'click', () => { doLogout(); toast('🚪 ออกจากระบบเรียบร้อย'); });

    on('loginPwToggle', 'click', toggleLoginPassword);

    // header, week strip, save bar, เมนู
    on('headerAvatarBtn', 'click', () => spawn(() => go('menu')));
    on('headerBackBtn', 'click', () => spawn(back));
    on('weekDays', 'click', onWeekDayClick);
    on('dayToolsBtn', 'click', openDayTools);
    // a picked day tool closes the sheet; the tool's own handler (bound to its id below) does the work
    on('dayToolsModal', 'click', e => {
      const t = e.target && e.target.closest ? e.target.closest('[data-day-tool]') : null;
      if (t && t.getAttribute('aria-disabled') !== 'true') hideModal('dayToolsModal');   // a disabled tool explains and stays
    });
    on('dayToolsCloseBtn', 'click', () => hideModal('dayToolsModal'));
    on('toast', 'click', hideToast);
    on('menuPasswordBtn', 'click', openPasswordChange);   // the same routine as the profile screen's button
    on('menuProfileHead', 'click', onMenuProfileOpen);
    on('menuProfileHead', 'keydown', onMenuProfileOpen);
    on('menuDiagBtn', 'click', openDiag);
    on('menuWhatsNewBtn', 'click', openWhatsNew);
    on('whatsNewOkBtn', 'click', () => hideModal('whatsNewModal'));
    // the close button (chevron-down) of a sheet's title row: dismisses the top sheet exactly like Escape (its own close routine)
    document.addEventListener('click', e => {
      if (e.target && e.target.closest && e.target.closest('[data-sheet-close]')) Kit.sheet.closeTop();
    });
    on('refreshBtn', 'click', () => spawn(() => onRefreshClick($('refreshBtn'), '…')));
    on('syncStatus', 'click', openDiag);
    on('offlineRetryBtn', 'click', () => spawn(() => onRefreshClick($('offlineRetryBtn'), 'กำลังลองใหม่…')));
    on('offlineDiagBtn', 'click', openDiag);
    on('prevDayBtn', 'click', () => spawn(() => setSelectedDate(U.addDays(state.selectedDate, -1))));
    on('nextDayBtn', 'click', () => spawn(() => setSelectedDate(U.addDays(state.selectedDate, 1))));
    on('currentDate', 'change', e => spawn(() => setSelectedDate(e.target.value)));
    on('summaryImageDate', 'change', e => spawn(() => setSelectedDate(e.target.value)));
    // the Buddhist-era caption follows every date input as it is edited (also the ones not bound to the selected date)
    ['summaryStartDate', 'summaryEndDate', 'exportStartDate', 'exportEndDate', 'leaveTargetDate', 'summaryImageDate']
      .forEach(id => { on(id, 'input', renderBeCaptions); on(id, 'change', renderBeCaptions); });
    // keyboard focus on the header date picker draws a ring around the date (some engines do not match :has())
    on('currentDate', 'focus', () => { const m = $('headerMain'); if (m && hadKeyboard) m.classList.add('kbd-focus'); });
    on('currentDate', 'blur', () => { const m = $('headerMain'); if (m) m.classList.remove('kbd-focus'); });
    document.addEventListener('keydown', e => { if (e.key === 'Tab') hadKeyboard = true; }, true);
    document.addEventListener('pointerdown', () => { hadKeyboard = false; }, true);
    on('logoutBtn', 'click', () => spawn(onLogoutClick));
    on('updateBanner', 'click', () => location.reload());

    // connection check
    on('diagRunBtn', 'click', () => spawn(runDiag));
    on('diagCopyBtn', 'click', () => spawn(onDiagCopy));
    on('diagCloseBtn', 'click', () => hideModal('diagModal'));

    // station tab
    on('stationsContainer', 'change', onStationChange);
    on('stationsContainer', 'click', onStationClick);   // R3: the station card's "แจ้งปัญหา" button
    on('dailyRemark', 'input', onRemarkInput);
    on('dailyRemark', 'change', onRemarkInput);
    on('stationSaveBtn', 'click', () => spawn(onSaveStation, WRITE));
    on('stationCountsBtn', 'click', openStationCountsModal);
    on('stationCountsList', 'click', onCountStep);
    on('stationCountsCancelBtn', 'click', closeStationCountsModal);
    on('stationCountsSaveBtn', 'click', () => spawn(onSaveStationCounts, WRITE));

    // leave tab
    on('summaryBtn', 'click', () => spawn(onSummary));
    on('leaveTargetDate', 'change', e => spawn(() => setSelectedDate(e.target.value)));
    on('groupFilterBar', 'click', e => { const b = e.target.closest && e.target.closest('.grp-btn'); if (b) setFilter(b.dataset.f); });
    on('leaveCalendarCard', 'click', onCalendarClick);
    on('leaveContainer', 'click', onLeaveRowClick);
    on('myLeaveRow', 'click', onLeaveRowClick);
    on('leaveOptions', 'click', onLeaveOptionClick);
    on('confirmLeaveCancelBtn', 'click', closeConfirmLeave);
    on('confirmLeaveBtn', 'click', () => spawn(onConfirmLeave, WRITE));
    on('confirmLeaveText', 'click', onLeaveSheetAction);
    on('leaveTimePresets', 'click', onLeaveTimePreset);
    ['leaveTimeStart', 'leaveTimeEnd'].forEach(id => { on(id, 'input', onLeaveTimeInput); on(id, 'change', onLeaveTimeInput); on(id, 'blur', markEmptyTimes); });
    on('myRequestsList', 'click', onMyRequestClick);

    // staff tab
    on('openTransferBtn', 'click', openTransferModal);
    on('transferTargetSelect', 'change', renderTransferBtn);
    on('transferCancelBtn', 'click', () => hideModal('transferModal'));
    on('transferConfirmBtn', 'click', () => spawn(onTransfer, WRITE));
    on('addStaffBtn', 'click', () => spawn(onAddStaff, WRITE));
    onEnter('newStaffName', () => spawn(onAddStaff, WRITE));
    on('staffListContainer', 'click', onStaffListClick);
    on('importBtn', 'click', () => spawn(onImport, WRITE));
    on('clearLegacyBtn', 'click', () => spawn(onClearLegacy));

    // summary tab
    on('exportBtn', 'click', () => spawn(onExport));
    on('copyDayBtn', 'click', onCopyDay);
    on('pasteDayBtn', 'click', () => spawn(onPasteDay, WRITE));
    on('shareImgBtn', 'click', () => spawn(onShareImage));
    on('saveImgBtn', 'click', () => spawn(onSaveImage));
    on('clearDayBtn', 'click', () => spawn(onClearDay, WRITE));

    // navigation: every nav entry of every registered screen, wherever it sits (bottom bar, header, menu)
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('.nav-btn[data-tab]') : null;
      if (b) spawn(() => go(b.dataset.tab));
    });
    on('bannerSlot', 'click', onBannerClick);

    // global — Escape is handled by the UiKit sheet stack (registerModals): it closes only the top modal
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      emit('visible', {});
      if (!state.session) { if (isShown('loginModal')) reloadLoginUsers(); return; }
      if (!state.lastSync || Date.now() - state.lastSync > STALE_AFTER_MS) refresh({ silent: true });
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && state.session && !ui.pwForced) refresh({ silent: true });
    }, REFRESH_EVERY_MS);
    window.addEventListener('online', () => {
      emit('online', {});
      if (state.session) refresh({ silent: true });
      else if (isShown('loginModal')) reloadLoginUsers();
    });
    window.addEventListener('offline', () => setConn('offline', 'device'));
    window.addEventListener('beforeunload', e => {
      if (isDraftDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('resize', syncLayout);
    if (typeof ResizeObserver === 'function') {
      try {
        const ro = new ResizeObserver(syncLayout);
        ['appHeader', 'saveBar', 'navDock'].forEach(id => { if ($(id)) ro.observe($(id)); });
      } catch (e) { /* ignore */ }
    }
    if (historyOn()) {
      // a reload on a guard entry: the next syncHistory() pops it when there is nothing to go back from
      hist.guard = !!(window.history.state && window.history.state.ipdShell);
      window.addEventListener('popstate', onPopState);
    }
  }

  function initDateInputs() {
    const m = U.monthRange(U.todayStr());
    $('summaryStartDate').value = m.from;
    $('summaryEndDate').value = m.to;
    $('exportStartDate').value = m.from;
    $('exportEndDate').value = m.to;
    renderBeCaptions();
  }

  function registerServiceWorker() {
    if (cfg().DISABLE_SW === true) return;
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const go = () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  /** CL-7: a v2 offline copy moves to the v3 key once (when it is the newer copy) and the old key goes. */
  function migrateCacheKey() {
    const old = lsGet(LS.cacheV2);
    if (old === null) return;
    // both exist after a web rollback (v2.9 wrote the v2 key) and a roll-forward: the newer copy by its savedAt wins — it is
    // only a cache (reviewer 2 finding 8)
    const cur = lsGet(LS.cache);
    const savedAt = s => { try { const t = Date.parse(JSON.parse(s).savedAt); return isNaN(t) ? 0 : t; } catch (e) { return 0; } };
    if (cur === null || savedAt(old) > savedAt(cur)) lsSet(LS.cache, old);
    lsRemove(LS.cacheV2);
  }

  function init() {
    LEGACY_SECRET_KEYS.forEach(lsRemove);
    migrateCacheKey();
    ui.usedBefore = !!(lsGet(LS.session) || lsGet(LS.cache));   // the app was used on this device before this start
    applyKit();
    watchWebFonts();
    ui.summaryPlaceholder = $('leaveSummaryContent').innerHTML;
    registerModals();
    bindEvents();
    initDateInputs();
    Api.onActivity(() => renderSyncStatus());
    Api.onStatus(onApiStatus);
    Api.onAuthError = onSessionError;
    Kit.avatars.onChange(onAvatarChange);
    if (deviceOffline()) setConn('offline', 'device');
    startCore();   // attaches the registered screens (legacy four + feature files loaded before init)
    render();
    syncLayout();
    registerServiceWorker();
    watchForUpdate();
    spawn(startup).then(() => { render(); resolveReady(); bootSucceeded(); maybeShowWhatsNew(); });
  }

  /** A good start ends the boot guard's automatic-reload budget (see the boot guard at the top of this file). */
  function bootSucceeded() {
    const boot = window.__ipdBoot;
    // the inline guard shows (or is about to show) its message, e.g. the stylesheet did not load or is v2.2's
    if ($('bootUpdate') || (boot && typeof boot.healthy === 'function' && !boot.healthy())) return;
    try { sessionStorage.removeItem(BOOT_RETRY_KEY); } catch (e) { /* ignore */ }
  }

  U.onReady(init);
})();
