/* =====================================================================
 * js/feat-dashboard.js — "Dashboard ของฉัน" and "Dashboard ทีม" (R3-SPEC §4.5, §0.4, §0.5, §0.20, §5; track DB)
 *
 *  - Screen 'dashboard' (เมนู → ของฉัน, order 10, icon bar-chart) and screen 'team-dashboard' (งานหัวหน้า, order 45,
 *    Supervisor only); both visible only while core.serverHas('stats').
 *  - Period bar (both screens, one device preference 'dashPeriod'): chips ปีงบประมาณ · ปีปฏิทิน · รายเดือน · กำหนดเอง,
 *    ‹ › steppers (not for กำหนดเอง), the period label under the chips — FIX-DB D-5: two lines at most ("ปีงบประมาณ 2570" /
 *    "1 ต.ค. 2569 – 30 ก.ย. 2570", every date a nowrap span); the steppers get a row of their own when the card is narrower
 *    than 18.25em (container query: a 360 px phone at 100 % text, follows the text size); กำหนดเอง = two native date inputs (≤ 400 days,
 *    else the inline error "ช่วงวันที่ต้องไม่เกิน 400 วัน"). periodRange(kind, anchor, to?) is a pure helper (also
 *    core.provide('dashboard.periodRange')): the Thai fiscal year runs 1 ต.ค. – 30 ก.ย. and is named by its end year in พ.ศ.
 *  - Data: core.ensureRange(min(period.from, asOf + 1), max(period.to, fiscal-year end, today + 6)) for days and leaves
 *    (reloaded with force in the background when older than 10 minutes this session — D-1: single-flight per core range,
 *    the time is taken when the reload starts and put back when it fails); plan duties and holidays through
 *    core.use('plan').fetchStats (the period, the current fiscal year for the vacation holidays, and the days between the
 *    earliest asOf and the fiscal year when needed — D-2: in pieces of ≤ 400 days; a failed read whose holidays matter makes
 *    the vacation card "missing" with ลองใหม่, never another figure); plan.ensure(today, today + 6) for the upcoming list.
 *    Saved days only.
 *  - Statistics come ONLY from window.PlanEngine (vacationBalance, personStats, teamStats) on those inputs — this file never
 *    interprets an absence or a Portable line itself (parity rule, R3-SPEC §5). Fairness and incomplete days aggregate the
 *    engine's results / the saved days against core.state.stationCounts and PlanEngine.isWorkingDay.
 *  - Person cards (my view; the team's person view uses the same renderer): พักร้อนคงเหลือ, คะแนนใบประกอบ, สถิติการลา,
 *    การอยู่ Station, จำนวนเวร (only the notice without a plan), เวร 7 วันข้างหน้า (my view only; all 7 dates, "ไม่มีเวร" in
 *    grey). Month lists show only months with leave + "แสดงทุกเดือน" / "ซ่อนเดือนที่ไม่มีการลา" (D-9). Edit sheets (vacation;
 *    CE points / licence; a พ.ศ. caption under each date input, D-10) save with ONE plan.setProfiles each (own row, or
 *    anyone's for the Supervisor).
 *  - Team screen (D-7 order): ปัญหาค้าง (core.use('problems'); hidden while that service is missing; ensure() again on every
 *    'data' event while the screen is current, D-4) → วันที่จัดคนไม่ครบ → ความเท่าเทียมของเวร → the list (filter chips,
 *    "เรียงตาม" select, search; rows below 768 px with the meta "ทำงาน N วัน · ลา N · Portable N · กลางวัน N · ภารกิจ N ·
 *    พักร้อนคงเหลือ X | ยังไม่กรอกพักร้อน", a sortable table (aria-sort, sticky name column) from 768 px) →
 *    การลารายเดือนแยกประเภท. Row tap → person view (D-6: header title = the name via core.setScreenTitle; the header ←, the
 *    inline ← and Android/browser back return to the list with its scroll kept — R3 F-3: the screen's back hook def.back). Excel (.xlsx) through window.XlsxLite (button hidden without it; สาย 1 … สาย L, D-3).
 *  - States: skeleton per card while its data loads (data-loading), offline copy caption, "ยังไม่มีตารางเวรในช่วงนี้" when
 *    the plan has nothing for the period.
 * Every async flow runs through core.spawn / core.track and re-checks core.alive() after it resolves.
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !App.core || !window.PlanEngine || !window.Utils) return;
  const PE = window.PlanEngine;
  const UT = window.Utils;

  const ID_ME = 'dashboard';
  const ID_TEAM = 'team-dashboard';
  const PREF = 'dashPeriod';
  const MAX_DAYS = 400;
  const STALE_MS = 10 * 60 * 1000;
  const INCOMPLETE_SHOWN = 20;
  const KINDS = [
    { id: 'fy', label: 'ปีงบประมาณ' },
    { id: 'year', label: 'ปีปฏิทิน' },
    { id: 'month', label: 'รายเดือน' },
    { id: 'custom', label: 'กำหนดเอง' }
  ];
  const SORTS = [
    { id: 'name', label: 'ชื่อ', short: 'ชื่อ' },
    { id: 'worked', label: 'วันทำงาน', short: 'ทำงาน' },
    { id: 'leave', label: 'วันลา', short: 'ลา' },
    { id: 'vac', label: 'พักร้อนคงเหลือ', short: 'พักร้อน' },
    { id: 'lines', label: 'สาย Portable', short: 'Portable' },
    { id: 'lunch', label: 'เวรกลางวัน', short: 'กลางวัน' },
    { id: 'mission', label: 'ภารกิจ', short: 'ภารกิจ' }
  ];
  const FILTERS = [
    { id: 'all', label: 'ทั้งหมด' },
    { id: 'regular', label: 'คนประจำ' },
    { id: 'backup', label: 'ทีมแทนเวร' }
  ];
  const FAIR_KINDS = [
    { id: 'lines', label: 'สาย Portable' },
    { id: 'lunch', label: 'เวรกลางวัน' },
    { id: 'mission', label: 'ภารกิจพิเศษ' }
  ];
  const MSG = {
    range: 'ช่วงวันที่ต้องไม่เกิน 400 วัน',
    cached: 'ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)',
    noPlan: 'ยังไม่มีตารางเวรในช่วงนี้',
    vacHint: 'ระบบจะหักวันลาพักร้อนที่อนุมัติแล้ว ซึ่งเป็นวันทำการหลังวันที่นี้ นับถึงสิ้นปีงบประมาณ',
    badVacation: 'ยอดพักร้อนต้องเป็น 0–365 วัน (ทีละครึ่งวัน) พร้อมวันที่ของยอด ซึ่งต้องไม่เกินวันนี้และไม่เก่ากว่า 400 วัน',
    badCe: 'คะแนนต้องเป็นตัวเลข 0–9,999',
    badExpiry: 'วันหมดอายุใบประกอบไม่ถูกต้อง',
    vacSaved: '✅ บันทึกยอดพักร้อนแล้ว',
    ceSaved: '✅ บันทึกคะแนนแล้ว',
    xlsx: '📥 ดาวน์โหลด Excel แล้ว',
    gone: ' (ลบแล้ว)',
    missing: 'ยังไม่มีข้อมูลช่วงนี้ในเครื่อง',
    missingHint: 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    // FIX-DB D-8 / D-9 (R3-FIXLIST, exact wording)
    vacIgnored: n => 'ลาพักร้อนตรงวันหยุด ' + n + ' วัน (ไม่หักยอด)',
    vacDays: n => 'หักยอดพักร้อนจริง ' + n + ' วัน (เฉพาะวันทำการ)',
    lineNone: n => 'Portable ที่ไม่ได้ระบุสาย ' + n + ' วัน',
    fairLegend: '↑ ได้เวรมากกว่าเพื่อน · ↓ ได้เวรน้อยกว่าเพื่อน (ต่างจากค่าเฉลี่ยตั้งแต่ 2 ครั้ง หรือ 25 %)',
    vacNotEntered: 'ยังไม่กรอกพักร้อน',
    monthsAll: 'แสดงทุกเดือน',
    monthsHide: 'ซ่อนเดือนที่ไม่มีการลา',
    monthsNone: 'ยังไม่มีการลาในช่วงนี้',
    upNone: 'ไม่มีเวร'
  };
  const GROUP_LABEL = { regular: 'คนประจำ', backup: 'ทีมแทนเวร', gone: 'ลบแล้ว' };

  let core = null;
  let gen = 0;                    // bumps at logout / a new login: late answers of the old session are dropped
  let sheetEl = null;
  const roots = {};               // screen id → root element
  const stats = new Map();        // 'from|to' → {state: 'loading'|'ready'|'error', val, version, p}
  const loadedAt = new Map();     // 'from|to' (core range) → ms of the last (started) ensureRange of this session
  const reloading = new Set();    // FIX-DB D-1: 'from|to' core ranges whose forced background reload is running
  const ui = {
    anchor: '',                   // a date inside the shown period (fy / year / month)
    kind: '',                     // '' = not read from the preference yet
    customFrom: '', customTo: '', // the custom inputs as typed
    customError: '',
    lastCustom: null,             // {from, to} of the last valid custom range
    team: { filter: 'all', q: '', sort: 'name', dir: 'asc', person: '', scrollY: 0 },
    sheet: null,                  // {kind: 'vac'|'ce', name}
    problemsAsked: false,
    problemsBusy: false,          // D-4: a problems ensure() of the data-event refresh is running
    allMonths: { leaves: false, team: false }   // D-9: month lists show every month (else only months with leave)
  };

  /* ---------------------------------------------------------------- small helpers */
  const U = () => core.U;
  const K = () => core.Kit.cls;
  const esc = s => core.esc(s);
  const icon = (n, c) => core.Kit.icon(n, c);
  const today = () => U().todayStr();
  function P() { const p = core && core.use('plan'); return p && typeof p === 'object' ? p : null; }
  function minD(a, b) { return !a ? b : !b ? a : a < b ? a : b; }
  function maxD(a, b) { return !a ? b : !b ? a : a > b ? a : b; }
  function num(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '–';
    return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
  }
  function sum(list) { return list.reduce((a, b) => a + b, 0); }
  function monthLabel(m) { const s = UT.thaiDateShort(m + '-01'); return s.replace(/^1 /, ''); }
  function isGoneName(n, act) { return !(act || activeSet()).has(n); }
  function activeSet() { return new Set(core.staff().map(s => s.name)); }
  function groupOf(n) {
    const s = core.staff().filter(x => x.name === n)[0];
    return s ? (s.group === 'backup' ? 'backup' : 'regular') : 'gone';
  }
  function nameLabel(n) { return n + (isGoneName(n) ? MSG.gone : ''); }

  /* ---------------------------------------------------------------- period (pure) */
  function fyEndYear(d) { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 10 ? y + 1 : y; }
  function pad4(y) { return String(y).padStart(4, '0'); }
  function made(kind, from, to, head, withDates) {
    const dates = withDates ? [UT.thaiDateShort(from), UT.thaiDateShort(to)] : null;
    const label = [head, dates ? dates.join(' – ') : ''].filter(Boolean).join(' · ');
    return Object.freeze({ kind, from, to, label, head, dates: dates ? Object.freeze(dates) : null,
      days: UT.daysBetweenInclusive(from, to), valid: true, error: '' });
  }
  /**
   * The statistics period of `kind` around `anchor` ('YYYY-MM-DD'; invalid → today): 'fy' = the Thai fiscal year holding the
   * anchor (1 ต.ค. – 30 ก.ย., named by its end year in พ.ศ.), 'year' = the calendar year, 'month' = the month, 'custom' =
   * [anchor, to] (≤ 400 days). → frozen {kind, from, to, label, head, dates, days, valid, error}; label = the one-line text
   * ("ปีงบประมาณ 2570 · 1 ต.ค. 2569 – 30 ก.ย. 2570"); head ('ปีงบประมาณ 2570' / 'ปี 2569' / 'พฤศจิกายน 2569' / '' for custom) and
   * dates ([first, last] Thai short dates for fy / custom, else null) are the two lines of the period bar (FIX-DB D-5). An
   * invalid custom range has valid false and error "ช่วงวันที่ต้องไม่เกิน 400 วัน". Pure (no state, no DOM).
   */
  function periodRange(kind, anchor, to) {
    if (kind === 'custom') {
      const f = typeof anchor === 'string' ? anchor : '', t = typeof to === 'string' ? to : '';
      if (!UT.isValidYmd(f) || !UT.isValidYmd(t) || f > t || UT.daysBetweenInclusive(f, t) > MAX_DAYS) {
        return Object.freeze({ kind: 'custom', from: f, to: t, label: '', head: '', dates: null, days: 0, valid: false, error: MSG.range });
      }
      return made('custom', f, t, '', true);
    }
    const a = UT.isValidYmd(anchor) ? anchor : UT.todayStr();
    if (kind === 'year') {
      const y = +a.slice(0, 4);
      return made('year', pad4(y) + '-01-01', pad4(y) + '-12-31', 'ปี ' + (y + 543), false);
    }
    if (kind === 'month') {
      const r = UT.monthRange(a);
      return made('month', r.from, r.to, UT.thaiMonthYear(a), false);
    }
    const e = fyEndYear(a);
    const from = pad4(e - 1) + '-10-01', end = pad4(e) + '-09-30';
    return made('fy', from, end, 'ปีงบประมาณ ' + (e + 543), true);
  }
  /** The anchor of the neighbouring period (dir −1 / 1) of a fy / year / month period. */
  function stepAnchor(kind, anchor, dir) {
    const r = periodRange(kind, anchor);
    return UT.addMonths(r.from, kind === 'month' ? dir : 12 * dir) + '-01';
  }

  function loadPref() {
    if (ui.kind) return;
    const v = core.store.prefs.get(PREF, null);
    const kind = v && typeof v === 'object' && KINDS.some(k => k.id === v.kind) ? v.kind : 'fy';
    ui.kind = kind;
    ui.anchor = today();
    if (kind === 'custom') {
      const r = periodRange('custom', v.from, v.to);
      if (r.valid) { ui.lastCustom = { from: r.from, to: r.to }; ui.customFrom = r.from; ui.customTo = r.to; }
      else ui.kind = 'fy';
    }
  }
  function savePref() {
    const v = { kind: ui.kind };
    if (ui.kind === 'custom' && ui.lastCustom) { v.from = ui.lastCustom.from; v.to = ui.lastCustom.to; }
    core.store.prefs.set(PREF, v);
  }
  /** The period shown now (always valid: an invalid custom input keeps the last valid range). */
  function period() {
    loadPref();
    if (ui.kind === 'custom' && ui.lastCustom) return periodRange('custom', ui.lastCustom.from, ui.lastCustom.to);
    return periodRange(ui.kind === 'custom' ? 'fy' : ui.kind, ui.anchor || today());
  }

  /* ---------------------------------------------------------------- data */
  function profileOf(name) { const p = P(); return p ? p.profile(name) : null; }
  /** The entered balance of a profile ({days, asOf}) or null (not entered / not delivered). */
  function balanceOf(pr) {
    return pr && typeof pr.vacBalance === 'number' && isFinite(pr.vacBalance) && UT.isValidYmd(pr.vacAsof) ? { days: pr.vacBalance, asOf: pr.vacAsof } : null;
  }
  /** Ranges one view needs: the period, the fiscal year of today, the vacation range and the core (days/leaves) range. */
  function needs(names, upcoming) {
    const t = today();
    const fy = periodRange('fy', t);
    const per = period();
    let vacFrom = fy.from;
    names.forEach(n => { const b = balanceOf(profileOf(n)); if (b) vacFrom = minD(vacFrom, UT.addDays(b.asOf, 1)); });
    const upTo = UT.addDays(t, 6);
    return {
      t, fy, per, vacFrom, upTo,
      pre: preRanges(vacFrom, fy.from),
      coreFrom: minD(per.from, vacFrom),
      coreTo: maxD(maxD(per.to, fy.to), upcoming ? upTo : '')
    };
  }
  /**
   * FIX-DB D-2: the vacation days before the fiscal year ([vacFrom, fyFrom − 1]) as fetchStats pieces of ≤ 400 days
   * (fetchStats refuses longer ranges), counted forward from vacFrom (stable keys for the same balance). → [{from, to}]
   */
  function preRanges(vacFrom, fyFrom) {
    const out = [];
    const last = UT.addDays(fyFrom, -1);
    let f = vacFrom, guard = 0;
    while (f <= last && guard++ < 20) {
      const t = minD(UT.addDays(f, MAX_DAYS - 1), last);
      out.push({ from: f, to: t });
      f = UT.addDays(t, 1);
    }
    return out;
  }
  function namesOf(screen) {
    if (screen === ID_ME) return [core.myName()];
    return core.staff().map(s => s.name);
  }
  function statsEntry(from, to) { return stats.get(from + '|' + to) || null; }
  /** Starts (or reuses) plan.fetchStats(from, to); renders when an answer changes what is shown. */
  function loadStats(c, from, to) {
    const key = from + '|' + to;
    let e = stats.get(key);
    if (e && e.p) return e;
    if (!e) { e = { state: 'loading', val: null, version: null, p: null }; stats.set(key, e); }
    const p = P();
    if (!p || typeof p.fetchStats !== 'function') { e.state = 'error'; return e; }
    const alive = c.alive(), g = gen;
    const entry = e;
    entry.p = c.track(p.fetchStats(from, to).then(v => {
      if (!alive() || g !== gen) return;
      entry.p = null;
      const changed = entry.state !== 'ready' || entry.version !== (v && v.version) || !entry.val;
      entry.state = 'ready';
      entry.val = v;
      entry.version = v && v.version;
      if (changed) c.render();
    }, () => {
      if (!alive() || g !== gen) return;
      entry.p = null;
      const was = entry.state;
      if (!entry.val) entry.state = 'error';
      if (was !== entry.state) c.render();
    }));
    return entry;
  }
  /** Everything the current screen needs (cheap when it is already there): days/leaves, plan stats, upcoming, problems. */
  function ensureData(c, screen) {
    if (!c.state.user || !c.state.session || !c.serverHas('stats')) return;
    const n = needs(namesOf(screen), screen === ID_ME);
    const key = n.coreFrom + '|' + n.coreTo;
    const at = loadedAt.get(key);
    const force = !!at && Date.now() - at > STALE_MS;
    const g = gen;
    // FIX-DB D-1: the forced background reload is single-flight per core range. Every chunk of it emits a 'data' event
    // (→ onData → here): while it runs no second forced reload starts, and loadedAt is set when it STARTS (so the events
    // of its own chunks ask for a plain, already-covered ensureRange); a failed reload puts the previous time back.
    if (!(force && reloading.has(key))) {
      if (force) { reloading.add(key); loadedAt.set(key, Date.now()); }
      c.spawn(async () => {
        let ok = false;
        try {
          await c.ensureRange(n.coreFrom, n.coreTo, force ? { force: true } : undefined);
          ok = true;
        } finally {
          if (g === gen) {
            if (force) reloading.delete(key);
            if (ok) loadedAt.set(key, Date.now());
            else if (force) loadedAt.set(key, at);
          }
        }
      }, { quiet: true });
    }
    loadStats(c, n.per.from, n.per.to);
    loadStats(c, n.fy.from, n.fy.to);
    n.pre.forEach(r => loadStats(c, r.from, r.to));
    const p = P();
    if (screen === ID_ME && p && typeof p.ensure === 'function') c.spawn(() => p.ensure(n.t, n.upTo), { quiet: true });
    if (screen === ID_TEAM && !ui.problemsAsked) {
      ui.problemsAsked = true;
      ensureProblems(c);
    }
  }
  /**
   * D-4: the open problems of the team screen — problems.ensure() (free when the domain's version equals the server's),
   * then a render; single-flight. Runs at show and on every 'data' event while the team screen is current.
   */
  function ensureProblems(c) {
    const svc = problemsSvc(c);
    if (!svc || typeof svc.ensure !== 'function' || ui.problemsBusy) return;
    ui.problemsBusy = true;
    const g = gen, alive = c.alive();
    c.spawn(() => Promise.resolve(svc.ensure()).then(() => true, () => false).then(() => {
      if (g !== gen) return;
      ui.problemsBusy = false;
      if (alive() && c.current() === ID_TEAM) c.render();
    }), { quiet: true });
  }
  /** 'ready' | 'cached' | 'loading' | 'missing' of every date in [from, to]. */
  function rangeState(c, from, to) {
    let loading = false, cached = false, missing = false;
    UT.eachDate(from, to).forEach(d => {
      const v = c.dayView(d);
      if (v === 'loading') loading = true;
      else if (v === 'cached') cached = true;
      else if (v === 'missing') missing = true;
    });
    return loading ? 'loading' : missing ? 'missing' : cached ? 'cached' : 'ready';
  }
  /** Holidays of the given stats entries merged with the plan domain's (Map date → name). */
  function holidaysOf(entries) {
    const p = P();
    const m = p ? p.holidays() : new Map();
    entries.forEach(e => { if (e && e.val && e.val.holidays) e.val.holidays.forEach((v, k) => m.set(k, v)); });
    return m;
  }
  function planOk() { const p = P(); return !p || p.ready() || !p.loading(); }
  /**
   * D-2: the years whose holidays the plan domain holds completely (persisted, read through core.domain('plan'): a getPlan
   * answer carries every holiday of the years its range touches) → [year]
   */
  function heldHolidayYears(c) {
    try { const d = c.domain('plan').data; return d && Array.isArray(d.holidayYears) ? d.holidayYears : []; } catch (e) { return []; }
  }

  /** The engine inputs of a view (computed per render; saved days only). */
  function model(c, screen) {
    const n = needs(namesOf(screen), screen === ID_ME);
    const p = P();
    const perStats = statsEntry(n.per.from, n.per.to);
    const fyStats = statsEntry(n.fy.from, n.fy.to);
    const preStats = n.pre.map(r => statsEntry(r.from, r.to));
    const vacEntries = [fyStats].concat(preStats);
    const perState = rangeState(c, n.per.from, n.per.to);
    const dayVacState = rangeState(c, n.vacFrom, n.fy.to);
    const upState = screen === ID_ME ? rangeState(c, n.t, n.upTo) : 'ready';
    const statsLoading = !perStats || perStats.state === 'loading';
    const vacStatsLoading = vacEntries.some(e => !e || e.state === 'loading');
    const vacLeaves = p ? p.leaves(n.vacFrom, n.fy.to) : [];
    // D-2: a vacation range whose holidays could not be read (a failed statistics read) makes the balance unknown — the
    // card's missing state with "ลองใหม่", never a silently different figure. Only dates that matter count: a leave row
    // of a shown person on a date whose holidays are known neither from a statistics answer nor from the plan domain.
    let vacUnknown = false;
    if (!vacStatsLoading && vacEntries.some(e => e.state === 'error')) {
      const ranges = [{ from: n.fy.from, to: n.fy.to }].concat(n.pre);
      const held = heldHolidayYears(c);
      const who = screen === ID_ME ? new Set(namesOf(screen)) : null;   // the team: every row (deleted people included)
      const known = d => held.indexOf(+d.slice(0, 4)) >= 0 || ranges.some((r, i) => !!vacEntries[i] && !!vacEntries[i].val && d >= r.from && d <= r.to);
      vacUnknown = vacLeaves.some(l => l && (!who || who.has(l.staff)) && !known(l.date));
    }
    const vacState = vacUnknown && dayVacState !== 'loading' ? 'missing' : dayVacState;
    const duties = perStats && perStats.val ? perStats.val.duties : {};
    return {
      n, p,
      perState, vacState, upState,
      perReady: (perState === 'ready' || perState === 'cached') && !statsLoading,
      vacReady: (vacState === 'ready' || vacState === 'cached') && !vacStatsLoading && planOk(),
      planGone: !c.serverHas('plan') || !perStats || perStats.state === 'error' || !Object.keys(duties || {}).length,
      cached: [perState, vacState, upState].indexOf('cached') >= 0,
      duties: duties || {},
      holidays: holidaysOf([perStats]),
      vacHolidays: holidaysOf(vacEntries),
      leaves: p ? p.leaves(n.per.from, n.per.to) : [],
      vacLeaves
    };
  }
  function vacationOf(m, name) {
    const bal = balanceOf(profileOf(name));
    return PE.vacationBalance({ staff: name, balance: bal, leaves: m.vacLeaves, holidays: m.vacHolidays, today: m.n.t,
      since: bal ? undefined : UT.addDays(m.n.fy.from, -1) });
  }
  function statsOf(c, m, name, from, to) {
    return PE.personStats({ name, from: from || m.n.per.from, to: to || m.n.per.to, today: m.n.t, days: c.state.days,
      duties: m.duties, leaves: m.leaves, holidays: m.holidays });
  }
  /** Month slices of the period: [{month, from, to}]. */
  function monthSlices(per) {
    const out = [];
    let mk = per.from.slice(0, 7);
    const last = per.to.slice(0, 7);
    let guard = 0;
    while (mk <= last && guard++ < 40) {
      const r = UT.monthRange(mk);
      out.push({ month: mk, from: maxD(r.from, per.from), to: minD(r.to, per.to) });
      mk = UT.addMonths(mk, 1);
    }
    return out;
  }
  function lineTotal(ps) { return sum(Object.keys(ps.lines).filter(k => k !== 'none').map(k => ps.lines[k])); }
  function lunchTotal(ps) { return ps.lunch.er.served + ps.lunch.er.scheduled + ps.lunch.ipd.served + ps.lunch.ipd.scheduled; }
  function missionTotal(ps) { return ps.mission.served + ps.mission.scheduled; }
  function lineCount(ps) {
    let n = core.state.stationCounts.portable || 3;
    Object.keys(ps.lines).forEach(k => { if (k !== 'none' && +k > n) n = +k; });
    return n;
  }

  /* ---------------------------------------------------------------- markup helpers */
  function card(id, title, ic, body, opts) {
    const k = K();
    const o = opts || {};
    return `<section class="${k.card} min-w-0" data-dash-card="${id}"${o.loading ? ' data-loading="1"' : ''}>` +
      `<div class="${k.cardHead} mb-2"><span class="${k.listIcon} ${o.tone || k.listIconBrand}">${icon(ic, 'w-5 h-5')}</span>` +
      `<h3 class="${k.titleCard} flex-1 min-w-0 break-words">${esc(title)}</h3>${o.action || ''}</div>${body}</section>`;
  }
  function loadingCard(id, title, ic) { return card(id, title, ic, core.Kit.skeleton(3), { loading: true }); }
  function missingCard(id, title, ic) {
    const k = K();
    return card(id, title, ic, `<p class="${k.textBody}" data-dash-missing>${esc(MSG.missing)}</p><p class="${k.textMeta}">${esc(MSG.missingHint)}</p>` +
      `<button type="button" class="${k.btn} ${k.btnSecondary} w-full mt-2" data-dash-act="retry">${icon('refresh', 'w-5 h-5')}ลองใหม่</button>`);
  }
  function stateCard(st, id, title, ic) {
    if (st === 'missing') return missingCard(id, title, ic);
    return loadingCard(id, title, ic);
  }
  function editBtn(act, label) {
    const k = K();
    return `<button type="button" class="${k.btn} ${k.btnTonal} ${k.btnCompact} shrink-0" data-dash-act="${act}">${icon('pencil', 'w-4 h-4')}${esc(label)}</button>`;
  }
  function bar(pct, cls, style) {
    const w = Math.max(0, Math.min(100, Math.round(pct)));
    return `<div class="h-2.5 rounded-full bg-lilac-50 overflow-hidden"><div class="h-full rounded-full ${cls}" style="width:${w}%${style || ''}"></div></div>`;
  }
  function numSpan(key, v, cls) { return `<span class="tabular-nums ${cls || ''}" data-dash-num="${key}">${esc(num(v))}</span>`; }
  /** A MSG template (n → text) with its number as a numSpan (the wording stays in MSG). */
  function numText(tpl, key, v) {
    const MARK = '\u0001';
    return tpl(MARK).split(MARK).map(esc).join(numSpan(key, v));
  }
  /**
   * D-9: a month list — only the months with leave, a ghost toggle "แสดงทุกเดือน" / "ซ่อนเดือนที่ไม่มีการลา" (when some months
   * have none), or "ยังไม่มีการลาในช่วงนี้" when no month has any. items: [{month, chips}] (chips '' = no leave).
   */
  function monthList(items, which, attr, cls) {
    const k = K();
    const withLeave = items.filter(x => x.chips);
    if (!withLeave.length) return `<p class="${k.textBody} ${cls || ''}" data-dash-months-none="${which}">${esc(MSG.monthsNone)}</p>`;
    const all = !!ui.allMonths[which];
    const shown = all ? items : withLeave;
    const lis = shown.map(x => `<li class="flex flex-wrap items-center gap-1.5 py-1.5" ${attr}="${x.month}"><span class="w-20 shrink-0 ${k.textMeta}">${esc(monthLabel(x.month))}</span>` +
      (x.chips || `<span class="${k.textMeta}">–</span>`) + `</li>`).join('');
    const toggle = withLeave.length < items.length
      ? `<button type="button" class="${k.btn} ${k.btnGhost} w-full mt-1" data-dash-act="months" data-dash-months-toggle="${which}" aria-expanded="${all}">` +
        `${icon(all ? 'chevron-up' : 'chevron-down', 'w-5 h-5')}${esc(all ? MSG.monthsHide : MSG.monthsAll)}</button>` : '';
    return `<ul class="divide-y divide-brand-50 ${cls || ''}" data-dash-months="${which}">${lis}</ul>${toggle}`;
  }

  /* ---------------------------------------------------------------- period bar */
  function periodBarHtml() {
    const k = K();
    const per = period();
    const chips = KINDS.map(x => {
      const on = x.id === ui.kind;
      return `<button type="button" class="${k.chip} ${on ? k.chipOn : k.chipOff}" data-dash-kind="${x.id}" aria-pressed="${on}">${esc(x.label)}</button>`;
    }).join('');
    let html = `<div class="${k.card} space-y-2" data-dash-period="${esc(ui.kind)}" data-from="${per.from}" data-to="${per.to}">` +
      `<div class="flex flex-wrap gap-2" role="group" aria-label="ช่วงเวลาของสถิติ">${chips}</div>`;
    if (ui.kind === 'custom') {
      // I2: side by side only when each date field gets 8.5rem, else stacked (index.html summary range pattern) — a native
      // date field that will not get narrower (iOS) never leaves the card
      html += `<div class="flex flex-wrap gap-2">` +
        `<div class="flex-1 basis-[8.5rem] max-w-full"><label class="${k.label}" for="dashFrom">ตั้งแต่</label><input type="date" id="dashFrom" class="${k.input} min-w-0" data-dash-custom="from" value="${esc(ui.customFrom)}"></div>` +
        `<div class="flex-1 basis-[8.5rem] max-w-full"><label class="${k.label}" for="dashTo">ถึง</label><input type="date" id="dashTo" class="${k.input} min-w-0" data-dash-custom="to" value="${esc(ui.customTo)}"></div></div>` +
        `<p class="${k.fieldError}${ui.customError ? '' : ' hidden'}" role="alert" data-dash-custom-error>${esc(ui.customError)}</p>` +
        `<p class="${k.textMeta}" data-dash-period-label aria-live="polite">${datesHtml(per)}</p>`;
    } else {
      // D-5: the label is a full-width block of at most two lines (the name, then the dates). When the card is narrower
      // than 18.25em (= a 360 px phone at 100 % text; a container query in em, so it follows the text size: 130 % text on a
      // 375 px phone stacks too) the steppers leave the label's row and sit on a row of their own (‹ left, › right), so
      // the label is never squeezed. Without container queries (old iOS) the stacked layout stays.
      html += `<div class="[container-type:inline-size]" data-dash-period-box><div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1" data-dash-period-row>` +
        `<button type="button" class="${k.iconBtnRound} order-2 [@container_(min-width:18.25em)]:order-1" data-dash-step="-1" aria-label="ช่วงก่อนหน้า">${icon('chevron-left', 'w-5 h-5')}</button>` +
        `<p class="order-1 basis-full min-w-0 text-center [@container_(min-width:18.25em)]:order-2 [@container_(min-width:18.25em)]:basis-0 [@container_(min-width:18.25em)]:flex-1" data-dash-period-label aria-live="polite">` +
        `<span class="block ${k.titleCard} whitespace-nowrap" data-dash-period-head data-dash-nowrap>${esc(per.head)}</span>` +
        (per.dates ? ` <span class="block ${k.textMeta}" data-dash-period-dates>${datesHtml(per)}</span>` : '') + `</p>` +
        `<button type="button" class="${k.iconBtnRound} order-3" data-dash-step="1" aria-label="ช่วงถัดไป">${icon('chevron-right', 'w-5 h-5')}</button></div></div>`;
    }
    return html + `</div>`;
  }
  /** "1 ต.ค. 2569 – 30 ก.ย. 2570": each date in a nowrap span (a line may break only around the dash). */
  function datesHtml(per) {
    if (!per.dates) return esc(per.label);
    return per.dates.map(d => `<span class="whitespace-nowrap" data-dash-nowrap>${esc(d)}</span>`).join(' – ');
  }

  /* ---------------------------------------------------------------- person cards */
  function vacationCard(c, m, name, canEdit) {
    const k = K();
    const T = 'พักร้อนคงเหลือ', IC = 'calendar';
    if (!m.vacReady) return stateCard(m.vacState === 'missing' ? 'missing' : 'loading', 'vacation', T, IC);
    const v = vacationOf(m, name);
    const usedLine = `<p class="${k.textBody}" data-dash-vac-line>ใช้ไป ${numSpan('used', v.used)} · ลงล่วงหน้า ${numSpan('scheduled', v.scheduled)} · รออนุมัติ ${numSpan('pending', v.pending)}</p>` +
      (v.ignoredNonWorking > 0 ? `<p class="${k.textMeta}" data-dash-vac-ignored>${numText(MSG.vacIgnored, 'ignored', v.ignoredNonWorking)}</p>` : '');
    if (!v.known) {
      return card('vacation', T, IC,
        `<p class="${k.textBody} font-medium" data-dash-vac-none>ยังไม่ได้กรอกยอดพักร้อน</p>` +
        `<p class="${k.textMeta}">นับตั้งแต่ ${esc(UT.thaiDateShort(m.n.fy.from))}</p>` + usedLine +
        (canEdit ? `<button type="button" class="${k.btn} ${k.btnPrimary} w-full mt-3" data-dash-act="edit-vac">${icon('pencil', 'w-5 h-5')}กรอกยอด</button>` : ''),
        { tone: k.listIconInfo });
    }
    const head = v.overdrawn
      ? `<p class="font-display text-2xl font-semibold leading-9 text-coral-700" data-dash-vac-over>เกินสิทธิ์ ${numSpan('over', -v.remaining)} วัน</p>`
      : `<p class="font-display text-2xl font-semibold leading-9 text-ink-900" data-dash-vac-remaining>คงเหลือ ${numSpan('remaining', v.remaining)} วัน</p>`;
    return card('vacation', T, IC, head + usedLine +
      `<div class="flex items-center gap-2 mt-3 pt-3 border-t border-brand-100"><p class="flex-1 min-w-0 ${k.textMeta} break-words" data-dash-vac-asof>` +
      `ยอด ณ สิ้นวันที่ ${esc(UT.thaiDateShort(v.asOf))}: ${esc(num(v.days))} วัน</p>${canEdit ? editBtn('edit-vac', 'แก้ไข') : ''}</div>`,
      { tone: v.overdrawn ? k.listIconDanger : k.listIconInfo });
  }
  function ceCard(c, m, name, canEdit) {
    const k = K();
    const T = 'คะแนนใบประกอบ', IC = 'check-circle';
    if (!planOk()) return loadingCard('ce', T, IC);
    const pr = profileOf(name) || {};
    const pts = typeof pr.cePoints === 'number' ? pr.cePoints : null;
    const tgt = typeof pr.ceTarget === 'number' ? pr.ceTarget : null;
    const exp = UT.isValidYmd(pr.licenceExpiry) ? pr.licenceExpiry : '';
    let body = '';
    if (pts === null && tgt === null && !exp) {
      body = `<p class="${k.textBody}" data-dash-ce-none>ยังไม่ได้กรอกคะแนน</p>` +
        (canEdit ? `<button type="button" class="${k.btn} ${k.btnPrimary} w-full mt-3" data-dash-act="edit-ce">${icon('pencil', 'w-5 h-5')}กรอกคะแนน</button>` : '');
      return card('ce', T, IC, body, { tone: k.listIconLilac });
    }
    const p0 = pts === null ? 0 : pts;
    if (tgt !== null && tgt > 0) {
      body += `<p class="font-display text-2xl font-semibold leading-9 text-ink-900" data-dash-ce-points>${numSpan('ce', p0)} / ${numSpan('ce-target', tgt)} คะแนน</p>` +
        `<div class="mt-1" data-dash-ce-bar>${bar(p0 / tgt * 100, 'bg-lilac-500')}</div>`;
    } else {
      body += `<p class="font-display text-2xl font-semibold leading-9 text-ink-900" data-dash-ce-points>${numSpan('ce', p0)} คะแนน</p>`;
    }
    if (exp) {
      const left = UT.daysBetweenInclusive(m.n.t, exp) - 1;
      const tone = exp < m.n.t ? 'danger' : left <= 180 ? 'warn' : 'ok';
      const cls = tone === 'danger' ? 'text-coral-700 font-semibold' : tone === 'warn' ? 'text-amber-800 font-medium' : 'text-slate-700';
      const tail = exp < m.n.t ? ' — หมดอายุแล้ว' : ' (อีก ' + left + ' วัน)';
      body += `<p class="mt-2 text-sm leading-6 ${cls} break-words" data-dash-ce-expiry="${tone}">${tone !== 'ok' ? icon('alert-triangle', 'w-4 h-4 inline-block align-[-2px] mr-1') : ''}` +
        `ใบประกอบหมดอายุ ${esc(UT.thaiDateShort(exp))}${esc(tail)}</p>`;
    }
    if (canEdit) body += `<div class="flex justify-end mt-3">${editBtn('edit-ce', 'แก้ไข')}</div>`;
    return card('ce', T, IC, body, { tone: k.listIconLilac });
  }
  function typeChips(counts) {
    const k = K();
    return UT.LEAVE_TYPES.filter(t => counts[t] > 0)
      .map(t => `<span class="${k.tag}" data-dash-type="${esc(t)}">${esc(t)} <span class="tabular-nums ml-1">${counts[t]}</span></span>`).join('');
  }
  function leaveCard(c, m, name) {
    const k = K();
    const T = 'สถิติการลา', IC = 'calendar-off';
    if (!m.perReady) return stateCard(m.perState, 'leaves', T, IC);
    const ps = statsOf(c, m, name);
    const ap = ps.leaves.approved;
    const types = UT.LEAVE_TYPES.filter(t => ap[t] > 0);
    const pend = sum(Object.keys(ps.leaves.pending).map(t => ps.leaves.pending[t]));
    let body = types.length
      ? `<ul class="space-y-1" data-dash-leave-totals>${types.map(t => `<li class="flex items-center gap-2 ${k.textBody}"><span class="flex-1 min-w-0 break-words">${esc(t)}</span>` +
        `<span class="font-semibold tabular-nums" data-dash-leave="${esc(t)}">${ap[t]}</span></li>`).join('')}</ul>`
      : `<p class="${k.textBody}" data-dash-leave-none>ไม่มีวันลาที่อนุมัติในช่วงนี้</p>`;
    if (pend > 0) body += `<p class="mt-1 ${k.textMeta}" data-dash-leave-pending>รออนุมัติ ${numSpan('leave-pending', pend)}</p>`;
    body += `<p class="mt-1 ${k.textMeta}" data-dash-vacdays>${numText(MSG.vacDays, 'vacation-days', ps.leaves.vacationDays)}</p>`;
    const slices = monthSlices(m.n.per);
    // D-9: the month rows only when the period has approved leave (else the line above already says there is none)
    if (slices.length > 1 && types.length) {
      const items = slices.map(s => ({ month: s.month, chips: typeChips(statsOf(c, m, name, s.from, s.to).leaves.approved) }));
      body += `<div class="mt-3 pt-2 border-t border-brand-100">${monthList(items, 'leaves', 'data-dash-month')}</div>`;
    }
    return card('leaves', T, IC, body, { tone: k.listIconSun });
  }
  function stationCard(c, m, name) {
    const k = K();
    const T = 'การอยู่ Station', IC = 'bar-chart';
    if (!m.perReady) return stateCard(m.perState, 'stations', T, IC);
    const ps = statsOf(c, m, name);
    const max = Math.max.apply(null, UT.STATIONS.map(s => ps.stations[s.id] || 0).concat([1]));
    const rows = UT.STATIONS.map(s => {
      const n = ps.stations[s.id] || 0;
      return `<li class="space-y-1" data-dash-station="${s.id}"><div class="flex items-center gap-2 text-sm leading-5"><span class="flex-1 min-w-0 break-words text-ink-800">${esc(s.name)}</span>` +
        `<span class="font-semibold tabular-nums text-ink-900" data-dash-num="station-${s.id}">${n}</span></div>` +
        `<div class="h-2.5 rounded-full bg-lilac-50 overflow-hidden"><div class="h-full rounded-full" style="width:${Math.round(n / max * 100)}%;background:${s.border}"></div></div></li>`;
    }).join('');
    return card('stations', T, IC, `<p class="${k.textBody} mb-2" data-dash-worked>วันทำงานที่บันทึกแล้ว ${numSpan('worked', ps.daysWorked)} วัน</p><ul class="space-y-2">${rows}</ul>`);
  }
  function dutyCard(c, m, name) {
    const k = K();
    const T = 'จำนวนเวร', IC = 'activity';
    if (!m.perReady) return stateCard(m.perState, 'duties', T, IC);
    // D-9: without a plan for the period only the notice (no rows of zeros that look like real counts)
    if (m.planGone) return card('duties', T, IC, `<p class="${k.note}" data-dash-noplan>${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(MSG.noPlan)}</span></p>`, { tone: k.listIconSun });
    const ps = statsOf(c, m, name);
    const row = (label, val, key, extra) => `<li class="flex flex-wrap items-baseline gap-x-2 py-1.5"><span class="flex-1 min-w-0 break-words ${k.textBody}">${esc(label)}</span>` +
      `<span class="font-semibold tabular-nums text-ink-900" data-dash-num="${key}">${esc(num(val))}</span>${extra ? `<span class="w-full ${k.textMeta}">${extra}</span>` : ''}</li>`;
    let list = '';
    const L = lineCount(ps);
    for (let i = 1; i <= L; i++) list += row('Portable สาย ' + i, ps.lines[i] || 0, 'line-' + i);
    if (ps.lines.none) list += `<li class="py-1.5 ${k.textMeta}" data-dash-line-none>${numText(MSG.lineNone, 'line-none', ps.lines.none)}</li>`;
    ['er', 'ipd'].forEach(s => {
      const x = ps.lunch[s];
      list += row('เวรกลางวัน ' + s.toUpperCase(), x.served, 'lunch-' + s, x.scheduled ? 'กำลังจะถึง ' + x.scheduled : '');
    });
    const mi = ps.mission;
    const nw = mi.servedNonWorking + mi.scheduledNonWorking;
    list += row('ภารกิจพิเศษ', mi.served, 'mission', (mi.scheduled ? 'กำลังจะถึง ' + mi.scheduled : '') + (nw ? (mi.scheduled ? ' · ' : '') + 'รวมวันหยุด ' + nw : ''));
    let body = `<ul class="divide-y divide-brand-50">${list}</ul>`;
    if (ps.conflicts.length) {
      body += `<p class="mt-2 ${k.textBody} text-coral-700 font-medium" data-dash-conflicts>${icon('alert-triangle', 'w-4 h-4 inline-block align-[-2px] mr-1')}มีเวรตรงกับวันลา ${ps.conflicts.length} รายการ</p>`;
    }
    return card('duties', T, IC, body, { tone: k.listIconSun });
  }
  function upcomingCard(c, m, name) {
    const k = K();
    const T = 'เวร 7 วันข้างหน้า', IC = 'clock';
    const p = P();
    const planLoading = !!p && p.loading() && !p.covers(m.n.t, m.n.upTo);
    if (m.upState === 'loading' || m.upState === 'missing' || planLoading) return stateCard(m.upState === 'missing' ? 'missing' : 'loading', 'upcoming', T, IC);
    const myDay = c.use('plan.myDay');
    const TONE = { brand: k.listIconBrand, info: k.listIconInfo, lilac: k.listIconLilac, sun: k.listIconSun, danger: k.listIconDanger, neutral: k.listIconNeutral };
    const rows = [];
    let any = false;
    UT.eachDate(m.n.t, m.n.upTo).forEach(d => {
      const items = [];
      const day = c.state.days[d];
      if (day && day.assignments) {
        UT.STATIONS.forEach(s => {
          if ((day.assignments[s.id] || []).indexOf(name) >= 0) items.push({ icon: 'calendar-check', tone: 'brand', main: 'Station ' + s.name, sub: '' });
        });
      }
      const lv = c.leavesOn(d)[name];
      if (lv) {
        const info = UT.leaveInfo(lv);
        if (!info.rejected) items.push({ icon: 'calendar-off', tone: info.pending ? 'sun' : 'danger', main: info.label + (info.pending ? ' (รออนุมัติ)' : ''), sub: '' });
      }
      if (typeof myDay === 'function') {
        let lines = [];
        try { lines = myDay(d, name) || []; } catch (e) { lines = []; }
        lines.forEach(l => { if (l && l.main) items.push(l); });
      }
      // D-9: every one of the 7 dates is listed; a date with nothing says "ไม่มีเวร" in grey
      const dateLine = `<p class="${k.textCaption} mb-1">${esc(UT.thaiDateShort(d, { weekday: true, year: false }))}${d === m.n.t ? ' · วันนี้' : ''}</p>`;
      if (!items.length) {
        rows.push(`<li class="py-2" data-dash-up="${d}" data-dash-up-empty>${dateLine}<p class="text-sm leading-6 text-slate-500">${esc(MSG.upNone)}</p></li>`);
        return;
      }
      any = true;
      rows.push(`<li class="py-2" data-dash-up="${d}">${dateLine}` +
        items.map(it => `<div class="flex items-start gap-2.5 py-0.5"><span class="${k.listIcon} ${TONE[it.tone] || k.listIconNeutral} w-8 h-8">${icon(core.Kit.iconNames.indexOf(it.icon) >= 0 ? it.icon : 'info', 'w-4 h-4')}</span>` +
          `<div class="min-w-0 flex-1"><p class="text-sm leading-6 text-ink-900 break-words">${esc(it.main)}</p>${it.sub ? `<p class="${k.textMeta} break-words">${esc(it.sub)}</p>` : ''}</div></div>`).join('') + `</li>`);
    });
    const body = (any ? '' : `<p class="${k.textBody}" data-dash-up-none>ไม่มีเวรใน 7 วันข้างหน้า</p>`) + `<ul class="divide-y divide-brand-50">${rows.join('')}</ul>`;
    return card('upcoming', T, IC, body, { tone: k.listIconInfo });
  }
  function personCards(c, m, name, opts) {
    const canEdit = !!opts.canEdit;
    let html = vacationCard(c, m, name, canEdit) + ceCard(c, m, name, canEdit) + leaveCard(c, m, name) + stationCard(c, m, name) + dutyCard(c, m, name);
    if (opts.upcoming) html += upcomingCard(c, m, name);
    return `<div class="grid grid-cols-1 gap-3 md:grid-cols-2" data-dash-cards="${esc(name)}">${html}</div>`;
  }
  function cachedCaption(m) {
    return m.cached ? `<p class="${K().textCaption} px-1" data-dash-cached>${esc(MSG.cached)}</p>` : '';
  }

  /* ---------------------------------------------------------------- screen: mine */
  function renderMine(el, c) {
    const k = K();
    if (!c.state.user) { c.setHtml(el, `<div class="${k.card}">${c.Kit.skeleton(4)}</div>`); return; }
    const me = c.myName();
    const m = model(c, ID_ME);
    const html = `<div class="space-y-3 md:max-w-4xl md:mx-auto" data-dash-screen="mine">` + periodBarHtml() + cachedCaption(m) +
      personCards(c, m, me, { canEdit: true, upcoming: true }) + `</div>`;
    c.setHtml(el, html);
  }

  /* ---------------------------------------------------------------- screen: team */
  function teamRows(c, m) {
    const p = P();
    const staff = p && typeof p.engineStaff === 'function' ? p.engineStaff() : c.staff().map(s => ({ name: s.name, group: s.group, active: true }));
    const list = PE.teamStats({ staff, from: m.n.per.from, to: m.n.per.to, today: m.n.t, days: c.state.days, duties: m.duties,
      leaves: m.leaves, holidays: m.holidays });
    const act = activeSet();
    return list.map((ps, i) => {
      const gone = !act.has(ps.name);
      const vac = vacationOf(m, ps.name);
      return { i, name: ps.name, gone, group: gone ? 'gone' : groupOf(ps.name), ps, vac,
        worked: ps.daysWorked, leave: ps.leaves.fullDays, vacLeft: vac.known ? vac.remaining : null,
        lines: lineTotal(ps), lunch: lunchTotal(ps), mission: missionTotal(ps) };
    });
  }
  function valueOf(r, key) { return key === 'vac' ? r.vacLeft : r[key]; }
  function shownRows(rows) {
    const t = ui.team;
    const q = t.q.trim().toLowerCase();
    let out = rows.filter(r => (t.filter === 'all' || r.group === t.filter) && (!q || r.name.toLowerCase().indexOf(q) >= 0));
    const dir = t.dir === 'desc' ? -1 : 1;
    out = out.slice().sort((a, b) => {
      if (t.sort === 'name') return dir * a.name.localeCompare(b.name, 'th') || a.i - b.i;
      const va = valueOf(a, t.sort), vb = valueOf(b, t.sort);
      if (va === null && vb === null) return a.i - b.i;
      if (va === null) return 1;
      if (vb === null) return -1;
      return dir * (va - vb) || a.i - b.i;
    });
    return out;
  }
  function fmtVal(r, key) {
    const v = valueOf(r, key);
    return v === null ? '–' : num(v);
  }
  /**
   * D-8: "ทำงาน N วัน · ลา N · Portable N · กลางวัน N · ภารกิจ N · พักร้อนคงเหลือ X" (or "ยังไม่กรอกพักร้อน"); every
   * "label value" is a nowrap span, so a line breaks only between them. → HTML
   */
  function rowMeta(r) {
    const parts = ['ทำงาน ' + num(r.worked) + ' วัน', 'ลา ' + num(r.leave), 'Portable ' + num(r.lines), 'กลางวัน ' + num(r.lunch),
      'ภารกิจ ' + num(r.mission), r.vacLeft === null ? MSG.vacNotEntered : 'พักร้อนคงเหลือ ' + num(r.vacLeft)];
    return parts.map(s => `<span class="whitespace-nowrap" data-dash-nowrap>${esc(s)}</span>`).join(' · ');
  }
  function toolsHtml(c) {
    const k = K();
    const chips = FILTERS.map(f => {
      const on = ui.team.filter === f.id;
      return `<button type="button" class="${k.chip} ${on ? k.chipOn : k.chipOff}" data-dash-filter="${f.id}" aria-pressed="${on}">${esc(f.label)}</button>`;
    }).join('');
    const opts = SORTS.map(s => `<option value="${s.id}"${ui.team.sort === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('');
    const xlsx = window.XlsxLite && c.isSup()
      ? `<button type="button" class="${k.btn} ${k.btnSecondary} w-full md:w-auto" data-dash-act="xlsx">${icon('download', 'w-5 h-5')}Excel (.xlsx)</button>` : '';
    return `<div class="flex flex-wrap gap-2" role="group" aria-label="กลุ่ม">${chips}</div>` +
      `<div class="grid grid-cols-1 gap-2 md:grid-cols-3 md:items-end"><div class="min-w-0 md:col-span-1"><label class="${k.label}" for="dashSort">เรียงตาม</label>` +
      `<select id="dashSort" class="${k.select}" data-dash-sort-select>${opts}</select></div>` +
      (xlsx ? `<div class="min-w-0 md:col-span-2 md:flex md:justify-end">${xlsx}</div>` : '') + `</div>`;
  }
  function listHtml(c, rows) {
    const k = K();
    const t = ui.team;
    const sortDef = SORTS.filter(s => s.id === t.sort)[0] || SORTS[0];
    if (!rows.length) return `<div class="${k.card}" data-dash-list-empty>${c.Kit.empty({ icon: 'search', title: 'ไม่พบรายชื่อ' })}</div>`;
    // phones: rows
    const items = rows.map(r => {
      const meta = rowMeta(r);
      const big = t.sort === 'name' ? '' : `<span class="shrink-0 text-right"><span class="block font-display text-xl font-semibold leading-7 tabular-nums text-ink-900" data-dash-row-value>${esc(fmtVal(r, t.sort))}</span>` +
        `<span class="block ${k.textCaption}">${esc(sortDef.short)}</span></span>`;
      return `<li><button type="button" class="${k.listRow} py-2" data-dash-person="${esc(r.name)}" data-dash-row="${esc(r.name)}">${core.Kit.avatar(r.name, 'md')}` +
        `<span class="flex-1 min-w-0"><span class="block font-medium text-ink-900 break-words" data-dash-row-name>${esc(r.name)}${r.gone ? `<span class="${k.textMeta}">${esc(MSG.gone)}</span>` : ''}</span>` +
        `<span class="block ${k.textMeta}" data-dash-row-meta>${meta}</span></span>${big}${icon('chevron-right', k.listChevron)}</button></li>`;
    }).join('');
    // md: and up: the table
    const head = SORTS.map((s, i) => {
      const on = t.sort === s.id;
      const aria = on ? (t.dir === 'desc' ? 'descending' : 'ascending') : 'none';
      const sticky = i === 0 ? ' sticky left-0 z-10 bg-white' : '';
      // R3 L-14: number columns (every column after the name) are right-aligned, their head too
      const end = i === 0 ? 'text-left' : 'text-right';
      return `<th scope="col" class="p-0 ${end}${sticky}" aria-sort="${aria}"><button type="button" class="flex items-center gap-1 w-full min-h-[44px] px-3 ${i === 0 ? '' : 'justify-end text-right'} ${k.textCaption} ${on ? 'text-brand-700' : ''}" data-dash-sort="${s.id}">` +
        `${esc(s.label)}${on ? icon(t.dir === 'desc' ? 'chevron-down' : 'chevron-up', 'w-4 h-4') : ''}</button></th>`;
    }).join('');
    const body = rows.map(r => `<tr class="border-t border-brand-50" data-dash-trow="${esc(r.name)}">` +
      `<th scope="row" class="sticky left-0 z-10 bg-white p-0 text-left font-normal"><button type="button" class="flex items-center gap-2 w-full min-h-[44px] px-3 text-sm text-ink-900 text-left break-words" data-dash-person="${esc(r.name)}">` +
      `${core.Kit.avatar(r.name, 'sm')}<span class="min-w-0">${esc(nameLabel(r.name))}</span></button></th>` +
      SORTS.slice(1).map(s => `<td class="px-3 text-sm tabular-nums text-right text-ink-800">${esc(fmtVal(r, s.id))}</td>`).join('') + `</tr>`).join('');
    return `<ul class="${k.list} md:hidden" data-dash-list="rows">${items}</ul>` +
      `<div class="max-md:hidden ${k.card} p-0 overflow-x-auto" data-dash-list="table"><table class="w-full min-w-[720px] border-collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function monthlyCard(c, m, rows) {
    const k = K();
    const T = 'การลารายเดือนแยกประเภท', IC = 'calendar';
    const items = monthSlices(m.n.per).map(s => {
      const tot = {};
      rows.forEach(r => {
        const ms = statsOf(c, m, r.name, s.from, s.to);
        Object.keys(ms.leaves.approved).forEach(t => { tot[t] = (tot[t] || 0) + ms.leaves.approved[t]; });
      });
      return { month: s.month, chips: typeChips(tot) };
    });
    return card('team-months', T, IC, monthList(items, 'team', 'data-dash-tmonth'), { tone: k.listIconSun });
  }
  /** §0.20: per kind the mean among people with ≥ 1 turn (mission: plus every mission-eligible person). */
  function fairness(rows) {
    const p = P();
    const eligible = new Set(p && typeof p.eligible === 'function' ? p.eligible().map(e => e.name) : []);
    return FAIR_KINDS.map(f => {
      const pop = rows.filter(r => r[f.id] > 0 || (f.id === 'mission' && eligible.has(r.name)));
      if (!pop.length) return { id: f.id, label: f.label, n: 0, mean: 0, min: 0, max: 0, flagged: [] };
      const counts = pop.map(r => r[f.id]);
      const mean = sum(counts) / pop.length;
      const lim = Math.max(2, 0.25 * mean);
      const flagged = pop.filter(r => Math.abs(r[f.id] - mean) >= lim - 1e-9)
        .map(r => ({ name: r.name, count: r[f.id], dir: r[f.id] > mean ? 'up' : 'down' }))
        .sort((a, b) => b.count - a.count);
      return { id: f.id, label: f.label, n: pop.length, mean, min: Math.min.apply(null, counts), max: Math.max.apply(null, counts), flagged };
    });
  }
  function fairnessCard(c, m, rows) {
    const k = K();
    const T = 'ความเท่าเทียมของเวร', IC = 'sliders';
    const body = fairness(rows).map(f => {
      if (!f.n) return `<li class="py-2" data-dash-fair="${f.id}"><p class="font-medium text-ink-900">${esc(f.label)}</p><p class="${k.textMeta}">ยังไม่มีเวรในช่วงนี้</p></li>`;
      const flags = f.flagged.map(x => `<span class="${k.inlineTag} ${x.dir === 'up' ? 'bg-coral-50 border-coral-200 text-coral-700' : 'bg-accent-50 border-accent-200 text-accent-700'}" data-dash-flag="${esc(x.name)}" data-dir="${x.dir}">` +
        `${esc(nameLabel(x.name))} ${x.dir === 'up' ? '↑' : '↓'} ${x.count}</span>`).join(' ');
      return `<li class="py-2" data-dash-fair="${f.id}"><p class="font-medium text-ink-900">${esc(f.label)}</p>` +
        `<p class="${k.textMeta}" data-dash-fair-stats>เฉลี่ย ${esc(num(f.mean))} ครั้ง · น้อยสุด–มากสุด ${f.min}–${f.max} · ${f.n} คน</p>` +
        (flags ? `<p class="flex flex-wrap gap-1.5 mt-1">${flags}</p>` : `<p class="${k.textMeta}">ใกล้เคียงกันทุกคน</p>`) + `</li>`;
    }).join('');
    return card('fairness', T, IC, `<p class="${k.textMeta}" data-dash-fair-legend>${esc(MSG.fairLegend)}</p><ul class="divide-y divide-brand-50">${body}</ul>`, { tone: k.listIconLilac });
  }
  /** Past working days of the period: saved days with a station below the current counts, and days not saved. */
  function incompleteDays(c, m) {
    const counts = c.state.stationCounts || {};
    const hs = new Set(Array.from(m.holidays.keys()));
    const out = [];
    let unsaved = 0;
    const end = minD(m.n.per.to, UT.addDays(m.n.t, -1));
    if (m.n.per.from > end) return { list: out, unsaved };
    UT.eachDate(m.n.per.from, end).forEach(d => {
      if (!PE.isWorkingDay(d, hs)) return;
      const v = c.dayView(d);
      if (v !== 'ready' && v !== 'cached') return;
      const day = c.state.days[d];
      if (!day) { unsaved++; out.push({ date: d, unsaved: true, short: [] }); return; }
      const asg = day.assignments || {};
      const short = [];
      UT.STATIONS.forEach(s => {
        const need = counts[s.id] || 0;
        const have = new Set((asg[s.id] || []).filter(n => typeof n === 'string' && n.trim())).size;
        if (have < need) short.push({ station: s.id, name: s.name, need, have });
      });
      if (short.length) out.push({ date: d, unsaved: false, short });
    });
    out.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { list: out, unsaved };
  }
  function incompleteCard(c, m) {
    const k = K();
    const T = 'วันที่จัดคนไม่ครบ', IC = 'alert-triangle';
    const inc = incompleteDays(c, m);
    // listed: saved days with a short station; days not saved are only counted (every one of them is in the Excel file)
    const saved = inc.list.filter(x => !x.unsaved);
    const summary = `<p class="${k.textMeta} mb-1" data-dash-inc-summary>คนไม่ครบ ${saved.length} วัน · ยังไม่ได้บันทึก ${inc.unsaved} วัน</p>`;
    if (!saved.length) {
      return card('incomplete', T, IC, summary + `<p class="${k.textBody}" data-dash-inc-none>วันที่บันทึกแล้วจัดคนครบทุก Station</p>`, { tone: k.listIconDanger });
    }
    const rows = saved.slice(0, INCOMPLETE_SHOWN).map(x => {
      const what = x.short.map(s => s.name + ' ขาด ' + (s.need - s.have)).join(' · ');
      return `<li><button type="button" class="${k.listRow} py-2 px-0" data-dash-inc="${x.date}"><span class="flex-1 min-w-0"><span class="block font-medium text-ink-900">${esc(UT.thaiDateShort(x.date, { weekday: true }))}</span>` +
        `<span class="block text-[0.8125rem] leading-5 text-coral-700 break-words" data-dash-inc-what>${esc(what)}</span></span>${icon('chevron-right', k.listChevron)}</button></li>`;
    }).join('');
    const more = saved.length > INCOMPLETE_SHOWN ? `<p class="${k.textMeta} mt-1">และอีก ${saved.length - INCOMPLETE_SHOWN} วัน (ดูทั้งหมดในไฟล์ Excel)</p>` : '';
    return card('incomplete', T, IC, summary + `<ul class="divide-y divide-brand-50">${rows}</ul>${more}`, { tone: k.listIconDanger });
  }
  function problemsSvc(c) {
    if (!c.serverHas('problem')) return null;
    const s = c.use('problems');
    return s && typeof s === 'object' && typeof s.openSummary === 'function' ? s : null;
  }
  function problemsCard(c) {
    const k = K();
    const svc = problemsSvc(c);
    if (!svc) return '';
    let sm = null;
    try { sm = svc.openSummary(); } catch (e) { sm = null; }
    if (!sm || typeof sm !== 'object') return '';
    const count = Number(sm.count) || 0;
    const by = [];
    const raw = sm.byStation;
    if (Array.isArray(raw)) raw.forEach(x => { if (x && x.station) by.push([x.station, Number(x.count) || 0]); });
    else if (raw && typeof raw === 'object') Object.keys(raw).forEach(id => by.push([id, Number(raw[id]) || 0]));
    const chips = by.filter(x => x[1] > 0).map(x => {
      const st = UT.stationById(x[0]);
      return `<span class="${k.tag}" data-dash-prob-station="${esc(x[0])}">${esc(st ? st.name : x[0] === 'other' ? 'อื่นๆ' : x[0])} <span class="tabular-nums ml-1">${x[1]}</span></span>`;
    }).join('');
    const body = count
      ? `<p class="font-display text-2xl font-semibold leading-9 text-ink-900">ยังไม่แก้ ${numSpan('problems-open', count)} เรื่อง</p>` +
        (Number(sm.oldestDays) >= 0 && sm.oldestDays !== null && sm.oldestDays !== undefined ? `<p class="${k.textMeta}" data-dash-prob-oldest>ค้างนานสุด ${esc(num(Number(sm.oldestDays)))} วัน</p>` : '') +
        (chips ? `<p class="flex flex-wrap gap-1.5 mt-2">${chips}</p>` : '')
      : `<p class="${k.textBody}" data-dash-prob-none>ไม่มีปัญหาค้าง</p>`;
    return card('problems', 'ปัญหาค้าง', 'alert-triangle', body +
      `<button type="button" class="${k.btn} ${k.btnTonal} w-full mt-3" data-dash-act="problems">ดูเรื่องที่ยังไม่แก้${icon('chevron-right', 'w-5 h-5')}</button>`, { tone: k.listIconSun });
  }
  /** The list part: the person view, or the count + rows/table (the summary and month cards are parts of their own). */
  function teamBodyHtml(c, m, rows) {
    const k = K();
    if (!rows) {
      const st = m.perState === 'missing' || m.vacState === 'missing' ? 'missing' : 'loading';
      return stateCard(st, 'team', 'รายชื่อ', 'users');
    }
    const t = ui.team;
    if (t.person) {
      const r = rows.filter(x => x.name === t.person)[0];
      const name = t.person;
      const head = `<div class="flex items-center gap-2" data-dash-person-view="${esc(name)}"><button type="button" class="${k.iconBtnRound}" data-dash-act="back" aria-label="กลับไปรายชื่อ">${icon('arrow-left', 'w-5 h-5')}</button>` +
        `${core.Kit.avatar(name, 'md')}<h2 class="flex-1 min-w-0 ${k.titleScreen} break-words">${esc(nameLabel(name))}</h2></div>`;
      if (!r) return head + `<div class="${k.card}">${c.Kit.empty({ icon: 'user', title: 'ไม่พบข้อมูลของคนนี้ในช่วงนี้' })}</div>`;
      return head + personCards(c, m, name, { canEdit: c.isSup() && !r.gone, upcoming: false });
    }
    const shown = shownRows(rows);
    return `<p class="${k.textCaption} px-1" data-dash-count>${shown.length} คน</p>` + listHtml(c, shown);
  }
  /** D-7: ปัญหาค้าง → วันที่จัดคนไม่ครบ → ความเท่าเทียมของเวร (above the list; the open problems also while it loads). */
  function teamSummaryHtml(c, m, rows) {
    const html = problemsCard(c) + (rows ? incompleteCard(c, m) + fairnessCard(c, m, rows) : '');
    return html ? `<div class="grid grid-cols-1 gap-3 md:grid-cols-2" data-dash-summary>${html}</div>` : '';
  }
  function ensureTeamFrame(el) {
    if (el.querySelector('[data-dash-screen="team"]')) return;
    const k = K();
    // D-7: period · caption · summary cards · the person list (filters, sort, search, rows/table) · การลารายเดือนแยกประเภท
    el.innerHTML = `<div class="space-y-3 md:max-w-5xl md:mx-auto" data-dash-screen="team"><div data-dash-part="period"></div><div data-dash-part="caption"></div>` +
      `<div data-dash-part="summary"></div>` +
      `<div class="space-y-2" data-dash-part="tools-wrap"><div data-dash-part="tools" class="space-y-2"></div>` +
      `<div class="min-w-0"><label class="${k.label}" for="dashSearch">ค้นหาชื่อ</label><input type="search" id="dashSearch" class="${k.input}" data-dash-search autocomplete="off" placeholder="พิมพ์ชื่อ" enterkeyhint="search"></div></div>` +
      `<div class="space-y-3" data-dash-part="body"></div><div data-dash-part="months"></div></div>`;
    el._html = '';
  }
  function renderTeam(el, c) {
    const k = K();
    if (!c.state.user) { el.innerHTML = `<div class="${k.card}">${c.Kit.skeleton(4)}</div>`; return; }
    ensureTeamFrame(el);
    const part = n => el.querySelector('[data-dash-part="' + n + '"]');
    const m = model(c, ID_TEAM);
    const rows = m.perReady && m.vacReady ? teamRows(c, m) : null;
    const person = !!ui.team.person;
    c.setHtml(part('period'), periodBarHtml());
    c.setHtml(part('caption'), cachedCaption(m));
    const summary = person ? '' : teamSummaryHtml(c, m, rows);
    c.setHtml(part('summary'), summary);
    c.setVisible(part('summary'), !!summary);
    c.setHtml(part('tools'), toolsHtml(c));
    c.setVisible(part('tools-wrap'), !person);
    const search = el.querySelector('[data-dash-search]');
    if (search && search.value !== ui.team.q && document.activeElement !== search) search.value = ui.team.q;
    c.setHtml(part('body'), teamBodyHtml(c, m, rows));
    const months = !person && rows ? monthlyCard(c, m, rows) : '';
    c.setHtml(part('months'), months);
    c.setVisible(part('months'), !!months);
  }

  /* ---------------------------------------------------------------- Excel (team) */
  function exportXlsx(c, btn) {
    if (!window.XlsxLite) return;
    const m = model(c, ID_TEAM);
    if (!m.perReady || !m.vacReady) return;
    const rows = shownRows(teamRows(c, m));
    const per = m.n.per;
    const st = UT.STATIONS;
    // D-3: สาย 1 … สาย L, L = max(Portable count, the highest line found) — the same lines the screen counts
    const L = rows.reduce((a, r) => Math.max(a, lineCount(r.ps)), lineCount({ lines: {} }));
    const lineNos = [];
    for (let i = 1; i <= L; i++) lineNos.push(i);
    const people = rows.map(r => {
      const ps = r.ps;
      return [r.name, GROUP_LABEL[r.group], ps.daysWorked, ps.leaves.fullDays, ps.leaves.partialDays, r.vacLeft === null ? '' : r.vacLeft]
        .concat(lineNos.map(i => ps.lines[i] || 0))
        .concat([ps.lunch.er.served + ps.lunch.er.scheduled, ps.lunch.ipd.served + ps.lunch.ipd.scheduled,
          ps.mission.served + ps.mission.scheduled, ps.mission.servedNonWorking + ps.mission.scheduledNonWorking])
        .concat(st.map(s => ps.stations[s.id] || 0));
    });
    const monthly = [];
    const slices = monthSlices(per);
    rows.forEach(r => {
      slices.forEach(s => {
        const ms = statsOf(c, m, r.name, s.from, s.to);
        UT.LEAVE_TYPES.forEach(t => { if (ms.leaves.approved[t] > 0) monthly.push([r.name, s.month, t, ms.leaves.approved[t]]); });
      });
    });
    const inc = incompleteDays(c, m).list.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const incRows = [];
    inc.forEach(x => {
      if (x.unsaved) incRows.push([x.date, 'ยังไม่ได้บันทึก', '', '']);
      else x.short.forEach(s => incRows.push([x.date, s.name, s.need, s.have]));
    });
    const spec = { sheets: [
      { name: 'รายคน', columns: [{ header: 'ชื่อ', width: 18 }, { header: 'กลุ่ม' }, { header: 'วันทำงาน' }, { header: 'วันลาเต็มวัน' }, { header: 'ลาบางช่วง' },
        { header: 'พักร้อนคงเหลือ' }].concat(lineNos.map(i => ({ header: 'สาย ' + i })), [{ header: 'กลางวัน ER' }, { header: 'กลางวัน IPD' },
        { header: 'ภารกิจ' }, { header: 'ภารกิจวันหยุด' }], st.map(s => ({ header: s.name }))), rows: people },
      { name: 'การลารายเดือน', columns: [{ header: 'ชื่อ', width: 18 }, { header: 'เดือน' }, { header: 'ประเภท' }, { header: 'จำนวน' }], rows: monthly },
      { name: 'วันที่คนไม่ครบ', columns: [{ header: 'วันที่', width: 12 }, { header: 'Station' }, { header: 'ต้องการ' }, { header: 'จัดแล้ว' }], rows: incRows }
    ] };
    const filename = 'Dashboard-ทีม-' + per.from + '_' + per.to + '.xlsx';
    const alive = c.alive();
    c.spawn(() => c.withBusy(btn, 'กำลังสร้างไฟล์…', async () => {
      const ok = await window.XlsxLite.saveTable(c, filename, spec);
      if (ok && alive()) c.toast(MSG.xlsx);
    }));
  }

  /* ---------------------------------------------------------------- edit sheets */
  function ensureSheet() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    const k = K();
    sheetEl = document.createElement('div');
    sheetEl.className = k.sheetWrap + ' md:p-4';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'dashSheetTitle');
    sheetEl.dataset.dashSheet = '';
    sheetEl.addEventListener('click', onSheetClick);
    sheetEl.addEventListener('input', onSheetInput);
    sheetEl.addEventListener('change', onSheetInput);
    document.body.appendChild(sheetEl);
    return sheetEl;
  }
  function openSheet(kind, title, body, actions) {
    const k = K();
    const el = ensureSheet();
    el.dataset.dashSheet = kind;
    el.innerHTML = `<div class="uk-safe-b ${k.sheetFrame}" data-sheet-panel><div class="${k.sheetGrabber}" aria-hidden="true"></div>` +
      `<div class="${k.sheetHead}"><h2 id="dashSheetTitle" class="flex-1 outline-none ${k.sheetTitle}" data-sheet-title tabindex="-1">${esc(title)}</h2>` +
      `<button type="button" class="${k.iconBtn}" data-sheet-close aria-label="ปิด">${icon('chevron-down', 'w-5 h-5')}</button></div>` +
      `<div class="${k.sheetScroll}">${body}<p class="${k.fieldError} hidden" role="alert" data-dash-sheet-error></p></div><div class="${k.sheetActions}">${actions}</div></div>`;
    core.Kit.sheet.open(el, { initialFocus: '[data-sheet-title]', onClose: () => { ui.sheet = null; } });
  }
  function closeSheet() {
    if (sheetEl && core && core.Kit.sheet.isOpen(sheetEl)) core.Kit.sheet.close(sheetEl, 'api');
    ui.sheet = null;
  }
  function sheetError(msg) {
    const el = sheetEl && sheetEl.querySelector('[data-dash-sheet-error]');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }
  /** D-10: the พ.ศ. caption under a native date input (the purge-sheet pattern of แจ้งปัญหา); '' for no valid date. */
  function dateCaption(id, v) {
    return UT.isValidYmd(v) ? `<p id="${id}" class="${K().dateCaption}" data-dash-be-caption>${esc(UT.thaiDateShort(v))}</p>` : '';
  }
  /** input / change inside a sheet: the caption of a date input follows its value. */
  function onSheetInput(e) {
    const t = e.target;
    const id = t && t.getAttribute ? t.getAttribute('data-dash-be') : null;
    if (!id || !sheetEl || !core) return;
    const box = sheetEl.querySelector('[data-dash-be-box="' + id + '"]');
    if (box) core.setHtml(box, dateCaption(id, String(t.value || '').trim()));
  }
  /** The destructive-action recipe inside a sheet body: a ghost button with coral text (R3 U-11 / FIX-CL L-9). */
  function dangerGhost() {
    const k = K();
    return k.btnGhostDanger || k.btnDangerGhost || (k.btnGhost + ' !text-coral-700 active:!bg-coral-50');
  }
  function whoLine(name) {
    return name === core.myName() ? '' : `<p class="${K().dialogDetail}">${core.Kit.avatar(name, 'sm')}<span class="${K().dialogDetailTitle}">${esc(name)}</span></p>`;
  }
  function openVacSheet(c, name) {
    const k = K();
    const bal = balanceOf(profileOf(name));
    const t = today();
    ui.sheet = { kind: 'vac', name };
    const body = whoLine(name) +
      `<div><label class="${k.label}" for="dashVacDays">ยอดคงเหลือ (วัน)</label><input type="number" inputmode="decimal" step="0.5" min="0" max="365" id="dashVacDays" class="${k.input}" data-dash-vac-days value="${bal ? esc(String(bal.days)) : ''}"></div>` +
      `<div><label class="${k.label}" for="dashVacAsof">ณ สิ้นวันที่</label><input type="date" id="dashVacAsof" class="${k.input}" data-dash-vac-asof min="${UT.addDays(t, -400)}" max="${t}" value="${bal ? esc(bal.asOf) : t}" aria-describedby="dashVacAsofBe" data-dash-be="dashVacAsofBe">` +
      `<div data-dash-be-box="dashVacAsofBe">${dateCaption('dashVacAsofBe', bal ? bal.asOf : t)}</div></div>` +
      `<p class="${k.note}" data-dash-vac-hint>${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(MSG.vacHint)}</span></p>` +
      (bal ? `<button type="button" class="${k.btn} ${dangerGhost()} w-full" data-dash-sheet-act="vac-clear">${icon('trash', 'w-5 h-5')}ล้างยอด</button>` : '');
    openSheet('vac', 'ยอดพักร้อน', body,
      `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-dash-sheet-act="vac-save">บันทึก</button>`);
  }
  function openCeSheet(c, name) {
    const k = K();
    const pr = profileOf(name) || {};
    ui.sheet = { kind: 'ce', name };
    const numIn = (id, key, label, v) => `<div><label class="${k.label}" for="${id}">${esc(label)}</label><input type="number" inputmode="decimal" step="0.1" min="0" max="9999" id="${id}" class="${k.input}" data-dash-ce="${key}" value="${typeof v === 'number' ? esc(String(v)) : ''}"></div>`;
    const body = whoLine(name) +
      numIn('dashCePoints', 'points', 'คะแนนที่มี', pr.cePoints) +
      numIn('dashCeTarget', 'target', 'เป้าหมาย (ไม่บังคับ)', pr.ceTarget) +
      `<div><label class="${k.label}" for="dashCeExpiry">วันหมดอายุ (ไม่บังคับ)</label><input type="date" id="dashCeExpiry" class="${k.input}" data-dash-ce="expiry" min="2000-01-01" max="2100-12-31" value="${UT.isValidYmd(pr.licenceExpiry) ? esc(pr.licenceExpiry) : ''}" aria-describedby="dashCeExpiryBe" data-dash-be="dashCeExpiryBe">` +
      `<div data-dash-be-box="dashCeExpiryBe">${dateCaption('dashCeExpiryBe', pr.licenceExpiry)}</div></div>`;
    openSheet('ce', 'คะแนนใบประกอบ', body,
      `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-dash-sheet-act="ce-save">บันทึก</button>`);
  }
  function oneDecimal(n) { return Math.abs(n * 10 - Math.round(n * 10)) < 1e-9; }
  function readCeNumber(raw) {
    const s = String(raw || '').trim();
    if (!s) return { ok: true, v: null };
    const n = Number(s);
    return isFinite(n) && n >= 0 && n <= 9999 && oneDecimal(n) ? { ok: true, v: Math.round(n * 10) / 10 } : { ok: false };
  }
  async function saveProfile(c, btn, name, patch, okMsg) {
    if (!c.requireInternet()) return;
    const p = P();
    if (!p) return;
    const alive = c.alive();
    sheetError('');
    await c.withBusy(btn, 'กำลังบันทึก…', async () => {
      try {
        await p.setProfiles({ items: [{ name, patch }] });
        if (!alive()) return;
        closeSheet();
        c.toast(okMsg);
        c.render();
      } catch (e) {
        if (!alive()) return;
        if (e && (e.code === 'VALIDATION' || e.code === 'FORBIDDEN')) sheetError(e.message);
        else c.handleError(e, { write: true });
      }
    });
  }
  function onSheetClick(e) {
    const c = core;
    const b = e.target && e.target.closest ? e.target.closest('[data-dash-sheet-act]') : null;
    if (!b || !c || !ui.sheet) return;
    const actName = b.getAttribute('data-dash-sheet-act');
    const name = ui.sheet.name;
    if (actName === 'vac-save') {
      const daysRaw = String((sheetEl.querySelector('[data-dash-vac-days]') || {}).value || '').trim();
      const asof = String((sheetEl.querySelector('[data-dash-vac-asof]') || {}).value || '').trim();
      const n = Number(daysRaw);
      const t = today();
      const ok = daysRaw !== '' && isFinite(n) && n >= 0 && n <= 365 && Number.isInteger(n * 2) &&
        UT.isValidYmd(asof) && asof <= t && asof >= UT.addDays(t, -400);
      if (!ok) { sheetError(MSG.badVacation); return; }
      c.spawn(() => saveProfile(c, b, name, { vacBalance: n, vacAsof: asof }, MSG.vacSaved));
    } else if (actName === 'vac-clear') {
      c.spawn(() => saveProfile(c, b, name, { vacBalance: null, vacAsof: '' }, MSG.vacSaved));
    } else if (actName === 'ce-save') {
      const val = key => (sheetEl.querySelector('[data-dash-ce="' + key + '"]') || {}).value;
      const pts = readCeNumber(val('points')), tgt = readCeNumber(val('target'));
      if (!pts.ok || !tgt.ok) { sheetError(MSG.badCe); return; }
      const exp = String(val('expiry') || '').trim();
      if (exp && (!UT.isValidYmd(exp) || exp < '2000-01-01' || exp > '2100-12-31')) { sheetError(MSG.badExpiry); return; }
      c.spawn(() => saveProfile(c, b, name, { cePoints: pts.v, ceTarget: tgt.v, licenceExpiry: exp }, MSG.ceSaved));
    }
  }

  /* ---------------------------------------------------------------- events */
  function screenOf(el) { return el === roots[ID_TEAM] ? ID_TEAM : ID_ME; }
  function setKind(c, screen, kind) {
    if (kind === ui.kind) return;
    if (kind === 'custom') {
      const cur = period();
      if (!ui.lastCustom) ui.lastCustom = { from: cur.from, to: cur.to };
      ui.customFrom = ui.lastCustom.from; ui.customTo = ui.lastCustom.to; ui.customError = '';
    } else if (ui.kind === 'custom' && ui.lastCustom) {
      ui.anchor = ui.lastCustom.from;
    }
    ui.kind = kind;
    savePref();
    ensureData(c, screen);
    c.render();
  }
  function onRootClick(e) {
    const c = core;
    if (!c) return;
    const el = e.currentTarget;
    const screen = screenOf(el);
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const kindBtn = t.closest('[data-dash-kind]');
    if (kindBtn) { setKind(c, screen, kindBtn.getAttribute('data-dash-kind')); return; }
    const step = t.closest('[data-dash-step]');
    if (step) {
      ui.anchor = stepAnchor(ui.kind, ui.anchor || today(), +step.getAttribute('data-dash-step'));
      ensureData(c, screen);
      c.render();
      return;
    }
    const filter = t.closest('[data-dash-filter]');
    if (filter) { ui.team.filter = filter.getAttribute('data-dash-filter'); c.render(); return; }
    const sort = t.closest('[data-dash-sort]');
    if (sort) {
      const key = sort.getAttribute('data-dash-sort');
      if (ui.team.sort === key) ui.team.dir = ui.team.dir === 'asc' ? 'desc' : 'asc';
      else { ui.team.sort = key; ui.team.dir = key === 'name' ? 'asc' : 'desc'; }
      c.render();
      return;
    }
    const person = t.closest('[data-dash-person]');
    if (person) { openPerson(c, person.getAttribute('data-dash-person')); return; }
    const inc = t.closest('[data-dash-inc]');
    if (inc) {
      const d = inc.getAttribute('data-dash-inc');
      c.spawn(async () => {
        const alive = c.alive();
        const ok = await c.setSelectedDate(d);
        if (ok !== false && alive()) await c.go('station');
      });
      return;
    }
    const a = t.closest('[data-dash-act]');
    if (!a) return;
    const what = a.getAttribute('data-dash-act');
    if (what === 'retry') { loadedAt.clear(); stats.forEach((v, key) => { if (v.state === 'error') stats.delete(key); }); ensureData(c, screen); c.render(); }
    else if (what === 'edit-vac') openVacSheet(c, screen === ID_TEAM && ui.team.person ? ui.team.person : c.myName());
    else if (what === 'edit-ce') openCeSheet(c, screen === ID_TEAM && ui.team.person ? ui.team.person : c.myName());
    else if (what === 'back') closePerson(c);
    else if (what === 'months') {
      const which = a.getAttribute('data-dash-months-toggle');
      if (which === 'leaves' || which === 'team') { ui.allMonths[which] = !ui.allMonths[which]; c.render(); }
    } else if (what === 'xlsx') exportXlsx(c, a);
    else if (what === 'problems') c.spawn(() => c.go('problems', { status: 'open' }));
  }
  /**
   * D-6: the team's person view. The header title is the person's name (core.setScreenTitle) while it is open; the header
   * ← (and the inline ←) return to the list with its scroll kept; leaving restores "Dashboard ทีม".
   */
  function openPerson(c, name) {
    ui.team.scrollY = window.scrollY || 0;
    ui.team.person = name;
    if (c.current() === ID_TEAM) c.setScreenTitle(name);
    c.render();
    try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }
  }
  function closePerson(c) {
    const y = ui.team.scrollY;
    ui.team.person = '';
    if (c.current() === ID_TEAM) c.setScreenTitle(null);
    c.render();
    try { window.scrollTo(0, y); } catch (err) { /* ignore */ }
  }
  /** R3 F-3: the team screen's back hook (header ←, Android/browser back): an open person view returns to the list. */
  function teamBack(c) {
    if (!ui.team.person || c.current() !== ID_TEAM) return false;
    closePerson(c);
    return true;
  }
  function onRootChange(e) {
    const c = core;
    const t = e.target;
    if (!c || !t) return;
    const screen = screenOf(e.currentTarget);
    if (t.matches('[data-dash-custom]')) {
      if (t.getAttribute('data-dash-custom') === 'from') ui.customFrom = t.value; else ui.customTo = t.value;
      const r = periodRange('custom', ui.customFrom, ui.customTo);
      if (r.valid) {
        ui.customError = '';
        ui.lastCustom = { from: r.from, to: r.to };
        savePref();
        ensureData(c, screen);
      } else ui.customError = MSG.range;
      c.render();
    } else if (t.matches('[data-dash-sort-select]')) {
      ui.team.sort = t.value;
      ui.team.dir = t.value === 'name' ? 'asc' : 'desc';
      c.render();
    }
  }
  function onRootInput(e) {
    const t = e.target;
    if (!core || !t || !t.matches('[data-dash-search]')) return;
    ui.team.q = t.value;
    core.render();
  }

  /* ---------------------------------------------------------------- registration */
  function bindRoot(id, el) {
    roots[id] = el;
    el.addEventListener('click', onRootClick);
    el.addEventListener('change', onRootChange);
    el.addEventListener('input', onRootInput);
  }
  function onData(p, c) {
    const cur = c.current();
    if (cur !== ID_ME && cur !== ID_TEAM) return;
    if (p && (p.changed === true || p.domain)) ensureData(c, cur);
    // D-4: every heartbeat (also an unchanged one: a problem changes no day) may bring a new problem version
    if (cur === ID_TEAM && !(p && p.domain === 'problem')) ensureProblems(c);
  }
  function resetAll() {
    gen++;
    closeSheet();
    stats.clear();
    loadedAt.clear();
    ui.anchor = ''; ui.kind = ''; ui.customFrom = ''; ui.customTo = ''; ui.customError = ''; ui.lastCustom = null;
    ui.team = { filter: 'all', q: '', sort: 'name', dir: 'asc', person: '', scrollY: 0 };
    ui.sheet = null;
    ui.problemsAsked = false;
    ui.problemsBusy = false;
    ui.allMonths = { leaves: false, team: false };
    reloading.clear();
  }

  App.register({
    id: ID_ME,
    title: 'Dashboard ของฉัน',
    icon: 'bar-chart',
    nav: { place: 'menu', section: 'mine', order: 10 },
    parent: 'menu',
    visible: c => c.serverHas('stats'),
    init(c) {
      core = c;
      c.provide('dashboard.periodRange', periodRange);
      c.on('data', onData);
      c.on('logout', () => { resetAll(); });
      c.on('login', () => { resetAll(); });
    },
    mount(el) { bindRoot(ID_ME, el); },
    render(el, c) { renderMine(el, c); },
    show(c) { loadPref(); ensureData(c, ID_ME); },
    hide() { closeSheet(); },
    reset() {
      resetAll();
      const el = roots[ID_ME];
      if (el) { el.innerHTML = ''; el._html = ''; }
    }
  });

  App.register({
    id: ID_TEAM,
    title: 'Dashboard ทีม',
    icon: 'bar-chart',
    nav: { place: 'menu', section: 'sup', order: 45 },
    parent: 'menu',
    visible: c => c.isSup() && c.serverHas('stats'),
    init(c) { core = c; },
    back: teamBack,
    mount(el) { bindRoot(ID_TEAM, el); },
    render(el, c) { renderTeam(el, c); },
    show(c, params) {
      loadPref();
      const prm = params && typeof params === 'object' ? params : {};
      if (typeof prm.person === 'string') ui.team.person = prm.person;
      if (ui.team.person) c.setScreenTitle(ui.team.person);   // D-6 (core.go cleared the title before show)
      ui.problemsAsked = false;
      ensureData(c, ID_TEAM);
    },
    hide() { closeSheet(); },
    reset() {
      resetAll();
      const el = roots[ID_TEAM];
      if (el) { el.innerHTML = ''; el._html = ''; }
    }
  });
})();
