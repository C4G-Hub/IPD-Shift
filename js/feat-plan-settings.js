/* =====================================================================
 * js/feat-plan-settings.js — feature "plan-settings" (ตั้งค่าการจัดเวร) → App.register     (R2-SPEC §4.5, §0.26; track PS)
 *
 * เมนู → งานหัวหน้า → "ตั้งค่าการจัดเวร" (order 50, icon sliders, parent 'menu'), visible for the Supervisor of a v3 server.
 * Staff have no entry. A server without the 'plan' feature (Code.gs 3.0) gets an empty state that explains the update;
 * nothing is sent then. Data comes ONLY from core.use('plan') (js/plan-data.js); every card is saved by ONE request:
 *
 *  card (in this order, FIX-PS P-3: the intro's setup order)               request
 *  assistants ผู้ช่วย: the active list (add name + note, remove = soft delete, return a removed one)
 *                                                                              saveAssistants (the full active list)
 *  holidays   วันหยุด: one calendar year at a time (‹ year ›), rows date + name, add with <input type="date"> + name;
 *              a year outside plan-data's range is fetched with plan.ensure (the range is put back on leaving)
 *                                                                              setHolidays {year, holidays}
 *  skills     Station ที่แต่ละคนอยู่ได้: per active person null (ยังไม่ได้ตั้ง = auto-fill only Portable / IPD / ER,
 *              R2-SPEC §0.26 b — said once in the card, rows show only "ยังไม่ได้ตั้ง"), the six ids ("ทุก Station"), or a
 *              subset; exactly ONE id = "ประจำ <Station>" (lock badge, §0.26 a). The sheet: "ยังไม่ได้ตั้ง", "ทุก Station",
 *              6 checkboxes (never Prereview/Supervisor, §0.10); not set shows Portable+IPD+ER ticked and the first change
 *              starts from them (FIX-PS P-1: ticking US gives four stations, never a lock); a one-station result turns the
 *              summary coral "ประจำ … (ล็อก)". Bulk "ตั้งทุกคนที่ยังไม่ได้ตั้งเป็น…" applies one choice to every not-set person
 *                                                                              setProfiles {skills} of the changed people
 *  mission    ภารกิจพิเศษ: ordered list (↑ ↓ remove), phone <input type="tel" inputmode="tel"> per person, "เพิ่มคน"; a phone is
 *              sent only when edited in this draft (FIX-PS P-2), an untouched one shows the current stored number
 *                                                                              setProfiles {missionEligible, missionOrder,
 *                                                                              phone} (removed people missionEligible:false)
 *  aliases    ชื่อเรียกอื่น: alias chips per person (add with a prompt, tap a chip to remove)   setProfiles {aliases}
 *  priority   ลำดับการเติมคน: the 6 auto-filled stations ↑ ↓ (Prereview/Supervisor last, "จัดเองเท่านั้น", not movable) and
 *              the fill mode (coverage | priority); core.openStationCounts()      setPlanSettings {priority, slotOrder}
 *  pairs      ห้ามอยู่คู่กัน (R2-SPEC §0.27, Supervisor only): pairs with remove buttons, add with two selects (a ≠ b, no
 *              duplicate); read from plan.avoidPairs(). A server answer without rules.avoidPairs (Code.gs before §0.27
 *              ignores the key) is shown as "not supported yet"               setPlanSettings {avoidPairs}
 *
 * Cards are collapsed to one summary line ("ผู้ช่วย · 6 คน", "วันหยุด 2569 · 0 วัน") and expand on tap; a card with unsaved
 * edits opens by itself (FIX-PS P-3).
 * Each card: local edits (a draft in core.store.draft('plan-settings:<card>') — it survives a reload and is removed on
 * logout by the core), a pill "ยังไม่ได้บันทึก", "ยกเลิกการแก้ไข", "บันทึก" with its own busy state (the card's fields are
 * disabled while its request runs), a success toast, and the server's VALIDATION / FORBIDDEN / CONFLICT message in the
 * card (names the server lists, e.g. alias conflicts, are marked) plus an error toast; VALIDATION / CONFLICT also ask for a
 * heartbeat (core.refresh) and refetch the plan. canLeave asks while a card has
 * unsaved edits (the drafts stay on this device).
 *
 * Service (R2-SPEC §3.2: staff may set only their OWN phone; this screen is Supervisor-only):
 *   core.provide('plan.myPhone', {render(el)}) — paints "เบอร์โทรของฉัน" (tel field + save → setProfiles {phone} of the
 *   logged-in user) into `el`; paints nothing while the server has no 'plan'. The profile screen calls it (I2 hook).
 *
 * DOM hooks for tests: #tab-plan-settings [data-ps="state|cards|caption"], sections [data-ps-card="<card>"] with parts
 * [data-ps-part="head|body|foot"], [data-ps-dirty], [data-ps-error], buttons [data-ps-act="…"] (data-card / data-name /
 * data-alias / data-date / data-id), rows [data-ps-row="<name>"], inputs [data-ps-in="…"], [data-ps-phone="<name>"],
 * radios name="psSlotOrder"; the skills sheet #psSkillsSheet ([data-ps-skill="<id>|none|all"], [data-ps-sheet-act]).
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function') return;   // app.js did not start (boot guard): nothing to attach to

  const CARDS = ['assistants', 'holidays', 'skills', 'mission', 'aliases', 'priority', 'pairs'];   // FIX-PS P-3: the intro's order
  const SKILL_IDS = ['portable', 'ipd', 'us', 'or', 'er', 'cancer'];   // station order, never 'supervisor' (R2-SPEC §0.10)
  const OPEN_BY_DEFAULT = ['portable', 'ipd', 'er'];                   // R2-SPEC §0.26 (b): skills not set
  const ALL_STATIONS = ['portable', 'ipd', 'us', 'or', 'er', 'cancer', 'supervisor'];
  const DRAFT_PREFIX = 'plan-settings:';
  const PHONE_RE = /^\+?\d{9,15}$/;
  // the skills sheet's summary when the choice locks the person to one station (FIX-PS P-1: coral; the text says "(ล็อก)")
  const LOCKED_NOTE = 'flex items-start gap-2.5 p-3 rounded-2xl bg-coral-50 border-2 border-coral-200 text-sm font-medium leading-6 text-coral-700';
  const MSG_SAME_NAME = 'ชื่อเดียวกับพนักงาน — ระบบถือเป็นคนละคน';   // R3 FIX-CL L-16
  const LIMITS = { pairs: 50, items: 50, assistants: 50, assistantNote: 100, holidays: 60, holidayName: 60, aliases: 10, alias: 30 };
  const MSG = {
    oldServer: 'เซิร์ฟเวอร์ยังเป็นรุ่นเก่า (Code.gs 3.0) — วาง Code.gs รุ่น 3.1 แล้ว Deploy เวอร์ชันใหม่ เพื่อเปิดระบบจัดเวร',
    loading: 'กำลังโหลดข้อมูลการจัดเวร…',
    loadFailed: 'โหลดข้อมูลการจัดเวรไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง',
    cached: 'ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)',
    intro: 'ตั้งค่าครั้งแรกตามลำดับ: ผู้ช่วย → วันหยุด → Station ที่แต่ละคนอยู่ได้ → ภารกิจพิเศษ แล้วจึงจัดคนประจำในแท็บตารางเวร',
    unsaved: 'ยังไม่ได้บันทึก',
    notSet: 'ยังไม่ได้ตั้ง — เติมได้เฉพาะ Portable, IPD, ER',
    allStations: 'ทุก Station (ยกเว้น Prereview/Supervisor)',
    noStation: 'ไม่ลง Station ใดอัตโนมัติ',
    lockHint: 'เลือก Station เดียว = ประจำ Station นั้น ระบบจะไม่ย้ายไป Station อื่นเอง',
    sheetLockHint: 'ติ๊ก Station เดียว = ล็อกไว้ที่ Station นั้น',
    notSetShort: 'ยังไม่ได้ตั้ง',
    notSetMeaning: 'ยังไม่ได้ตั้ง = เติมได้เฉพาะ Portable, IPD, ER',
    skillsHint: 'ใช้ตอนระบบเสนอคนลง Station — OR, US, CANCER CENTER ต้องติ๊กให้ชัดเจน ส่วน Prereview/Supervisor จัดเองเท่านั้น',
    missionHint: 'เรียงตามลำดับการขึ้นภารกิจ — คนที่ลาวันนั้นจะถูกข้าม',
    aliasHint: 'ใช้ช่วยอ่านข้อความแทนเวร',
    pairsHint: 'เห็นเฉพาะ Supervisor — ระบบจะไม่จัดคู่นี้ลง Station เดียวกันเอง',
    pairsUnsupported: 'เซิร์ฟเวอร์ยังไม่รองรับ "ห้ามอยู่คู่กัน" — อัปเดต Code.gs เป็นรุ่นล่าสุดแล้วลองอีกครั้ง',
    netFail: 'บันทึกไม่สำเร็จเพราะเชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — การแก้ไขยังอยู่ กด "บันทึก" อีกครั้ง',
    noPlan: 'ต้องอัปเดต Code.gs เป็นเวอร์ชันล่าสุดก่อน',
    holidaysChanged: 'ตรวจตารางเวรของเดือนที่วันหยุดเปลี่ยน',
    leave: names => 'ยังไม่ได้บันทึก: ' + names.join(', ') + '\nการแก้ไขยังเก็บไว้ในเครื่องนี้ — ออกจากหน้านี้หรือไม่?'
  };
  const TITLES = {
    skills: 'Station ที่แต่ละคนอยู่ได้', assistants: 'ผู้ช่วย', holidays: 'วันหยุด', mission: 'ภารกิจพิเศษ',
    aliases: 'ชื่อเรียกอื่น', priority: 'ลำดับการเติมคน', pairs: 'ห้ามอยู่คู่กัน'
  };
  const SAVED = {
    skills: '✅ บันทึก Station ที่แต่ละคนอยู่ได้แล้ว', assistants: '✅ บันทึกรายชื่อผู้ช่วยแล้ว', mission: '✅ บันทึกรายชื่อภารกิจพิเศษแล้ว',
    aliases: '✅ บันทึกชื่อเรียกอื่นแล้ว', priority: '✅ บันทึกลำดับการเติมคนแล้ว',
    pairs: '✅ บันทึกคู่ที่ห้ามอยู่ด้วยกันแล้ว'
  };

  let C = null;                 // App.core
  let root = null;              // the screen's <section>
  let built = false;
  let ref = {};
  let sheetEl = null;           // #psSkillsSheet (in <body>)
  const st = {
    user: '',                   // whose drafts are loaded
    draft: { skills: null, assistants: null, holidays: null, mission: null, aliases: null, priority: null },
    busy: {},                   // card → true while its save runs
    error: {},                  // card → {msg, names}
    addError: {},               // card → message of its add form
    add: { asstName: '', asstNote: '', holDate: '', holName: '', missionPick: '', pairA: '', pairB: '' },
    year: 0,                    // the holiday year shown
    yearLoad: {},               // year → 'loading' | 'fail'
    moved: false,               // plan.ensure was called for a holiday year: the range is put back on leaving
    open: {},                   // card → expanded (FIX-PS P-3); unset = open only while it has unsaved edits
    sheet: null                 // {name, skills} | {bulk, names, skills} while the skills sheet is open
  };

  /* ------------------------------------------------------------------ small helpers */
  function k() { return C.Kit.cls; }
  function U() { return C.U; }
  function esc(s) { return C.esc(s); }
  function icon(name, cls) { return C.Kit.icon(name, cls || 'w-5 h-5'); }
  function plan() { return C.use('plan'); }
  function on() { return !!C && C.serverHas('plan') && !!plan(); }
  function json(v) { return JSON.stringify(v === undefined ? null : v); }
  function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function own(o, key) { return !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, key); }
  function norm(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function staffNames() { return C.staff().map(s => s.name); }
  function stationName(id) { const s = U().stationById(id); return s ? s.name : id; }
  function stationDot(id) {
    const s = U().stationById(id);
    return `<span class="inline-block w-3 h-3 shrink-0 rounded-full" style="background:${s ? s.border : '#ccc'}" aria-hidden="true"></span>`;
  }
  function apiCode(e) { return e && e.name === 'ApiError' ? e.code : ''; }
  function sessionError(e) { const c = apiCode(e); return c === 'AUTH_REQUIRED' || c === 'PASSWORD_CHANGE_REQUIRED'; }
  function thisYear() { return +U().todayStr().slice(0, 4); }
  function beYear(y) { return 'พ.ศ. ' + (y + 543); }
  function normPhone(v) { return String(v === undefined || v === null ? '' : v).replace(/[\s-]+/g, ''); }
  function phoneOk(v) { const p = normPhone(v); return p === '' || PHONE_RE.test(p); }
  function fmtPhone(v) {
    const p = normPhone(v);
    if (/^0\d{9}$/.test(p)) return p.slice(0, 3) + '-' + p.slice(3, 6) + '-' + p.slice(6);
    if (/^0\d{8}$/.test(p)) return p.slice(0, 2) + '-' + p.slice(2, 5) + '-' + p.slice(5);
    return p;
  }
  /** The month ± 1 around the selected date (plan-data's own window for วันนี้). */
  function windowOfSelected() {
    const d = U().parseYmd(C.selectedDate()) || U().parseYmd(U().todayStr());
    const y = d.getFullYear(), m = d.getMonth();
    return { from: U().ymd(new Date(y, m - 1, 1)), to: U().ymd(new Date(y, m + 2, 0)) };
  }

  /** innerHTML only when the markup changed (own cache, so a field the user is typing in is not rebuilt). */
  function paint(el, html) {
    if (!el || el.__psHtml === html) return;
    el.innerHTML = html;
    el.__psHtml = html;
  }

  /* ------------------------------------------------------------------ skills model */
  function normSkills(v) {
    if (v === null || v === undefined) return null;
    if (!Array.isArray(v)) return null;
    return SKILL_IDS.filter(id => v.indexOf(id) >= 0);
  }
  function storedSkills(name) { const p = plan().profile(name); return p ? normSkills(p.skills) : null; }
  function skillsOf(name) { const d = st.draft.skills; return d && own(d, name) ? d[name] : storedSkills(name); }
  /** Active people whose skills (draft included) are not set — the bulk action's targets. */
  function notSetNames() { return staffNames().filter(n => skillsOf(n) === null); }
  /** The row text (FIX-PS P-3: a not-set row says only "ยังไม่ได้ตั้ง"; its meaning stands once in the card). */
  function skillsRowText(v) { return v === null ? MSG.notSetShort : skillsSummary(v); }
  function skillsSummary(v) {
    if (v === null) return MSG.notSet;
    if (!v.length) return MSG.noStation;
    if (v.length === SKILL_IDS.length) return MSG.allStations;
    if (v.length === 1) return 'ประจำ ' + stationName(v[0]) + ' — ระบบจะไม่ย้ายไป Station อื่นเอง';
    return v.map(stationName).join(' · ');
  }
  function skillsDirtyNames() {
    const d = st.draft.skills;
    if (!d) return [];
    return staffNames().filter(n => own(d, n) && json(d[n]) !== json(storedSkills(n)));
  }

  /* ------------------------------------------------------------------ assistants model */
  function storedAssistants() { return plan().assistants().filter(a => a.active).map(a => ({ name: a.name, note: a.note || '' })); }
  function assistantsList() { return st.draft.assistants || storedAssistants(); }
  function asstKey(list) { return json(list.map(a => [a.name, norm(a.note)]).sort()); }
  function assistantsDirty() { return !!st.draft.assistants && asstKey(st.draft.assistants) !== asstKey(storedAssistants()); }

  /* ------------------------------------------------------------------ holidays model */
  function storedHolidays(year) {
    const out = [];
    plan().holidays().forEach((name, date) => { if (+date.slice(0, 4) === year) out.push({ date, name: name || '' }); });
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  function holidaysOf(year) { const d = st.draft.holidays; return d && own(d, String(year)) ? d[String(year)] : storedHolidays(year); }
  function holKey(list) { return json(list.map(h => [h.date, norm(h.name)]).sort()); }
  function holidaysDirtyYears() {
    const d = st.draft.holidays;
    if (!d) return [];
    return Object.keys(d).filter(y => yearLoaded(+y) && holKey(d[y]) !== holKey(storedHolidays(+y))).map(Number);
  }
  function holidaysDirty() { const d = st.draft.holidays; return !!d && own(d, String(st.year)) && yearLoaded(st.year) && holKey(d[String(st.year)]) !== holKey(storedHolidays(st.year)); }
  function yearLoaded(year) {
    const r = plan().range();
    return !!r && +r.from.slice(0, 4) <= year && year <= +r.to.slice(0, 4);
  }

  /* ------------------------------------------------------------------ mission model */
  /**
   * Each entry: {name, phone, from} — `from` is the phone the entry started with in this draft. FIX-PS P-2: a phone counts as
   * edited only when it differs from `from`; an untouched phone always shows (and keeps) the CURRENT stored number, so a
   * number changed meanwhile on another device (or by the person) is never sent back over it.
   */
  function currentPhone(name) { const p = plan().profile(name); return p ? p.phone || '' : ''; }
  function phoneEdited(m) { return normPhone(m.phone) !== normPhone(m.from); }
  function storedMission() { return plan().eligible().map(e => ({ name: e.name, phone: fmtPhone(e.phone || ''), from: fmtPhone(e.phone || '') })); }
  function missionList() {
    if (!st.draft.mission) return storedMission();
    return st.draft.mission.map(m => {
      if (phoneEdited(m)) return { name: m.name, phone: m.phone, from: m.from };
      const cur = fmtPhone(currentPhone(m.name));
      return { name: m.name, phone: cur, from: cur };
    });
  }
  function missionDirty() {
    if (!st.draft.mission) return false;
    const list = missionList(), stored = storedMission();
    return json(list.map(m => m.name)) !== json(stored.map(m => m.name)) || list.some(m => phoneEdited(m) && normPhone(m.phone) !== normPhone(currentPhone(m.name)));
  }

  /* ------------------------------------------------------------------ aliases model */
  function storedAliases(name) { const p = plan().profile(name); return p ? p.aliases.slice() : []; }
  function aliasesOf(name) { const d = st.draft.aliases; return d && own(d, name) ? d[name] : storedAliases(name); }
  function aliasesDirtyNames() {
    const d = st.draft.aliases;
    if (!d) return [];
    return staffNames().filter(n => own(d, n) && json(d[n]) !== json(storedAliases(n)));
  }

  /* ------------------------------------------------------------------ priority model */
  /** FIX-PS P-3: Prereview/Supervisor is never auto-filled (§0.10) — it stays last, shown "จัดเองเท่านั้น", not movable. */
  function supLast(list) { return list.filter(id => id !== 'supervisor').concat(['supervisor']); }
  function storedPriority() { const s = plan().settings(); return { priority: supLast(s.priority), slotOrder: s.slotOrder }; }
  function priorityValue() { const d = st.draft.priority; return d ? { priority: supLast(d.priority), slotOrder: d.slotOrder } : storedPriority(); }
  function priorityDirty() { return !!st.draft.priority && json(priorityValue()) !== json(storedPriority()); }

  /* ------------------------------------------------------------------ avoid-pairs model (R2-SPEC §0.27, Supervisor only) */
  function normPair(a, b) { return a < b ? [a, b] : [b, a]; }
  function pairKey(list) { return json(list.map(p => p[0] + '|' + p[1]).sort()); }
  /** [[a, b]] sorted inside and between pairs, active staff only, no duplicates. */
  function cleanPairs(list) {
    const act = staffNames(), seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(p => {
      if (!Array.isArray(p) || p.length !== 2 || !isStr(p[0]) || !isStr(p[1])) return;
      const a = norm(p[0]), b = norm(p[1]);
      if (!a || !b || a === b || act.indexOf(a) < 0 || act.indexOf(b) < 0) return;
      const q = normPair(a, b), key = q[0] + '|' + q[1];
      if (seen[key]) return;
      seen[key] = true;
      out.push(q);
    });
    return out.sort((x, y) => (x[0] + '|' + x[1] < y[0] + '|' + y[1] ? -1 : 1));
  }
  function storedPairs() { const p = plan(); return cleanPairs(p && typeof p.avoidPairs === 'function' ? p.avoidPairs() : []); }
  /**
   * R2 re-review RV-1 (I1 fix): the pairs card edits and saves the FULL list, so it may act only while plan-data knows the
   * Supervisor's current pairs (a full answer of this role, or setPlanSettings' answer) — never on a staff copy or right
   * after a role change. A missing API (older plan-data) counts as known.
   */
  function pairsKnown() { const p = plan(); return !!p && (typeof p.avoidPairsKnown !== 'function' || p.avoidPairsKnown()); }
  function pairsList() { return st.draft.pairs ? cleanPairs(st.draft.pairs) : storedPairs(); }
  function pairsDirty() { return !!st.draft.pairs && pairKey(cleanPairs(st.draft.pairs)) !== pairKey(storedPairs()); }

  function isDirty(card) {
    if (!on()) return false;
    switch (card) {
      case 'pairs': return pairsDirty();
      case 'skills': return skillsDirtyNames().length > 0;
      case 'assistants': return assistantsDirty();
      case 'holidays': return holidaysDirtyYears().length > 0;
      case 'mission': return missionDirty();
      case 'aliases': return aliasesDirtyNames().length > 0;
      case 'priority': return priorityDirty();
      default: return false;
    }
  }

  /* ------------------------------------------------------------------ drafts (core.store.draft) */
  function setDraft(card, value) {
    st.draft[card] = value;
    if (value === null || value === undefined) C.store.draft.remove(DRAFT_PREFIX + card);
    else C.store.draft.set(DRAFT_PREFIX + card, value);
  }
  /** Drops a draft that equals the stored data again (no pill, nothing to ask about). */
  function tidy(card) {
    if (!on()) return;
    if (card === 'holidays') {
      const d = st.draft.holidays;
      if (!d) return;
      const next = {};
      Object.keys(d).forEach(y => { if (!yearLoaded(+y) || holKey(d[y]) !== holKey(storedHolidays(+y))) next[y] = d[y]; });
      setDraft('holidays', Object.keys(next).length ? next : null);
    } else if (card === 'skills' || card === 'aliases') {
      const d = st.draft[card];
      if (!d) return;
      const dirty = card === 'skills' ? skillsDirtyNames() : aliasesDirtyNames();
      const next = {};
      dirty.forEach(n => { next[n] = d[n]; });
      setDraft(card, dirty.length ? next : null);
    } else if (!isDirty(card)) setDraft(card, null);
  }
  /** Drafts of the logged-in user, read once per session and cleaned (localStorage is not trusted blindly). */
  function loadDrafts() {
    const user = C.myName() || (C.state.session && C.state.session.name) || '';
    if (!user || st.user === user) return;
    st.user = user;
    CARDS.forEach(card => { st.draft[card] = cleanDraft(card, C.store.draft.get(DRAFT_PREFIX + card)); });
  }
  function isStr(v) { return typeof v === 'string'; }
  function cleanDraft(card, v) {
    if (!v || typeof v !== 'object') return null;
    try {
      if (card === 'skills') {
        const out = {};
        Object.keys(v).slice(0, 200).forEach(n => { if (v[n] === null || Array.isArray(v[n])) out[n] = normSkills(v[n]); });
        return Object.keys(out).length ? out : null;
      }
      if (card === 'aliases') {
        const out = {};
        Object.keys(v).slice(0, 200).forEach(n => { if (Array.isArray(v[n])) out[n] = v[n].filter(isStr).map(norm).filter(Boolean).slice(0, LIMITS.aliases); });
        return Object.keys(out).length ? out : null;
      }
      if (card === 'assistants') {
        return Array.isArray(v) ? v.filter(a => a && isStr(a.name) && norm(a.name)).slice(0, 80).map(a => ({ name: norm(a.name), note: isStr(a.note) ? a.note : '' })) : null;
      }
      if (card === 'mission') {
        return Array.isArray(v) ? v.filter(m => m && isStr(m.name) && norm(m.name)).slice(0, 80).map(m => ({ name: norm(m.name), phone: isStr(m.phone) ? m.phone : '', from: isStr(m.from) ? m.from : (isStr(m.phone) ? m.phone : '') })) : null;
      }
      if (card === 'holidays') {
        const out = {};
        Object.keys(v).forEach(y => {
          if (!/^\d{4}$/.test(y) || !Array.isArray(v[y])) return;
          out[y] = v[y].filter(h => h && U().isValidYmd(h.date) && h.date.slice(0, 4) === y).slice(0, 100)
            .map(h => ({ date: h.date, name: isStr(h.name) ? h.name : '' }));
        });
        return Object.keys(out).length ? out : null;
      }
      if (card === 'pairs') {
        return Array.isArray(v) ? v.slice(0, 200).filter(p => Array.isArray(p) && p.length === 2 && isStr(p[0]) && isStr(p[1]))
          .map(p => [norm(p[0]), norm(p[1])]) : null;
      }
      if (card === 'priority') {
        const p = Array.isArray(v.priority) ? v.priority : [];
        const ok = p.length === ALL_STATIONS.length && ALL_STATIONS.every(id => p.indexOf(id) >= 0);
        return ok && (v.slotOrder === 'coverage' || v.slotOrder === 'priority') ? { priority: p.slice(), slotOrder: v.slotOrder } : null;
      }
    } catch (e) { /* a broken draft is dropped */ }
    return null;
  }

  /* ------------------------------------------------------------------ markup */
  /**
   * FIX-PS P-3: every card is collapsed to one summary line ("ผู้ช่วย · 6 คน") and expands on tap. A card with unsaved edits
   * opens by itself; once opened (or edited) it stays open until the Supervisor closes it.
   */
  function cardOpen(card) { return own(st.open, card) ? !!st.open[card] : isDirty(card); }
  function summaryLine(card) {
    const p = plan();
    switch (card) {
      case 'assistants': return 'ผู้ช่วย · ' + assistantsList().length + ' คน';
      case 'holidays': return yearLoaded(st.year) ? 'วันหยุด ' + (st.year + 543) + ' · ' + holidaysOf(st.year).length + ' วัน' : 'วันหยุด ' + (st.year + 543) + ' · กำลังโหลด…';
      case 'skills': {
        const names = staffNames(), notSet = names.filter(n => skillsOf(n) === null).length;
        const locked = names.filter(n => { const v = skillsOf(n); return !!v && v.length === 1; }).length;
        return 'ตั้งแล้ว ' + (names.length - notSet) + ' จาก ' + names.length + ' คน' + (locked ? ' · ประจำ Station ' + locked + ' คน' : '');
      }
      case 'mission': return missionList().length + ' คน (ตามลำดับ)';
      case 'aliases': {
        const names = staffNames(), n = names.reduce((sum, x) => sum + aliasesOf(x).length, 0);
        return n + ' ชื่อ · ' + names.filter(x => aliasesOf(x).length).length + ' คน';
      }
      case 'priority': {
        const v = priorityValue();
        return v.priority.slice(0, 3).map(stationName).join(' → ') + ' … · ' + (v.slotOrder === 'priority' ? 'ตามลำดับเคร่งครัด' : 'เติมที่ขาดมากที่สุดก่อน');
      }
      case 'pairs': return pairsKnown() ? pairsList().length + ' คู่' : 'กำลังโหลด…';   // RV-1
      default: return p ? '' : '';
    }
  }
  function sectionHead(card, iconName, tone, hint) {
    const c = k(), open = cardOpen(card);
    return `<div class="flex items-center gap-2"><h2 class="min-w-0 flex-1">` +
      `<button type="button" class="flex items-center gap-3 w-full min-h-[56px] text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" ` +
      `data-ps-act="toggle" data-card="${card}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="psFs-${card}">` +
      `<span class="${c.listIcon} ${tone}">${icon(iconName)}</span>` +
      `<span class="min-w-0 flex-1"><span id="psTitle-${card}" class="block ${c.titleCard}">${esc(TITLES[card])}</span>` +
      `<span class="block ${c.textMeta} break-words" data-ps-summary-line="${card}">${esc(summaryLine(card))}</span></span>` +
      icon(open ? 'chevron-up' : 'chevron-down', 'w-5 h-5 shrink-0 text-ink-400') + `</button></h2>` +
      (isDirty(card) ? `<span class="shrink-0" data-ps-dirty="${card}">${C.Kit.pill(MSG.unsaved, 'pending')}</span>` : '') + `</div>` +
      (open ? `<p class="${c.textMeta}" data-ps-hint="${card}">${esc(hint)}</p>` : '');
  }
  const HEADS = {
    skills: () => sectionHead('skills', 'users', k().listIconBrand, MSG.notSetMeaning + ' — ' + MSG.skillsHint),
    assistants: () => sectionHead('assistants', 'user', k().listIconInfo, 'ผู้ช่วยที่จับคู่กับเทค Portable และเวรกลางวัน ER/IPD'),
    holidays: () => sectionHead('holidays', 'calendar-off', k().listIconDanger, 'วันหยุดนักขัตฤกษ์ — ไม่จัดสาย Portable และเวรกลางวัน'),
    mission: () => sectionHead('mission', 'phone', k().listIconLilac, MSG.missionHint),
    aliases: () => sectionHead('aliases', 'message', k().listIconSun, MSG.aliasHint),
    priority: () => sectionHead('priority', 'sort', k().listIconNeutral, 'ใช้ตอนระบบเสนอคนลง Station ในแต่ละวัน'),
    pairs: () => sectionHead('pairs', 'swap', k().listIconDanger, MSG.pairsHint)
  };

  function errorLine(card) {
    const e = st.error[card];
    return `<p class="${k().fieldError}${e && e.msg ? '' : ' hidden'}" role="alert" data-ps-error="${card}">` +
      (e && e.msg ? icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5') + `<span class="min-w-0 break-words">${esc(e.msg)}</span>` : '') + `</p>`;
  }
  function addErrorLine(card) {
    const m = st.addError[card];
    return `<p class="${k().fieldError}${m ? '' : ' hidden'}" role="alert" data-ps-add-error="${card}">` +
      (m ? icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5') + `<span class="min-w-0 break-words">${esc(m)}</span>` : '') + `</p>`;
  }
  function foot(card) {
    const c = k(), busy = !!st.busy[card], dirty = isDirty(card);
    return errorLine(card) +
      `<div class="flex flex-wrap gap-2">` +
      (dirty && !busy ? `<button type="button" class="${c.btn} ${c.btnGhost} flex-1 whitespace-nowrap" data-ps-act="discard" data-card="${card}">ยกเลิกการแก้ไข</button>` : '') +
      `<button type="button" class="${c.btn} ${c.btnPrimary} flex-1 whitespace-nowrap" data-ps-act="save" data-card="${card}"` +
      (busy ? ' disabled aria-busy="true"' : dirty ? '' : ' disabled') + `>` +
      (busy ? 'กำลังบันทึก…' : icon('check') + (card === 'holidays' ? 'บันทึกวันหยุดปีนี้' : 'บันทึก')) + `</button></div>`;
  }

  function skillsBody() {
    const c = k(), marked = errNames('skills');
    const rows = staffNames().map(n => {
      const v = skillsOf(n);
      const changed = st.draft.skills && own(st.draft.skills, n) && json(v) !== json(storedSkills(n));
      const lock = v && v.length === 1
        ? `<span class="${c.tagBrand} gap-1" data-ps-lock="${esc(n)}">${icon('lock', 'w-3.5 h-3.5')}ประจำ ${esc(stationName(v[0]))}</span>` : '';
      return `<li class="flex items-center gap-3 py-2" data-ps-row="${esc(n)}">` + C.Kit.avatar(n, 'sm') +
        `<div class="min-w-0 flex-1"><p class="text-sm font-medium leading-6 text-ink-900 break-words">${esc(n)}` +
        (marked.indexOf(n) >= 0 ? ' <span class="text-coral-700">(ตรวจ)</span>' : '') + `</p>` +
        (lock ? `<p class="flex flex-wrap items-center gap-1.5">${lock}${changed ? `<span class="${c.tag}">แก้แล้ว</span>` : ''}</p>` :
          `<p class="${c.textMeta} break-words" data-ps-summary="${esc(n)}">${esc(skillsRowText(v))}` +
          (changed ? ` <span class="${c.tag}">แก้แล้ว</span>` : '') + `</p>`) + `</div>` +
        `<button type="button" class="${c.rowAction}" data-ps-act="skills-edit" data-name="${esc(n)}" aria-label="${esc('แก้ Station ที่ ' + n + ' อยู่ได้')}">` +
        `${icon('pencil')}<span>แก้ไข</span></button></li>`;
    }).join('');
    const notSet = notSetNames().length;
    return `<p class="${c.note}">${icon('lock', 'w-4 h-4 shrink-0 mt-1')}<span class="min-w-0">${esc(MSG.lockHint)}</span></p>` +
      `<button type="button" class="${c.btn} ${c.btnTonal} w-full" data-ps-act="skills-bulk"${notSet ? '' : ' disabled'}>${icon('users')}` +
      `ตั้งทุกคนที่ยังไม่ได้ตั้งเป็น… (${notSet} คน)</button>` +
      (rows ? `<ul class="divide-y divide-brand-100">${rows}</ul>` : `<p class="${c.textMeta}">ยังไม่มีรายชื่อบุคลากร</p>`);
  }

  function assistantsBody() {
    const c = k(), list = assistantsList(), marked = errNames('assistants');
    const activeNames = list.map(a => a.name);
    const removed = plan().assistants().filter(a => activeNames.indexOf(a.name) < 0).map(a => a.name);
    const staff = staffNames();
    // R3 FIX-CL L-16: staff and assistant names are separate namespaces — an assistant with a staff member's name is another
    // person (a grey note says so); the avatar never takes the staff member's picture (picture: false)
    const rows = list.map(a =>
      `<li class="flex items-center gap-3 py-2" data-ps-row="${esc(a.name)}">` + C.Kit.avatar(a.name, 'sm', { picture: false }) +
      `<div class="min-w-0 flex-1"><p class="text-sm font-medium leading-6 text-ink-900 break-words">${esc(a.name)}` +
      (marked.indexOf(a.name) >= 0 ? ' <span class="text-coral-700">(ซ้ำ)</span>' : '') + `</p>` +
      (a.note ? `<p class="${c.textMeta} break-words">${esc(a.note)}</p>` : '') +
      (staff.indexOf(a.name) >= 0 ? `<p class="${c.textCaption}" data-ps-same-name>${esc(MSG_SAME_NAME)}</p>` : '') + `</div>` +
      `<button type="button" class="${c.rowAction}" data-ps-act="asst-remove" data-name="${esc(a.name)}" aria-label="${esc('นำ ' + a.name + ' ออกจากรายชื่อผู้ช่วย')}">` +
      `${icon('trash')}<span>นำออก</span></button></li>`).join('');
    return (rows ? `<ul class="divide-y divide-brand-100">${rows}</ul>` : `<p class="${c.textMeta}" data-ps-empty="assistants">ยังไม่มีรายชื่อผู้ช่วย</p>`) +
      `<div class="space-y-2 pt-1">` +
      `<label for="psAsstName" class="${c.label}">เพิ่มผู้ช่วย</label>` +
      `<input type="text" id="psAsstName" class="${c.input}" data-ps-in="asstName" maxlength="40" autocomplete="off" placeholder="ชื่อผู้ช่วย" value="${esc(st.add.asstName)}">` +
      `<input type="text" id="psAsstNote" class="${c.input}" data-ps-in="asstNote" maxlength="${LIMITS.assistantNote}" autocomplete="off" placeholder="หมายเหตุ (ถ้ามี)" aria-label="หมายเหตุของผู้ช่วย" value="${esc(st.add.asstNote)}">` +
      addErrorLine('assistants') +
      `<button type="button" class="${c.btn} ${c.btnTonal} w-full" data-ps-act="asst-add">${icon('user')}เพิ่มผู้ช่วย</button></div>` +
      (removed.length ? `<details class="group"><summary class="flex items-center gap-3 w-full min-h-[44px] py-2 cursor-pointer select-none text-left text-sm font-medium leading-6 text-ink-800 focus-visible:outline-none focus-visible:bg-brand-50">` +
        `<span class="flex-1">ผู้ช่วยที่นำออกแล้ว (${removed.length})</span>${icon('chevron-down', c.disclosureChevron)}</summary>` +
        `<ul class="divide-y divide-brand-100">` + removed.map(n =>
          `<li class="flex items-center gap-3 py-2"><span class="min-w-0 flex-1 text-sm leading-6 text-slate-700 break-words">${esc(n)}</span>` +
          `<button type="button" class="${c.rowAction}" data-ps-act="asst-return" data-name="${esc(n)}" aria-label="${esc('นำ ' + n + ' กลับเข้ารายชื่อผู้ช่วย')}">` +
          `${icon('refresh')}<span>นำกลับ</span></button></li>`).join('') + `</ul></details>` : '');
  }

  function holidaysBody() {
    const c = k(), y = st.year, min = thisYear() - 1, max = thisYear() + 2;
    const head = `<div class="flex items-center justify-between gap-2">` +
      `<button type="button" class="${c.iconBtnRound}" data-ps-act="year" data-step="-1" aria-label="ปีก่อนหน้า"${y <= min ? ' disabled' : ''}>${icon('chevron-left')}</button>` +
      `<p class="font-display text-base font-medium leading-6 text-ink-900 tabular-nums" data-ps-year="${y}">${esc(beYear(y))}</p>` +
      `<button type="button" class="${c.iconBtnRound}" data-ps-act="year" data-step="1" aria-label="ปีถัดไป"${y >= max ? ' disabled' : ''}>${icon('chevron-right')}</button></div>`;
    if (!yearLoaded(y)) {
      if (st.yearLoad[y] === 'fail') {
        return head + `<div class="${c.banner} ${c.bannerWarn}" data-ps-year-error>${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}` +
          `<div class="min-w-0 flex-1 space-y-2"><p>โหลดวันหยุดของปีนี้ไม่สำเร็จ</p>` +
          `<button type="button" class="${c.btn} ${c.btnSecondary}" data-ps-act="year-retry">${icon('refresh')}ลองอีกครั้ง</button></div></div>`;
      }
      return head + C.Kit.skeleton(3);
    }
    const list = holidaysOf(y).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const rows = list.map(h =>
      `<li class="flex items-center gap-3 py-2" data-ps-row="${esc(h.date)}">` +
      `<div class="min-w-0 flex-1"><p class="text-sm font-medium leading-6 text-ink-900 tabular-nums">${esc(U().thaiDateShort(h.date, { weekday: true }))}</p>` +
      `<p class="${c.textMeta} break-words">${esc(h.name || '(ไม่มีชื่อ)')}</p></div>` +
      `<button type="button" class="${c.rowAction}" data-ps-act="hol-remove" data-date="${esc(h.date)}" aria-label="${esc('ลบวันหยุด ' + U().thaiDateShort(h.date))}">` +
      `${icon('trash')}<span>ลบ</span></button></li>`).join('');
    return head +
      (rows ? `<ul class="divide-y divide-brand-100">${rows}</ul>` : `<p class="${c.textMeta}" data-ps-empty="holidays">ยังไม่มีวันหยุดของปีนี้</p>`) +
      `<div class="space-y-2 pt-1">` +
      `<label for="psHolDate" class="${c.label}">วันที่</label>` +
      `<input type="date" id="psHolDate" class="${c.input}" data-ps-in="holDate" min="${y}-01-01" max="${y}-12-31" value="${esc(st.add.holDate)}">` +
      `<label for="psHolName" class="${c.label}">ชื่อวันหยุด</label>` +
      `<input type="text" id="psHolName" class="${c.input}" data-ps-in="holName" maxlength="${LIMITS.holidayName}" autocomplete="off" placeholder="เช่น วันขึ้นปีใหม่" value="${esc(st.add.holName)}">` +
      addErrorLine('holidays') +
      `<button type="button" class="${c.btn} ${c.btnTonal} w-full" data-ps-act="hol-add">${icon('calendar')}เพิ่มวันหยุด</button></div>`;
  }

  function missionBody() {
    const c = k(), list = missionList(), marked = errNames('mission');
    const inList = list.map(m => m.name);
    const rows = list.map((m, i) => {
      const bad = !phoneOk(m.phone);
      return `<li class="py-2 space-y-2" data-ps-row="${esc(m.name)}">` +
        // FIX-PS P-3: the name takes its own line when it does not fit next to the buttons (no break mid-word at 320 px)
        `<div class="flex flex-wrap items-center gap-2"><span class="flex items-center gap-2 min-w-0 max-w-full" data-ps-name="${esc(m.name)}">` +
        `<span class="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-full bg-lilac-100 text-lilac-700 text-sm font-semibold leading-5 tabular-nums" aria-label="${esc('ลำดับที่ ' + (i + 1))}">${i + 1}</span>` +
        `<span class="min-w-0 text-sm font-medium leading-6 text-ink-900 break-words">${esc(m.name)}` +
        (marked.indexOf(m.name) >= 0 ? ' <span class="text-coral-700">(ตรวจ)</span>' : '') + `</span></span>` +
        `<span class="flex items-center gap-1 ml-auto shrink-0">` +
        `<button type="button" class="${c.iconBtn}" data-ps-act="m-up" data-name="${esc(m.name)}" aria-label="${esc('เลื่อน ' + m.name + ' ขึ้น')}"${i === 0 ? ' disabled' : ''}>${icon('chevron-up')}</button>` +
        `<button type="button" class="${c.iconBtn}" data-ps-act="m-down" data-name="${esc(m.name)}" aria-label="${esc('เลื่อน ' + m.name + ' ลง')}"${i === list.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button>` +
        `<button type="button" class="${c.iconBtn}" data-ps-act="m-remove" data-name="${esc(m.name)}" aria-label="${esc('นำ ' + m.name + ' ออกจากรายชื่อภารกิจ')}">${icon('trash')}</button></span>` +
        `</div><div class="flex items-center gap-2 pl-7">${icon('phone', 'w-4 h-4 shrink-0 text-ink-400')}` +
        `<input type="tel" inputmode="tel" autocomplete="off" class="${c.input} min-w-0 flex-1" data-ps-phone="${esc(m.name)}" maxlength="20" placeholder="08x-xxx-xxxx" aria-label="${esc('เบอร์โทรของ ' + m.name)}"` +
        (bad ? ' aria-invalid="true"' : '') + ` value="${esc(m.phone)}"></div>` +
        `<p class="${c.fieldError} pl-7${bad ? '' : ' hidden'}" data-ps-phone-error="${esc(m.name)}">เบอร์โทรต้องเป็นตัวเลข 9–15 หลัก</p></li>`;
    }).join('');
    const others = staffNames().filter(n => inList.indexOf(n) < 0);
    const pick = others.indexOf(st.add.missionPick) >= 0 ? st.add.missionPick : '';
    return (rows ? `<ol class="divide-y divide-brand-100">${rows}</ol>` : `<p class="${c.textMeta}" data-ps-empty="mission">ยังไม่มีรายชื่อภารกิจพิเศษ</p>`) +
      `<div class="space-y-2 pt-1"><label for="psMissionPick" class="${c.label}">เพิ่มคน</label>` +
      `<select id="psMissionPick" class="${c.select}" data-ps-in="missionPick"><option value="">— เลือกชื่อ —</option>` +
      others.map(n => `<option value="${esc(n)}"${n === pick ? ' selected' : ''}>${esc(n)}</option>`).join('') + `</select>` +
      addErrorLine('mission') +
      `<button type="button" class="${c.btn} ${c.btnTonal} w-full" data-ps-act="m-add">${icon('users')}เพิ่มคน</button></div>`;
  }

  function aliasesBody() {
    const c = k(), marked = errNames('aliases');
    return `<ul class="divide-y divide-brand-100">` + staffNames().map(n => {
      const list = aliasesOf(n);
      const chips = list.map(a => {
        const bad = marked.indexOf(a) >= 0;
        return `<button type="button" class="${c.chip} ${bad ? 'bg-coral-50 border-coral-300 text-coral-700' : c.chipOff} max-w-full" data-ps-act="alias-remove" data-name="${esc(n)}" data-alias="${esc(a)}"` +
          (bad ? ' data-conflict="1"' : '') + ` aria-label="${esc('ลบชื่อเรียก "' + a + '" ของ ' + n)}">` +
          `<span class="min-w-0 break-words">${esc(a)}${bad ? ' (ซ้ำ)' : ''}</span>${icon('trash', 'w-4 h-4 shrink-0 text-ink-400')}</button>`;
      }).join('');
      return `<li class="py-2 space-y-2" data-ps-row="${esc(n)}"><div class="flex items-center gap-3">` + C.Kit.avatar(n, 'sm') +
        `<p class="min-w-0 flex-1 text-sm font-medium leading-6 text-ink-900 break-words">${esc(n)}</p>` +
        `<button type="button" class="${c.rowAction}" data-ps-act="alias-add" data-name="${esc(n)}" aria-label="${esc('เพิ่มชื่อเรียกของ ' + n)}"${list.length >= LIMITS.aliases ? ' disabled' : ''}>` +
        `${icon('pencil')}<span>เพิ่ม</span></button></div>` +
        (chips ? `<div class="flex flex-wrap gap-2 pl-[42px]">${chips}</div>` : '') + `</li>`;
    }).join('') + `</ul>`;
  }

  function priorityBody() {
    const c = k(), v = priorityValue();
    const movable = v.priority.filter(id => id !== 'supervisor');
    const rows = movable.map((id, i) =>
      `<li class="flex items-center gap-2 py-1 pl-3 pr-1 rounded-2xl bg-white border-2 border-brand-100" data-ps-row="${id}">` +
      `<span class="w-5 shrink-0 text-sm font-semibold leading-5 text-slate-500 tabular-nums">${i + 1}</span>${stationDot(id)}` +
      `<span class="min-w-0 flex-1 text-sm font-medium leading-6 text-ink-900 break-words">${esc(stationName(id))}</span>` +
      `<button type="button" class="${c.iconBtn}" data-ps-act="p-up" data-id="${id}" aria-label="${esc('เลื่อน ' + stationName(id) + ' ขึ้น')}"${i === 0 ? ' disabled' : ''}>${icon('chevron-up')}</button>` +
      `<button type="button" class="${c.iconBtn}" data-ps-act="p-down" data-id="${id}" aria-label="${esc('เลื่อน ' + stationName(id) + ' ลง')}"${i === movable.length - 1 ? ' disabled' : ''}>${icon('chevron-down')}</button></li>`).join('') +
      // FIX-PS P-3: never auto-filled (§0.10) — listed for completeness, not movable
      `<li class="flex items-center gap-2 min-h-[44px] py-1 pl-3 pr-3 rounded-2xl bg-ink-50 border-2 border-ink-100" data-ps-row="supervisor" data-fixed="1">` +
      `<span class="w-5 shrink-0" aria-hidden="true"></span>${stationDot('supervisor')}` +
      `<span class="min-w-0 flex-1 text-sm font-medium leading-6 text-slate-700 break-words">${esc(stationName('supervisor'))}</span>` +
      `<span class="${c.tag}">จัดเองเท่านั้น</span></li>`;
    const radio = (val, title, hint) => {
      const sel = v.slotOrder === val;
      return `<label class="flex items-start gap-3 p-3 min-h-[56px] rounded-2xl border-2 cursor-pointer ${sel ? c.tileOn : c.tileOff}">` +
        `<input type="radio" name="psSlotOrder" value="${val}" class="mt-1 w-5 h-5 shrink-0 accent-brand-600"${sel ? ' checked' : ''}>` +
        `<span class="min-w-0"><span class="block text-sm font-medium leading-6">${esc(title)}</span>` +
        `<span class="block ${c.textMeta}">${esc(hint)}</span></span></label>`;
    };
    return `<ol class="space-y-2">${rows}</ol>` +
      `<div class="space-y-2" role="radiogroup" aria-label="วิธีเติมคน"><p class="${c.label}">วิธีเติมคน</p>` +
      radio('coverage', 'เติม Station ที่ขาดมากที่สุดก่อน', 'ทุก Station มีคนก่อน แล้วจึงเติมตามลำดับด้านบน') +
      radio('priority', 'ตามลำดับเคร่งครัด', 'เติมให้ครบทีละ Station ตามลำดับด้านบน') + `</div>` +
      `<button type="button" class="${c.btn} ${c.btnSecondary} w-full" data-ps-act="counts">${icon('sliders')}จำนวนคนต่อ Station</button>`;
  }
  function pairsBody() {
    const c = k(), list = pairsList(), marked = errNames('pairs'), names = staffNames();
    // RV-1: while the current pairs are not known the list is not shown (it could be another role's) and nothing can change;
    // a local draft is kept and comes back with the data
    if (!pairsKnown()) return `<p class="${c.textMeta}" data-ps-pairs-loading role="status">กำลังโหลดข้อมูลล่าสุด…</p>`;
    const rows = list.map(p => {
      const key = p[0] + '|' + p[1];
      const bad = marked.indexOf(p[0]) >= 0 || marked.indexOf(p[1]) >= 0;
      return `<li class="flex items-center gap-3 py-2" data-ps-row="${esc(key)}">` +
        `<p class="min-w-0 flex-1 text-sm font-medium leading-6 text-ink-900 break-words">${esc(p[0])} <span class="text-slate-500">·</span> ${esc(p[1])}` +
        (bad ? ' <span class="text-coral-700">(ตรวจ)</span>' : '') + `</p>` +
        `<button type="button" class="${c.rowAction}" data-ps-act="pair-remove" data-a="${esc(p[0])}" data-b="${esc(p[1])}" aria-label="${esc('ลบคู่ ' + p[0] + ' กับ ' + p[1])}">` +
        `${icon('trash')}<span>ลบ</span></button></li>`;
    }).join('');
    const sel = (id, key, label) => {
      const cur = names.indexOf(st.add[key]) >= 0 ? st.add[key] : '';
      return `<div class="min-w-0 space-y-1"><label for="${id}" class="${c.label}">${label}</label>` +
        `<select id="${id}" class="${c.select}" data-ps-in="${key}"><option value="">— เลือกชื่อ —</option>` +
        names.map(n => `<option value="${esc(n)}"${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('') + `</select></div>`;
    };
    return (rows ? `<ul class="divide-y divide-brand-100">${rows}</ul>` : `<p class="${c.textMeta}" data-ps-empty="pairs">ยังไม่มีคู่ที่ห้ามอยู่ด้วยกัน</p>`) +
      `<div class="space-y-2 pt-1"><p class="${c.label}">เพิ่มคู่</p>` +
      `<div class="grid gap-2">` + sel('psPairA', 'pairA', 'คนที่ 1') + sel('psPairB', 'pairB', 'คนที่ 2') + `</div>` +
      addErrorLine('pairs') +
      `<button type="button" class="${c.btn} ${c.btnTonal} w-full" data-ps-act="pair-add">${icon('users')}เพิ่มคู่</button></div>`;
  }
  const BODIES = { skills: skillsBody, assistants: assistantsBody, holidays: holidaysBody, mission: missionBody, aliases: aliasesBody, priority: priorityBody, pairs: pairsBody };

  function errNames(card) { const e = st.error[card]; return e && Array.isArray(e.names) ? e.names : []; }

  /* ------------------------------------------------------------------ skeleton and render */
  function skeletonHtml() {
    const c = k();
    return `<div class="space-y-4 md:max-w-2xl md:mx-auto">` +
      `<div data-ps="state"></div>` +
      `<div data-ps="cards" class="space-y-4 hidden">` +
      `<p class="${c.textMeta} px-1" data-ps="intro">${esc(MSG.intro)}</p>` +
      `<p class="${c.dateCaption} hidden" data-ps="caption">${esc(MSG.cached)}</p>` +
      CARDS.map(card => `<section class="${c.card} space-y-3" data-ps-card="${card}" aria-labelledby="psTitle-${card}">` +
        `<div data-ps-part="head" class="space-y-2"></div><fieldset class="min-w-0 space-y-3" id="psFs-${card}" data-ps-fs="${card}">` +
        `<div data-ps-part="body" class="space-y-3"></div><div data-ps-part="foot" class="space-y-2"></div></fieldset></section>`).join('') +
      `</div></div>`;
  }
  function ensureBuilt() {
    if (built || !root) return;
    root.innerHTML = skeletonHtml();
    ref = { state: root.querySelector('[data-ps="state"]'), cards: root.querySelector('[data-ps="cards"]'), caption: root.querySelector('[data-ps="caption"]'), card: {} };
    CARDS.forEach(card => {
      const sec = root.querySelector('[data-ps-card="' + card + '"]');
      ref.card[card] = { sec, head: sec.querySelector('[data-ps-part="head"]'), body: sec.querySelector('[data-ps-part="body"]'),
        foot: sec.querySelector('[data-ps-part="foot"]'), fs: sec.querySelector('[data-ps-fs]') };
    });
    built = true;
  }
  function renderCard(card) {
    if (!built || !on() || !plan().ready()) return;
    const r = ref.card[card];
    if (!own(st.open, card) && isDirty(card)) st.open[card] = true;   // unsaved edits (e.g. after a reload) open their card
    const open = cardOpen(card);
    paint(r.head, HEADS[card]());
    C.setVisible(r.fs, open);
    if (open) { paint(r.body, BODIES[card]()); paint(r.foot, foot(card)); }
    r.fs.disabled = !!st.busy[card] || (card === 'pairs' && !pairsKnown());   // RV-1: add / remove / save wait for the pairs
  }
  /** After typing: head (pill) and foot (save button) follow; the body's cache is updated without rebuilding it. */
  function renderTyping(card) {
    if (!built || !on() || !plan().ready()) return;
    const r = ref.card[card];
    paint(r.head, HEADS[card]());
    if (!cardOpen(card)) return;
    paint(r.foot, foot(card));
    r.body.__psHtml = BODIES[card]();
  }
  function renderAll() {
    if (!built || !C) return;
    loadDrafts();
    if (!C.serverHas('plan')) {
      // FIX I-8: the same wording as เมนู's note (core.messages.serverV31); the spec's text when an older core lacks it
      const shared = C.messages && typeof C.messages.serverV31 === 'string' && C.messages.serverV31 ? C.messages.serverV31 : MSG.oldServer;
      paint(ref.state, C.Kit.empty({ icon: 'sliders', title: 'ยังเปิดระบบจัดเวรไม่ได้ (Code.gs 3.0)', hint: shared }));
      C.setVisible(ref.state, true);
      C.setVisible(ref.cards, false);
      return;
    }
    const p = plan();
    if (!p || !p.ready()) {
      const failed = p && !p.loading() && p.error();
      paint(ref.state, failed
        ? `<div class="${k().card} space-y-3" data-ps-load-error>` + C.Kit.empty({ icon: 'cloud-off', title: 'โหลดข้อมูลไม่สำเร็จ', hint: MSG.loadFailed }) +
          `<button type="button" class="${k().btn} ${k().btnSecondary} w-full" data-ps-act="reload">${icon('refresh')}ลองอีกครั้ง</button></div>`
        : `<div class="${k().card}" data-ps-loading><p class="${k().textMeta} pb-2">${esc(MSG.loading)}</p>${C.Kit.skeleton(4)}</div>`);
      C.setVisible(ref.state, true);
      C.setVisible(ref.cards, false);
      return;
    }
    C.setVisible(ref.state, false);
    C.setVisible(ref.cards, true);
    C.setVisible(ref.caption, !p.fresh());
    if (!yearLoaded(st.year)) ensureYear(st.year);
    CARDS.forEach(renderCard);
  }

  /* ------------------------------------------------------------------ holiday years */
  function ensureYear(year) {
    if (st.yearLoad[year] === 'loading' || st.yearLoad[year] === 'fail' || !on()) return;
    const r = plan().range();
    const day = !r || year > +r.to.slice(0, 4) ? year + '-01-01' : year + '-12-31';
    st.yearLoad[year] = 'loading';
    st.moved = true;
    const alive = C.alive();
    C.track(plan().ensure(day, day).then(ok => {
      if (!alive()) return;
      st.yearLoad[year] = ok ? '' : 'fail';
      if (built && C.current() === 'plan-settings') renderCard('holidays');
    }));
  }
  /** Leaving the screen: plan-data's range follows วันนี้ again (a holiday year may have moved it). */
  function restoreRange() {
    if (!st.moved || !on()) return;
    st.moved = false;
    const w = windowOfSelected();
    C.track(plan().ensure(w.from, w.to));
  }

  /* ------------------------------------------------------------------ edits */
  function editDraft(card, fn) {
    if (st.busy[card]) return;
    st.error[card] = null;
    st.open[card] = true;
    fn();
    tidy(card);
    renderCard(card);
  }

  function addAssistant() {
    const name = norm(st.add.asstName), note = norm(st.add.asstNote);
    const err = U().validateName(st.add.asstName);
    const list = assistantsList();
    let msg = '';
    if (!name) msg = 'กรุณากรอกชื่อผู้ช่วย';
    else if (err) msg = err.replace('ชื่อพนักงาน', 'ชื่อผู้ช่วย');
    else if (list.some(a => a.name === name)) msg = 'มี "' + name + '" ในรายชื่อผู้ช่วยแล้ว';
    else if (list.length >= LIMITS.assistants) msg = 'รายชื่อผู้ช่วยมีได้ไม่เกิน ' + LIMITS.assistants + ' คน';
    st.addError.assistants = msg;
    if (msg) { renderCard('assistants'); focusSel('#psAsstName'); return; }
    editDraft('assistants', () => {
      setDraft('assistants', list.concat([{ name, note }]));
      st.add.asstName = '';
      st.add.asstNote = '';
    });
    focusSel('#psAsstName');
  }
  function returnAssistant(name) {
    const old = plan().assistants().filter(a => a.name === name)[0];
    const list = assistantsList();
    if (list.some(a => a.name === name)) return;
    if (list.length >= LIMITS.assistants) { st.addError.assistants = 'รายชื่อผู้ช่วยมีได้ไม่เกิน ' + LIMITS.assistants + ' คน'; renderCard('assistants'); return; }
    editDraft('assistants', () => setDraft('assistants', list.concat([{ name, note: old ? old.note || '' : '' }])));
  }
  function removeAssistant(name) {
    editDraft('assistants', () => setDraft('assistants', assistantsList().filter(a => a.name !== name)));
  }

  function setYearList(year, list) {
    const d = Object.assign({}, st.draft.holidays || {});
    d[String(year)] = list;
    setDraft('holidays', d);
  }
  function addHoliday() {
    const y = st.year, date = st.add.holDate, name = norm(st.add.holName);
    const list = holidaysOf(y);
    let msg = '';
    if (!U().isValidYmd(date)) msg = 'กรุณาเลือกวันที่';
    else if (date.slice(0, 4) !== String(y)) msg = 'วันที่ต้องอยู่ในปี ' + beYear(y);
    else if (list.some(h => h.date === date)) msg = 'มีวันหยุดวันที่ ' + U().thaiDateShort(date) + ' แล้ว';
    else if (name.length > LIMITS.holidayName) msg = 'ชื่อวันหยุดยาวได้ไม่เกิน ' + LIMITS.holidayName + ' ตัวอักษร';
    else if (list.length >= LIMITS.holidays) msg = 'วันหยุดมีได้ไม่เกิน ' + LIMITS.holidays + ' วันต่อปี';
    st.addError.holidays = msg;
    if (msg) { renderCard('holidays'); focusSel(U().isValidYmd(date) ? '#psHolName' : '#psHolDate'); return; }
    editDraft('holidays', () => {
      setYearList(y, list.concat([{ date, name }]).sort((a, b) => (a.date < b.date ? -1 : 1)));
      st.add.holDate = '';
      st.add.holName = '';
    });
    focusSel('#psHolDate');
  }
  function removeHoliday(date) {
    editDraft('holidays', () => setYearList(st.year, holidaysOf(st.year).filter(h => h.date !== date)));
  }

  function moveIn(list, i, delta) {
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const out = list.slice();
    const t = out[i]; out[i] = out[j]; out[j] = t;
    return out;
  }
  function moveMission(name, delta) {
    const list = missionList().map(m => ({ name: m.name, phone: m.phone, from: m.from }));
    const i = list.findIndex(m => m.name === name);
    editDraft('mission', () => setDraft('mission', moveIn(list, i, delta)));
    refocus('[data-ps-act="' + (delta < 0 ? 'm-up' : 'm-down') + '"][data-name="' + cssEsc(name) + '"]', '[data-ps-row="' + cssEsc(name) + '"] button');
  }
  function addMission() {
    const name = st.add.missionPick;
    const list = missionList().map(m => ({ name: m.name, phone: m.phone, from: m.from }));
    if (!name || staffNames().indexOf(name) < 0 || list.some(m => m.name === name)) {
      st.addError.mission = 'กรุณาเลือกชื่อที่จะเพิ่ม';
      renderCard('mission');
      return;
    }
    st.addError.mission = '';
    const p = plan().profile(name);
    editDraft('mission', () => {
      setDraft('mission', list.concat([{ name, phone: fmtPhone(p ? p.phone : ''), from: fmtPhone(p ? p.phone : '') }]));
      st.add.missionPick = '';
    });
    focusSel('[data-ps-phone="' + cssEsc(name) + '"]');
  }
  function removeMission(name) {
    editDraft('mission', () => setDraft('mission', missionList().filter(m => m.name !== name).map(m => ({ name: m.name, phone: m.phone, from: m.from }))));
  }
  function typePhone(name, value) {
    if (st.busy.mission) return;
    const list = missionList().map(m => ({ name: m.name, phone: m.name === name ? value : m.phone, from: m.from }));
    st.error.mission = null;
    setDraft('mission', list);
    tidy('mission');
    // the field's own error line follows at once (no rebuild of the field)
    const ok = phoneOk(value);
    const input = root.querySelector('[data-ps-phone="' + cssEsc(name) + '"]');
    const line = root.querySelector('[data-ps-phone-error="' + cssEsc(name) + '"]');
    if (input) { if (ok) input.removeAttribute('aria-invalid'); else input.setAttribute('aria-invalid', 'true'); }
    if (line) line.classList.toggle('hidden', ok);
    renderTyping('mission');
  }

  async function addAlias(name) {
    if (st.busy.aliases) return;
    const alive = C.alive();
    const raw = await C.prompt('ชื่อเรียกอื่นของ ' + name + ' (เช่น ชื่อเล่น ที่ใช้ในข้อความแทนเวร)', '', { title: 'เพิ่มชื่อเรียกอื่น', maxLength: LIMITS.alias, okLabel: 'เพิ่ม' });
    if (!alive() || raw === null || raw === undefined || !on()) return;
    const alias = norm(raw);
    if (!alias) return;
    const msg = aliasProblem(name, alias, raw);
    if (msg) {
      st.error.aliases = { msg, names: [] };
      renderCard('aliases');
      C.toast('⚠️ ' + msg, 0, { error: true });
      return;
    }
    editDraft('aliases', () => {
      const d = Object.assign({}, st.draft.aliases || {});
      d[name] = aliasesOf(name).concat([alias]);
      setDraft('aliases', d);
    });
  }
  function aliasProblem(name, alias, raw) {
    const err = U().validateName(raw);
    if (err) return 'ชื่อเรียกอื่นไม่ถูกต้อง: ' + err.replace('ชื่อพนักงาน', 'ชื่อเรียก');
    if (alias.length > LIMITS.alias) return 'ชื่อเรียกอื่นยาวได้ไม่เกิน ' + LIMITS.alias + ' ตัวอักษร';
    if (staffNames().indexOf(alias) >= 0) return 'ชื่อเรียกอื่นซ้ำกับชื่อพนักงาน: "' + alias + '"';
    const mine = aliasesOf(name);
    if (mine.indexOf(alias) >= 0) return '"' + alias + '" เป็นชื่อเรียกของ ' + name + ' อยู่แล้ว';
    if (mine.length >= LIMITS.aliases) return 'ชื่อเรียกอื่นมีได้ไม่เกิน ' + LIMITS.aliases + ' ชื่อต่อคน';
    const other = staffNames().filter(n => n !== name && aliasesOf(n).indexOf(alias) >= 0)[0];
    if (other) return 'ชื่อเรียกอื่นนี้เป็นของคนอื่นอยู่แล้ว: "' + alias + '" (' + other + ')';
    return '';
  }
  function removeAlias(name, alias) {
    editDraft('aliases', () => {
      const d = Object.assign({}, st.draft.aliases || {});
      d[name] = aliasesOf(name).filter(a => a !== alias);
      setDraft('aliases', d);
    });
  }

  function movePriority(id, delta) {
    const v = priorityValue();
    const i = v.priority.indexOf(id);
    editDraft('priority', () => setDraft('priority', { priority: moveIn(v.priority, i, delta), slotOrder: v.slotOrder }));
    refocus('[data-ps-act="' + (delta < 0 ? 'p-up' : 'p-down') + '"][data-id="' + id + '"]', '[data-ps-row="' + id + '"] button');
  }
  function setSlotOrder(val) {
    const v = priorityValue();
    if (val !== 'coverage' && val !== 'priority') return;
    editDraft('priority', () => setDraft('priority', { priority: v.priority.slice(), slotOrder: val }));
  }

  function addPair() {
    if (!pairsKnown()) return;   // RV-1
    const a = st.add.pairA, b = st.add.pairB, names = staffNames(), list = pairsList();
    let msg = '';
    if (names.indexOf(a) < 0 || names.indexOf(b) < 0) msg = 'กรุณาเลือกชื่อทั้ง 2 คน';
    else if (a === b) msg = 'ต้องเลือก 2 คนที่ไม่ใช่คนเดียวกัน';
    else if (list.some(p => p[0] === normPair(a, b)[0] && p[1] === normPair(a, b)[1])) msg = 'มีคู่ ' + a + ' กับ ' + b + ' อยู่แล้ว';
    else if (list.length >= LIMITS.pairs) msg = 'ตั้งได้ไม่เกิน ' + LIMITS.pairs + ' คู่';
    st.addError.pairs = msg;
    if (msg) { renderCard('pairs'); return; }
    editDraft('pairs', () => {
      setDraft('pairs', cleanPairs(list.concat([normPair(a, b)])));
      st.add.pairA = '';
      st.add.pairB = '';
    });
    focusSel('#psPairA');
  }
  function removePair(a, b) {
    if (!pairsKnown()) return;   // RV-1
    editDraft('pairs', () => setDraft('pairs', pairsList().filter(p => !(p[0] === a && p[1] === b))));
  }

  function discard(card) {
    if (st.busy[card]) return;
    st.error[card] = null;
    st.addError[card] = '';
    if (card === 'holidays') {
      const d = Object.assign({}, st.draft.holidays || {});
      delete d[String(st.year)];
      setDraft('holidays', Object.keys(d).length ? d : null);
      tidy('holidays');
    } else setDraft(card, null);
    renderCard(card);
  }

  function openCounts() {
    if (typeof C.openStationCounts === 'function') { C.openStationCounts(); return; }
    // fallback for a core without it: the วันนี้ screen's own button opens the same modal
    const b = document.getElementById('stationCountsBtn');
    if (b) b.click();
  }

  /* ------------------------------------------------------------------ focus helpers */
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function focusSel(sel) {
    if (!root) return;
    const el = root.querySelector(sel);
    if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function refocus(sel, fallback) {
    if (!root) return;
    let el = root.querySelector(sel);
    if (!el || el.disabled) el = Array.prototype.filter.call(root.querySelectorAll(fallback), b => !b.disabled)[0];
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------------------ saving */
  /** Builds the card's single request → {error, names} | {send(plan) → Promise, ok(res) → toast text} | null (nothing to send). */
  function prepare(card) {
    const p = plan();
    if (card === 'skills') {
      const names = skillsDirtyNames();
      if (!names.length) return null;
      if (names.length > LIMITS.items) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LIMITS.items + ' คน' };
      return { send: () => p.setProfiles({ items: names.map(n => ({ name: n, patch: { skills: skillsOf(n) } })) }), ok: () => SAVED.skills };
    }
    if (card === 'assistants') {
      if (!assistantsDirty()) return null;
      const list = assistantsList().map(a => ({ name: a.name, note: norm(a.note) }));   // L-16: a staff name is allowed
      return { send: () => p.saveAssistants({ assistants: list }), ok: () => SAVED.assistants };
    }
    if (card === 'holidays') {
      const y = st.year;
      if (!holidaysDirty()) return null;
      const list = holidaysOf(y).map(h => ({ date: h.date, name: norm(h.name) })).sort((a, b) => (a.date < b.date ? -1 : 1));
      return { year: y, send: () => p.setHolidays({ year: y, holidays: list }), ok: res => holidaysSaved(y, res) };
    }
    if (card === 'mission') {
      if (!missionDirty()) return null;
      const list = missionList();
      const bad = list.filter(m => phoneEdited(m) && !phoneOk(m.phone)).map(m => m.name);
      if (bad.length) return { error: 'เบอร์โทรไม่ถูกต้อง (ตัวเลข 9–15 หลัก ขึ้นต้นด้วย + ได้): ' + bad.join(', '), names: bad };
      const items = [];
      list.forEach((m, i) => {
        const pr = p.profile(m.name);
        const patch = {};
        if (!pr || !pr.missionEligible) patch.missionEligible = true;
        if (!pr || pr.missionOrder !== i + 1) patch.missionOrder = i + 1;
        // FIX-PS P-2: only a phone the Supervisor changed in this draft (never the started-from value over a newer one)
        if (phoneEdited(m) && normPhone(m.phone) !== (pr ? pr.phone : '')) patch.phone = normPhone(m.phone);
        if (Object.keys(patch).length) items.push({ name: m.name, patch });
      });
      const inList = list.map(m => m.name);
      storedMission().forEach(m => { if (inList.indexOf(m.name) < 0) items.push({ name: m.name, patch: { missionEligible: false } }); });
      if (!items.length) return null;
      if (items.length > LIMITS.items) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LIMITS.items + ' คน' };
      return { send: () => p.setProfiles({ items }), ok: () => SAVED.mission };
    }
    if (card === 'aliases') {
      const names = aliasesDirtyNames();
      if (!names.length) return null;
      if (names.length > LIMITS.items) return { error: 'บันทึกได้ครั้งละไม่เกิน ' + LIMITS.items + ' คน' };
      return { send: () => p.setProfiles({ items: names.map(n => ({ name: n, patch: { aliases: aliasesOf(n) } })) }), ok: () => SAVED.aliases };
    }
    if (card === 'pairs') {
      if (!pairsKnown()) return null;   // RV-1: never replace the stored list from a copy that may not hold it
      if (!pairsDirty()) return null;
      const list = pairsList();
      return { send: () => p.setPlanSettings({ avoidPairs: list.map(q => q.slice()) }), ok: () => SAVED.pairs, check: pairsAnswered };
    }
    if (card === 'priority') {
      if (!priorityDirty()) return null;
      const v = priorityValue();
      return { send: () => p.setPlanSettings({ priority: v.priority.slice(), slotOrder: v.slotOrder }), ok: () => SAVED.priority };
    }
    return null;
  }

  /** A server that knows avoid pairs answers setPlanSettings with rules.avoidPairs (BK, R2-SPEC §0.27); an older one ignores
   *  the key and writes nothing — the edit must not look saved. */
  function pairsAnswered(res) { return !!(res && res.rules && Array.isArray(res.rules.avoidPairs)); }

  /** The success toast of a holiday year; months already generated whose holidays changed are named (R2-SPEC §4.5). */
  function holidaysSaved(year, res) {
    const saved = res && Array.isArray(res.holidays) ? res.holidays.map(h => h.date) : storedHolidays(year).map(h => h.date);
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const month = year + '-' + (m < 10 ? '0' : '') + m;
      const r = plan().roster(month);
      const cfg = r && r.monthPlan && r.monthPlan.config;
      if (!cfg || !Array.isArray(cfg.holidays)) continue;
      const now = saved.filter(d => d.slice(0, 7) === month).sort();
      if (json(cfg.holidays.slice().sort()) !== json(now)) months.push(U().thaiMonthYear(month));
    }
    return '✅ บันทึกวันหยุด' + beYear(year) + 'แล้ว' + (months.length ? ' — ' + MSG.holidaysChanged + ' (' + months.join(', ') + ')' : '');
  }

  async function save(card) {
    if (!on() || st.busy[card] || !C.isSup()) return;
    const prep = prepare(card);
    if (!prep) { tidy(card); renderCard(card); return; }
    if (prep.error) {
      st.error[card] = { msg: prep.error, names: prep.names || [] };
      renderCard(card);
      C.toast('⚠️ ' + prep.error, 0, { error: true });
      return;
    }
    if (!C.requireInternet()) return;
    const alive = C.alive();
    st.busy[card] = true;
    st.error[card] = null;
    renderCard(card);
    let res = null, err = null;
    try { res = await prep.send(); } catch (e) { err = e; }
    if (!err && prep.check && !prep.check(res)) err = { name: 'Unsupported', message: MSG.pairsUnsupported };
    if (!alive()) return;
    st.busy[card] = false;
    if (err) failed(card, err);
    else {
      if (card === 'holidays') {
        const d = Object.assign({}, st.draft.holidays || {});
        delete d[String(prep.year)];
        setDraft('holidays', Object.keys(d).length ? d : null);
      } else setDraft(card, null);
      C.toast(prep.ok(res), 4000);
    }
    if (built) renderCard(card);
  }

  /** The server knows newer data (VALIDATION / CONFLICT): a heartbeat now (core.refresh → versions.plan → getPlan), and the
   *  plan range again. Without core.refresh (older core) only the plan range is fetched again. */
  function refetch() {
    const p = plan();
    if (typeof C.refresh === 'function') C.track(Promise.resolve(C.refresh()));
    if (p) C.track(p.refresh());
  }

  function failed(card, e) {
    if (sessionError(e)) return;   // the core handles the session (logout / forced password change)
    let msg;
    if (e && e.name === 'Unsupported') {
      msg = e.message;
      C.toast('⚠️ ' + msg, 0, { error: true });
    } else if (!e || e.name !== 'ApiError') {
      msg = 'เกิดข้อผิดพลาด: ' + ((e && e.message) || String(e));
      C.toast(msg, 0, { error: true });
    } else if (C.Api.isTransient(e)) {
      msg = e.code === 'BUSY' ? e.message : MSG.netFail;
      C.handleError(e, { write: true });
    } else if (e.code === 'UNKNOWN_ACTION') {
      msg = MSG.noPlan;
      C.toast('⚠️ ' + msg, 0, { error: true });
    } else if (e.code === 'FORBIDDEN' || e.code === 'CONFLICT') {
      msg = e.message || 'บันทึกไม่สำเร็จ';
      C.handleError(e);   // toast + refresh (the role or the data changed elsewhere)
      if (e.code === 'CONFLICT') refetch();
    } else {
      msg = e.message || 'บันทึกไม่สำเร็จ';
      C.toast('⚠️ ' + msg, 0, { error: true });
      // e.g. an alias another device gave someone meanwhile: fetch the current data so the card shows it
      if (e.code === 'VALIDATION') refetch();
    }
    const names = e && e.details && Array.isArray(e.details.names) ? e.details.names.filter(n => typeof n === 'string') : [];
    st.error[card] = { msg, names };
  }

  /* ------------------------------------------------------------------ the skills sheet */
  function sheetHtml() {
    const c = k();
    return `<div class="${c.sheetFrame} uk-safe-b" data-sheet-panel>` +
      `<div class="${c.sheetGrabber}" aria-hidden="true"></div>` +
      `<div class="${c.sheetHead}"><h2 id="psSkillsTitle" class="flex-1 outline-none ${c.sheetTitle}" data-sheet-title tabindex="-1"></h2></div>` +
      `<div class="${c.sheetScroll}">` +
      `<p class="${c.textMeta}" data-ps-sheet-intro></p>` +
      `<div class="grid grid-cols-2 gap-2">` +
      `<button type="button" class="${c.tile} ${c.tileOff}" data-ps-skill="none" aria-pressed="false">ยังไม่ได้ตั้ง</button>` +
      `<button type="button" class="${c.tile} ${c.tileOff}" data-ps-skill="all" aria-pressed="false">ทุก Station</button></div>` +
      `<div class="grid grid-cols-2 gap-2" role="group" aria-label="Station">` +
      SKILL_IDS.map(id => `<label class="flex items-center gap-2.5 min-h-[44px] py-1 px-3 rounded-2xl border-2 border-ink-100 bg-white cursor-pointer">` +
        `<input type="checkbox" class="w-5 h-5 shrink-0 accent-brand-600" data-ps-skill="${id}">${stationDot(id)}` +
        `<span class="min-w-0 text-sm font-medium leading-5 text-ink-800 break-words">${esc(stationName(id))}</span></label>`).join('') +
      `</div>` +
      `<p class="${c.note}" data-ps-skill-summary aria-live="polite"></p>` +
      `<p class="${c.textCaption}">${esc(MSG.sheetLockHint)}</p></div>` +
      `<div class="${c.sheetActions}">` +
      `<button type="button" class="${c.btn} ${c.btnSecondary} flex-1" data-sheet-close data-ps-sheet-act="cancel">ยกเลิก</button>` +
      `<button type="button" class="${c.btn} ${c.btnPrimary} flex-1" data-ps-sheet-act="ok">ตกลง</button></div></div>`;
  }
  function ensureSheet() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    sheetEl = document.createElement('div');
    sheetEl.id = 'psSkillsSheet';
    sheetEl.className = k().sheetWrap + ' md:p-4';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'psSkillsTitle');
    sheetEl.innerHTML = sheetHtml();
    sheetEl.addEventListener('click', onSheetClick);
    sheetEl.addEventListener('change', onSheetChange);
    document.body.appendChild(sheetEl);
    return sheetEl;
  }
  /** name: one person; bulk: every person whose skills are not set (FIX-PS P-3) — one choice applied to all of them. */
  function openSkills(name, bulk) {
    if (!on() || st.busy.skills) return;
    const el = ensureSheet();
    if (bulk) {
      const names = notSetNames();
      if (!names.length) return;
      st.sheet = { bulk: true, names, skills: OPEN_BY_DEFAULT.slice() };
      el.querySelector('#psSkillsTitle').textContent = 'ตั้งทุกคนที่ยังไม่ได้ตั้ง (' + names.length + ' คน)';
      el.querySelector('[data-ps-sheet-intro]').textContent = 'เลือก Station ครั้งเดียว ใช้กับทุกคนที่ยังไม่ได้ตั้ง แล้วกด "บันทึก" ในการ์ด (ไม่รวม Prereview/Supervisor — จัดเองเท่านั้น)';
    } else {
      st.sheet = { bulk: false, name, skills: clone(skillsOf(name)) };
      el.querySelector('#psSkillsTitle').textContent = 'Station ที่ ' + name + ' อยู่ได้';
      el.querySelector('[data-ps-sheet-intro]').textContent = 'เลือก Station ที่ระบบเติมคนนี้ลงได้เมื่อเสนอการจัดคน (ไม่รวม Prereview/Supervisor — จัดเองเท่านั้น)';
    }
    C.setVisible(el.querySelector('button[data-ps-skill="none"]'), !bulk);
    syncSheet();
    C.Kit.sheet.open(el, { initialFocus: '[data-sheet-title]', onRequestClose: closeSkills });
  }
  function closeSkills() {
    st.sheet = null;
    if (sheetEl && C.Kit.sheet.isOpen(sheetEl)) C.Kit.sheet.close(sheetEl);
  }
  /** "ยังไม่ได้ตั้ง" means Portable + IPD + ER (R2-SPEC §0.26 b): those boxes show ticked, and the first change starts from them
   *  (FIX-PS P-1: ticking US on a not-set person gives four stations, never a lock on US). */
  function shownSkills(v) { return v === null ? OPEN_BY_DEFAULT.slice() : v; }
  function syncSheet() {
    if (!sheetEl || !st.sheet) return;
    const v = st.sheet.skills, ticks = shownSkills(v);
    const c = k();
    SKILL_IDS.forEach(id => { const cb = sheetEl.querySelector('input[data-ps-skill="' + id + '"]'); if (cb) cb.checked = ticks.indexOf(id) >= 0; });
    const tiles = { none: v === null, all: !!v && v.length === SKILL_IDS.length };
    Object.keys(tiles).forEach(key => {
      const b = sheetEl.querySelector('button[data-ps-skill="' + key + '"]');
      b.className = c.tile + ' ' + (tiles[key] ? c.tileOn : c.tileOff) + (key === 'none' && st.sheet.bulk ? ' hidden' : '');
      b.setAttribute('aria-pressed', tiles[key] ? 'true' : 'false');
    });
    const sum = sheetEl.querySelector('[data-ps-skill-summary]');
    const locked = !!v && v.length === 1;
    sum.className = locked ? LOCKED_NOTE : c.note;
    if (locked) sum.setAttribute('data-locked', '1'); else sum.removeAttribute('data-locked');
    sum.textContent = locked ? 'ประจำ ' + stationName(v[0]) + ' (ล็อก) — ระบบจะไม่ย้ายไป Station อื่นเอง' : skillsSummary(v);
  }
  function onSheetClick(e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-ps-skill],[data-ps-sheet-act]') : null;
    if (!t || !st.sheet) return;
    if (t.tagName === 'BUTTON' && t.hasAttribute('data-ps-skill')) {
      st.sheet.skills = t.getAttribute('data-ps-skill') === 'all' ? SKILL_IDS.slice() : null;
      syncSheet();
      return;
    }
    const act = t.getAttribute('data-ps-sheet-act');
    if (act === 'cancel') closeSkills();
    else if (act === 'ok') {
      const s = st.sheet, v = normSkills(s.skills);
      closeSkills();
      editDraft('skills', () => {
        const d = Object.assign({}, st.draft.skills || {});
        if (s.bulk) s.names.forEach(n => { if (skillsOf(n) === null) d[n] = v === null ? null : v.slice(); });
        else d[s.name] = v;
        setDraft('skills', d);
      });
      if (s.bulk) refocus('[data-ps-act="skills-bulk"]', '[data-ps-act="skills-edit"]');
      else refocus('[data-ps-act="skills-edit"][data-name="' + cssEsc(s.name) + '"]', '[data-ps-act="skills-edit"]');
    }
  }
  function onSheetChange(e) {
    const cb = e.target;
    if (!cb || cb.tagName !== 'INPUT' || !st.sheet) return;
    const id = cb.getAttribute('data-ps-skill');
    if (SKILL_IDS.indexOf(id) < 0) return;
    const cur = shownSkills(st.sheet.skills).slice();
    const next = cb.checked ? cur.concat(cur.indexOf(id) < 0 ? [id] : []) : cur.filter(x => x !== id);
    st.sheet.skills = normSkills(next);
    syncSheet();
  }

  /* ------------------------------------------------------------------ events */
  function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-ps-act]') : null;
    if (!b || !root || !root.contains(b) || b.disabled || !on()) return;
    const name = b.getAttribute('data-name') || '';
    switch (b.getAttribute('data-ps-act')) {
      case 'save': C.spawn(() => save(b.getAttribute('data-card'))); break;
      case 'discard': discard(b.getAttribute('data-card')); break;
      case 'reload': C.track(plan().refresh()); renderAll(); break;
      case 'skills-edit': openSkills(name); break;
      case 'skills-bulk': openSkills('', true); break;
      case 'toggle': {
        const cd = b.getAttribute('data-card');
        st.open[cd] = !cardOpen(cd);
        renderCard(cd);
        const t = root.querySelector('[data-ps-act="toggle"][data-card="' + cd + '"]');
        if (t) { try { t.focus({ preventScroll: true }); } catch (e2) { /* ignore */ } }
        break;
      }
      case 'asst-add': addAssistant(); break;
      case 'asst-remove': removeAssistant(name); break;
      case 'asst-return': returnAssistant(name); break;
      case 'year': {
        const y = st.year + (Number(b.getAttribute('data-step')) || 0);
        if (y < thisYear() - 1 || y > thisYear() + 2) break;
        st.year = y;
        st.addError.holidays = '';
        st.add.holDate = '';
        if (st.yearLoad[y] === 'fail') st.yearLoad[y] = '';
        if (!yearLoaded(y)) ensureYear(y);
        renderCard('holidays');
        break;
      }
      case 'year-retry': st.yearLoad[st.year] = ''; ensureYear(st.year); renderCard('holidays'); break;
      case 'hol-add': addHoliday(); break;
      case 'hol-remove': removeHoliday(b.getAttribute('data-date')); break;
      case 'm-up': moveMission(name, -1); break;
      case 'm-down': moveMission(name, 1); break;
      case 'm-remove': removeMission(name); break;
      case 'm-add': addMission(); break;
      case 'alias-add': C.spawn(() => addAlias(name)); break;
      case 'alias-remove': removeAlias(name, b.getAttribute('data-alias') || ''); break;
      case 'p-up': movePriority(b.getAttribute('data-id'), -1); break;
      case 'p-down': movePriority(b.getAttribute('data-id'), 1); break;
      case 'counts': openCounts(); break;
      case 'pair-add': addPair(); break;
      case 'pair-remove': removePair(b.getAttribute('data-a') || '', b.getAttribute('data-b') || ''); break;
      default: break;
    }
  }
  const IN_CARD = { asstName: 'assistants', asstNote: 'assistants', holDate: 'holidays', holName: 'holidays', missionPick: 'mission', pairA: 'pairs', pairB: 'pairs' };
  function onInput(e) {
    const t = e.target;
    if (!t || !root || !root.contains(t) || !on()) return;
    const key = t.getAttribute('data-ps-in');
    if (key && own(IN_CARD, key)) {
      st.add[key] = t.value;
      if (st.addError[IN_CARD[key]]) { st.addError[IN_CARD[key]] = ''; const line = root.querySelector('[data-ps-add-error="' + IN_CARD[key] + '"]'); if (line) { line.classList.add('hidden'); line.textContent = ''; } }
      renderTyping(IN_CARD[key]);
      return;
    }
    if (t.hasAttribute('data-ps-phone')) { typePhone(t.getAttribute('data-ps-phone'), t.value); return; }
    if (t.name === 'psSlotOrder' && e.type === 'change' && t.checked) setSlotOrder(t.value);
  }
  function onKey(e) {
    if (e.defaultPrevented || e.key !== 'Enter') return;
    const t = e.target, key = t && t.getAttribute ? t.getAttribute('data-ps-in') : '';
    if (key === 'asstName' || key === 'asstNote') { e.preventDefault(); addAssistant(); }
    else if (key === 'holName' || key === 'holDate') { e.preventDefault(); addHoliday(); }
  }

  /* ------------------------------------------------------------------ the own phone (service for the profile screen) */
  const myPhone = { value: null, busy: false, error: '' };
  function myPhoneRender(el) {
    if (!el || !C) return;
    if (!el.__psPhoneBound) {
      el.__psPhoneBound = true;
      el.addEventListener('input', ev => {
        if (ev.target && ev.target.id === 'psMyPhone') { myPhone.value = ev.target.value; myPhone.error = ''; }
      });
      el.addEventListener('click', ev => {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-ps-myphone-save]') : null;
        if (b && !b.disabled) C.spawn(() => myPhoneSave(el));
      });
    }
    const me = C.myName();
    if (!C.serverHas('plan') || !plan() || !me) { paint(el, ''); return; }
    const c = k(), pr = plan().profile(me), stored = pr ? pr.phone : '';
    const val = myPhone.value === null ? fmtPhone(stored) : myPhone.value;
    paint(el, `<div class="space-y-2" data-ps-myphone>` +
      `<label for="psMyPhone" class="${c.label}">เบอร์โทรของฉัน</label>` +
      `<input type="tel" inputmode="tel" autocomplete="tel" id="psMyPhone" class="${c.input}" maxlength="20" placeholder="08x-xxx-xxxx" value="${esc(val)}"${myPhone.busy ? ' disabled' : ''}>` +
      `<p class="${c.textCaption}">ทุกคนในทีมเห็นเบอร์นี้ (ใช้ในตารางภารกิจพิเศษ)</p>` +
      `<p class="${c.fieldError}${myPhone.error ? '' : ' hidden'}" role="alert" data-ps-myphone-error>${esc(myPhone.error)}</p>` +
      `<button type="button" class="${c.btn} ${c.btnSecondary} w-full" data-ps-myphone-save${myPhone.busy ? ' disabled aria-busy="true"' : ''}>` +
      (myPhone.busy ? 'กำลังบันทึก…' : icon('phone') + 'บันทึกเบอร์โทร') + `</button></div>`);
  }
  async function myPhoneSave(el) {
    const me = C.myName();
    if (!me || !on() || myPhone.busy) return;
    const input = el.querySelector('#psMyPhone');
    const raw = input ? input.value : (myPhone.value || '');
    if (!phoneOk(raw)) { myPhone.error = 'เบอร์โทรต้องเป็นตัวเลข 9–15 หลัก (ขึ้นต้นด้วย + ได้)'; myPhone.value = raw; myPhoneRender(el); return; }
    const pr = plan().profile(me);
    if (normPhone(raw) === (pr ? pr.phone : '')) { myPhone.value = null; myPhone.error = ''; myPhoneRender(el); return; }
    if (!C.requireInternet()) return;
    const alive = C.alive();
    myPhone.busy = true; myPhone.value = raw; myPhone.error = '';
    myPhoneRender(el);
    try {
      await plan().setProfiles({ items: [{ name: me, patch: { phone: normPhone(raw) } }] });
      if (!alive()) return;
      myPhone.value = null;
      C.toast('✅ บันทึกเบอร์โทรแล้ว');
    } catch (e) {
      if (!alive()) return;
      if (!sessionError(e)) myPhone.error = C.Api.isTransient(e) ? MSG.netFail : (e && e.message) || 'บันทึกไม่สำเร็จ';
    } finally {
      if (alive()) { myPhone.busy = false; myPhoneRender(el); }
    }
  }

  /* ------------------------------------------------------------------ registration */
  function resetState() {
    st.user = '';
    CARDS.forEach(card => { st.draft[card] = null; });
    st.busy = {};
    st.error = {};
    st.addError = {};
    st.add = { asstName: '', asstNote: '', holDate: '', holName: '', missionPick: '', pairA: '', pairB: '' };
    st.year = 0;
    st.yearLoad = {};
    st.moved = false;
    st.sheet = null;
    st.open = {};
    myPhone.value = null; myPhone.busy = false; myPhone.error = '';
  }

  App.register({
    id: 'plan-settings',
    title: 'ตั้งค่าการจัดเวร',
    icon: 'sliders',
    nav: { place: 'menu', section: 'sup', order: 50 },
    parent: 'menu',
    visible: c => c.isSup() && c.serverMode() === 'v3',

    init(c) {
      C = c;
      c.provide('plan.myPhone', Object.freeze({ render: myPhoneRender }));
    },

    mount(el) {
      root = el;
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onInput);
      root.addEventListener('keydown', onKey);
    },

    render(el) {
      root = el;
      ensureBuilt();
      renderAll();
    },

    show() {
      if (!st.year) st.year = thisYear();
      ensureBuilt();
      if (on()) { const w = windowOfSelected(); C.track(plan().ensure(w.from, w.to)); }
      renderAll();
    },

    hide() {
      closeSkills();
      restoreRange();
      st.yearLoad = {};
    },

    canLeave() {
      if (!on() || !plan().ready()) return true;
      const dirty = CARDS.filter(isDirty).map(card => TITLES[card]);
      return dirty.length ? MSG.leave(dirty) : true;
    },

    reset() {
      closeSkills();
      if (sheetEl && sheetEl.parentNode) sheetEl.parentNode.removeChild(sheetEl);
      sheetEl = null;
      resetState();
      if (root) root.innerHTML = '';
      built = false;
      ref = {};
    }
  });
})();
