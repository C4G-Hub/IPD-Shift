/* =====================================================================
 * js/feat-chat.js — แชท 1:1 (R3-SPEC §4.7, track CH) → App.register
 *
 * Two screens and one data slice. Uses only App.core (developer note of the registry section in js/app.js) and UiKit.
 *
 *  'chat'       title "แชท", icon message, nav {place: 'header', order: 10}, badge = the total of unread messages, visible
 *               while core.serverHas('chat'). The conversation list: the privacy line, "แชทใหม่" (a sheet with a search
 *               field and the active staff except me), one row per peer (avatar, name, last message on one line, time
 *               "14:05" / "เมื่อวาน" / "24 พ.ย.", unread badge), newest first. A peer who is no longer in the staff list
 *               shows "(ลบแล้ว)"; the room of such a peer is read-only.
 *  'chat-room'  nav none, parent 'chat', chrome {bottomNav: false}, header title = the peer (core.setScreenTitle in
 *               show()). Bubbles (mine right in the brand tint, theirs left in white; escaped text, pre-wrap, wrap
 *               anywhere, no links), date separators "วันนี้" / "เมื่อวาน" / "อ. 24 พ.ย.", a time per bubble, "อ่านแล้ว"
 *               under my newest message the peer has read, "โหลดข้อความก่อนหน้า" at the top (getChat history form),
 *               a sticky composer at the bottom edge (safe area): a growing <textarea> (≤ 5 lines, maxlength 1000, counter from 900,
 *               Enter = new line, Ctrl/⌘+Enter sends), the 44 px send button; the draft of each peer lives in
 *               core.store.draft('chat:<peer>') (removed by the core at logout).
 *
 * Data: core.domain('chat', {persist: false}) → {lastId, byPeer: {peer: Message[] ascending}, reads: {peer: {mine,
 * theirs, theirsAt}}, unread: {peer: n}, version, trunc, more: {peer: bool}}. `lastId` and `version` come only from
 * getChat's main form (a sent message never moves them: the next poll still asks for everything after lastId).
 * `unread` and `reads` are replaced by every answer (the server sends complete maps); messages are merged by id;
 * `reset: true` replaces everything. A copy (≤ 200 newest per peer) is kept in core.media store 'chat' under
 * "<me>|conv" and restored for the same user before the first request of a session (the core wipes the store at
 * logout). Restore and requests start only once the server announced 'chat' (no IndexedDB use on older servers).
 *
 * Sync: getChat{after: lastId, knownVersion} — after the domain's remote version changed (heartbeat, onStale), when a
 * screen is shown, and by the polls of R3-SPEC §0.12: the list every 15 s; the room every 5 s, backing off to 10 / 20 /
 * 30 s after 1 / 3 / 10 quiet minutes (reset by a new message from someone else, an own send or typing; a tick that
 * comes too early is skipped). core.poll runs a tick only while the page is visible and someone is logged in; one
 * request at a time (a sync asked for while one runs shares it, a remote change seen meanwhile runs one more).
 *
 * Send: an optimistic bubble "กำลังส่ง…" keyed by cid = Api.newId(); the answer replaces it with the server's message;
 * a failure shows "ส่งไม่สำเร็จ — แตะเพื่อส่งใหม่" and a tap resends with the SAME cid (the server answers a known cid
 * with the stored message, so a retry never makes a second row). A refusal (e.g. RATE_LIMITED) also shows the server's
 * message above the composer. Read: while the room is visible and the peer's newest message is newer than my
 * watermark → markChatRead{peer, upTo} after 1 s (optimistic unread = 0); never while the page is hidden.
 * R3 FIX-CL: (L-2) a getChat row of mine that carries a cid (server K-8 returns it on the caller's own rows) drops the
 * pending / failed bubble of that cid — a lost sendChat answer no longer leaves a "failed" copy beside the delivered one;
 * without cids nothing changes. (L-3) a markChatRead that failed is kept (readQ) and sent again on the next room / list
 * tick, on 'visible' and on 'online'; the media copy only ever stores the confirmed watermark and unread count. FIX-CL2
 * Q-3: only a transient failure / BUSY / RATE_LIMITED is retried; any other refusal drops the receipt (never sent again for
 * that message) and puts the confirmed watermark and unread count back on the screen. (L-4) the
 * per-peer draft keeps a message's text until the server confirmed it (while the composer is empty it holds the newest
 * unconfirmed text), so a failed message is back in the composer after a reload. (L-13) the empty room's hint sits in
 * the middle of the room; the composer's textarea has no padding of its own (the field box around it has), so 5 lines
 * show whole; the header badge reads "ข้อความที่ยังไม่อ่าน N ข้อความ" (registry badgeLabel).
 *
 * Privacy: chat text only ever lives in this file's memory, the DOM of these screens, the 'chat' media store and the
 * per-peer draft; never in logs, toasts, attributes or other storage. reset() (logout, a new login) drops all of it.
 *
 * DOM hooks for tests: #tab-chat [data-chat-list] / [data-chat-peer="<name>"] rows ([data-chat-last], [data-chat-time],
 * [data-chat-unread]) / [data-chat-act="new|retry-load"] / [data-chat-privacy]; #chatNewSheet ([data-chat-search],
 * [data-chat-to="<name>"]); #tab-chat-room [data-chat-msgs] with [data-chat-msg="<id>"][data-mine], [data-chat-sep],
 * [data-chat-read], [data-chat-pending="<cid>"][data-state="sending|failed"], [data-chat-act="older|send"],
 * [data-chat-composer], #chatInput, [data-chat-count], [data-chat-note], [data-chat-readonly].
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !App.core) return;   // app.js did not start (boot guard)
  const C = App.core;

  const LIST_ID = 'chat';
  const ROOM_ID = 'chat-room';
  const MEDIA_STORE = 'chat';
  const COPY_PER_PEER = 200;            // the media copy keeps the newest 200 messages of each conversation
  const TEXT_MAX = 1000;                // server: 1–1,000 characters
  const COUNT_FROM = 900;               // the counter appears from this many characters
  const LIST_POLL_MS = 15000;
  const ROOM_POLL_MS = 5000;
  /** R3-SPEC §0.12: after this long without activity the room asks only every `gap` ms (longest quiet first). */
  const BACKOFF = [{ quiet: 10 * 60000, gap: 30000 }, { quiet: 3 * 60000, gap: 20000 }, { quiet: 60000, gap: 10000 }];
  const TICK_SLACK_MS = 1000;           // a tick this much earlier than the gap still counts (timer drift)
  const READ_DELAY_MS = 1000;           // markChatRead debounce
  const RESTORE_WAIT_MS = 1500;         // the first request waits at most this long for the media copy
  const HISTORY_LIMIT = 50;
  const NEAR_BOTTOM_PX = 120;           // new messages scroll the room down only when the reader is this close to the end
  const MAX_LINES = 5;
  const SHEET_ID = 'chatNewSheet';
  const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;   // the server refuses these (\n and \t stay)

  const MSG = {
    title: 'แชท',
    privacy: 'ข้อความเก็บใน Google Sheet ของหน่วย เจ้าของชีตอ่านได้ — ห้ามส่งข้อมูลผู้ป่วย',
    newChat: 'แชทใหม่',
    empty: 'ยังไม่มีข้อความ',
    emptyHint: 'แตะ "แชทใหม่" เพื่อเริ่มคุยกับเพื่อนร่วมทีมแบบ 1 ต่อ 1',
    loadFailed: 'โหลดข้อความไม่สำเร็จ',
    loadFailedHint: 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    retry: 'ลองใหม่',
    deleted: ' (ลบแล้ว)',
    readOnly: 'บุคคลนี้ถูกลบออกจากรายชื่อแล้ว — ส่งข้อความต่อไม่ได้',
    sending: 'กำลังส่ง…',
    failed: 'ส่งไม่สำเร็จ — แตะเพื่อส่งใหม่',
    read: 'อ่านแล้ว',
    older: 'โหลดข้อความก่อนหน้า',
    olderBusy: 'กำลังโหลด…',
    olderFailed: 'โหลดไม่สำเร็จ — แตะเพื่อลองอีกครั้ง',
    you: 'คุณ: ',
    today: 'วันนี้',
    yesterday: 'เมื่อวาน',
    placeholder: 'พิมพ์ข้อความ…',
    inputLabel: 'ข้อความถึง ',
    send: 'ส่ง',
    roomEmpty: 'ยังไม่มีข้อความ — พิมพ์ข้อความแรกด้านล่าง',
    search: 'ค้นหาชื่อ',
    pick: 'เลือกคนที่ต้องการคุยด้วย',
    noMatch: 'ไม่พบชื่อที่ค้นหา',
    noStaff: 'ยังไม่มีรายชื่อบุคลากรคนอื่น',
    close: 'ปิด',
    log: 'ข้อความในห้องแชท',
    unreadLabel: 'ข้อความใหม่',
    unreadLabelHeader: n => 'ข้อความที่ยังไม่อ่าน ' + n + ' ข้อความ'
  };

  /* ------------------------------------------------------------------ class literals (complete, for Tailwind) */
  const CLS = {
    room: 'flex flex-col gap-3',
    msgs: 'flex-1 flex flex-col justify-end gap-1.5',
    rowMine: 'flex justify-end',
    rowTheirs: 'flex justify-start',
    bubbleMine: 'max-w-[80%] min-w-0 rounded-3xl rounded-br-lg bg-brand-100 border-2 border-brand-100 px-3.5 py-2 text-ink-900',
    bubbleTheirs: 'max-w-[80%] min-w-0 rounded-3xl rounded-bl-lg bg-white border-2 border-ink-100 px-3.5 py-2 text-ink-900',
    bubbleSending: 'max-w-[80%] min-w-0 rounded-3xl rounded-br-lg bg-brand-50 border-2 border-dashed border-brand-200 px-3.5 py-2 text-ink-900',
    bubbleFailed: 'max-w-[80%] min-w-0 rounded-3xl rounded-br-lg bg-coral-50 border-2 border-coral-300 px-3.5 py-2 text-left text-ink-900 active:bg-coral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral-400',
    text: 'whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[0.9375rem] leading-6',
    timeMine: 'mt-0.5 text-xs leading-4 text-right text-brand-800 tabular-nums',
    timeTheirs: 'mt-0.5 text-xs leading-4 text-slate-500 tabular-nums',
    status: 'mt-0.5 text-xs font-medium leading-4 text-right text-slate-500',
    statusFailed: 'mt-0.5 flex items-center justify-end gap-1 text-xs font-medium leading-4 text-coral-700',
    readLine: 'pr-2 text-right text-xs font-medium leading-4 text-slate-500',
    // R3 FIX-CL L-13: the empty room's hint in the middle of the room body (not one grey line by the composer)
    roomEmpty: 'my-auto flex flex-col items-center gap-3 px-6 py-10 text-center',
    roomEmptyText: 'text-sm leading-6 text-slate-500',
    sep: 'flex justify-center py-1',
    olderBox: 'flex justify-center',
    // sticky on the screen's bottom edge, full bleed over #appMain's side padding, above the safe area
    composer: 'sticky bottom-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-2 bg-white/95 backdrop-blur border-t border-brand-100 uk-safe-b',
    form: 'flex items-end gap-2',
    // R3 FIX-CL L-13: the bordered box carries the padding, the textarea inside has none — its scroll viewport is exactly
    // N lines, so at 5 lines no half line shows above or below (padding inside a scroller always cuts one line)
    field: 'flex-1 min-w-0 px-3.5 py-2 rounded-2xl border-2 border-ink-200 bg-white cursor-text focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-200',
    input: 'block w-full h-6 p-0 border-0 bg-transparent text-sm leading-6 text-ink-900 placeholder-slate-400 resize-none overflow-y-hidden focus:outline-none',
    sendBtn: 'inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full bg-brand-600 text-white active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:bg-ink-100 disabled:text-ink-400',
    under: 'flex items-start gap-2 min-h-[8px] pb-2',
    note: 'flex-1 min-w-0 text-[0.8125rem] font-medium leading-5 text-coral-700 break-words',
    readonly: 'mb-2 flex items-start gap-2.5 p-3 rounded-2xl bg-cream-50 border-2 border-cream-100 text-sm leading-6 text-slate-700',
    rowName: 'flex-1 min-w-0 break-words [overflow-wrap:anywhere] text-sm leading-6 text-ink-900',
    rowNameUnread: 'flex-1 min-w-0 break-words [overflow-wrap:anywhere] text-sm font-semibold leading-6 text-ink-900',
    rowLast: 'flex-1 min-w-0 truncate text-[0.8125rem] leading-5 text-slate-500',
    rowLastUnread: 'flex-1 min-w-0 truncate text-[0.8125rem] font-medium leading-5 text-ink-800',
    rowTime: 'shrink-0 text-xs font-medium leading-4 text-slate-500 tabular-nums',
    gone: 'font-normal text-slate-500',
    searchWrap: 'relative',
    searchIcon: 'absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-400 pointer-events-none',
    srOnly: 'sr-only'
  };

  /* ------------------------------------------------------------------ state */
  let dom = null;               // core.domain('chat')
  let listRoot = null;          // <section id="tab-chat">
  let roomRoot = null;          // <section id="tab-chat-room">
  const ref = {};               // elements of the built skeletons
  let listBuilt = false;
  let roomBuilt = false;
  let restoring = null;         // promise of this session's media restore (null = not started)
  let syncing = null;           // promise of the getChat in flight
  let syncSeq = 0;              // bumped by reset(): a late sync of an old session leaves `syncing` alone
  let again = false;            // run one more sync when the current one ends
  let loadedOnce = false;       // a getChat main form answered in this session
  let loadError = false;        // the first getChat of this session failed (and none succeeded since)
  let pending = [];             // own messages not confirmed yet: [{cid, peer, text, state: 'sending'|'failed', busy}]
  let pendSeq = 0;
  let copySaving = false;       // a media copy write is in flight
  let copyDirty = false;        // data changed meanwhile: write again afterwards
  let readTimer = null;
  /**
   * R3 FIX-CL L-3: read receipts the server has not confirmed yet: peer → {upTo, mine, unread, busy, failed} (mine / unread
   * = the last CONFIRMED values). The screen shows the optimistic state, the media copy keeps the confirmed one; a failed
   * markChatRead is sent again on the next room / list tick, when the page becomes visible and when the device is online.
   */
  let readQ = Object.create(null);
  /**
   * R3 FIX-CL2 Q-3: receipts the server refused for good (any error but a transient one / BUSY / RATE_LIMITED): peer → the
   * newest refused upTo. A refused receipt is never queued or sent again; a newer message of that peer tries once more.
   */
  let readRefused = Object.create(null);
  let answers = 0;              // getChat answers applied (they replace reads / unread with the server's complete maps)
  let sheetEl = null;
  let sheetQuery = '';
  const polls = { list: null, room: null };
  /** The open room: peer, backoff clock, scroll intents, history request state, the composer's message. */
  const room = { peer: '', activeAt: 0, lastPollAt: 0, needBottom: false, stickBottom: false, anchor: -1, older: false,
    olderFailed: false, error: '', pinned: true };
  let resizeObs = null;         // keeps a reader who is at the end of the room there when the layout changes

  /* ------------------------------------------------------------------ small helpers */
  function k() { return C.Kit.cls; }
  function esc(s) { return C.esc(s); }
  /** R3 FIX-CL L-11: escaped text whose fixed phrases never break inside ("ชีต" is not in the Thai line-break dictionary). */
  function escNowrap(text, phrases) {
    let out = esc(text);
    phrases.forEach(p => { out = out.split(esc(p)).join('<span class="whitespace-nowrap">' + esc(p) + '</span>'); });
    return out;
  }
  function icon(name, cls) { return C.Kit.icon(name, cls || 'w-5 h-5'); }
  function own(map, key) { return !!map && Object.prototype.hasOwnProperty.call(map, key); }
  function get(map, key) { return own(map, key) ? map[key] : undefined; }
  function nmap(src) { return Object.assign(Object.create(null), src || {}); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function posInt(v) { const n = Number(v); return typeof v === 'number' && isFinite(n) && n >= 1 && Math.floor(n) === n ? n : 0; }
  function me() { return C.myName() || (C.state.session ? C.state.session.name : '') || ''; }
  function copyKey(name) { return name + '|conv'; }
  function draftKey(peer) { return 'chat:' + peer; }
  function canChat() {
    const u = C.state.user;
    return !!C.state.session && C.serverHas('chat') && !(u && u.mustChangePassword);
  }
  function emptyData() {
    return { lastId: 0, byPeer: nmap(), reads: nmap(), unread: nmap(), version: '', trunc: false, more: nmap() };
  }
  /** A shallow copy whose maps can be changed without touching `d` (messages are never mutated). */
  function copyData(d) {
    const s = d || {};
    return { lastId: posInt(s.lastId), byPeer: nmap(s.byPeer), reads: nmap(s.reads), unread: nmap(s.unread),
      version: str(s.version), trunc: !!s.trunc, more: nmap(s.more) };
  }
  function data() { return (dom && dom.data) || emptyData(); }

  /** A message of the server (or the media copy) → a clean copy, or null when it is malformed or not mine. */
  function cleanMsg(m, name) {
    if (!m || typeof m !== 'object' || !name) return null;
    const id = posInt(m.id);
    const from = str(m.from), to = str(m.to);
    if (!id || !from || !to || from === to || (from !== name && to !== name)) return null;
    return { id, from, to, text: str(m.text), sentAt: str(m.sentAt) };
  }
  function peerOf(m, name) { return m.from === name ? m.to : m.from; }

  /** Adds messages to out.byPeer (copy on write per peer), by id, ascending. → number of messages added. */
  function addMessages(out, msgs, name) {
    const seen = Object.create(null);
    let added = 0;
    msgs.forEach(m => {
      const peer = peerOf(m, name);
      if (!seen[peer]) {
        const list = (get(out.byPeer, peer) || []).slice();
        const ids = new Set();
        list.forEach(x => ids.add(x.id));
        seen[peer] = { list, ids };
        out.byPeer[peer] = list;
      }
      const s = seen[peer];
      if (s.ids.has(m.id)) return;
      s.ids.add(m.id);
      s.list.push(m);
      added++;
    });
    Object.keys(seen).forEach(p => seen[p].list.sort((a, b) => a.id - b.id));
    return added;
  }

  function readsMap(list) {
    const out = nmap();
    (Array.isArray(list) ? list : []).forEach(r => {
      if (!r || typeof r !== 'object' || !str(r.peer)) return;
      out[r.peer] = { mine: Math.max(0, posInt(r.mine)), theirs: Math.max(0, posInt(r.theirs)), theirsAt: str(r.theirsAt) };
    });
    return out;
  }
  function unreadMap(obj) {
    const out = nmap();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).forEach(p => { const n = posInt(obj[p]); if (p && n) out[p] = n; });
    return out;
  }
  function totalUnread() {
    const u = data().unread || {};
    let n = 0;
    Object.keys(u).forEach(p => { n += posInt(u[p]); });
    return n;
  }

  /** getChat main answer → the new data. `after` = the `after` of that request. Sets lastIncoming. */
  let lastIncoming = 0;
  function merge(d, res, after) {
    const name = me();
    const out = res.reset ? emptyData() : copyData(d);
    const msgs = (Array.isArray(res.messages) ? res.messages : []).map(m => cleanMsg(m, name)).filter(Boolean);
    // a message from someone else that this device did not have yet (for the room's backoff)
    lastIncoming = 0;
    msgs.forEach(m => {
      if (m.from === name) return;
      const list = get(d.byPeer, m.from) || [];
      if (res.reset || !list.some(x => x.id === m.id)) lastIncoming++;
    });
    addMessages(out, msgs, name);
    const last = Math.max(0, posInt(res.lastId));
    out.lastId = res.reset ? last : Math.max(out.lastId, last);
    out.reads = readsMap(res.reads);
    out.unread = unreadMap(res.unread);
    out.version = str(res.chatVersion);
    if (res.reset || !after) out.trunc = !!res.truncated;
    else if (res.truncated) out.trunc = true;
    return out;
  }

  /** The media copy: ≤ 200 newest messages per peer (a trimmed conversation is marked "older messages exist"). */
  function buildCopy(d, name) {
    const byPeer = {};
    const more = {};
    Object.keys(d.more || {}).forEach(p => { more[p] = !!d.more[p]; });
    Object.keys(d.byPeer || {}).forEach(p => {
      const list = d.byPeer[p] || [];
      byPeer[p] = list.length > COPY_PER_PEER ? list.slice(list.length - COPY_PER_PEER) : list.slice();
      if (list.length > COPY_PER_PEER) more[p] = true;
    });
    // R3 FIX-CL L-3: a read receipt the server has not confirmed is stored with its confirmed values
    const reads = nmapPlain(d.reads), unread = nmapPlain(d.unread);
    Object.keys(readQ).forEach(p => {
      const q = readQ[p];
      if (reads[p]) reads[p] = Object.assign({}, reads[p], { mine: Math.min(posInt(reads[p].mine), q.mine) });
      if (q.unread) unread[p] = q.unread;
    });
    return { v: 1, user: name, version: str(d.version), lastId: posInt(d.lastId), byPeer, reads, unread, trunc: !!d.trunc, more };
  }
  function nmapPlain(m) { const o = {}; Object.keys(m || {}).forEach(p => { o[p] = m[p]; }); return o; }

  /** A stored copy → data, or null when it is not this user's or malformed. */
  function parseCopy(copy, name) {
    if (!copy || typeof copy !== 'object' || copy.user !== name || copy.v !== 1) return null;
    const out = emptyData();
    const byPeer = copy.byPeer && typeof copy.byPeer === 'object' ? copy.byPeer : {};
    const msgs = [];
    Object.keys(byPeer).forEach(p => {
      (Array.isArray(byPeer[p]) ? byPeer[p] : []).forEach(m => {
        const c = cleanMsg(m, name);
        if (c && peerOf(c, name) === p) msgs.push(c);
      });
    });
    addMessages(out, msgs, name);
    out.lastId = posInt(copy.lastId);
    out.version = str(copy.version);
    const reads = copy.reads && typeof copy.reads === 'object' ? copy.reads : {};
    out.reads = readsMap(Object.keys(reads).map(p => Object.assign({}, reads[p], { peer: p })));
    out.unread = unreadMap(copy.unread);
    out.trunc = !!copy.trunc;
    const more = copy.more && typeof copy.more === 'object' ? copy.more : {};
    Object.keys(more).forEach(p => { out.more[p] = !!more[p]; });
    return out;
  }

  /* ------------------------------------------------------------------ dates */
  function toDate(iso) { const d = new Date(iso); return isNaN(d.getTime()) ? null : d; }
  function hhmm(d) { return d ? C.U.pad2(d.getHours()) + ':' + C.U.pad2(d.getMinutes()) : ''; }
  function dayOf(d) { return d ? C.U.ymd(d) : ''; }
  /** List rows: "14:05" today, "เมื่อวาน", "24 พ.ย." this year, else "24 พ.ย. 2568". */
  function listTime(iso) {
    const d = toDate(iso);
    if (!d) return '';
    const day = dayOf(d), today = C.U.todayStr();
    if (day === today) return hhmm(d);
    if (day === C.U.addDays(today, -1)) return MSG.yesterday;
    return C.U.thaiDateShort(day, { year: day.slice(0, 4) !== today.slice(0, 4) ? undefined : false });
  }
  /** Separators in the room: "วันนี้", "เมื่อวาน", "อ. 24 พ.ย." (with the year when it is another year). */
  function sepLabel(day) {
    const today = C.U.todayStr();
    if (day === today) return MSG.today;
    if (day === C.U.addDays(today, -1)) return MSG.yesterday;
    return C.U.thaiDateShort(day, { weekday: true, year: day.slice(0, 4) !== today.slice(0, 4) ? undefined : false });
  }

  /* ------------------------------------------------------------------ people */
  function staffNames() { return C.staff().map(s => s.name); }
  /** A peer who is not in the active staff list (once that list is known). */
  function isDeleted(peer) {
    const names = staffNames();
    return names.length > 0 && names.indexOf(peer) < 0;
  }

  /* ------------------------------------------------------------------ sync */
  /**
   * Restores this user's media copy once per session (before the first request). Never rejects. The first request waits
   * for it at most RESTORE_WAIT_MS: IndexedDB can be slow or blocked (another tab holding an old connection); a copy that
   * arrives after that is ignored (it could only be older than what the server answered).
   */
  function ensureRestored() {
    if (restoring) return restoring;
    const name = me();
    if (!name || !dom) return Promise.resolve();
    const alive = C.alive();
    const ticket = dom.begin();
    restoring = new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); return true; } return false; };
      const timer = setTimeout(finish, RESTORE_WAIT_MS);
      C.media.get(MEDIA_STORE, copyKey(name)).then(copy => {
        if (!finish() || !alive() || me() !== name) return;
        const d = parseCopy(copy, name);
        if (d) dom.commit(ticket, d.version, () => d);
      }, finish);   // no copy / storage unavailable: start empty
    });
    return restoring;
  }

  /**
   * One getChat{after: lastId, knownVersion} at a time. reason 'stale' (the heartbeat saw another version): skipped when
   * the restored copy already has that version; asked while a request runs → one more run afterwards. Never rejects.
   */
  function sync(reason) {
    if (!dom || !canChat()) return Promise.resolve(false);
    if (syncing) {
      if (reason === 'stale') again = true;
      return syncing;
    }
    const seq = syncSeq;
    const alive = C.alive();
    const run = async () => {
      await ensureRestored();
      if (!alive() || !canChat()) return false;
      if (reason === 'stale' && (!dom.remote || dom.remote === dom.version)) return false;
      const after = posInt(data().lastId);
      const ticket = dom.begin();
      let res;
      try {
        res = await C.call('getChat', { after, knownVersion: dom.version || '' });
      } catch (e) {
        if (!alive()) return false;
        if (!loadedOnce) loadError = true;
        repaint();
        return false;
      }
      if (!alive()) return false;
      const first = !loadedOnce;
      loadedOnce = true;
      loadError = false;
      if (!res || typeof res !== 'object' || res.unchanged === true) {
        if (first) repaint();
        return false;
      }
      // R3 FIX-CL L-2: my own rows carry their cid (server K-8): a pending / failed bubble of that cid is the same message
      const ok = dom.commit(ticket, str(res.chatVersion), d => { const out = merge(d, res, after); dropConfirmed(res.messages); return out; });
      if (!ok) {
        again = true;   // an own write came in between: ask again (the answer was not applied)
        return false;
      }
      answers++;
      if (lastIncoming) noteActivity();
      settleReads();
      saveCopy();
      return true;
    };
    const p = C.track(run()).catch(e => {
      console.error('[chat] sync failed:', e && e.name);
      return false;
    }).then(v => {
      if (seq !== syncSeq) return v;
      syncing = null;
      if (again) {
        again = false;
        if (alive()) sync('again');
      }
      return v;
    });
    syncing = p;
    return p;
  }

  /** Writes the media copy (coalesced: one write at a time, the newest data afterwards). */
  function saveCopy() {
    const name = me();
    if (!name || !C.state.session || !dom) return;
    if (copySaving) { copyDirty = true; return; }
    copySaving = true;
    const alive = C.alive();
    const seq = syncSeq;
    C.media.put(MEDIA_STORE, copyKey(name), buildCopy(data(), name)).catch(() => undefined).then(() => {
      if (seq !== syncSeq) return;
      copySaving = false;
      if (copyDirty && alive()) { copyDirty = false; saveCopy(); }
    });
  }

  /* ------------------------------------------------------------------ polls */
  function noteActivity() { room.activeAt = Date.now(); }
  function roomGap(now) {
    const quiet = now - room.activeAt;
    for (let i = 0; i < BACKOFF.length; i++) if (quiet >= BACKOFF[i].quiet) return BACKOFF[i].gap;
    return ROOM_POLL_MS;
  }
  function roomTick() {
    if (C.current() !== ROOM_ID || !room.peer) return undefined;
    const now = Date.now();
    if (now - room.lastPollAt < roomGap(now) - TICK_SLACK_MS) return undefined;   // backed off: skip this tick
    room.lastPollAt = now;
    retryReads();
    return sync('poll');
  }
  function stopPoll(which) {
    if (polls[which]) { polls[which](); polls[which] = null; }
  }
  function stopPolls() { stopPoll('list'); stopPoll('room'); }

  /* ------------------------------------------------------------------ read receipts */
  function roomVisible() {
    return document.visibilityState === 'visible' && C.current() === ROOM_ID && !!room.peer && !!C.state.session;
  }
  function newestFrom(peer) {
    const list = get(data().byPeer, peer) || [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].from === peer) return list[i];
    return null;
  }
  function myWatermark(peer) { const r = get(data().reads, peer); return r ? posInt(r.mine) : 0; }
  /** A read receipt for messages up to `id` is already on its way (or waits for a retry). */
  function readQueued(peer, id) {
    const q = readQ[peer];
    return (!!q && q.upTo >= id) || posInt(readRefused[peer]) >= id;
  }
  function maybeMarkRead() {
    if (readTimer || !roomVisible() || !canChat()) return;
    const peer = room.peer;
    const m = newestFrom(peer);
    if (!m || m.id <= myWatermark(peer) || readQueued(peer, m.id)) return;
    readTimer = setTimeout(() => { readTimer = null; markRead(peer); }, READ_DELAY_MS);
  }
  function markRead(peer) {
    if (!roomVisible() || room.peer !== peer || !canChat()) return;
    const m = newestFrom(peer);
    if (!m || m.id <= myWatermark(peer) || readQueued(peer, m.id)) return;
    const upTo = m.id;
    const old = readQ[peer];   // an older receipt still unconfirmed: its baseline is still the confirmed one
    const r0 = get(data().reads, peer);
    readQ[peer] = { upTo, mine: old ? old.mine : (r0 ? posInt(r0.mine) : 0), unread: old ? old.unread : posInt(get(data().unread, peer)),
      busy: false, failed: false, at: answers };
    dom.touch(d => {
      const out = copyData(d);
      delete out.unread[peer];
      const r = get(out.reads, peer) || { mine: 0, theirs: 0, theirsAt: '' };
      out.reads[peer] = { mine: Math.max(posInt(r.mine), upTo), theirs: posInt(r.theirs), theirsAt: str(r.theirsAt) };
      return out;
    });
    sendRead(peer);   // the media copy is written only once the server confirmed (never an unconfirmed watermark)
  }
  function sendRead(peer) {
    const q = readQ[peer];
    if (!q || q.busy || !canChat()) return;
    q.busy = true;
    const upTo = q.upTo;
    const alive = C.alive();
    const seq = syncSeq;
    C.track(C.call('markChatRead', { peer, upTo })).then(res => {
      if (!alive() || seq !== syncSeq) return;
      if (readQ[peer] === q) delete readQ[peer];
      else if (readQ[peer]) readQ[peer].mine = Math.max(readQ[peer].mine, upTo);   // a newer receipt waits: this one counts
      const id = Math.max(res ? posInt(res.lastReadId) : 0, upTo);
      const newest = newestFrom(peer);
      if (id > myWatermark(peer) || (own(data().unread, peer) && newest && newest.id <= id)) {
        dom.touch(d => {
          const out = copyData(d);
          const r = get(out.reads, peer) || { mine: 0, theirs: 0, theirsAt: '' };
          out.reads[peer] = { mine: Math.max(posInt(r.mine), id), theirs: posInt(r.theirs), theirsAt: str(r.theirsAt) };
          if (newest && newest.id <= id) delete out.unread[peer];   // confirmed: nothing of this peer is unread any more
          return out;
        });
      }
      saveCopy();
      if (readQ[peer]) sendRead(peer);
    }, e => {
      if (!alive() || seq !== syncSeq) return;
      q.busy = false;
      if (readRetryable(e)) { q.failed = true; return; }   // kept: retryReads() sends it again
      refuseRead(peer, q);
    });
  }
  /** R3 FIX-CL2 Q-3: only a transient failure (network, BUSY, …) or RATE_LIMITED is worth sending the receipt again. */
  function readRetryable(e) { return !!e && (C.Api.isTransient(e) || e.code === 'RATE_LIMITED'); }
  /**
   * R3 FIX-CL2 Q-3: the server refused a receipt for good (e.g. VALIDATION: the message is outside its chat tail): the receipt
   * is dropped and the optimistic state goes back to the confirmed one (q.mine / q.unread) — unless a getChat answer was
   * applied since, which already replaced reads / unread with the server's own values.
   */
  function refuseRead(peer, q) {
    readRefused[peer] = Math.max(posInt(readRefused[peer]), q.upTo);
    if (readQ[peer] !== q) return;   // a newer receipt replaced it (sent on its own)
    delete readQ[peer];
    if (q.at === answers) {
      dom.touch(d => {
        const out = copyData(d);
        const r = get(out.reads, peer);
        if (r && posInt(r.mine) > q.mine && posInt(r.mine) <= q.upTo) out.reads[peer] = { mine: q.mine, theirs: posInt(r.theirs), theirsAt: str(r.theirsAt) };
        if (q.unread && !own(out.unread, peer)) out.unread[peer] = q.unread;
        return out;
      });
    }
    saveCopy();
  }
  /** R3 FIX-CL L-3: failed read receipts again (room / list tick, visible, online). */
  function retryReads() {
    if (document.visibilityState !== 'visible' || !canChat()) return;
    Object.keys(readQ).forEach(p => { if (readQ[p].failed && !readQ[p].busy) sendRead(p); });
  }
  /** An answer whose watermark already covers a queued receipt (e.g. another device read it) ends that receipt. */
  function settleReads() {
    Object.keys(readQ).forEach(p => {
      const r = get(data().reads, p);
      if (r && posInt(r.mine) >= readQ[p].upTo && !readQ[p].busy) delete readQ[p];
    });
  }

  /* ------------------------------------------------------------------ send */
  /** The text as it is sent: CRLF → LF, no control characters, trimmed. */
  function cleanText(v) { return String(v || '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim(); }
  /**
   * R3 FIX-CL L-4: the per-peer draft. While the composer is empty it keeps the newest message of that peer the server has
   * not confirmed yet (sending or failed), so the text survives a reload (iOS closes a PWA quickly in the background).
   */
  function saveDraft(peer, value) {
    if (cleanText(value)) { C.store.draft.set(draftKey(peer), value); return; }
    const mine = pending.filter(it => it.peer === peer).sort((a, b) => b.seq - a.seq)[0];
    if (mine) C.store.draft.set(draftKey(peer), mine.text);
    else C.store.draft.remove(draftKey(peer));
  }
  /** A message of `peer` was confirmed: its text leaves the draft (a newer text typed meanwhile stays). */
  function dropDraftIf(peer, text) {
    const d = C.store.draft.get(draftKey(peer));
    if (typeof d === 'string' && cleanText(d) === text) saveDraft(peer, '');
  }
  /**
   * R3 FIX-CL L-2: server rows of mine that carry a cid (server K-8 returns it on the caller's own rows only) end the
   * pending / failed bubble of that cid — the server copy replaces it (an answer lost on the way left the bubble behind).
   * Without cids (an older server) nothing changes. → true when a bubble was dropped.
   */
  function dropConfirmed(raw) {
    const name = me();
    const cids = new Set();
    (Array.isArray(raw) ? raw : []).forEach(m => {
      if (m && typeof m.cid === 'string' && m.cid && cleanMsg(m, name) && m.from === name) cids.add(m.cid);
    });
    if (!cids.size || !pending.some(it => cids.has(it.cid))) return false;
    const gone = pending.filter(it => cids.has(it.cid));
    pending = pending.filter(it => !cids.has(it.cid));
    gone.forEach(it => { dropDraftIf(it.peer, it.text); if (it.peer === room.peer) room.error = ''; });
    return true;
  }
  function sendFromComposer() {
    const ta = ref.input;
    const peer = room.peer;
    if (!ta || !peer || isDeleted(peer) || !canChat()) return;
    const text = cleanText(ta.value);
    if (!text || text.length > TEXT_MAX) return;
    ta.value = '';   // R3 FIX-CL L-4: the draft keeps the text until the server confirmed the message (dropDraftIf)
    grow();
    paintComposer();
    const item = { cid: C.Api.newId(), peer, text, state: 'sending', busy: false, seq: ++pendSeq };
    pending.push(item);
    noteActivity();
    room.stickBottom = true;
    post(item);
    try { ta.focus(); } catch (e) { /* ignore */ }
  }

  function post(item) {
    if (item.busy) return;
    item.busy = true;
    item.state = 'sending';
    if (item.peer === room.peer) room.error = '';
    const alive = C.alive();
    repaint();
    C.track(C.call('sendChat', { to: item.peer, text: item.text, cid: item.cid })).then(res => {
      if (!alive()) return;
      item.busy = false;
      pending = pending.filter(x => x !== item);
      dropDraftIf(item.peer, item.text);
      const m = cleanMsg(res && res.message, me());
      noteActivity();
      if (item.peer === room.peer) room.stickBottom = true;
      if (m) {
        dom.touch(d => {
          const out = copyData(d);
          addMessages(out, [m], me());
          return out;
        });
        saveCopy();
      } else {
        sync('sent');
      }
      repaint();
    }, e => {
      if (!alive()) return;
      item.busy = false;
      item.state = 'failed';
      const refusal = e && e.name === 'ApiError' && !C.Api.isTransient(e) &&
        e.code !== 'AUTH_REQUIRED' && e.code !== 'PASSWORD_CHANGE_REQUIRED';
      if (item.peer === room.peer) room.error = refusal ? String(e.message || '') : '';
      repaint();
    });
  }

  /* ------------------------------------------------------------------ history */
  function olderAvailable(peer, msgs) {
    const d = data();
    if (!posInt(d.lastId) && !msgs.length) return false;
    if (msgs.length && msgs[0].id <= 1) return false;   // the very first message is already here
    const m = get(d.more, peer);
    return m === undefined ? !!d.trunc : !!m;
  }
  function loadOlder() {
    const peer = room.peer;
    if (!peer || room.older || !canChat()) return;
    const msgs = get(data().byPeer, peer) || [];
    const before = msgs.length ? msgs[0].id : posInt(data().lastId) + 1;
    if (before < 2) return;
    room.older = true;
    room.olderFailed = false;
    paintRoom();
    const alive = C.alive();
    C.track(C.call('getChat', { peer, before, limit: HISTORY_LIMIT })).then(res => {
      if (!alive()) return;
      room.older = false;
      const name = me();
      const list = (res && Array.isArray(res.messages) ? res.messages : []).map(m => cleanMsg(m, name))
        .filter(m => m && peerOf(m, name) === peer && m.id < before);
      const more = !!(res && res.more) && list.length > 0;
      if (peer === room.peer && C.current() === ROOM_ID) {
        const s = scroller();
        room.anchor = s.scrollHeight - s.scrollTop;   // keep the reader's place when older bubbles appear above
      }
      dom.touch(d => {
        const out = copyData(d);
        addMessages(out, list, name);
        out.more[peer] = more;
        dropConfirmed(res && res.messages);
        return out;
      });
      saveCopy();
      repaint();
    }, () => {
      if (!alive()) return;
      room.older = false;
      room.olderFailed = true;
      repaint();
    });
  }

  /* ------------------------------------------------------------------ scrolling */
  function scroller() { return document.scrollingElement || document.documentElement; }
  function nearBottom() {
    const s = scroller();
    return window.innerHeight + s.scrollTop >= s.scrollHeight - NEAR_BOTTOM_PX;
  }
  function toBottom() {
    try { window.scrollTo(0, scroller().scrollHeight); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ list screen */
  function buildList() {
    if (listBuilt || !listRoot) return;
    const c = k();
    listRoot.innerHTML =
      '<p class="' + c.note + '" data-chat-privacy>' + icon('lock', 'w-5 h-5 shrink-0 mt-0.5 text-ink-500') +
        '<span class="min-w-0">' + escNowrap(MSG.privacy, ['Google Sheet ของหน่วย', 'เจ้าของชีต', 'ข้อมูลผู้ป่วย']) + '</span></p>' +
      '<button type="button" class="' + c.btn + ' ' + c.btnPrimary + ' ' + c.btnLg + '" data-chat-act="new">' +
        icon('message', 'w-5 h-5') + esc(MSG.newChat) + '</button>' +
      '<div data-chat-list></div>';
    ref.list = listRoot.querySelector('[data-chat-list]');
    listBuilt = true;
  }

  /** Conversations (peers with messages, unconfirmed sends or unread counts), newest first. */
  function conversations() {
    const d = data();
    const name = me();
    const rows = nmap();
    Object.keys(d.byPeer || {}).forEach(p => {
      const list = d.byPeer[p] || [];
      if (!list.length) return;
      const last = list[list.length - 1];
      rows[p] = { peer: p, key: last.id, pendingSeq: 0, text: last.text, mine: last.from === name, at: last.sentAt };
    });
    pending.forEach(it => {
      const r = rows[it.peer] || { peer: it.peer, key: 0, pendingSeq: 0, text: '', mine: true, at: '' };
      if (it.seq > r.pendingSeq) { r.pendingSeq = it.seq; r.text = it.text; r.mine = true; r.at = ''; }
      rows[it.peer] = r;
    });
    Object.keys(d.unread || {}).forEach(p => {
      if (!rows[p] && posInt(d.unread[p])) rows[p] = { peer: p, key: 0, pendingSeq: 0, text: '', mine: false, at: '' };
    });
    return Object.keys(rows).map(p => rows[p]).sort((a, b) => {
      if (!!a.pendingSeq !== !!b.pendingSeq) return a.pendingSeq ? -1 : 1;
      if (a.pendingSeq && b.pendingSeq) return b.pendingSeq - a.pendingSeq;
      return b.key - a.key;
    });
  }

  function rowHtml(r) {
    const c = k();
    const n = posInt(get(data().unread, r.peer));
    const gone = isDeleted(r.peer);
    const preview = (r.mine && r.text ? MSG.you : '') + r.text.replace(/\s+/g, ' ').trim();
    const time = r.pendingSeq ? '' : listTime(r.at);
    return '<button type="button" class="' + c.listRow + ' py-2" data-chat-peer="' + esc(r.peer) + '">' +
      C.Kit.avatar(r.peer, 'md') +
      '<span class="flex-1 min-w-0">' +
        '<span class="flex items-start gap-2">' +
          '<span class="' + (n ? CLS.rowNameUnread : CLS.rowName) + '">' + esc(r.peer) +
            (gone ? '<span class="' + CLS.gone + '">' + esc(MSG.deleted) + '</span>' : '') + '</span>' +
          (time ? '<span class="' + CLS.rowTime + ' pt-1" data-chat-time>' + esc(time) + '</span>' : '') +
        '</span>' +
        '<span class="flex items-center gap-2">' +
          '<span class="' + (n ? CLS.rowLastUnread : CLS.rowLast) + '" data-chat-last>' + esc(preview || ' ') + '</span>' +
          (n ? '<span data-chat-unread="' + n + '">' + C.Kit.badge(n, MSG.unreadLabel) + '</span>' : '') +
        '</span>' +
      '</span>' +
      icon('chevron-right', c.listChevron) +
      '</button>';
  }

  function paintList() {
    if (!listRoot) return;
    buildList();
    const c = k();
    const rows = conversations();
    let html;
    if (rows.length) {
      html = '<div class="' + c.list + '">' + rows.map(rowHtml).join('') + '</div>';
    } else if (!loadedOnce && syncing) {
      html = '<div class="' + c.card + '">' + C.Kit.skeleton(4) + '</div>';
    } else if (loadError) {
      html = '<div class="' + c.card + '" data-chat-error>' + C.Kit.empty({ icon: 'cloud-off', title: MSG.loadFailed, hint: MSG.loadFailedHint }) +
        '<div class="flex justify-center pb-2"><button type="button" class="' + c.btn + ' ' + c.btnTonal + '" data-chat-act="retry-load">' +
        icon('refresh', 'w-5 h-5') + esc(MSG.retry) + '</button></div></div>';
    } else {
      html = '<div class="' + c.card + '" data-chat-empty>' + C.Kit.empty({ icon: 'message', title: MSG.empty, hint: MSG.emptyHint }) + '</div>';
    }
    C.setHtml(ref.list, html);
  }

  function onListClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const row = t.closest('[data-chat-peer]');
    if (row && listRoot.contains(row)) {
      const peer = row.getAttribute('data-chat-peer');
      C.spawn(() => C.go(ROOM_ID, { peer }));
      return;
    }
    const act = t.closest('[data-chat-act]');
    if (!act) return;
    const a = act.getAttribute('data-chat-act');
    if (a === 'new') openSheet();
    else if (a === 'retry-load') { loadError = false; sync('retry'); repaint(); }
  }

  /* ------------------------------------------------------------------ new-chat sheet */
  function ensureSheet() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    const c = k();
    const el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = c.sheetWrap + ' md:p-4';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'chatNewTitle');
    el.innerHTML = '<div class="uk-safe-b ' + c.sheetFrame + '" data-sheet-panel>' +
      '<div class="' + c.sheetGrabber + '" aria-hidden="true"></div>' +
      '<div class="' + c.sheetHead + '"><h2 id="chatNewTitle" class="flex-1 outline-none ' + c.sheetTitle + '" data-sheet-title tabindex="-1">' +
        esc(MSG.newChat) + '</h2>' +
        '<button type="button" class="' + c.iconBtn + '" data-sheet-close aria-label="' + esc(MSG.close) + '">' + icon('chevron-down') + '</button></div>' +
      '<div class="' + c.sheetScroll + '">' +
        '<p class="' + c.textMeta + '">' + esc(MSG.pick) + '</p>' +
        '<div class="' + CLS.searchWrap + '"><label for="chatSearch" class="' + CLS.srOnly + '">' + esc(MSG.search) + '</label>' +
          icon('search', CLS.searchIcon) +
          // type text, not search: the native search field draws a clear button shaped like a cross (owner rule: none)
          '<input id="chatSearch" type="text" enterkeyhint="search" class="' + c.input + ' pl-11" placeholder="' + esc(MSG.search) +
            '" autocomplete="off" data-chat-search></div>' +
        '<div data-chat-people></div>' +
      '</div></div>';
    el.addEventListener('click', onSheetClick);
    el.addEventListener('input', e => {
      if (e.target && e.target.id === 'chatSearch') { sheetQuery = e.target.value; paintSheet(); }
    });
    document.body.appendChild(el);
    sheetEl = el;
    return el;
  }
  function paintSheet() {
    if (!sheetEl) return;
    const c = k();
    const name = me();
    const q = C.U.normalizeName(sheetQuery).toLowerCase();
    const all = C.staff().filter(s => s.name && s.name !== name);
    const people = all.filter(s => !q || s.name.toLowerCase().indexOf(q) >= 0);
    let html;
    if (!all.length) html = '<p class="' + c.textMeta + ' py-4 text-center" data-chat-nomatch>' + esc(MSG.noStaff) + '</p>';
    else if (!people.length) html = '<p class="' + c.textMeta + ' py-4 text-center" data-chat-nomatch>' + esc(MSG.noMatch) + '</p>';
    else {
      html = '<div class="' + c.list + '">' + people.map(s =>
        '<button type="button" class="' + c.listRow + '" data-chat-to="' + esc(s.name) + '">' + C.Kit.avatar(s.name, 'sm') +
        '<span class="flex-1 min-w-0 break-words [overflow-wrap:anywhere]">' + esc(s.name) + '</span>' +
        icon('message', 'w-5 h-5 shrink-0 text-brand-500') + '</button>').join('') + '</div>';
    }
    C.setHtml(sheetEl.querySelector('[data-chat-people]'), html);
  }
  function openSheet() {
    if (!canChat()) return;
    const el = ensureSheet();
    sheetQuery = '';
    const input = el.querySelector('#chatSearch');
    if (input) input.value = '';
    paintSheet();
    C.Kit.sheet.open(el, { initialFocus: '[data-sheet-title]' });
  }
  function closeSheet() {
    if (sheetEl && C.Kit.sheet.isOpen(sheetEl)) C.Kit.sheet.close(sheetEl, 'api');
  }
  function onSheetClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-chat-to]') : null;
    if (!t) return;
    const peer = t.getAttribute('data-chat-to');
    closeSheet();
    C.spawn(() => C.go(ROOM_ID, { peer }));
  }

  /* ------------------------------------------------------------------ room screen */
  function buildRoom() {
    if (roomBuilt || !roomRoot) return;
    const c = k();
    roomRoot.innerHTML =
      '<div class="' + CLS.room + '" data-chat-room>' +
        '<div class="' + CLS.olderBox + '" data-chat-older-box></div>' +
        '<div class="' + CLS.msgs + '" data-chat-msgs role="log" aria-live="polite" aria-label="' + esc(MSG.log) + '"></div>' +
        '<div class="' + CLS.composer + '" data-chat-composer>' +
          '<p class="' + CLS.readonly + ' hidden" data-chat-readonly>' + icon('info', 'w-5 h-5 shrink-0 mt-0.5 text-ink-500') +
            '<span class="min-w-0">' + esc(MSG.readOnly) + '</span></p>' +
          '<div class="' + CLS.form + '" data-chat-form>' +
            '<label for="chatInput" class="' + CLS.srOnly + '" data-chat-label></label>' +
            '<div class="' + CLS.field + '" data-chat-field>' +
              '<textarea id="chatInput" rows="1" maxlength="' + TEXT_MAX + '" class="' + CLS.input + '" placeholder="' + esc(MSG.placeholder) +
              '" autocomplete="off"></textarea></div>' +
            '<button type="button" class="' + CLS.sendBtn + '" data-chat-act="send" aria-label="' + esc(MSG.send) + '" disabled>' +
              icon('send', 'w-5 h-5') + '</button>' +
          '</div>' +
          '<div class="' + CLS.under + '"><p class="' + CLS.note + '" data-chat-note role="status"></p>' +
            '<p class="' + c.dialogCount + ' hidden" data-chat-count aria-live="off"></p></div>' +
        '</div>' +
      '</div>';
    ref.room = roomRoot.querySelector('[data-chat-room]');
    ref.older = roomRoot.querySelector('[data-chat-older-box]');
    ref.msgs = roomRoot.querySelector('[data-chat-msgs]');
    ref.composer = roomRoot.querySelector('[data-chat-composer]');
    ref.readonly = roomRoot.querySelector('[data-chat-readonly]');
    ref.form = roomRoot.querySelector('[data-chat-form]');
    ref.label = roomRoot.querySelector('[data-chat-label]');
    ref.input = roomRoot.querySelector('#chatInput');
    ref.send = roomRoot.querySelector('[data-chat-act="send"]');
    ref.note = roomRoot.querySelector('[data-chat-note]');
    ref.count = roomRoot.querySelector('[data-chat-count]');
    ref.field = roomRoot.querySelector('[data-chat-field]');
    ref.field.addEventListener('click', e => { if (e.target === ref.field) { try { ref.input.focus(); } catch (x) { /* ignore */ } } });
    ref.input.addEventListener('input', onInput);
    ref.input.addEventListener('keydown', onKeydown);
    if (typeof window.ResizeObserver === 'function') {
      // the header grows (offline notice), the composer grows (5 lines), a banner appears: whoever was at the end stays there
      resizeObs = new window.ResizeObserver(() => {
        if (C.current() === ROOM_ID && room.pinned && !room.needBottom && room.anchor < 0) toBottom();
      });
      resizeObs.observe(ref.room);
      const head = document.getElementById('appHeader');
      if (head) resizeObs.observe(head);
    }
    roomBuilt = true;
  }

  /**
   * The room fills the screen below the header, so a short conversation sits right above the composer; the sticky composer
   * reaches into #appMain's bottom padding (a negative margin of that size), so at the end of the history it rests on the
   * screen's bottom edge exactly where it sticks while scrolling (no jump).
   */
  function fitRoom() {
    const main = document.getElementById('appMain');
    if (!ref.room || !ref.composer || !main || !ref.room.offsetParent) return;   // not displayed: nothing to measure
    const bottom = parseFloat(window.getComputedStyle(main).paddingBottom) || 0;
    // where the room starts in the page (offsetTop ignores the screen's entry animation, a transform)
    let top = 0;
    for (let el = ref.room; el; el = el.offsetParent) top += el.offsetTop;
    const key = top + '/' + bottom;
    if (ref.room.dataset.fit === key) return;
    ref.room.style.minHeight = 'calc(100vh - ' + (top + bottom) + 'px)';
    ref.room.style.minHeight = 'calc(100dvh - ' + (top + bottom) + 'px)';   // ignored where dvh is unknown (the vh value stays)
    ref.composer.style.marginBottom = -bottom + 'px';
    ref.room.dataset.fit = key;
  }

  function bubbleHtml(m, mine) {
    const d = toDate(m.sentAt);
    return '<div class="' + (mine ? CLS.rowMine : CLS.rowTheirs) + '" data-chat-msg="' + m.id + '" data-mine="' + (mine ? '1' : '0') + '">' +
      '<div class="' + (mine ? CLS.bubbleMine : CLS.bubbleTheirs) + '">' +
        '<p class="' + CLS.text + '" data-chat-text>' + esc(m.text) + '</p>' +
        '<p class="' + (mine ? CLS.timeMine : CLS.timeTheirs) + '">' + esc(hhmm(d)) + '</p>' +
      '</div></div>';
  }
  function pendingHtml(it) {
    if (it.state === 'failed') {
      return '<div class="' + CLS.rowMine + '" data-chat-pending="' + esc(it.cid) + '" data-state="failed">' +
        '<button type="button" class="' + CLS.bubbleFailed + '" data-chat-retry="' + esc(it.cid) + '">' +
          '<span class="block ' + CLS.text + '" data-chat-text>' + esc(it.text) + '</span>' +
          '<span class="' + CLS.statusFailed + '">' + icon('alert-triangle', 'w-3.5 h-3.5 shrink-0') + esc(MSG.failed) + '</span>' +
        '</button></div>';
    }
    return '<div class="' + CLS.rowMine + '" data-chat-pending="' + esc(it.cid) + '" data-state="sending">' +
      '<div class="' + CLS.bubbleSending + '">' +
        '<p class="' + CLS.text + '" data-chat-text>' + esc(it.text) + '</p>' +
        '<p class="' + CLS.status + '">' + esc(MSG.sending) + '</p>' +
      '</div></div>';
  }
  function sepHtml(day) {
    return '<div class="' + CLS.sep + '" data-chat-sep="' + esc(day) + '">' + C.Kit.pill(sepLabel(day), 'neutral') + '</div>';
  }

  function messagesHtml(peer) {
    const d = data();
    const name = me();
    const msgs = get(d.byPeer, peer) || [];
    const mineItems = pending.filter(it => it.peer === peer).sort((a, b) => a.seq - b.seq);
    if (!msgs.length && !mineItems.length) {
      if (!loadedOnce && syncing) return '<div class="' + k().card + '">' + C.Kit.skeleton(3) + '</div>';
      return '<div class="' + CLS.roomEmpty + '" data-chat-room-empty>' + C.Kit.avatar(peer, 'lg') +
        '<p class="' + CLS.roomEmptyText + '">' + esc(MSG.roomEmpty) + '</p></div>';
    }
    const r = get(d.reads, peer);
    const theirs = r ? posInt(r.theirs) : 0;
    let readId = 0;
    for (let i = msgs.length - 1; i >= 0 && theirs; i--) {
      if (msgs[i].from === name && msgs[i].id <= theirs) { readId = msgs[i].id; break; }
    }
    let out = '';
    let lastDay = '';
    msgs.forEach(m => {
      const day = dayOf(toDate(m.sentAt));
      if (day && day !== lastDay) { out += sepHtml(day); lastDay = day; }
      const mine = m.from === name;
      out += bubbleHtml(m, mine);
      if (mine && m.id === readId) out += '<p class="' + CLS.readLine + '" data-chat-read>' + esc(MSG.read) + '</p>';
    });
    if (mineItems.length) {
      const today = C.U.todayStr();
      if (lastDay !== today) out += sepHtml(today);
      mineItems.forEach(it => { out += pendingHtml(it); });
    }
    return out;
  }

  function paintComposer() {
    if (!ref.input) return;
    const peer = room.peer;
    const gone = !!peer && isDeleted(peer);
    C.setVisible(ref.readonly, gone);
    C.setVisible(ref.form, !gone);
    ref.input.disabled = gone;
    const label = MSG.inputLabel + peer;
    if (ref.label.textContent !== label) ref.label.textContent = label;
    const v = ref.input.value;
    const n = v.length;
    ref.send.disabled = gone || !v.replace(CONTROL_CHARS, '').trim() || n > TEXT_MAX;
    const showCount = !gone && n >= COUNT_FROM;
    C.setVisible(ref.count, showCount);
    if (showCount) {
      const full = n >= TEXT_MAX;
      const t = n + '/' + TEXT_MAX;
      if (ref.count.textContent !== t) ref.count.textContent = t;
      ref.count.className = (full ? k().dialogCountDanger : k().dialogCount) + ' shrink-0';
      ref.count.setAttribute('aria-live', 'polite');
    }
    const note = gone ? '' : room.error;
    if (ref.note.textContent !== note) ref.note.textContent = note;
  }

  /**
   * The textarea grows with its text up to 5 lines, then scrolls. It has no padding or border of its own (the box around
   * it has them), so its height is a whole number of lines and a scrolled composer never shows part of a line.
   */
  function grow() {
    const ta = ref.input;
    if (!ta || !ta.isConnected) return;
    ta.style.height = 'auto';
    const lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 24;
    const lines = Math.max(1, Math.round(ta.scrollHeight / lh));
    ta.style.height = Math.min(lines, MAX_LINES) * lh + 'px';
    ta.style.overflowY = lines > MAX_LINES ? 'auto' : 'hidden';
    if (C.current() === ROOM_ID && room.pinned && !room.needBottom) toBottom();   // a taller composer keeps the end in view
  }

  function paintRoom() {
    if (!roomRoot || C.current() !== ROOM_ID) return;
    buildRoom();
    fitRoom();
    const peer = room.peer;
    const msgs = get(data().byPeer, peer) || [];
    const c = k();
    let older = '';
    if (olderAvailable(peer, msgs)) {
      older = '<button type="button" class="' + c.btn + ' ' + c.btnSecondary + '" data-chat-act="older"' + (room.older ? ' disabled aria-busy="true"' : '') + '>' +
        icon(room.older ? 'clock' : 'chevron-up', 'w-5 h-5') + esc(room.older ? MSG.olderBusy : room.olderFailed ? MSG.olderFailed : MSG.older) + '</button>';
    }
    C.setHtml(ref.older, older);
    const wasNear = nearBottom();
    const html = messagesHtml(peer);
    const changed = ref.msgs._html !== html;
    C.setHtml(ref.msgs, html);
    paintComposer();
    if (room.anchor >= 0) {
      const s = scroller();
      const top = s.scrollHeight - room.anchor;
      room.anchor = -1;
      try { window.scrollTo(0, Math.max(0, top)); } catch (e) { /* ignore */ }
    } else if (changed && (wasNear || room.pinned || room.stickBottom) && !room.needBottom) {
      toBottom();
    }
    room.stickBottom = false;
    maybeMarkRead();
  }

  function onInput() {
    if (!room.peer) return;
    noteActivity();
    room.error = '';
    saveDraft(room.peer, ref.input.value);
    grow();
    paintComposer();
  }
  function onKeydown(e) {
    if (e.key !== 'Enter' || e.isComposing || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    sendFromComposer();
  }
  function onRoomClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const retry = t.closest('[data-chat-retry]');
    if (retry) {
      const cid = retry.getAttribute('data-chat-retry');
      const it = pending.filter(x => x.cid === cid)[0];
      if (it && it.state === 'failed') { noteActivity(); post(it); }
      return;
    }
    const act = t.closest('[data-chat-act]');
    if (!act) return;
    const a = act.getAttribute('data-chat-act');
    if (a === 'send') sendFromComposer();
    else if (a === 'older') loadOlder();
  }

  function openRoom(params) {
    const name = me();
    const asked = params && typeof params.peer === 'string' ? params.peer : room.peer;
    if (!asked || asked === name) { C.spawn(() => C.go(LIST_ID)); return; }
    buildRoom();
    if (room.peer !== asked) {
      room.peer = asked;
      room.error = '';
      room.older = false;
      room.olderFailed = false;
      const draft = C.store.draft.get(draftKey(asked));
      const text = typeof draft === 'string' ? draft.slice(0, TEXT_MAX) : '';
      // a draft that is the text of a message still on its way (or failed: its bubble is shown) stays out of the composer
      ref.input.value = text && pending.some(it => it.peer === asked && it.text === cleanText(text)) ? '' : text;
    }
    C.setScreenTitle(asked + (isDeleted(asked) ? MSG.deleted : ''));
    noteActivity();
    room.needBottom = true;
    room.pinned = true;
    room.lastPollAt = Date.now();
    // after core.go's own scroll to the top (it runs right after show)
    setTimeout(() => {
      if (C.current() !== ROOM_ID || room.peer !== asked) return;
      room.needBottom = false;
      grow();
      toBottom();
    }, 0);
    sync('show');
    stopPoll('room');
    polls.room = C.poll.every('chat-room', ROOM_POLL_MS, roomTick);
  }

  /* ------------------------------------------------------------------ shared */
  function repaint() {
    const cur = C.current();
    if (cur === LIST_ID) paintList();
    else if (cur === ROOM_ID) paintRoom();
  }

  function resetAll() {
    syncSeq++;
    stopPolls();
    if (readTimer) { clearTimeout(readTimer); readTimer = null; }
    readQ = Object.create(null);
    readRefused = Object.create(null);
    answers = 0;
    restoring = null;
    syncing = null;
    again = false;
    loadedOnce = false;
    loadError = false;
    pending = [];
    copySaving = false;
    copyDirty = false;
    lastIncoming = 0;
    room.peer = '';
    room.activeAt = 0;
    room.lastPollAt = 0;
    room.needBottom = false;
    room.stickBottom = false;
    room.anchor = -1;
    room.older = false;
    room.olderFailed = false;
    room.error = '';
    room.pinned = true;
    if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
    sheetQuery = '';
    closeSheet();
    if (sheetEl) {
      const people = sheetEl.querySelector('[data-chat-people]');
      if (people) { people.innerHTML = ''; people._html = ''; }
      const input = sheetEl.querySelector('#chatSearch');
      if (input) input.value = '';
    }
    if (listRoot) { listRoot.innerHTML = ''; listRoot._html = ''; }
    if (roomRoot) { roomRoot.innerHTML = ''; roomRoot._html = ''; }
    listBuilt = false;
    roomBuilt = false;
    Object.keys(ref).forEach(key => { delete ref[key]; });
  }

  /** Whether the reader is at the end of the open room (kept up to date while scrolling). */
  window.addEventListener('scroll', () => {
    if (C.current() === ROOM_ID && !room.needBottom) room.pinned = nearBottom();
  }, { passive: true });

  /* ------------------------------------------------------------------ registration */
  App.register({
    id: LIST_ID,
    title: MSG.title,
    icon: 'message',
    nav: { place: 'header', order: 10 },
    visible: c => c.serverHas('chat'),
    badge: () => totalUnread(),
    badgeLabel: n => MSG.unreadLabelHeader(n),   // R3 FIX-CL L-13
    init(c) {
      dom = c.domain('chat', { persist: false, empty: { lastId: 0, byPeer: {}, reads: {}, unread: {}, version: '' } });
      dom.onStale(() => { sync('stale'); });
      c.on('visible', () => { retryReads(); if (C.current() === ROOM_ID) maybeMarkRead(); });
      c.on('online', () => { retryReads(); });
    },
    mount(root) {
      listRoot = root;
      root.addEventListener('click', onListClick);
    },
    render() { paintList(); },
    show() {
      sync('show');   // render() follows show(): it shows the loading state while this first request runs
      stopPoll('list');
      polls.list = C.poll.every('chat-list', LIST_POLL_MS, () => { retryReads(); return sync('poll'); });
    },
    hide() { stopPoll('list'); },
    reset() { resetAll(); }
  });

  App.register({
    id: ROOM_ID,
    title: MSG.title,
    icon: 'message',
    nav: { place: 'none' },
    parent: LIST_ID,
    chrome: { bottomNav: false },
    visible: c => c.serverHas('chat'),
    mount(root) {
      roomRoot = root;
      root.addEventListener('click', onRoomClick);
    },
    render() { paintRoom(); },
    show(c, params) { openRoom(params); },
    hide() {
      stopPoll('room');
      if (readTimer) { clearTimeout(readTimer); readTimer = null; }
    },
    reset() { /* the list screen's reset drops the shared state */ }
  });
}());
