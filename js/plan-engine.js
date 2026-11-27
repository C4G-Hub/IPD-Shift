/* =====================================================================
 * js/plan-engine.js — pure scheduling engine → window.PlanEngine (ALGO_VERSION 1)
 * Specification: docs/design/DESIGN-engine.md (section numbers below refer to it).
 *
 * Rules: classic script, one IIFE, ES2019, no regex lookbehind. Pure functions only: no DOM, network,
 * storage, Date.now() or zero-argument new Date(); `today` is always a parameter. Inputs are never
 * mutated; the same input gives a deep-equal output. Name-keyed maps are Map / Object.create(null).
 * Bad domain data never throws: it produces `warnings`. Reads only window.Utils (STATIONS, LEAVE_TYPES,
 * isValidYmd, addDays, eachDate, monthRange, monthKey) — load after js/utils.js.
 *
 * Shapes (§0.2): Staff {name, group:'regular'|'backup', active?}; Leave {date, staff, type, status?,
 * start?, end?, detail?, recordedBy?, recordedAt?} (R2 E-1: a partial leave without valid start/end takes its times from
 * detail "HH:MM-HH:MM", the server's format); Roster {[stationId]: string[]}; Line {line, tech, assistant};
 * LunchSlot {tech, base, assistant}; Duty {date, working, lines, lunch:{er,ipd}|null, mission, missionNext};
 * Tail {month, mission:{order,next}, lines:{techs,ringSize,next}, lunch:{er:{techs,next}, ipd:{techs,next}}}.
 *
 * EXPORTS (window.PlanEngine)
 * Constants
 *   ALGO_VERSION                1
 *   PARTIAL_LEAVE_TYPES         ['ลาหาหมอตอนเช้า','ลาหาหมอตอนบ่าย'] — approved = still works a station
 *   PARTIAL_DEFAULT_TIMES       {type: {start,end}} used when a partial leave has no valid times (start/end, else detail)
 *   DEFAULT_LUNCH_WINDOW        {start:'12:00', end:'13:00'}
 *   LUNCH_STATIONS              ['er','ipd']
 *   DEFAULT_PRIORITY            ['er','portable','ipd','or','us','cancer','supervisor'] (proposal fill order)
 *   DEFAULT_RESTRICTED          ['supervisor'] — never filled by floaters unless their skills list it
 *   DEFAULT_UNITS               [{label, thisUnit, station, synonyms[]}] backup-message unit table (§7.6)
 *   HONORIFICS                  name prefixes stripped by matchStaffName (§7.5)
 *   MAX_MESSAGE_CHARS           20000
 * Calendar (§1)
 *   holidaySet(h) → Set<date>                   h: string[] | {date}[] | Set | Map | {[date]:name}
 *   isWorkingDay(date, h) → boolean             Mon–Fri, valid, not a holiday
 *   workingDaysOfMonth(month, h) → date[]       ascending working days of 'YYYY-MM'
 *   workingDayIndex(date, h) → int              0-based index within its month, -1 if not working
 *   workingDaysBetween(from, to, h) → date[]    inclusive ([] when invalid or from > to)
 * Leaves (§0.3)
 *   leaveStatus(leave) → 'approved'|'pending'|'rejected'   missing/unknown status = approved
 *   leaveKind(type) → 'partial'|'full'|''                  unknown non-empty type = full (fail-safe)
 *   availabilityOn(leaves, date) → {absent:Map(name→type), partial:Map(name→{type,start,end}),
 *                                   pending:Map(name→{type,kind})}   first row per (date, staff) wins
 *   timeOverlaps(start, end, wStart, wEnd) → boolean       [start,end) ∩ [wStart,wEnd) ≠ ∅ ('HH:MM');
 *                                                          also timeOverlaps({start,end}, {start,end})
 * Portable lines (§2)
 *   buildSeats(techs, assistants, L) → [{tech, assistant}]          ring of seats (padded to L)
 *   portableLines(seats, L, k, offset=0) → {lines:Line[], spare:[{tech,assistant}]}
 *   resolveLines(lines, names) → {workers: string[] ('' = unfilled), extra: string[]}
 * Lunch (§3)
 *   lunchPick(techs, k, offset, isUnavailable(name), counts Map|object) → {tech, base}
 * Mission (§4)
 *   missionPick(order, cursor, isUnavailable(name)) → {names, next, skipped}
 *   resolveCursor(oldOrder, cursor, newOrder) → name ('' when newOrder is empty)
 *   suggestMissionSubstitute({order, names, absent, isUnavailable?, prevNames?, nextNames?}) → name|''
 * Month (§5)
 *   generateMonthDuties(input) → {month, from, days:{[date]:Duty|null}, config, tail, warnings}
 *   suggestOffsets(previousTail, input) → {lines, lunch:{er, ipd}}   non-zero only for an unchanged ring
 *   dutyConflicts(duties, leaves, {lunchWindow}?) → [{date, kind:'line'|'lunch'|'mission', line?, station?, name, reason}]
 * Proposal (§6)
 *   proposeDay(input) → {date, assignments, lines, notes, unfilled, spare, added, warnings}
 *                                           R2-SPEC §0.27: input.avoidPairs [[a, b]] — the matching never puts a pool
 *                                           candidate into a station that holds its partner (iterative edge removal);
 *                                           notes AVOID_PAIR {names, station} (pair placed by steps 1–4, not moved) and
 *                                           AVOID_PAIR_SKIPPED {name, partner, station}
 *   lexMatch(slots, cands, edges) → int[]   candidate index per slot (-1 = unfilled); edges = function
 *                                           (slot, cand, si, ci) → bool, or per-slot lists (array aligned
 *                                           with slots / Map / object keyed by slot) of candidate values
 *   noteText(note) → string                 Thai rendering of a proposal note (§6.4)
 * Parser (§7)
 *   normalizeMessageText(text) → string[]   §7.1 steps 1–9 (opts.emojiFallback forces the fallback regex)
 *   parseThaiDate(text, ref?) → {date|null, warnings:[code], match:{index,length}|null}
 *   monthFromToken(token) → 1..12, 0 = rejected          (extra export: §7.3 names it in a vector)
 *   lightKey(s) → string                    NFC, invisibles removed, เเ→แ, spaces collapsed, Latin lower case
 *   foldName(s) → string                    homophone fold used for tolerant matching (§7.5)
 *   editDistance(a, b, max?) → int          Damerau-Levenshtein (adjacent transposition = 1)
 *   buildNameIndex(staff, aliases?) → index (active staff only; alias problems in index.warnings)
 *   matchStaffName(raw, index, allowFuzzy) → {raw, name|null, how?, ambiguous?: string[]}
 *   parseUnitText(text, units?) → {unit, isThisUnit, station, qualifier, warnings}   (extra export, §7.6)
 *   parseBackupMessages(text, staff, aliases?, options?) → Block[]
 *   parseBackupMessage(text, staff, aliases?, options?) → Block + {blockCount, blockIndex, dateMatches}
 * Vacation (§8)
 *   vacationQueue(leavesOnDate, {type?, active?, scope?, groupOf?}) → [{staff, status, rank, recordedAt}]
 *   vacationDecision({leavesOnDate, staff, limit, enteredBySupervisor?, active?, scope?, groupOf?})
 *                                           → {status, count, rank, reason}
 *   vacationBalance({staff, balance, leaves, holidays, today, since?}) → {known, used, scheduled, pending,
 *                                           ignoredNonWorking, remaining, remainingIfPendingApproved, overdrawn, …}
 * Statistics (§9)
 *   personStats({name, from, to, today, days, duties, leaves, holidays}) → stats object
 *   teamStats({names?, staff?, from, to, today, days, duties, leaves, holidays}) → stats[]
 *
 * Note fields (§6.4): `reason` carries the leave type (DROP_LEAVE, PARTIAL, PENDING, HELPER_ON_LEAVE), the
 * unit (HELPER_AWAY, AWAY_ASSIGNED; 'หน่วยอื่น' when unknown) or the replaced person's reason (SUB, VACANT).
 * ===================================================================== */
