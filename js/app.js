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
 * ===================================================================== */
(function () {
  'use strict';

  const U = window.Utils;
  const Api = window.Api;

  /* ------------------------------------------------------------------ */
  /* constants                                                           */
  /* ------------------------------------------------------------------ */
  const LS = { apiUrl: 'ipd_api_url', session: 'ipd_session', cache: 'ipd_cache_v2' };
  const LEGACY_KEYS = ['rad_schedules', 'rad_staff', 'rad_passwords', 'rad_supervisor_single', 'rad_current_user'];
  const LEGACY_SECRET_KEYS = ['rad_passwords', 'rad_current_user'];   // plaintext passwords; the import never needs them
  const ALL = '__ALL__';               // "everyone" in the summary/export pickers (reserved: never a staff name)
  const GONE = 'gone';                 // group of people who appear in the data but are no longer active
  const GONE_LABEL = ' (ลบแล้ว)';
  const MAX_CHUNK_DAYS = 400;          // server limit per getData call (inclusive)
  const MAX_REPORT_DAYS = 731;         // summary / export range cap (≈ 2 years)
  const REFRESH_EVERY_MS = 90000;      // background refresh while visible
  const STALE_AFTER_MS = 30000;        // refresh on focus when older than this
  const REMARK_MAX = 2000;
  const BLOB_URL_TTL_MS = 40000;       // a download prompt may wait for the user before it reads the blob URL

  const MSG = {
    offline: 'ออฟไลน์อยู่ — ยังบันทึกไม่ได้',
    sessionExpired: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    discardDraft: 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขหรือไม่?',
    conflict: 'ข้อมูลวันนี้ถูกแก้ไขจากเครื่องอื่นแล้ว\nกด OK เพื่อบันทึกทับด้วยข้อมูลของคุณ หรือ Cancel เพื่อโหลดข้อมูลล่าสุด',
    leaveSaved: '✅ บันทึกสถานะสำเร็จ',
    supOnly: '⚠️ เฉพาะ Supervisor เท่านั้น',
    ownLeaveOnly: '⚠️ คุณสามารถแก้ไขวันลาได้เฉพาะของตนเองเท่านั้น',
    notLoaded: '⏳ ยังไม่มีข้อมูลล่าสุดของวันนี้ กรุณารอให้โหลดเสร็จ (หรือกด 🔄)',
    setupNetwork: 'เชื่อมต่อไม่ได้ — ตรวจสอบอินเทอร์เน็ต หรือ URL / การตั้งค่า Who has access ต้องเป็น Anyone',
    transferSaveFirst: 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก\nกด OK เพื่อบันทึกก่อนโอนสิทธิ์ หรือ Cancel เพื่อเลือกทิ้งการแก้ไข',
    transferDiscard: 'ทิ้งการแก้ไข Station ที่ยังไม่ได้บันทึก แล้วโอนสิทธิ์ต่อใช่หรือไม่?',
    shareFailed: '⚠️ แชร์ไฟล์ไม่สำเร็จ — ดาวน์โหลดไฟล์แทนแล้ว'
  };

  const LOADING_HTML = '<div class="bg-white p-6 rounded-2xl shadow-sm text-center text-xs text-slate-400 italic" data-loading="1">⏳ กำลังโหลดข้อมูล…</div>';
  const MISSING_HTML = '<div class="bg-white p-6 rounded-2xl shadow-sm text-center text-xs text-slate-500" data-missing="1">📭 ยังไม่มีข้อมูลของวันนี้ในเครื่อง — กด 🔄 เพื่อโหลดอีกครั้ง</div>';
  const CHIP_BASE = 'lv-chip px-2.5 py-1.5 rounded-lg text-[11px] font-medium ';
  const GRP_BASE = 'grp-btn shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ';

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
    leaves: {},               // {[date]: {[name]: Leave}} — name maps have no prototype (see nameMap)
    loaded: [],               // merged [{from, to}] ranges fetched from the server this session
    selectedDate: U.todayStr(),
    draft: null,              // {date, baseVersion, assignments:{[stationId]: string[count]}, remark}
    filter: 'all',
    clipboard: null,          // {fromDate, assignments, remark}
    online: true,
    lastSync: null,           // ms timestamp of the last successful getData
    audit: {}                 // {[date]: Audit[]}
  };

  const ui = {
    tab: 'station',
    epoch: 0,                 // bumps on login/logout → late responses from an old session are dropped
    pending: 0,               // tracked async flows (for App.idle)
    fetchingRanges: [],       // [{from, to}] of getData calls in progress (loading placeholders)
    rangeReqs: {},            // in-flight getData chunks keyed "from|to"
    refreshing: null,
    writeSeq: 0,              // increments on every local write merge
    touched: {},              // {[date]: writeSeq} — protects fresh writes from stale getData responses
    staffSeq: 0,              // increments on every own staff/role/user write — same protection for staff & roles
    dayBusy: null,            // date whose Day write (save / paste / clear) is in flight: its editor is locked
    cacheLoaded: [],          // ranges present in the offline cache (display only)
    cacheSavedAt: null,
    apiUrlSource: '',         // 'config' | 'local' | ''
    loginUsers: [],
    loginUsersLoading: false,
    loginUsersError: '',
    loginUsersPromise: null,
    pwForced: false,
    setupCancelable: false,
    pendingLeave: null,       // {staff, date, type}
    leaveSaving: false,
    auditLoading: {},
    auditFailed: {},
    staffBusy: false,
    staffSig: null,
    importResult: null,
    legacyKey: null,
    legacy: null,
    summaryPlaceholder: '',
    toastTimer: null
  };

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  /** Test/debug handle (SPEC §6.9). Defined before init so harnesses can find it early. */
  window.App = {
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
  function showModal(id) { const m = $(id); if (!m) return; m.classList.remove('hidden'); m.classList.add('flex'); m.style.display = ''; }
  function hideModal(id) { const m = $(id); if (!m) return; m.classList.add('hidden'); m.classList.remove('flex'); }
  function isShown(id) { const m = $(id); return !!m && !m.classList.contains('hidden'); }

  /** Replace innerHTML only when the markup actually changed (no DOM churn on no-op renders). */
  function setHtml(el, html) {
    if (!el) return;
    if (el._html === html) return;
    el.innerHTML = html;
    el._html = html;
  }

  function toast(msg, ms) {
    const t = $('toast');
    if (!t) return;
    t.textContent = String(msg == null ? '' : msg);
    t.style.opacity = '1';
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => { t.style.opacity = '0'; }, ms || 2200);
  }

  /** Disable a button and show a busy label while fn runs. */
  async function withBusy(btn, label, fn) {
    if (!btn) return fn();
    if (btn.dataset.busy === '1') return undefined;
    const html = btn.innerHTML;
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = label || '…';
    try { return await fn(); }
    finally {
      btn.innerHTML = html;
      btn.disabled = false;
      delete btn.dataset.busy;
      btn.removeAttribute('aria-busy');
      renderDayControls();   // some buttons also stay disabled while their day is not loaded
    }
  }

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
  /** Run an async handler (synchronously started), track it, and route errors to handleError. */
  function spawn(fn) {
    let p;
    try { p = fn(); } catch (e) { p = Promise.reject(e); }
    return track(p).catch(e => handleError(e));
  }

  function idle() {
    return new Promise(resolve => {
      const check = () => {
        if (Api.inflight === 0 && ui.pending === 0) resolve();
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

  /**
   * Saved assignments for a date as fixed-size slots ('' = empty). People deleted since are kept: the day is
   * history, and the server accepts them on that date as long as they are already saved there (A4).
   */
  function storedSlots(date) {
    const day = state.days[date];
    const out = {};
    U.STATIONS.forEach(st => {
      const names = ((day && day.assignments[st.id]) || []).slice(0, st.count);
      out[st.id] = Array.from({ length: st.count }, (_, i) => names[i] || '');
    });
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
  /** What the station editor shows: the supervisor's draft if any, otherwise the saved day. */
  function viewSlots(date) { return (isSup() && hasDraftFor(date)) ? state.draft.assignments : storedSlots(date); }
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

  function ensureDraft(date) {
    if (hasDraftFor(date)) return state.draft;
    state.draft = { date, baseVersion: currentVersion(date), assignments: storedSlots(date), remark: storedRemark(date) };
    return state.draft;
  }

  function removeFromDraft(name) {
    if (!state.draft) return;
    Object.keys(state.draft.assignments).forEach(k => {
      state.draft.assignments[k] = state.draft.assignments[k].map(n => (n === name ? '' : n));
    });
    if (!isDraftDirty()) state.draft = null;
  }

  /** The saved day the draft was started from, while the local copy still is that version (for rebaseDraft). */
  function draftBase() {
    const day = state.draft && state.days[state.draft.date];
    return day && day.version === state.draft.baseVersion ? day : null;
  }

  /**
   * Our own write (auto-unassign by setLeave, deleteStaff) removed `name` from the draft's day on the server.
   * When the stored day is now exactly `base` minus that name, the draft already contains that change: move
   * it onto the new version so the next save is not a false "edited on another device" CONFLICT.
   */
  function rebaseDraft(name, base) {
    const now = base && hasDraftFor(base.date) ? state.days[base.date] : null;
    if (!now || now.version !== base.version + 1 || now.remark !== base.remark) return;
    const same = U.STATIONS.every(st =>
      JSON.stringify(base.assignments[st.id].filter(n => n !== name)) === JSON.stringify(now.assignments[st.id]));
    if (same) state.draft.baseVersion = now.version;
  }

  /** Leaves of ACTIVE staff on a date, in server order: {[name]: Leave}. */
  function activeLeaves(date) {
    const map = leavesOn(date);
    const act = activeSet();
    const out = nameMap();
    Object.keys(map).forEach(n => { if (act.has(n) && map[n] && map[n].type) out[n] = map[n]; });
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
      Object.keys(leavesOn(date)).forEach(note);
    });
    return state.staff.concat(gone.map(name => ({ name, group: GONE })));
  }
  function personLabel(s) { return s.group === GONE ? s.name + GONE_LABEL : s.name; }

  function markTouched(date) { ui.writeSeq++; ui.touched[date] = ui.writeSeq; }

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

  /** Guard for day writes: the date's fresh data must be loaded and no other write of that day in flight. */
  function requireDayReady(date) {
    if (dayView(date) !== 'ready') { toast(MSG.notLoaded); return false; }
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
    if (exp !== null && exp <= Date.now()) { lsRemove(LS.session); return null; }
    return { token: s.token, name: s.name, expiresAt: s.expiresAt };
  }
  function saveSession(s) { lsSet(LS.session, JSON.stringify(s)); }

  function persistCache() {
    if (!state.session || !state.user) return;
    lsSet(LS.cache, JSON.stringify({
      savedAt: new Date().toISOString(),
      user: state.user, supervisor: state.supervisor, staff: state.staff,
      days: state.days, leaves: state.leaves, loaded: state.loaded
    }));
  }

  /** Render immediately from the offline cache (if it belongs to this user). */
  function restoreCache(name) {
    const c = lsGetJson(LS.cache);
    if (!c || !c.user || c.user.name !== name) return false;
    state.user = Object.assign({}, c.user);
    state.supervisor = typeof c.supervisor === 'string' ? c.supervisor : '';
    state.staff = orderStaff(c.staff);
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
    return true;
  }

  function clearDataState() {
    state.user = null;
    state.supervisor = '';
    state.staff = [];
    state.days = {};
    state.leaves = {};
    state.loaded.length = 0;
    state.draft = null;
    state.clipboard = null;
    state.audit = {};
    state.lastSync = null;
    ui.cacheLoaded = [];
    ui.cacheSavedAt = null;
    ui.touched = {};
    ui.rangeReqs = {};
    ui.auditLoading = {};
    ui.auditFailed = {};
    ui.pendingLeave = null;
    ui.importResult = null;
    ui.staffSig = null;
    ui.dayBusy = null;
    resetUserUi();
  }

  /**
   * Markup that is written once (summary result, audit, staff list, import result, dialogs' inputs) would
   * otherwise keep the previous user's data on a shared device; everything else re-renders from state.
   */
  function resetUserUi() {
    setHtml($('leaveSummaryContent'), ui.summaryPlaceholder);
    setHtml($('auditLogContent'), '');
    setHtml($('staffListContainer'), '');
    setHtml($('importResult'), '');
    $('transferTargetSelect').innerHTML = '<option value="">-- เลือกผู้รับสิทธิ์ --</option>';
    ['newStaffName', 'newStaffPass', 'pwOld', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
  }

  /* ------------------------------------------------------------------ */
  /* server → state                                                      */
  /* ------------------------------------------------------------------ */
  /** Apply user / supervisor / staff from any response; re-derives role-dependent state. */
  function applyServerInfo(user, supervisor, staff) {
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
    if (!isSup() && (ui.tab === 'staff' || ui.tab === 'summary')) ui.tab = 'station';
    if (state.user && state.user.mustChangePassword && !ui.pwForced) openPasswordModal(true);
  }

  function adoptDay(date, day) {
    const d = normalizeDay(day);
    if (d) { d.date = date; state.days[date] = d; } else delete state.days[date];
  }

  /** seq / staffSeq: ui.writeSeq / ui.staffSeq when the fetch started (older answers must not undo our writes). */
  function mergeData(data, from, to, seq, staffSeq) {
    if (staffSeq === ui.staffSeq) applyServerInfo(data.user, data.supervisor, data.staff);
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
    addLoaded(rf, rt);
    if (state.draft && !isDraftDirty()) state.draft = null;   // clean draft → follow the server
  }

  async function fetchChunk(from, to) {
    const alive = sessionAlive(), seq = ui.writeSeq, staffSeq = ui.staffSeq;
    const data = await Api.call('getData', { from, to });
    if (!alive()) return;
    mergeData(data || {}, from, to, seq, staffSeq);
    setOnline(true);
    state.lastSync = Date.now();
    persistCache();
  }

  /** Make sure [from, to] is loaded (fetch only missing parts unless force). Throws ApiError. */
  async function ensureRange(from, to, opts) {
    // while the password must be changed every data action is refused (A1); loading resumes after the change
    if (!state.session || ui.pwForced || !U.isValidYmd(from) || !U.isValidYmd(to) || from > to) return;
    const force = !!(opts && opts.force);
    const parts = force ? [{ from, to }] : missingRanges(from, to);
    if (!parts.length) return;
    const chunks = [];
    parts.forEach(p => chunkRange(p.from, p.to, MAX_CHUNK_DAYS).forEach(c => chunks.push(c)));
    const span = { from, to };
    ui.fetchingRanges.push(span);
    render();
    try {
      for (const c of chunks) {
        const key = c.from + '|' + c.to;
        let p = force ? null : ui.rangeReqs[key];
        if (!p) {
          p = fetchChunk(c.from, c.to);
          ui.rangeReqs[key] = p;
          const clear = () => { if (ui.rangeReqs[key] === p) delete ui.rangeReqs[key]; };
          p.then(clear, clear);
        }
        await p;
      }
    } finally {
      ui.fetchingRanges.splice(ui.fetchingRanges.indexOf(span), 1);
      render();
    }
  }

  /**
   * Force-reload the window around the selected date. Resolves true/false (never rejects). A refresh already
   * in flight is shared, unless `restart`: after our own write it may have been read before that write.
   */
  function refresh(opts) {
    opts = opts || {};
    if (!state.session || ui.pwForced) return Promise.resolve(false);
    if (ui.refreshing && !opts.restart) return ui.refreshing;
    const w = windowFor(state.selectedDate);
    const p = track(ensureRange(w.from, w.to, { force: true }).then(() => {
      state.audit = {};
      ui.auditFailed = {};
      return true;
    }, e => {
      if (opts.silent) { if (e && e.code === 'NETWORK') setOnline(false); }
      else handleError(e, { noRefresh: true });
      return false;
    }).then(ok => {
      if (ui.refreshing === p) ui.refreshing = null;
      render();
      return ok;
    }));
    ui.refreshing = p;
    return p;
  }

  function setOnline(on) {
    if (state.online === on) return;
    state.online = on;
    renderSyncStatus();
    renderOfflineBanner();
  }

  /* ------------------------------------------------------------------ */
  /* errors                                                              */
  /* ------------------------------------------------------------------ */
  function handleError(e, opts) {
    if (!e) return;
    if (e.name !== 'ApiError') {
      console.error(e);
      toast('เกิดข้อผิดพลาด: ' + (e.message || String(e)));
      return;
    }
    switch (e.code) {
      case 'AUTH_REQUIRED':
      case 'PASSWORD_CHANGE_REQUIRED':
        return;   // Api.onAuthError already handled the session (or the reply was for an old token)
      case 'NETWORK':
        setOnline(false);
        toast(e.message);
        return;
      case 'FORBIDDEN':
      case 'CONFLICT':
        toast(e.message);
        if (!(opts && opts.noRefresh)) refresh();
        return;
      default:
        toast(e.message || 'เกิดข้อผิดพลาด');
    }
  }

  /** Api.onAuthError: the current session is no longer valid, or must set a new password first (A1). */
  function onSessionError(e) {
    if (!state.session) return;
    if (e.code === 'PASSWORD_CHANGE_REQUIRED') {
      if (state.user) state.user.mustChangePassword = true;
      if (!ui.pwForced) { openPasswordModal(true); render(); }
      return;
    }
    doLogout();
    toast(MSG.sessionExpired);
  }
  function isSessionError(e) { return !!e && (e.code === 'AUTH_REQUIRED' || e.code === 'PASSWORD_CHANGE_REQUIRED'); }

  function requireOnline() {
    if (state.online) return true;
    toast(MSG.offline);
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
    hideModal('loginModal');
    render();

    let me;
    try {
      me = await Api.call('me');
    } catch (e) {
      if (e.code === 'AUTH_REQUIRED') { if (ui.loginUsersPromise) await ui.loginUsersPromise; return; }
      if (e.code === 'NETWORK') {
        setOnline(false);
        if (!state.user) state.user = { name: session.name, group: '', isSupervisor: false, mustChangePassword: false };
        render();
        return;
      }
      handleError(e, { noRefresh: true });
      render();
      return;
    }
    setOnline(true);
    applyServerInfo(me.user, me.supervisor);
    render();
    if (ui.pwForced) return;
    await loadCurrentWindow();
  }

  async function loadCurrentWindow() {
    const w = windowFor(state.selectedDate);
    try { await ensureRange(w.from, w.to, { force: true }); }
    catch (e) { handleError(e, { noRefresh: true }); }
    render();
  }

  /** Opens the login modal and reloads the user list (a shared device may sit on this screen for hours). */
  function showLogin() {
    $('loginPassword').value = '';
    showLoginError('');
    setVisible($('loginSettingsLink'), ui.apiUrlSource === 'local');
    renderLoginSelect();
    showModal('loginModal');
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
      setOnline(true);
      if ($('loginError').dataset.kind === 'list') showLoginError('');
    } catch (e) {
      ui.loginUsersError = (e && e.message) || 'โหลดรายชื่อไม่สำเร็จ';
      if (e && e.code === 'NETWORK') setOnline(false);
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
      try { d = await Api.call('login', { name, password }); }
      catch (e) {
        if (e.code === 'NETWORK') setOnline(false);
        showLoginError(e.message || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    });
    if (!d || !d.token || !d.user) return;
    setOnline(true);
    $('loginPassword').value = '';
    beginSession(d);
    if (state.user.mustChangePassword) openPasswordModal(true);   // before render: no data calls meanwhile (A1)
    render();
    if (ui.pwForced) return;
    toast(`👋 ยินดีต้อนรับคุณ ${state.user.name}`);
    await loadCurrentWindow();
  }

  function beginSession(d) {
    ui.epoch++;
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
  }

  function doLogout() {
    lsRemove(LS.session);
    lsRemove(LS.cache);
    Api.setToken(null);
    ui.epoch++;
    state.session = null;
    clearDataState();
    ui.pwForced = false;
    ui.tab = 'station';
    hideModal('passwordModal');
    hideModal('confirmLeaveModal');
    hideModal('transferModal');
    showLogin();
    render();
  }

  function onLogoutClick() {
    const msg = isDraftDirty()
      ? 'มีการแก้ไข Station ที่ยังไม่ได้บันทึก — ต้องการออกจากระบบใช่หรือไม่?'
      : 'ต้องการออกจากระบบใช่หรือไม่?';
    if (!window.confirm(msg)) return;
    doLogout();
    toast('🚪 ออกจากระบบเรียบร้อย');
  }

  /* ---------- password modal ---------- */
  function openPasswordModal(forced) {
    ui.pwForced = !!forced;
    $('pwTitle').textContent = forced ? '🔑 กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน' : '🔑 เปลี่ยนรหัสผ่าน';
    $('pwDesc').textContent = forced
      ? `คุณ ${myName()} ยังใช้รหัสผ่านเริ่มต้นหรือรหัสที่ถูกรีเซ็ต กรุณาตั้งรหัสผ่านใหม่ (4–64 ตัวอักษร และห้ามใช้ 1234)`
      : `ผู้ใช้: ${myName()}`;
    ['pwOld', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
    pwError('');
    setVisible($('pwCancelBtn'), !forced);
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
    if (!state.online) { pwError(MSG.offline); return; }
    pwError('');
    const alive = sessionAlive();   // "ออกจากระบบ" stays available while the change is in flight
    let res = null;
    await withBusy($('pwSaveBtn'), 'กำลังบันทึก…', async () => {
      try { res = await Api.call('changePassword', { oldPassword: oldP, newPassword: newP }); }
      catch (e) {
        if (isSessionError(e) || !alive()) return;
        if (e.code === 'NETWORK') setOnline(false);
        pwError(e.message);
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
    setOnline(true);
    persistCache();
    render();
    toast('🔑 เปลี่ยนรหัสผ่านสำเร็จ');
    if (wasForced) await loadCurrentWindow();
  }

  /* ---------- setup modal ---------- */
  function openSetupModal(cancelable) {
    ui.setupCancelable = !!cancelable;
    $('setupApiUrl').value = state.apiUrl || '';
    setupMsg('', '');
    setVisible($('setupCancelBtn'), !!cancelable);
    showModal('setupModal');
  }

  function setupMsg(msg, kind) {
    const el = $('setupError');
    el.textContent = msg || '';
    el.className = 'text-xs font-medium text-center p-2 rounded-xl ' +
      (kind === 'warn' ? 'text-amber-800 bg-amber-50 border border-amber-200' : 'text-rose-600 bg-rose-50 border border-rose-200');
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
    setOnline(true);
    hideModal('setupModal');
    toast('✅ เชื่อมต่อเซิร์ฟเวอร์สำเร็จ');
    if (changed && state.session) { doLogout(); return; }   // different backend → start over
    if (!state.session) await startSession();
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */
  function render() {
    renderDateInputs();
    renderRole();
    renderTabs();
    renderStationTab();
    renderLeaveTab();
    renderStaffTab();
    renderSummaryTab();
    renderSyncStatus();
    renderOfflineBanner();
  }

  function renderDateInputs() {
    const d = state.selectedDate;
    $('headerDate').textContent = U.thaiDate(d);
    if ($('currentDate').value !== d) $('currentDate').value = d;
    if ($('leaveTargetDate').value !== d) $('leaveTargetDate').value = d;
  }

  function renderSyncStatus() {
    const el = $('syncStatus');
    if (!el) return;
    const st = Api.inflight > 0 ? 'syncing' : (state.online ? 'online' : 'offline');
    const look = {
      online: { color: '#4ade80', label: 'ออนไลน์' },
      syncing: { color: '#facc15', label: 'กำลังซิงก์…' },
      offline: { color: '#cbd5e1', label: 'ออฟไลน์' }
    }[st];
    el.dataset.state = st;
    el.querySelector('[data-role="dot"]').style.color = look.color;
    el.querySelector('[data-role="label"]').textContent = look.label;
  }

  function renderOfflineBanner() {
    const b = $('offlineBanner');
    if (!b) return;
    setVisible(b, !state.online);
    const t = state.lastSync || (ui.cacheSavedAt ? Date.parse(ui.cacheSavedAt) : null);
    $('offlineSince').textContent = t ? U.formatStamp(t) : '-';
    syncLayout();
  }

  /** Keep the content below the fixed header whatever the header's height. */
  function syncLayout() {
    const h = $('appHeader'), m = $('appMain');
    if (!h || !m) return;
    const ht = h.offsetHeight;
    if (ht > 0) m.style.paddingTop = (ht + 12) + 'px';
  }

  function renderRole() {
    const sup = isSup();
    const badge = $('roleBadge');
    const notice = $('stationNotice');
    if (!state.user) {
      badge.textContent = '';
      notice.textContent = 'แสดงผลตารางเวรประจำวันที่เลือก';
    } else if (sup) {
      badge.textContent = '⭐ Supervisor (สิทธิ์เต็ม)';
      badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800';
      notice.textContent = 'คุณมีสิทธิ์จัดกำลังคนประจำ Station และบันทึกข้อมูล';
    } else {
      badge.textContent = `👤 ${myName()} (Staff)`;
      badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800';
      notice.textContent = 'แสดงผลตารางเวรประจำวันที่เลือก (ดูข้อมูลหมายเหตุและเวรได้)';
    }
    setVisible($('stationSaveBtn'), sup);
    setVisible($('auditLogBox'), sup);
    setVisible($('staffControlBox'), sup);
    setVisible($('summaryTargetSelectContainer'), sup);
    setVisible($('navStaffBtn'), sup);
    setVisible($('navSummaryBtn'), sup);
    $('bottomNav').className = 'bg-white border-t shadow-2xl grid safe-bottom ' + (sup ? 'grid-cols-4' : 'grid-cols-2');
    $('currentSupDisplay').textContent = `ผู้ถือสิทธิ์ปัจจุบัน: ${state.supervisor ? 'คุณ ' + state.supervisor : '-'}`;
  }

  function renderTabs() {
    if (!isSup() && (ui.tab === 'staff' || ui.tab === 'summary')) ui.tab = 'station';
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + ui.tab));
    document.querySelectorAll('.nav-btn').forEach(b => {
      const on = b.dataset.tab === ui.tab;
      b.classList.toggle('text-blue-600', on);
      b.classList.toggle('text-slate-400', !on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function switchTab(name) {
    if ((name === 'staff' || name === 'summary') && !isSup()) name = 'station';
    if (!$('tab-' + name)) return;
    ui.tab = name;
    renderTabs();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { /* ignore */ }
  }

  /* ---------- station tab ---------- */
  function renderStationTab() {
    const container = $('stationsContainer');
    const date = state.selectedDate;
    const view = dayView(date);
    if (!state.user) setHtml(container, '');
    else if (view === 'loading') setHtml(container, LOADING_HTML);
    else if (view === 'missing') setHtml(container, MISSING_HTML);
    else {
      const card = { sup: isSup(), locked: !canEditDay(date), onLeave: activeLeaves(date), act: activeSet() };
      const slots = viewSlots(date);
      setHtml(container, U.STATIONS.map(st => stationCardHtml(st, slots, card)).join(''));
    }
    renderRemark();
    renderDraftBadge();
    renderAudit();
    renderDayControls();
  }

  /** card: {sup, locked (selects disabled), onLeave, act (active names)}. */
  function stationCardHtml(st, slots, card) {
    const { sup, locked, onLeave, act } = card;
    const list = slots[st.id] || [];
    const filled = list.filter(Boolean);
    const short = st.count - filled.length;
    const head =
      `<div class="flex justify-between items-center mb-2 gap-2">` +
        `<h3 class="font-bold text-sm" style="color:${st.text}">${esc(st.name)}` +
          (short > 0 ? ` <span class="station-short" style="font-size:11px; color:#ef4444; font-weight:700;">(ขาด ${short})</span>` : '') +
        `</h3>` +
        `<span class="text-[11px] px-2 py-0.5 bg-white/80 rounded-full border shrink-0">ต้องการ ${st.count} คน</span>` +
      `</div>`;
    let body;
    if (sup) {
      const pos = new Map();   // name → "stationId:index" of the slot holding it
      U.STATIONS.forEach(s => (slots[s.id] || []).forEach((n, i) => { if (n) pos.set(n, s.id + ':' + i); }));
      body = '<div class="space-y-2">' + list.map((cur, i) => {
        const here = st.id + ':' + i;
        // a person deleted since stays in their saved slot (history) but is never offered anywhere else
        const gone = cur && !act.has(cur) ? `<option value="${esc(cur)}" selected>${esc(cur + GONE_LABEL)}</option>` : '';
        const opts = state.staff
          .filter(s => s.name === cur || (!onLeave[s.name] && (!pos.has(s.name) || pos.get(s.name) === here)))
          .map(s => `<option value="${esc(s.name)}"${s.name === cur ? ' selected' : ''}>${esc(s.name)}${onLeave[s.name] ? ' (ลา: ' + esc(onLeave[s.name].type) + ')' : ''}</option>`)
          .join('');
        return `<select class="station-select w-full text-sm p-2.5 border rounded-xl outline-none" data-station="${st.id}" data-index="${i}" aria-label="${esc(st.name)} คนที่ ${i + 1}" style="background:#ffffff;"${locked ? ' disabled' : ''}>` +
          `<option value=""${cur ? '' : ' selected'}>-- เลือกคนที่ ${i + 1} --</option>${gone}${opts}</select>`;
      }).join('') + '</div>';
    } else {
      body = `<div class="station-names flex flex-wrap gap-1.5" data-station="${st.id}">` +
        (filled.length
          ? filled.map(n => `<span class="station-name text-sm font-semibold bg-white/80 border rounded-lg px-2.5 py-1">${esc(nameLabel(n, act))}</span>`).join('')
          : '<span class="text-xs text-slate-400 italic">ยังไม่ได้จัดสรร</span>') +
        '</div>';
    }
    return `<div class="station-card p-3 rounded-2xl border shadow-sm" data-station-card="${st.id}" style="background:${st.bg}; border-color:${st.border}">${head}${body}</div>`;
  }

  function renderRemark() {
    const ta = $('dailyRemark');
    const date = state.selectedDate;
    const edit = canEditDay(date);
    const want = state.user ? viewRemark(date) : '';
    if (normRemark(ta.value) !== want) ta.value = want;
    ta.readOnly = !edit;
    ta.style.backgroundColor = edit ? '#f8fafc' : '#f1f5f9';
  }

  /** Save / copy / paste / clear work on the selected day's data, so they wait until it is loaded. */
  function renderDayControls() {
    const date = state.selectedDate;
    const ready = isSup() && dayView(date) === 'ready';
    const set = (id, off) => { const b = $(id); if (b && b.dataset.busy !== '1') b.disabled = off; };
    set('copyDayBtn', !ready);
    ['stationSaveBtn', 'pasteDayBtn', 'clearDayBtn'].forEach(id => set(id, !ready || ui.dayBusy === date));
  }

  function renderDraftBadge() {
    setVisible($('draftBadge'), isSup() && hasDraftFor(state.selectedDate) && isDraftDirty());
  }

  function renderAudit() {
    if (!isSup()) return;
    const date = state.selectedDate;
    const box = $('auditLogContent');
    const entries = state.audit[date];
    if (entries) {
      setHtml(box, entries.length
        ? entries.map(a => `<div>• ${esc(a.detail)} — <strong>${esc(a.actor)}</strong> เมื่อ ${esc(U.formatStamp(a.timestamp))}</div>`).join('')
        : '<div class="italic text-amber-700/70">ยังไม่มีประวัติการแก้ไขในวันนี้</div>');
    } else if (ui.auditLoading[date]) {
      setHtml(box, '<div class="italic text-amber-700/70">กำลังโหลด…</div>');
    } else if (ui.auditFailed[date] || !state.online) {
      setHtml(box, '<div class="italic text-amber-700/70">โหลดประวัติไม่สำเร็จ (กด 🔄 เพื่อลองใหม่)</div>');
    } else {
      setHtml(box, '<div class="italic text-amber-700/70">กำลังโหลด…</div>');
      loadAudit(date);
    }
  }

  function loadAudit(date) {
    if (ui.auditLoading[date] || !state.session || ui.pwForced) return;
    ui.auditLoading[date] = true;
    const epoch = ui.epoch;
    track(Api.call('getAudit', { date, limit: 20 })).then(d => {
      if (epoch !== ui.epoch) return;
      state.audit[date] = Array.isArray(d && d.entries) ? d.entries : [];
      setOnline(true);
    }, e => {
      if (epoch !== ui.epoch) return;
      ui.auditFailed[date] = true;
      if (e && e.code === 'NETWORK') setOnline(false);
    }).then(() => {
      delete ui.auditLoading[date];
      if (epoch === ui.epoch && date === state.selectedDate) renderAudit();
    });
  }

  /* ---------- leave tab ---------- */
  function chipClass(val, active) {
    if (active) return CHIP_BASE + (val === '' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500' : 'bg-rose-100 text-rose-700 ring-2 ring-rose-500');
    return CHIP_BASE + (val === '' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600');
  }

  function renderLeaveTab() {
    const date = state.selectedDate;
    document.querySelectorAll('.grp-btn').forEach(b => {
      const on = b.dataset.f === state.filter;
      b.className = GRP_BASE + (on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const container = $('leaveContainer');
    if (!state.user) { setHtml(container, ''); $('leaveCountBadge').textContent = '0 คน'; return; }
    const leaves = activeLeaves(date);
    $('leaveCountBadge').textContent = Object.keys(leaves).length + ' คน';
    const view = dayView(date);
    if (view === 'loading' || view === 'missing') { setHtml(container, view === 'loading' ? LOADING_HTML : MISSING_HTML); return; }

    const queues = {};
    U.QUEUE_TYPES.forEach(t => { queues[t] = U.queueOrder(leaves, t); });
    const me = myName();
    const sup = isSup();
    const rows = state.staff.filter(s => s.name === me).concat(state.staff.filter(s => s.name !== me));
    setHtml(container, rows.map(s => leaveRowHtml(s, leaves[s.name], me, sup, queues)).join(''));
  }

  function leaveRowHtml(s, leave, me, sup, queues) {
    const isOwner = s.name === me;
    const canEdit = sup || isOwner;
    const cur = leave ? leave.type : '';
    const meta = leave ? [leave.recordedBy || '', U.formatStampShort(leave.recordedAt)].filter(Boolean).join(' · ') : '';
    const hide = state.filter !== 'all' && s.group !== state.filter;
    const lock = canEdit ? '' : ' disabled style="cursor:not-allowed;"';
    const chips = [''].concat(U.LEAVE_TYPES).map(val => {
      const active = val === cur;
      let label = val === '' ? 'ปกติ' : val;
      if (active && queues[val]) {
        const n = queues[val].indexOf(s.name);
        if (n >= 0) label = `${val} (คนที่ ${n + 1})`;
      }
      return `<button type="button" class="${chipClass(val, active)}" data-staff="${esc(s.name)}" data-val="${esc(val)}" aria-pressed="${active ? 'true' : 'false'}"${lock}>${esc(label)}</button>`;
    }).join('');
    // The header wraps instead of truncating: on a phone the badges move to a second line and the
    // name stays readable.
    return (
      `<div class="leave-row bg-white p-3 rounded-2xl shadow-sm${canEdit ? '' : ' opacity-75'}${isOwner ? ' border-2 border-blue-500 shadow-md' : ''}" data-staff="${esc(s.name)}" data-group="${esc(s.group)}"${hide ? ' style="display:none"' : ''}>` +
        `<div class="flex flex-wrap items-center justify-between mb-2 gap-x-2 gap-y-1">` +
          `<span class="text-sm font-bold flex items-center gap-1.5">` +
            `<span class="leave-name">${esc(s.name)}</span>` +
            (isOwner ? '<span class="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold shrink-0">คุณ (ของฉัน)</span>' : '') +
            (canEdit ? '' : '<span class="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">🔒 ล็อก</span>') +
          `</span>` +
          `<div class="flex flex-wrap items-center gap-1.5">` +
            (isOwner ? '<button type="button" data-action="change-my-password" class="bg-slate-100 active:bg-slate-200 text-slate-700 text-[10px] font-semibold px-2 py-1 rounded-lg border">🔑 เปลี่ยนรหัส</button>' : '') +
            `<span class="meta-badge text-[10px] text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded-md${meta ? '' : ' hidden'}" data-staff-meta="${esc(s.name)}">${esc(meta)}</span>` +
            (s.group === 'backup' ? '<span class="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">แทนเวร</span>' : '') +
          `</div>` +
        `</div>` +
        `<div class="flex flex-wrap gap-1.5">${chips}</div>` +
      `</div>`
    );
  }

  function setFilter(f) {
    if (['all', 'regular', 'backup'].indexOf(f) < 0) f = 'all';
    state.filter = f;
    renderLeaveTab();
  }

  /* ---------- staff tab ---------- */
  function renderStaffTab() {
    renderImportCard();
    if (!isSup()) return;
    $('staffCountBadge').textContent = state.staff.length + ' คน';
    const me = myName();
    const block = (title, list) =>
      `<div class="bg-white p-3 rounded-2xl shadow-sm">` +
        `<h3 class="text-xs font-bold text-slate-500 mb-2">${title} (${list.length} คน)</h3>` +
        `<div class="space-y-1.5">` +
        (list.length ? list.map(s => {
          const isSupRow = s.name === state.supervisor;
          return `<div class="staff-item flex items-center gap-1 p-2 bg-slate-50 rounded-xl border" data-staff="${esc(s.name)}" data-group="${s.group}">` +
            (isSupRow ? '<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold mr-1">Supervisor</span>' : '') +
            `<span class="flex-1 text-sm font-semibold truncate">${esc(s.name)}${s.name === me ? ' <span class="text-[10px] text-blue-600 font-bold">(คุณ)</span>' : ''}</span>` +
            `<button type="button" data-action="reset-password" class="px-2 py-1.5 rounded-lg bg-white border text-[10px]" title="${s.name === me ? 'เปลี่ยนรหัสผ่านของฉัน' : 'ตั้งรหัสผ่านใหม่'}">🔑 รหัส</button>` +
            `<button type="button" data-action="move" class="px-2 py-1.5 rounded-lg bg-white border text-[10px]" title="ย้ายกลุ่ม">↔️</button>` +
            `<button type="button" data-action="delete" class="px-2 py-1.5 rounded-lg bg-rose-500 text-white text-[10px]${isSupRow ? ' hidden' : ''}" title="ลบ"${isSupRow ? ' disabled aria-hidden="true" style="display:none"' : ''}>🗑️</button>` +
          `</div>`;
        }).join('') : '<p class="text-[11px] text-slate-400 italic py-2">ยังไม่มีรายชื่อในกลุ่มนี้</p>') +
        `</div></div>`;
    const c = $('staffListContainer');
    setHtml(c, block('👤 นักรังสีการแพทย์ประจำ', state.staff.filter(s => s.group === 'regular')) +
      block('🔁 ทีมแทนเวร', state.staff.filter(s => s.group === 'backup')));
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
    let h = '<div class="font-semibold text-emerald-700">✅ นำเข้าเรียบร้อย</div>' +
      `<div>• เพิ่มรายชื่อใหม่ ${added.length} คน${added.length ? ': ' + esc(added.join(', ')) : ''}</div>` +
      `<div>• ตารางเวร (Station/หมายเหตุ) ${r.daysWritten | 0} วัน</div>` +
      `<div>• บันทึกการลา ${r.leavesWritten | 0} รายการ</div>` +
      `<div>• นำผู้ลาออกจาก Station ที่มีอยู่แล้ว ${r.unassigned | 0} รายการ</div>`;
    if (skipped.length) {
      h += `<details><summary class="cursor-pointer text-amber-700 font-semibold">ข้าม ${skipped.length} รายการ (แตะเพื่อดูเหตุผล)</summary>` +
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

  /** The capture area (#captureArea) for the selected date — reflects the draft if present. */
  function renderPreview() {
    const date = state.selectedDate;
    $('displayDate').textContent = 'ประจำ' + U.thaiDate(date);
    const slots = state.user ? viewSlots(date) : storedSlots(date);
    const act = activeSet();
    setHtml($('resultStations'), U.STATIONS.map(st => {
      const arr = (slots[st.id] || []).filter(Boolean);
      const warn = arr.length < st.count ? `<span style="font-size:11px; color:#ef4444; font-weight:700;">(ขาด ${st.count - arr.length})</span>` : '';
      return `<div style="background:${st.bg}; border:1px solid ${st.border}; border-radius:14px; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;">` +
        `<div style="font-size:14px; font-weight:700; color:${st.text}; min-width:110px;">${esc(st.name)} ${warn}</div>` +
        `<div style="display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; flex:1;">` +
        (arr.length ? arr.map(a => `<span style="font-size:13.5px; font-weight:600; color:#1e293b;">${esc(nameLabel(a, act))}</span>`).join('')
          : '<span style="font-size:12px; color:#94a3b8; font-style:italic;">ยังไม่ได้จัดสรร</span>') +
        `</div></div>`;
    }).join(''));

    const leaves = activeLeaves(date);
    const names = state.staff.map(s => s.name).filter(n => leaves[n]);
    setHtml($('resultLeaves'), names.length
      ? names.map(n => `<div>• <span class="font-semibold">${esc(n)}</span>: <span class="text-rose-600 font-semibold">${esc(leaves[n].type)}</span></div>`).join('')
      : '<span class="text-slate-400 italic">ไม่มีรายการลาวันนี้</span>');

    const rv = (state.user ? viewRemark(date) : '').trim();
    const rc = $('resultRemarkContainer');
    $('resultRemarkText').textContent = rv;
    rc.style.display = rv ? 'block' : 'none';
  }

  function renderCopiedStatus() {
    const c = state.clipboard;
    $('copiedStatusText').textContent = c
      ? `📋 คัดลอกข้อมูลของวันที่ ${c.fromDate} เรียบร้อยแล้ว`
      : 'สถานะคลิปบอร์ด: ยังไม่มีข้อมูลที่คัดลอก';
  }

  /* ------------------------------------------------------------------ */
  /* handlers — date                                                     */
  /* ------------------------------------------------------------------ */
  function setSelectedDate(date) {
    if (!U.isValidYmd(date)) { renderDateInputs(); return false; }
    if (date === state.selectedDate) { renderDateInputs(); return true; }
    if (state.draft && state.draft.date !== date) {
      if (isDraftDirty() && !window.confirm(MSG.discardDraft)) { renderDateInputs(); return false; }
      state.draft = null;
    }
    state.selectedDate = date;
    render();
    if (state.session) {
      const w = windowFor(date);
      const wasOnline = state.online;
      track(ensureRange(w.from, w.to)).then(() => render(), e => {
        render();
        if (e && e.code === 'NETWORK' && !wasOnline) { setOnline(false); return; }   // already offline: stay quiet
        handleError(e);
      });
    }
    return true;
  }

  function toggleDatePicker() {
    $('datePickerBar').classList.toggle('hidden');
    syncLayout();
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
    if (!st || !(idx >= 0 && idx < st.count)) { renderStationTab(); return; }
    const val = sel.value;
    if (val && !assignableSet(date).has(val)) { renderStationTab(); return; }
    const draft = ensureDraft(date);
    if (val) {   // a person can hold only one slot
      U.STATIONS.forEach(s => {
        draft.assignments[s.id] = draft.assignments[s.id].map((n, i) => (n === val && !(s.id === st.id && i === idx) ? '' : n));
      });
    }
    draft.assignments[st.id][idx] = val;
    if (!isDraftDirty()) state.draft = null;
    renderStationTab();
    renderPreview();
  }

  function onRemarkInput() {
    const date = state.selectedDate;
    if (!canEditDay(date)) { renderRemark(); return; }
    const draft = ensureDraft(date);
    draft.remark = normRemark($('dailyRemark').value);
    if (!isDraftDirty()) state.draft = null;
    renderDraftBadge();
    renderPreview();
  }

  async function onSaveStation() {
    if (!requireOnline()) return;
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
    ui.dayBusy = date;
    renderStationTab();
    try { return await fn(); }
    finally {
      if (ui.dayBusy === date) ui.dayBusy = null;
      render();
    }
  }

  /** saveDay with the CONFLICT dialog (SPEC §6.6). Returns the response or null when nothing was saved. */
  async function saveDayFlow(date, assignments, remark, baseVersion, okMsg) {
    const alive = sessionAlive();
    let res;
    try {
      res = await Api.call('saveDay', { date, assignments, remark, baseVersion });
    } catch (e) {
      if (!alive()) return null;
      if (!e || e.code !== 'CONFLICT') throw e;
      const serverDay = e.details && e.details.day ? e.details.day : null;
      if (window.confirm(MSG.conflict)) {
        res = await Api.call('saveDay', { date, assignments, remark, baseVersion: serverDay ? (parseInt(serverDay.version, 10) || 0) : 0 });
        spawn(() => refresh());
      } else {
        adoptDay(date, serverDay);
        if (hasDraftFor(date)) state.draft = null;
        delete state.audit[date];
        markTouched(date);
        persistCache();
        render();
        toast('🔄 โหลดข้อมูลล่าสุดของวันนี้แล้ว');
        spawn(() => refresh());
        return null;
      }
    }
    if (!alive()) return null;
    adoptDay(date, res.day);
    if (hasDraftFor(date)) state.draft = null;
    delete state.audit[date];
    markTouched(date);
    persistCache();
    render();
    const warnings = Array.isArray(res.warnings) ? res.warnings : [];
    const head = res.unchanged && !warnings.length ? okMsg + ' (ไม่มีการเปลี่ยนแปลง)' : okMsg;
    toast(warnings.length ? head + '\n⚠️ ' + warnings.join('\n⚠️ ') : head, warnings.length ? 5000 : 2200);
    // warnings = the server knows leaves this device has not seen yet: fetch the date again
    if (warnings.length) spawn(() => ensureRange(date, date, { force: true }));
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* handlers — leave                                                    */
  /* ------------------------------------------------------------------ */
  function onLeaveContainerClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-action="change-my-password"]')) { openPasswordModal(false); return; }
    const chip = t.closest('.lv-chip');
    if (!chip || chip.disabled) return;
    const staff = chip.dataset.staff;
    const val = chip.dataset.val || '';
    if (!state.user) return;
    if (!(isSup() || staff === myName())) { toast(MSG.ownLeaveOnly); return; }
    if (!activeSet().has(staff)) return;
    if (val !== '' && U.LEAVE_TYPES.indexOf(val) < 0) return;
    const date = state.selectedDate;
    const cur = (activeLeaves(date)[staff] || {}).type || '';
    if (val === cur) return;
    if (!requireOnline()) return;
    ui.pendingLeave = { staff, date, type: val };
    const label = val === '' ? 'ปกติ (ยกเลิกวันลา)' : val;
    $('confirmLeaveText').innerHTML =
      `ผู้ลา: <strong class="text-slate-900">${esc(staff)}</strong><br>` +
      `วันที่: <strong class="text-blue-600">${esc(U.thaiDate(date))}</strong><br>` +
      `สถานะ: <strong class="${val === '' ? 'text-emerald-600' : 'text-rose-600'}">${esc(label)}</strong>`;
    showModal('confirmLeaveModal');
  }

  function closeConfirmLeave() {
    if (ui.leaveSaving) return;
    ui.pendingLeave = null;
    hideModal('confirmLeaveModal');
  }

  async function onConfirmLeave() {
    const p = ui.pendingLeave;
    if (!p || ui.leaveSaving) return;
    if (!requireOnline()) { closeConfirmLeave(); return; }
    const btn = $('confirmLeaveBtn');
    const label = btn.textContent;
    const alive = sessionAlive();
    const base = draftBase();
    ui.leaveSaving = true;
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก…';
    let res = null, err = null;
    try { res = await Api.call('setLeave', { date: p.date, staff: p.staff, type: p.type }); }
    catch (e) { err = e; }
    finally {
      ui.leaveSaving = false;
      btn.disabled = false;
      btn.textContent = label;
    }
    if (!alive()) return;
    closeConfirmLeave();
    if (err) throw err;
    applyLeaveResult(p, res || {}, base);
    toast(MSG.leaveSaved);
  }

  /** base: draftBase() from before the call — the auto-unassign day in `res` may rebase the draft (CON-1). */
  function applyLeaveResult(p, res, base) {
    const map = state.leaves[p.date] = state.leaves[p.date] || nameMap();
    if (res.leave && res.leave.type) map[res.leave.staff || p.staff] = res.leave;
    else delete map[p.staff];
    if (!Object.keys(map).length) delete state.leaves[p.date];
    if (res.day) adoptDay(p.date, res.day);
    if (p.type && hasDraftFor(p.date)) {
      removeFromDraft(p.staff);
      rebaseDraft(p.staff, base);
    }
    delete state.audit[p.date];
    markTouched(p.date);
    persistCache();
    render();
  }

  async function onSummary() {
    const from = $('summaryStartDate').value, to = $('summaryEndDate').value;
    const box = $('leaveSummaryContent');
    const fail = msg => setHtml(box, `<p class="text-rose-500 font-medium">⚠️ ${esc(msg)}</p>`);
    if (!state.user) return;
    if (!from || !to || !U.isValidYmd(from) || !U.isValidYmd(to)) { fail('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด'); return; }
    if (from > to) { fail('วันที่เริ่มต้นต้องมาก่อนวันที่สิ้นสุด'); return; }
    if (U.daysBetweenInclusive(from, to) > MAX_REPORT_DAYS) { fail('ช่วงเวลาต้องไม่เกิน 2 ปี'); return; }
    const pick = isSup() ? $('summaryTargetStaff').value : myName();
    const alive = sessionAlive();
    setHtml(box, '<p class="italic text-slate-400">⏳ กำลังโหลด…</p>');
    let note = '';
    await withBusy($('summaryBtn'), 'กำลังโหลด…', async () => {
      // always refetch: the range may have been loaded long ago and changed on other devices since
      try { await ensureRange(from, to, { force: true }); }
      catch (e) {
        if (e.code === 'NETWORK') { setOnline(false); note = 'ออฟไลน์ — แสดงเฉพาะข้อมูลที่มีในเครื่อง อาจไม่ครบถ้วน'; }
        else if (isSessionError(e)) return;
        else { setHtml(box, ''); throw e; }
      }
      if (!alive()) return;
      const people = reportStaff(from, to).filter(s => !pick || pick === ALL || s.name === pick);
      setHtml(box, leaveSummaryHtml(from, to, people, note));
      toast('📊 โหลดสรุปวันลาสำเร็จ');
    });
  }

  /** people: [{name, group}] (reportStaff) — the summary lists their leave dates by type. */
  function leaveSummaryHtml(from, to, people, note) {
    const byName = new Map(people.map(s => [s.name, nameMap()]));
    U.eachDate(from, to).forEach(date => {
      const day = leavesOn(date);
      Object.keys(day).forEach(name => {
        const l = day[name], types = byName.get(name);
        if (!types || !l || !l.type) return;
        (types[l.type] = types[l.type] || []).push(date);
      });
    });
    const typeRank = t => { const i = U.LEAVE_TYPES.indexOf(t); return i < 0 ? 99 : i; };
    let any = false;
    let html = '<div class="space-y-3">';
    people.forEach(s => {
      const dates = byName.get(s.name);
      const types = Object.keys(dates).sort((a, b) => typeRank(a) - typeRank(b));
      if (!types.length) return;
      any = true;
      const total = types.reduce((n, t) => n + dates[t].length, 0);
      html += `<div class="p-2.5 bg-slate-50 border rounded-xl space-y-1" data-summary-staff="${esc(s.name)}">` +
        `<div class="font-bold text-slate-800 text-xs border-b pb-1 flex justify-between items-center"><span>👤 ${esc(personLabel(s))}</span><span class="text-[10px] text-slate-500">รวม ${total} วัน</span></div>` +
        '<div class="pl-2 space-y-1 pt-1">' +
        types.map(t => `<div><span class="font-semibold text-rose-600">• ${esc(t)}</span> (${dates[t].length} ครั้ง): <span class="text-slate-600">${dates[t].map(esc).join(', ')}</span></div>`).join('') +
        '</div></div>';
    });
    if (!any) html += '<p class="text-slate-400 italic text-center py-2">ไม่มีประวัติการลาในช่วงเวลาดังกล่าว</p>';
    if (note) html += `<p class="text-[10px] text-amber-700">${esc(note)}</p>`;
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
    ui.staffBusy = true;
    renderStaffTab();
    try { await fn(); }
    finally { ui.staffBusy = false; renderStaffTab(); }
  }

  async function onAddStaff() {
    if (!requireOnline()) return;
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
      const res = await Api.call('addStaff', { name, group, password: pass });
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
      case 'reset-password': spawn(() => resetPasswordFlow(name)); break;
      case 'move': spawn(() => moveStaffFlow(name)); break;
      case 'delete': spawn(() => deleteStaffFlow(name)); break;
      default: break;
    }
  }

  async function resetPasswordFlow(name) {
    if (name === myName()) { openPasswordModal(false); return; }
    if (!requireOnline()) return;
    const ans = window.prompt(`ตั้งรหัสผ่านใหม่ให้คุณ "${name}" (เว้นว่าง = 1234)`);
    if (ans === null || ans === undefined) return;
    const np = String(ans).trim();
    if (np) { const pe = U.validatePassword(np); if (pe) { toast('⚠️ ' + pe); return; } }
    const alive = sessionAlive();
    await staffOp(async () => {
      await Api.call('resetPassword', { name, newPassword: np });
      if (!alive()) return;
      toast(`🔑 ตั้งรหัสผ่านใหม่ให้ "${name}" แล้ว${np ? '' : ' (1234)'} — ต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งถัดไป`, 3500);
    });
  }

  async function moveStaffFlow(name) {
    if (!requireOnline()) return;
    const alive = sessionAlive();
    await staffOp(async () => {
      const res = await Api.call('moveStaff', { name });
      if (!alive()) return;
      applyStaffResult(res);
      const s = state.staff.find(x => x.name === name);
      toast(`↔️ ย้าย "${name}" ไปกลุ่ม${groupLabel(s ? s.group : '')}แล้ว`);
    });
  }

  async function deleteStaffFlow(name) {
    if (!requireOnline()) return;
    if (name === state.supervisor) { toast('⚠️ ไม่สามารถลบ Supervisor ได้ กรุณาโอนสิทธิ์ให้ผู้อื่นก่อน'); return; }
    if (!window.confirm(`ต้องการลบ "${name}" ออกจากระบบใช่หรือไม่?`)) return;
    const alive = sessionAlive();
    let base = null, deleted = false;
    await staffOp(async () => {
      base = draftBase();
      const res = await Api.call('deleteStaff', { name });
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
    showModal('transferModal');
  }

  async function onTransfer() {
    if (!requireOnline()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    const target = $('transferTargetSelect').value;
    if (!target) { toast('⚠️ กรุณาเลือกผู้รับสิทธิ์ก่อน'); return; }
    const alive = sessionAlive();
    await withBusy($('transferConfirmBtn'), 'กำลังโอน…', async () => {
      if (!(await settleDraftBeforeTransfer()) || !alive()) return;
      const res = await Api.call('transferSupervisor', { target });
      if (!alive()) return;
      hideModal('transferModal');
      state.audit = {};
      applyStaffResult({ supervisor: (res && res.supervisor) || target, staff: res && res.staff });
      toast(`👑 โอนสิทธิ์ Supervisor ให้คุณ "${state.supervisor}" สำเร็จ (คุณกลายเป็น Staff แล้ว)`, 3500);
    });
  }

  /** After a transfer this device can no longer save, so a dirty draft is saved first or knowingly discarded. */
  async function settleDraftBeforeTransfer() {
    if (!isDraftDirty()) return true;
    if (window.confirm(MSG.transferSaveFirst)) return !!(await saveSelectedDay());
    return window.confirm(MSG.transferDiscard);
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
    if (!requireOnline()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    if (!legacyInfo().has) { toast('ไม่พบข้อมูลเดิมในเครื่องนี้'); return; }
    const payload = buildImportPayload();
    const overwrite = !!$('importOverwrite').checked;
    const alive = sessionAlive();
    await withBusy($('importBtn'), 'กำลังนำเข้า…', async () => {
      const res = await Api.call('importLocal', { payload, overwrite }, { timeoutMs: 180000 });
      if (!alive()) return;
      ui.importResult = res || {};
      state.loaded.length = 0;   // many dates changed server-side: refetch on demand
      state.audit = {};
      render();
      toast('✅ นำเข้าข้อมูลสำเร็จ');
      await refresh({ restart: true });   // a refresh started before the import would bring pre-import data
    });
  }

  function onClearLegacy() {
    if (!window.confirm('ต้องการลบข้อมูลของแอปเวอร์ชันเดิมที่เก็บในเครื่องนี้ใช่หรือไม่? (ข้อมูลบนระบบกลางจะไม่ถูกลบ)')) return;
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
        rows.push([date, personLabel(s), groupLabel(s.group), l && l.type ? l.type : 'ปกติ', stations.length ? stations.join(' / ') : '—', remark]);
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
    if (dayView(date) !== 'ready') { toast(MSG.notLoaded); return; }   // an unloaded day would copy as empty
    state.clipboard = { fromDate: date, assignments: compactSlots(viewSlots(date)), remark: viewRemark(date) };
    renderCopiedStatus();
    toast(`📋 คัดลอกข้อมูลของวันที่ ${date} แล้ว`);
  }

  async function onPasteDay() {
    if (!requireOnline()) return;
    if (!isSup()) { toast(MSG.supOnly); return; }
    const clip = state.clipboard;
    if (!clip) { toast('⚠️ ยังไม่มีข้อมูลที่ถูกคัดลอก กรุณากดคัดลอกก่อน'); return; }
    const date = state.selectedDate;
    if (!requireDayReady(date)) return;
    if (!window.confirm(`ต้องการวางข้อมูลตารางเวรและหมายเหตุลงในวันที่ ${date} ใช่หรือไม่? (สถานะวันลาของวันนี้จะยังคงอยู่ตามเดิม)`)) return;
    // keep only people the target day may hold, not on leave that date, each person once, within capacity
    const allowed = assignableSet(date);
    const onLeave = activeLeaves(date);
    const used = new Set();
    const assignments = {};
    U.STATIONS.forEach(st => {
      assignments[st.id] = [];
      ((clip.assignments && clip.assignments[st.id]) || []).forEach(n => {
        if (allowed.has(n) && !onLeave[n] && !used.has(n) && assignments[st.id].length < st.count) {
          used.add(n);
          assignments[st.id].push(n);
        }
      });
    });
    const remark = normRemark(clip.remark).slice(0, REMARK_MAX);
    await withBusy($('pasteDayBtn'), 'กำลังวาง…', () => withDayLock(date, () =>
      saveDayFlow(date, assignments, remark, currentVersion(date), `📌 วางข้อมูลลงวันที่ ${date} สำเร็จ`)));
  }

  async function onClearDay() {
    if (!requireOnline()) return;
    if (!isSup()) { toast('⚠️ เฉพาะ Supervisor เท่านั้นที่ล้างข้อมูลได้'); return; }
    const date = state.selectedDate;
    if (!requireDayReady(date)) return;
    if (!window.confirm('ต้องการล้างข้อมูลการจัดเวร การลา และหมายเหตุของวันนี้ทั้งหมดใช่หรือไม่?')) return;
    const alive = sessionAlive();
    await withBusy($('clearDayBtn'), 'กำลังล้าง…', () => withDayLock(date, async () => {
      const res = await Api.call('clearDay', { date });
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

  function renderCanvas() {
    if (typeof window.html2canvas !== 'function') return Promise.reject(new Error('html2canvas unavailable'));
    return window.html2canvas($('captureArea'), { scale: 3, backgroundColor: '#ffffff', useCORS: true });
  }
  const IMG_FAIL = '⚠️ สร้างภาพไม่สำเร็จ (ต้องเชื่อมต่ออินเทอร์เน็ตอย่างน้อยครั้งแรกเพื่อโหลดเครื่องมือสร้างภาพ)';

  /** The capture area as a JPEG file, or null (with a toast) when it cannot be drawn. */
  async function captureImage(date) {
    try {
      const canvas = await renderCanvas();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (blob) return new File([blob], `เวร-IPD-${date}.jpg`, { type: 'image/jpeg' });
    } catch (e) { /* reported below */ }
    toast(IMG_FAIL);
    return null;
  }

  async function onSaveImage() {
    const file = await captureImage(state.selectedDate);
    if (file && await saveFile(file, file.name)) toast('⬇️ บันทึกภาพเรียบร้อย');
  }

  async function onShareImage() {
    const date = state.selectedDate;
    const file = await captureImage(date);
    if (!file) return;
    if (!canShareFile(file)) { downloadBlob(file, file.name); toast('⬇️ บันทึกภาพเรียบร้อย'); return; }
    if (await shareFile(file, { title: 'ตารางเวร IPD', text: U.thaiDate(date) }) === 'failed') downloadBlob(file, file.name);
  }

  async function onRefreshClick() {
    if (!state.session) return;
    await withBusy($('refreshBtn'), '…', async () => {
      const ok = await refresh();
      if (ok) toast('🔄 อัปเดตข้อมูลล่าสุดแล้ว');
    });
  }

  /* ------------------------------------------------------------------ */
  /* wiring                                                              */
  /* ------------------------------------------------------------------ */
  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
  function onEnter(id, fn) { on(id, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fn(); } }); }

  function bindEvents() {
    // setup / login / password
    on('setupSaveBtn', 'click', () => spawn(onSetupSave));
    onEnter('setupApiUrl', () => spawn(onSetupSave));
    on('setupCancelBtn', 'click', () => { if (ui.setupCancelable) hideModal('setupModal'); });
    on('loginBtn', 'click', () => spawn(handleLogin));
    onEnter('loginPassword', () => spawn(handleLogin));
    on('loginReloadBtn', 'click', () => { showLoginError(''); reloadLoginUsers(); });
    on('loginSettingsLink', 'click', () => openSetupModal(true));
    on('pwSaveBtn', 'click', () => spawn(onPwSave));
    ['pwOld', 'pwNew', 'pwConfirm'].forEach(id => onEnter(id, () => spawn(onPwSave)));
    on('pwCancelBtn', 'click', closePasswordModal);
    on('pwLogoutBtn', 'click', () => { doLogout(); toast('🚪 ออกจากระบบเรียบร้อย'); });

    // header
    on('refreshBtn', 'click', () => spawn(onRefreshClick));
    on('datePickerBtn', 'click', toggleDatePicker);
    on('prevDayBtn', 'click', () => setSelectedDate(U.addDays(state.selectedDate, -1)));
    on('nextDayBtn', 'click', () => setSelectedDate(U.addDays(state.selectedDate, 1)));
    on('currentDate', 'change', e => setSelectedDate(e.target.value));
    on('logoutBtn', 'click', onLogoutClick);

    // station tab
    on('stationsContainer', 'change', onStationChange);
    on('dailyRemark', 'input', onRemarkInput);
    on('dailyRemark', 'change', onRemarkInput);
    on('stationSaveBtn', 'click', () => spawn(onSaveStation));

    // leave tab
    on('summaryBtn', 'click', () => spawn(onSummary));
    on('leaveTargetDate', 'change', e => setSelectedDate(e.target.value));
    on('groupFilterBar', 'click', e => { const b = e.target.closest && e.target.closest('.grp-btn'); if (b) setFilter(b.dataset.f); });
    on('leaveContainer', 'click', onLeaveContainerClick);
    on('confirmLeaveCancelBtn', 'click', closeConfirmLeave);
    on('confirmLeaveBtn', 'click', () => spawn(onConfirmLeave));

    // staff tab
    on('openTransferBtn', 'click', openTransferModal);
    on('transferCancelBtn', 'click', () => hideModal('transferModal'));
    on('transferConfirmBtn', 'click', () => spawn(onTransfer));
    on('addStaffBtn', 'click', () => spawn(onAddStaff));
    onEnter('newStaffName', () => spawn(onAddStaff));
    on('staffListContainer', 'click', onStaffListClick);
    on('importBtn', 'click', () => spawn(onImport));
    on('clearLegacyBtn', 'click', onClearLegacy);

    // summary tab
    on('exportBtn', 'click', () => spawn(onExport));
    on('copyDayBtn', 'click', onCopyDay);
    on('pasteDayBtn', 'click', () => spawn(onPasteDay));
    on('shareImgBtn', 'click', () => spawn(onShareImage));
    on('saveImgBtn', 'click', () => spawn(onSaveImage));
    on('clearDayBtn', 'click', () => spawn(onClearDay));

    // bottom nav
    on('bottomNav', 'click', e => { const b = e.target.closest && e.target.closest('.nav-btn'); if (b) switchTab(b.dataset.tab); });

    // global
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (isShown('confirmLeaveModal')) closeConfirmLeave();
      else if (isShown('transferModal')) hideModal('transferModal');
      else if (isShown('passwordModal')) closePasswordModal();
      else if (isShown('setupModal') && ui.setupCancelable) hideModal('setupModal');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!state.session) { if (isShown('loginModal')) reloadLoginUsers(); return; }
      if (!state.lastSync || Date.now() - state.lastSync > STALE_AFTER_MS) refresh({ silent: true });
    });
    setInterval(() => {
      if (document.visibilityState === 'visible' && state.session && !ui.pwForced) refresh({ silent: true });
    }, REFRESH_EVERY_MS);
    window.addEventListener('online', () => { if (state.session) refresh({ silent: true }); });
    window.addEventListener('offline', () => setOnline(false));
    window.addEventListener('beforeunload', e => {
      if (isDraftDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('resize', syncLayout);
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(syncLayout).observe($('appHeader')); } catch (e) { /* ignore */ }
    }
  }

  function initDateInputs() {
    const m = U.monthRange(U.todayStr());
    $('summaryStartDate').value = m.from;
    $('summaryEndDate').value = m.to;
    $('exportStartDate').value = m.from;
    $('exportEndDate').value = m.to;
  }

  function registerServiceWorker() {
    if (cfg().DISABLE_SW === true) return;
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const go = () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  function init() {
    LEGACY_SECRET_KEYS.forEach(lsRemove);
    ui.summaryPlaceholder = $('leaveSummaryContent').innerHTML;
    bindEvents();
    initDateInputs();
    Api.onActivity(() => renderSyncStatus());
    Api.onAuthError = onSessionError;
    render();
    syncLayout();
    registerServiceWorker();
    spawn(startup).then(() => { render(); resolveReady(); });
  }

  U.onReady(init);
})();
