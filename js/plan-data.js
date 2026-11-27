/* =====================================================================
 * js/plan-data.js — the plan domain (R2-SPEC §4.3): the ONLY owner of plan data → core.provide('plan', api)
 *
 * Loaded after js/app.js and before the feature files. Registers the hidden feature 'plan-data' (nav place 'none') and
 * the persisted domain core.domain('plan') = {range, rosters: {[month]: Roster}, duties: {[date]: Duty},
 * holidays: {[date]: name}, holidayYears: [year], assistants: [Assistant], profiles: {[name]: Profile},
 * backup: {[date]: Backup}} (shapes of R2-SPEC §3.1, normalised; stored frozen).
 *
 * Fetch rules (one read action, getPlan{from, to, knownVersion?}; getData stays the only heartbeat):
 *  - only while the server has the 'plan' feature and somebody is logged in (not while a password change is forced);
 *  - never while the server's plan version (versions.plan of the heartbeat → domain remote) is '' — the plan sheets are
 *    empty: the data is then "empty but complete" for the wanted range (no request);
 *  - the wanted range is ONE contiguous range of at most 186 days: the selected date's month ± 1 (follows the date),
 *    widened by ensure(from, to) (ตารางเวร's months); a widening beyond 186 days resets it to the requested range;
 *  - a fetch happens when the wanted range is not covered by the stored range, or the stored version differs from the
 *    remote (onStale of every heartbeat while they differ). It always asks for the WHOLE wanted range (knownVersion only
 *    when that is exactly the stored range) and its answer replaces the domain's content (commit ticket);
 *  - own writes apply their answer at once with touch() (an older answer still in flight is then dropped and the range is
 *    fetched again) and never adopt a version: the next heartbeat's versions.plan triggers the refetch;
 *  - a server without 'plan' (3.0 / 2.x, e.g. after a rollback) wipes the domain; every read below then answers empty;
 *  - logout / a new login wipe it (core: domains reset, ipd_dom:* removed; reset() here drops the memory).
 *
 * API (core.use('plan')) — reads return frozen objects or plain values (never the caller's to mutate):
 *   ready() → bool        plan data for the wanted range is on this device (fetched, restored, or "empty but complete")
 *   loading() → bool      a getPlan is in flight
 *   fresh() → bool        the data was confirmed by the server in this session (else it is the offline copy)
 *   error() → ApiError|null  the last failed fetch (cleared by the next good one)
 *   version() → string    planVersion of the stored data ('' = none / empty)
 *   range() → {from, to}|null   the stored range · covers(from, to) → bool
 *   ensure(from, to) → Promise<bool>   widen the wanted range (≤ 186 days, else reset) and fetch it if needed; true when
 *                         [from, to] is covered afterwards (never rejects)
 *   refresh() → Promise<bool>  fetch the wanted range again (no knownVersion)
 *   R3 fetchStats(from, to) → Promise<{duties: {[date]: Duty}, holidays: Map, version}>  a statistics period (≤ 400 days,
 *                         else VALIDATION) read with ONE getPlan{from, to} beside the wanted range: memory only (never
 *                         persisted, never the domain), memoised per 'from|to' + plan version, fetched again (knownVersion)
 *                         when the heartbeat's versions.plan differs, empty without the 'plan' feature / with versions.plan
 *                         '' (no request), wiped at logout; rejects with the request's ApiError (callers show their state)
 *   roster(month) → Roster|null · duty(date) → Duty|null · duties(month) → {[date]: Duty} (frozen, ascending dates)
 *   holidays() → Map date→name · assistants() → [Assistant] (every row; active flag) · profiles() → Map name→Profile ·
 *   profile(name) → Profile|null · backup(date) → Backup|null · settings() → {priority: [7 ids], slotOrder}
 *   R3-SPEC §3.1: a Profile also holds the personal fields vacBalance, cePoints, ceTarget (number | null), vacAsof,
 *   licenceExpiry ('' | YYYY-MM-DD) — only the keys the answer carried (Code.gs 3.2 sends them for the caller's own row,
 *   every row for the Supervisor; a 3.1 server never): read them with `'vacBalance' in profile`. setProfiles passes the
 *   personal keys of a patch through unchanged and applies the answer's profiles. A role change refetches the plan without
 *   knownVersion; a former Supervisor drops everyone else's personal fields (and the avoid pairs) at once.
 *   Writes (core.userCall; throw ApiError to the caller; the answer is applied before they resolve; a CONFLICT applies
 *   the server's current rows from its details, then rethrows):
 *   saveRoster(p) · saveDuties(p) · setHolidays(p) · saveAssistants(p) · setProfiles(p) · saveBackupMsg(p) ·
 *   setPlanSettings(p) (→ core.applyRules) · adoptDuty(duty) (saveDay's answer)
 *   Engine adapters (the single place every feature builds engine input from):
 *   engineStaff() → [{name, group, active:true}] (active staff, display order)
 *   rosterFor(month) → {[stationId]: names} | null — stored lists filtered to active staff, order kept
 *   assistantsFor(month) → {portable: {[tech]: assistant}, lunch: {er: [], ipd: []}} (active assistants only)
 *   skillsMap() → {[name]: stationId[]} (profiles with skills set; never 'supervisor', R2-SPEC §0.10)
 *   aliasesMap() → {[alias]: name} · eligible() → [{name, phone}] (missionEligible by missionOrder, then staff order)
 *   leaves(from, to) → core leave rows [{date, staff, type, status, detail, …}] (server order per date)
 *   linesFor(date) → [{line, tech, assistant}] | null — the stored duty's lines, else computed from the month's roster
 *                    (buildSeats + portableLines at workingDayIndex, offsets.lines of the month plan or 0)
 *   proposalInput(date, mode = 'fresh', existing?) → the full PlanEngine.proposeDay input (helpers/away of the saved
 *                    backup message, options.priority/slotOrder from settings(), options.restricted = PROPOSAL_RESTRICTED:
 *                    R2-SPEC §0.26(b) — OR, US, Cancer and Prereview/Supervisor are closed by default, so a person whose
 *                    skills are not set (null) is auto-filled only into Portable / IPD / ER and their own roster station)
 *   avoidPairs() → [[a, b]] (frozen) — R2-SPEC §0.27 "ห้ามอยู่คู่กัน": the pairs getPlan gives the Supervisor (nobody else gets
 *                    any), only pairs of two active staff; updated at once by setPlanSettings' answer · avoidPartnersOf(name)
 *                    → [names] · proposalInput passes avoidPairs() as input.avoidPairs · avoidPairsKnown() → bool: the
 *                    pairs held are known to be the Supervisor's current ones (RV-1; a pairs editor saves only then)
 *   R4 (3.3): a Duty's LunchSlot is {tech, assistant, base, tech2, place, place2} (strings, '' default; place2 '' without
 *                    tech2). saveDuties passes the caller's six keys through (a 3.2 server ignores the extra ones); the UI
 *                    that edits tech2 / places is gated by core.serverHas('lunch2') in feat-roster.
 *   R5 (3.4, R5-SPEC §1 / §3.2): the domain also stores `training` — getPlan's [Person] (trainees and students whose
 *                    [start, end] overlaps the asked range ± 200 days), normalised, frozen, in the server's order; an older
 *                    offline copy without it reads as []. Everything below answers empty while core.serverHas('training')
 *                    is false (a 3.3 server, or a rollback). `code` reaches the Supervisor only (others get ''); a role
 *                    change away from the Supervisor drops the codes held at once.
 *   training() → [Person] (frozen) · trainingOn(date) → {[place]: [Person]} — TRAINEES only (students never: R5-SPEC §0),
 *                    TrainingEngine.placeOn (extras override blocks); {} without window.TrainingEngine
 *   saveTraining(p) {items: [Person without id | with id + baseVersion]} → {people} (each answered person replaces /
 *                    adds its row; CONFLICT {ids, people}: the server's current rows are applied, a stale id (ids) the
 *                    server no longer has (not in people) is removed, then it rethrows) · deleteTraining(p) {ids} → {deleted} (rows removed)
 *   R6 (3.5, feature 'lunchEdit'): saveLunch(p) {days: [{date, er?, ipd?, baseVersion}]} → {duties, unchanged} — any logged-in
 *                    user edits the daytime duty (lunch cells only) of stored days; the answer's duties are stored at once;
 *                    CONFLICT / LUNCH_NO_DUTY ({dates, duties}) apply the server's current rows, then rethrow; UNKNOWN_ACTION
 *                    without 'lunchEdit' (no request)
 *   lockedStation(name) → stationId | null — R2-SPEC §0.26(a): the station of an active person whose skills list holds
 *                    exactly ONE station id ("ประจำ <Station>"; the proposal never places them elsewhere — engine canWork);
 *                    null for not set, several or no stations, inactive or unknown names
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !App.core || !window.PlanEngine) return;   // the boot guard stopped app.js
  const C = App.core;
  const U = C.U;
  const PE = window.PlanEngine;

  const MAX_DAYS = 186;                   // R2-SPEC §0.22 (the server allows 400)
  const STATION_IDS = U.STATIONS.map(s => s.id);
  const LUNCH = ['er', 'ipd'];
  /** R2-SPEC §0.26(b): stations never auto-filled by people whose skills are not set (their roster station excepted). */
  const PROPOSAL_RESTRICTED = Object.freeze(['supervisor', 'or', 'us', 'cancer']);
  const NO_PLAN_MSG = 'ต้องอัปเดต Code.gs เป็นเวอร์ชันล่าสุดก่อน';
  /** R3-SPEC §2.2 / §3.1: the personal profile fields (numbers or null; dates or ''). */
  const PERSONAL_NUM = Object.freeze(['vacBalance', 'cePoints', 'ceTarget']);
  const PERSONAL_DATE = Object.freeze(['vacAsof', 'licenceExpiry']);
  const PERSONAL_KEYS = Object.freeze(PERSONAL_NUM.concat(PERSONAL_DATE));
  const STATS_MAX_DAYS = 400;             // R3-SPEC §4.3: fetchStats ranges (the server's getPlan limit)
  const STATS_MEMO_MAX = 12;              // memoised fetchStats ranges kept in memory (oldest dropped first)
  const STATS_RANGE_MSG = 'ช่วงวันที่ต้องไม่เกิน 400 วัน';
  const EMPTY = Object.freeze({ range: null, rosters: Object.freeze({}), duties: Object.freeze({}), holidays: Object.freeze({}),
    holidayYears: Object.freeze([]), assistants: Object.freeze([]), profiles: Object.freeze({}), backup: Object.freeze({}),
    avoidPairs: Object.freeze([]), training: Object.freeze([]) });
  /** R5-SPEC §1: the places of a training block / extra. */
  const TRAINING_PLACES = Object.freeze(['ipd', 'er', 'portable', 'opd', 'us', 'or', 'cancer', 'other']);
  const NO_TRAINING_MSG = 'ต้องอัปเดต Code.gs เป็นเวอร์ชัน 3.4 ก่อน';
  const NO_LUNCH_EDIT_MSG = 'ต้องอัปเดต Code.gs เป็นเวอร์ชัน 3.5 ก่อน';

  let dom = null;           // core.domain('plan')
  let want = null;          // {from, to}: the wanted range
  let inflight = null;      // the getPlan in flight (promise)
  let again = false;        // another sync was asked for while one was in flight
  let forceNext = false;    // the next fetch goes without knownVersion (refresh)
  let heard = false;        // a getData answer of this session told us what the server has
  // an own write was applied and no heartbeat has announced a (non-empty) plan version since: a versions.plan '' that is
  // still around (heard before the write, or an answer requested before it) must not wipe what this device just wrote
  let ownWrite = false;
  // R2 re-review RV-1: after a role change only a FULL getPlan answer (no knownVersion) tells what this role may see (the
  // avoid pairs are Supervisor-only): until it arrives fresh() is false and the pairs count as unknown
  let needFull = false;
  let confirmed = false;    // the stored data was confirmed by the server in this session
  let lastError = null;
  let gen = 0;              // bumps on reset (logout / new login): late answers of the old session are dropped
  let memo = { data: null, holidays: null, profiles: null };
  // R3 fetchStats: memory only (never persisted, never the domain) — key 'from|to' → {version, duties, holidays}; wiped at reset
  let statsMemo = new Map();
  let statsInflight = new Map();          // key → the getPlan promise in flight for it

  /* ------------------------------------------------------------------ helpers */
  const hasOwn = Object.prototype.hasOwnProperty;
  function own(o, k) { return !!o && typeof o === 'object' && hasOwn.call(o, k); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function name(v) { return typeof v === 'string' ? v.trim() : ''; }
  function names(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(v => { const n = name(v); if (n && out.indexOf(n) < 0) out.push(n); });
    return out;
  }
  function int(v) { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  function isMonth(m) { return typeof m === 'string' && /^\d{4}-\d{2}$/.test(m) && U.isValidYmd(m + '-01'); }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(k => deepFreeze(o[k]));
    }
    return o;
  }
  function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function days(from, to) { return U.daysBetweenInclusive(from, to); }
  function covers(r, from, to) { return !!r && !!from && !!to && r.from <= from && to <= r.to; }
  function apiError(code, message) { return new C.Api.ApiError(code, message); }
  function nameMap() { return Object.create(null); }
  function activeNames() { return new Set(C.staff().map(s => s.name)); }

  /** The month ± 1 around a date (as the core's data window). */
  function windowOf(date) {
    const d = U.parseYmd(date) || U.parseYmd(U.todayStr());
    const y = d.getFullYear(), m = d.getMonth();
    return { from: U.ymd(new Date(y, m - 1, 1)), to: U.ymd(new Date(y, m + 2, 0)) };
  }
  function clampRange(from, to) { return days(from, to) > MAX_DAYS ? { from, to: U.addDays(from, MAX_DAYS - 1) } : { from, to }; }
  /** The wanted range widened by [from, to]: one contiguous range ≤ 186 days, else reset to the request. */
  function widened(from, to) {
    if (!want) return clampRange(from, to);
    const f = from < want.from ? from : want.from, t = to > want.to ? to : want.to;
    return days(f, t) <= MAX_DAYS ? { from: f, to: t } : clampRange(from, to);
  }

  /* ------------------------------------------------------------------ normalisers (server answers, the offline copy) */
  function normStations(src) {
    const out = {};
    STATION_IDS.forEach(id => { out[id] = names(src && src[id]); });
    return out;
  }
  function normPair(p) { return { tech: name(p && p.tech), assistant: name(p && p.assistant) }; }
  function normRoster(r) {
    if (!r || typeof r !== 'object' || !isMonth(r.month)) return null;
    const mp = r.monthPlan && typeof r.monthPlan === 'object' ? r.monthPlan : null;
    return {
      month: r.month,
      stations: normStations(r.stations),
      portableAsst: (Array.isArray(r.portableAsst) ? r.portableAsst : []).map(normPair).filter(p => p.tech),
      erAsst: names(r.erAsst),
      ipdAsst: names(r.ipdAsst),
      monthPlan: mp ? { config: mp.config && typeof mp.config === 'object' ? clone(mp.config) : null, tail: mp.tail && typeof mp.tail === 'object' ? clone(mp.tail) : null } : null,
      note: str(r.note),
      version: int(r.version),
      updatedBy: str(r.updatedBy),
      updatedAt: str(r.updatedAt)
    };
  }
  /** R4 (3.3): + tech2 (a second technologist) and the free-text places place / place2 ('' when the server sent none). */
  function normLunchSlot(s) {
    const place = v => str(v).replace(/\s+/g, ' ').trim();
    const tech2 = name(s && s.tech2);
    return { tech: name(s && s.tech), assistant: name(s && s.assistant), base: name(s && s.base), tech2, place: place(s && s.place), place2: tech2 ? place(s && s.place2) : '' };
  }
  function normDuty(d) {
    if (!d || typeof d !== 'object' || !U.isValidYmd(d.date)) return null;
    const lines = Array.isArray(d.lines)
      ? d.lines.map((l, i) => ({ line: int(l && l.line) || i + 1, tech: name(l && l.tech), assistant: name(l && l.assistant) })) : null;
    const lunch = d.lunch && typeof d.lunch === 'object' ? { er: normLunchSlot(d.lunch.er), ipd: normLunchSlot(d.lunch.ipd) } : null;
    return {
      date: d.date, lines, lunch,
      mission: names(d.mission).slice(0, 2),
      missionNext: name(d.missionNext),
      note: str(d.note),
      version: int(d.version),
      updatedBy: str(d.updatedBy),
      updatedAt: str(d.updatedAt)
    };
  }
  function normAssistant(a) {
    const n = name(a && a.name);
    return n ? { name: n, active: a.active !== false, note: str(a.note) } : null;
  }
  function normProfile(p) {
    const n = name(p && p.name);
    if (!n) return null;
    const order = p.missionOrder === null || p.missionOrder === undefined || p.missionOrder === '' ? null : parseInt(p.missionOrder, 10);
    const out = {
      name: n,
      phone: str(p.phone),
      skills: Array.isArray(p.skills) ? p.skills.filter(id => STATION_IDS.indexOf(id) >= 0) : null,
      missionEligible: p.missionEligible === true,
      missionOrder: isFinite(order) ? order : null,
      aliases: names(p.aliases)
    };
    // R3-SPEC §3.1: the personal fields reach a 3.2 client for its own row (every row for the Supervisor); a key the answer
    // does not carry stays absent (a 3.1 server, or another person's row) — readers tell "not delivered" from "empty"
    PERSONAL_NUM.forEach(k => { if (own(p, k)) out[k] = personalNum(p[k]); });
    PERSONAL_DATE.forEach(k => { if (own(p, k)) out[k] = U.isValidYmd(p[k]) ? p[k] : ''; });
    return out;
  }
  function personalNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const x = typeof v === 'number' ? v : Number(v);
    return isFinite(x) ? x : null;
  }
  /** Whether a normalised profile holds any personal field. */
  function hasPersonal(p) { return !!p && PERSONAL_KEYS.some(k => own(p, k)); }
  /** A copy of a normalised profile without the personal fields. */
  function withoutPersonal(p) {
    const out = {};
    Object.keys(p).forEach(k => { if (PERSONAL_KEYS.indexOf(k) < 0) out[k] = p[k]; });
    return out;
  }
  function normBackup(b) {
    if (!b || typeof b !== 'object' || !U.isValidYmd(b.date)) return null;
    return {
      date: b.date,
      text: str(b.text),
      helpers: (Array.isArray(b.helpers) ? b.helpers : []).map(h => ({ name: name(h && h.name), station: STATION_IDS.indexOf(h && h.station) >= 0 ? h.station : '' })).filter(h => h.name),
      away: (Array.isArray(b.away) ? b.away : []).map(a => ({ name: name(a && a.name), unit: str(a && a.unit) })).filter(a => a.name),
      postedBy: str(b.postedBy),
      postedAt: str(b.postedAt)
    };
  }
  /** R5-SPEC §1: a training range {from, to, place[, label]} or null. */
  function normRange(b, withLabel) {
    if (!b || typeof b !== 'object' || !U.isValidYmd(b.from) || !U.isValidYmd(b.to) || b.from > b.to || TRAINING_PLACES.indexOf(b.place) < 0) return null;
    const out = { from: b.from, to: b.to, place: b.place };
    if (withLabel) out.label = str(b.label).trim();
    return out;
  }
  function normTraining(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || !name(p.name)) return null;
    if (!U.isValidYmd(p.start) || !U.isValidYmd(p.end)) return null;
    const ranges = (list, lab) => (Array.isArray(list) ? list : []).map(b => normRange(b, lab)).filter(Boolean)
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    return {
      id: p.id,
      kind: p.kind === 'student' ? 'student' : 'trainee',
      name: name(p.name),
      nickname: name(p.nickname),
      code: name(p.code),
      org: name(p.org),
      cohort: name(p.cohort),
      start: p.start, end: p.end,
      blocks: ranges(p.blocks, false),
      extras: ranges(p.extras, true),
      note: str(p.note),
      version: int(p.version),
      updatedBy: str(p.updatedBy),
      updatedAt: str(p.updatedAt)
    };
  }
  function trainingList(list) { return (Array.isArray(list) ? list : []).map(normTraining).filter(Boolean); }
  function yearsOf(r) {
    if (!r) return [];
    const out = [];
    for (let y = +r.from.slice(0, 4); y <= +r.to.slice(0, 4); y++) out.push(y);
    return out;
  }

  /** A getPlan answer → the domain's data for `range` (everything replaced). */
  function buildData(res, range, pairsSup) {
    const r = res.range && U.isValidYmd(res.range.from) && U.isValidYmd(res.range.to) ? { from: res.range.from, to: res.range.to } : { from: range.from, to: range.to };
    const out = { range: r, rosters: {}, duties: {}, holidays: {}, holidayYears: yearsOf(r), assistants: [], profiles: {}, backup: {},
      avoidPairs: normPairs(res.avoidPairs), pairsSup: pairsSup === true, training: trainingList(res.training) };
    (Array.isArray(res.rosters) ? res.rosters : []).forEach(x => { const v = normRoster(x); if (v) out.rosters[v.month] = v; });
    (Array.isArray(res.duties) ? res.duties : []).forEach(x => { const v = normDuty(x); if (v) out.duties[v.date] = v; });
    (Array.isArray(res.holidays) ? res.holidays : []).forEach(h => { if (h && U.isValidYmd(h.date)) out.holidays[h.date] = str(h.name); });
    out.assistants = (Array.isArray(res.assistants) ? res.assistants : []).map(normAssistant).filter(Boolean);
    (Array.isArray(res.profiles) ? res.profiles : []).forEach(x => { const v = normProfile(x); if (v) out.profiles[v.name] = v; });
    (Array.isArray(res.backup) ? res.backup : []).forEach(x => { const v = normBackup(x); if (v) out.backup[v.date] = v; });
    return deepFreeze(sortKeys(out));
  }
  /** Duties / backup / holidays / rosters keyed in ascending order (stable iteration for every reader). */
  function sortKeys(d) {
    ['rosters', 'duties', 'holidays', 'backup'].forEach(k => {
      const src = d[k], out = {};
      Object.keys(src).sort().forEach(key => { out[key] = src[key]; });
      d[k] = out;
    });
    return d;
  }
  /** A mutable copy of the stored data for touch() (sections copied one level deep, entries replaced, never mutated). */
  function editable(d) {
    const x = valid(d) ? d : EMPTY;
    return {
      range: x.range ? { from: x.range.from, to: x.range.to } : null,
      rosters: Object.assign({}, x.rosters), duties: Object.assign({}, x.duties), holidays: Object.assign({}, x.holidays),
      holidayYears: x.holidayYears.slice(), assistants: x.assistants.slice(), profiles: Object.assign({}, x.profiles),
      backup: Object.assign({}, x.backup),
      avoidPairs: Array.isArray(x.avoidPairs) ? x.avoidPairs.slice() : [],
      pairsSup: x.pairsSup === true,
      training: Array.isArray(x.training) ? x.training.slice() : []
    };
  }
  function valid(d) {
    return !!d && typeof d === 'object' && (d.range === null || (d.range && U.isValidYmd(d.range.from) && U.isValidYmd(d.range.to))) &&
      ['rosters', 'duties', 'holidays', 'profiles', 'backup'].every(k => d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) &&
      Array.isArray(d.assistants) && Array.isArray(d.holidayYears);
  }
  function emptyFor(range, pairsSup) { return deepFreeze({ range: range ? { from: range.from, to: range.to } : null, rosters: {}, duties: {}, holidays: {}, holidayYears: yearsOf(range), assistants: [], profiles: {}, backup: {}, avoidPairs: [], pairsSup: pairsSup === true, training: [] }); }
  /** R2-SPEC §0.27: [[a, b]] → distinct pairs of two different names, names sorted inside a pair, pairs sorted. */
  function normPairs(list) {
    const seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(p => {
      if (!Array.isArray(p)) return;
      const a = name(p[0]), b = name(p[1]);
      if (!a || !b || a === b) return;
      const pair = a < b ? [a, b] : [b, a];
      const key = pair.join('|');
      if (seen[key]) return;
      seen[key] = true;
      out.push(pair);
    });
    return out.sort((x, y) => (x.join('|') < y.join('|') ? -1 : 1));
  }

  /** The stored data as every reader sees it (EMPTY while the server has no plan feature or the copy is unusable). */
  function data() {
    if (!dom || !C.serverHas('plan')) return EMPTY;
    const d = dom.data;
    if (!valid(d)) return EMPTY;
    if (!Object.isFrozen(d)) deepFreeze(d);   // the offline copy (restored from localStorage) is frozen on first use
    if (memo.data !== d) memo = { data: d, holidays: null, profiles: null };
    return d;
  }

  /* ------------------------------------------------------------------ fetching */
  function canFetch() {
    const st = C.state;
    return !!dom && !!st.session && !!st.user && !st.user.mustChangePassword && C.serverHas('plan') && !!want;
  }
  function needed() {
    const d = valid(dom.data) ? dom.data : EMPTY;
    return !covers(d.range, want.from, want.to) || dom.version !== dom.remote;
  }
  /** "Empty but complete": the server reports no plan rows — the wanted range holds nothing (no request). */
  function commitEmpty() {
    const d = valid(dom.data) ? dom.data : EMPTY;
    if (ownWrite) {
      // the next heartbeat brings the version of that write, then the range is fetched; until then the plan was empty plus
      // this device's own writes — exactly what is held — so a newly wanted range is covered by it (never "loading" forever)
      if (!covers(d.range, want.from, want.to)) {
        const r = want;
        if (dom.commit(dom.begin(), dom.version, x => deepFreeze(sortKeys(Object.assign(editable(x), { range: { from: r.from, to: r.to }, holidayYears: yearsOf(r) }))))) C.render();
      }
      return;
    }
    const isEmpty = !Object.keys(d.rosters).length && !Object.keys(d.duties).length && !Object.keys(d.holidays).length &&
      !d.assistants.length && !Object.keys(d.profiles).length && !Object.keys(d.backup).length && !(d.training || []).length;
    confirmed = true;
    needFull = false;   // versions.plan '' (heard this session): no plan rows and no pairs at all — nothing to fetch
    const sup = C.isSup();
    if (isEmpty && dom.version === '' && covers(d.range, want.from, want.to) && d.pairsSup === sup) return;
    if (dom.commit(dom.begin(), '', () => emptyFor(want, sup))) C.render();
  }

  /** Brings the domain in line with the wanted range and the remote version. → Promise<bool> (never rejects). */
  function sync() {
    if (!canFetch()) return Promise.resolve(false);
    if (inflight) { again = true; return inflight; }
    if (!dom.remote) {
      if (heard) commitEmpty();   // the server said: no plan rows (versions.plan '')
      return Promise.resolve(false);
    }
    if (!forceNext && !needFull && !needed()) return Promise.resolve(false);
    const range = { from: want.from, to: want.to };
    const stored = valid(dom.data) ? dom.data.range : null;
    const params = { from: range.from, to: range.to };
    if (!forceNext && !needFull && dom.version && stored && stored.from === range.from && stored.to === range.to) params.knownVersion = dom.version;
    forceNext = false;
    const ticket = dom.begin();
    const alive = C.alive(), g = gen;
    const supAsked = C.isSup();   // the answer holds the pairs only when it was asked for (and arrives) as the Supervisor
    let outcome = 'error';
    const p = C.track(C.call('getPlan', params).then(res => {
      if (!alive() || g !== gen) { outcome = 'gone'; return false; }
      if (!res || typeof res !== 'object') return false;
      const v = typeof res.planVersion === 'string' ? res.planVersion : '';
      const ok = res.unchanged === true
        ? dom.commit(ticket, v, d => (Array.isArray(res.avoidPairs) && valid(d) ? deepFreeze(sortKeys(Object.assign(editable(d), { avoidPairs: normPairs(res.avoidPairs) }))) : undefined))
        : dom.commit(ticket, v, () => buildData(res, range, supAsked && C.isSup()));
      outcome = ok ? 'ok' : 'stale';
      if (ok && res.unchanged !== true && supAsked === C.isSup()) needFull = false;   // asked under the role it arrives in
      if (ok && !needFull) { confirmed = true; lastError = null; }
      return ok;
    }, e => {
      if (alive() && g === gen) {
        lastError = e;
        if (!(e && (C.Api.isTransient(e) || e.code === 'AUTH_REQUIRED' || e.code === 'PASSWORD_CHANGE_REQUIRED'))) {
          console.warn('[plan-data] getPlan failed:', e && (e.code || e.message));
        }
      }
      return false;
    }).then(ok => {
      if (inflight === p) inflight = null;
      if (!alive() || g !== gen) return false;
      // an own write (touch) came in meanwhile: this answer was dropped — fetch again; or another range was asked for
      const rerun = again || outcome === 'stale';
      again = false;
      C.render();   // วันนี้ (proposal, ของฉันวันนี้) and the plan screens read this data
      if (rerun) return sync().then(() => ok);
      return ok;
    }));
    inflight = p;
    return p;
  }

  /** Widens the wanted range by [from, to] and fetches what is missing. → Promise<bool>: [from, to] covered afterwards. */
  function ensure(from, to) {
    if (!U.isValidYmd(from) || !U.isValidYmd(to) || from > to) return Promise.resolve(false);
    const r = clampRange(from, to);
    want = widened(r.from, r.to);
    return sync().then(() => covers(data().range, r.from, r.to), () => false);
  }

  /* ------------------------------------------------------------------ statistics ranges (R3-SPEC §4.3) */
  function statsView(e) { return Object.freeze({ duties: e.duties, holidays: new Map(e.holidays), version: e.version }); }
  function statsEmpty() { return statsView({ duties: Object.freeze({}), holidays: new Map(), version: '' }); }
  /** A getPlan answer → the memo entry: normalised frozen duties (ascending dates) and the holidays it lists. */
  function statsEntry(res, version) {
    const duties = {}, list = [], hol = new Map();
    (Array.isArray(res.duties) ? res.duties : []).forEach(x => { const v = normDuty(x); if (v) list.push(v); });
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(v => { duties[v.date] = v; });
    (Array.isArray(res.holidays) ? res.holidays : []).filter(h => h && U.isValidYmd(h.date))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach(h => { if (!hol.has(h.date)) hol.set(h.date, str(h.name)); });
    return { version, duties: deepFreeze(duties), holidays: hol };
  }
  function statsRemember(key, entry) {
    statsMemo.delete(key);
    statsMemo.set(key, entry);
    while (statsMemo.size > STATS_MEMO_MAX) statsMemo.delete(statsMemo.keys().next().value);
  }
  /**
   * fetchStats(from, to) → Promise<{duties: {[date]: Duty}, holidays: Map date→name, version}> — the plan duties and holidays
   * of a statistics period (≤ 400 days), read with ONE getPlan{from, to} next to the wanted range: memory only (never
   * persisted, never touches the domain), memoised per 'from|to' + plan version, fetched again (knownVersion = the memo's
   * version) when the heartbeat's versions.plan differs; empty (no request) while the server lacks 'plan', reports no plan
   * rows (versions.plan ''), nobody is logged in or a password change is forced; wiped at logout. Rejects with the ApiError
   * of the request (VALIDATION for a bad range).
   */
  function fetchStats(from, to) {
    if (!U.isValidYmd(from) || !U.isValidYmd(to) || from > to || days(from, to) > STATS_MAX_DAYS) {
      return Promise.reject(apiError('VALIDATION', STATS_RANGE_MSG));
    }
    const st = C.state;
    if (!dom || !st.session || !st.user || st.user.mustChangePassword || !C.serverHas('plan')) return Promise.resolve(statsEmpty());
    if (heard && !dom.remote) return Promise.resolve(statsEmpty());   // versions.plan '': no plan rows at all
    const key = from + '|' + to;
    const hit = statsMemo.get(key);
    if (hit && (!heard || hit.version === dom.remote)) return Promise.resolve(statsView(hit));
    if (statsInflight.has(key)) return statsInflight.get(key);
    const alive = C.alive(), g = gen;
    const params = { from, to };
    if (hit && hit.version) params.knownVersion = hit.version;
    const p = C.track(C.call('getPlan', params).then(res => {
      if (statsInflight.get(key) === p) statsInflight.delete(key);
      if (!alive() || g !== gen) return statsEmpty();   // an answer of a session that ended: kept nowhere
      const r = res && typeof res === 'object' ? res : {};
      const v = typeof r.planVersion === 'string' ? r.planVersion : '';
      const entry = r.unchanged === true && hit ? { version: v, duties: hit.duties, holidays: hit.holidays } : statsEntry(r, v);
      statsRemember(key, entry);
      return statsView(entry);
    }, e => {
      if (statsInflight.get(key) === p) statsInflight.delete(key);
      throw e;
    }));
    statsInflight.set(key, p);
    return p;
  }

  /* ------------------------------------------------------------------ events */
  /** After every getData answer ({from, to, changed}): what the server has decides. */
  function onData(p) {
    if (!p || typeof p !== 'object' || !hasOwn.call(p, 'changed') || !C.state.session || !dom) return;
    if (C.serverMode() === '') return;
    heard = true;
    if (!C.serverHas('plan')) {
      // a server without the plan feature (3.0 / 2.x, e.g. rolled back): nothing of the plan may be shown or kept
      const d = dom.data;
      if (dom.version !== '' || (valid(d) && d.range)) {
        confirmed = false;
        dom.commit(dom.begin(), '', () => emptyFor(null));
      }
      return;
    }
    // R5: a server without 'training' (3.3, e.g. rolled back): the trainee / student rows held are not kept either
    if (!C.serverHas('training') && valid(dom.data) && Array.isArray(dom.data.training) && dom.data.training.length) {
      dom.commit(dom.begin(), dom.version, d => deepFreeze(sortKeys(Object.assign(editable(d), { training: [] }))));
    }
    if (!want) want = windowOf(C.selectedDate());
    if (!dom.remote) { commitEmpty(); return; }
    ownWrite = false;   // the server announced a plan version (an own write's included)
    if (!needFull && dom.version === dom.remote && covers(data().range, want.from, want.to)) confirmed = true;
    sync();
  }

  function startSession() {
    gen++;
    want = windowOf(C.selectedDate());
    inflight = null;
    again = false;
    forceNext = false;
    heard = false;
    ownWrite = false;
    needFull = false;
    confirmed = false;
    lastError = null;
    memo = { data: null, holidays: null, profiles: null };
  }

  /* ------------------------------------------------------------------ writes */
  async function write(action, params, apply, onConflict) {
    if (!C.serverHas('plan')) throw apiError('UNKNOWN_ACTION', NO_PLAN_MSG);
    const alive = C.alive(), g = gen;
    let res;
    try {
      res = await C.userCall(action, params);
    } catch (e) {
      if (alive() && g === gen && e && e.code === 'CONFLICT' && e.details && typeof e.details === 'object' && onConflict) {
        change(d => onConflict(d, e.details));
      }
      throw e;
    }
    if (alive() && g === gen && res && typeof res === 'object') change(d => apply(d, res), res.unchanged === true);
    return res;
  }
  /** A local change (own write's answer): touch() — an older answer in flight is dropped — then everything renders. */
  function change(fn, unchanged) {
    if (!dom) return;
    if (!unchanged) ownWrite = true;   // R2 FIX I-5: "unchanged" wrote nothing — no new plan version will come for it
    dom.touch(d => {
      const x = editable(d);
      fn(x);
      return deepFreeze(sortKeys(x));
    });
    C.render();
  }
  function putRoster(d, r) { const v = normRoster(r); if (v) d.rosters[v.month] = v; }
  function putDuty(d, x) { const v = normDuty(x); if (v) d.duties[v.date] = v; }

  function saveRoster(p) {
    return write('saveRoster', p, (d, res) => putRoster(d, res.roster), (d, det) => {
      if (det.roster) putRoster(d, det.roster);
      else if (p && isMonth(p.month)) delete d.rosters[p.month];
    });
  }
  function saveDuties(p) {
    return write('saveDuties', p, (d, res) => {
      (Array.isArray(res.duties) ? res.duties : []).forEach(x => putDuty(d, x));
      const mp = p && p.monthPlan;
      if (mp && isMonth(mp.month) && d.rosters[mp.month]) {
        // the server stored it in Rosters.plan without changing the roster's version
        const r = clone(d.rosters[mp.month]);
        r.monthPlan = { config: mp.config && typeof mp.config === 'object' ? clone(mp.config) : null, tail: mp.tail && typeof mp.tail === 'object' ? clone(mp.tail) : null };
        d.rosters[mp.month] = r;
      }
    }, (d, det) => {
      const current = Array.isArray(det.duties) ? det.duties : [];
      current.forEach(x => putDuty(d, x));
      (Array.isArray(det.dates) ? det.dates : []).forEach(date => {
        if (U.isValidYmd(date) && !current.some(x => x && x.date === date)) delete d.duties[date];
      });
    });
  }
  /** The server's current rows of a refused duty write ({dates, duties}): applied; an asked date without a row is removed. */
  function applyCurrentDuties(d, det) {
    const current = Array.isArray(det.duties) ? det.duties : [];
    current.forEach(x => putDuty(d, x));
    (Array.isArray(det.dates) ? det.dates : []).forEach(date => {
      if (U.isValidYmd(date) && !current.some(x => x && x.date === date)) delete d.duties[date];
    });
  }
  /**
   * R6 (Code.gs 3.5, feature 'lunchEdit'): any logged-in user edits the daytime duty of stored days —
   * {days: [{date, er?: Slot, ipd?: Slot, baseVersion}]} with Slot {tech, assistant, tech2, place, place2}. The answer's
   * duties are stored at once; a CONFLICT (and a LUNCH_NO_DUTY refusal, which carries them too) applies the server's current
   * rows, then rethrows. A server without 'lunchEdit' → UNKNOWN_ACTION (no request).
   */
  async function saveLunch(p) {
    if (!C.serverHas('lunchEdit')) throw apiError('UNKNOWN_ACTION', NO_LUNCH_EDIT_MSG);
    const alive = C.alive(), g = gen;
    try {
      return await write('saveLunch', p, (d, res) => {
        (Array.isArray(res.duties) ? res.duties : []).forEach(x => putDuty(d, x));
      }, applyCurrentDuties);
    } catch (e) {
      if (alive() && g === gen && e && e.code === 'VALIDATION' && e.details && typeof e.details === 'object' &&
        Array.isArray(e.details.duties) && Array.isArray(e.details.dates)) change(d => applyCurrentDuties(d, e.details));
      throw e;
    }
  }
  function setHolidays(p) {
    return write('setHolidays', p, (d, res) => {
      const year = int(res.year || (p && p.year));
      if (!year) return;
      Object.keys(d.holidays).forEach(date => { if (+date.slice(0, 4) === year) delete d.holidays[date]; });
      (Array.isArray(res.holidays) ? res.holidays : []).forEach(h => { if (h && U.isValidYmd(h.date) && +h.date.slice(0, 4) === year) d.holidays[h.date] = str(h.name); });
      if (d.holidayYears.indexOf(year) < 0) d.holidayYears.push(year);
    });
  }
  function saveAssistants(p) {
    return write('saveAssistants', p, (d, res) => {
      if (Array.isArray(res.assistants)) d.assistants = res.assistants.map(normAssistant).filter(Boolean);
    });
  }
  function setProfiles(p) {
    return write('setProfiles', p, (d, res) => {
      (Array.isArray(res.profiles) ? res.profiles : []).forEach(x => { const v = normProfile(x); if (v) d.profiles[v.name] = v; });
    });
  }
  function saveBackupMsg(p) {
    return write('saveBackupMsg', p, (d, res) => {
      const date = p && U.isValidYmd(p.date) ? p.date : '';
      const v = normBackup(res.backup);
      if (v) d.backup[v.date] = v;
      else if (date) delete d.backup[date];
    });
  }
  async function setPlanSettings(p) {
    if (!C.serverHas('plan')) throw apiError('UNKNOWN_ACTION', NO_PLAN_MSG);
    const alive = C.alive(), g = gen;
    const res = await C.userCall('setPlanSettings', p);
    // R2 FIX I-2: an answer that arrives after a logout / another login belongs to nobody here (the pairs are Supervisor-only)
    if (alive() && g === gen && res && res.rules && typeof res.rules === 'object') {
      C.applyRules(res.rules);
      if (Array.isArray(res.rules.avoidPairs)) change(d => { d.avoidPairs = normPairs(res.rules.avoidPairs); d.pairsSup = C.isSup(); });   // Supervisor only
    }
    return res;
  }
  /* R5-SPEC §3.2: training writes (Supervisor; the server checks) — gated on the server's 'training' feature */
  function putTraining(d, p) {
    const v = normTraining(p);
    if (!v) return;
    const i = d.training.findIndex(x => x.id === v.id);
    if (i >= 0) d.training[i] = v; else d.training.push(v);
  }
  function saveTraining(p) {
    if (!C.serverHas('training')) return Promise.reject(apiError('UNKNOWN_ACTION', NO_TRAINING_MSG));
    return write('saveTraining', p, (d, res) => {
      (Array.isArray(res.people) ? res.people : []).forEach(x => putTraining(d, x));
    }, (d, det) => {
      const current = Array.isArray(det.people) ? det.people : [];
      current.forEach(x => putTraining(d, x));
      // R6 fix: only a stale id (det.ids) that the server no longer has (missing from det.people) was deleted on another
      // device — the other asked ids were fine and stay
      const gone = (Array.isArray(det.ids) ? det.ids : []).filter(id => !current.some(c => c && c.id === id));
      d.training = d.training.filter(x => gone.indexOf(x.id) < 0);
    });
  }
  function deleteTraining(p) {
    if (!C.serverHas('training')) return Promise.reject(apiError('UNKNOWN_ACTION', NO_TRAINING_MSG));
    return write('deleteTraining', p, (d, res) => {
      const gone = Array.isArray(res.deleted) ? res.deleted : (p && Array.isArray(p.ids) ? p.ids : []);
      d.training = d.training.filter(x => gone.indexOf(x.id) < 0);
    });
  }

  /** saveDay's answer `duty` (core) or a CONFLICT's current duty: stored at once, no version adopted. */
  function adoptDuty(duty) {
    if (!normDuty(duty)) return false;
    change(d => putDuty(d, duty));
    return true;
  }

  /* ------------------------------------------------------------------ reads */
  function roster(month) { const d = data(); return own(d.rosters, month) ? d.rosters[month] : null; }
  function duty(date) { const d = data(); return own(d.duties, date) ? d.duties[date] : null; }
  function duties(month) {
    const d = data(), out = {};
    if (isMonth(month)) Object.keys(d.duties).forEach(date => { if (date.slice(0, 7) === month) out[date] = d.duties[date]; });
    return Object.freeze(out);
  }
  function holidays() {
    const d = data();
    if (memo.data === d && memo.holidays) return new Map(memo.holidays);
    const m = new Map();
    Object.keys(d.holidays).forEach(date => m.set(date, d.holidays[date]));
    if (memo.data === d) memo.holidays = m;
    return new Map(m);
  }
  function assistants() { return data().assistants; }
  function profiles() {
    const d = data();
    if (memo.data === d && memo.profiles) return new Map(memo.profiles);
    const m = new Map();
    Object.keys(d.profiles).forEach(n => m.set(n, d.profiles[n]));
    if (memo.data === d) memo.profiles = m;
    return new Map(m);
  }
  function profile(n) { const d = data(); return own(d.profiles, n) ? d.profiles[n] : null; }
  function backup(date) { const d = data(); return own(d.backup, date) ? d.backup[date] : null; }
  /** R2-SPEC §0.27: the stored pairs of two ACTIVE staff (a deleted name drops its pairs). */
  function avoidPairs() {
    if (!C.isSup()) return Object.freeze([]);   // Supervisor-only data (R2-SPEC §0.27)
    const d = data();
    const act = activeNames();
    return Object.freeze((Array.isArray(d.avoidPairs) ? d.avoidPairs : []).filter(p => act.has(p[0]) && act.has(p[1])).map(p => Object.freeze([p[0], p[1]])));
  }
  function avoidPartnersOf(n) {
    return avoidPairs().filter(p => p[0] === n || p[1] === n).map(p => (p[0] === n ? p[1] : p[0]));
  }
  /** R5: the stored trainees and students (frozen); [] without the server's 'training' feature. */
  function training() {
    if (!C.serverHas('training')) return Object.freeze([]);
    const d = data();
    return Array.isArray(d.training) ? d.training : Object.freeze([]);
  }
  /** R5: {[place]: [trainee]} of a date — trainees only (students never appear on วันนี้). */
  function trainingOn(date) {
    const out = {};
    const TE = window.TrainingEngine;
    if (!TE || !U.isValidYmd(date)) return out;
    training().forEach(p => {
      if (p.kind !== 'trainee') return;
      const pl = TE.placeOn(p, date);
      if (pl) (out[pl] || (out[pl] = [])).push(p);
    });
    return out;
  }
  function settings() {
    const r = C.state.rules || {};
    return Object.freeze({
      priority: Array.isArray(r.planPriority) ? r.planPriority.slice() : PE.DEFAULT_PRIORITY.slice(),
      slotOrder: r.planSlotOrder === 'priority' ? 'priority' : 'coverage'
    });
  }

  /* ------------------------------------------------------------------ engine adapters */
  function engineStaff() { return C.staff().map(s => ({ name: s.name, group: s.group, active: true })); }
  function rosterFor(month) {
    const r = roster(month);
    if (!r) return null;
    const act = activeNames();
    const out = {};
    STATION_IDS.forEach(id => { out[id] = r.stations[id].filter(n => act.has(n)); });
    return out;
  }
  function activeAssistantSet() { return new Set(assistants().filter(a => a.active).map(a => a.name)); }
  function assistantsFor(month) {
    const r = roster(month);
    const out = { portable: nameMap(), lunch: { er: [], ipd: [] } };
    if (!r) return out;
    const act = activeNames(), asst = activeAssistantSet();
    const techs = new Set(r.stations.portable.filter(n => act.has(n)));
    r.portableAsst.forEach(p => { if (techs.has(p.tech) && asst.has(p.assistant)) out.portable[p.tech] = p.assistant; });
    out.lunch.er = r.erAsst.filter(n => asst.has(n));
    out.lunch.ipd = r.ipdAsst.filter(n => asst.has(n));
    return out;
  }
  function skillsMap() {
    const act = activeNames(), d = data(), out = nameMap();
    Object.keys(d.profiles).forEach(n => {
      const p = d.profiles[n];
      if (act.has(n) && Array.isArray(p.skills)) out[n] = p.skills.filter(id => id !== 'supervisor');
    });
    return out;
  }
  function aliasesMap() {
    const act = activeNames(), d = data(), out = nameMap();
    Object.keys(d.profiles).forEach(n => {
      if (!act.has(n)) return;
      d.profiles[n].aliases.forEach(a => { if (!(a in out)) out[a] = n; });
    });
    return out;
  }
  function eligible() {
    const d = data();
    const order = C.staff().map(s => s.name);
    return order.filter(n => own(d.profiles, n) && d.profiles[n].missionEligible)
      .map((n, i) => ({ n, i, o: d.profiles[n].missionOrder }))
      .sort((a, b) => (a.o === null ? 1e9 : a.o) - (b.o === null ? 1e9 : b.o) || a.i - b.i)
      .map(x => ({ name: x.n, phone: d.profiles[x.n].phone }));
  }
  function leaves(from, to) {
    if (!U.isValidYmd(from) || !U.isValidYmd(to) || from > to) return [];
    const out = [];
    U.eachDate(from, to).forEach(date => {
      const map = C.leavesOn(date);
      Object.keys(map).forEach(n => {
        const l = map[n];
        if (l && typeof l === 'object' && l.type) out.push(Object.assign({}, l, { date, staff: n }));
      });
    });
    return out;
  }
  function linesFor(date) {
    if (!U.isValidYmd(date)) return null;
    const stored = duty(date);
    if (stored) return stored.lines ? stored.lines.map(l => ({ line: l.line, tech: l.tech, assistant: l.assistant })) : null;
    const month = date.slice(0, 7);
    const r = rosterFor(month);
    if (!r) return null;
    const k = PE.workingDayIndex(date, holidays());
    if (k < 0) return null;
    const L = C.state.stationCounts.portable;
    const seats = PE.buildSeats(r.portable, assistantsFor(month).portable, L);
    const mp = roster(month).monthPlan;
    const off = mp && mp.config && mp.config.offsets && Number.isInteger(mp.config.offsets.lines) ? mp.config.offsets.lines : 0;
    return PE.portableLines(seats, L, k, off).lines;
  }
  function lockedStation(n) {
    if (typeof n !== 'string' || !activeNames().has(n)) return null;
    const p = profile(n);
    const list = p && Array.isArray(p.skills) ? p.skills.filter(id => id !== 'supervisor') : null;
    return list && list.length === 1 ? list[0] : null;
  }
  function proposalInput(date, mode, existing) {
    const month = String(date).slice(0, 7);
    const b = backup(date);
    const s = settings();
    const input = {
      date,
      holidays: holidays(),
      counts: Object.assign({}, C.state.stationCounts),
      roster: rosterFor(month) || {},
      lines: linesFor(date),
      leaves: leaves(date, date),
      helpers: b ? b.helpers.map(h => ({ name: h.name, station: h.station })) : [],
      away: b ? b.away.map(a => ({ name: a.name, unit: a.unit })) : [],
      staff: engineStaff(),
      skills: skillsMap(),
      avoidPairs: avoidPairs().map(p => [p[0], p[1]]),
      options: { mode: mode === 'fill' ? 'fill' : 'fresh', priority: s.priority, slotOrder: s.slotOrder, restricted: PROPOSAL_RESTRICTED.slice() }
    };
    if (existing && typeof existing === 'object') input.existing = clone(existing);
    return input;
  }

  /* ------------------------------------------------------------------ the API */
  const api = Object.freeze({
    ready: () => C.serverHas('plan') && !!data().range,
    loading: () => !!inflight,
    fresh: () => C.serverHas('plan') && confirmed && !needFull,
    // RV-1: the avoid pairs held are the Supervisor's current ones — read from a full getPlan answer (or a versions.plan '')
    // as the Supervisor, or from setPlanSettings' answer (kept with the offline copy: any pairs change bumps the plan
    // version, so a copy at the current version is current). False after a role change until a full answer arrives.
    avoidPairsKnown: () => C.serverHas('plan') && C.isSup() && !needFull && valid(dom && dom.data) && dom.data.pairsSup === true,
    error: () => lastError,
    version: () => (dom ? dom.version : ''),
    range: () => { const r = data().range; return r ? Object.freeze({ from: r.from, to: r.to }) : null; },
    covers: (from, to) => covers(data().range, from, to),
    ensure,
    refresh: () => { forceNext = true; return sync(); },
    fetchStats,
    roster, duty, duties, holidays, assistants, profiles, profile, backup, settings,
    saveRoster, saveDuties, saveLunch, setHolidays, saveAssistants, setProfiles, saveBackupMsg, setPlanSettings, adoptDuty,
    engineStaff, rosterFor, assistantsFor, skillsMap, aliasesMap, eligible, leaves, linesFor, proposalInput, lockedStation,
    avoidPairs, avoidPartnersOf,
    training, trainingOn, saveTraining, deleteTraining
  });

  App.register({
    id: 'plan-data',
    title: 'ข้อมูลตารางเวร',
    nav: { place: 'none' },
    visible: () => false,   // no screen of its own
    init(c) {
      dom = c.domain('plan', { persist: true, empty: EMPTY });
      dom.onStale(() => { heard = true; ownWrite = false; sync(); });
      c.provide('plan', api);
      c.on('data', onData);
      c.on('login', () => startSession());
      // R2 FIX I-1: getPlan answers differ by role (avoidPairs for the Supervisor only) and a transfer does not change the plan
      // version — so a role change fetches the range again; a former Supervisor's copy loses the pairs at once
      c.on('role', p => {
        if (!c.state.session || !dom) return;
        const me = c.myName();
        const others = !(p && p.isSup) && valid(dom.data) &&
          Object.keys(dom.data.profiles).some(n => n !== me && hasPersonal(dom.data.profiles[n]));
        // R5-SPEC §2.3: the trainee / student codes are the Supervisor's only
        const codes = !(p && p.isSup) && valid(dom.data) && Array.isArray(dom.data.training) && dom.data.training.some(x => x && x.code);
        if (codes) dom.touch(d => deepFreeze(sortKeys(Object.assign(editable(d), { training: (d.training || []).map(x => Object.assign({}, x, { code: '' })) }))));
        if (others || (valid(dom.data) && (dom.data.pairsSup === true || (Array.isArray(dom.data.avoidPairs) && dom.data.avoidPairs.length)))) {
          // the pairs held were read under the other role: a former Supervisor drops them, a new one must not trust them;
          // R3: a former Supervisor also drops everyone else's personal fields at once (R3-SPEC §3.1 visibility)
          dom.touch(d => {
            const x = Object.assign(editable(d), { avoidPairs: p && p.isSup ? (d.avoidPairs || []) : [], pairsSup: false });
            if (others) Object.keys(x.profiles).forEach(n => { if (n !== me && hasPersonal(x.profiles[n])) x.profiles[n] = withoutPersonal(x.profiles[n]); });
            return deepFreeze(sortKeys(x));
          });
        }
        // RV-1: fresh() and avoidPairsKnown() stay false until a full answer of this role arrives; R3-SPEC §4.3: the refetch goes
        // without knownVersion (the Supervisor's answer carries everyone's personal fields and the avoid pairs)
        needFull = true;
        confirmed = false;
        forceNext = true;
        sync();
      });
      c.on('date', p => { if (p && U.isValidYmd(p.date) && c.state.session) ensure(windowOf(p.date).from, windowOf(p.date).to); });
      if (c.state.session) startSession();   // registered after the session started (late registration)
    },
    reset() {
      gen++;
      want = null;
      inflight = null;
      again = false;
      forceNext = false;
      heard = false;
    ownWrite = false;
      needFull = false;
      confirmed = false;
      lastError = null;
      memo = { data: null, holidays: null, profiles: null };
      statsMemo = new Map();      // R3: the statistics ranges are wiped at logout
      statsInflight = new Map();
    }
  });
})();
