/* =====================================================================
 * js/feat-approval.js — feature "approval" (อนุมัติการลา, Supervisor) → App.register   (R1b track A1, R1b-SPEC §4.3)
 *
 * The first `rules.vacationAutoSlots` (default 2) vacations of a day are approved by the server at once; the third and
 * later ones arrive as `pending` rows. This file is the Supervisor's side of that rule:
 *
 *  - Screen 'approval' (เมนู → งานหัวหน้า → อนุมัติการลา, Supervisor only, while the server announces 'approval'): every
 *    pending request (core.state.requests) grouped by date, soonest first, past dates last under "ผ่านวันที่แล้ว". Each date
 *    card shows the context for deciding (approved vacations that day and who, other absences, other requests waiting);
 *    each row: who (avatar, name, group), when it was asked, its place in the day's queue, the stations the person holds
 *    that day, and อนุมัติ / ไม่อนุมัติ with a per-row busy state. The day data is loaded through core.ensureRange when it is
 *    not loaded (quietly; the list never waits for it). Badge = number of pending requests.
 *  - core.provide('leave.decide', fn) — the ONE decision flow, used by this screen and by the leave sheet's buttons:
 *    ไม่อนุมัติ always asks for an optional reason (≤ 200 characters) in a dialog that names the person and the date;
 *    อนุมัติ is one tap, except when the person holds a station that day (the approval takes them off it): then a
 *    confirmation names the person, the date and the stations. It sends decideLeave with `expect` = the status the
 *    caller saw (I1: the server refuses to overturn a decision made elsewhere), calls req.onSending() right before the
 *    request goes out (the leave sheet shows "กำลังบันทึก…" only then), shows the result toast (person + date) and resolves
 *    the server's answer {leave, day} — or null when the user cancelled, the device is offline, the session / role changed
 *    meanwhile, the request was cancelled on another device (NOT_FOUND: a clear message, then the date is reloaded) or
 *    already decided elsewhere (CONFLICT: a message naming who decided what; the fresh row and day that came with the
 *    answer are applied, so the list and the sheet show the truth at once). Any other failure rejects (the caller's
 *    handleError shows it). The dialogs are core.prompt / core.confirm with UiKit's detail / maxLength options.
 *    The provider exists only while the user is the Supervisor on a server with 'approval'.
 *  - Banners (core.banners): 'approval-pending' on วันนี้ and การลา for the Supervisor while requests wait (action opens
 *    the inbox); 'approval-rejected' on การลา for anyone else whose own request was rejected (date and reason; action opens
 *    that day's leave sheet; its "ซ่อน" (core.banners' dismiss option) hides it for that request — remembered per user in
 *    core.store.draft 'approval-dismissed', which the core removes at logout).
 *
 * Every async flow runs through core.spawn / core.track and re-checks core.alive() (and the role) after each await, so
 * nothing is sent or applied after a logout, a new login or a role transfer.
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function') return;   // app.js did not start (boot guard): nothing to attach to

  const ID = 'approval';
  const BANNER_PENDING = 'approval-pending';
  const BANNER_REJECTED = 'approval-rejected';
  const BANNER_APPROVED = 'approval-approved';   // FIX-CL CL-14: the one-time "approved" notice of the requester
  const DISMISS_KEY = 'approval-dismissed';   // core.store.draft key: rejections whose banner the user dismissed
  const MINE_KEY = 'approval-mine';           // core.store.draft key: {pending: [key], approved: [key]} (see syncApprovedNotice)
  const DISMISS_MAX = 60;
  const NOTE_MAX = 200;                        // the server's limit for a decision note
  const VACATION = 'พักร้อน';
  const CLUSTER_GAP_DAYS = 31;                 // missing dates closer than this are loaded with one ensureRange

  let core = null;
  let root = null;
  let provided = false;                        // our 'leave.decide' provider is registered
  const busy = new Map();                      // 'date|staff' → {phase: 'ask'|'send', decision}
  const loadTried = new Set();                 // 'from|to' context loads started this visit
  const loadFailed = new Set();                // dates whose context could not be loaded
  let pendingSig = null;                       // what the banners show now (no banners.set when unchanged)
  let rejectedSig = null;
  let approvedSig = null;
  const checking = new Set();                  // dates loaded once this session to learn what became of a request of mine

  /* ---------------------------------------------------------------- small helpers */
  const keyOf = (date, staff) => date + '|' + staff;
  const esc = s => core.esc(s);
  const U = () => core.U;
  const K = () => core.Kit.cls;
  const today = () => U().todayStr();

  function enabled(c) { return !!c.state.user && c.isSup() && c.serverHas('approval'); }

  /** The Supervisor's pending requests (state.requests: sorted by date, then recordedAt). */
  function pendingList(c) {
    return (c.state.requests || []).filter(r => r && U().leaveStatus(r) === 'pending');
  }

  /** "วันนี้" only for today, else "วันที่ 19 พ.ย. 2569" (the app's wording rule). */
  function dayRef(date) { return date === today() ? 'วันนี้' : 'วันที่ ' + U().thaiDateShort(date); }

  /** "วันนี้" / "พรุ่งนี้" / "เมื่อวาน" / "อีก 3 วัน" / "3 วันที่แล้ว". */
  function relDay(date) {
    const n = U().daysBetweenInclusive(today(), date) - 1;
    if (!isFinite(n)) return '';
    if (n === 0) return 'วันนี้';
    if (n === 1) return 'พรุ่งนี้';
    if (n === -1) return 'เมื่อวาน';
    return n > 0 ? 'อีก ' + n + ' วัน' : (-n) + ' วันที่แล้ว';
  }

  function groupOf(c, name) {
    const s = c.staff().filter(p => p.name === name)[0];
    if (!s) return 'ไม่อยู่ในระบบ';
    return s.group === 'backup' ? 'ทีมแทนเวร' : 'คนประจำ';
  }

  /** Stations `staff` holds on `date` in the loaded data (names, in station order). */
  function stationsOf(c, date, staff) { return stationsIn(c.state.days && c.state.days[date], staff); }
  /** Stations `staff` holds in a day object ({assignments}), e.g. the `day` of a decideLeave answer. */
  function stationsIn(day, staff) {
    if (!day || !day.assignments) return [];
    return U().STATIONS.filter(st => (day.assignments[st.id] || []).indexOf(staff) >= 0).map(st => st.name);
  }

  function dayLoaded(c, date) { const v = c.dayView(date); return v === 'ready' || v === 'cached'; }

  /** The decision context of a date from the loaded data (null when the date is not loaded). */
  function dayContext(c, date) {
    if (!dayLoaded(c, date)) return null;
    const map = c.leavesOn(date);
    const order = U().queueOrder(map, VACATION);
    const approved = order.filter(n => map[n] && U().leaveStatus(map[n]) === 'approved');
    const others = c.leaveList(date).filter(l => l.type !== VACATION);
    return { approved, order, others };
  }

  /**
   * The reason as typed: line breaks kept (CL-17: the field is multi-line; the server keeps them and every place that shows a
   * reason keeps them too), spaces and blank lines tidied, trimmed.
   */
  function cleanNote(v) {
    return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
      .split('\n').map(s => s.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------------------------------------------------------- dialogs (UiKit dialogs via core: App.idle-safe) */
  /** The framed block of both dialogs: the person and the full date (native dialogs get it as the first lines). */
  function who(date, staff, tone) {
    return { avatar: staff, title: staff, text: U().thaiDate(date) + (date === today() ? ' (วันนี้)' : ''), tone };
  }

  /**
   * → Promise<string|null>: the reason ('' = none), or null when cancelled / too long (a native prompt cannot limit it).
   * CL-17: a growing multi-line field (Enter = new line), the counter announced only near the limit, an over-long input cut
   * at NOTE_MAX in the field itself (UiKit opts.multiline / maxLength).
   */
  function askReason(c, date, staff) {
    const p = c.prompt('เหตุผล (ไม่บังคับ ไม่เกิน ' + NOTE_MAX + ' ตัวอักษร) — ผู้ขอจะเห็นข้อความนี้ในแอป', '', {
      title: 'ไม่อนุมัติคำขอพักร้อน', okLabel: 'ไม่อนุมัติ', cancelLabel: 'ยกเลิก', danger: true, icon: 'calendar-off',
      placeholder: 'เช่น วันนั้นคนไม่พอ', maxLength: NOTE_MAX, multiline: true, detail: who(date, staff, 'danger'),
      data: { approvalDialog: 'reject', date, staff }
    });
    return Promise.resolve(p).then(v => {
      if (v === null || v === undefined) return null;
      const note = cleanNote(v);
      if (note.length > NOTE_MAX) {
        c.toast('⚠️ เหตุผลยาวได้ไม่เกิน ' + NOTE_MAX + ' ตัวอักษร — ยังไม่ได้บันทึก', 0, { error: true });
        return null;
      }
      return note;
    });
  }

  /**
   * When the person holds a station that day (the approval takes them off it), and ALWAYS when the date's data is not loaded
   * from the server (FIX-CL CL-3: the app cannot know whether they hold one). known: the date is loaded ('ready').
   * → Promise<boolean>
   */
  function askApprove(c, date, staff, stations, known) {
    const that = date === today() ? 'วันนี้' : 'วันนั้น';
    let note;
    if (known) {
      note = staff + ' อยู่ใน Station ' + stations.join(', ') + ' ของ' + that + ' — เมื่ออนุมัติจะถูกนำออกจาก Station โดยอัตโนมัติ';
    } else if (stations.length) {
      note = 'ตามข้อมูลที่บันทึกไว้ในเครื่อง (อาจยังไม่ล่าสุด) ' + staff + ' อยู่ใน Station ' + stations.join(', ') + ' ของ' + that +
        ' — เมื่ออนุมัติ ถ้ายังอยู่ใน Station จะถูกนำออกโดยอัตโนมัติ';
    } else {
      note = 'ยังไม่ได้โหลดตารางของ' + that + ' จึงยังไม่รู้ว่า ' + staff + ' อยู่ใน Station หรือไม่' +
        ' — เมื่ออนุมัติ ถ้าอยู่ใน Station จะถูกนำออกโดยอัตโนมัติ';
    }
    return Promise.resolve(c.confirm(note, {
      title: 'อนุมัติคำขอพักร้อน', okLabel: 'อนุมัติ', cancelLabel: 'ยกเลิก', icon: 'check-circle',
      detail: who(date, staff, 'ok'), data: { approvalDialog: 'approve', date, staff }
    })).then(v => !!v);
  }

  /** Closes an open decision dialog (role lost, logout): resolves its question with the cancel value. */
  function closeDialog() {
    document.querySelectorAll('[data-approval-dialog]').forEach(el => { if (el.isConnected) core.Kit.sheet.close(el, 'api'); });
  }

  /* ---------------------------------------------------------------- the decision (provider of 'leave.decide') */
  /**
   * req: {date, staff, decision: 'approved'|'rejected', leave}. → Promise<{leave, day} | null>. Does not apply the answer
   * (the leave sheet and the inbox apply it with core.applyLeaveResult / their own code).
   */
  async function decide(req, c) {
    c = c || core;
    const r = req && typeof req === 'object' ? req : {};
    const date = r.date, staff = r.staff, decision = r.decision;
    if (!U().isValidYmd(date) || typeof staff !== 'string' || !staff) return null;
    if (decision !== 'approved' && decision !== 'rejected') return null;
    if (!enabled(c)) return null;
    const key = keyOf(date, staff);
    if (busy.has(key)) return null;                 // a decision of this request is already asked or in flight
    if (!c.requireInternet()) return null;
    const alive = c.alive();
    const still = () => alive() && enabled(c);
    const entry = { phase: 'ask', decision };
    busy.set(key, entry);
    paint();
    try {
      let note = '';
      const view = c.dayView(date);
      const known = view === 'ready';
      const before = known || view === 'cached' ? stationsOf(c, date, staff) : [];
      if (decision === 'rejected') {
        const v = await askReason(c, date, staff);
        if (v === null || !still()) return null;
        note = v;
      } else if (date < today()) {
        // Code.gs 3.0 (BK-7): approving a request dated before today takes nobody off that day (history is kept): no question
      } else if (before.length || !known) {
        if (!(await askApprove(c, date, staff, before, known)) || !still()) return null;
      }
      if (!c.requireInternet()) return null;
      entry.phase = 'send';
      paint();
      if (typeof r.onSending === 'function') { try { r.onSending(); } catch (e) { console.error('[approval] onSending failed:', e); } }
      // expect: the status the caller saw — the server refuses to overturn a decision made elsewhere (CONFLICT)
      const params = { date, staff, decision, expect: U().leaveStatus(r.leave) || 'pending' };
      if (note) params.note = note;
      let res;
      try {
        res = await c.userCall('decideLeave', params);
      } catch (e) {
        if (!alive()) return null;
        if (e && e.code === 'NOT_FOUND') {
          c.toast('⚠️ คำขอของ ' + staff + ' · ' + dayRef(date) + ' ถูกยกเลิกหรือเปลี่ยนไปแล้วจากเครื่องอื่น — แสดงข้อมูลล่าสุดแล้ว', 0, { error: true });
          await reloadDate(c, date, alive);
          return null;
        }
        if (e && e.code === 'CONFLICT') {
          await onDecided(c, date, staff, e, alive);
          return null;
        }
        throw e;
      }
      if (!alive()) return null;
      const out = res && typeof res === 'object' ? res : { leave: null, day: null };
      c.toast(resultText(c, decision, date, staff, out), 3500);
      return out;
    } finally {
      if (busy.get(key) === entry) busy.delete(key);
      if (alive()) paint();
    }
  }

  /**
   * The result toast, from the server's answer only (CL-3): an approval answers a `day` exactly when it took the person off
   * that day's stations. Which stations is named only when the local copy is the version right before that day (so it is
   * what the server changed); otherwise the toast says that they were taken off, without naming stations.
   */
  function resultText(c, decision, date, staff, out) {
    let msg = (decision === 'approved' ? '✅ อนุมัติพักร้อนของ ' : '📝 ไม่อนุมัติพักร้อนของ ') + staff + ' · ' + dayRef(date);
    const day = decision === 'approved' && out && out.day && typeof out.day === 'object' ? out.day : null;
    if (!day) return msg;
    const prev = c.state.days && c.state.days[date];
    const exact = !!prev && (prev.version | 0) === (day.version | 0) - 1;
    const off = exact ? stationsIn(prev, staff).filter(n => stationsIn(day, staff).indexOf(n) < 0) : [];
    return msg + (off.length ? ' — นำออกจาก ' + off.join(', ') + ' แล้ว' : ' — นำออกจาก Station ของ' + (date === today() ? 'วันนี้' : 'วันนั้น') + 'แล้ว');
  }

  const STATUS_WORD = { approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', pending: 'รออนุมัติ' };

  /**
   * CONFLICT: the request was decided elsewhere (another device of the Supervisor, or before a role transfer). The answer
   * carries the current row and day: they are applied (row, requests, an auto-unassigned day) and the message names
   * who decided what. Without them (never from Code.gs 3.0) the date is fetched again.
   */
  async function onDecided(c, date, staff, e, alive) {
    const d = e.details && typeof e.details === 'object' ? e.details : {};
    const fresh = d.leave && typeof d.leave === 'object' && d.leave.type ? d.leave : null;
    const st = fresh ? U().leaveStatus(fresh) : '';
    const by = fresh && fresh.decidedBy && st !== 'pending' ? ' โดย ' + fresh.decidedBy : '';
    c.toast('⚠️ คำขอพักร้อนของ ' + staff + ' · ' + dayRef(date) + ' ถูกพิจารณาไปแล้ว' +
      (st ? by + ' (' + STATUS_WORD[st] + ')' : '') + ' — แสดงข้อมูลล่าสุดแล้ว', 0, { error: true });
    if (fresh && fresh.date === date && fresh.staff === staff) c.applyLeaveResult({ leave: fresh, day: d.day || null }, { date, staff });
    else await reloadDate(c, date, alive);
  }

  /** After a NOT_FOUND: the date (and with it state.requests, which every full answer carries) is fetched again. */
  async function reloadDate(c, date, alive) {
    try { await c.ensureRange(date, date, { force: true }); }
    catch (e) { if (alive()) c.handleError(e, { quiet: true }); }
  }

  /** The provider object registered with core.provide (one stable function). */
  function provider(req, c) { return decide(req, c); }

  /** An inbox row's button. */
  function onRowDecision(c, date, staff, decision) {
    const r = pendingList(c).filter(x => x.date === date && x.staff === staff)[0];
    if (!r || busy.has(keyOf(date, staff))) return;
    const order = root ? Array.prototype.map.call(root.querySelectorAll('.approval-row'), x => keyOf(x.dataset.date, x.dataset.staff)) : [];
    c.spawn(async () => {
      const alive = c.alive();
      let res = null;
      try {
        res = await decide({ date, staff, decision, leave: Object.assign({}, r) }, c);
        if (res && alive()) c.applyLeaveResult(res, { date, staff });
      } finally {
        if (alive()) keepFocus(date, staff, decision, order);
      }
    }, { write: true });
  }

  /**
   * CL-15: after a decision the focus stays in the inbox — on the next request's first button (or the date's heading when it
   * was the date's last request); after a cancelled / failed one on the same button again. Only when the focus is lost
   * (on <body> or a removed node) or still in the inbox: never pulled away from elsewhere.
   */
  function keepFocus(date, staff, decision, order) {
    if (!root || !core || core.current() !== ID) return;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected && !root.contains(a)) return;
    const focus = el => { if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } } };
    const rowOf = (d, s) => Array.prototype.filter.call(root.querySelectorAll('.approval-row'), x => x.dataset.date === d && x.dataset.staff === s)[0];
    const same = rowOf(date, staff);
    if (same) { focus(same.querySelector('[data-approval-act="' + decision + '"]:not([disabled])') || same.querySelector('[data-approval-act]')); return; }
    const at = order.indexOf(keyOf(date, staff));
    for (let i = at + 1; i < order.length; i++) {
      const [d, ...rest] = order[i].split('|');
      const next = rowOf(d, rest.join('|'));
      if (next) { focus(next.querySelector('[data-approval-act]')); return; }
    }
    const head = root.querySelector('[data-approval-group="' + date + '"] [data-approval-heading]') ||
      root.querySelector('[data-approval-heading]') || root.querySelector('[data-approval-empty] h2, [data-approval-empty] h3, [data-approval-empty] p');
    if (head) { head.setAttribute('tabindex', '-1'); focus(head); }
  }

  /* ---------------------------------------------------------------- context loading (quiet, never blocks the list) */
  function ensureContext(c) {
    if (!enabled(c) || c.current() !== ID) return;
    const dates = [];
    pendingList(c).forEach(r => { if (dates.indexOf(r.date) < 0 && c.dayView(r.date) === 'missing') dates.push(r.date); });
    if (!dates.length) return;
    dates.sort();
    const ranges = [];
    dates.forEach(d => {
      const last = ranges[ranges.length - 1];
      if (last && U().daysBetweenInclusive(last.to, d) - 1 <= CLUSTER_GAP_DAYS) last.to = d;
      else ranges.push({ from: d, to: d });
    });
    ranges.forEach(rg => {
      const k = rg.from + '|' + rg.to;
      if (loadTried.has(k)) return;
      loadTried.add(k);
      const alive = c.alive();
      c.spawn(async () => {
        try { await c.ensureRange(rg.from, rg.to); }
        catch (e) {
          if (!alive()) return;
          U().eachDate(rg.from, rg.to).forEach(d => loadFailed.add(d));
          c.handleError(e, { quiet: true });
        }
        if (alive()) paint();
      });
    });
  }

  /* ---------------------------------------------------------------- the inbox */
  function paint() {
    if (!core || !root || core.current() !== ID) return;
    renderInbox(root, core);
  }

  function renderInbox(el, c) {
    const k = K();
    const wrap = inner => `<div class="space-y-3 md:max-w-2xl md:mx-auto" data-approval-inbox>${inner}</div>`;
    if (!c.state.user || !c.serverMode()) {
      c.setHtml(el, wrap(`<div class="${k.card}">${c.Kit.skeleton(3)}</div>`));
      return;
    }
    const list = pendingList(c);
    const slots = c.state.rules && Number.isInteger(c.state.rules.vacationAutoSlots) ? c.state.rules.vacationAutoSlots : null;
    if (!list.length) {
      c.setHtml(el, wrap(`<div class="${k.card}" data-approval-empty>` + c.Kit.empty({
        icon: 'check-circle',
        title: 'ไม่มีคำขอที่รออนุมัติ',
        hint: slots === 0 ? 'ทุกคำขอพักร้อนต้องให้ Supervisor อนุมัติ — คำขอใหม่จะมารอคุณพิจารณาที่นี่'   // CL-6
          : slots !== null
            ? 'พักร้อน ' + slots + ' คนแรกของแต่ละวันได้รับอนุมัติอัตโนมัติ — คำขอตั้งแต่คนที่ ' + (slots + 1) + ' จะมารอคุณพิจารณาที่นี่'
            : 'คำขอลาพักร้อนที่เกินจำนวนอัตโนมัติของวันจะมารอคุณพิจารณาที่นี่'
      }) + '</div>'));
      return;
    }
    const t = today();
    const dates = [];
    list.forEach(r => { if (dates.indexOf(r.date) < 0) dates.push(r.date); });
    const future = dates.filter(d => d >= t).sort();
    const past = dates.filter(d => d < t).sort().reverse();   // most recent first
    let html = `<div class="flex items-center gap-2 px-1">` +
      `<p class="${k.textMeta} flex-1 min-w-0">` +
      (slots === 0 ? 'ทุกคำขอพักร้อนต้องให้ Supervisor อนุมัติ คำขอมารอคุณพิจารณาที่นี่'
        : slots !== null ? 'พักร้อน ' + slots + ' คนแรกของแต่ละวันอนุมัติอัตโนมัติ คำขอที่เกินมารอคุณพิจารณาที่นี่' : 'คำขอลาพักร้อนที่รอคุณพิจารณา') +
      `</p>${c.Kit.pill('รอ ' + list.length + ' คำขอ', 'pending')}</div>`;   // CL-24: requests are counted in "คำขอ"
    html += future.map(d => groupHtml(c, d, list.filter(r => r.date === d), false)).join('');
    if (past.length) {
      html += `<div class="pt-2 space-y-3" data-approval-past><div class="px-1"><h2 class="${k.sectionTitle}">ผ่านวันที่แล้ว</h2>` +
        `<p class="${k.textMeta}">วันลาผ่านไปแล้วแต่คำขอยังไม่ได้พิจารณา</p></div>` +
        past.map(d => groupHtml(c, d, list.filter(r => r.date === d), true)).join('') + '</div>';
    }
    c.setHtml(el, wrap(html));
  }

  /** One entry of a context line ("<name> (ลาประชุม)"): never broken inside — Thai words split mid-word otherwise. */
  function nowrap(t) { return `<span class="whitespace-nowrap">${esc(t)}</span>`; }

  function groupHtml(c, date, rows, isPast) {
    const k = K();
    const ctx = dayContext(c, date);
    const rel = relDay(date);
    // CL-23: the date never breaks inside a unit ("พ. 18 พ.ย." | "2569"); below 360 px "ดูตาราง" moves under the heading
    const year = Number(String(date).slice(0, 4)) + 543;
    const head = `<div class="${k.cardHead} flex-wrap gap-y-1">` +
      `<span class="${k.listIcon} ${isPast ? k.listIconNeutral : date === today() ? k.listIconBrand : k.listIconSun}">${c.Kit.icon('calendar', 'w-5 h-5')}</span>` +
      `<div class="min-w-0 flex-1 max-[359px]:basis-[calc(100%-52px)]"><h3 class="${k.titleCard} outline-none" data-approval-heading>` +
        `<span class="whitespace-nowrap">${esc(U().thaiDateShort(date, { weekday: true, year: false }))}</span> <span class="whitespace-nowrap">${year}</span></h3>` +
      (rel ? `<p class="${k.textMeta}">${esc(rel)}</p>` : '') + `</div>` +
      `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact} shrink-0 max-[359px]:ml-[52px]" data-approval-day="${esc(date)}" ` +
        `aria-label="${esc('ดูตาราง' + dayRef(date))}">ดูตาราง${c.Kit.icon('chevron-right', 'w-4 h-4')}</button></div>`;
    const line = (key, n, icon, tone, html) => `<p class="flex items-start gap-1.5" data-approval-${key}="${n}">` +
      c.Kit.icon(icon, 'w-4 h-4 shrink-0 mt-1 ' + tone) + `<span class="min-w-0">${html}</span></p>`;
    let context;
    if (ctx) {
      const lines = [];
      lines.push(line('approved', ctx.approved.length, 'check-circle', 'text-emerald-700', ctx.approved.length
        ? `พักร้อนแล้ว <strong class="font-semibold text-ink-900">${ctx.approved.length} คน</strong>: ${ctx.approved.map(nowrap).join(', ')}`
        : 'ยังไม่มีผู้ลาพักร้อนที่อนุมัติแล้ว'));
      if (ctx.others.length) {
        lines.push(line('others', ctx.others.length, 'calendar-off', 'text-ink-500',
          `ลาอื่น ${ctx.others.length} คน: ${ctx.others.map(l => nowrap(l.name + ' (' + l.type + ')')).join(', ')}`));
      }
      if (rows.length > 1) {
        lines.push(line('waiting', rows.length, 'clock', 'text-amber-800', `รออนุมัติ ${rows.length} คำขอ`));
      }
      context = `<div class="p-3 rounded-2xl bg-cream-50 border-2 border-cream-100 text-sm leading-6 text-slate-700 space-y-1 ${k.wrapAnywhere}" data-approval-context="${esc(date)}">${lines.join('')}</div>`;
    } else if (loadFailed.has(date) && c.dayView(date) === 'missing') {
      context = `<p class="${k.textMeta} px-1" data-approval-context="${esc(date)}" data-state="failed">ยังโหลดข้อมูลวันนั้นไม่ได้ — ยังตัดสินใจได้ (ก่อนอนุมัติจะถามยืนยันเสมอ) หรือกด "ดูตาราง" เพื่อโหลดอีกครั้ง</p>`;
    } else {
      context = `<div class="px-1" data-approval-context="${esc(date)}" data-state="loading">${c.Kit.skeleton(1)}</div>`;
    }
    // a list card (cls.list: white sticker, clipped corners, one divider between the date block and the rows)
    return `<section class="${k.list}" data-approval-group="${esc(date)}"${isPast ? ' data-past="1"' : ''}>` +
      `<div class="p-4 space-y-3">${head}${context}</div>` +
      `<div class="divide-y divide-brand-100">${rows.map(r => rowHtml(c, r, ctx)).join('')}</div></section>`;
  }

  function rowHtml(c, r, ctx) {
    const k = K();
    const key = keyOf(r.date, r.staff);
    const b = busy.get(key);
    const sending = b && b.phase === 'send';
    const rank = ctx ? ctx.order.indexOf(r.staff) + 1 : 0;
    const stations = r.date < today() ? [] : stationsOf(c, r.date, r.staff);   // a past day keeps its stations (BK-7)
    const stamp = r.recordedAt ? U().thaiStampShort(r.recordedAt) : '';
    const what = 'พักร้อนของ ' + r.staff + ' ' + dayRef(r.date);
    const btn = (decision, look, icon, label) => {
      const on = sending && b.decision === decision;
      return `<button type="button" class="${k.btn} ${look} flex-1 min-w-0" data-approval-act="${decision}"` +
        `${b ? ' disabled' : ''}${on ? ' aria-busy="true"' : ''} aria-label="${esc(label + what)}">` +
        (on ? 'กำลังบันทึก…' : (icon ? c.Kit.icon(icon, 'w-5 h-5') : '') + `<span class="truncate">${esc(label)}</span>`) + '</button>';
    };
    return `<div class="approval-row px-4 py-3 space-y-3" data-date="${esc(r.date)}" data-staff="${esc(r.staff)}"` +
        `${b ? ' data-busy="' + esc(b.phase === 'send' ? b.decision : 'ask') + '"' : ''}>` +
      `<div class="flex items-center gap-3 min-w-0">${c.Kit.avatar(r.staff, 'md')}` +
        `<div class="min-w-0 flex-1"><p class="flex flex-wrap items-center gap-x-2 gap-y-1">` +
          `<span class="min-w-0 font-display text-base font-medium leading-6 text-ink-900 break-words">${esc(r.staff)}</span>` +
          `<span class="${k.tag}" data-approval-group-label>${esc(groupOf(c, r.staff))}</span></p>` +
        // CL-23: "ขอเมื่อ 18 พ.ย. 08:30 น." never leaves a lone "น." on its own line
        (stamp ? `<p class="${k.textMeta}" data-approval-meta>ขอเมื่อ <span class="whitespace-nowrap">${esc(stamp)}</span></p>` : '') + '</div>' +
        (rank ? `<span class="shrink-0">${c.Kit.pill('คนที่ ' + rank, 'pending', 'clock')}</span>` : '') + '</div>' +
      (stations.length
        ? `<p class="flex items-start gap-1.5 text-[0.8125rem] font-medium leading-5 text-amber-800" data-approval-stations>` +
          `${c.Kit.icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5')}<span class="min-w-0">อยู่ใน ${esc(stations.join(', '))} — อนุมัติแล้วจะถูกนำออก</span></p>`
        : '') +
      // full width on a phone; from 640 px a compact pair at the right (the same order as the leave sheet's buttons)
      `<div class="flex gap-2 ml-auto sm:max-w-[16rem]">${btn('rejected', k.btnSecondary, '', 'ไม่อนุมัติ')}${btn('approved', k.btnPrimary, 'check', 'อนุมัติ')}</div>` +
      '</div>';
  }

  function onRootClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !c) return;
    const act = t.closest('[data-approval-act]');
    if (act && root.contains(act)) {
      const row = act.closest('.approval-row');
      if (!act.disabled && row) onRowDecision(c, row.dataset.date, row.dataset.staff, act.dataset.approvalAct);
      return;
    }
    const day = t.closest('[data-approval-day]');
    if (day && root.contains(day)) {
      const date = day.dataset.approvalDay;
      const alive = c.alive();
      c.spawn(async () => {
        if (!(await c.setSelectedDate(date)) || !alive()) return;
        await c.go('station');
      });
    }
  }

  /* ---------------------------------------------------------------- banners and the provider */
  function syncProvider(c) {
    if (!c.state.user) return;                     // logged out: reset() withdrew it; the next login decides
    const want = enabled(c);
    if (want && !provided) {
      c.provide('leave.decide', provider);
      provided = true;
    } else if (!want && provided) {
      if (c.use('leave.decide') === provider) c.provide('leave.decide', null);
      provided = false;
    }
  }

  function syncPendingBanner(c) {
    const n = enabled(c) ? pendingList(c).length : 0;
    const sig = String(n);
    if (sig === pendingSig) return;
    pendingSig = sig;
    c.banners.set(BANNER_PENDING, n ? {
      text: 'มีคำขอพักร้อนรออนุมัติ ' + n + ' คำขอ',
      tone: 'warn', icon: 'inbox', order: 10, screens: ['station', 'leave'],
      actionLabel: 'ดูคำขอ',
      action: cc => cc.go(ID)
    } : null);
  }

  function rejectKey(r) { return r.date + '|' + (r.decidedAt || r.recordedAt || ''); }

  function dismissedList(c) {
    const v = c.store.draft.get(DISMISS_KEY);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  }

  /** My own rejected requests whose banner I did not dismiss, newest decision first. */
  function rejectedForBanner(c) {
    if (!c.state.user || c.isSup() || !c.serverHas('approval')) return [];
    const me = c.myName();
    const gone = dismissedList(c);
    return (c.state.requests || []).filter(r => r && r.staff === me && U().leaveStatus(r) === 'rejected' && gone.indexOf(rejectKey(r)) < 0)
      .sort((a, b) => (String(a.decidedAt) < String(b.decidedAt) ? 1 : String(a.decidedAt) > String(b.decidedAt) ? -1 : 0));
  }

  /**
   * CL-14: the requester sees a rejection where they actually look — on วันนี้ and การลา — and a dot on the การลา nav entry
   * while one is not dismissed. CL-22: soft coral, the tone of "rejected" everywhere.
   */
  function syncRejectedBanner(c) {
    const list = rejectedForBanner(c);
    c.badges.dot('leave', list.length ? 'มีคำขอลาที่ไม่ได้รับอนุมัติ' : '');
    const sig = JSON.stringify(list.map(r => [rejectKey(r), r.note || '', r.date === today()]));
    if (sig === rejectedSig) return;
    rejectedSig = sig;
    if (!list.length) { c.banners.set(BANNER_REJECTED, null); return; }
    const r = list[0];
    const ref = dayRef(r.date);
    let text = 'คำขอพักร้อน' + (r.date === today() ? ref : ref + ' ') + 'ไม่ได้รับอนุมัติ';
    text += r.note ? '\nเหตุผล: ' + r.note : (r.decidedBy ? '\nโดย ' + r.decidedBy : '');
    if (list.length > 1) text += '\nและอีก ' + (list.length - 1) + ' คำขอ ดูได้ใน "คำขอของฉัน"';
    c.banners.set(BANNER_REJECTED, {
      text, tone: 'danger', icon: 'calendar-off', order: 11, screens: ['station', 'leave'],
      actionLabel: 'ดูคำขอ',
      action: cc => cc.openLeave(r.date, r.staff),
      dismissLabel: 'ซ่อนข้อความนี้',
      onDismiss: cc => dismissRejected(cc)
    });
  }

  function dismissRejected(c) {
    const shown = rejectedForBanner(c).map(rejectKey);
    if (!shown.length) return;
    const all = dismissedList(c).filter(k => shown.indexOf(k) < 0).concat(shown);
    c.store.draft.set(DISMISS_KEY, all.slice(-DISMISS_MAX));
    syncRejectedBanner(c);
  }

  /* ---------------------------------------------------------------- CL-14: the one-time "approved" notice */
  const reqKey = r => r.date + '|' + (r.recordedAt || '');
  function mineState(c) {
    const v = c.store.draft.get(MINE_KEY);
    const list = x => (Array.isArray(x) ? x.filter(k => typeof k === 'string' && k.indexOf('|') > 0) : []);
    return { pending: list(v && v.pending), approved: list(v && v.approved) };
  }

  /**
   * A request of mine that was pending and is no longer in `requests` (and not rejected) was approved — or deleted. Which one
   * is read from the date's leave row (an approved พักร้อน with the same recordedAt); a date that is not loaded is loaded once
   * quietly. Confirmed approvals show one banner (on วันนี้ and การลา) until it is dismissed; what was seen is remembered per
   * user (core.store.draft, removed at logout, like the dismissed rejections).
   */
  function syncApprovedNotice(c, payload) {
    if (!c.state.user || c.isSup() || !c.serverHas('approval')) {
      if (approvedSig !== '') { approvedSig = ''; c.banners.set(BANNER_APPROVED, null); }
      return;
    }
    const me = c.myName();
    const st = mineState(c);
    const reqs = (c.state.requests || []).filter(r => r && r.staff === me);
    const nowPending = reqs.filter(r => U().leaveStatus(r) === 'pending').map(reqKey);
    const nowRejected = reqs.filter(r => U().leaveStatus(r) === 'rejected').map(reqKey);
    const keep = [];
    // a `requests` change is announced before the same answer's rows are merged: wait for that merge before loading anything
    const rowsComing = !!(payload && payload.requests);
    st.pending.forEach(k => {
      if (nowPending.indexOf(k) >= 0 || nowRejected.indexOf(k) >= 0) return;
      const date = k.slice(0, k.indexOf('|')), at = k.slice(k.indexOf('|') + 1);
      const view = c.dayView(date);
      const known = view === 'ready' || view === 'cached';
      const row = known ? c.leavesOn(date)[me] : null;
      const same = !!row && row.type === VACATION && String(row.recordedAt || '') === at;
      const st1 = same ? U().leaveStatus(row) : '';
      if (st1 === 'approved') { if (st.approved.indexOf(k) < 0) st.approved.push(k); return; }
      // a fresh answer for the date says what became of it: no row (cancelled / deleted), another type or a new request
      // (re-typed), rejected → nothing to announce
      if (view === 'ready' && st1 !== 'pending') return;
      // the date is not loaded, only in the offline copy, or still shows the stale pending row (a date outside the polled
      // window, also after a restart — reviewer 2 finding 2): that date is loaded again ONCE per request (forced), then decided
      if (checking.has(k)) {
        if (view !== 'ready') keep.push(k);   // the load failed: decided at a later start, never in a loop
        return;
      }
      keep.push(k);
      if (rowsComing || !U().isValidYmd(date)) return;
      checking.add(k);
      const alive = c.alive();
      c.spawn(async () => {
        try { await c.ensureRange(date, date, { force: true }); } catch (e) { if (alive()) c.handleError(e, { quiet: true }); }
        if (alive()) syncApprovedNotice(c);
      });
    });
    const next = { pending: nowPending.concat(keep.filter(k => nowPending.indexOf(k) < 0)), approved: st.approved.slice(-DISMISS_MAX) };
    if (JSON.stringify(next) !== JSON.stringify(st)) c.store.draft.set(MINE_KEY, next.pending.length || next.approved.length ? next : null);
    const sig = JSON.stringify(next.approved);
    if (sig === approvedSig) return;
    approvedSig = sig;
    if (!next.approved.length) { c.banners.set(BANNER_APPROVED, null); return; }
    const first = next.approved.slice().sort()[0];
    const date = first.slice(0, first.indexOf('|'));
    const ref = dayRef(date);
    let text = 'คำขอพักร้อน' + (date === today() ? ref : ref + ' ') + 'ได้รับอนุมัติแล้ว';
    if (next.approved.length > 1) text += ' และอีก ' + (next.approved.length - 1) + ' คำขอ';
    c.banners.set(BANNER_APPROVED, {
      text, tone: 'ok', icon: 'check-circle', order: 12, screens: ['station', 'leave'],
      actionLabel: 'ดูวันนั้น',
      action: cc => cc.openLeave(date, me),
      dismissLabel: 'ซ่อนข้อความนี้',
      onDismiss: cc => {
        const s = mineState(cc);
        cc.store.draft.set(MINE_KEY, s.pending.length ? { pending: s.pending, approved: [] } : null);
        syncApprovedNotice(cc);
      }
    });
  }

  function sync(c, payload) {
    syncProvider(c);
    syncPendingBanner(c);
    syncRejectedBanner(c);
    syncApprovedNotice(c, payload);
    if (c.current() === ID) { paint(); ensureContext(c); }
  }

  /* ---------------------------------------------------------------- registration */
  App.register({
    id: ID,
    title: 'อนุมัติการลา',
    icon: 'check-circle',
    nav: { place: 'menu', section: 'sup', order: 20 },
    parent: 'menu',
    visible: c => c.isSup() && c.serverHas('approval'),
    badge: c => pendingList(c).length,
    init(c) {
      core = c;
      c.on('data', p => sync(c, p));
      c.on('login', () => sync(c));
      c.on('role', p => {
        if (!p || !p.isSup) closeDialog();
        sync(c);
      });
      c.on('logout', () => { closeDialog(); pendingSig = null; rejectedSig = null; approvedSig = null; checking.clear(); });
      if (c.state.user) sync(c);
    },
    mount(el) {
      root = el;
      el.addEventListener('click', onRootClick);
    },
    render(el, c) { renderInbox(el, c); },
    show(c) {
      loadTried.clear();
      loadFailed.clear();
      ensureContext(c);
    },
    reset() {
      closeDialog();
      if (provided && core && core.use('leave.decide') === provider) core.provide('leave.decide', null);   // nothing left after logout
      provided = false;
      busy.clear();
      loadTried.clear();
      loadFailed.clear();
      checking.clear();
      pendingSig = null;
      rejectedSig = null;
      approvedSig = null;
      if (root) { root.innerHTML = ''; root._html = ''; }
    }
  });
})();
