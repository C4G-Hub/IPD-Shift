/* =====================================================================
 * js/feat-roster.js — feature "roster" (ตารางเวร), the daily proposal and the "ของฉันวันนี้" plan lines
 * (R2-SPEC §4.4, §0.11–§0.17, §0.24, §0.26; track RO). Data: core.use('plan') (js/plan-data.js) only — never getPlan or
 * the plan sheets directly. Engine: window.PlanEngine (pure).
 *
 *  - Screen 'roster' (bar, order 25, "ตารางเวร", icon table; visible only while core.serverHas('plan')). Header: month
 *    switcher "‹ ธันวาคม 2569 ›" and the segments ของฉัน · Portable · กลางวัน · ภารกิจ · คนประจำ (staff start on
 *    ของฉัน, the Supervisor on Portable). On show and on every month change: plan.ensure(month−1 … month+1) and
 *    core.ensureRange(month) (leaves for the "ลา" tags and for generation).
 *    Tables (table-fixed, w-full, break-words; the wrapper may scroll on its own with a sticky date column, the page never
 *    does): Portable = date | สาย 1…L (tech over "ผช. …", working days, a weekday holiday is one muted row); กลางวัน =
 *    date | ER | IPD; ภารกิจ = every calendar day | คนที่ 1 | คนที่ 2 (name + formatted phone + a 44 px tel: button).
 *    Today's row is highlighted, my cells carry data-mine, a name with a blocking leave gets a coral "ลา" tag
 *    (PlanEngine.dutyConflicts), deleted staff "(ลบแล้ว)". ของฉัน = agenda of my stored duties of the month.
 *    States: loading (skeleton, data-loading) · not on this device (retry) · offline copy (caption) · no roster · roster
 *    without duties · staff vs Supervisor. Staff see stored data only; drafts are the Supervisor's (§0.24).
 *  - Supervisor: roster editor (คนประจำ: ordered rows ↑ ↓ remove, "เพิ่มคน", Portable assistant per tech, ER/IPD lunch
 *    assistants, "คัดลอกจากเดือนก่อน", lock badge "ประจำ <Station>" for people whose skills hold one station, §0.26; a month
 *    without a stored roster starts pre-filled with the active locked people — a view until the first edit) → saveRoster
 *    (CONFLICT asks "บันทึกทับ" / "ดูรายชื่อล่าสุด"). Generation sheet "สร้างตารางเวรอัตโนมัติ": the whole month while no
 *    duty is stored, else "ตั้งแต่วันที่" (default max(today, 1st); earlier days are frozen), the "ต่อจากเดือนก่อน"
 *    checkbox only when PlanEngine.suggestOffsets ≠ 0 → generateMonthDuties → a duty draft. Per-cell edit sheet (native
 *    selects, "หาคนแทน" = lunchPick / suggestMissionSubstitute) → the draft. "บันทึก" = one saveDuties (+ monthPlan after
 *    a generation); CONFLICT drops only the dates the server reports (their current rows are shown) and keeps the rest of
 *    the draft; warnings are toasted. Drafts live in core.store.draft ('roster:<month>', 'duties:<month>'); canLeave asks
 *    before leaving (leaving drops them and puts the plan range back around the selected date). A sticky bottom bar holds
 *    "ยกเลิกร่าง" / "บันทึก" while a draft exists (always in the ประจำ Station editor, its save disabled without changes).
 *    Banners: draft (warnings grouped per kind), Portable-line leaves (soft), lunch/mission conflicts with leaves (coral,
 *    "ดู" lists them), holidays changed after generation, the next step after saving a roster.
 *  - Exports (everyone, stored data only): "ส่งออกเป็นรูป" (core.shareImage of an off-screen 420 px table with inline
 *    styles, ตารางเวร-<segment>-YYYY-MM.png) and "Excel (.xlsx)" (XlsxLite.saveTable: one sheet "ตารางเวร YYYY-MM",
 *    ตารางเวร-YYYY-MM.xlsx; text cells can never become formulas; the button is hidden while window.XlsxLite is missing).
 *  - core.station.setProposer(date → proposeDay(plan.proposalInput(date, 'fresh')) | null): null without a roster for
 *    the month or on a non-working day; memoised on the full engine input.
 *  - Panel 'proposal' (order 20) on วันนี้, Supervisor only, today or later: the active proposal (notes, unfilled,
 *    "บันทึกตามนี้", "เริ่มจากช่องว่าง" → "แสดงข้อเสนอ"); "เติมเฉพาะช่องว่าง" on a saved day / draft with empty slots
 *    (proposeDay mode 'fill' → station.applyToDraft); the lunch / mission repair of the stored duty ("เวรของวันนี้ที่ต้อง
 *    แก้", checkbox "บันทึกการแก้เวรพร้อมกัน", default on; the duty patch is set only while วันนี้ is the current screen).
 *  - core.provide('plan.myDay', (date, name) → lines): my line (resolveLines on a saved day, else the planned line), my
 *    lunch duty, my special mission with the partner and phone; stored duties only.
 * Every async flow runs through core.spawn / core.track and re-checks core.alive() after each await.
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !App.core || !window.PlanEngine) return;
  const PE = window.PlanEngine;

  const ID = 'roster';
  const SEGS = [
    { id: 'mine', label: 'ของฉัน' },
    { id: 'portable', label: 'Portable' },
    { id: 'lunch', label: 'กลางวัน' },
    { id: 'mission', label: 'ภารกิจ' },
    { id: 'roster', label: 'ประจำ Station' }   // FIX-RO R-7: "คนประจำ" is also the staff group
  ];
  const SEG_FILE = { portable: 'Portable', lunch: 'กลางวัน', mission: 'ภารกิจ' };
  const LUNCH = ['er', 'ipd'];
  const LUNCH_LABEL = { er: 'ER', ipd: 'IPD' };
  const MEMO_MAX = 30;
  const NOTE_MAX = 200;
  const MSG = {
    cached: 'ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)',
    staffNone: 'Supervisor ยังไม่ได้จัดตารางเวรของเดือนนี้',
    noRoster: 'ยังไม่ได้ตั้งคนประจำของเดือนนี้',
    noDuties: 'ยังไม่ได้สร้างตารางเวรของเดือนนี้',
    mineNone: 'ยังไม่มีตารางเวรของเดือนนี้',
    mineEmpty: 'เดือนนี้คุณไม่มีสาย Portable / เวรกลางวัน / ภารกิจพิเศษ',
    edited: 'แก้ในร่างแล้ว — กดบันทึกด้านล่างเพื่อให้ทุกคนเห็น',
    nextStep: 'ขั้นต่อไป: สร้างตารางเวรของเดือนนี้',
    settingsHint: 'ยังไม่ได้ตั้งผู้ช่วย/ภารกิจพิเศษ? ไปที่ เมนู → ตั้งค่าการจัดเวร',
    leave: 'มีร่างตารางเวรที่ยังไม่ได้บันทึก — ออกจากหน้านี้แล้วร่างจะถูกทิ้ง ต้องการออกหรือไม่?',
    dutyConflict: 'ตารางเวรบางวันถูกแก้ไขจากเครื่องอื่น',
    noProposal: 'ยังไม่มีข้อเสนอ — ตั้งคนประจำเดือนในแท็บตารางเวรก่อน'
  };
  /** Tag classes (complete recipes from UiKit.cls plus complete colour literals). */
  const LEAVE_TAG_TONE = 'bg-coral-50 border-coral-200 text-coral-700';

  let core = null;
  let root = null;
  let sheetEl = null;            // the feature's sheet (generation / cell edit), created on first use
  const ui = {
    month: '',                   // 'YYYY-MM' shown
    seg: '',                     // current segment id
    busy: '',                    // 'roster' | 'duties' | 'gen' | 'xlsx' | 'image' | ''
    showConflicts: false,
    sheet: null,                 // {kind: 'gen'} | {kind: 'edit', date, cell, key}
    suggest: '',                 // the hint under the edit sheet's picker ("หาคนแทน" result)
    scrollToday: false,          // FIX-RO R-7: scroll today's row into view after the next render of a table
    moved: false                 // FIX-RO R-1: the plan range was widened for another month (restored on hide)
  };
  const drafts = { roster: Object.create(null), duties: Object.create(null), loaded: Object.create(null) };
  const memo = new Map();        // proposer: date → {key, res}
  const repairOn = Object.create(null);   // date → false when the Supervisor unticked "บันทึกการแก้เวรพร้อมกัน"
  const fillNotes = Object.create(null);  // date → notes of the last "เติมเฉพาะช่องว่าง"
  const patchSet = Object.create(null);   // date → the duty patch THIS panel set (a foreign patch is never touched)

  /* ---------------------------------------------------------------- small helpers */
  const U = () => core.U;
  const K = () => core.Kit.cls;
  const esc = s => core.esc(s);
  const icon = (n, c) => core.Kit.icon(n, c);
  const today = () => U().todayStr();
  const hasOwn = Object.prototype.hasOwnProperty;
  function P() { const p = core && core.use('plan'); return p && typeof p === 'object' ? p : null; }
  function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function monthOf(date) { return String(date).slice(0, 7); }
  function rangeOf(month) { return U().monthRange(month); }
  function stationName(id) { const s = U().stationById(id); return s ? s.name : id; }
  function activeSet() { return new Set(core.staff().map(s => s.name)); }
  function activeAssistants() { const p = P(); return p ? p.assistants().filter(a => a.active).map(a => a.name) : []; }
  function nameLabel(n, act) { return n + ((act || activeSet()).has(n) ? '' : ' (ลบแล้ว)'); }
  function dayShort(date) { return U().thaiDateShort(date, { weekday: true, year: false }); }
  function dateCellLabel(date) {
    const d = U().parseYmd(date);
    return d ? U().THAI_WEEKDAYS_SHORT[d.getDay()] + ' ' + d.getDate() : date;
  }
  function weekday(date) { const d = U().parseYmd(date); return d ? d.getDay() : -1; }
  /** Months the server lets the Supervisor edit: this month − 2 … + 12 (R2-SPEC §0.23). */
  function editableMonth(m) {
    const now = monthOf(today());
    return m >= U().addMonths(now, -2) && m <= U().addMonths(now, 12);
  }
  function canEdit() { return core.isSup() && editableMonth(ui.month); }
  /** "0812345678" → "081-234-5678" (9 digits starting 0: "02-123-4567"); anything else as stored. */
  function phoneText(p) {
    const s = String(p || '').trim();
    const d = s.replace(/[^\d]/g, '');
    if (/^0\d{9}$/.test(d)) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    if (/^0\d{8}$/.test(d)) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
    return s;
  }
  function telHref(p) { const s = String(p || '').replace(/[^\d+]/g, ''); return s ? 'tel:' + s : ''; }
  function phoneOf(name) { const p = P(); const pr = p ? p.profile(name) : null; return pr ? pr.phone : ''; }
  /** §0.26: the station a person is locked to (skills = exactly one station), else null. */
  function lockedOf(name) {
    const p = P();
    if (!p) return null;
    if (typeof p.lockedStation === 'function') { try { return p.lockedStation(name) || null; } catch (e) { return null; } }
    const pr = p.profile(name);
    return pr && Array.isArray(pr.skills) && pr.skills.length === 1 ? pr.skills[0] : null;
  }
  /** §0.27: the avoid pairs ([[a, b]], Supervisor's plan data) whose both names are in `names`. */
  function avoidIn(names) {
    const p = P();
    if (!p || typeof p.avoidPairs !== 'function') return [];
    let pairs = [];
    try { pairs = p.avoidPairs() || []; } catch (e) { return []; }
    return pairs.filter(pr => Array.isArray(pr) && pr.length === 2 && names.indexOf(pr[0]) >= 0 && names.indexOf(pr[1]) >= 0);
  }
  function leaveOf(date, name) { const m = core.leavesOn(date); return m && m[name] ? m[name] : null; }
  function absentOn(date, name) { return !!name && core.isAbsent(leaveOf(date, name)); }
  function lunchBlocked(date, name) {
    if (!name) return false;
    const av = PE.availabilityOn(leaveRows(date), date);
    const p = av.partial.get(name);
    return av.absent.has(name) || (!!p && PE.timeOverlaps(p.start, p.end, PE.DEFAULT_LUNCH_WINDOW.start, PE.DEFAULT_LUNCH_WINDOW.end));
  }
  function leaveRows(date) { const p = P(); return p ? p.leaves(date, date) : []; }
  function sortedLines(lines) { return (Array.isArray(lines) ? lines : []).slice().sort((a, b) => a.line - b.line); }
  function lineCount(duties) {
    let n = core.state.stationCounts.portable || 3;
    duties.forEach(d => { if (d && Array.isArray(d.lines) && d.lines.length > n) n = d.lines.length; });
    return n;
  }

  /* ---------------------------------------------------------------- drafts (core.store.draft) */
  function loadDrafts(m) {
    if (drafts.loaded[m]) return;
    drafts.loaded[m] = true;
    const r = core.store.draft.get('roster:' + m);
    if (r && typeof r === 'object' && r.stations) drafts.roster[m] = r;
    const d = core.store.draft.get('duties:' + m);
    if (d && typeof d === 'object' && d.days && typeof d.days === 'object') drafts.duties[m] = d;
  }
  function rosterDraft(m) { if (!core.isSup()) return null; loadDrafts(m); return drafts.roster[m] || null; }
  function dutyDraft(m) { if (!core.isSup()) return null; loadDrafts(m); return drafts.duties[m] || null; }
  function setRosterDraft(m, d) {
    drafts.loaded[m] = true;
    if (d) drafts.roster[m] = d; else delete drafts.roster[m];
    core.store.draft.set('roster:' + m, d || null);
  }
  function setDutyDraft(m, d) {
    drafts.loaded[m] = true;
    if (d && (Object.keys(d.days).length || d.monthPlan)) drafts.duties[m] = d;
    else { d = null; delete drafts.duties[m]; }
    core.store.draft.set('duties:' + m, d || null);
  }
  function anyDraft() { return Object.keys(drafts.roster).length > 0 || Object.keys(drafts.duties).length > 0; }
  function dropAllDrafts() {
    Object.keys(drafts.roster).forEach(m => setRosterDraft(m, null));
    Object.keys(drafts.duties).forEach(m => setDutyDraft(m, null));
  }

  /* ---------------------------------------------------------------- duties as shown */
  /** The duty of a date as this user sees it: the Supervisor's draft day (when `withDraft`), else the stored one. */
  function viewDuty(date, withDraft) {
    const d = withDraft ? dutyDraft(monthOf(date)) : null;
    if (d && hasOwn.call(d.days, date)) return d.days[date];
    const p = P();
    return p ? p.duty(date) : null;
  }
  function monthDuties(m, withDraft) {
    const r = rangeOf(m);
    return U().eachDate(r.from, r.to).map(d => viewDuty(d, withDraft)).filter(Boolean);
  }
  function storedCount(m) { const p = P(); return p ? Object.keys(p.duties(m)).length : 0; }
  /** Conflicts of the shown duties with blocking leaves: Map key → reason. */
  function conflictsOf(m, withDraft) {
    const p = P();
    if (!p) return [];
    const r = rangeOf(m);
    try { return PE.dutyConflicts(monthDuties(m, withDraft), p.leaves(r.from, r.to)); } catch (e) { return []; }
  }
  function conflictKey(c) { return c.date + '|' + c.kind + '|' + (c.kind === 'line' ? c.line : c.kind === 'lunch' ? c.station : '') + '|' + c.name; }
  function toDutyParam(d, base) {
    return {
      date: d.date,
      lines: Array.isArray(d.lines) ? d.lines.map(l => ({ line: l.line, tech: l.tech || '', assistant: l.assistant || '' })) : null,
      lunch: d.lunch ? { er: slotOf(d.lunch.er), ipd: slotOf(d.lunch.ipd) } : null,
      mission: (Array.isArray(d.mission) ? d.mission : []).filter(Boolean).slice(0, 2),
      missionNext: d.missionNext || '',
      note: d.note || '',
      baseVersion: base | 0
    };
  }
  function slotOf(s) { return { tech: (s && s.tech) || '', assistant: (s && s.assistant) || '', base: (s && s.base) || '' }; }
  function plainDuty(d) {
    const x = toDutyParam(d, 0);
    delete x.baseVersion;
    return x;
  }

  /* ---------------------------------------------------------------- roster (editor model) */
  function emptyStations() { const o = {}; U().STATIONS.forEach(s => { o[s.id] = []; }); return o; }
  function fromStored(r) {
    const pairs = {};
    r.portableAsst.forEach(p => { if (p.tech && p.assistant) pairs[p.tech] = p.assistant; });
    const st = emptyStations();
    U().STATIONS.forEach(s => { st[s.id] = r.stations[s.id].slice(); });
    return { stations: st, pairs, erAsst: r.erAsst.slice(), ipdAsst: r.ipdAsst.slice(), note: r.note || '', baseVersion: r.version | 0 };
  }
  /** §0.26 (c): the active locked people in their stations (staff display order). */
  function prefill() {
    const st = emptyStations();
    core.staff().forEach(s => { const id = lockedOf(s.name); if (id && st[id]) st[id].push(s.name); });
    return { stations: st, pairs: {}, erAsst: [], ipdAsst: [], note: '', baseVersion: 0 };
  }
  /** What the editor shows for month m: {model, draft, stored, prefill}. */
  function rosterModel(m) {
    const p = P();
    const stored = p ? p.roster(m) : null;
    const d = rosterDraft(m);
    if (d) return { model: d, draft: true, stored: !!stored, prefill: false };
    if (stored) return { model: fromStored(stored), draft: false, stored: true, prefill: false };
    if (canEdit()) {
      const pf = prefill();
      return { model: pf, draft: false, stored: false, prefill: U().STATIONS.some(s => pf.stations[s.id].length) };
    }
    return { model: null, draft: false, stored: false, prefill: false };
  }
  function rosterBase(m) {
    const p = P();
    const stored = p ? p.roster(m) : null;
    return stored ? fromStored(stored) : prefill();
  }
  function editRoster(fn) {
    const m = ui.month;
    const cur = clone(rosterModel(m).model || prefill());
    fn(cur);
    // a tech's assistant goes with the tech: pairs only for rostered Portable techs
    Object.keys(cur.pairs).forEach(t => { if (cur.stations.portable.indexOf(t) < 0 || !cur.pairs[t]) delete cur.pairs[t]; });
    setRosterDraft(m, same(cur, rosterBase(m)) ? null : cur);
    core.render();
  }
  function rosterParams(m, model) {
    const stations = {};
    U().STATIONS.forEach(s => { stations[s.id] = model.stations[s.id].slice(); });
    return {
      month: m, stations,
      portableAsst: model.stations.portable.filter(t => model.pairs[t]).map(t => ({ tech: t, assistant: model.pairs[t] })),
      erAsst: model.erAsst.slice(), ipdAsst: model.ipdAsst.slice(), note: model.note || '', baseVersion: model.baseVersion | 0
    };
  }

  /* ---------------------------------------------------------------- the proposal (core.station.setProposer) */
  function keyOf(input) { return JSON.stringify(input, (k, v) => (v instanceof Map ? Array.from(v.entries()) : v)); }
  function proposer(date) {
    const p = P();
    if (!p || !core.isSup() || !core.serverHas('plan') || !U().isValidYmd(date)) return null;
    if (!p.roster(monthOf(date))) return null;
    if (!PE.isWorkingDay(date, p.holidays())) return null;
    const input = p.proposalInput(date, 'fresh');
    const key = keyOf(input);
    const hit = memo.get(date);
    if (hit && hit.key === key) return hit.res;
    let res = null;
    try {
      const r = PE.proposeDay(input);
      res = r && !(r.notes || []).some(n => n && n.code === 'NOT_WORKING_DAY') ? r : null;
    } catch (e) { console.error('[roster] proposeDay failed:', e); res = null; }
    memo.delete(date);
    memo.set(date, { key, res });
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value);
    return res;
  }

  /* ---------------------------------------------------------------- the stored duty's repair (lunch / mission) */
  /** Lunch counts per tech at station s over the stored days of the month before `date`. */
  function lunchCounts(date, s) {
    const p = P(), out = new Map();
    const ds = p.duties(monthOf(date));
    Object.keys(ds).forEach(d => {
      if (d >= date) return;
      const slot = ds[d].lunch && ds[d].lunch[s];
      if (slot && slot.tech) out.set(slot.tech, (out.get(slot.tech) || 0) + 1);
    });
    return out;
  }
  /** A lunch substitute for `date` at station s replacing `who` ('' when nobody is free). */
  function lunchSubstitute(date, s, who, base) {
    const p = P();
    const r = p.rosterFor(monthOf(date));
    const techs = r && Array.isArray(r[s]) ? r[s] : [];
    if (!techs.length) return '';
    let b = techs.indexOf(base || who);
    if (b < 0) b = Math.max(0, techs.indexOf(who));
    const pick = PE.lunchPick(techs, b, 0, n => n === who || lunchBlocked(date, n), lunchCounts(date, s));
    return pick.tech || '';
  }
  function missionSubstitute(date, names, who) {
    const p = P();
    const prev = p.duty(U().addDays(date, -1)), next = p.duty(U().addDays(date, 1));
    return PE.suggestMissionSubstitute({
      order: p.eligible().map(e => e.name), names, absent: who, isUnavailable: n => absentOn(date, n),
      prevNames: prev ? prev.mission : [], nextNames: next ? next.mission : []
    }) || '';
  }
  /** {items:[{kind, station?, name, reason, sub}], duty: Duty param | null} for the stored duty of `date`. */
  function repairOf(date) {
    const p = P();
    const stored = p ? p.duty(date) : null;
    if (!stored) return null;
    const list = PE.dutyConflicts([stored], p.leaves(date, date)).filter(c => c.kind === 'lunch' || c.kind === 'mission');
    if (!list.length) return null;
    const duty = toDutyParam(stored, stored.version);
    let changed = false;
    const items = list.map(c => {
      let sub = '';
      if (c.kind === 'lunch' && duty.lunch && duty.lunch[c.station]) {
        sub = lunchSubstitute(date, c.station, c.name, duty.lunch[c.station].base);
        if (sub) { duty.lunch[c.station].tech = sub; changed = true; }
      } else if (c.kind === 'mission') {
        sub = missionSubstitute(date, duty.mission, c.name);
        if (sub) { duty.mission = duty.mission.map(n => (n === c.name ? sub : n)); changed = true; }
      }
      return { kind: c.kind, station: c.station, name: c.name, reason: c.reason, sub };
    });
    return { items, duty: changed ? duty : null };
  }

  /* ---------------------------------------------------------------- plan.myDay (core's "ของฉันวันนี้") */
  function myDay(date, name) {
    const p = P();
    if (!p || !U().isValidYmd(date) || !name) return [];
    const duty = p.duty(date);
    if (!duty) return [];
    const out = [];
    const absent = absentOn(date, name);
    const tail = absent ? ' — แต่คุณมีวันลา' : '';
    const tone = t => (absent ? 'danger' : t);
    const lines = sortedLines(duty.lines);
    if (lines.length) {
      const day = core.state.days && core.state.days[date];
      const saved = !!day && day.assignments && U().STATIONS.some(st => (day.assignments[st.id] || []).length > 0);
      let l = null, sub = '';
      if (saved) {
        const r = PE.resolveLines(lines, day.assignments.portable || []);
        const i = r.workers.indexOf(name);
        if (i >= 0) { l = lines[i]; if (l.tech && l.tech !== name) sub = 'แทน ' + l.tech + ' · '; }
      } else {
        l = lines.filter(x => x.tech === name)[0] || null;
      }
      if (l) out.push({ icon: 'activity', tone: tone('brand'), main: 'Portable สาย ' + l.line + tail, sub: sub + 'ผู้ช่วย: ' + (l.assistant || '–') });
    }
    if (duty.lunch) {
      LUNCH.forEach(s => {
        const slot = duty.lunch[s];
        if (!slot || slot.tech !== name) return;
        const cover = slot.base && slot.base !== name ? ' · แทน ' + slot.base : '';
        out.push({ icon: 'clock', tone: tone('sun'), main: 'เวรกลางวัน ' + LUNCH_LABEL[s] + tail, sub: 'ผู้ช่วย: ' + (slot.assistant || '–') + cover });
      });
    }
    if ((duty.mission || []).indexOf(name) >= 0) {
      const mate = duty.mission.filter(n => n && n !== name)[0];
      // FIX-RO R-7 / I-7: the partner's phone is a tap-to-call link (core renders `tel`, digits / + only)
      const tel = mate ? String(phoneOf(mate) || '').replace(/[^\d+]/g, '') : '';
      out.push({ icon: 'phone', tone: tone('lilac'), main: 'ภารกิจพิเศษ' + tail, sub: mate ? 'คู่กับ ' + mate : (date === today() ? 'วันนี้' : 'วันนั้น') + 'มีคุณคนเดียว', tel });
    }
    return out;
  }

  /* ---------------------------------------------------------------- screen: frame */
  function segList() { return SEGS; }
  function defaultSeg(c) { return c.isSup() ? 'portable' : 'mine'; }
  function ensureMonth(c) {
    const p = P();
    if (!p || !c.serverHas('plan') || !ui.month) return;
    const m = ui.month, r = rangeOf(m);
    const from = U().addMonths(m, -1) + '-01', to = rangeOf(U().addMonths(m, 1)).to;
    ui.moved = true;
    c.spawn(() => p.ensure(from, to), { quiet: true });
    c.spawn(() => c.ensureRange(r.from, r.to), { quiet: true });
  }
  /**
   * FIX-RO R-1: leaving ตารางเวร puts the plan range back around the selected date (the selected month ± 1, as plan-data's
   * own window) — browsing far months reset it (≤ 186 days), which would leave วันนี้ without its plan data.
   */
  function restoreRange(c) {
    const p = P();
    if (!ui.moved || !p || !c.state.session) return;
    ui.moved = false;
    const sel = c.selectedDate() || today();
    const m = monthOf(sel);
    c.track(p.ensure(U().addMonths(m, -1) + '-01', rangeOf(U().addMonths(m, 1)).to));
  }
  function setMonth(c, m) {
    if (!m || m === ui.month) return;
    ui.month = m;
    ui.showConflicts = false;
    ui.scrollToday = true;
    ensureMonth(c);
    c.render();
  }

  function renderScreen(el, c) {
    const k = K();
    if (!c.state.user || !ui.month) { c.setHtml(el, `<div class="${k.card}">${c.Kit.skeleton(4)}</div>`); return; }
    const p = P();
    const m = ui.month, r = rangeOf(m);
    const covered = !!p && p.covers(r.from, r.to);
    const state = !p ? 'missing' : covered ? 'ready' : p.loading() || !p.error() ? 'loading' : 'missing';
    let html = headHtml(c);
    if (state === 'loading') {
      html += `<div class="${k.card}" data-loading="1">${c.Kit.skeleton(6)}</div>`;
    } else if (state === 'missing') {
      html += `<div class="${k.card}" data-roster-empty="missing">` + c.Kit.empty({ icon: 'cloud-off', title: 'ยังไม่มีข้อมูลตารางเวรของเดือนนี้ในเครื่อง', hint: 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' }) +
        `<div class="flex justify-center pb-2"><button type="button" class="${k.btn} ${k.btnSecondary}" data-roster-act="retry">${icon('refresh', 'w-5 h-5')}ลองใหม่</button></div></div>`;
    } else {
      if (!p.fresh()) html += `<p class="${k.textCaption} px-1" data-roster-cached>${esc(MSG.cached)}</p>`;
      html += bannersHtml(c);
      html += segHtml(c);
      html += barHtml(c);
    }
    c.setHtml(el, `<div class="space-y-3 md:max-w-3xl md:mx-auto" data-roster-screen data-seg="${esc(ui.seg)}" data-month="${esc(m)}" data-state="${state}">${html}</div>`);
    syncOffsets();
    if (state === 'ready') scrollToToday(el, c);
  }
  /** FIX-RO R-7: the tables (and the agenda) open at today's row in the current month — once per month / segment entry. */
  function scrollToToday(el, c) {
    if (!ui.scrollToday || c.current() !== ID) return;
    if (ui.month !== monthOf(today())) { ui.scrollToday = false; return; }
    if (!el.querySelector('[data-roster-table], [data-roster-agenda]')) return;   // no table yet (loading / empty): later
    ui.scrollToday = false;
    const row = el.querySelector('[data-roster-table] tr[data-today], [data-roster-agenda] [data-today]');
    if (row && typeof row.scrollIntoView === 'function') { try { row.scrollIntoView({ block: 'center' }); } catch (e) { row.scrollIntoView(); } }
  }
  /** The sticky bar sits above the bottom navigation on phones and near the bottom edge next to the rail (md:). */
  function barBottom() {
    const rail = typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches;
    const dock = document.getElementById('navDock');
    return rail || !dock ? 12 : dock.offsetHeight + 8;
  }
  /**
   * FIX-RO R-5: a sticky save bar at the bottom while a duty draft exists (Portable / กลางวัน / ภารกิจ / ของฉัน) and always in
   * the ประจำ Station editor (its บันทึก disabled without changes) — the only save is never far above the edit.
   */
  function barHtml(c) {
    if (!canEdit()) return '';
    const k = K();
    const m = ui.month;
    const wrap = (kind, inner) => `<div class="sticky z-20 flex items-center gap-2 p-2 rounded-2xl border-2 border-sun-200 bg-white/95 backdrop-blur shadow-lg shadow-ink-900/10" ` +
      `style="bottom:var(--roster-bar-bottom, 72px)" data-roster-bar="${kind}">${inner}</div>`;
    const pill = t => `<span class="flex-1 min-w-0 inline-flex items-center min-h-[28px] px-2.5 rounded-full border text-xs font-medium leading-4 bg-sun-100 border-sun-300 text-amber-800" data-roster-bar-pill>${esc(t)}</span>`;
    if (ui.seg === 'roster') {
      const info = rosterModel(m);
      if (!info.model) return '';
      const dirty = info.draft || (info.prefill && !info.stored);
      const busy = ui.busy === 'roster';
      return wrap('roster', (dirty ? pill('ประจำ Station · ยังไม่ได้บันทึก') : '<span class="flex-1"></span>') +
        (info.draft ? `<button type="button" class="${k.btn} ${k.btnSecondary} ${k.btnCompact} shrink-0" data-roster-act="rdiscard"${busy ? ' disabled' : ''}>ยกเลิก</button>` : '') +
        `<button type="button" class="${k.btn} ${dirty ? k.btnPrimary : k.btnSecondary} ${k.btnCompact} shrink-0" data-roster-act="rsave"${busy ? ' disabled aria-busy="true"' : !dirty ? ' disabled' : ''}>${busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>`);
    }
    const d = dutyDraft(m);
    if (!d) return '';
    const busy = ui.busy === 'duties';
    return wrap('duties', pill('ร่าง ' + Object.keys(d.days).length + ' วัน · ยังไม่ได้บันทึก') +
      `<button type="button" class="${k.btn} ${k.btnSecondary} ${k.btnCompact} shrink-0" data-roster-act="ddiscard"${busy ? ' disabled' : ''}>ยกเลิกร่าง</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} ${k.btnCompact} shrink-0" data-roster-act="dsave"${busy ? ' disabled aria-busy="true"' : ''}>${busy ? 'กำลังบันทึก…' : 'บันทึก'}</button>`);
  }

  function headHtml(c) {
    const k = K();
    const nav = (d, ic, label) => `<button type="button" class="${k.iconBtnRound}" data-roster-month="${d}" aria-label="${label}">${icon(ic, 'w-5 h-5')}</button>`;
    const chips = segList().map(s => {
      const on = s.id === ui.seg;
      return `<button type="button" class="${k.chip} ${on ? k.chipOn : k.chipOff} shrink-0" data-roster-seg="${s.id}" aria-pressed="${on}">${esc(s.label)}</button>`;
    }).join('');
    return `<div class="flex items-center gap-2">${nav(-1, 'chevron-left', 'เดือนก่อน')}` +
      `<h2 class="flex-1 min-w-0 text-center ${k.titleCard}" data-roster-month-title aria-live="polite">${esc(U().thaiMonthYear(ui.month))}</h2>` +
      `${nav(1, 'chevron-right', 'เดือนถัดไป')}</div>` +
      `<div class="flex gap-2 overflow-x-auto overscroll-x-contain pb-1" role="group" aria-label="มุมมองตารางเวร">${chips}</div>`;
  }

  /* ---------------------------------------------------------------- banners (Supervisor) */
  function bannersHtml(c) {
    if (!c.isSup()) return '';
    const k = K();
    const m = ui.month;
    let html = '';
    const d = dutyDraft(m);
    if (d) {
      const dates = Object.keys(d.days);
      const hol = P().holidays();
      // FIX-RO R-7: the count matches what the tables show — say so when holiday/weekend missions are part of it
      const offDays = dates.filter(x => !PE.isWorkingDay(x, hol)).length;
      const groups = warnGroups(Array.isArray(d.warnings) ? d.warnings : []);
      html += `<div class="${k.banner} ${k.bannerWarn}" data-roster-banner="draft">${icon('pencil', 'w-5 h-5 shrink-0 mt-0.5')}` +
        `<div class="min-w-0 flex-1"><p class="font-medium">ร่างตารางเวร — ยังไม่ได้บันทึก (${dates.length} วัน${offDays ? ' รวมภารกิจวันหยุด' : ''})</p>` +
        `<p class="${k.textMeta}">ทุกคนจะเห็นเมื่อกดบันทึกที่แถบด้านล่าง</p>` +
        (groups.length ? `<details class="group mt-1" data-roster-warnings><summary class="flex items-center gap-2 min-h-[44px] cursor-pointer select-none list-none">` +
          `<span class="flex-1">ข้อควรตรวจ ${groups.length} เรื่อง</span>${icon('chevron-down', k.disclosureChevron)}</summary>` +
          `<ul class="list-disc pl-5 space-y-1">${groups.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>` : '') +
        '</div></div>';
    }
    if (ui.seg !== 'roster') {
      const t = today();
      const all = conflictsOf(m, true).filter(x => x.date >= t);
      const lines = all.filter(x => x.kind === 'line');
      const list = all.filter(x => x.kind !== 'line');
      // FIX-RO R-7: a line tech on leave is normal (the daily proposal substitutes) — a soft note; coral only for lunch/mission
      if (lines.length) {
        const days = lines.map(x => x.date).filter((x, i, a) => a.indexOf(x) === i).length;
        html += `<div class="${k.banner} ${k.bannerInfo}" data-roster-banner="line-leave" data-count="${days}">${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}` +
          `<p class="min-w-0 flex-1">มี ${days} วันที่คนในสาย Portable ลา — ข้อเสนอจัดคนของวันนั้นจะหาคนแทนให้</p></div>`;
      }
      if (list.length) {
        html += `<div class="${k.banner} ${k.bannerDanger} flex-wrap" data-roster-banner="conflicts" data-count="${list.length}">${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}` +
          `<p class="min-w-0 flex-1">มี ${list.length} รายการในตารางเวรที่ตรงกับวันลา</p>` +
          `<button type="button" class="${k.btn} ${k.btnSecondary} ${k.btnCompact}" data-roster-act="conflicts" aria-expanded="${ui.showConflicts}">${ui.showConflicts ? 'ซ่อน' : 'ดู'}</button>`;
        if (ui.showConflicts) {
          html += `<ul class="w-full space-y-1" data-roster-conflict-list>` + list.map(x => {
            const what = x.kind === 'lunch' ? 'เวรกลางวัน ' + LUNCH_LABEL[x.station] : 'ภารกิจพิเศษ';
            const cell = x.kind === 'lunch' ? 'lunch:' + x.station : 'mission:' + Math.max(0, (viewDuty(x.date, true).mission || []).indexOf(x.name));
            const label = dayShort(x.date) + ' · ' + what + ' · ' + x.name + ' (' + x.reason + ')';
            return `<li><button type="button" class="w-full min-h-[44px] text-left rounded-xl px-2 py-1 active:bg-coral-100 ${k.wrapAnywhere}" data-roster-edit data-date="${esc(x.date)}" data-cell="${esc(cell)}"${canEdit() ? '' : ' disabled'}>${esc(label)}</button></li>`;
          }).join('') + '</ul>';
        }
        html += '</div>';
      }
      const p = P();
      const ro = p.roster(m);
      const mp = ro && ro.monthPlan && ro.monthPlan.config;
      if (mp && Array.isArray(mp.holidays)) {
        const r = rangeOf(m);
        const now = Array.from(p.holidays().keys()).filter(x => x >= r.from && x <= r.to).sort();
        if (!same(now, mp.holidays.slice().sort())) {
          html += `<div class="${k.banner} ${k.bannerWarn} flex-wrap" data-roster-banner="holidays">${icon('calendar', 'w-5 h-5 shrink-0 mt-0.5')}` +
            `<p class="min-w-0 flex-1">วันหยุดของเดือนนี้เปลี่ยนหลังสร้างตาราง — ตรวจสอบหรือสร้างใหม่ตั้งแต่วันที่…</p>` +
            (canEdit() ? `<button type="button" class="${k.btn} ${k.btnSecondary} ${k.btnCompact}" data-roster-act="gen-open">สร้างใหม่ตั้งแต่วันที่…</button>` : '') + '</div>';
        }
      }
    }
    return html;
  }
  /** "1–30 พ.ย." / "4 พ.ย." / "30 พ.ย.–2 ธ.ค." for a sorted list of dates. */
  function dateSpan(dates) {
    const a = dates[0], b = dates[dates.length - 1];
    if (!a) return '';
    if (a === b) return U().thaiDateShort(a, { year: false });
    if (a.slice(0, 7) === b.slice(0, 7)) return (+a.slice(8)) + '–' + U().thaiDateShort(b, { year: false });
    return U().thaiDateShort(a, { year: false }) + '–' + U().thaiDateShort(b, { year: false });
  }
  /** FIX-RO R-7: the engine warnings of a generation, one line per kind (with the number of days and their span). */
  function warnGroups(list) {
    const groups = [], byKey = Object.create(null);
    list.forEach(w => {
      const key = typeof w === 'string' ? 's:' + w : w && w.code ? w.code + '|' + (w.station || '') : '';
      if (!key) return;
      if (!byKey[key]) { byKey[key] = { w, dates: [], names: [] }; groups.push(byKey[key]); }
      const g = byKey[key];
      if (w && w.date && g.dates.indexOf(w.date) < 0) g.dates.push(w.date);
      if (w && w.name && g.names.indexOf(w.name) < 0) g.names.push(w.name);
    });
    return groups.map(g => {
      const w = g.w;
      if (typeof w === 'string') return w;
      const ds = g.dates.sort();
      const n = ds.length ? ' — ' + ds.length + ' วัน (' + dateSpan(ds) + ')' : '';
      switch (w.code) {
        case 'MISSION_SHORT': return 'ภารกิจพิเศษได้ไม่ครบ 2 คน' + n + ' · เพิ่มรายชื่อที่ ตั้งค่าการจัดเวร → ภารกิจพิเศษ';
        case 'LUNCH_VACANT': return 'เวรกลางวัน ' + (LUNCH_LABEL[w.station] || w.station) + ' ไม่มีคนว่าง' + n;
        case 'MISSING_STORED_DAY': return 'ไม่มีตารางที่บันทึกไว้ก่อนวันที่เริ่ม' + n;
        case 'ELIGIBLE_INACTIVE': return 'ไม่อยู่ในรายชื่อพนักงานแล้ว (ข้ามในภารกิจพิเศษ): ' + g.names.join(', ');
        default: return String(w.code) + n;
      }
    });
  }

  /* ---------------------------------------------------------------- segments */
  function segHtml(c) {
    if (ui.seg === 'roster') return rosterSegHtml(c);
    if (ui.seg === 'mine') return mineHtml(c);
    const k = K();
    const p = P();
    const m = ui.month;
    const sup = c.isSup();
    const hasDuties = storedCount(m) > 0 || (sup && !!dutyDraft(m));
    if (!hasDuties) {
      if (!sup) return emptyCard('staff-none', 'calendar', MSG.staffNone, '');
      if (!p.roster(m)) {
        return emptyCard('no-roster', 'users', MSG.noRoster, canEdit() ? 'ตั้งคนประจำของแต่ละ Station ก่อน แล้วจึงสร้างตารางเวร' : '',
          canEdit() ? `<button type="button" class="${k.btn} ${k.btnPrimary}" data-roster-act="go-roster">ตั้งคนประจำเดือน</button>` : '') + (canEdit() ? settingsHint() : '');
      }
      return emptyCard('no-duties', 'table', MSG.noDuties, canEdit() ? 'ระบบจัดสาย Portable เวรกลางวัน และภารกิจพิเศษให้ทั้งเดือน — ตรวจแล้วจึงบันทึก' : '',
        canEdit() ? `<button type="button" class="${k.btn} ${k.btnPrimary}" data-roster-act="gen-open">${icon('wand', 'w-5 h-5')}สร้างอัตโนมัติทั้งเดือน</button>` : '');
    }
    let html = '';
    if (canEdit()) {
      html += `<div class="flex flex-wrap gap-2 justify-end">` +
        (p.roster(m) ? `<button type="button" class="${k.btn} ${k.btnTonal}" data-roster-act="gen-open">${icon('wand', 'w-5 h-5')}${storedCount(m) ? 'สร้างใหม่ตั้งแต่วันที่…' : 'สร้างอัตโนมัติทั้งเดือน'}</button>` : '') +
        `</div>`;
    }
    html += ui.seg === 'portable' ? portableHtml(c) : ui.seg === 'lunch' ? lunchHtml(c) : missionHtml(c);
    if (sup && canEdit()) html += `<p class="${k.textMeta} px-1">แตะช่องในตารางเพื่อแก้ไข — การแก้ไขเป็นร่างจนกว่าจะกดบันทึก</p>`;
    html += exportsHtml(c);
    return html;
  }
  /** FIX-RO R-7: where assistants and the mission list are set (a link to เมนู → ตั้งค่าการจัดเวร). */
  function settingsHint() {
    const k = K();
    return `<div class="${k.note}" data-roster-settings-hint>${icon('sliders', 'w-5 h-5 shrink-0 mt-0.5')}<div class="min-w-0 flex-1"><p>${esc(MSG.settingsHint)}</p>` +
      `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact} -ml-3" data-roster-act="settings">เปิดตั้งค่าการจัดเวร${icon('chevron-right', 'w-4 h-4')}</button></div></div>`;
  }
  function emptyCard(kind, ic, title, hint, action) {
    const k = K();
    return `<div class="${k.card}" data-roster-empty="${kind}">` + core.Kit.empty({ icon: ic, title, hint }) +
      (action ? `<div class="flex justify-center pb-2">${action}</div>` : '') + '</div>';
  }
  function exportsHtml(c) {
    const k = K();
    const has = storedCount(ui.month) > 0;
    if (!has) return '';
    const b = (act, ic, label) => `<button type="button" class="${k.btn} ${k.btnSecondary}" data-roster-act="${act}"${ui.busy === act ? ' disabled aria-busy="true"' : ''}>${icon(ic, 'w-5 h-5')}${label}</button>`;
    return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-roster-exports>${b('image', 'image', 'ส่งออกเป็นรูป')}${window.XlsxLite ? b('xlsx', 'download', 'Excel (.xlsx)') : ''}</div>` +
      (c.isSup() && dutyDraft(ui.month) ? `<p class="${k.textMeta} px-1">ไฟล์ที่ส่งออกเป็นตารางที่บันทึกแล้วเท่านั้น (ไม่รวมร่าง)</p>` : '');
  }

  /** The cell markup common to the three tables. info: {date, cell, editable, main, sub, mine, leave, draft, deleted, extra}. */
  function cellHtml(info) {
    const k = K();
    const tags = (info.leave ? ` <span class="${k.inlineTag} ${LEAVE_TAG_TONE}" data-roster-leave title="${esc(info.leave)}">ลา</span>` : '');
    const main = info.main
      ? `<span class="block text-sm font-medium leading-5 ${info.mine ? 'text-brand-800' : 'text-ink-900'} ${k.wrapAnywhere}">${esc(info.main)}` +
        (info.cover ? ` <span class="font-normal text-slate-600" data-roster-cover>(${esc(info.cover)})</span>` : '') + `${tags}</span>`
      : `<span class="block text-sm leading-5 text-slate-400">–</span>`;
    const sub = info.sub ? `<span class="block text-[0.8125rem] leading-5 text-slate-600 ${k.wrapAnywhere}">${esc(info.sub)}</span>` : '';
    const body = main + sub + (info.extra || '');
    const attrs = ` data-cell="${esc(info.cell)}"` + (info.mine ? ' data-mine="1"' : '') + (info.draft ? ' data-draft="1"' : '');
    const tone = info.draft ? ' bg-sun-50' : info.mine ? ' bg-brand-50' : '';
    // info.below: markup under the content (the tel: link) — never inside the edit button
    const wrap = inner => inner + (info.below || '');
    if (info.editable) {
      return `<td class="p-0.5 align-top${tone}"${attrs}>` + wrap(`<button type="button" class="w-full min-h-[44px] text-left rounded-xl px-1.5 py-1 active:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" ` +
        `data-roster-edit data-date="${esc(info.date)}" data-cell="${esc(info.cell)}" aria-label="${esc(info.label)}">${body}</button>`) + '</td>';
    }
    return `<td class="px-1.5 py-1.5 align-top${tone}"${attrs}>${wrap(body)}</td>`;
  }
  function tableHtml(kind, cols, rows) {
    const k = K();
    // FIX-RO R-7: the header row stays visible under the app header while the month scrolls (the table never needs a
    // horizontal scroller — table-fixed + break-words — so its cells can stick to the page)
    const top = 'top:var(--roster-head-top, 0px)';
    const n = cols.length;
    return `<div class="rounded-3xl border-2 border-brand-100 bg-white" data-roster-table="${kind}">` +
      `<table class="table-fixed w-full border-collapse text-left"><colgroup><col style="width:52px">${cols.map(() => '<col>').join('')}</colgroup>` +
      `<thead><tr><th scope="col" class="sticky z-[1] bg-cream-50 rounded-tl-[22px] px-1.5 py-2 ${k.textCaption}" style="${top}">วันที่</th>` +
      cols.map((t, i) => `<th scope="col" class="sticky z-[1] bg-cream-50${i === n - 1 ? ' rounded-tr-[22px]' : ''} px-1.5 py-2 ${k.textCaption}" style="${top}">${esc(t)}</th>`).join('') +
      `</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function rowStart(date, extra) {
    const isToday = date === today();
    const wd = weekday(date);
    const bg = isToday ? 'bg-accent-50' : 'bg-white';
    const tone = wd === 0 || wd === 6 ? 'text-coral-700' : 'text-ink-800';   // R-7: Saturday like Sunday
    // R-7: today stays visible in a draft (whose cells are tinted): an accent edge and the word วันนี้
    const mark = isToday ? ' border-l-4 border-accent-400' : '';
    return `<tr class="border-t border-brand-100 ${bg}" data-date="${esc(date)}"${isToday ? ' data-today="1"' : ''}>` +
      `<th scope="row" class="${bg}${mark} px-1.5 py-1.5 align-top text-left font-display text-sm font-medium leading-5 tabular-nums ${tone}">${esc(dateCellLabel(date))}` +
      (isToday ? '<span class="block text-xs font-medium leading-4 text-accent-700">วันนี้</span>' : '') + `${extra || ''}</th>`;
  }
  /** The app header's bottom edge (fixed header; 0 where it scrolls away, e.g. a phone in landscape). */
  /**
   * Pre-release fix (re-review 2): the sticky offsets follow the layout — CSS variables on the screen's root, measured again
   * at every render, resize and orientation change (the markup itself never carries pixel offsets, so a rotation from the
   * rail layout to the phone layout needs no re-render).
   */
  function syncOffsets() {
    if (!root) return;
    const bar = barBottom() + 'px', top = headerBottom() + 'px';
    if (root.style.getPropertyValue('--roster-bar-bottom') !== bar) root.style.setProperty('--roster-bar-bottom', bar);
    if (root.style.getPropertyValue('--roster-head-top') !== top) root.style.setProperty('--roster-head-top', top);
  }
  function headerBottom() {
    const h = document.getElementById('appHeader');
    if (!h || !h.offsetHeight || window.getComputedStyle(h).position !== 'fixed') return 0;
    return Math.max(0, Math.round(h.getBoundingClientRect().bottom));
  }
  function draftDays(m) { const d = core.isSup() ? dutyDraft(m) : null; return d ? d.days : {}; }

  function portableHtml(c) {
    const p = P();
    const m = ui.month, r = rangeOf(m);
    const sup = c.isSup(), me = c.myName(), act = activeSet();
    const hol = p.holidays();
    const dd = draftDays(m);
    const duties = monthDuties(m, sup);
    const L = lineCount(duties);
    const conf = new Set(conflictsOf(m, sup).map(conflictKey));
    const edit = canEdit();
    const cols = [];
    for (let i = 1; i <= L; i++) cols.push('สาย ' + i);
    const rows = [];
    U().eachDate(r.from, r.to).forEach(date => {
      const wd = weekday(date);
      if (wd === 0 || wd === 6) return;
      const duty = viewDuty(date, sup);
      const lines = duty ? sortedLines(duty.lines) : [];
      const holName = hol.has(date) ? hol.get(date) : null;
      if (holName !== null && !lines.length) {
        rows.push(rowStart(date) + `<td colspan="${L}" class="px-2 py-2 text-[0.8125rem] leading-5 text-slate-500" data-holiday="1">${esc('วันหยุด' + (holName ? ' · ' + holName : ''))}</td></tr>`);
        return;
      }
      const holTag = holName !== null ? `<span class="block ${K().textCaption}">วันหยุด</span>` : '';
      let tr = rowStart(date, holTag);
      for (let i = 1; i <= L; i++) {
        const l = lines.filter(x => x.line === i)[0] || null;
        const tech = l ? l.tech : '';
        tr += cellHtml({
          date, cell: 'line:' + i, editable: edit && sup && !!duty,
          label: 'แก้ไข สาย ' + i + ' · ' + dayShort(date),
          main: tech ? nameLabel(tech, act) : '', sub: l && l.assistant ? 'ผช. ' + l.assistant : '',
          mine: !!tech && tech === me, leave: tech && conf.has(date + '|line|' + i + '|' + tech) ? (leaveOf(date, tech) || {}).type || 'ลา' : '',
          draft: hasOwn.call(dd, date)
        });
      }
      rows.push(tr + '</tr>');
    });
    return tableHtml('portable', cols, rows);
  }

  function lunchHtml(c) {
    const p = P();
    const m = ui.month, r = rangeOf(m);
    const sup = c.isSup(), me = c.myName(), act = activeSet();
    const hol = p.holidays();
    const dd = draftDays(m);
    const conf = new Set(conflictsOf(m, sup).map(conflictKey));
    const edit = canEdit();
    const rows = [];
    U().eachDate(r.from, r.to).forEach(date => {
      const wd = weekday(date);
      if (wd === 0 || wd === 6) return;
      const duty = viewDuty(date, sup);
      const holName = hol.has(date) ? hol.get(date) : null;
      if (holName !== null && !(duty && duty.lunch)) {
        rows.push(rowStart(date) + `<td colspan="2" class="px-2 py-2 text-[0.8125rem] leading-5 text-slate-500" data-holiday="1">${esc('วันหยุด' + (holName ? ' · ' + holName : ''))}</td></tr>`);
        return;
      }
      let tr = rowStart(date);
      LUNCH.forEach(s => {
        const slot = duty && duty.lunch ? duty.lunch[s] : null;
        const tech = slot ? slot.tech : '';
        const cover = slot && slot.base && tech && slot.base !== tech ? 'แทน ' + slot.base : '';
        tr += cellHtml({
          date, cell: 'lunch:' + s, editable: edit && sup && !!duty,
          label: 'แก้ไข เวรกลางวัน ' + LUNCH_LABEL[s] + ' · ' + dayShort(date),
          main: tech ? nameLabel(tech, act) : '', cover, sub: slot && slot.assistant ? 'ผช. ' + slot.assistant : '',
          mine: !!tech && tech === me, leave: tech && conf.has(date + '|lunch|' + s + '|' + tech) ? (leaveOf(date, tech) || {}).type || 'ลา' : '',
          draft: hasOwn.call(dd, date)
        });
      });
      rows.push(tr + '</tr>');
    });
    return `<p class="${K().textMeta} px-1" data-roster-lunch-time>เวรกลางวัน 12:00–13:00 น.</p>` + tableHtml('lunch', ['ER', 'IPD'], rows);
  }

  function missionHtml(c) {
    const m = ui.month, r = rangeOf(m);
    const sup = c.isSup(), me = c.myName(), act = activeSet();
    const k = K();
    const dd = draftDays(m);
    const conf = new Set(conflictsOf(m, sup).map(conflictKey));
    const edit = canEdit();
    const rows = [];
    U().eachDate(r.from, r.to).forEach(date => {
      const duty = viewDuty(date, sup);
      const names = duty ? duty.mission || [] : [];
      let tr = rowStart(date);
      for (let i = 0; i < 2; i++) {
        const n = names[i] || '';
        const ph = n ? phoneOf(n) : '';
        const href = telHref(ph);
        // the number itself is the tel: link — full cell width, 44 px tall; it breaks only when it cannot fit (a long +66… at 320 px)
        const after = href ? `<a href="${esc(href)}" class="flex items-center gap-0.5 min-h-[44px] px-0.5 rounded-xl text-[0.8125rem] font-medium leading-5 tabular-nums text-accent-700 active:bg-accent-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-roster-tel aria-label="${esc('โทร ' + n + ' ' + phoneText(ph))}">${icon('phone', 'w-3.5 h-3.5 shrink-0')}<span class="min-w-0 ${k.wrapAnywhere}">${esc(phoneText(ph))}</span></a>` : '';
        tr += cellHtml({
          date, cell: 'mission:' + i, editable: edit && sup && !!duty,
          label: 'แก้ไข ภารกิจพิเศษ คนที่ ' + (i + 1) + ' · ' + dayShort(date),
          main: n ? nameLabel(n, act) : '', sub: '',
          mine: !!n && n === me, leave: n && conf.has(date + '|mission||' + n) ? (leaveOf(date, n) || {}).type || 'ลา' : '',
          draft: hasOwn.call(dd, date), below: after
        });
      }
      rows.push(tr + '</tr>');
    });
    return tableHtml('mission', ['คนที่ 1', 'คนที่ 2'], rows);
  }

  /** FIX-RO R-6: my station of the month from the stored roster ("CANCER CENTER (คนที่ 1)"), or ''. */
  function myStationText(m, me) {
    const ro = P().roster(m);
    if (!ro) return '';
    const st = U().STATIONS.filter(x => ro.stations[x.id].indexOf(me) >= 0)[0];
    return st ? st.name + ' (คนที่ ' + (ro.stations[st.id].indexOf(me) + 1) + ')' : '';
  }
  function mineHtml(c) {
    const k = K();
    const p = P();
    const m = ui.month, r = rangeOf(m);
    const me = c.myName();
    const ro = p.roster(m);
    const items = [];
    U().eachDate(r.from, r.to).forEach(date => {
      const duty = p.duty(date);
      if (!duty) return;
      const lines = [];
      const day = c.state.days && c.state.days[date];
      const saved = !!day && day.assignments && U().STATIONS.some(st => (day.assignments[st.id] || []).length > 0);
      const ls = sortedLines(duty.lines);
      let l = null, sub = '';
      if (ls.length) {
        if (saved) {
          const res = PE.resolveLines(ls, day.assignments.portable || []);
          const i = res.workers.indexOf(me);
          if (i >= 0) { l = ls[i]; if (l.tech && l.tech !== me) sub = ' (แทน ' + l.tech + ')'; }
        } else l = ls.filter(x => x.tech === me)[0] || null;
      }
      if (l) lines.push('Portable สาย ' + l.line + sub + (l.assistant ? ' · ผช. ' + l.assistant : ''));
      if (duty.lunch) LUNCH.forEach(s => { const sl = duty.lunch[s]; if (sl && sl.tech === me) lines.push('เวรกลางวัน ' + LUNCH_LABEL[s] + (sl.assistant ? ' · ผช. ' + sl.assistant : '')); });
      if ((duty.mission || []).indexOf(me) >= 0) {
        const mate = duty.mission.filter(n => n && n !== me)[0];
        const ph = mate ? phoneText(phoneOf(mate)) : '';
        lines.push('ภารกิจพิเศษ' + (mate ? ' คู่กับ ' + mate + (ph ? ' · โทร ' + ph : '') : ''));
      }
      if (!lines.length) return;
      // R-6: a day with my blocking leave says so on every duty line
      const away = absentOn(date, me);
      const isToday = date === today();
      const d = U().parseYmd(date);
      const label = U().THAI_WEEKDAYS_ABBR[d.getDay()] + ' ' + d.getDate();   // the month is in the header: never wraps
      items.push(`<li class="flex items-start gap-3 px-4 py-3${isToday ? ' bg-accent-50' : ''}" data-roster-mine="${esc(date)}"${isToday ? ' data-today="1"' : ''}${away ? ' data-leave="1"' : ''}>` +
        `<span class="w-14 shrink-0 whitespace-nowrap font-display text-sm font-medium leading-6 tabular-nums text-ink-800">${esc(label)}</span>` +
        `<div class="min-w-0 flex-1 space-y-0.5">${lines.map(t => `<p class="text-sm leading-6 ${away ? 'text-coral-700' : 'text-ink-900'} ${k.wrapAnywhere}">${esc(t + (away ? ' — คุณลา (Supervisor จะหาคนแทน)' : ''))}</p>`).join('')}</div></li>`);
    });
    const st = myStationText(m, me);
    const head = ro ? `<p class="px-1 text-sm font-medium leading-6 text-ink-900" data-roster-mystation>${esc(st ? 'เดือนนี้คุณประจำ: ' + st : 'เดือนนี้คุณยังไม่มี Station ประจำ')}</p>` : '';
    if (!ro && !storedCount(m)) return emptyCard('mine-none', 'calendar', MSG.mineNone, MSG.staffNone);
    // re-review 2: a month with a roster but no generated duties has no schedule yet — not "you have no duties"
    if (!storedCount(m)) return head + emptyCard('mine-none', 'calendar', MSG.mineNone, MSG.staffNone);
    if (!items.length) return head + emptyCard('mine', 'calendar-check', MSG.mineEmpty, '');
    return head + `<ul class="${k.list}" data-roster-agenda>${items.join('')}</ul>`;
  }

  /* ---------------------------------------------------------------- คนประจำ */
  function rosterSegHtml(c) {
    const k = K();
    const m = ui.month;
    const info = rosterModel(m);
    const model = info.model;
    const edit = canEdit();
    if (!model) return emptyCard('no-roster', 'users', MSG.noRoster, '');
    const act = activeSet();
    const used = new Set();
    U().STATIONS.forEach(s => model.stations[s.id].forEach(n => used.add(n)));
    const assts = activeAssistants();
    const pairedTo = {};
    Object.keys(model.pairs).forEach(t => { pairedTo[model.pairs[t]] = t; });
    let html = '';
    if (edit) {
      html += `<button type="button" class="${k.btn} ${k.btnTonal} w-full" data-roster-act="rcopy">${icon('copy', 'w-5 h-5')}คัดลอกจากเดือนก่อน</button>`;
      // R-7: the next step after the roster of a month without duties is stored
      if (info.stored && !info.draft && !storedCount(m) && !dutyDraft(m)) {
        html += `<div class="${k.banner} ${k.bannerInfo} flex-wrap" data-roster-banner="next">${icon('wand', 'w-5 h-5 shrink-0 mt-0.5')}<p class="min-w-0 flex-1 font-medium">${esc(MSG.nextStep)}</p>` +
          `<button type="button" class="${k.btn} ${k.btnPrimary} ${k.btnCompact}" data-roster-act="gen-open">สร้างอัตโนมัติทั้งเดือน</button></div>`;
      }
      if (!activeAssistants().length || !P().eligible().length) html += settingsHint();
      if (info.draft) html += `<p class="${k.textMeta} px-1" data-roster-rdraft>${core.Kit.pill('ยังไม่ได้บันทึก', 'pending')} แก้ไขคนประจำของเดือนนี้แล้ว — กดบันทึกเพื่อใช้</p>`;
      else if (!info.stored) {
        html += `<p class="${k.textMeta} px-1" data-roster-prefill>${esc(info.prefill ? 'ยังไม่ได้บันทึก — ใส่คนที่ตั้ง Station เดียว (ประจำ Station) ไว้ให้แล้ว เพิ่มคนอื่นแล้วกดบันทึก' : MSG.noRoster + ' — เพิ่มคนในแต่ละ Station แล้วกดบันทึก')}</p>`;
      }
    } else if (!info.stored) {
      return emptyCard('no-roster', 'users', MSG.noRoster, '');
    }
    html += U().STATIONS.map(st => {
      const names = model.stations[st.id];
      const rows = names.map((n, i) => {
        const lock = lockedOf(n);
        // R-7: the badge has its own line under the name (never under the ↑ button)
        // (a line of its own under the whole row, full width; it may wrap — never wider than the card at 320 px)
        const badge = lock ? `<div class="pl-8"><span class="inline-flex items-center gap-1 max-w-full min-h-[24px] px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-xs font-medium leading-4 text-brand-800" data-roster-lock="${esc(lock)}">${icon('lock', 'w-3.5 h-3.5 shrink-0')}<span class="min-w-0">ประจำ ${esc(stationName(lock))}</span></span></div>` : '';
        const meTag = !edit && n === c.myName() ? ' (คุณ)' : '';
        let row = `<div class="py-1.5 space-y-1.5" data-roster-row data-st="${st.id}" data-name="${esc(n)}">` +
          `<div class="flex items-center gap-2 min-w-0"><span class="w-6 shrink-0 text-center ${k.textMeta} tabular-nums">${i + 1}</span>` +
          `<div class="min-w-0 flex-1"><p class="text-sm font-medium leading-6 text-ink-900 ${k.wrapAnywhere}">${esc(nameLabel(n, act) + meTag)}</p></div>`;
        if (edit) {
          const b = (r, ic, label, dis) => `<button type="button" class="${k.iconBtn}" data-roster-r="${r}" data-st="${st.id}" data-i="${i}" aria-label="${esc(label)}"${dis ? ' disabled' : ''}>${icon(ic, 'w-5 h-5')}</button>`;
          row += b('up', 'chevron-up', 'เลื่อน ' + n + ' ขึ้น', i === 0) + b('down', 'chevron-down', 'เลื่อน ' + n + ' ลง', i === names.length - 1) + b('del', 'trash', 'นำ ' + n + ' ออกจาก ' + st.name, false);
        }
        row += '</div>' + badge;
        if (st.id === 'portable') {
          const a = model.pairs[n] || '';
          if (edit) {
            const opts = ['<option value="">— ไม่มีผู้ช่วย —</option>'].concat(
              assts.concat(a && assts.indexOf(a) < 0 ? [a] : []).filter(x => !pairedTo[x] || pairedTo[x] === n)
                .map(x => `<option value="${esc(x)}"${x === a ? ' selected' : ''}>${esc(x)}</option>`));
            // the select shrinks with the card (flex-1 + min-w-0): never wider than the card at 320 px
            row += `<label class="flex items-center gap-2 pl-8 min-w-0"><span class="shrink-0 ${k.textMeta}">ผู้ช่วย</span>` +
              `<select class="${k.select} flex-1 min-w-0" data-roster-pair="${esc(n)}" aria-label="${esc('ผู้ช่วยของ ' + n)}">${opts.join('')}</select></label>`;
          } else if (a) row += `<p class="pl-8 text-[0.8125rem] leading-5 text-slate-600">ผช. ${esc(a)}</p>`;
        }
        return row + '</div>';
      }).join('');
      let add = '';
      if (edit) {
        const free = core.staff().map(s => s.name).filter(n => !used.has(n));
        add = `<select class="${k.select} mt-1" data-roster-add="${st.id}" aria-label="${esc('เพิ่มคนใน ' + st.name)}"><option value="">เพิ่มคน…</option>` +
          free.map(n => `<option value="${esc(n)}">${esc(n)}${lockedOf(n) ? ' (ประจำ ' + esc(stationName(lockedOf(n))) + ')' : ''}</option>`).join('') + '</select>';
      }
      let lunch = '';
      if (st.id === 'er' || st.id === 'ipd') {
        const list = st.id === 'er' ? model.erAsst : model.ipdAsst;
        lunch = `<div class="mt-2 pt-2 border-t border-brand-100" data-roster-lasst="${st.id}"><p class="${k.textCaption}">ผู้ช่วยเวรกลางวัน</p>` +
          (list.length ? list.map((n, i) => `<div class="flex items-center gap-2 min-w-0 py-0.5" data-roster-lrow data-name="${esc(n)}"><p class="min-w-0 flex-1 text-sm leading-6 text-ink-900 ${k.wrapAnywhere}">${esc(n)}</p>` +
            (edit ? `<button type="button" class="${k.iconBtn}" data-roster-la="up" data-st="${st.id}" data-i="${i}" aria-label="${esc('เลื่อน ' + n + ' ขึ้น')}"${i === 0 ? ' disabled' : ''}>${icon('chevron-up', 'w-5 h-5')}</button>` +
              `<button type="button" class="${k.iconBtn}" data-roster-la="del" data-st="${st.id}" data-i="${i}" aria-label="${esc('นำผู้ช่วย ' + n + ' ออก')}">${icon('trash', 'w-5 h-5')}</button>` : '') + '</div>').join('')
            : `<p class="${k.textMeta}">ยังไม่มี</p>`) +
          (edit ? `<select class="${k.select} mt-1" data-roster-laadd="${st.id}" aria-label="${esc('เพิ่มผู้ช่วยเวรกลางวัน ' + st.name)}"><option value="">เพิ่มผู้ช่วย…</option>` +
            assts.filter(a => list.indexOf(a) < 0).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('') + '</select>' : '') + '</div>';
      }
      // §0.27 "ห้ามอยู่คู่กัน": a warning only (Supervisor), saving stays allowed
      const avoid = c.isSup() ? avoidIn(names) : [];
      const avoidHtml = avoid.length ? `<p class="${k.fieldError} mt-1" data-roster-avoid="${st.id}">${icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5')}` +
        `<span class="min-w-0">${esc('ห้ามอยู่คู่กัน: ' + avoid.map(pr => pr[0] + ' กับ ' + pr[1]).join(', ') + ' — ยังบันทึกได้ แต่ควรแยก Station')}</span></p>` : '';
      return `<section class="${k.stationCard}" data-roster-station="${st.id}"><span class="${k.stationEdge}" style="background:${st.border}" aria-hidden="true"></span>` +
        `<div class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="${k.stationChip}" style="background:${st.bg};color:${st.text}">${esc(st.name)}</span>` +
        `<span class="${k.stationNeed}" data-roster-need>${names.length} คน · ต้องการ ${core.state.stationCounts[st.id] || 0}</span></div>` +
        (st.id === 'portable' || st.id === 'er' || st.id === 'ipd' ? `<p class="${k.textMeta} mt-1">ลำดับนี้ใช้หมุนสาย Portable / เวรกลางวัน</p>` : '') +
        `<div class="mt-1 divide-y divide-brand-50">${rows || `<p class="py-2 ${k.textMeta}">ยังไม่มีคนประจำ</p>`}</div>${avoidHtml}${add}${lunch}</section>`;
    }).join('');
    return html;
  }

  function onRosterAction(c, act, st, i) {
    editRoster(md => {
      if (act === 'up' || act === 'down' || act === 'del') {
        const list = md.stations[st];
        if (!list || i < 0 || i >= list.length) return;
        if (act === 'del') list.splice(i, 1);
        else {
          const j = act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= list.length) return;
          const t = list[i]; list[i] = list[j]; list[j] = t;
        }
      }
    });
  }
  function onLunchAsstAction(c, act, st, i) {
    editRoster(md => {
      const list = st === 'er' ? md.erAsst : md.ipdAsst;
      if (i < 0 || i >= list.length) return;
      if (act === 'del') list.splice(i, 1);
      else if (act === 'up' && i > 0) { const t = list[i]; list[i] = list[i - 1]; list[i - 1] = t; }
    });
  }

  async function copyPrevious(c) {
    const p = P();
    const m = ui.month, prevM = U().addMonths(m, -1);
    const prev = p.roster(prevM);
    if (!prev) { c.toast('⚠️ เดือนก่อน (' + U().thaiMonthYear(prevM) + ') ยังไม่มีคนประจำ'); return; }
    const info = rosterModel(m);
    const hasContent = info.model && U().STATIONS.some(s => info.model.stations[s.id].length);
    if (hasContent && (info.draft || info.stored)) {
      const alive = c.alive();
      if (!(await c.confirm('แทนที่คนประจำของ ' + U().thaiMonthYear(m) + ' ด้วยรายชื่อของ ' + U().thaiMonthYear(prevM) + ' หรือไม่? (ยังไม่บันทึกจนกว่าจะกดบันทึก)', { title: 'คัดลอกจากเดือนก่อน', okLabel: 'คัดลอก' })) || !alive()) return;
    }
    const act = activeSet(), assts = new Set(activeAssistants());
    const src = fromStored(prev);
    editRoster(md => {
      U().STATIONS.forEach(s => { md.stations[s.id] = src.stations[s.id].filter(n => act.has(n)); });
      md.pairs = {};
      Object.keys(src.pairs).forEach(t => { if (act.has(t) && assts.has(src.pairs[t])) md.pairs[t] = src.pairs[t]; });
      md.erAsst = src.erAsst.filter(a => assts.has(a));
      md.ipdAsst = src.ipdAsst.filter(a => assts.has(a));
      md.note = src.note;
    });
    c.toast('📋 คัดลอกคนประจำจาก ' + U().thaiMonthYear(prevM) + ' แล้ว — ตรวจแล้วกดบันทึก');
  }

  async function saveRoster(c) {
    if (ui.busy || !canEdit() || !c.requireInternet()) return;
    const p = P();
    const m = ui.month;
    const info = rosterModel(m);
    if (!info.model) return;
    const alive = c.alive();
    ui.busy = 'roster';
    c.render();
    try {
      let params = rosterParams(m, info.model);
      let res;
      try {
        res = await p.saveRoster(params);
      } catch (e) {
        if (!alive() || !e || e.code !== 'CONFLICT') throw e;
        const cur = e.details && e.details.roster ? e.details.roster : null;
        const over = await c.confirm('คนประจำของเดือนนี้ถูกแก้ไขจากเครื่องอื่นแล้ว\nบันทึกทับด้วยรายชื่อของคุณ หรือดูรายชื่อล่าสุด?', {
          title: 'ข้อมูลถูกแก้ไขจากเครื่องอื่น', okLabel: 'บันทึกทับ', cancelLabel: 'ดูรายชื่อล่าสุด', danger: true, icon: 'alert-triangle'
        });
        if (!alive()) return;
        if (!over) { setRosterDraft(m, null); c.toast('🔄 แสดงคนประจำล่าสุดแล้ว'); return; }
        params = Object.assign({}, params, { baseVersion: cur ? cur.version | 0 : 0 });
        res = await p.saveRoster(params);
      }
      if (!alive()) return;
      setRosterDraft(m, null);
      const warns = res && Array.isArray(res.warnings) ? res.warnings.map(w => (typeof w === 'string' ? w : w && w.name ? w.name : '')).filter(Boolean) : [];
      const next = !storedCount(m) && !dutyDraft(m) ? '\n' + MSG.nextStep : '';
      c.toast((res && res.unchanged ? '✅ บันทึกคนประจำแล้ว (ไม่มีการเปลี่ยนแปลง)' : '✅ บันทึกคนประจำแล้ว') + next + (warns.length ? '\n⚠️ ' + warns.join('\n⚠️ ') : ''), warns.length || next ? 5000 : 2200);
    } finally {
      if (ui.busy === 'roster') ui.busy = '';
      if (alive()) c.render();
    }
  }

  /* ---------------------------------------------------------------- generation */
  function previousTail(m) {
    const p = P();
    const prevM = U().addMonths(m, -1);
    const pr = p.roster(prevM);
    if (pr && pr.monthPlan && pr.monthPlan.tail) return pr.monthPlan.tail;
    const ds = p.duties(prevM);
    const dates = Object.keys(ds).sort().reverse();
    for (let i = 0; i < dates.length; i++) if (ds[dates[i]].missionNext) return { mission: { next: ds[dates[i]].missionNext } };
    return null;
  }
  function genInput(m, from, useOffsets) {
    const p = P();
    const r = rangeOf(m);
    const ro = p.roster(m);
    const cfg = ro && ro.monthPlan && ro.monthPlan.config;
    const input = {
      month: m,
      holidays: p.holidays(),
      counts: Object.assign({}, core.state.stationCounts),
      roster: p.rosterFor(m) || {},
      assistants: p.assistantsFor(m),
      eligible: p.eligible(),
      leaves: p.leaves(r.from, r.to),
      previousTail: previousTail(m),
      staff: p.engineStaff(),
      options: { from: from || r.from, existing: clone(p.duties(m)) }
    };
    if (cfg && cfg.mission && Array.isArray(cfg.mission.order)) input.options.existingOrder = cfg.mission.order.slice();
    if (useOffsets) input.options.offsets = PE.suggestOffsets(input.previousTail, input);
    return input;
  }
  function offsetsNonZero(m) {
    const o = PE.suggestOffsets(previousTail(m), genInput(m, null, false));
    return !!(o.lines || o.lunch.er || o.lunch.ipd);
  }
  function defaultFrom(m) {
    const r = rangeOf(m);
    const t = today();
    return t < r.from ? r.from : t > r.to ? r.to : t;
  }
  async function runGenerate(c, from, useOffsets) {
    const p = P();
    const m = ui.month, r = rangeOf(m);
    if (!canEdit() || ui.busy) return false;
    if (!p.rosterFor(m)) { c.toast('⚠️ ' + MSG.noRoster + ' — ตั้งคนประจำก่อน'); return false; }
    if (rosterDraft(m)) { c.toast('⚠️ บันทึกคนประจำของเดือนนี้ก่อน แล้วจึงสร้างตารางเวร', 4000); return false; }
    const alive = c.alive();
    ui.busy = 'gen';
    try {
      const loaded = d => { const v = c.dayView(d); return v === 'ready' || v === 'cached'; };
      if (!loaded(r.from) || !loaded(r.to)) {
        try { await c.ensureRange(r.from, r.to); } catch (e) { if (!alive()) return false; }
        if (!alive()) return false;
        if (!loaded(r.from) || !loaded(r.to)) { c.toast('⚠️ ยังโหลดวันลาของเดือนนี้ไม่ได้ — ลองใหม่เมื่อเชื่อมต่อได้', 4000); return false; }
      }
      const f = U().isValidYmd(from) && from >= r.from && from <= r.to ? from : r.from;
      const res = PE.generateMonthDuties(genInput(m, f, useOffsets));
      const stored = p.duties(m);
      // a first generation that starts after the 1st leaves the earlier days without a duty: that is expected, no warning
      const first = !Object.keys(stored).length;
      const warnings = (res.warnings || []).filter(w => !(first && w && w.code === 'MISSING_STORED_DAY'));
      const draft = { days: {}, base: {}, monthPlan: { month: m, config: res.config, tail: res.tail }, warnings, from: f, generated: true };
      Object.keys(res.days).forEach(d => {
        if (d < f || !res.days[d]) return;
        const old = stored[d] || null;
        const x = plainDuty(res.days[d]);
        x.note = old ? old.note || '' : '';
        draft.days[d] = x;
        draft.base[d] = old ? old.version | 0 : 0;
      });
      setDutyDraft(m, draft);
      c.toast('📝 สร้างร่างตารางเวรแล้ว (' + Object.keys(draft.days).length + ' วัน) — ตรวจแล้วกดบันทึก', 3000);
      return true;
    } finally {
      if (ui.busy === 'gen') ui.busy = '';
      if (alive()) c.render();
    }
  }

  async function saveDuties(c) {
    const p = P();
    const m = ui.month;
    const d = dutyDraft(m);
    if (!d || ui.busy || !canEdit() || !c.requireInternet()) return;
    const dates = Object.keys(d.days).sort();
    if (!dates.length) { setDutyDraft(m, null); c.render(); return; }
    const params = { days: dates.map(x => toDutyParam(d.days[x], d.base[x])) };
    if (d.monthPlan && p.roster(m)) params.monthPlan = clone(d.monthPlan);
    const alive = c.alive();
    ui.busy = 'duties';
    c.render();
    try {
      let res;
      try {
        res = await p.saveDuties(params);
      } catch (e) {
        if (!alive() || !e || e.code !== 'CONFLICT') throw e;
        // the server's current rows of those dates are applied by plan-data; the rest of the draft stays
        const bad = (e.details && Array.isArray(e.details.dates) ? e.details.dates : []).filter(x => U().isValidYmd(x));
        const cur = dutyDraft(m);
        if (cur) {
          const next = clone(cur);
          bad.forEach(x => { delete next.days[x]; delete next.base[x]; });
          // FIX-RO R-4: the month plan (tail, config) was computed with the dropped days — it is not sent for a partial set
          if (next.monthPlan) { next.monthPlan = null; next.planDropped = bad.slice().sort()[0] || ''; }
          setDutyDraft(m, next);
        }
        c.toast('⚠️ ' + MSG.dutyConflict + (bad.length ? ' (' + bad.map(x => U().thaiDateShort(x, { year: false })).join(', ') + ')' : '') +
          ' — แสดงข้อมูลล่าสุดของวันเหล่านั้นแล้ว ส่วนอื่นของร่างยังอยู่ ตรวจแล้วกดบันทึกอีกครั้ง' +
          (cur && cur.monthPlan && bad.length ? '\nแผนของเดือน (ต่อไปยังเดือนหน้า) จะไม่ถูกบันทึกกับร่างนี้ — สร้างใหม่ตั้งแต่วันที่ ' + U().thaiDateShort(bad.slice().sort()[0], { year: false }) + ' เพื่อบันทึกแผน' : ''), 0, { error: true });
        return;
      }
      if (!alive()) return;
      setDutyDraft(m, null);
      const warns = (res && Array.isArray(res.warnings) ? res.warnings : []).map(w => (w && typeof w === 'object'
        ? (w.date ? dayShort(w.date) + ': ' : '') + w.name + ' มีวันลา' + (w.type ? ' (' + w.type + ')' : '') + (w.kind === 'mission' ? ' — ภารกิจพิเศษ' : w.kind === 'lunch' ? ' — เวรกลางวัน' : '')
        : String(w || ''))).filter(Boolean);
      const head = '✅ บันทึกตารางเวรแล้ว (' + dates.length + ' วัน)' + (res && res.unchanged ? ' — ไม่มีการเปลี่ยนแปลง' : '');
      c.toast(warns.length ? head + '\n⚠️ ' + warns.join('\n⚠️ ') : head, warns.length ? 6000 : 2500);
    } finally {
      if (ui.busy === 'duties') ui.busy = '';
      if (alive()) c.render();
    }
  }

  /* ---------------------------------------------------------------- the feature's sheet */
  function ensureSheet() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    const k = K();
    sheetEl = document.createElement('div');
    sheetEl.className = k.sheetWrap + ' md:p-4';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'rosterSheetTitle');
    sheetEl.dataset.rosterSheet = '';
    sheetEl.addEventListener('click', onSheetClick);
    sheetEl.addEventListener('change', onSheetChange);
    document.body.appendChild(sheetEl);
    return sheetEl;
  }
  function openSheet(kind, title, body, actions) {
    const k = K();
    const el = ensureSheet();
    el.dataset.rosterSheet = kind;
    el.innerHTML = `<div class="uk-safe-b ${k.sheetFrame}" data-sheet-panel><div class="${k.sheetGrabber}" aria-hidden="true"></div>` +
      `<div class="${k.sheetHead}"><h2 id="rosterSheetTitle" class="flex-1 outline-none ${k.sheetTitle}" data-sheet-title tabindex="-1">${esc(title)}</h2>` +
      `<button type="button" class="${k.iconBtn}" data-sheet-close aria-label="ปิด">${icon('chevron-down', 'w-5 h-5')}</button></div>` +
      `<div class="${k.sheetScroll}" data-roster-sheet-body>${body}</div><div class="${k.sheetActions}">${actions}</div></div>`;
    core.Kit.sheet.open(el, { initialFocus: '[data-sheet-title]', onClose: () => { ui.sheet = null; ui.suggest = ''; } });
  }
  function closeSheet() { if (sheetEl && core.Kit.sheet.isOpen(sheetEl)) core.Kit.sheet.close(sheetEl, 'api'); ui.sheet = null; }

  function openGen(c) {
    const p = P();
    const m = ui.month, r = rangeOf(m);
    if (!canEdit()) return;
    if (!p.rosterFor(m)) { c.toast('⚠️ ' + MSG.noRoster + ' — ตั้งคนประจำก่อน'); return; }
    if (rosterDraft(m)) { c.toast('⚠️ บันทึกคนประจำของเดือนนี้ก่อน แล้วจึงสร้างตารางเวร', 4000); return; }
    const k = K();
    const regen = storedCount(m) > 0;
    let body = `<p class="${k.textBody}">${esc(U().thaiMonthYear(m))} — สาย Portable เวรกลางวัน ER/IPD และภารกิจพิเศษ จากคนประจำเดือน วันหยุด และวันลา</p>`;
    // R-7: the start date also on the first run (a mid-month setup does not fill days that have passed)
    body += `<div><label class="${k.label}" for="rosterGenFrom">ตั้งแต่วันที่</label>` +
      `<input type="date" id="rosterGenFrom" class="${k.input}" data-roster-gen-from min="${r.from}" max="${r.to}" value="${defaultFrom(m)}">` +
      `<p class="${k.textMeta} mt-1">${regen ? 'วันก่อนหน้าวันที่เลือกจะไม่เปลี่ยน' : 'เลือกวันที่ 1 เพื่อจัดทั้งเดือน'}</p></div>`;
    if (regen) body += `<p class="${k.note}" data-roster-gen-replace>${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>การแก้ไขด้วยมือตั้งแต่วันที่นี้จะถูกแทนที่</span></p>`;
    if (!Array.from(p.holidays().keys()).some(x => x >= r.from && x <= r.to)) {
      body += `<p class="${k.note}" data-roster-gen-noholiday>${icon('calendar', 'w-5 h-5 shrink-0 mt-0.5')}<span>เดือนนี้ยังไม่มีวันหยุด — ตั้งได้ที่ ตั้งค่าการจัดเวร</span></p>`;
    }
    if (offsetsNonZero(m)) {
      body += `<label class="flex items-center gap-3 min-h-[44px] ${k.textBody}"><input type="checkbox" class="w-5 h-5 shrink-0 accent-brand-600" data-roster-gen-cont>` +
        `<span>สาย Portable และเวรกลางวันต่อจากเดือนก่อน</span></label>`;
    }
    if (!p.eligible().length) body += `<p class="${k.note}">${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<span>ยังไม่มีรายชื่อภารกิจพิเศษ — ตั้งได้ที่ เมนู → ตั้งค่าการจัดเวร</span></p>`;
    if (dutyDraft(m)) body += `<p class="${k.note}">${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>ร่างที่ยังไม่ได้บันทึกของเดือนนี้จะถูกแทนที่</span></p>`;
    body += `<p class="${k.textMeta}">ผลที่ได้เป็นร่าง — ตรวจแล้วจึงกดบันทึก</p>`;
    ui.sheet = { kind: 'gen' };
    openSheet('gen', 'สร้างตารางเวรอัตโนมัติ', body,
      `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-roster-gen-run>${icon('wand', 'w-5 h-5')}สร้าง</button>`);
  }

  function parseCell(cell) {
    const i = String(cell).indexOf(':');
    return i > 0 ? { kind: cell.slice(0, i), key: cell.slice(i + 1) } : null;
  }
  function editTitle(date, kind, key) {
    const what = kind === 'line' ? 'สาย ' + key : kind === 'lunch' ? 'เวรกลางวัน ' + LUNCH_LABEL[key] : 'ภารกิจพิเศษ คนที่ ' + (+key + 1);
    return 'แก้ไข ' + what + ' · ' + dayShort(date);
  }
  function currentOf(duty, kind, key) {
    if (!duty) return { tech: '', assistant: '' };
    if (kind === 'line') { const l = sortedLines(duty.lines).filter(x => String(x.line) === String(key))[0]; return { tech: l ? l.tech : '', assistant: l ? l.assistant : '' }; }
    if (kind === 'lunch') { const s = duty.lunch ? duty.lunch[key] : null; return { tech: s ? s.tech : '', assistant: s ? s.assistant : '', base: s ? s.base : '' }; }
    return { tech: (duty.mission || [])[+key] || '', assistant: '' };
  }
  /** "วันนี้" only for today, else "ในวันที่ 27 พ.ย." (R-7). */
  function whenText(date) { return date === today() ? 'วันนี้' : 'ในวันที่ ' + U().thaiDateShort(date, { year: false }); }
  /** Options of a picker; people with a blocking leave on `date` are marked "(ลา)" (R-7). */
  function optionsHtml(list, cur, act, emptyLabel, date) {
    const all = list.slice();
    if (cur && all.indexOf(cur) < 0) all.push(cur);
    const label = n => (act ? nameLabel(n, act) : n) + (date && act && absentOn(date, n) ? ' (ลา)' : '');
    return `<option value="">${esc(emptyLabel)}</option>` + all.map(n => `<option value="${esc(n)}"${n === cur ? ' selected' : ''}>${esc(label(n))}</option>`).join('');
  }
  function openEdit(c, date, cell) {
    const pc = parseCell(cell);
    if (!pc || !canEdit() || monthOf(date) !== ui.month) return;
    const duty = viewDuty(date, true);
    if (!duty) return;
    const k = K();
    const act = activeSet();
    const cur = currentOf(duty, pc.kind, pc.key);
    const staffNames = core.staff().map(s => s.name);
    let body = '';
    if (cur.tech && absentOn(date, cur.tech)) {
      body += `<p class="${k.banner} ${k.bannerDanger}" data-roster-edit-leave>${icon('calendar-off', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(cur.tech + ' ลา (' + (leaveOf(date, cur.tech) || {}).type + ') ' + whenText(date))}</span></p>`;
    }
    if (pc.kind === 'mission') {
      const elig = P().eligible().map(e => e.name);
      const others = staffNames.filter(n => elig.indexOf(n) < 0);
      const all = elig.concat(others);
      const extra = cur.tech && all.indexOf(cur.tech) < 0 ? `<option value="${esc(cur.tech)}" selected>${esc(nameLabel(cur.tech, act))}</option>` : '';
      const opt = n => `<option value="${esc(n)}"${n === cur.tech ? ' selected' : ''}>${esc(n + (absentOn(date, n) ? ' (ลา)' : ''))}</option>`;
      body += `<div><label class="${k.label}" for="rosterEditTech">ชื่อ</label><select id="rosterEditTech" class="${k.select}" data-roster-edit-tech>` +
        `<option value="">— ว่าง —</option>${extra}<optgroup label="รายชื่อภารกิจพิเศษ">${elig.map(opt).join('')}</optgroup>` +
        (others.length ? `<optgroup label="คนอื่น">${others.map(opt).join('')}</optgroup>` : '') + '</select></div>';
    } else {
      body += `<div><label class="${k.label}" for="rosterEditTech">เจ้าหน้าที่</label><select id="rosterEditTech" class="${k.select}" data-roster-edit-tech>${optionsHtml(staffNames, cur.tech, act, '— ว่าง —', date)}</select></div>`;
      body += `<div><label class="${k.label}" for="rosterEditAsst">ผู้ช่วย</label><select id="rosterEditAsst" class="${k.select}" data-roster-edit-asst>${optionsHtml(activeAssistants(), cur.assistant, null, '— ไม่มีผู้ช่วย —')}</select></div>`;
    }
    if (pc.kind !== 'line') {
      body += `<div class="flex flex-wrap items-center gap-2"><button type="button" class="${k.btn} ${k.btnTonal}" data-roster-suggest>${icon('search', 'w-5 h-5')}หาคนแทน</button>` +
        `<p class="${k.textMeta} min-w-0 flex-1" data-roster-suggest-text aria-live="polite"></p></div>`;
    }
    ui.sheet = { kind: 'edit', date, cell, key: pc.key, type: pc.kind };
    ui.suggest = '';
    openSheet('edit', editTitle(date, pc.kind, pc.key), body,
      `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-roster-edit-ok>ตกลง</button>`);
  }
  function suggestFor(s) {
    const date = s.date;
    const duty = viewDuty(date, true);
    const cur = currentOf(duty, s.type, s.key);
    const sel = sheetEl.querySelector('[data-roster-edit-tech]');
    const who = sel ? sel.value : cur.tech;
    if (s.type === 'lunch') return lunchSubstitute(date, s.key, who, cur.base);
    const names = (duty.mission || []).slice();
    return missionSubstitute(date, names, who);
  }
  function applyEdit(c) {
    const s = ui.sheet;
    if (!s || s.kind !== 'edit') return;
    const m = monthOf(s.date);
    const techSel = sheetEl.querySelector('[data-roster-edit-tech]');
    const asstSel = sheetEl.querySelector('[data-roster-edit-asst]');
    const tech = techSel ? techSel.value : '';
    const asst = asstSel ? asstSel.value : '';
    const cur = viewDuty(s.date, true);
    if (!cur) { closeSheet(); return; }
    const day = plainDuty(cur);
    if (s.type === 'line') {
      day.lines = (day.lines || []).map(l => (String(l.line) === String(s.key) ? { line: l.line, tech, assistant: asst } : l));
    } else if (s.type === 'lunch') {
      if (!day.lunch) day.lunch = { er: slotOf(null), ipd: slotOf(null) };
      const old = day.lunch[s.key];
      day.lunch[s.key] = { tech, assistant: asst, base: old.base || tech };
    } else {
      const i = +s.key;
      const list = [(day.mission || [])[0] || '', (day.mission || [])[1] || ''];
      if (tech && list[1 - i] === tech) { c.toast('⚠️ ' + tech + ' อยู่ในภารกิจพิเศษของวันนี้แล้ว'); return; }
      list[i] = tech;
      day.mission = list.filter(Boolean);
    }
    const p = P();
    const stored = p.duty(s.date);
    const d = clone(dutyDraft(m)) || { days: {}, base: {}, monthPlan: null, warnings: [], from: null, generated: false };
    if (!hasOwn.call(d.base, s.date)) d.base[s.date] = stored ? stored.version | 0 : 0;
    if (!d.generated && stored && same(plainDuty(stored), day)) { delete d.days[s.date]; delete d.base[s.date]; }
    else d.days[s.date] = day;
    setDutyDraft(m, d);
    closeSheet();
    c.toast(MSG.edited, 3500);   // R-5
    c.render();
  }

  function onSheetClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !c || !ui.sheet) return;
    if (t.closest('[data-roster-gen-run]')) {
      const fromEl = sheetEl.querySelector('[data-roster-gen-from]');
      const contEl = sheetEl.querySelector('[data-roster-gen-cont]');
      const from = fromEl ? fromEl.value : '';
      if (fromEl && !U().isValidYmd(from)) { c.toast('⚠️ เลือกวันที่เริ่มก่อน'); return; }
      const cont = !!(contEl && contEl.checked);
      closeSheet();
      c.spawn(() => runGenerate(c, from, cont));
      return;
    }
    if (t.closest('[data-roster-suggest]')) {
      const s = ui.sheet;
      const name = suggestFor(s);
      const out = sheetEl.querySelector('[data-roster-suggest-text]');
      const sel = sheetEl.querySelector('[data-roster-edit-tech]');
      if (name && sel) {
        if (!Array.prototype.some.call(sel.options, o => o.value === name)) {
          const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
        }
        sel.value = name;
      }
      ui.suggest = name;
      const was = currentOf(viewDuty(s.date, true), s.type, s.key).tech;
      if (out) out.textContent = name ? (was && was !== name ? 'เปลี่ยนจาก ' + was + ' เป็น ' + name + ' — กดตกลงเพื่อใช้' : 'แนะนำ ' + name + ' — กดตกลงเพื่อใช้') : 'ไม่พบคนแทนที่ว่าง';
      return;
    }
    if (t.closest('[data-roster-edit-ok]')) applyEdit(c);
  }
  function onSheetChange() { /* the values are read when "ตกลง" is pressed */ }

  /* ---------------------------------------------------------------- exports */
  function exportRows(m) {
    const p = P();
    const r = rangeOf(m);
    const stored = U().eachDate(r.from, r.to).map(d => p.duty(d));
    const L = lineCount(stored.filter(Boolean));
    return { L, dates: U().eachDate(r.from, r.to), stored };
  }
  /** ตารางเวร → one .xlsx sheet with the columns of the former CSV (stored data only; R3-SPEC §4.4). */
  async function exportXlsx(c) {
    if (!window.XlsxLite) return;
    const m = ui.month;
    const ex = exportRows(m);
    const head = ['วันที่', 'วัน'];
    for (let i = 1; i <= ex.L; i++) head.push('สาย' + i + ' เทค', 'สาย' + i + ' ผู้ช่วย');
    head.push('กลางวัน ER', 'ผู้ช่วย ER', 'กลางวัน IPD', 'ผู้ช่วย IPD', 'ภารกิจ 1', 'เบอร์ 1', 'ภารกิจ 2', 'เบอร์ 2');
    const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    const rows = [head];
    ex.dates.forEach((date, i) => {
      const d = ex.stored[i];
      const row = [date, DAYS[weekday(date)]];
      const lines = d ? sortedLines(d.lines) : [];
      for (let n = 1; n <= ex.L; n++) { const l = lines.filter(x => x.line === n)[0]; row.push(l ? l.tech : '', l ? l.assistant : ''); }
      LUNCH.forEach(s => { const sl = d && d.lunch ? d.lunch[s] : null; row.push(sl ? sl.tech : '', sl ? sl.assistant : ''); });
      for (let n = 0; n < 2; n++) { const nm = d ? (d.mission || [])[n] || '' : ''; row.push(nm, nm ? phoneText(phoneOf(nm)) : ''); }
      rows.push(row);
    });
    const columns = head.map((h, i) => (i === 0 ? { header: h, width: 12 } : { header: h }));
    const spec = { sheets: [{ name: 'ตารางเวร ' + m, columns, rows: rows.slice(1) }] };
    if (await window.XlsxLite.saveTable(c, 'ตารางเวร-' + m + '.xlsx', spec)) c.toast('📥 ดาวน์โหลด Excel แล้ว');
  }
  /** The picture of the current table segment: an off-screen node with inline styles only (like #captureArea). */
  function imageNode(seg, m) {
    const ex = exportRows(m);
    const td = 'border:1px solid #FFE3EF;padding:4px 5px;vertical-align:top;font-size:13px;line-height:18px;color:#1A2C63;';
    const th = td + 'background:#FFFBF2;font-weight:600;font-size:12px;';
    const cell = (main, sub) => `<td style="${td}"><div style="font-size:14px;font-weight:600;">${esc(main || '–')}</div>${sub ? `<div style="color:#475569;">${esc(sub)}</div>` : ''}</td>`;
    let cols = [];
    const rows = [];
    if (seg === 'portable') { for (let i = 1; i <= ex.L; i++) cols.push('สาย ' + i); }
    else if (seg === 'lunch') cols = ['ER', 'IPD'];
    else cols = ['คนที่ 1', 'คนที่ 2'];
    ex.dates.forEach((date, i) => {
      const d = ex.stored[i];
      const wd = weekday(date);
      if (seg !== 'mission' && (wd === 0 || wd === 6)) return;
      let tr = `<tr><td style="${th}">${esc(dateCellLabel(date))}</td>`;
      if (seg === 'portable') {
        const lines = d ? sortedLines(d.lines) : [];
        for (let n = 1; n <= ex.L; n++) { const l = lines.filter(x => x.line === n)[0]; tr += cell(l ? l.tech : '', l && l.assistant ? 'ผช. ' + l.assistant : ''); }
      } else if (seg === 'lunch') {
        LUNCH.forEach(s => { const sl = d && d.lunch ? d.lunch[s] : null; tr += cell(sl ? sl.tech : '', sl && sl.assistant ? 'ผช. ' + sl.assistant : ''); });
      } else {
        for (let n = 0; n < 2; n++) { const nm = d ? (d.mission || [])[n] || '' : ''; tr += cell(nm, nm ? phoneText(phoneOf(nm)) : ''); }
      }
      rows.push(tr + '</tr>');
    });
    const node = document.createElement('div');
    node.setAttribute('data-roster-image', seg);
    node.style.cssText = 'width:420px;box-sizing:border-box;padding:12px;background:#ffffff;font-family:Sarabun,"Noto Sans Thai","Leelawadee UI",sans-serif;color:#1A2C63;';
    node.innerHTML = `<div style="font-size:16px;font-weight:600;margin:0 0 8px;">ตารางเวร ${esc(SEG_FILE[seg])} · ${esc(U().thaiMonthYear(m))}</div>` +
      `<table style="width:100%;border-collapse:collapse;table-layout:fixed;"><colgroup><col style="width:52px">${cols.map(() => '<col>').join('')}</colgroup>` +
      `<thead><tr><th style="${th}">วันที่</th>${cols.map(t => `<th style="${th}">${esc(t)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    return node;
  }
  async function exportImage(c) {
    const seg = SEG_FILE[ui.seg] ? ui.seg : 'portable';
    await c.shareImage(imageNode(seg, ui.month), 'ตารางเวร-' + SEG_FILE[seg] + '-' + ui.month + '.png');
  }
  function runExport(c, act, fn) {
    if (ui.busy) return;
    const alive = c.alive();
    ui.busy = act;
    c.render();
    c.spawn(async () => {
      try { await fn(c); } finally { if (ui.busy === act) ui.busy = ''; if (alive()) c.render(); }
    });
  }

  /* ---------------------------------------------------------------- screen events */
  function onRootClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !c || !root) return;
    const mn = t.closest('[data-roster-month]');
    if (mn) { setMonth(c, U().addMonths(ui.month, +mn.dataset.rosterMonth)); return; }
    const sg = t.closest('[data-roster-seg]');
    if (sg) { ui.seg = sg.dataset.rosterSeg; ui.showConflicts = false; ui.scrollToday = true; c.render(); return; }
    const ed = t.closest('[data-roster-edit]');
    if (ed && !ed.disabled) {
      const pc = parseCell(ed.dataset.cell);
      if (pc && ui.seg !== 'portable' && pc.kind === 'line') ui.seg = 'portable';
      if (pc && pc.kind === 'lunch' && ui.seg !== 'lunch') ui.seg = 'lunch';
      if (pc && pc.kind === 'mission' && ui.seg !== 'mission') ui.seg = 'mission';
      openEdit(c, ed.dataset.date, ed.dataset.cell);
      c.render();
      return;
    }
    const rr = t.closest('[data-roster-r]');
    if (rr && !rr.disabled) { onRosterAction(c, rr.dataset.rosterR, rr.dataset.st, +rr.dataset.i); return; }
    const la = t.closest('[data-roster-la]');
    if (la && !la.disabled) { onLunchAsstAction(c, la.dataset.rosterLa, la.dataset.st, +la.dataset.i); return; }
    const a = t.closest('[data-roster-act]');
    if (!a || a.disabled) return;
    const act = a.dataset.rosterAct;
    if (act === 'retry') { ensureMonth(c); return; }
    if (act === 'go-roster') { ui.seg = 'roster'; c.render(); return; }
    if (act === 'gen-open') { openGen(c); return; }
    if (act === 'conflicts') { ui.showConflicts = !ui.showConflicts; c.render(); return; }
    if (act === 'rcopy') { c.spawn(() => copyPrevious(c)); return; }
    if (act === 'rsave') { c.spawn(() => saveRoster(c), { write: true }); return; }
    if (act === 'rdiscard') {
      const m = ui.month, alive = c.alive();
      c.spawn(async () => {
        if (!(await c.confirm('ทิ้งการแก้ไขคนประจำของ ' + U().thaiMonthYear(m) + ' ที่ยังไม่ได้บันทึกหรือไม่?', { title: 'ยกเลิกการแก้ไข', okLabel: 'ทิ้งการแก้ไข', danger: true })) || !alive()) return;
        setRosterDraft(m, null);
        c.render();
      });
      return;
    }
    if (act === 'settings') { c.go('plan-settings'); return; }
    if (act === 'dsave') { c.spawn(() => saveDuties(c), { write: true }); return; }
    if (act === 'ddiscard') {
      const m = ui.month, alive = c.alive();
      c.spawn(async () => {
        if (!(await c.confirm('ทิ้งร่างตารางเวรของ ' + U().thaiMonthYear(m) + ' ที่ยังไม่ได้บันทึกหรือไม่?', { title: 'ยกเลิกร่าง', okLabel: 'ทิ้งร่าง', danger: true })) || !alive()) return;
        setDutyDraft(m, null);
        c.render();
      });
      return;
    }
    if (act === 'xlsx') { runExport(c, 'xlsx', exportXlsx); return; }
    if (act === 'image') { runExport(c, 'image', exportImage); }
  }
  function onRootChange(e) {
    const c = core;
    const t = e.target;
    if (!t || !c || !canEdit()) return;
    const v = t.value;
    if (t.matches('[data-roster-add]')) {
      if (!v) return;
      const st = t.dataset.rosterAdd;
      editRoster(md => { if (md.stations[st] && U().STATIONS.every(s => md.stations[s.id].indexOf(v) < 0)) md.stations[st].push(v); });
    } else if (t.matches('[data-roster-pair]')) {
      const tech = t.dataset.rosterPair;
      editRoster(md => {
        Object.keys(md.pairs).forEach(x => { if (md.pairs[x] === v && x !== tech) delete md.pairs[x]; });
        if (v) md.pairs[tech] = v; else delete md.pairs[tech];
      });
    } else if (t.matches('[data-roster-laadd]')) {
      if (!v) return;
      const st = t.dataset.rosterLaadd;
      editRoster(md => { const list = st === 'er' ? md.erAsst : md.ipdAsst; if (list.indexOf(v) < 0 && list.length < 5) list.push(v); });
    }
  }

  /* ---------------------------------------------------------------- panel 'proposal' on วันนี้ */
  function hasEmpty(slots) { return U().STATIONS.some(st => (slots[st.id] || []).some(n => !n)); }
  function renderPanel(el, c) {
    if (!el._rosterBound) { el._rosterBound = true; el.addEventListener('click', onPanelClick); el.addEventListener('change', onPanelChange); }
    const html = panelHtml(c);
    el.hidden = !html;
    c.setHtml(el, html);
  }
  function panelHtml(c) {
    if (!c.state.user || !c.isSup() || !c.serverHas('plan')) return '';
    const p = P();
    if (!p) return '';
    const date = c.selectedDate();
    if (!U().isValidYmd(date) || date < today()) return '';
    const view = c.station.view(date);
    if (!view) return '';
    const dv = c.dayView(date);
    if (dv !== 'ready' && dv !== 'cached') return '';
    const k = K();
    // FIX-RO R-2: plan data of the date not on this device yet — never claim "no roster" while it loads
    if (!p.covers(date, date)) {
      return `<section class="${k.cardLilac} space-y-2" data-proposal="loading"><h2 class="${k.titleCard}">ข้อเสนอการจัดคน</h2>` +
        `<p class="${k.textMeta}">กำลังโหลดตารางเวร…</p>${c.Kit.skeleton(2)}</section>`;
    }
    // FIX-RO R-3: the proposal and "เติมเฉพาะช่องว่าง" need a working day; the lunch / mission repair does not (missions
    // run every calendar day)
    const working = PE.isWorkingDay(date, p.holidays());
    const month = monthOf(date);
    const parts = [];
    let state = '';
    if (!working) {
      // nothing but the repair below
    } else if (!p.roster(month)) {
      if (!view.planned && !view.draft) {
        state = 'no-roster';
        parts.push(`<p class="${k.textBody}">${esc(MSG.noProposal)}</p>` +
          `<button type="button" class="${k.btn} ${k.btnSecondary}" data-proposal-act="go">${icon('table', 'w-5 h-5')}ไปที่ตารางเวร</button>`);
      }
    } else if (view.proposal) {
      state = 'active';
      const pr = c.station.proposal(date);
      parts.push(`<p class="${k.textMeta}">ระบบเสนอจากคนประจำเดือน ทีมแทนเวร และวันลา — ตรวจแก้แล้วกดบันทึก</p>` + notesHtml(pr ? pr.notes : [], pr ? pr.unfilled : []) +
        `<div class="flex flex-wrap gap-2"><button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-proposal-act="blank">เริ่มจากช่องว่าง</button>` +
        `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-proposal-act="save">บันทึกตามนี้</button></div>`);
    } else if (!view.planned && !view.draft && view.editable && proposer(date)) {
      state = 'dismissed';
      parts.push(`<p class="${k.textMeta}">ซ่อนข้อเสนอของวันนี้แล้ว</p><button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact}" data-proposal-act="show">แสดงข้อเสนอ</button>`);
    } else if ((view.planned || view.draft) && view.editable && hasEmpty(view.slots)) {
      state = 'fill';
      parts.push(`<p class="${k.textMeta}">ยังมีช่องว่าง — ให้ระบบเติมเฉพาะช่องว่างจากคนประจำ ทีมแทนเวร และวันลา (คนที่จัดไว้แล้วไม่ถูกย้าย)</p>` +
        (fillNotes[date] ? notesHtml(fillNotes[date], []) : '') +
        `<button type="button" class="${k.btn} ${k.btnTonal}" data-proposal-act="fill">${icon('wand', 'w-5 h-5')}เติมเฉพาะช่องว่าง</button>`);
    } else if (fillNotes[date] && view.draft) {
      parts.push(notesHtml(fillNotes[date], []));
    }
    const rep = repairOf(date);
    const repairHtml = rep ? repairBlock(c, date, rep, view) : '';
    syncPatch(c, date, rep);
    if (!parts.length && !repairHtml) return '';
    const title = state === 'active' ? `<div class="flex flex-wrap items-center gap-2"><h2 class="${k.titleCard}">ข้อเสนอการจัดคน</h2>${c.Kit.pill('ยังไม่ได้บันทึก', 'pending')}</div>`
      : parts.length ? `<h2 class="${k.titleCard}">ข้อเสนอการจัดคน</h2>` : '';
    return `<section class="${k.cardLilac} space-y-3" data-proposal="${state || 'repair'}">${title}${parts.join('')}${repairHtml}</section>`;
  }
  function notesHtml(notes, unfilled) {
    const k = K();
    const list = (Array.isArray(notes) ? notes : []).map(n => { try { return PE.noteText(n); } catch (e) { return ''; } }).filter(Boolean);
    // the shortage is said once: a station whose VACANT note is listed is not repeated in the summary
    const told = new Set((Array.isArray(notes) ? notes : []).filter(n => n && n.code === 'VACANT').map(n => n.station));
    const miss = (Array.isArray(unfilled) ? unfilled : []).filter(u => u && u.missing > 0 && !told.has(u.station));
    let html = '';
    if (list.length) html += `<ul class="space-y-1 text-sm leading-6 text-slate-700 ${k.wrapAnywhere}" data-proposal-notes>${list.map(t => `<li class="flex items-start gap-2">${icon('info', 'w-4 h-4 shrink-0 mt-1 text-lilac-700')}<span class="min-w-0">${esc(t)}</span></li>`).join('')}</ul>`;
    if (miss.length) html += `<p class="text-sm font-medium leading-6 text-amber-800" data-proposal-unfilled>ยังขาด: ${esc(miss.map(u => stationName(u.station) + ' ' + u.missing + ' คน').join(', '))}</p>`;
    return html;
  }
  function repairBlock(c, date, rep, view) {
    const k = K();
    const items = rep.items.map(it => {
      const what = it.kind === 'lunch' ? 'เวรกลางวัน ' + LUNCH_LABEL[it.station] : 'ภารกิจพิเศษ';
      return `<li class="${k.wrapAnywhere}">${esc(what + ': ' + it.name + ' (' + it.reason + ') → ' + (it.sub || 'ยังไม่มีคนแทน'))}</li>`;
    }).join('');
    const on = repairOn[date] !== false;
    let html = `<div class="${k.note} flex-col" data-proposal-repair><p class="font-medium text-ink-900">เวรของวันนี้ที่ต้องแก้</p><ul class="list-disc pl-5 space-y-0.5">${items}</ul>`;
    if (rep.duty) {
      html += `<label class="flex items-center gap-3 min-h-[44px]"><input type="checkbox" class="w-5 h-5 shrink-0 accent-brand-600" data-proposal-repair-on${on ? ' checked' : ''}>` +
        `<span>บันทึกการแก้เวรพร้อมกัน</span></label>`;
      if (on && !view.proposal && !view.draft && view.editable) {
        html += `<button type="button" class="${k.btn} ${k.btnSecondary}" data-proposal-act="repair-save">บันทึกการแก้เวร</button>`;
      } else if (on) html += `<p class="${k.textMeta}">จะบันทึกพร้อมกับการกดบันทึกของวันนี้</p>`;
    }
    return html + '</div>';
  }
  /** The duty patch follows the panel's repair and checkbox — only while วันนี้ is the current screen. */
  function syncPatch(c, date, rep) {
    if (c.current() !== 'station') return;
    const want = rep && rep.duty && repairOn[date] !== false ? rep.duty : null;
    const have = c.station.dutyPatch(date);
    const mine = hasOwn.call(patchSet, date) ? patchSet[date] : null;
    // a patch that is not the one this panel set belongs to someone else: never replaced or cleared here
    if (have && !(mine && same(have, mine))) { delete patchSet[date]; return; }
    if (want) {
      if (!same(want, have)) c.station.setDutyPatch(date, want);
      patchSet[date] = clone(want);
    } else if (have) {
      c.station.setDutyPatch(date, null);   // ours (checked above)
      delete patchSet[date];
    } else delete patchSet[date];
  }
  function onPanelClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target.closest('[data-proposal-act]') : null;
    if (!t || !c || t.disabled) return;
    const date = c.selectedDate();
    const act = t.dataset.proposalAct;
    if (act === 'save' || act === 'repair-save') { c.station.save(); return; }
    if (act === 'blank') { c.station.dismissProposal(date, true); return; }
    if (act === 'show') { c.station.dismissProposal(date, false); return; }
    if (act === 'go') { ui.month = monthOf(date); ui.seg = 'roster'; c.go(ID, { seg: 'roster', month: monthOf(date) }); return; }
    if (act === 'fill') {
      const p = P();
      const view = c.station.view(date);
      if (!p || !view || !view.editable) return;
      let res;
      try { res = PE.proposeDay(p.proposalInput(date, 'fill', view.slots)); } catch (err) { console.error('[roster] fill failed:', err); return; }
      if (c.station.applyToDraft(date, res.assignments)) {
        fillNotes[date] = res.notes || [];
        const added = (res.added || []).length;
        c.toast(added ? '✨ เติม ' + added + ' ช่องแล้ว — ตรวจแล้วกดบันทึก' : 'ไม่มีคนที่เติมลงช่องว่างได้');
      }
      c.render();
    }
  }
  function onPanelChange(e) {
    const c = core;
    const t = e.target;
    if (!t || !c || !t.matches('[data-proposal-repair-on]')) return;
    const date = c.selectedDate();
    repairOn[date] = !!t.checked;
    syncPatch(c, date, repairOf(date));
    c.render();
  }

  /* ---------------------------------------------------------------- registration */
  App.register({
    id: ID,
    title: 'ตารางเวร',
    icon: 'table',
    nav: { place: 'bar', order: 25 },
    visible: c => c.serverHas('plan'),
    init(c) {
      core = c;
      c.station.setProposer(proposer);
      c.station.addPanel({ id: 'proposal', order: 20, render: renderPanel });
      c.provide('plan.myDay', myDay);
      c.on('role', () => { memo.clear(); });
      c.on('logout', () => { closeSheet(); });
    },
    mount(el) {
      root = el;
      el.addEventListener('click', onRootClick);
      el.addEventListener('change', onRootChange);
      const resync = () => { syncOffsets(); if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(syncOffsets); };
      window.addEventListener('resize', resync);
      window.addEventListener('orientationchange', resync);
      if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') window.visualViewport.addEventListener('resize', resync);
    },
    render(el, c) { renderScreen(el, c); },
    show(c, params) {
      const prm = params && typeof params === 'object' ? params : {};
      const m = typeof prm.month === 'string' && /^\d{4}-\d{2}$/.test(prm.month) ? prm.month : (ui.month || monthOf(c.selectedDate() || today()));
      if (!ui.seg) ui.seg = defaultSeg(c);
      if (prm.seg && SEGS.some(s => s.id === prm.seg)) ui.seg = prm.seg;
      ui.month = m;
      ui.scrollToday = true;
      loadDrafts(m);
      ensureMonth(c);
    },
    hide(c) {
      closeSheet();
      dropAllDrafts();   // canLeave asked first (R2-SPEC §4.4)
      restoreRange(c || core);
    },
    canLeave() { return anyDraft() ? MSG.leave : true; },
    reset() {
      closeSheet();
      if (sheetEl) { sheetEl.remove(); sheetEl = null; }
      ui.month = ''; ui.seg = ''; ui.busy = ''; ui.showConflicts = false; ui.sheet = null; ui.suggest = ''; ui.scrollToday = false; ui.moved = false;
      Object.keys(drafts.roster).forEach(k => delete drafts.roster[k]);
      Object.keys(drafts.duties).forEach(k => delete drafts.duties[k]);
      Object.keys(drafts.loaded).forEach(k => delete drafts.loaded[k]);
      Object.keys(repairOn).forEach(k => delete repairOn[k]);
      Object.keys(fillNotes).forEach(k => delete fillNotes[k]);
      Object.keys(patchSet).forEach(k => delete patchSet[k]);
      memo.clear();
      if (root) { root.innerHTML = ''; root._html = ''; }
    }
  });
})();
