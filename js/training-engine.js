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
 *   traineePlan({people, start, ipdMonths = 3, opdMonths = 3, unit = 'month' | 'block4w', cohort?})
 *       → {people: [Person], warnings: [{code, text}]}
 *       the first ⌈n/2⌉ people IPD first, the others OPD first; the IPD part = ipdMonths blocks (calendar months, or for
 *       'block4w' Monday-aligned 4-week blocks from the start date, each ending on the Friday of its 4th week) with the
 *       stations ipd → portable → er rotated by the person's index within the group (block j of person i = CYCLE[(i + j)
 *       % 3]); the OPD part = ONE 'opd' block of opdMonths months (or 4·opdMonths weeks). start / end = the plan's range.
 *       Every other field of an input person (id, nickname, code, cohort, extras, note, version…) is carried over.
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
 *   periodRows(people) → {monthly: bool, rows: [{from, to, label, places: [place | '' per person]}]}
 *       picture A: the elementary periods of the people's blocks (every block boundary splits the timeline; a period no
 *       block covers is left out); monthly when every period is one whole calendar month → labels "ตุลาคม (2569)", else
 *       "16 พฤศจิกายน 2569 - 11 ธันวาคม 2569"
 *   ipdOpdSummary(person) → {ipd: text, opd: text, ipdRange: {from, to} | null, opdRange}
 *       picture B: the span of the IPD blocks (ipd / er / portable) and of the OPD blocks as month text ("ตุลาคม-ธันวาคม
 *       2569"; one month "ตุลาคม 2569"; across years "พฤศจิกายน 2569-กุมภาพันธ์ 2570"); a span not on whole months →
 *       day text "16 พ.ย. 2569 - 16 ก.พ. 2570"; '' when there is no such block
 *   rangeText(from, to, {year = true}) → "1–5 ธ.ค. 2569" · "29 พ.ย. – 3 ธ.ค. 2569" · "29 ธ.ค. 2569 – 2 ม.ค. 2570" ·
 *       "1 ธ.ค. 2569" (year false: without the years)
 *   extraNote(person, extra) → "***(26-30 ต.ค.) <first name> ฝึก US" (first word of the name; label, else "ฝึก <place>")
 *   firstName(name) → the first word · shortName(person) → nickname, else the first word of the name
 *   monthName(ym) → "ตุลาคม" · monthYear(ym) → "ตุลาคม 2569"
 *   The staff account of a trainee (trainees log in as "<first name>(Trainee)"):
 *   staffBase(staffName) → the name without a trailing "(…)", trimmed · hasTraineeTag(staffName) → ends in "(Trainee)"
 *   staffMatch(staffName, person, supervisor) → 3 full name exactly · 2 base = first name / nickname with "(Trainee)" · 1 the
 *       same without the tag · 0 no link; the Supervisor's plain name links only through the full name (or a "(Trainee)" tag)
 *   linkStaff(person, staffNames, supervisor) → the best-matching staff name | ''
 *   stationTrainees({people, date, slots, staff, supervisor}) → {[stationId]: [shortName]} — trainees only (STATION_OF of
 *       placeOn), leaving out one whose linked account already sits in that station's slots that day
 * ===================================================================== */
(function (global) {
  'use strict';

  const PLACES = Object.freeze(['ipd', 'er', 'portable', 'opd', 'us', 'or', 'cancer', 'other']);
  const IPD_PLACES = Object.freeze(['ipd', 'er', 'portable']);
  const PLACE_LABEL = Object.freeze({ ipd: 'IPD', er: 'ER', portable: 'Portable', opd: 'OPD', us: 'US', or: 'OR', cancer: 'Cancer center', other: 'อื่นๆ' });
  const STATION_OF = Object.freeze({ ipd: 'ipd', portable: 'portable', er: 'er', us: 'us', or: 'or', cancer: 'cancer' });
  /** The trainee rotation of the IPD part (picture: IPD · Portable · ER, then Portable · ER · IPD). */
  const CYCLE = Object.freeze(['ipd', 'portable', 'er']);
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
  function monthEnd(s) { const y = +s.slice(0, 4), m = +s.slice(5, 7); return s.slice(0, 8) + pad2(lastDay(y, m)); }
  function addMonths(s, n) { const y = +s.slice(0, 4), m = +s.slice(5, 7); return monthStart(y, m + n); }   // → the 1st
  function isMonthStart(s) { return s.slice(8) === '01'; }
  function isMonthEnd(s) { return s === monthEnd(s); }
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
  function dayLong(s) { return +s.slice(8) + ' ' + MONTHS[+s.slice(5, 7) - 1] + ' ' + be(s.slice(0, 4)); }
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
  /** Picture B: a span as month text, else day text. */
  function spanText(from, to) {
    if (isMonthStart(from) && isMonthEnd(to)) {
      const y1 = from.slice(0, 4), y2 = to.slice(0, 4);
      if (from.slice(0, 7) === to.slice(0, 7)) return monthName(from) + ' ' + be(y1);
      return y1 === y2 ? monthName(from) + '-' + monthName(to) + ' ' + be(y1) : monthName(from) + ' ' + be(y1) + '-' + monthName(to) + ' ' + be(y2);
    }
    return dayShort(from, true) + ' - ' + dayShort(to, true);
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
  /** The staff account linked to a training record: the best staffMatch among staffNames (first one on a tie), else ''. */
  function linkStaff(person, staffNames, supervisor) {
    let best = '', score = 0;
    (Array.isArray(staffNames) ? staffNames : []).forEach(n => {
      const sc = staffMatch(n, person, supervisor);
      if (sc > score) { score = sc; best = str(n).trim(); }
    });
    return best;
  }
  /**
   * The วันนี้ "ฝึกงาน" names of one date: {[stationId]: [shortName]} for the trainees (never students) at each station, leaving
   * out a trainee whose linked staff account is already in that station's slots ({[stationId]: [names]}) that day.
   * o: {people, date, slots, staff: [staff names], supervisor}. The caller decides whether the date is a working day.
   */
  function stationTrainees(o) {
    const x = isObj(o) ? o : {};
    const out = {};
    if (!isYmd(x.date)) return out;
    const slots = isObj(x.slots) ? x.slots : {};
    (Array.isArray(x.people) ? x.people : []).forEach(p => {
      if (!isObj(p) || p.kind !== 'trainee') return;
      const st = STATION_OF[placeOn(p, x.date)];
      if (!st) return;
      const acct = linkStaff(p, x.staff, x.supervisor);
      if (acct && Array.isArray(slots[st]) && slots[st].indexOf(acct) >= 0) return;
      (out[st] || (out[st] = [])).push(shortName(p));
    });
    return out;
  }
  function shortName(p) { const n = isObj(p) ? str(p.nickname).trim() : ''; return n || firstName(isObj(p) ? p.name : ''); }
  /** "***(26-30 ต.ค.) <first name> ฝึก US" (one day: "(26 ต.ค.)"; across months "(28 ต.ค.-3 พ.ย.)"). */
  function extraNote(person, x) {
    if (!isObj(x) || !isYmd(x.from) || !isYmd(x.to)) return '';
    const when = x.from === x.to ? dayShort(x.from, false)
      : x.from.slice(0, 7) === x.to.slice(0, 7) ? +x.from.slice(8) + '-' + +x.to.slice(8) + ' ' + MONTHS_SHORT[+x.from.slice(5, 7) - 1]
        : dayShort(x.from, false) + '-' + dayShort(x.to, false);
    const what = str(x.label).trim() || 'ฝึก ' + (PLACE_LABEL[x.place] || '');
    return '***(' + when + ') ' + firstName(isObj(person) ? person.name : '') + ' ' + what;
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

  /* ------------------------------------------------------------------ trainees */
  function intIn(v, lo, hi, dflt) { const n = parseInt(v, 10); return isFinite(n) && n >= lo && n <= hi ? n : dflt; }
  function traineePlan(input) {
    const o = isObj(input) ? input : {};
    const people = (Array.isArray(o.people) ? o.people : []).filter(p => isObj(p) && str(p.name).trim());
    const ipdN = intIn(o.ipdMonths, 0, 12, 3), opdN = intIn(o.opdMonths, 0, 12, 3);
    const unit = o.unit === 'block4w' ? 'block4w' : 'month';
    const warnings = [];
    let s = str(o.start);
    if (YM_RE.test(s)) s += '-01';
    if (!isYmd(s)) return { people: [], warnings: [{ code: 'BAD_START', text: 'วันเริ่มไม่ถูกต้อง' }] };
    if (ipdN + opdN === 0) return { people: [], warnings: [{ code: 'NO_MONTHS', text: 'จำนวนเดือนต้องมากกว่า 0' }] };
    // the k-th period of the plan: a calendar month, or a 4-week block (Monday-aligned, ending on the 4th Friday)
    let period;
    if (unit === 'month') {
      const first = s.slice(0, 8) + '01';
      period = k => ({ from: addMonths(first, k), to: monthEnd(addMonths(first, k)) });
    } else {
      const mon = addDays(s, -((weekday(s) + 6) % 7));
      period = k => ({ from: k === 0 ? s : addDays(mon, 28 * k), to: addDays(mon, 28 * k + 25) });
    }
    const span = (a, n) => ({ from: period(a).from, to: period(a + n - 1).to });
    const half = Math.ceil(people.length / 2);
    if (half > CYCLE.length || people.length - half > CYCLE.length) {
      warnings.push({ code: 'SHARED_STATION', text: 'กลุ่มละมากกว่า 3 คน — บางช่วงจะมีมากกว่า 1 คนต่อ Station' });
    }
    const total = ipdN + opdN;
    const out = people.map((p, idx) => {
      const ipdFirst = idx < half;
      const i = ipdFirst ? idx : idx - half;
      const blocks = [];
      const ipdAt = ipdFirst ? 0 : opdN;
      const opdAt = ipdFirst ? ipdN : 0;
      const ipd = [];
      for (let j = 0; j < ipdN; j++) { const pr = period(ipdAt + j); ipd.push({ from: pr.from, to: pr.to, place: CYCLE[(i + j) % CYCLE.length] }); }
      const opd = opdN ? [Object.assign(span(opdAt, opdN), { place: 'opd' })] : [];
      (ipdFirst ? ipd.concat(opd) : opd.concat(ipd)).forEach(b => blocks.push(b));
      const r = { from: period(0).from, to: period(total - 1).to };
      const base = clone(p);
      return Object.assign(base, {
        kind: 'trainee',
        name: str(p.name).trim(),
        nickname: str(p.nickname).trim(),
        code: str(p.code).trim(),
        org: '',
        cohort: str(o.cohort !== undefined ? o.cohort : p.cohort).trim(),
        start: r.from, end: r.to,
        blocks,
        extras: Array.isArray(p.extras) ? clone(p.extras).filter(x => isObj(x) && isYmd(x.from) && isYmd(x.to) && x.from >= r.from && x.to <= r.to) : [],
        note: str(p.note)
      });
    });
    return { people: out, warnings };
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

  /* ------------------------------------------------------------------ pictures */
  function periodRows(people) {
    const list = (Array.isArray(people) ? people : []).filter(isObj);
    const cuts = new Set();
    list.forEach(p => (Array.isArray(p.blocks) ? p.blocks : []).forEach(b => {
      if (isObj(b) && isYmd(b.from) && isYmd(b.to) && b.from <= b.to) { cuts.add(b.from); cuts.add(addDays(b.to, 1)); }
    }));
    const pts = Array.from(cuts).sort();
    const rows = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const from = pts[k], to = addDays(pts[k + 1], -1);
      const places = list.map(p => blockOn(p, from));
      if (places.some(Boolean)) rows.push({ from, to, label: '', places });
    }
    const monthly = rows.length > 0 && rows.every(r => isMonthStart(r.from) && r.to === monthEnd(r.from));
    rows.forEach(r => {
      r.label = monthly ? monthName(r.from) + ' (' + be(r.from.slice(0, 4)) + ')' : dayLong(r.from) + ' - ' + dayLong(r.to);
    });
    return { monthly, rows };
  }
  function spanOf(blocks, test) {
    let from = '', to = '';
    (Array.isArray(blocks) ? blocks : []).forEach(b => {
      if (!isObj(b) || !isYmd(b.from) || !isYmd(b.to) || !test(b.place)) return;
      if (!from || b.from < from) from = b.from;
      if (!to || b.to > to) to = b.to;
    });
    return from ? { from, to } : null;
  }
  function ipdOpdSummary(person) {
    const blocks = isObj(person) ? person.blocks : null;
    const ipdRange = spanOf(blocks, p => IPD_PLACES.indexOf(p) >= 0);
    const opdRange = spanOf(blocks, p => p === 'opd');
    return {
      ipd: ipdRange ? spanText(ipdRange.from, ipdRange.to) : '',
      opd: opdRange ? spanText(opdRange.from, opdRange.to) : '',
      ipdRange, opdRange
    };
  }

  global.TrainingEngine = Object.freeze({
    PLACES, IPD_PLACES, PLACE_LABEL, STATION_OF, CYCLE, ORDERS,
    holidaySet, isWorkingDay, workingDays, placeOn, blockOn,
    traineePlan, studentPlan, periodRows, ipdOpdSummary,
    rangeText, extraNote, firstName, shortName, monthName, monthYear,
    staffBase, hasTraineeTag, staffMatch, linkStaff, stationTrainees
  });
})(typeof window !== 'undefined' ? window : globalThis);
