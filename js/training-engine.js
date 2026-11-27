/* =====================================================================
 * js/training-engine.js — pure engine of the training schedules (R5-SPEC §3.1) → window.TrainingEngine
 *
 * Rules: classic script, one IIFE, ES2019. Pure functions only: no DOM, network, storage, Date.now() or zero-argument
 * new Date(); inputs are never mutated; the same input gives a deep-equal output. Dates are 'YYYY-MM-DD' strings, computed
 * in UTC (no time-zone effects). Needs nothing else (load it after js/plan-engine.js, before js/app.js).
 *
 * Shapes (R5-SPEC §1): Person {id?, kind: 'trainee'|'student', name, nickname, code, org, cohort, start, end,
 *   blocks: [{from, to, place}], extras: [{from, to, place, label}], note}; place ∈ PLACES.
 *
 * EXPORTS (window.TrainingEngine)
 *   PLACES                      ['ipd','er','portable','opd','us','or','cancer','other']
 *   IPD_PLACES                  ['ipd','er','portable'] (the IPD part of a rotation)
 *   PLACE_LABEL                 {place: 'IPD' | 'ER' | 'Portable' | 'OPD' | 'US' | 'OR' | 'Cancer center' | 'อื่นๆ'}
 *   STATION_OF                  {place: station id of วันนี้} — ipd, portable, er, us, or, cancer (opd / other: none)
 *   holidaySet(h) → Set<date>   h: string[] | {date}[] | Set | Map | {[date]: name}
 *   isWorkingDay(date, h) → bool  Mon–Fri, not a holiday
 *   workingDays(from, to, h) → date[]   the working days of [from, to] (inclusive; [] when invalid)
 *   placeOn(person, date) → place | ''   the extra covering the date, else the block covering it, else ''
 *   blockOn(person, date) → place | ''   the block only (picture A's cells: extras are footnotes)
 *   TRAINEE_ORDERS              the 6 station orders of a trainee's IPD part: the cyclic shifts of ipd → portable → er
 *                               first ([ipd,portable,er], [portable,er,ipd], [er,ipd,portable]), then those of ipd → er →
 *                               portable (index = the last tie-break)
 *   traineePeriods(start, n, unit = 'month' | 'block4w') → [{from, to}]   R6: the first n periods of a plan from `start`
 *       ('YYYY-MM-DD' used as is, 'YYYY-MM' = the 1st): 'month' → period k = addMonthsClamped(start, k) …
 *       addMonthsClamped(start, k + 1) − 1 day (16 Aug → 16 Aug–15 Sep, 16 Sep–15 Oct, …; a start on the 31st clamps to
 *       the month's end); 'block4w' → Monday-aligned 4-week blocks, the first starting on the date, each ending on the
 *       Friday of its 4th week. [] for a bad start.
 *   traineePlan({people, start, ipdMonths = 3, opdMonths = 3, holidays, existing, cohort?, unit = 'month', keepBefore?})
 *       → {people: [Person], start, end, choices: [{key, ipdFirst, order}], warnings: [{code, key?, text}]}
 *       periods from the start date (traineePeriods, no snapping to the 1st); the first ⌈n/2⌉ people (input order) IPD
 *       first, the others OPD first (a person's own boolean `ipdFirst` overrides that — "จัดใหม่" keeps the stored side);
 *       the IPD part = ipdMonths periods split into 3 contiguous parts (ipdMonths % 3 = 0 →
 *       ipdMonths / 3 whole periods each; else the IPD calendar range split into thirds by days, the larger parts first;
 *       0 → no IPD part); the OPD part = ONE 'opd' block of opdMonths periods. The station order of each person (input
 *       order) = the TRAINEE_ORDERS entry minimising, over the person's working days (Mon–Fri minus holidays, not covered
 *       by an own extra) of the IPD part, the histogram of (trainees already at that place that day) + 1 — the smaller
 *       maximum, then leximax, then the lower index. Counted: every trainee of `existing` (all cohorts; kind 'trainee')
 *       except the ones being (re)planned (same id, else same name) + the people already placed in this call; places ipd /
 *       er / portable (OPD is not constrained), where placeOn says they are (an extra elsewhere frees the station).
 *       Re-planned = an `existing` entry with the id of a planned person (by id only). keepBefore ('YYYY-MM-DD', for a
 *       person that has stored blocks): an IPD part starting before it keeps the stored place of its first day (blockOn) —
 *       only orders consistent with those parts are candidates; none consistent (or a started OPD part that was not OPD)
 *       → the best order anyway and a PAST_CHANGED warning "ช่วงที่ผ่านมาแล้วของ <ชื่อเล่น> จะเปลี่ยน".
 *       SHARED_STATION warning per person whose chosen order still shares a place on some working day. Extras inside
 *       the range are kept, partly overlapping ones clipped to it; every other field (id, nickname, code, note, version, baseVersion…) is carried over;
 *       kind 'trainee', org ''. BAD_START / NO_MONTHS → no people.
 *   traineeMonths(person) → {ipdMonths, opdMonths}   the month counts of a stored rotation (spans of the IPD / OPD blocks
 *       in months, rounded, 0–12, the total at most 13 = inside the 400-day limit; a person without blocks → 3 / 3) — "จัดใหม่" keeps them
 *   studentPlan({students, holidays, existing}) → {students: [Person], choices: [{key, ipdFirst, order}],
 *       warnings: [{code, key, text}]}
 *       per student (key = id, else name): the working days w of [start, end]; the first half ⌈w/2⌉ days and the second
 *       half; one half IPD, the other OPD; the IPD half split into three consecutive parts (sizes differ by ≤ 1, the larger
 *       first) for ipd / er / portable in one of the 6 orders (ORDERS). Deterministic greedy over the students sorted by
 *       (start, org, name, input index): for each of the 12 choices the count at the student's place on each of their
 *       working days (already scheduled students + `existing` students overlapping in time, the student included); the
 *       choice with the smallest maximum wins — then (refinement, see below) the fewest days at each count from the top
 *       down (leximax), then the side (IPD-first / OPD-first) that fewer students of the same start date took so far
 *       (ties: IPD-first) — so half a group starts IPD, half OPD — then the order's index in ORDERS. The leximax step only
 *       separates choices of equal maximum (e.g. two students of one group at the same IPD station while ER is empty).
 *       `existing`: kind 'student' only, never a student being scheduled (same id). Blocks are calendar ranges covering
 *       exactly the assigned working days (never starting or ending on a weekend / holiday). Fewer than 2 working days →
 *       a warning (FEW_DAYS; 0 days: NO_DAYS and no blocks).
 *   R6 — the shared group view (timeline + summary table) of both segments; periodRows / ipdOpdSummary (old pictures A / B)
 *   are gone:
 *   placeRanges(person) → {ipd: [[from, to]], er, portable, opd, us, or, cancer, other}   the blocks per place, sorted,
 *       touching ranges (next from = previous to + 1 day) merged
 *   groupSpan(people) → {from, to} | null   the earliest start … the latest end (blocks / extras included)
 *   monthTicks(from, to) → [{date, label, start?}]   the start (from, start: true) then the 1st of every month inside
 *       (from, to], label = Thai short month ("ต.ค.");
 *       January carries the Buddhist year's last two digits ("ม.ค. 70")
 *   spanPct(from, to, a, b) → {left, width}   the position of [a, b] (clamped) on the timeline of [from, to], in % of it
 *   rangeText(from, to, {year = true}) → "1–5 ธ.ค. 2569" · "29 พ.ย. – 3 ธ.ค. 2569" · "29 ธ.ค. 2569 – 2 ม.ค. 2570" ·
 *       "1 ธ.ค. 2569" (year false: without the years)
 *   extraNote(person, extra) → "*** 26–30 ต.ค. 2569 <shortName> ฝึก US" (R6: rangeText + nickname, else first name; the
 *       label, else "ฝึก <place>")
 *   firstName(name) → the first word · shortName(person) → nickname, else the first word of the name
 *   monthName(ym) → "ตุลาคม" · monthYear(ym) → "ตุลาคม 2569"
 *   The staff account of a trainee (trainees log in as "<first name>(Trainee)"):
 *   staffBase(staffName) → the name without a trailing "(…)", trimmed · hasTraineeTag(staffName) → ends in "(Trainee)"
 *   staffMatch(staffName, person, supervisor) → 3 full name exactly · 2 base = first name / nickname with "(Trainee)" · 1 the
 *       same without the tag · 0 no link; the Supervisor's plain name links only through the full name (or a "(Trainee)" tag)
 *   linkStaff(person, staffNames, supervisor, min = 1) → the best-matching staff name of score ≥ min | ''
 *   traineeLabel(person, staffNames, supervisor) → the trainee's own account (linkStaff min 2: the full name or a
 *       "(Trainee)" tag — never a colleague who only shares the first name), else "<first name>(Trainee)" (no space)
 *   stationTrainees({people, date, slots, staff, supervisor, absent}) → {[stationId]: [traineeLabel]} — 3.5.1: the names
 *       of the วันนี้ Station cards and the day picture; trainees only (STATION_OF of placeOn), leaving out one whose
 *       name already sits in ANY station's slots that day (the Supervisor's placement wins) and one whose account is
 *       absent (absent: the full-day leave names — string[] | Set | {[name]: …})
 * ===================================================================== */