(function (global) {
  'use strict';

  const U = global.Utils;

  /* ------------------------------------------------------------------ constants */
  const ALGO_VERSION = 1;
  const PARTIAL_LEAVE_TYPES = Object.freeze(['ลาหาหมอตอนเช้า', 'ลาหาหมอตอนบ่าย']);
  const PARTIAL_DEFAULT_TIMES = Object.freeze({
    'ลาหาหมอตอนเช้า': Object.freeze({ start: '08:00', end: '12:00' }),
    'ลาหาหมอตอนบ่าย': Object.freeze({ start: '13:00', end: '16:00' })
  });
  const DEFAULT_LUNCH_WINDOW = Object.freeze({ start: '12:00', end: '13:00' });
  const LUNCH_STATIONS = Object.freeze(['er', 'ipd']);
  const DEFAULT_PRIORITY = Object.freeze(['er', 'portable', 'ipd', 'or', 'us', 'cancer', 'supervisor']);
  const DEFAULT_RESTRICTED = Object.freeze(['supervisor']);
  const DEFAULT_UNITS = Object.freeze([
    { label: 'IPD', thisUnit: true, station: null, synonyms: ['IPD', 'ผู้ป่วยใน', 'ไอพีดี', 'วอร์ด', 'WARD'] },
    { label: 'ER', thisUnit: true, station: 'er', synonyms: ['ER', 'ห้องฉุกเฉิน', 'ฉุกเฉิน'] },
    { label: 'Portable', thisUnit: true, station: 'portable', synonyms: ['Portable', 'PORT', 'พอร์ต', 'พอร์ตเทเบิล'] },
    { label: 'OPD', thisUnit: false, station: null, synonyms: ['OPD', 'ผู้ป่วยนอก'] },
    { label: 'Ex-OPD', thisUnit: false, station: null, synonyms: ['Ex-OPD', 'ExOPD'] },
    { label: 'MAM', thisUnit: false, station: null, synonyms: ['MAM', 'MAMMO', 'MAMMOGRAM'] },
    { label: 'CT', thisUnit: false, station: null, synonyms: ['CT', 'CT SCAN'] },
    { label: 'MRI', thisUnit: false, station: null, synonyms: ['MRI'] },
    { label: 'IR', thisUnit: false, station: null, synonyms: ['IR'] }
  ].map(u => Object.freeze(Object.assign(u, { synonyms: Object.freeze(u.synonyms) }))));
  const HONORIFICS = Object.freeze(['นางสาว', 'อาจารย์', 'น.ส.', 'นส.', 'น.ส', 'นาย', 'นาง', 'คุณ', 'พี่', 'น้อง', 'หมอ', 'ดร.', 'อ.']);
  const MAX_MESSAGE_CHARS = 20000;

  const VACATION = 'พักร้อน';
  const STATIONS = (U && U.STATIONS) || [];
  const STATION_IDS = STATIONS.map(s => s.id);
  const STATION_COUNT_MIN = 1;
  const STATION_COUNT_MAX = 10;

  /* ------------------------------------------------------------------ small helpers */
  const hasOwn = Object.prototype.hasOwnProperty;
  function isObj(v) { return v !== null && typeof v === 'object'; }
  function own(o, k) { return isObj(o) && hasOwn.call(o, k); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function cleanName(v) { return typeof v === 'string' ? v.trim() : ''; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function mod(a, n) { return n > 0 ? ((a % n) + n) % n : 0; }
  function int0(v) { return Number.isInteger(v) ? v : 0; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isValidYmd(s) { return !!(U && U.isValidYmd(s)); }
  /** Non-empty trimmed strings, first occurrence kept. */
  function uniqNames(list) {
    const out = [], seen = new Set();
    arr(list).forEach(v => { const n = cleanName(v); if (n && !seen.has(n)) { seen.add(n); out.push(n); } });
    return out;
  }
  function mapGet(m, k) {
    if (m instanceof Map) return m.get(k);
    return own(m, k) ? m[k] : undefined;
  }
  function stationName(id) {
    for (let i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return STATIONS[i].name;
    return str(id);
  }
  function defaultCount(id) {
    for (let i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return STATIONS[i].count;
    return 1;
  }
  function needOf(counts, id) {
    const v = isObj(counts) ? counts[id] : undefined;
    return Number.isInteger(v) && v >= STATION_COUNT_MIN && v <= STATION_COUNT_MAX ? v : defaultCount(id);
  }
  function sameArray(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function utcDay(ymd) {
    const y = +ymd.slice(0, 4), m = +ymd.slice(5, 7), d = +ymd.slice(8, 10);
    const dt = new Date(Date.UTC(2000, 0, 1));
    dt.setUTCFullYear(y, m - 1, d);
    return dt.getTime() / 86400000;
  }
  function weekday(ymd) {
    const dt = new Date(Date.UTC(2000, 0, 1));
    dt.setUTCFullYear(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    return dt.getUTCDay();
  }
  /** Normalised staff list: [{name, group, active}] (strings are accepted as active regular staff). */
  function normStaff(staff) {
    const out = [], seen = new Set();
    arr(staff).forEach(s => {
      const name = typeof s === 'string' ? s.trim() : (isObj(s) ? cleanName(s.name) : '');
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({
        name,
        group: isObj(s) && s.group === 'backup' ? 'backup' : 'regular',
        active: !(isObj(s) && s.active === false)
      });
    });
    return out;
  }

  /* ================================================================== §1 calendar */
  function holidaySet(h) {
    const out = new Set();
    const add = x => {
      const d = typeof x === 'string' ? x.trim() : (isObj(x) ? str(x.date).trim() : '');
      if (isValidYmd(d)) out.add(d);
    };
    if (h instanceof Set) h.forEach(add);
    else if (h instanceof Map) h.forEach((v, k) => add(k));
    else if (Array.isArray(h)) h.forEach(add);
    else if (isObj(h)) Object.keys(h).forEach(add);
    return out;
  }
  function isWorkingDayIn(date, set) {
    if (!isValidYmd(date)) return false;
    const w = weekday(date);
    return w >= 1 && w <= 5 && !set.has(date);
  }
  function isWorkingDay(date, h) { return isWorkingDayIn(date, holidaySet(h)); }
  function workingDaysOfMonth(month, h) {
    const key = typeof month === 'string' && /^\d{4}-\d{2}/.test(month) ? U.monthKey(month) : '';
    if (!key) return [];
    const r = U.monthRange(key);
    if (!r) return [];
    const set = holidaySet(h);
    return U.eachDate(r.from, r.to).filter(d => isWorkingDayIn(d, set));
  }
  function workingDayIndex(date, h) {
    const set = holidaySet(h);
    if (!isWorkingDayIn(date, set)) return -1;
    return workingDaysOfMonth(date.slice(0, 7), set).indexOf(date);
  }
  function workingDaysBetween(from, to, h) {
    if (!isValidYmd(from) || !isValidYmd(to) || from > to) return [];
    const set = holidaySet(h);
    return U.eachDate(from, to).filter(d => isWorkingDayIn(d, set));
  }

  /* ================================================================== §0.3 leaves */
  function leaveStatus(l) {
    const s = isObj(l) ? str(l.status).trim().toLowerCase() : '';
    return s === 'pending' || s === 'rejected' ? s : 'approved';
  }
  function leaveKind(type) {
    const t = str(type).trim();
    if (!t) return '';
    return PARTIAL_LEAVE_TYPES.indexOf(t) >= 0 ? 'partial' : 'full';
  }
  function normTime(t) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(str(t).trim());
    if (!m) return '';
    const h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return '';
    return pad2(h) + ':' + pad2(mi);
  }
  function timeOverlaps(a, b, c, d) {
    let s, e, ws, we;
    if (isObj(a)) { s = a.start; e = a.end; ws = isObj(b) ? b.start : ''; we = isObj(b) ? b.end : ''; }
    else { s = a; e = b; ws = c; we = d; }
    s = normTime(s); e = normTime(e); ws = normTime(ws); we = normTime(we);
    if (!s || !e || !ws || !we) return false;
    return s < we && e > ws;
  }
  /**
   * The time range of a partial-day leave (R2-SPEC §5.1, E-1): explicit `start`/`end` win; when either is missing or
   * invalid, the row's `detail` "HH:MM-HH:MM" (how the server stores a doctor visit; spaces are ignored, like
   * Utils.parseTimeRange — R2 FIX I-4) is used; a malformed detail (or a
   * range that is not start < end) falls back to PARTIAL_DEFAULT_TIMES of the type.
   */
  function detailTimes(l) {
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(isObj(l) ? str(l.detail).replace(/\s+/g, '') : '');
    if (!m) return null;
    const s = normTime(m[1]), e = normTime(m[2]);
    return s && e && s < e ? { start: s, end: e } : null;
  }
  function partialTimes(type, l) {
    const d = PARTIAL_DEFAULT_TIMES[type] || null;
    const s = normTime(l && l.start), e = normTime(l && l.end);
    const det = s && e ? null : detailTimes(l);
    return {
      start: s || (det ? det.start : '') || (d ? d.start : ''),
      end: e || (det ? det.end : '') || (d ? d.end : '')
    };
  }
  /** Map date → leave rows (original order), built once per call for multi-date algorithms. */
  function indexLeavesByDate(leaves) {
    const byDate = new Map();
    arr(leaves).forEach(l => {
      if (!isObj(l)) return;
      const d = str(l.date).trim();
      if (!d) return;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(l);
    });
    return byDate;
  }
  function availabilityFromRows(rows) {
    const absent = new Map(), partial = new Map(), pending = new Map(), seen = new Set();
    arr(rows).forEach(l => {
      const name = cleanName(l.staff);
      if (!name || seen.has(name)) return;
      const type = str(l.type).trim();
      const kind = leaveKind(type);
      if (!kind) return;
      seen.add(name);
      const st = leaveStatus(l);
      if (st === 'rejected') return;
      if (st === 'pending') { pending.set(name, { type, kind }); return; }
      if (kind === 'partial') { const t = partialTimes(type, l); partial.set(name, { type, start: t.start, end: t.end }); }
      else absent.set(name, type);
    });
    return { absent, partial, pending };
  }
  function availabilityOn(leaves, date) {
    const d = str(date).trim();
    return availabilityFromRows(arr(leaves).filter(l => isObj(l) && str(l.date).trim() === d));
  }
  function normWindow(w) {
    const s = normTime(isObj(w) ? w.start : ''), e = normTime(isObj(w) ? w.end : '');
    return s && e && s < e ? { start: s, end: e } : { start: DEFAULT_LUNCH_WINDOW.start, end: DEFAULT_LUNCH_WINDOW.end };
  }
  function partialBlocksLunch(av, name, win) {
    const p = av.partial.get(name);
    return !!p && timeOverlaps(p.start, p.end, win.start, win.end);
  }

  /* ================================================================== §2 portable lines */
  function buildSeats(techs, assistants, L) {
    const lines = Number.isInteger(L) && L > 0 ? L : 0;
    const list = uniqNames(techs);
    const isArr = Array.isArray(assistants);
    const seats = list.map((t, i) => ({
      tech: t,
      assistant: cleanName(isArr ? assistants[i] : mapGet(assistants, t))
    }));
    if (isArr) {
      for (let i = list.length; i < assistants.length && seats.length < lines; i++) {
        const a = cleanName(assistants[i]);
        if (a) seats.push({ tech: '', assistant: a });
      }
    }
    while (seats.length < lines) seats.push({ tech: '', assistant: '' });
    return seats;
  }
  function portableLines(seats, L, k, offset) {
    const lineCount = Number.isInteger(L) && L > 0 ? L : 0;
    const list = arr(seats).map(s => ({ tech: cleanName(isObj(s) ? s.tech : ''), assistant: cleanName(isObj(s) ? s.assistant : '') }));
    while (list.length < lineCount) list.push({ tech: '', assistant: '' });
    const R = list.length;
    const lines = [], spare = [];
    for (let p = 0; p < lineCount; p++) lines.push({ line: p + 1, tech: '', assistant: '' });
    const kk = int0(k) + int0(offset);
    for (let i = 0; i < R; i++) {
      const p = mod(i + kk, R);
      if (p < lineCount) lines[p] = { line: p + 1, tech: list[i].tech, assistant: list[i].assistant };
      else if (list[i].tech || list[i].assistant) spare.push({ tech: list[i].tech, assistant: list[i].assistant });
    }
    return { lines, spare };
  }
  function sortedLines(lines) {
    return arr(lines).filter(l => isObj(l) && Number.isInteger(l.line) && l.line >= 1)
      .map(l => ({ line: l.line, tech: cleanName(l.tech), assistant: cleanName(l.assistant) }))
      .sort((a, b) => a.line - b.line);
  }
  function resolveLines(lines, names) {
    const plan = sortedLines(lines);
    const list = uniqNames(names);
    const workers = plan.map(() => '');
    const used = new Set();
    plan.forEach((l, i) => {
      if (l.tech && list.indexOf(l.tech) >= 0 && !used.has(l.tech)) { workers[i] = l.tech; used.add(l.tech); }
    });
    const extra = [];
    list.forEach(n => {
      if (used.has(n)) return;
      const i = workers.indexOf('');
      if (i >= 0) { workers[i] = n; used.add(n); } else extra.push(n);
    });
    return { workers, extra };
  }

  /* ================================================================== §3 lunch */
  function countOf(counts, name) {
    const v = mapGet(counts, name);
    return typeof v === 'number' && isFinite(v) ? v : 0;
  }
  function lunchPick(techs, k, offset, isUnavailable, counts) {
    const list = arr(techs);
    const n = list.length;
    if (!n) return { tech: '', base: '' };
    const un = typeof isUnavailable === 'function' ? isUnavailable : () => false;
    const b = mod(int0(k) + int0(offset), n);
    const base = list[b];
    if (!un(base)) return { tech: base, base };
    let best = '', bestCount = Infinity;
    for (let j = 1; j < n; j++) {
      const c = list[(b + j) % n];
      if (!c || un(c)) continue;
      const cnt = countOf(counts, c);
      if (cnt < bestCount) { best = c; bestCount = cnt; }
    }
    return { tech: best, base };
  }

  /* ================================================================== §4 mission */
  function missionPick(order, cursor, isUnavailable) {
    const list = arr(order);
    const m = list.length;
    if (!m) return { names: [], next: '', skipped: [] };
    const un = typeof isUnavailable === 'function' ? isUnavailable : () => false;
    let start = list.indexOf(cursor);
    if (start < 0) start = 0;
    const names = [], skipped = [];
    let passed = [], last = -1;
    for (let s = 0; s < m && names.length < 2; s++) {
      const i = (start + s) % m;
      if (un(list[i])) passed.push(list[i]);
      else {
        names.push(list[i]); last = i;
        passed.forEach(p => skipped.push(p)); passed = [];
      }
    }
    const next = last < 0 ? list[start] : list[(last + 1) % m];
    return { names, next, skipped };
  }
  function resolveCursor(oldOrder, cursor, newOrder) {
    const nw = arr(newOrder);
    if (!nw.length) return '';
    if (nw.indexOf(cursor) >= 0) return cursor;
    const old = arr(oldOrder);
    const idx = old.indexOf(cursor);
    if (idx >= 0) {
      for (let j = 1; j < old.length; j++) {
        const c = old[(idx + j) % old.length];
        if (nw.indexOf(c) >= 0) return c;
      }
    }
    return nw[0];
  }
  function suggestMissionSubstitute(o) {
    o = isObj(o) ? o : {};
    const order = arr(o.order);
    const m = order.length;
    if (!m) return '';
    const onDay = new Set(arr(o.names));
    const un = typeof o.isUnavailable === 'function' ? o.isUnavailable : () => false;
    const adjacent = new Set(arr(o.prevNames).concat(arr(o.nextNames)));
    const idx = order.indexOf(o.absent);
    const start = idx >= 0 ? idx + 1 : 0;
    let first = '';
    for (let s = 0; s < m; s++) {
      const c = order[(start + s) % m];
      if (!c || c === o.absent || onDay.has(c) || un(c)) continue;
      if (!adjacent.has(c)) return c;
      if (!first) first = c;
    }
    return first;
  }
  /** Mission rotation order from the eligible list (§4.1 rule 1). */
  function missionOrder(eligible, staff, warnings) {
    const out = [], seen = new Set();
    const active = Array.isArray(staff) ? new Set(normStaff(staff).filter(s => s.active).map(s => s.name)) : null;
    arr(eligible).forEach(e => {
      const name = typeof e === 'string' ? e.trim() : (isObj(e) ? cleanName(e.name) : '');
      if (!name || seen.has(name)) return;
      if (isObj(e) && e.enabled === false) return;
      seen.add(name);
      if (active && !active.has(name)) { warnings.push({ code: 'ELIGIBLE_INACTIVE', name }); return; }
      out.push(name);
    });
    return out;
  }

  /* ================================================================== §5 month generation */
  function normOffsets(o) {
    o = isObj(o) ? o : {};
    const lu = isObj(o.lunch) ? o.lunch : {}, la = isObj(o.lunchAssistant) ? o.lunchAssistant : {};
    return {
      lines: int0(o.lines),
      lunch: { er: int0(lu.er), ipd: int0(lu.ipd) },
      lunchAssistant: { er: int0(la.er), ipd: int0(la.ipd) }
    };
  }
  function lineCountOf(counts) { return needOf(counts, 'portable'); }

  function generateMonthDuties(input) {
    input = isObj(input) ? input : {};
    const warnings = [];
    const month = typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month) ? U.monthKey(input.month) : '';
    if (!month) {
      return { month: str(input.month), from: '', days: {}, config: null, tail: null, warnings: [{ code: 'BAD_MONTH' }] };
    }
    const opts = isObj(input.options) ? input.options : {};
    const range = U.monthRange(month);
    const hs = holidaySet(input.holidays);
    const allDates = U.eachDate(range.from, range.to);
    const wd = allDates.filter(d => isWorkingDayIn(d, hs));
    const wdIndex = new Map();
    wd.forEach((d, i) => wdIndex.set(d, i));
    const L = lineCountOf(input.counts);
    const roster = isObj(input.roster) ? input.roster : {};
    const assistants = isObj(input.assistants) ? input.assistants : {};
    const seats = buildSeats(roster.portable, assistants.portable, L);
    const R = seats.length;
    const lunchCfg = isObj(assistants.lunch) ? assistants.lunch : {};
    const lunchTechs = {}, lunchAsst = {};
    LUNCH_STATIONS.forEach(s => { lunchTechs[s] = uniqNames(roster[s]); lunchAsst[s] = uniqNames(lunchCfg[s]); });
    const offsets = normOffsets(opts.offsets);
    const win = normWindow(opts.lunchWindow);
    const order = missionOrder(input.eligible, input.staff, warnings);
    const tail = isObj(input.previousTail) ? input.previousTail : null;
    const tailMission = tail && isObj(tail.mission) ? tail.mission : null;
    const oldOrder = Array.isArray(opts.existingOrder) ? opts.existingOrder
      : (tailMission && Array.isArray(tailMission.order) ? tailMission.order : order);
    let raw = cleanName(opts.missionStart) || (tailMission ? cleanName(tailMission.next) : '') || order[0] || '';
    const start = raw;
    let from = isValidYmd(opts.from) ? opts.from : range.from;
    if (from < range.from) from = range.from;
    const existing = isObj(opts.existing) ? opts.existing : {};
    const byDate = indexLeavesByDate(input.leaves);
    const lunchCounts = { er: new Map(), ipd: new Map() };
    const bump = (s, name) => { if (name) lunchCounts[s].set(name, (lunchCounts[s].get(name) || 0) + 1); };
    let cursor = null;
    const days = {};

    allDates.forEach(d => {
      if (d < from) {
        const rec = own(existing, d) && isObj(existing[d]) ? existing[d] : null;
        days[d] = rec;
        if (!rec) { warnings.push({ code: 'MISSING_STORED_DAY', date: d }); return; }
        if (isObj(rec.lunch)) LUNCH_STATIONS.forEach(s => { if (isObj(rec.lunch[s])) bump(s, cleanName(rec.lunch[s].tech)); });
        const nx = cleanName(rec.missionNext);
        if (nx) raw = nx;
        else {
          const ms = arr(rec.mission).map(cleanName).filter(Boolean);
          if (ms.length) {
            const lastName = ms[ms.length - 1];
            const i = arr(oldOrder).indexOf(lastName);
            if (i >= 0) raw = oldOrder[(i + 1) % oldOrder.length];
          }
        }
        return;
      }
      if (cursor === null) cursor = resolveCursor(oldOrder, raw, order);
      const av = availabilityFromRows(byDate.get(d));
      const k = wdIndex.has(d) ? wdIndex.get(d) : -1;
      const duty = { date: d, working: k >= 0, lines: null, lunch: null, mission: [], missionNext: '' };
      if (k >= 0) {
        duty.lines = portableLines(seats, L, k, offsets.lines).lines;
        duty.lunch = {};
        LUNCH_STATIONS.forEach(s => {
          const p = lunchPick(lunchTechs[s], k, offsets.lunch[s], n => av.absent.has(n) || partialBlocksLunch(av, n, win), lunchCounts[s]);
          if (p.tech) bump(s, p.tech);
          else if (lunchTechs[s].length) warnings.push({ code: 'LUNCH_VACANT', date: d, station: s });
          const m = lunchAsst[s].length;
          duty.lunch[s] = { tech: p.tech, base: p.base, assistant: m ? lunchAsst[s][mod(k + offsets.lunchAssistant[s], m)] : '' };
        });
      }
      const mp = missionPick(order, cursor, n => av.absent.has(n));
      cursor = mp.next;
      duty.mission = mp.names;
      duty.missionNext = mp.next;
      if (order.length && mp.names.length < 2) warnings.push({ code: 'MISSION_SHORT', date: d, have: mp.names.length });
      days[d] = duty;
    });
    if (cursor === null) cursor = resolveCursor(oldOrder, raw, order);

    const lunchTail = {};
    LUNCH_STATIONS.forEach(s => {
      const n = lunchTechs[s].length;
      lunchTail[s] = { techs: lunchTechs[s].slice(), next: n ? mod(offsets.lunch[s] + wd.length, n) : 0 };
    });
    const tailOut = {
      month,
      mission: { order: order.slice(), next: cursor },
      lines: { techs: seats.map(s => s.tech), ringSize: R, next: mod(offsets.lines + wd.length, R) },
      lunch: lunchTail
    };
    const config = {
      month,
      algo: ALGO_VERSION,
      holidays: Array.from(hs).filter(d => d >= range.from && d <= range.to).sort(),
      lineCount: L,
      seats: seats.map(s => ({ tech: s.tech, assistant: s.assistant })),
      offsets,
      lunch: {
        er: { techs: lunchTechs.er.slice(), assistants: lunchAsst.er.slice() },
        ipd: { techs: lunchTechs.ipd.slice(), assistants: lunchAsst.ipd.slice() }
      },
      lunchWindow: win,
      mission: { order: order.slice(), start },
      generatedFrom: from
    };
    return { month, from, days, config, tail: tailOut, warnings };
  }

  function suggestOffsets(previousTail, input) {
    const out = { lines: 0, lunch: { er: 0, ipd: 0 } };
    if (!isObj(previousTail)) return out;
    input = isObj(input) ? input : {};
    const roster = isObj(input.roster) ? input.roster : {};
    const assistants = isObj(input.assistants) ? input.assistants : {};
    const seats = buildSeats(roster.portable, assistants.portable, lineCountOf(input.counts));
    const tl = isObj(previousTail.lines) ? previousTail.lines : null;
    if (tl && tl.ringSize === seats.length && sameArray(tl.techs, seats.map(s => s.tech)) && seats.some(s => s.tech)) {
      out.lines = mod(int0(tl.next), seats.length);
    }
    const tlu = isObj(previousTail.lunch) ? previousTail.lunch : {};
    LUNCH_STATIONS.forEach(s => {
      const techs = uniqNames(roster[s]);
      const t = isObj(tlu[s]) ? tlu[s] : null;
      if (t && techs.length && sameArray(t.techs, techs)) out.lunch[s] = mod(int0(t.next), techs.length);
    });
    return out;
  }

  function dutyList(duties) {
    let list = [];
    if (duties instanceof Map) duties.forEach(v => list.push(v));
    else if (Array.isArray(duties)) list = duties.slice();
    else if (isObj(duties)) list = Object.keys(duties).map(k => duties[k]);
    return list.filter(d => isObj(d) && isValidYmd(d.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  function dutyConflicts(duties, leaves, opts) {
    const win = normWindow(isObj(opts) ? opts.lunchWindow : null);
    const byDate = indexLeavesByDate(leaves);
    const out = [];
    dutyList(duties).forEach(duty => {
      const d = duty.date;
      const av = availabilityFromRows(byDate.get(d));
      sortedLines(duty.lines).forEach(l => {
        if (l.tech && av.absent.has(l.tech)) out.push({ date: d, kind: 'line', line: l.line, name: l.tech, reason: av.absent.get(l.tech) });
      });
      if (isObj(duty.lunch)) {
        LUNCH_STATIONS.forEach(s => {
          const slot = duty.lunch[s];
          const n = isObj(slot) ? cleanName(slot.tech) : '';
          if (!n) return;
          if (av.absent.has(n)) out.push({ date: d, kind: 'lunch', station: s, name: n, reason: av.absent.get(n) });
          else if (partialBlocksLunch(av, n, win)) out.push({ date: d, kind: 'lunch', station: s, name: n, reason: av.partial.get(n).type });
        });
      }
      arr(duty.mission).forEach(raw => {
        const n = cleanName(raw);
        if (n && av.absent.has(n)) out.push({ date: d, kind: 'mission', name: n, reason: av.absent.get(n) });
      });
    });
    return out;
  }

  /* ================================================================== §6.3 step 7 matching */
  /**
   * Deterministic lexicographic maximum matching. adj[si][ci] → boolean. Returns cand index per slot.
   */
  function lexMatchCore(nS, nC, adj) {
    // F: slots that can be filled, greedily in slot order, keeping a maximum matching (augmenting paths).
    const mS = new Array(nS).fill(-1), mC = new Array(nC).fill(-1);
    function augS(s, seen) {
      for (let c = 0; c < nC; c++) {
        if (!adj[s][c] || seen[c]) continue;
        seen[c] = true;
        if (mC[c] < 0 || augS(mC[c], seen)) { mS[s] = c; mC[c] = s; return true; }
      }
      return false;
    }
    const F = [];
    for (let s = 0; s < nS; s++) if (augS(s, new Array(nC).fill(false))) F.push(s);
    // U: candidates, greedily in pool order, matched against F only.
    const inF = new Array(nS).fill(false);
    F.forEach(s => { inF[s] = true; });
    const uS = new Array(nS).fill(-1), uC = new Array(nC).fill(-1);
    function augC(c, seen) {
      for (let s = 0; s < nS; s++) {
        if (!inF[s] || !adj[s][c] || seen[s]) continue;
        seen[s] = true;
        if (uS[s] < 0 || augC(uS[s], seen)) { uS[s] = c; uC[c] = s; return true; }
      }
      return false;
    }
    const Ulist = [];
    for (let c = 0; c < nC && Ulist.length < F.length; c++) if (augC(c, new Array(nS).fill(false))) Ulist.push(c);
    // Assignment: each slot of F (in order) takes the earliest candidate that still allows a perfect matching.
    const result = new Array(nS).fill(-1);
    const slotFree = new Array(nS).fill(false), candFree = new Array(nC).fill(false);
    F.forEach(s => { slotFree[s] = true; });
    Ulist.forEach(c => { candFree[c] = true; });
    function perfect() {
      const pS = new Array(nS).fill(-1), pC = new Array(nC).fill(-1);
      function aug(s, seen) {
        for (let c = 0; c < nC; c++) {
          if (!candFree[c] || !adj[s][c] || seen[c]) continue;
          seen[c] = true;
          if (pC[c] < 0 || aug(pC[c], seen)) { pS[s] = c; pC[c] = s; return true; }
        }
        return false;
      }
      for (let s = 0; s < nS; s++) if (slotFree[s] && !aug(s, new Array(nC).fill(false))) return false;
      return true;
    }
    F.forEach(s => {
      slotFree[s] = false;
      for (let i = 0; i < Ulist.length; i++) {
        const c = Ulist[i];
        if (!candFree[c] || !adj[s][c]) continue;
        candFree[c] = false;
        if (perfect()) { result[s] = c; return; }
        candFree[c] = true;
      }
    });
    return result;
  }
  function lexMatch(slots, cands, edges) {
    const S = arr(slots), C = arr(cands);
    let test;
    if (typeof edges === 'function') test = (si, ci) => !!edges(S[si], C[ci], si, ci);
    else {
      const listFor = si => {
        let l;
        if (Array.isArray(edges)) l = edges[si];
        else if (edges instanceof Map) l = edges.get(S[si]);
        else l = mapGet(edges, S[si]);
        return l;
      };
      test = (si, ci) => {
        const l = listFor(si);
        if (l instanceof Set) return l.has(C[ci]);
        return Array.isArray(l) && l.indexOf(C[ci]) >= 0;
      };
    }
    const adj = S.map((s, si) => C.map((c, ci) => test(si, ci)));
    return lexMatchCore(S.length, C.length, adj);
  }

  /* ================================================================== §6 daily proposal */
  function completePriority(p) {
    const out = [];
    arr(p).forEach(id => { if (STATION_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); });
    DEFAULT_PRIORITY.forEach(id => { if (STATION_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); });
    STATION_IDS.forEach(id => { if (out.indexOf(id) < 0) out.push(id); });
    return out;
  }
  function normPeople(list, key) {
    const out = [], seen = new Set();
    arr(list).forEach(h => {
      const name = typeof h === 'string' ? h.trim() : (isObj(h) ? cleanName(h.name) : '');
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({ name, extra: isObj(h) ? cleanName(h[key]) : '' });
    });
    return out;
  }

  function proposeDay(input) {
    input = isObj(input) ? input : {};
    const date = str(input.date);
    const opts = isObj(input.options) ? input.options : {};
    const warnings = [], notes = [];
    const res = { date, assignments: {}, lines: [], notes, unfilled: [], spare: [], added: [], warnings };
    if (input.holidays !== undefined && input.holidays !== null && !isWorkingDay(date, input.holidays)) {
      STATION_IDS.forEach(id => { res.assignments[id] = []; });
      notes.push({ code: 'NOT_WORKING_DAY' });
      return res;
    }
    const need = {};
    STATION_IDS.forEach(id => { need[id] = needOf(input.counts, id); });
    const staffList = normStaff(input.staff);
    const staffInfo = new Map();
    staffList.forEach(s => staffInfo.set(s.name, s));
    const isActive = n => { const s = staffInfo.get(n); return !!s && s.active; };
    const av = availabilityOn(input.leaves, date);
    const away = new Map();
    normPeople(input.away, 'unit').forEach(a => away.set(a.name, a.extra));
    const present = n => isActive(n) && !av.absent.has(n) && !away.has(n);

    // roster de-duplication (station order, then list order)
    const roster = isObj(input.roster) ? input.roster : {};
    const home = new Map(), rosterOf = {};
    STATION_IDS.forEach(S => {
      rosterOf[S] = [];
      arr(roster[S]).forEach(raw => {
        const n = cleanName(raw);
        if (!n) return;
        if (home.has(n)) { warnings.push({ code: 'ROSTER_DUPLICATE', name: n, station: S }); return; }
        home.set(n, S);
        rosterOf[S].push(n);
      });
    });
    const skills = isObj(input.skills) ? input.skills : null;
    const restricted = Array.isArray(opts.restricted) ? opts.restricted : DEFAULT_RESTRICTED;
    const canWork = (n, S) => {
      if (home.get(n) === S) return true;
      const sk = skills ? mapGet(skills, n) : undefined;
      if (Array.isArray(sk)) return sk.indexOf(S) >= 0;
      return restricted.indexOf(S) < 0;
    };
    const priority = completePriority(opts.priority);
    const prio = S => priority.indexOf(S);

    // line plan
    let plan = null;
    if (Array.isArray(input.lines)) {
      plan = sortedLines(input.lines);
      if (plan.length > need.portable) {
        warnings.push({ code: 'LINES_EXCEED_COUNT', lines: plan.length, need: need.portable });
        plan = plan.slice(0, need.portable);
      }
    }
    const planLen = plan ? plan.length : 0;
    const plannedIdx = new Map();
    if (plan) plan.forEach((l, i) => { if (l.tech && !plannedIdx.has(l.tech)) plannedIdx.set(l.tech, i); });
    const isLineSlot = (S, i) => S === 'portable' && i < planLen;

    const names = {}, src = {};
    const placed = new Map();
    const place = (S, i, n, source) => {
      while (names[S].length <= i) { names[S].push(''); src[S].push(''); }
      names[S][i] = n; src[S][i] = source; placed.set(n, { station: S, index: i });
    };
    const firstEmpty = S => names[S].indexOf('');

    // step 1: keep (fill mode)
    const mode = opts.mode === 'fill' ? 'fill' : 'fresh';
    const keptBy = {};
    const keptSet = new Set();
    STATION_IDS.forEach(S => { keptBy[S] = []; });
    if (mode === 'fill') {
      let ex = isObj(input.existing) ? input.existing : {};
      if (isObj(ex.assignments)) ex = ex.assignments;
      const seen = new Set();
      STATION_IDS.forEach(S => {
        arr(ex[S]).forEach(raw => {
          const n = cleanName(raw);
          if (!n || seen.has(n)) return;
          seen.add(n);
          if (av.absent.has(n)) { notes.push({ code: 'DROP_LEAVE', station: S, name: n, reason: av.absent.get(n) }); return; }
          keptBy[S].push(n);
          keptSet.add(n);
        });
      });
    }
    STATION_IDS.forEach(S => {
      const len = Math.max(need[S], keptBy[S].length);
      names[S] = new Array(len).fill('');
      src[S] = new Array(len).fill('');
      if (S === 'portable' && planLen) {
        const rest = [];
        keptBy[S].forEach(n => {
          const li = plannedIdx.get(n);
          if (li !== undefined && names[S][li] === '') place(S, li, n, 'kept'); else rest.push(n);
        });
        const reserved = i => i < planLen && !!plan[i].tech && present(plan[i].tech) && !keptSet.has(plan[i].tech);
        rest.forEach(n => {
          let i = -1;
          for (let j = 0; j < names[S].length; j++) if (names[S][j] === '' && !reserved(j)) { i = j; break; }
          if (i < 0) i = firstEmpty(S);
          if (i < 0) i = names[S].length;
          place(S, i, n, 'kept');
        });
      } else keptBy[S].forEach((n, i) => place(S, i, n, 'kept'));
    });

    // step 2: own lines
    if (plan) plan.forEach((l, i) => {
      if (l.tech && names.portable[i] === '' && present(l.tech) && !placed.has(l.tech)) place('portable', i, l.tech, 'line');
    });

    // step 3: home placement
    const extras = [];
    const extraSet = new Set();
    STATION_IDS.forEach(S => {
      rosterOf[S].forEach(n => {
        if (!present(n) || placed.has(n)) return;
        const i = firstEmpty(S);
        if (i >= 0) place(S, i, n, 'home');
        else { extras.push(n); extraSet.add(n); }
      });
    });

    // step 4: hinted helpers
    const helpers = normPeople(input.helpers, 'station');
    helpers.forEach(h => {
      const S = h.extra;
      if (!S || STATION_IDS.indexOf(S) < 0) return;
      const n = h.name;
      if (!present(n) || placed.has(n) || !canWork(n, S)) return;
      const i = firstEmpty(S);
      if (i >= 0) place(S, i, n, 'helper');
    });

    // step 5: candidate pool
    const pool = [], poolSrc = [], inPool = new Set();
    const addPool = (n, s) => { if (!inPool.has(n)) { inPool.add(n); pool.push(n); poolSrc.push(s); } };
    helpers.forEach(h => {
      const n = h.name;
      if (placed.has(n) || inPool.has(n)) return;
      if (!isActive(n)) { notes.push({ code: 'HELPER_UNKNOWN', name: n }); return; }
      if (av.absent.has(n)) { notes.push({ code: 'HELPER_ON_LEAVE', name: n, reason: av.absent.get(n) }); return; }
      if (away.has(n)) { notes.push({ code: 'HELPER_AWAY', name: n, reason: away.get(n) || 'หน่วยอื่น' }); return; }
      addPool(n, 'helper');
    });
    staffList.forEach(s => {
      if (s.active && s.group === 'regular' && present(s.name) && !placed.has(s.name) && !home.has(s.name)) addPool(s.name, 'free');
    });
    extras.forEach(n => { if (!placed.has(n)) addPool(n, 'extra'); });

    // step 6: vacancies
    const vac = [];
    STATION_IDS.forEach(S => {
      let level = names[S].filter(Boolean).length;
      names[S].forEach((n, i) => { if (n === '') vac.push({ station: S, index: i, level: level++ }); });
    });
    const byPriority = opts.slotOrder === 'priority';
    vac.sort((a, b) => {
      if (!byPriority && a.level !== b.level) return a.level - b.level;
      if (prio(a.station) !== prio(b.station)) return prio(a.station) - prio(b.station);
      return a.index - b.index;
    });

    // step 7: matching; R2-SPEC §0.27 avoid pairs — a station never receives a candidate whose partner is (or is matched)
    // there: while some station holds a pair with at least one matched member, the later-placed member (base placements of
    // steps 1–4 come first, matched ones in vacancy order) loses its edges to every vacancy of that station; match again
    const adj = vac.map(v => pool.map(n => canWork(n, v.station)));
    const avoid = avoidMap(input.avoidPairs);
    const base = {};
    STATION_IDS.forEach(S => { base[S] = names[S].filter(Boolean); });
    const skippedFor = new Map();
    let match = lexMatchCore(vac.length, pool.length, adj);
    for (let guard = 0; avoid.size && guard <= vac.length * pool.length; guard++) {
      const v = avoidViolation(match);
      if (!v) break;
      vac.forEach((x, si) => { if (x.station === v.station) adj[si][v.ci] = false; });
      if (!skippedFor.has(pool[v.ci])) skippedFor.set(pool[v.ci], { partner: v.partner, station: v.station });
      match = lexMatchCore(vac.length, pool.length, adj);
    }
    match.forEach((ci, si) => { if (ci >= 0) place(vac[si].station, vac[si].index, pool[ci], poolSrc[ci]); });
    /** The first station (station order, then placement order) holding a pair with a matched member → {station, ci, partner}. */
    function avoidViolation(m) {
      for (let k = 0; k < STATION_IDS.length; k++) {
        const S = STATION_IDS[k];
        const occ = base[S].map(n => ({ n, order: -1, ci: -1 }));
        m.forEach((ci, si) => { if (ci >= 0 && vac[si].station === S) occ.push({ n: pool[ci], order: si, ci }); });
        occ.sort((a, b) => a.order - b.order);
        for (let i = 0; i < occ.length; i++) {
          for (let j = i + 1; j < occ.length; j++) {
            if (occ[j].order < 0 || !avoids(avoid, occ[i].n, occ[j].n)) continue;
            return { station: S, ci: occ[j].ci, partner: occ[i].n };
          }
        }
      }
      return null;
    }

    // step 8: notes, unfilled, spare
    const spare = pool.filter(n => !placed.has(n));
    const reasonOf = (p, S) => {
      if (av.absent.has(p)) return av.absent.get(p);
      if (away.has(p)) return 'ไปช่วย ' + (away.get(p) || 'หน่วยอื่น');
      if (!isActive(p)) return 'ไม่อยู่ในระบบ';
      const pl = placed.get(p);
      if (pl && pl.station !== S) return 'อยู่ ' + stationName(pl.station);
      return '';
    };
    const sourceLabel = (s, S, i, n) => {
      if (s === 'helper') return 'ทีมแทนเวร';
      if (s === 'free') return 'ยังไม่มี Station ประจำ';
      if (s === 'extra') return 'สำรองจาก ' + stationName(home.get(n));
      if (s === 'home' && isLineSlot(S, i)) return 'สำรอง Portable';
      return 'คนประจำ';
    };
    const subNote = (S, line, n, s, i, rep) => {
      const note = { code: 'SUB', station: S };
      if (line) note.line = line;
      note.name = n; note.source = s; note.sourceLabel = sourceLabel(s, S, i, n);
      if (rep) { note.replaces = rep; note.reason = reasonOf(rep, S); }
      return note;
    };
    const vacantNote = (S, line, rep) => {
      const note = { code: 'VACANT', station: S };
      if (line) note.line = line;
      if (rep) { note.replaces = rep; note.reason = reasonOf(rep, S); }
      return note;
    };
    STATION_IDS.forEach(S => {
      const worksHere = n => { const pl = placed.get(n); return !!pl && pl.station === S; };
      const missing = rosterOf[S].filter(n => !worksHere(n) && !plannedIdx.has(n) && !extraSet.has(n));
      let mi = 0;
      names[S].forEach((n, i) => {
        if (isLineSlot(S, i)) {
          const p = plan[i].tech;
          if (n && n === p) return;
          if (!n) { notes.push(vacantNote(S, plan[i].line, p)); return; }
          if (src[S][i] === 'kept') return;
          notes.push(subNote(S, plan[i].line, n, src[S][i], i, p));
          return;
        }
        const s = src[S][i];
        if (n && (s === 'kept' || s === 'home' || s === 'line')) return;
        const rep = mi < missing.length ? missing[mi++] : '';
        notes.push(n ? subNote(S, 0, n, s, i, rep) : vacantNote(S, 0, rep));
      });
    });
    STATION_IDS.forEach(S => {
      names[S].forEach(n => {
        if (!n) return;
        if (av.partial.has(n)) {
          const p = av.partial.get(n);
          notes.push({ code: 'PARTIAL', station: S, name: n, reason: p.type, start: p.start, end: p.end });
        } else if (av.pending.has(n)) {
          notes.push({ code: 'PENDING', station: S, name: n, reason: av.pending.get(n).type });
        }
        if (away.has(n)) notes.push({ code: 'AWAY_ASSIGNED', station: S, name: n, reason: away.get(n) || 'หน่วยอื่น' });
      });
    });
    if (avoid.size) {
      STATION_IDS.forEach(S => {
        const b = base[S];
        for (let i = 0; i < b.length; i++) {
          for (let j = i + 1; j < b.length; j++) {
            if (avoids(avoid, b[i], b[j])) notes.push({ code: 'AVOID_PAIR', names: [b[i], b[j]], station: S });
          }
        }
      });
      skippedFor.forEach((x, n) => { if (!placed.has(n)) notes.push({ code: 'AVOID_PAIR_SKIPPED', name: n, partner: x.partner, station: x.station }); });
    }
    if (spare.length) notes.push({ code: 'SPARE', names: spare.slice() });

    STATION_IDS.forEach(S => {
      res.assignments[S] = names[S].slice();
      const empty = names[S].filter(n => n === '').length;
      if (empty) {
        const u = { station: S, missing: empty };
        if (S === 'portable' && plan) u.lines = plan.filter((l, i) => names[S][i] === '').map(l => l.line);
        res.unfilled.push(u);
      }
      names[S].forEach((n, i) => {
        if (n && src[S][i] !== 'kept') res.added.push({ station: S, slot: i, name: n, source: src[S][i] });
      });
    });
    res.lines = plan ? plan.map((l, i) => ({ line: l.line, tech: names.portable[i] || '', assistant: l.assistant, planned: l.tech })) : [];
    res.spare = spare;
    return res;
  }

  /** R2-SPEC §0.27: [[a, b], …] → Map name → Set of partners (blank, equal or malformed pairs are ignored). */
  function avoidMap(pairs) {
    const m = new Map();
    arr(pairs).forEach(p => {
      if (!Array.isArray(p)) return;
      const a = cleanName(p[0]), b = cleanName(p[1]);
      if (!a || !b || a === b) return;
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a).add(b);
      m.get(b).add(a);
    });
    return m;
  }
  function avoids(m, a, b) { return m.has(a) && m.get(a).has(b); }

  function noteText(note) {
    if (!isObj(note)) return '';
    const st = stationName(note.station);
    const line = note.line ? ' สาย ' + note.line : '';
    const rep = note.replaces ? note.replaces + (note.reason ? ' (' + note.reason + ')' : '') : '';
    switch (note.code) {
      case 'SUB':
        return st + line + ': ' + note.name + ' (' + note.sourceLabel + ') ' + (rep ? 'แทน ' + rep : 'ลงตำแหน่งว่าง');
      case 'VACANT':
        return st + line + ': ขาด 1 คน — ' + (rep ? rep + ' ยังไม่มีคนแทน' : 'ยังไม่มีคนประจำ/คนแทน');
      case 'PARTIAL':
        return note.name + ': ' + note.reason + ' ' + note.start + '–' + note.end + ' (ยังปฏิบัติงานที่ ' + st + ')';
      case 'PENDING':
        return note.name + ': มีคำขอ' + note.reason + 'รออนุมัติ (ยังจัดลง ' + st + ' ตามปกติ)';
      case 'DROP_LEAVE':
        return st + ': นำ ' + note.name + ' ออก เพราะลา (' + note.reason + ')';
      case 'HELPER_ON_LEAVE':
        return 'ทีมแทนเวร ' + note.name + ' มีสถานะลา (' + note.reason + ') — ไม่นำมาจัด';
      case 'HELPER_UNKNOWN':
        return 'ไม่พบ "' + note.name + '" ในรายชื่อบุคลากร — ไม่นำมาจัด';
      case 'HELPER_AWAY':
        return 'ทีมแทนเวร ' + note.name + ' ไปช่วย ' + (note.reason || 'หน่วยอื่น') + ' — ไม่นำมาจัด';
      case 'AWAY_ASSIGNED':
        return note.name + ': ข้อความทีมแทนเวรระบุว่าไปช่วย ' + (note.reason || 'หน่วยอื่น') + ' แต่ยังอยู่ที่ ' + st;
      case 'SPARE':
        return 'ยังไม่ได้จัดลง Station: ' + arr(note.names).join(', ');
      case 'AVOID_PAIR':
        return st + ': ' + arr(note.names).join(' และ ') + ' ห้ามอยู่คู่กัน แต่ถูกจัดไว้ด้วยกันแล้ว — ตรวจแก้เอง';
      case 'AVOID_PAIR_SKIPPED':
        return note.name + ' ไม่ได้ลง ' + st + ' เพราะห้ามอยู่คู่กับ ' + note.partner;
      case 'NOT_WORKING_DAY':
        return 'ไม่ใช่วันทำการ';
      default:
        return str(note.code);
    }
  }

  /* ================================================================== §7.1 text normalisation */
  const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD\uFE00-\uFE0F]/g;
  const SPACE_RE = /[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
  const EMOJI_FALLBACK_RE = /[\u2190-\u21FF\u2300-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299\u00A9\u00AE\u203C\u2049\u2122\u2139\u20E3]|[\uD83C-\uD83E][\uDC00-\uDFFF]/g;
  const EMOJI_RE = (function () {
    try {
      return new RegExp('[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}\\u20E3\\u{E0020}-\\u{E007F}]', 'gu');
    } catch (e) {
      return null;
    }
  })();
  function nfc(s) { try { return s.normalize('NFC'); } catch (e) { return s; } }
  function thaiFix(s) { return s.replace(/\u0E4D\u0E32/g, '\u0E33').replace(/\u0E40\u0E40/g, '\u0E41'); }
  function digitFix(s) {
    return s.replace(/[\u0E50-\u0E59]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x0E50 + 48))
      .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  }
  function normalizeInternal(text, opts) {
    if (typeof text !== 'string') return { lines: [], truncated: false };
    let s = text, truncated = false;
    if (s.length > MAX_MESSAGE_CHARS) {
      let cut = MAX_MESSAGE_CHARS;
      const c = s.charCodeAt(cut - 1);
      if (c >= 0xD800 && c <= 0xDBFF) cut--;           // never split a surrogate pair
      s = s.slice(0, cut);
      truncated = true;
    }
    s = s.replace(/\r\n?/g, '\n');
    s = nfc(s);
    s = s.replace(INVISIBLE_RE, '');
    s = thaiFix(s);
    const re = (opts && opts.emojiFallback) || !EMOJI_RE ? EMOJI_FALLBACK_RE : EMOJI_RE;
    re.lastIndex = 0;
    s = s.replace(re, ' ');
    s = digitFix(s);
    s = s.replace(SPACE_RE, ' ');
    const lines = s.split('\n').map(l => l.replace(/ {2,}/g, ' ').trim());
    return { lines, truncated };
  }
  function normalizeMessageText(text, opts) { return normalizeInternal(text, opts).lines; }

  /* ================================================================== §7.5 names */
  function lightKey(s) {
    if (typeof s !== 'string') return '';
    return thaiFix(nfc(s).replace(INVISIBLE_RE, '')).replace(SPACE_RE, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  const FOLD_MAP = (function () {
    const m = Object.create(null);
    const add = (from, to) => { for (let i = 0; i < from.length; i++) m[from[i]] = to; };
    add('ขฃฅฆ', 'ค'); add('ฉฌ', 'ช'); add('ซศษ', 'ส'); add('ญ', 'ย'); add('ฎ', 'ด'); add('ฏ', 'ต');
    add('ฐฑฒถธ', 'ท'); add('ณ', 'น'); add('ผภ', 'พ'); add('ฝ', 'ฟ'); add('ฬ', 'ล');
    add('\u0E35', '\u0E34'); add('\u0E39', '\u0E38'); add('\u0E37', '\u0E36'); add('\u0E43', '\u0E44'); add('\u0E45', '\u0E32');
    return m;
  })();
  function foldName(s) {
    const k = lightKey(s).replace(/[\s.\-_'()]/g, '').replace(/[\u0E47-\u0E4E\u0E3A\u0E46\u0E2F]/g, '');
    let out = '';
    for (let i = 0; i < k.length; i++) { const c = k[i]; out += FOLD_MAP[c] || c; }
    return out;
  }
  function editDistance(a, b, max) {
    a = typeof a === 'string' ? a : ''; b = typeof b === 'string' ? b : '';
    const n = a.length, m = b.length;
    const lim = typeof max === 'number' && max >= 0 ? max : Infinity;
    if (Math.abs(n - m) > lim) return lim + 1;
    if (!n) return m;
    if (!m) return n;
    let prev2 = null, prev = new Array(m + 1), cur;
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur = new Array(m + 1);
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > lim) return lim + 1;
      prev2 = prev; prev = cur;
    }
    return prev[m];
  }
  const HON_SORTED = HONORIFICS.slice().sort((x, y) => y.length - x.length);
  function stripHonorific(s) {
    for (let i = 0; i < HON_SORTED.length; i++) {
      const h = HON_SORTED[i];
      if (s.indexOf(h) === 0) {
        const r = s.slice(h.length).trim();
        if (r.length >= 2) return r;
      }
    }
    return '';
  }
  function nameForms(raw) {
    const forms = [];
    const k0 = lightKey(raw);
    if (!k0) return forms;
    forms.push(k0);
    const k1 = stripHonorific(k0);
    if (k1) {
      forms.push(k1);
      const k2 = stripHonorific(k1);
      if (k2) forms.push(k2);
    }
    return forms;
  }
  function aliasEntries(aliases) {
    const out = [];
    if (aliases instanceof Map) aliases.forEach((v, k) => out.push([k, v]));
    else if (isObj(aliases) && !Array.isArray(aliases)) Object.keys(aliases).forEach(k => out.push([k, aliases[k]]));
    return out;
  }
  function buildNameIndex(staff, aliases) {
    const idx = { exact: new Map(), alias: new Map(), fold: new Map(), folds: [], names: [], warnings: [] };
    const addFold = (f, name) => {
      if (!f) return;
      if (!idx.fold.has(f)) idx.fold.set(f, []);
      const l = idx.fold.get(f);
      if (l.indexOf(name) < 0) l.push(name);
      idx.folds.push({ fold: f, name });
    };
    normStaff(staff).forEach(s => {
      if (!s.active) return;
      const k = lightKey(s.name);
      if (!k || idx.exact.has(k)) return;
      idx.exact.set(k, s.name);
      idx.names.push(s.name);
      addFold(foldName(s.name), s.name);
    });
    aliasEntries(aliases).forEach(e => {
      const alias = typeof e[0] === 'string' ? e[0].trim() : '';
      const target = cleanName(e[1]);
      const k = lightKey(alias);
      if (!k) return;
      const tName = idx.exact.get(lightKey(target));
      if (!tName) { idx.warnings.push({ code: 'ALIAS_TARGET_MISSING', alias, target }); return; }
      if (idx.exact.has(k)) {
        if (idx.exact.get(k) !== tName) idx.warnings.push({ code: 'ALIAS_SHADOWED', alias, target: tName, name: idx.exact.get(k) });
        return;
      }
      if (idx.alias.has(k)) return;
      idx.alias.set(k, tName);
      addFold(foldName(alias), tName);
    });
    return idx;
  }
  function asIndex(index) {
    if (isObj(index) && index.exact instanceof Map && index.fold instanceof Map) return index;
    return buildNameIndex(index, null);
  }
  function matchStaffName(raw, index, allowFuzzy) {
    const idx = asIndex(index);
    const rawStr = typeof raw === 'string' ? raw.trim() : '';
    const forms = nameForms(rawStr);
    for (let i = 0; i < forms.length; i++) {
      if (idx.exact.has(forms[i])) return { raw: rawStr, name: idx.exact.get(forms[i]), how: 'exact' };
    }
    for (let i = 0; i < forms.length; i++) {
      if (idx.alias.has(forms[i])) return { raw: rawStr, name: idx.alias.get(forms[i]), how: 'alias' };
    }
    for (let i = 0; i < forms.length; i++) {
      const hit = idx.fold.get(foldName(forms[i]));
      if (hit && hit.length === 1) return { raw: rawStr, name: hit[0], how: 'normalized' };
      if (hit && hit.length > 1) return { raw: rawStr, name: null, ambiguous: hit.slice() };
    }
    if (allowFuzzy) {
      for (let i = 0; i < forms.length; i++) {
        const f = foldName(forms[i]);
        if (f.length < 4) continue;
        const hits = [];
        idx.folds.forEach(e => {
          if (e.fold.length >= 4 && hits.indexOf(e.name) < 0 && editDistance(f, e.fold, 1) <= 1) hits.push(e.name);
        });
        if (hits.length === 1) return { raw: rawStr, name: hits[0], how: 'fuzzy' };
        if (hits.length > 1) return { raw: rawStr, name: null, ambiguous: hits };
      }
    }
    return { raw: rawStr, name: null };
  }

  const NOBODY = ['ไม่มี', 'ไม่มีคน', 'ว่าง', '-', '–', '—', 'none', 'x'];
  const PAREN_RE = /\(([^()]*)\)|\[([^[\]]*)\]/g;
  function maskParens(s) { return s.replace(/\([^()]*\)|\[[^[\]]*\]/g, m => ' '.repeat(m.length)); }
  /** Split names text on hard separators outside parentheses. */
  function splitNameChunks(text) {
    const t = text.replace(/[<>"'\\|]/g, ' ');
    const masked = maskParens(t);
    const cuts = [];
    const re = /[,，、;；/+&]| (?:และ|กับ)(?= )/g;
    let m;
    while ((m = re.exec(masked))) cuts.push([m.index, m[0].length]);
    const out = [];
    let pos = 0;
    cuts.forEach(c => { out.push(t.slice(pos, c[0])); pos = c[0] + c[1]; });
    out.push(t.slice(pos));
    return out.map(s => s.replace(/ {2,}/g, ' ').trim()).filter(Boolean);
  }
  function isNobody(s) { return NOBODY.indexOf(lightKey(s)) >= 0; }
  function isHonorificWord(s) { return HONORIFICS.indexOf(s) >= 0; }
  /** §7.5 steps 1–4 for one chunk → resolved items [{raw, name|null, how?, ambiguous?, note?}]. */
  function resolveChunk(chunk, idx) {
    const c = chunk.trim();
    if (!c || isNobody(c)) return [];
    const whole = matchStaffName(c, idx, false);
    if (whole.name || whole.ambiguous) return [whole];
    const notes = [];
    const bare = c.replace(PAREN_RE, (m0, a, b) => { const q = (a !== undefined ? a : b).trim(); if (q) notes.push(q); return ' '; })
      .replace(/ {2,}/g, ' ').trim();
    const note = notes.join(' ');
    const out = [];
    if (notes.length && bare) {
      const m = matchStaffName(bare, idx, false);
      if (m.name || m.ambiguous) { out.push(m); }
    }
    if (!out.length && bare) {
      const raw = bare.split(' ').filter(Boolean);
      const tokens = [];
      for (let i = 0; i < raw.length; i++) {
        if (isHonorificWord(raw[i]) && i + 1 < raw.length) { tokens.push(raw[i] + ' ' + raw[i + 1]); i++; }
        else tokens.push(raw[i]);
      }
      let i = 0;
      while (i < tokens.length) {
        if (isNobody(tokens[i])) { i++; continue; }
        let done = false;
        for (let len = Math.min(3, tokens.length - i); len >= 2 && !done; len--) {
          const m = matchStaffName(tokens.slice(i, i + len).join(' '), idx, false);
          if (m.name) { out.push(m); i += len; done = true; }
        }
        if (done) continue;
        const tok = tokens[i];
        const m = matchStaffName(tok, idx, true);
        if (m.name) out.push(m);
        else {
          let split = null;
          if (/และ|กับ/.test(tok)) {
            const parts = tok.split(/และ|กับ/).map(p => p.trim()).filter(Boolean);
            if (parts.length >= 2) {
              const ms = parts.map(p => matchStaffName(p, idx, false));
              if (ms.every(x => !!x.name)) split = ms;
            }
          }
          if (split) split.forEach(x => out.push(x)); else out.push(m);
        }
        i++;
      }
    }
    if (note && out.length) out[0] = Object.assign({}, out[0], { note });
    return out;
  }

  /* ================================================================== §7.6 units */
  function unitKey(s) { return str(s).toUpperCase().replace(/[\s.\-_]/g, ''); }
  function buildUnitMap(units) {
    const list = Array.isArray(units) ? units : DEFAULT_UNITS;
    const map = new Map();
    list.forEach(u => {
      if (!isObj(u)) return;
      const label = cleanName(u.label);
      if (!label) return;
      const entry = { label, thisUnit: u.thisUnit === true, station: STATION_IDS.indexOf(u.station) >= 0 ? u.station : null };
      [label].concat(arr(u.synonyms)).forEach(syn => {
        const k = unitKey(syn);
        if (k && !map.has(k)) map.set(k, entry);
      });
    });
    return map;
  }
  const PARTICLE_RE = /\s*(?:นะ\s*)?(?:ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|จ้ะ)$/;
  function parseUnitWith(text, map) {
    const warnings = [];
    const quals = [];
    let t = str(text).replace(PAREN_RE, (m0, a, b) => { const q = (a !== undefined ? a : b).trim(); if (q) quals.push(q); return ' '; });
    t = t.replace(/ {2,}/g, ' ').trim();
    for (let guard = 0; guard < 4; guard++) {
      const before = t;
      t = t.replace(/[\s.,!?;:…~]+$/, '');
      t = t.replace(PARTICLE_RE, '').trim();
      if (t === before) break;
    }
    t = t.replace(/^[\s:=\->→]+/, '').replace(/[\s.,!?;:…~]+$/, '');
    t = t.replace(/^(?:ที่|เวร)\s*/, '').trim();
    // Step 6 is checked first when EVERY part is a known unit, so "IPD และ ER" / "CT + MRI" are multi-units
    // instead of a step-5 unit with the qualifier "และ ER" (documented deviation, see the A4 report).
    const qualifier = quals.join(' ');
    const parts = t.split(/[/+&,]| (?:และ|กับ) /).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const es = parts.map(p => map.get(unitKey(p)));
      if (es.every(Boolean)) {
        warnings.push({ code: 'MULTI_UNIT', unit: t });
        return { unit: t, isThisUnit: es.some(e => e.thisUnit), station: null, qualifier, warnings };
      }
    }
    const tokens = t ? t.split(' ') : [];
    for (let len = tokens.length; len >= 1; len--) {
      const e = map.get(unitKey(tokens.slice(0, len).join(' ')));
      if (e) {
        return { unit: e.label, isThisUnit: e.thisUnit, station: e.station, qualifier: tokens.slice(len).concat(quals).join(' ').trim(), warnings };
      }
    }
    warnings.push({ code: 'UNKNOWN_UNIT', unit: t });
    return { unit: t, isThisUnit: false, station: null, qualifier, warnings };
  }
  function parseUnitText(text, units) { return parseUnitWith(text, buildUnitMap(units)); }

  /* ================================================================== §7.3 dates */
  const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
    'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const TH_MONTHS_ABBR = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
  const TH_MONTHS_SHORT = ['มกรา', 'กุมภา', 'มีนา', 'เมษา', 'พฤษภา', 'มิถุนา', 'กรกฎา', 'สิงหา', 'กันยา', 'ตุลา', 'พฤศจิกา', 'ธันวา'];
  const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
    'november', 'december'];
  const TH_MONTH_FOLDS = TH_MONTHS_FULL.map(foldName);
  function monthSingle(x) {
    x = x.replace(/\./g, '');
    if (!x) return 0;
    if (/^[A-Za-z]+$/.test(x)) {
      const l = x.toLowerCase();
      if (l.length < 3) return 0;
      for (let i = 0; i < 12; i++) if (EN_MONTHS[i].indexOf(l) === 0) return i + 1;
      return 0;
    }
    const ab = TH_MONTHS_ABBR.indexOf(x);
    if (ab >= 0) return ab + 1;
    let best = 0, bestLen = 0;
    for (let i = 0; i < 12; i++) {
      [TH_MONTHS_FULL[i], TH_MONTHS_SHORT[i]].forEach(f => {
        if (x.indexOf(f) === 0 && f.length > bestLen) { best = i + 1; bestLen = f.length; }
      });
    }
    if (best) return best;
    if (x.length >= 5) {
      const f = foldName(x);
      const hits = [];
      for (let i = 0; i < 12; i++) if (editDistance(f, TH_MONTH_FOLDS[i], 2) <= 2) hits.push(i + 1);
      if (hits.length === 1) return hits[0];
    }
    return 0;
  }
  function monthFromToken(token) {
    const t = str(token).replace(/\s/g, '');
    if (!t) return 0;
    let r = monthSingle(t);
    if (!r) {
      const j = t.lastIndexOf('.');
      if (j > 0 && j < t.length - 1) r = monthSingle(t.slice(0, j + 1));
    }
    return r;
  }
  function ymdOf(y, m, d) { return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d); }
  function resolveYear(ystr, mo, d, ref) {
    const refY = isValidYmd(ref) ? +ref.slice(0, 4) : null;
    if (ystr === undefined || ystr === null || ystr === '') {
      if (refY === null) return { date: null, warnings: ['NO_YEAR'] };
      let best = null, bestDist = Infinity;
      const r = utcDay(ref);
      [refY, refY + 1, refY - 1].forEach(y => {
        const c = ymdOf(y, mo, d);
        if (!isValidYmd(c)) return;
        const dist = Math.abs(utcDay(c) - r);
        if (dist < bestDist) { best = c; bestDist = dist; }
      });
      return best ? { date: best, warnings: ['YEAR_ASSUMED'] } : { date: null, warnings: ['BAD_DATE'] };
    }
    let y;
    if (ystr.length === 4) {
      y = +ystr;
      if (y >= 2400) y -= 543;
      else if (y < 1900) return { date: null, warnings: ['BAD_DATE'] };
    } else {
      const yy = +ystr, a = 1957 + yy, b = 2000 + yy;
      y = refY === null ? a : (Math.abs(a - refY) <= Math.abs(b - refY) ? a : b);
    }
    const c = ymdOf(y, mo, d);
    return isValidYmd(c) ? { date: c, warnings: [] } : { date: null, warnings: ['BAD_DATE'] };
  }
  const DATE_ISO_RE = /(^|[^\d])(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g;
  const DATE_TEXT_RE = /(^|[^\d])(\d{1,2})\s*([\u0E01-\u0E4E.]*[\u0E01-\u0E4E][\u0E01-\u0E4E.]*|[A-Za-z]{3,9}(?![A-Za-z]))(?:\s*(\d{4}|\d{2})(?![\d:]))?/g;
  const DATE_NUM_RE = /(^|[^\d])(\d{1,2})([/.-])(\d{1,2})(?:\3(\d{4}|\d{2}))?(?!\d)/g;
  const DATE_SPACE_RE = /(^|[^\d])(\d{1,2}) (\d{1,2}) (\d{4})(?!\d)/g;
  function dayMonthOk(d, m) { return d >= 1 && d <= 31 && m >= 1 && m <= 12; }
  function parseThaiDate(text, ref) {
    const s = typeof text === 'string' ? digitFix(text) : '';
    const done = (mo, d, ystr, m, prefixLen) => {
      const r = resolveYear(ystr, mo, d, ref);
      return { date: r.date, warnings: r.warnings, match: { index: m.index + prefixLen, length: m[0].length - prefixLen } };
    };
    let m;
    DATE_ISO_RE.lastIndex = 0;
    while ((m = DATE_ISO_RE.exec(s))) {
      const mo = +m[3], d = +m[4];
      if (dayMonthOk(d, mo)) return done(mo, d, m[2], m, m[1].length);
      DATE_ISO_RE.lastIndex = m.index + 1;
    }
    DATE_TEXT_RE.lastIndex = 0;
    while ((m = DATE_TEXT_RE.exec(s))) {
      const d = +m[2], mo = monthFromToken(m[3]);
      if (mo && dayMonthOk(d, mo)) return done(mo, d, m[4], m, m[1].length);
      DATE_TEXT_RE.lastIndex = m.index + 1;
    }
    const tryNum = (re, dI, mI, yI) => {
      re.lastIndex = 0;
      let mm;
      while ((mm = re.exec(s))) {
        const d = +mm[dI], mo = +mm[mI];
        if (dayMonthOk(d, mo)) return done(mo, d, mm[yI], mm, mm[1].length);
        re.lastIndex = mm.index + 1;
      }
      return null;
    };
    return tryNum(DATE_NUM_RE, 2, 4, 5) || tryNum(DATE_SPACE_RE, 2, 3, 4) || { date: null, warnings: ['BAD_DATE'], match: null };
  }

  /* ================================================================== §7.2 block structure */
  const FILLER_WORDS = ['พฤหัสบดี', 'อาทิตย์', 'จันทร์', 'อังคาร', 'พฤหัส', 'ศุกร์', 'เสาร์', 'พุธ', 'วันที่', 'ประจำ',
    'วัน', 'ที่', 'ของ', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function isFillerOnly(s) {
    let t = str(s).toLowerCase();
    FILLER_WORDS.forEach(w => { t = t.split(w).join(' '); });
    return t.replace(/[^\u0E01-\u0E2E\u0E30-\u0E3A\u0E40-\u0E45\u0E47-\u0E4E0-9a-z]/g, '') === '';
  }
  const HEADER_WORD = 'แทนเวร';
  /** Date header found inside `text` with only filler around it, else null. */
  function dateOnlyHeader(text, ref) {
    const p = parseThaiDate(text, ref);
    if (!p.match) return null;
    const residue = text.slice(0, p.match.index) + ' ' + text.slice(p.match.index + p.match.length);
    return isFillerOnly(residue) ? { date: p.date, warnings: p.warnings } : null;
  }
  function classifyHeader(line, ref) {
    if (line.indexOf(HEADER_WORD) === 0) {
      const rest = line.slice(HEADER_WORD.length);
      const p = parseThaiDate(rest, ref);
      if (p.match) return { date: p.date, warnings: p.warnings };
      if (/วันนี้|พรุ่งนี้/.test(rest)) return { date: null, warnings: ['RELATIVE_DATE'] };
      if (isFillerOnly(rest)) return { date: null, warnings: ['NO_DATE'] };
      return { date: null, warnings: ['BAD_DATE'] };
    }
    const i = line.indexOf(HEADER_WORD);
    if (i > 0) {                                       // chat-export prefix: header only if the rest is a date or filler
      const rest = line.slice(i + HEADER_WORD.length);
      return dateOnlyHeader(rest, ref) || (isFillerOnly(rest) ? { date: null, warnings: ['NO_DATE'] } : null);
    }
    if (line.indexOf('แทน') < 0) return dateOnlyHeader(line, ref);
    return null;
  }
  const REMARK_RE = /^(?:หมายเหตุ|ป\.ล\.|ปล\.)\s*[:-]?\s*/;
  const LIST_RE = /^(?:[-–—•·*▪◦●]+|\(?\d{1,2}[.)])\s*/;
  function isThaiChar(ch) { return !!ch && ch >= '\u0E00' && ch <= '\u0E7F'; }
  function findSeparator(line) {
    const masked = maskParens(line);
    const occ = [];
    let j = masked.indexOf('แทน');
    while (j >= 0) { occ.push(j); j = masked.indexOf('แทน', j + 1); }
    const hasAfter = i => line.slice(i + 3).trim() !== '';
    const standalone = i => {
      if (!(i === 0 || masked[i - 1] === ' ')) return false;
      const rest = masked.slice(i + 3);
      return rest === '' || !isThaiChar(rest[0]) || /^(?:ที่|เวร)(?: |[A-Za-z])/.test(rest);
    };
    for (let k = occ.length - 1; k >= 0; k--) if (standalone(occ[k]) && hasAfter(occ[k])) return occ[k];
    for (let k = occ.length - 1; k >= 0; k--) if (hasAfter(occ[k])) return occ[k];
    return -1;
  }
  /**
   * A line without "แทน" (owner 2026-11-27: "พี่ ก. IPD" = ก. comes to help IPD): "<names> <unit>" where the line
   * ENDS with a known unit of the unit map (1–3 words; trailing (notes), punctuation and polite particles ignored; an
   * optional ":" "=" "→" ">" "-" between names and unit). → {namesText, unitText} or null. parseEntry accepts it only
   * when at least one name resolves, so free text such as "ห้อง CT" or "ประชุม IPD" stays an unparsed line.
   */
  function implicitSplit(body, unitMap) {
    const flat = maskParens(body).replace(/[:=→>]/g, ' ');   // same length as body: indices stay valid
    let core = flat;
    for (let guard = 0; guard < 4; guard++) {
      const before = core;
      core = core.replace(/[\s.,!?;…~]+$/, '').replace(PARTICLE_RE, '');
      if (core === before) break;
    }
    const toks = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(core))) toks.push(m.index);
    for (let len = Math.min(3, toks.length - 1); len >= 1; len--) {
      const at = toks[toks.length - len];
      if (!unitMap.get(unitKey(core.slice(at)))) continue;
      const namesText = body.slice(0, at).replace(/[\s:=→>\-–—]+$/, '').trim();
      if (namesText) return { namesText, unitText: body.slice(at).trim() };
    }
    return null;
  }
  function parseEntry(body, lineNo, idx, unitMap, warnings) {
    const sep = findSeparator(body);
    let namesText, unitText, implicit = false;
    if (sep >= 0) {
      namesText = body.slice(0, sep).trim();
      unitText = body.slice(sep + 3).trim();
    } else {
      const im = implicitSplit(body, unitMap);
      if (!im) return null;
      namesText = im.namesText; unitText = im.unitText; implicit = true;
    }
    const resolved = [];
    splitNameChunks(namesText).forEach(ch => resolveChunk(ch, idx).forEach(r => resolved.push(r)));
    if (implicit && !resolved.some(r => r.name || r.ambiguous)) return null;
    const u = parseUnitWith(unitText, unitMap);
    const names = [], rawNames = [];
    resolved.forEach(r => {
      rawNames.push(r.raw);
      if (r.name) {
        if (names.indexOf(r.name) < 0) names.push(r.name);
        if (r.how === 'fuzzy') warnings.push({ code: 'FUZZY_MATCH', raw: r.raw, name: r.name, line: lineNo });
      } else if (r.ambiguous) {
        warnings.push({ code: 'AMBIGUOUS_NAME', raw: r.raw, candidates: r.ambiguous.slice(), line: lineNo });
      } else {
        warnings.push({ code: u.isThisUnit ? 'UNMATCHED_HELPER' : 'UNMATCHED_NAME', raw: r.raw, line: lineNo });
      }
    });
    if (!resolved.length) warnings.push({ code: 'NO_NAMES', line: lineNo });
    u.warnings.forEach(w => warnings.push(Object.assign({}, w, { line: lineNo })));
    if (u.isThisUnit) {
      if (u.qualifier) warnings.push({ code: 'HELP_NOTE', note: u.qualifier, line: lineNo });
      resolved.forEach(r => { if (r.note && r.name) warnings.push({ code: 'HELP_NOTE', note: r.note, name: r.name, line: lineNo }); });
    }
    return {
      names, rawNames, unit: u.unit, isThisUnit: u.isThisUnit, station: u.station, qualifier: u.qualifier,
      resolved: resolved.map(r => Object.assign({}, r, r.ambiguous ? { ambiguous: r.ambiguous.slice() } : {})), line: lineNo
    };
  }
  function newBlock(date, codes) {
    return { date: date || null, entries: [], helpers: [], away: [], unmatched: [], remarks: [], warnings: codes.map(c => ({ code: c })) };
  }
  function finishBlock(b, globalWarnings) {
    const helpers = [], awayNames = [], away = [], unmatched = [];
    const unitsOf = new Map();
    b.entries.forEach(e => {
      e.resolved.forEach(r => { if (!r.name) unmatched.push(r.raw); });
      e.names.forEach(n => {
        if (!unitsOf.has(n)) unitsOf.set(n, []);
        const l = unitsOf.get(n);
        if (l.indexOf(e.unit) < 0) l.push(e.unit);
        if (e.isThisUnit && helpers.indexOf(n) < 0) helpers.push(n);
      });
    });
    b.entries.forEach(e => {
      if (e.isThisUnit) return;
      e.names.forEach(n => {
        if (helpers.indexOf(n) < 0 && awayNames.indexOf(n) < 0) { awayNames.push(n); away.push({ name: n, unit: e.unit }); }
      });
    });
    unitsOf.forEach((units, name) => { if (units.length > 1) b.warnings.push({ code: 'DUPLICATE_PERSON', name, units: units.slice() }); });
    b.helpers = helpers; b.away = away; b.unmatched = unmatched;
    b.warnings = globalWarnings.map(w => Object.assign({}, w)).concat(b.warnings);
    return b;
  }
  function parseBackupMessages(text, staff, aliases, options) {
    const opts = isObj(options) ? options : {};
    const ref = isValidYmd(opts.selectedDate) ? opts.selectedDate : (isValidYmd(opts.today) ? opts.today : null);
    const norm = normalizeInternal(text, opts);
    const idx = buildNameIndex(staff, aliases);
    const unitMap = buildUnitMap(opts.units);
    const blocks = [];
    let cur = null, inRemarks = false;
    let pending = [];
    const open = (date, codes) => {
      cur = newBlock(date, codes);
      blocks.push(cur);
      inRemarks = false;
      if (pending.length) { pending.forEach(w => cur.warnings.push(w)); pending = []; }
    };
    norm.lines.forEach((line, i) => {
      if (!line) return;
      const lineNo = i + 1;
      const h = classifyHeader(line, ref);
      if (h) { open(h.date, h.warnings); return; }
      const rm = REMARK_RE.exec(line);
      if (inRemarks && cur) {
        const text = rm ? line.slice(rm[0].length).trim() : line;
        if (text) cur.remarks.push(text);
        return;
      }
      if (rm) {
        if (!cur) open(null, ['NO_HEADER']);
        const rest = line.slice(rm[0].length).trim();
        if (rest) cur.remarks.push(rest);
        inRemarks = true;
        return;
      }
      const body = line.replace(LIST_RE, '');
      const ws = [];
      const entry = parseEntry(body, lineNo, idx, unitMap, ws);
      if (entry) {
        if (!cur) open(null, ['NO_HEADER']);
        cur.entries.push(entry);
        ws.forEach(w => cur.warnings.push(w));
        return;
      }
      const w = { code: 'UNPARSED_LINE', line: lineNo, text: line };
      if (cur) cur.warnings.push(w); else pending.push(w);
    });
    const globalWarnings = [];
    if (norm.truncated) globalWarnings.push({ code: 'TRUNCATED', limit: MAX_MESSAGE_CHARS });
    idx.warnings.forEach(w => globalWarnings.push(w));
    return blocks.map(b => finishBlock(b, globalWarnings));
  }
  function parseBackupMessage(text, staff, aliases, options) {
    const opts = isObj(options) ? options : {};
    const blocks = parseBackupMessages(text, staff, aliases, opts);
    if (!blocks.length) {
      return { date: null, entries: [], helpers: [], away: [], unmatched: [], remarks: [], warnings: [{ code: 'EMPTY' }],
        blockCount: 0, blockIndex: -1, dateMatches: null };
    }
    const sel = isValidYmd(opts.selectedDate) ? opts.selectedDate : null;
    let index = 0, dateMatches = null;
    const extra = [];
    if (sel) {
      const hits = [];
      blocks.forEach((b, i) => { if (b.date === sel) hits.push(i); });
      if (hits.length) {
        index = hits[hits.length - 1];
        dateMatches = true;
        if (hits.length > 1) extra.push({ code: 'DUPLICATE_DATE', date: sel, count: hits.length });
      } else {
        index = 0;
        if (blocks[0].date) { dateMatches = false; extra.push({ code: 'DATE_MISMATCH', messageDate: blocks[0].date, selectedDate: sel }); }
      }
    }
    if (blocks.length > 1) extra.push({ code: 'MULTIPLE_BLOCKS', count: blocks.length, dates: blocks.map(b => b.date) });
    const b = blocks[index];
    return Object.assign({}, b, { warnings: b.warnings.concat(extra), blockCount: blocks.length, blockIndex: index, dateMatches });
  }

  /* ================================================================== §8 vacation */
  function stampKey(v) {
    if (typeof v !== 'string' && typeof v !== 'number') return Infinity;
    const t = Date.parse(v);
    return isNaN(t) ? Infinity : t;
  }
  function rowsOfDate(leavesOnDate) {
    if (Array.isArray(leavesOnDate)) return leavesOnDate.filter(isObj);
    if (leavesOnDate instanceof Map) {
      const out = [];
      leavesOnDate.forEach((l, k) => { if (isObj(l)) out.push(Object.assign({ staff: k }, l)); });
      return out;
    }
    if (isObj(leavesOnDate)) {
      return Object.keys(leavesOnDate).filter(k => isObj(leavesOnDate[k])).map(k => Object.assign({ staff: k }, leavesOnDate[k]));
    }
    return [];
  }
  function activeTest(active) {
    if (active instanceof Set) return n => active.has(n);
    if (Array.isArray(active)) { const s = new Set(active); return n => s.has(n); }
    return null;
  }
  function groupTest(groupOf) {
    if (typeof groupOf === 'function') return n => str(groupOf(n)) || 'regular';
    if (groupOf instanceof Map) return n => str(groupOf.get(n)) || 'regular';
    if (isObj(groupOf)) return n => (own(groupOf, n) ? str(groupOf[n]) : '') || 'regular';
    return () => 'regular';
  }
  /** Rows of `type`, first row per staff, active filter, sorted by (recordedAt, original order). */
  function typedRows(leavesOnDate, type, active) {
    const isAct = activeTest(active);
    const seen = new Set(), out = [];
    rowsOfDate(leavesOnDate).forEach((l, i) => {
      const n = cleanName(l.staff);
      if (!n || seen.has(n)) return;
      seen.add(n);
      if (str(l.type).trim() !== type) return;
      if (isAct && !isAct(n)) return;
      out.push({ l, n, i, t: stampKey(l.recordedAt) });
    });
    out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i));
    return out;
  }
  function vacationQueue(leavesOnDate, opts) {
    opts = isObj(opts) ? opts : {};
    const type = cleanName(opts.type) || VACATION;
    const sameGroup = opts.scope === 'sameGroup';
    const grp = groupTest(opts.groupOf);
    const counters = new Map();
    return typedRows(leavesOnDate, type, opts.active).map(x => {
      const status = leaveStatus(x.l);
      let rank = 0;
      if (status !== 'rejected') {
        const g = sameGroup ? grp(x.n) : '*';
        rank = (counters.get(g) || 0) + 1;
        counters.set(g, rank);
      }
      return { staff: x.n, status, rank, recordedAt: x.l.recordedAt === undefined ? '' : x.l.recordedAt };
    });
  }
  function vacationDecision(o) {
    o = isObj(o) ? o : {};
    const who = cleanName(o.staff);
    const sameGroup = o.scope === 'sameGroup';
    const grp = groupTest(o.groupOf);
    const g = grp(who);
    const count = typedRows(o.leavesOnDate, VACATION, o.active).filter(x =>
      x.n !== who && leaveStatus(x.l) !== 'rejected' && (!sameGroup || grp(x.n) === g)).length;
    const limit = Number.isInteger(o.limit) && o.limit >= 0 ? o.limit : 0;
    if (o.enteredBySupervisor === true) return { status: 'approved', count, rank: count + 1, reason: 'SUPERVISOR' };
    return count < limit ? { status: 'approved', count, rank: count + 1, reason: 'WITHIN_LIMIT' }
      : { status: 'pending', count, rank: count + 1, reason: 'OVER_LIMIT' };
  }
  function vacationBalance(o) {
    o = isObj(o) ? o : {};
    const who = cleanName(o.staff);
    const bal = isObj(o.balance) && typeof o.balance.days === 'number' && isFinite(o.balance.days) ? o.balance : null;
    const after = bal ? (isValidYmd(bal.asOf) ? bal.asOf : '') : (isValidYmd(o.since) ? o.since : '');
    const today = str(o.today);
    const hs = holidaySet(o.holidays);
    let used = 0, scheduled = 0, pending = 0, ignoredNonWorking = 0;
    const seen = new Set();
    arr(o.leaves).forEach(l => {
      if (!isObj(l) || cleanName(l.staff) !== who) return;
      const d = str(l.date).trim();
      if (!isValidYmd(d) || seen.has(d)) return;
      seen.add(d);
      if (str(l.type).trim() !== VACATION) return;
      if (after && d <= after) return;
      const st = leaveStatus(l);
      if (st === 'rejected') return;
      if (!isWorkingDayIn(d, hs)) { ignoredNonWorking++; return; }
      if (st === 'pending') { pending++; return; }
      if (d <= today) used++; else scheduled++;
    });
    const out = { staff: who, known: !!bal, days: bal ? bal.days : null, asOf: bal ? str(bal.asOf) : null,
      since: bal ? null : (after || null), used, scheduled, pending, ignoredNonWorking };
    if (bal) {
      out.remaining = bal.days - used - scheduled;
      out.remainingIfPendingApproved = out.remaining - pending;
      out.overdrawn = out.remaining < 0;
    } else {
      out.remaining = null; out.remainingIfPendingApproved = null; out.overdrawn = false;
    }
    return out;
  }

  /* ================================================================== §9 statistics */
  function getByDate(m, d) {
    if (m instanceof Map) return m.get(d);
    return own(m, d) ? m[d] : undefined;
  }
  function assignmentsOf(day) {
    if (!isObj(day)) return null;
    return isObj(day.assignments) ? day.assignments : day;
  }
  function personStats(o) {
    o = isObj(o) ? o : {};
    const name = cleanName(o.name);
    const from = str(o.from), to = str(o.to), today = str(o.today);
    const hs = holidaySet(o.holidays);
    const dates = U.eachDate(from, to);
    const stations = Object.create(null);
    STATION_IDS.forEach(id => { stations[id] = 0; });
    const lines = Object.create(null);
    lines.none = 0;
    const lunch = { er: { served: 0, scheduled: 0 }, ipd: { served: 0, scheduled: 0 } };
    const mission = { served: 0, scheduled: 0, servedNonWorking: 0, scheduledNonWorking: 0 };
    const leaves = { approved: Object.create(null), pending: Object.create(null), rejected: Object.create(null),
      fullDays: 0, partialDays: 0, vacationDays: 0 };
    const conflicts = [];
    let savedDays = 0, daysWorked = 0;
    // leaves of this person in range, first row per date
    const fullLeave = new Map();
    const seen = new Set();
    arr(o.leaves).forEach(l => {
      if (!isObj(l) || cleanName(l.staff) !== name) return;
      const d = str(l.date).trim();
      if (!isValidYmd(d) || d < from || d > to || seen.has(d)) return;
      const type = str(l.type).trim();
      const kind = leaveKind(type);
      if (!kind) return;
      seen.add(d);
      const st = leaveStatus(l);
      const bucket = leaves[st];
      bucket[type] = (bucket[type] || 0) + 1;
      if (st !== 'approved') return;
      if (kind === 'full') { leaves.fullDays++; fullLeave.set(d, type); } else leaves.partialDays++;
      if (type === VACATION && isWorkingDayIn(d, hs)) leaves.vacationDays++;
    });
    dates.forEach(d => {
      const asg = assignmentsOf(getByDate(o.days, d));
      const duty = getByDate(o.duties, d);
      if (asg) {
        savedDays++;
        let worked = false;
        Object.keys(asg).forEach(S => {
          const list = uniqNames(asg[S]);
          if (list.indexOf(name) < 0) return;
          worked = true;
          stations[S] = (stations[S] || 0) + 1;
          if (fullLeave.has(d)) conflicts.push({ date: d, kind: 'station', station: S });
          if (S === 'portable') {
            const plan = isObj(duty) ? sortedLines(duty.lines) : [];
            if (plan.length) {
              const w = resolveLines(plan, list).workers.indexOf(name);
              if (w >= 0) lines[plan[w].line] = (lines[plan[w].line] || 0) + 1; else lines.none++;
            } else lines.none++;
          }
        });
        if (worked) daysWorked++;
      }
      if (isObj(duty)) {
        if (isObj(duty.lunch)) {
          LUNCH_STATIONS.forEach(s => {
            const slot = duty.lunch[s];
            if (!isObj(slot) || cleanName(slot.tech) !== name) return;
            if (fullLeave.has(d)) { conflicts.push({ date: d, kind: 'lunch', station: s }); return; }
            if (d <= today) lunch[s].served++; else lunch[s].scheduled++;
          });
        }
        if (arr(duty.mission).map(cleanName).indexOf(name) >= 0) {
          if (fullLeave.has(d)) conflicts.push({ date: d, kind: 'mission' });
          else {
            const nw = !isWorkingDayIn(d, hs);
            if (d <= today) { mission.served++; if (nw) mission.servedNonWorking++; }
            else { mission.scheduled++; if (nw) mission.scheduledNonWorking++; }
          }
        }
      }
    });
    return { name, from, to, savedDays, daysWorked, stations, lines, lunch, mission, leaves, conflicts };
  }
  function teamStats(o) {
    o = isObj(o) ? o : {};
    let names = Array.isArray(o.names) ? uniqNames(o.names) : null;
    if (!names) {
      const found = [], seen = new Set();
      const add = n => { n = cleanName(n); if (n && !seen.has(n)) { seen.add(n); found.push(n); } };
      normStaff(o.staff).forEach(s => add(s.name));
      U.eachDate(str(o.from), str(o.to)).forEach(d => {
        const asg = assignmentsOf(getByDate(o.days, d));
        if (asg) Object.keys(asg).forEach(S => arr(asg[S]).forEach(add));
        const duty = getByDate(o.duties, d);
        if (isObj(duty)) {
          arr(duty.lines).forEach(l => { if (isObj(l)) add(l.tech); });
          if (isObj(duty.lunch)) LUNCH_STATIONS.forEach(s => { if (isObj(duty.lunch[s])) add(duty.lunch[s].tech); });
          arr(duty.mission).forEach(add);
        }
      });
      arr(o.leaves).forEach(l => { if (isObj(l) && str(l.date) >= str(o.from) && str(l.date) <= str(o.to)) add(l.staff); });
      names = found;
    }
    return names.map(n => personStats(Object.assign({}, o, { name: n })));
  }

  /* ------------------------------------------------------------------ export */
  global.PlanEngine = Object.freeze({
    ALGO_VERSION, PARTIAL_LEAVE_TYPES, PARTIAL_DEFAULT_TIMES, DEFAULT_LUNCH_WINDOW, LUNCH_STATIONS, DEFAULT_PRIORITY,
    DEFAULT_RESTRICTED, DEFAULT_UNITS, HONORIFICS, MAX_MESSAGE_CHARS,
    holidaySet, isWorkingDay, workingDaysOfMonth, workingDayIndex, workingDaysBetween,
    leaveStatus, leaveKind, availabilityOn, timeOverlaps,
    buildSeats, portableLines, resolveLines,
    lunchPick,
    missionPick, resolveCursor, suggestMissionSubstitute,
    generateMonthDuties, suggestOffsets, dutyConflicts,
    proposeDay, lexMatch, noteText,
    normalizeMessageText, parseThaiDate, monthFromToken, lightKey, foldName, editDistance, buildNameIndex,
    matchStaffName, parseUnitText, parseBackupMessages, parseBackupMessage,
    vacationQueue, vacationDecision, vacationBalance,
    personStats, teamStats
  });
})(window);