(function (global) {
  'use strict';

  const PLACES = Object.freeze(['ipd', 'er', 'portable', 'opd', 'us', 'or', 'cancer', 'other']);
  const IPD_PLACES = Object.freeze(['ipd', 'er', 'portable']);
  const PLACE_LABEL = Object.freeze({ ipd: 'IPD', er: 'ER', portable: 'Portable', opd: 'OPD', us: 'US', or: 'OR', cancer: 'Cancer center', other: 'อื่นๆ' });
  const STATION_OF = Object.freeze({ ipd: 'ipd', portable: 'portable', er: 'er', us: 'us', or: 'or', cancer: 'cancer' });
  /** The trainee rotation of the IPD part (picture: IPD · Portable · ER, then Portable · ER · IPD). */
  const CYCLE = Object.freeze(['ipd', 'portable', 'er']);
  /** R6: the six station orders of a trainee's IPD part — the cyclic shifts of CYCLE first, then those of ipd → er → portable. */
  const TRAINEE_ORDERS = Object.freeze([
    ['ipd', 'portable', 'er'], ['portable', 'er', 'ipd'], ['er', 'ipd', 'portable'],
    ['ipd', 'er', 'portable'], ['er', 'portable', 'ipd'], ['portable', 'ipd', 'er']
  ].map(Object.freeze));
  /** The six station orders of a student's IPD half (index = the last tie-break). */
  const ORDERS = Object.freeze([
    ['ipd', 'er', 'portable'], ['ipd', 'portable', 'er'], ['er', 'ipd', 'portable'],
    ['er', 'portable', 'ipd'], ['portable', 'ipd', 'er'], ['portable', 'er', 'ipd']
  ].map(Object.freeze));
  const COUNTED = Object.freeze(['ipd', 'er', 'portable', 'opd']);   // the places studentPlan balances
  const MONTHS = Object.freeze(['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
    'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']);
  const MONTHS_SHORT = Object.freeze(['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']);
  const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const YM_RE = /^(\d{4})-(\d{2})$/;
  const DAY_MS = 86400000;
  const MAX_MONTHS = 13;   // 13 periods ≤ 397 days: inside the server's 400-day limit of a record

  /* ------------------------------------------------------------------ dates (UTC) */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isYmd(s) {
    const m = typeof s === 'string' ? YMD_RE.exec(s) : null;
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function toUtc(s) { const m = YMD_RE.exec(s); return Date.UTC(+m[1], +m[2] - 1, +m[3]); }
  function fromUtc(t) { const d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function addDays(s, n) { return fromUtc(toUtc(s) + n * DAY_MS); }
  function weekday(s) { return new Date(toUtc(s)).getUTCDay(); }
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }   // m: 1–12
  function monthStart(y, m) { const d = new Date(Date.UTC(y, m - 1, 1)); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-01'; }
  function addMonths(s, n) { return monthStart(+s.slice(0, 4), +s.slice(5, 7) + n); }   // → the 1st of the month n later
  /** The same day n months later, clamped to the target month's last day (2027-01-31 + 1 → 2027-02-28). */
  function addMonthsClamped(s, n) {
    const first = monthStart(+s.slice(0, 4), +s.slice(5, 7) + n);
    const y = +first.slice(0, 4), m = +first.slice(5, 7);
    return first.slice(0, 8) + pad2(Math.min(+s.slice(8), lastDay(y, m)));
  }
  function daysIn(from, to) { return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1; }
  function be(y) { return +y + 543; }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function isObj(v) { return !!v && typeof v === 'object'; }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /** h: string[] | {date}[] | Set | Map | {[date]: name} → Set of valid dates. */
  function holidaySet(h) {
    const out = new Set();
    if (!h) return out;
    const add = d => { if (isYmd(d)) out.add(d); };
    if (h instanceof Set) h.forEach(add);
    else if (h instanceof Map) h.forEach((v, k) => add(k));
    else if (Array.isArray(h)) h.forEach(x => add(isObj(x) ? x.date : x));
    else if (isObj(h)) Object.keys(h).forEach(add);
    return out;
  }
  function workingIn(date, set) { const w = weekday(date); return w !== 0 && w !== 6 && !set.has(date); }
  function isWorkingDay(date, h) { return isYmd(date) && workingIn(date, h instanceof Set ? h : holidaySet(h)); }
  function workingDays(from, to, h) {
    if (!isYmd(from) || !isYmd(to) || from > to) return [];
    const set = h instanceof Set ? h : holidaySet(h);
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (workingIn(d, set)) out.push(d);
    return out;
  }

  /* ------------------------------------------------------------------ texts */
  function monthName(ym) { const m = +String(ym).slice(5, 7); return MONTHS[m - 1] || ''; }
  function monthYear(ym) { return monthName(ym) + ' ' + be(String(ym).slice(0, 4)); }
  function dayShort(s, year) { return +s.slice(8) + ' ' + MONTHS_SHORT[+s.slice(5, 7) - 1] + (year ? ' ' + be(s.slice(0, 4)) : ''); }
  /** "1–5 ธ.ค. 2569" · "29 พ.ย. – 3 ธ.ค. 2569" · "29 ธ.ค. 2569 – 2 ม.ค. 2570" · "1 ธ.ค. 2569". */
  function rangeText(from, to, opts) {
    if (!isYmd(from) || !isYmd(to)) return '';
    const year = !(opts && opts.year === false);
    const yr = s => (year ? ' ' + be(s.slice(0, 4)) : '');
    if (from === to) return dayShort(from, year);
    if (from.slice(0, 7) === to.slice(0, 7)) return +from.slice(8) + '–' + +to.slice(8) + ' ' + MONTHS_SHORT[+from.slice(5, 7) - 1] + yr(from);
    if (from.slice(0, 4) === to.slice(0, 4)) return dayShort(from, false) + ' – ' + dayShort(to, false) + yr(from);
    return dayShort(from, year) + ' – ' + dayShort(to, year);
  }
  function firstName(name) { return str(name).trim().split(/\s+/)[0] || ''; }

  /* ------------------------------------------------------------------ the staff account of a trainee (R5 lead note) */
  const TAG_RE = /\s*\([^()]*\)\s*$/;
  const TRAINEE_TAG_RE = /\(\s*trainee\s*\)\s*$/i;
  /** A staff name without a trailing "(…)" tag, trimmed: "<first name>(Trainee)" → "<first name>". */
  function staffBase(staffName) { return str(staffName).replace(TAG_RE, '').trim(); }
  function hasTraineeTag(staffName) { return TRAINEE_TAG_RE.test(str(staffName)); }
  /**
   * How well a staff name matches a training record: 3 = the full name exactly, 2 = base (tag removed) equals the first name or
   * the nickname AND the staff name carries "(Trainee)", 1 = the same without the tag, 0 = no link. The Supervisor's own name
   * (`supervisor`) links only through the full name or a "(Trainee)" tag (a trainee who shares the Supervisor's first name is
   * never the Supervisor).
   */
  function staffMatch(staffName, person, supervisor) {
    const s = str(staffName).trim();
    if (!s || !isObj(person)) return 0;
    const full = str(person.name).trim();
    if (full && s === full) return 3;
    const tagged = hasTraineeTag(s);
    if (supervisor && s === str(supervisor).trim() && !tagged) return 0;
    const base = staffBase(s);
    const nick = str(person.nickname).trim();
    if (!base || !(base === firstName(full) || (nick && base === nick))) return 0;
    return tagged ? 2 : 1;
  }
  /** The staff account linked to a training record: the best staffMatch of at least `min` (default 1) among staffNames
   *  (first one on a tie), else ''. */
  function linkStaff(person, staffNames, supervisor, min) {
    const floor = min === 2 || min === 3 ? min : 1;
    let best = '', score = 0;
    (Array.isArray(staffNames) ? staffNames : []).forEach(n => {
      const sc = staffMatch(n, person, supervisor);
      if (sc >= floor && sc > score) { score = sc; best = str(n).trim(); }
    });
    return best;
  }
  /** 3.5.1: the name a trainee goes by on วันนี้ and in the day picture — the own account (the full name or a "(Trainee)"
   *  tag), else "<first name>(Trainee)" like the owner's accounts. */
  function traineeLabel(person, staffNames, supervisor) {
    const acct = linkStaff(person, staffNames, supervisor, 2);
    if (acct) return acct;
    const first = firstName(isObj(person) ? person.name : '');
    return first ? first + '(Trainee)' : '';
  }
  /** A name set from string[] | Set | Map | {[name]: …}. */
  function nameSet(v) {
    const out = new Set();
    const add = n => { const t = str(n).trim(); if (t) out.add(t); };
    if (v instanceof Set) v.forEach(add);
    else if (v instanceof Map) v.forEach((x, k) => add(k));
    else if (Array.isArray(v)) v.forEach(add);
    else if (isObj(v)) Object.keys(v).forEach(add);
    return out;
  }
  /**
   * 3.5.1: the trainee names of one date inside their Station (วันนี้ cards, the day picture): {[stationId]: [traineeLabel]}
   * for the trainees (never students) at each station, leaving out a trainee whose name (the own account, else the label)
   * already sits in ANY station's slots ({[stationId]: [names]}) that day, and one whose name is absent (full-day leave).
   * o: {people, date, slots, staff: [staff names], supervisor, absent}. The caller decides whether the date is a working day.
   */
  function stationTrainees(o) {
    const x = isObj(o) ? o : {};
    const out = {};
    if (!isYmd(x.date)) return out;
    const placed = new Set();
    if (isObj(x.slots)) Object.keys(x.slots).forEach(k => { if (Array.isArray(x.slots[k])) x.slots[k].forEach(n => { if (str(n)) placed.add(str(n).trim()); }); });
    const absent = nameSet(x.absent);
    (Array.isArray(x.people) ? x.people : []).forEach(p => {
      if (!isObj(p) || p.kind !== 'trainee') return;
      const st = STATION_OF[placeOn(p, x.date)];
      if (!st) return;
      const name = traineeLabel(p, x.staff, x.supervisor);
      if (!name || placed.has(name) || absent.has(name)) return;
      (out[st] || (out[st] = [])).push(name);
    });
    return out;
  }
  function shortName(p) { const n = isObj(p) ? str(p.nickname).trim() : ''; return n || firstName(isObj(p) ? p.name : ''); }
  /** R6: "*** 26–30 ต.ค. 2569 <nickname | first name> ฝึก US" (the label, else "ฝึก <place>"). */
  function extraNote(person, x) {
    if (!isObj(x) || !isYmd(x.from) || !isYmd(x.to)) return '';
    const what = str(x.label).trim() || 'ฝึก ' + (PLACE_LABEL[x.place] || '');
    return '*** ' + rangeText(x.from, x.to) + ' ' + shortName(person) + ' ' + what;
  }

  /* ------------------------------------------------------------------ where is a person */
  function covering(list, date) {
    const a = Array.isArray(list) ? list : [];
    for (let i = 0; i < a.length; i++) {
      const b = a[i];
      if (isObj(b) && typeof b.from === 'string' && typeof b.to === 'string' && b.from <= date && date <= b.to && PLACES.indexOf(b.place) >= 0) return b.place;
    }
    return '';
  }
  function placeOn(person, date) {
    if (!isObj(person) || !isYmd(date)) return '';
    return covering(person.extras, date) || covering(person.blocks, date);
  }
  function blockOn(person, date) { return isObj(person) && isYmd(date) ? covering(person.blocks, date) : ''; }

  /* ------------------------------------------------------------------ trainees (R6-SPEC §3.1) */
  function intIn(v, lo, hi, dflt) { const n = parseInt(v, 10); return isFinite(n) && n >= lo && n <= hi ? n : dflt; }
  function startOf(v) { let s = str(v); if (YM_RE.test(s)) s += '-01'; return isYmd(s) ? s : ''; }
  /** The k-th period of a plan from s ('month' from the start date, or Monday-aligned 4-week blocks). */
  function periodFn(s, unit) {
    if (unit === 'block4w') {
      const mon = addDays(s, -((weekday(s) + 6) % 7));
      return k => ({ from: k === 0 ? s : addDays(mon, 28 * k), to: addDays(mon, 28 * k + 25) });
    }
    return k => ({ from: addMonthsClamped(s, k), to: addDays(addMonthsClamped(s, k + 1), -1) });
  }
  function traineePeriods(start, n, unit) {
    const s = startOf(start);
    const cnt = intIn(n, 0, 60, 0);
    if (!s) return [];
    const f = periodFn(s, unit === 'block4w' ? 'block4w' : 'month');
    const out = [];
    for (let k = 0; k < cnt; k++) out.push(f(k));
    return out;
  }
  /** The IPD part [from, to] split into 3 contiguous parts: whole periods when n % 3 = 0, else thirds by calendar days. */
  function ipdParts(period, at, n) {
    if (n <= 0) return [];
    if (n % 3 === 0) {
      const q = n / 3;
      return [0, 1, 2].map(j => ({ from: period(at + j * q).from, to: period(at + j * q + q - 1).to }));
    }
    const from = period(at).from, to = period(at + n - 1).to;
    const sz = thirds(daysIn(from, to));
    const out = [];
    let d = from;
    sz.forEach(len => { out.push({ from: d, to: addDays(d, len - 1) }); d = addDays(d, len); });
    return out;
  }
  function personKey(p, i) { return str(p.id) || str(p.name).trim() || '#' + i; }
  function traineePlan(input) {
    const o = isObj(input) ? input : {};
    const people = (Array.isArray(o.people) ? o.people : []).filter(p => isObj(p) && str(p.name).trim());
    const ipdN = intIn(o.ipdMonths, 0, 12, 3), opdN = intIn(o.opdMonths, 0, 12, 3);
    const unit = o.unit === 'block4w' ? 'block4w' : 'month';
    const fail = (code, text) => ({ people: [], start: '', end: '', choices: [], warnings: [{ code, text }] });
    const s = startOf(o.start);
    if (!s) return fail('BAD_START', 'วันเริ่มไม่ถูกต้อง');
    if (ipdN + opdN === 0) {
      const who = people.map(p => shortName(p)).filter(Boolean).join(', ');
      return fail('NO_MONTHS', (who ? who + ': ' : '') + 'จำนวนเดือน IPD + OPD ต้องมากกว่า 0');
    }
    const keep = isYmd(o.keepBefore) ? o.keepBefore : '';
    const hs = holidaySet(o.holidays);
    const period = periodFn(s, unit);
    const range = { from: period(0).from, to: period(ipdN + opdN - 1).to };
    const warnings = [];
    // count[place][date]: trainees at that IPD station that day (existing ones of every cohort, then the placed ones)
    const count = Object.create(null);
    IPD_PLACES.forEach(p => { count[p] = Object.create(null); });
    const ids = new Set(people.map(p => str(p.id)).filter(Boolean));
    const countPerson = p => {
      (Array.isArray(p.blocks) ? p.blocks : []).forEach(b => {
        if (!isObj(b) || !isYmd(b.from) || !isYmd(b.to) || IPD_PLACES.indexOf(b.place) < 0) return;
        workingDays(b.from, b.to, hs).forEach(d => { if (placeOn(p, d) === b.place) count[b.place][d] = (count[b.place][d] || 0) + 1; });
      });
    };
    (Array.isArray(o.existing) ? o.existing : []).forEach(p => {
      if (!isObj(p) || p.kind !== 'trainee') return;
      if (str(p.id) && ids.has(str(p.id))) return;   // R6 fix L5: by id only
      countPerson(p);
    });
    const half = Math.ceil(people.length / 2);
    const choices = [];
    const out = people.map((p, idx) => {
      const key = personKey(p, idx);
      const ipdFirst = typeof p.ipdFirst === 'boolean' ? p.ipdFirst : idx < half;   // R6 fix H1: a stored side wins
      const ipdAt = ipdFirst ? 0 : opdN, opdAt = ipdFirst ? ipdN : 0;
      const parts = ipdParts(period, ipdAt, ipdN);
      // R6 fix L6: extras partly outside the range are clipped to it (no overlap → dropped)
      const extras = (Array.isArray(p.extras) ? clone(p.extras) : []).filter(x => isObj(x) && isYmd(x.from) && isYmd(x.to) && x.from <= x.to && x.from <= range.to && x.to >= range.from)
        .map(x => Object.assign(x, { from: x.from < range.from ? range.from : x.from, to: x.to > range.to ? range.to : x.to }));
      // R6 fix M2: the IPD parts that started before keepBefore keep the stored place of their first day (blockOn)
      const stored = keep && Array.isArray(p.blocks) && p.blocks.length;
      const fixed = stored ? parts.map(pt => (pt.from < keep ? blockOn(p, pt.from) : null)) : parts.map(() => null);
      const opdFrom = opdN ? period(opdAt).from : '';
      let pastChanged = !!(stored && opdFrom && opdFrom < keep && blockOn(p, opdFrom) !== 'opd');
      // the person's working days of each IPD part (not covered by an own extra)
      const partDays = parts.map(pt => workingDays(pt.from, pt.to, hs).filter(d => !covering(extras, d)));
      let best = null;
      if (parts.length) {
        const all = TRAINEE_ORDERS.map((order, oi) => {
          const hist = [];
          partDays.forEach((days, j) => days.forEach(d => { const c = (count[order[j]][d] || 0) + 1; hist[c] = (hist[c] || 0) + 1; }));
          return { oi, hist, max: Math.max(0, hist.length - 1), pref: 0, ok: fixed.every((f, j) => f === null || f === order[j]) };
        });
        let pool = all.filter(c => c.ok);
        if (!pool.length) { pool = all; pastChanged = true; }
        pool.forEach(cand => { if (!best || better(cand, best)) best = cand; });
      }
      const oi = best ? best.oi : 0;
      const order = TRAINEE_ORDERS[oi];
      const ipd = parts.map((pt, j) => ({ from: pt.from, to: pt.to, place: order[j] }));
      const opd = opdN ? [{ from: period(opdAt).from, to: period(opdAt + opdN - 1).to, place: 'opd' }] : [];
      const blocks = ipdFirst ? ipd.concat(opd) : opd.concat(ipd);
      const person = Object.assign(clone(p), {
        kind: 'trainee',
        name: str(p.name).trim(),
        nickname: str(p.nickname).trim(),
        code: str(p.code).trim(),
        org: '',
        cohort: str(o.cohort !== undefined ? o.cohort : p.cohort).trim(),
        start: range.from, end: range.to,
        blocks,
        extras,
        note: str(p.note)
      });
      delete person.ipdFirst;
      if (best && best.max > 1) {
        warnings.push({ code: 'SHARED_STATION', key, text: (shortName(person) || 'เทคใหม่') + ': บางวันอยู่ Station เดียวกับเทคใหม่คนอื่น (เลี่ยงไม่ได้)' });
      }
      if (pastChanged) warnings.push({ code: 'PAST_CHANGED', key, text: 'ช่วงที่ผ่านมาแล้วของ ' + (shortName(person) || 'เทคใหม่') + ' จะเปลี่ยน' });
      countPerson(person);
      choices.push({ key, ipdFirst, order: order.slice() });
      return person;
    });
    return { people: out, start: range.from, end: range.to, choices, warnings };
  }
  /** The month counts of a stored rotation: the spans of its IPD and OPD blocks in months (rounded, 0–12). */
  function traineeMonths(person) {
    const blocks = isObj(person) && Array.isArray(person.blocks) ? person.blocks.filter(b => isObj(b) && isYmd(b.from) && isYmd(b.to) && b.from <= b.to) : [];
    if (!blocks.length) return { ipdMonths: 3, opdMonths: 3 };
    const months = test => {
      let from = '', to = '';
      blocks.forEach(b => { if (!test(b.place)) return; if (!from || b.from < from) from = b.from; if (!to || b.to > to) to = b.to; });
      return from ? Math.max(0, Math.min(12, Math.round(daysIn(from, to) / 30.44))) : 0;
    };
    let ipd = months(p => IPD_PLACES.indexOf(p) >= 0), opd = months(p => p === 'opd');
    while (ipd + opd > MAX_MONTHS) { if (ipd >= opd) ipd--; else opd--; }   // R6 fix M3: stays within 400 days
    return { ipdMonths: ipd, opdMonths: opd };
  }

  /* ------------------------------------------------------------------ students */
  /** Sizes of three consecutive parts of n days (differ by ≤ 1, the larger first). */
  function thirds(n) { const q = Math.floor(n / 3), r = n % 3; return [q + (r > 0 ? 1 : 0), q + (r > 1 ? 1 : 0), q]; }
  /** The place of each working day for one choice. */
  function assign(days, ipdFirst, order) {
    const first = Math.ceil(days.length / 2);
    const ipdDays = ipdFirst ? days.slice(0, first) : days.slice(first);
    const sz = thirds(ipdDays.length);
    const places = [];
    let k = 0;
    const ipdPlaces = [];
    for (let part = 0; part < 3; part++) for (let x = 0; x < sz[part]; x++) ipdPlaces.push(order[part]);
    days.forEach((d, i) => {
      const inIpd = ipdFirst ? i < first : i >= first;
      places.push(inIpd ? ipdPlaces[k++] : 'opd');
    });
    return places;
  }
  /** Consecutive working days with the same place → calendar blocks [{from, to, place}]. */
  function blocksOf(days, places) {
    const out = [];
    days.forEach((d, i) => {
      const last = out[out.length - 1];
      if (last && last.place === places[i] && places[i - 1] === places[i]) last.to = d;
      else out.push({ from: d, to: d, place: places[i] });
    });
    return out;
  }
  function studentKey(s, i) { return str(s.id) || str(s.name).trim() || '#' + i; }
  function studentPlan(input) {
    const o = isObj(input) ? input : {};
    const hs = holidaySet(o.holidays);
    const list = (Array.isArray(o.students) ? o.students : []).map((s, i) => ({ s: isObj(s) ? s : {}, i }));
    const ids = new Set(list.map(x => str(x.s.id)).filter(Boolean));
    const warnings = [];
    // count[place][date]: students at that place that day (existing ones first)
    const count = Object.create(null);
    COUNTED.forEach(p => { count[p] = Object.create(null); });
    const bump = (place, date) => { if (count[place]) count[place][date] = (count[place][date] || 0) + 1; };
    (Array.isArray(o.existing) ? o.existing : []).forEach(p => {
      if (!isObj(p) || p.kind !== 'student' || (p.id && ids.has(p.id))) return;
      (Array.isArray(p.blocks) ? p.blocks : []).forEach(b => {
        if (!isObj(b) || !isYmd(b.from) || !isYmd(b.to) || COUNTED.indexOf(b.place) < 0) return;
        workingDays(b.from, b.to, hs).forEach(d => { if (placeOn(p, d) === b.place) bump(b.place, d); });
      });
    });
    const sorted = list.slice().sort((a, b) => cmp(str(a.s.start), str(b.s.start)) || cmp(str(a.s.org), str(b.s.org)) ||
      cmp(str(a.s.name), str(b.s.name)) || a.i - b.i);
    const sideCount = Object.create(null);   // start date → [IPD-first count, OPD-first count]
    const result = new Array(list.length);
    const choices = new Array(list.length);
    sorted.forEach(({ s, i }) => {
      const key = studentKey(s, i);
      const start = str(s.start), end = str(s.end);
      const days = workingDays(start, end, hs);
      const base = Object.assign(clone(s), { kind: 'student', name: str(s.name).trim(), start, end, extras: Array.isArray(s.extras) ? clone(s.extras) : [] });
      if (!days.length) {
        warnings.push({ code: 'NO_DAYS', key, text: (base.name || 'นักศึกษา') + ': ไม่มีวันทำการในช่วงที่เลือก' });
        base.blocks = [];
        result[i] = base;
        choices[i] = { key, ipdFirst: true, order: ORDERS[0].slice() };
        return;
      }
      if (days.length < 2) warnings.push({ code: 'FEW_DAYS', key, text: (base.name || 'นักศึกษา') + ': มีวันทำการน้อยกว่า 2 วัน — แบ่ง IPD/OPD ได้ไม่ครบ' });
      const sides = sideCount[start] || (sideCount[start] = [0, 0]);
      const prefIpd = sides[0] <= sides[1];
      let best = null;
      [true, false].forEach(ipdFirst => {
        ORDERS.forEach((order, oi) => {
          const places = assign(days, ipdFirst, order);
          const counts = days.map((d, k) => (count[places[k]][d] || 0) + 1);
          const hist = [];
          counts.forEach(c => { hist[c] = (hist[c] || 0) + 1; });
          const cand = { ipdFirst, oi, places, hist, max: hist.length - 1, pref: ipdFirst === prefIpd ? 0 : 1 };
          if (!best || better(cand, best)) best = cand;
        });
      });
      best.places.forEach((pl, k) => bump(pl, days[k]));
      sides[best.ipdFirst ? 0 : 1]++;
      base.blocks = blocksOf(days, best.places);
      result[i] = base;
      choices[i] = { key, ipdFirst: best.ipdFirst, order: ORDERS[best.oi].slice() };
    });
    return { students: result, choices, warnings };
  }
  /** a better than b: smaller maximum, then fewer days at each count from the top (leximax), then the preferred side, then
   *  the order index (IPD-first before OPD-first only through the side preference). */
  function better(a, b) {
    if (a.max !== b.max) return a.max < b.max;
    for (let c = a.max; c >= 1; c--) {
      const x = a.hist[c] || 0, y = b.hist[c] || 0;
      if (x !== y) return x < y;
    }
    if (a.pref !== b.pref) return a.pref < b.pref;
    return a.oi < b.oi;
  }

  /* ------------------------------------------------------------------ the group view (R6-SPEC §3.2) */
  /** {place: [[from, to]]} — the blocks per place, sorted, touching ranges merged. */
  function placeRanges(person) {
    const out = {};
    PLACES.forEach(p => { out[p] = []; });
    const blocks = (isObj(person) && Array.isArray(person.blocks) ? person.blocks : [])
      .filter(b => isObj(b) && isYmd(b.from) && isYmd(b.to) && b.from <= b.to && PLACES.indexOf(b.place) >= 0)
      .slice().sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
    blocks.forEach(b => {
      const list = out[b.place];
      const last = list[list.length - 1];
      if (last && addDays(last[1], 1) >= b.from) { if (b.to > last[1]) last[1] = b.to; } else list.push([b.from, b.to]);
    });
    return out;
  }
  /** The earliest start … the latest end of a group (blocks and extras included); null when nothing is dated. */
  function groupSpan(people) {
    let from = '', to = '';
    const take = (a, b) => { if (isYmd(a) && isYmd(b) && a <= b) { if (!from || a < from) from = a; if (!to || b > to) to = b; } };
    (Array.isArray(people) ? people : []).forEach(p => {
      if (!isObj(p)) return;
      take(p.start, p.end);
      [p.blocks, p.extras].forEach(list => (Array.isArray(list) ? list : []).forEach(b => { if (isObj(b)) take(b.from, b.to); }));
    });
    return from ? { from, to } : null;
  }
  /** The 1st of every month inside (from, to] with its Thai short label (January with the year: "ม.ค. 70"). */
  function monthTicks(from, to) {
    if (!isYmd(from) || !isYmd(to) || from > to) return [];
    const lab = d => { const m = +d.slice(5, 7); return MONTHS_SHORT[m - 1] + (m === 1 ? ' ' + String(be(d.slice(0, 4))).slice(2) : ''); };
    const out = [{ date: from, label: lab(from), start: true }];   // R6 fix L8: the start month at the left edge
    for (let d = addMonths(from, 1); d <= to; d = addMonths(d, 1)) {
      const m = +d.slice(5, 7);
      out.push({ date: d, label: MONTHS_SHORT[m - 1] + (m === 1 ? ' ' + String(be(d.slice(0, 4))).slice(2) : '') });
    }
    return out;
  }
  /** Where [a, b] sits on the timeline of [from, to]: {left, width} in % (clamped to the timeline). */
  function spanPct(from, to, a, b) {
    if (!isYmd(from) || !isYmd(to) || !isYmd(a) || !isYmd(b) || from > to) return { left: 0, width: 0 };
    const total = daysIn(from, to);
    const x = a < from ? from : a, y = b > to ? to : b;
    if (x > y) return { left: 0, width: 0 };
    const r = v => Math.round(v * 1000) / 1000;
    return { left: r((daysIn(from, x) - 1) / total * 100), width: r(daysIn(x, y) / total * 100) };
  }

  global.TrainingEngine = Object.freeze({
    PLACES, IPD_PLACES, PLACE_LABEL, STATION_OF, CYCLE, ORDERS, TRAINEE_ORDERS,
    holidaySet, isWorkingDay, workingDays, placeOn, blockOn,
    traineePeriods, traineePlan, traineeMonths, studentPlan,
    placeRanges, groupSpan, monthTicks, spanPct,
    rangeText, extraNote, firstName, shortName, monthName, monthYear,
    staffBase, hasTraineeTag, staffMatch, linkStaff, traineeLabel, stationTrainees
  });
})(typeof window !== 'undefined' ? window : globalThis);
