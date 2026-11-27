/* =====================================================================
 * js/feat-training.js — feature "training" (ตารางฝึกงาน): trainee rotations and student schedules (R5-SPEC §3.3 / §3.4,
 * R6-SPEC §3.2 / §3.3: one shared layout for both segments, automatic trainee cohorts, several students at once)
 *
 * Data: core.use('plan') (js/plan-data.js: training(), trainingOn(date), saveTraining, deleteTraining, holidays(),
 * fetchStats) only. Engine: window.TrainingEngine (js/training-engine.js, pure). Everything is gated on
 * core.serverHas('training') (Code.gs 3.4): a 3.3 server shows no entry, no line on วันนี้ and sends nothing.
 *
 *  - Screen 'training' (เมนู → ของฉัน, order 30, "ตารางฝึกงาน", icon school; everyone views, the Supervisor edits).
 *    Segments เทคใหม่ · นักศึกษา ([data-training-seg]); both share ONE layout:
 *    1. the day card "ใครฝึกที่ไหน" ([data-training-day="<date>"], a date input): the names (nickname, else first name; the
 *       full name in the title and on tap) under IPD / ER / Portable / OPD, a "ฝึกพิเศษ" line for extras / other places;
 *       "วันหยุด ไม่มีการฝึกงาน" on a non-working day. เทคใหม่ = every cohort, นักศึกษา = every university.
 *    2. one card per group ([data-training-group="<i>"] data-group="<cohort | org>" data-kind): trainees by cohort,
 *       students by university. Header: the name · "N คน" · the date span, the group note (every member has the same
 *       non-empty note → once here, else under each name). A place-coloured timeline (one row per person, month ticks,
 *       a "วันนี้" line, extras as a thin marker; widths in %, it always fits 375 px), then the summary table ชื่อ-สกุล
 *       (ชื่อเล่น) | IPD | ER | Portable | OPD (the date ranges; it scrolls sideways inside its card), footnotes
 *       "*** <ช่วง> <ชื่อเล่น> ฝึก US". Supervisor: a tick (จัดใหม่), edit, delete per person; the trainee code "รหัส …"
 *       (Supervisor only — students have no code at all). "ส่งออกเป็นรูป" per group.
 *  - Supervisor flows (one sheet element, kinds auto · students · person · replan · export):
 *    เทคใหม่ "เพิ่มเทคใหม่" → the auto sheet: ชื่อรอบ (default "รอบ <d MMM yyyy>" of the start until typed), วันเริ่ม (any date,
 *    default the 1st of next month), IPD / OPD months (0–6, default 3), the rows editor (ชื่อ-สกุล, ชื่อเล่น, รหัสพนักงาน;
 *    "เพิ่มคน", up / down / remove per row; pasting several lines into a name box splits them into rows, "ชื่อ สกุล,
 *    ชื่อเล่น[, รหัส]" per line), หมายเหตุ for all → TrainingEngine.traineePlan (existing = every stored trainee, holidays of
 *    the range) → preview (timeline + table + warnings) → "บันทึกทั้งหมด" = ONE saveTraining. "กำหนดช่วงเอง (ทีละคน)" in it →
 *    the person sheet. นักศึกษา "เพิ่มนักศึกษา" → the students sheet: มหาวิทยาลัย, กลุ่ม, เริ่ม, สิ้นสุด, the rows editor
 *    (ชื่อ-สกุล, ชื่อเล่น), หมายเหตุ for all → studentPlan (existing = the stored students) → preview → one saveTraining;
 *    "เพิ่มทีละคน (กำหนดช่วงเอง)" in it → the person sheet. Students are always sent with code ''.
 *    The person sheet (add one / edit): name, nickname, code (trainees only), university or cohort, start, end, the
 *    blocks editor, the extras editor (trainees), note → saveTraining {items: [one]}; delete asks first → deleteTraining.
 *    "จัดใหม่ (N คน)" (ticked people of the segment): trainees → traineePlan per (cohort, start) keeping their start,
 *    cohort and month counts (existing = the other trainees); students → studentPlan → preview → one saveTraining.
 *    Errors go through core.spawn({write: true}) → core.handleError (CONFLICT: plan-data already applied the server's rows).
 *  - Export per group (core.shareImage(node, file, {width: 880, scale: 2}); inline styles, black / white like R4's
 *    pictures): title "ตารางฝึกงานเทคใหม่ — <รอบ>" / "ตารางฝึกงานนักศึกษา — <มหาวิทยาลัย>", the span, the summary table, the
 *    footnotes, the note line(s); never a code. File "ตารางฝึกงาน-<group>.png". The export sheet shows a scaled preview.
 *  - วันนี้ (R5-SPEC §3.4, unchanged) — services read by the core:
 *    core.provide('training.station', (date, slots) → {[stationId]: [names]}): on a working day the trainees (never students)
 *    at each station (ipd / portable / er, and us / or / cancer through an extra), nickname else first name, leaving out a
 *    trainee whose own staff account already sits in that station's slots (TrainingEngine.stationTrainees); {} otherwise.
 *    core.provide('training.myDay', (date, name) → [{icon, tone, main}]): "ฝึกงาน <Station>" for the trainees linked to the
 *    logged-in account (TrainingEngine.linkStaff).
 * DOM hooks for tests: #tab-training [data-training-screen] (data-seg, data-state), [data-training-seg], [data-training-act]
 * (add-trainees · add-students · replan · export (data-i) · edit / delete (data-id) · retry), [data-training-tools],
 * [data-training-day] with [data-training-day-input], [data-training-day-place="<place>"] dd, [data-training-day-extra],
 * [data-training-day-off], [data-training-who]; [data-training-group] (data-group, data-kind) with
 * [data-training-group-note], [data-training-timeline] ([data-training-tick], [data-training-row="<i>"] with
 * [data-seg-place] / [data-seg-extra], [data-training-today]), [data-training-table] (tbody tr[data-training-person="<id>"]
 * data-side="ipd|opd", td[data-place]), [data-training-person-note], [data-training-code], [data-training-pick="<id>"],
 * [data-training-notes] li; the sheet [data-training-sheet="<kind>"] with [data-tf="<field>"], the rows editor
 * [data-rows] > [data-row="<i>"] [data-rk="name|nickname|code"], [data-training-sheet-act="row-add|row-up|row-down|row-del|
 * single|auto-preview|students-preview|back|add-block|del-block|add-extra|del-extra"], [data-tf-row="block|extra"],
 * [data-training-preview="auto|students|replan"] ([data-training-preview-row="<i>"] data-side), [data-training-error],
 * [data-training-save]; export: [data-training-export-preview], [data-training-export-file], [data-training-export-save],
 * the node [data-training-export="group"] ([data-export-title], [data-export-row], [data-export-place], [data-export-note],
 * [data-export-footnote], [data-export-group-note], [data-export-person-note]).
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !App.core) return;
  const TE = window.TrainingEngine;
  if (!TE) return;   // the engine did not load: no screen (the core's วันนี้ lines stay off without the services)

  const ID = 'training';
  const SEGS = [{ id: 'trainee', label: 'เทคใหม่' }, { id: 'student', label: 'นักศึกษา' }];
  const PLACE_OPTIONS = ['ipd', 'er', 'portable', 'opd', 'us', 'or', 'cancer', 'other'];
  const DAY_PLACES = ['ipd', 'er', 'portable', 'opd'];
  const TABLE_PLACES = ['ipd', 'er', 'portable', 'opd'];
  const LIMITS = { name: 80, nickname: 30, code: 20, org: 80, cohort: 60, note: 200, label: 30, blocks: 40, extras: 12, days: 400, items: 40 };
  const EXPORT_WIDTH = 880;
  const EXPORT_SCALE = 2;
  const EXPORT_FONT = 'Sarabun,"Noto Sans Thai","Leelawadee UI",sans-serif';
  const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  /** The short labels inside the timeline segments (the legend and the table carry the full names). */
  const BAR_LABEL = { ipd: 'IPD', er: 'ER', portable: 'Port.', opd: 'OPD', us: 'US', or: 'OR', cancer: 'CA', other: 'อื่น' };
  const OPD_COLOR = { fill: '#475569', ink: '#FFFFFF' };
  const OTHER_COLOR = { fill: '#CBD5E1', ink: '#1E293B' };
  const BAR_INK = '#1E1B2E';
  const MSG = {
    cached: 'ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)',
    noTrainee: 'ยังไม่มีตารางฝึกงานของเทคใหม่',
    noStudent: 'ยังไม่มีนักศึกษาฝึกงาน',
    workNote: 'นับเฉพาะวันทำการ (ไม่รวมเสาร์-อาทิตย์และวันหยุด)',
    noOrg: 'ไม่ระบุมหาวิทยาลัย',
    noCohort: 'เทคใหม่ (ไม่ระบุรอบ)',
    halfHint: 'ครึ่งแรกของรายชื่อเริ่ม IPD ก่อน ที่เหลือเริ่ม OPD',
    pasteHint: 'วางรายชื่อหลายบรรทัดในช่องชื่อได้เลย (บรรทัดละคน: ชื่อ สกุล, ชื่อเล่น)',
    unsaved: 'ผลที่ได้ยังไม่ถูกบันทึก — ตรวจแล้วกดบันทึก'
  };

  let core = null;
  let root = null;
  let sheetEl = null;
  const ui = {
    seg: '',          // 'trainee' | 'student'
    day: '',          // the day card's date
    picked: new Set(),// ticked people (จัดใหม่) of the current segment
    busy: '',
    sheet: null       // {kind, …}
  };

  /* ---------------------------------------------------------------- helpers */
  const U = () => core.U;
  const K = () => core.Kit.cls;
  const esc = s => core.esc(s);
  const icon = (n, c) => core.Kit.icon(n, c || 'w-5 h-5');
  function P() { const p = core && core.use('plan'); return p && typeof p === 'object' && typeof p.training === 'function' ? p : null; }
  function on() { return !!core && core.serverHas('training') && !!P(); }
  function today() { return U().todayStr(); }
  function people() { const p = P(); return p ? p.training() : []; }
  function ofKind(kind) { return people().filter(x => x.kind === kind); }
  function trainees() { return ofKind('trainee'); }
  function students() { return ofKind('student'); }
  function byId(id) { return people().filter(x => x.id === id)[0] || null; }
  function norm(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim(); }
  /** R6 fix 11: a note keeps its line breaks (each line trimmed / collapsed, at most one empty line in a row). */
  function noteText(v) {
    return String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').split('\n')
      .map(l => l.replace(/[^\S\n]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function placeLabel(p) { return TE.PLACE_LABEL[p] || p; }
  function fileSafe(s) { return norm(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'ตาราง'; }
  function weekdayWord(date) { return U().thaiDateShort(date, { weekday: true }); }
  function holidaysNow() { const p = P(); return p ? p.holidays() : new Map(); }
  /** R6 fix 9: the holidays of the day card's date — the plan's, plus a year loaded on demand when the plan has none of it. */
  const dayHol = { map: new Map(), years: new Set() };
  function dayHolidays() { const m = holidaysNow(); dayHol.map.forEach((v, d) => { if (!m.has(d)) m.set(d, v); }); return m; }
  function ensureDayHolidays(date) {
    const y = String(date || '').slice(0, 4);
    if (!/^\d{4}$/.test(y) || dayHol.years.has(y) || !core || !P()) return;
    dayHol.years.add(y);
    const known = holidaysNow();
    for (const d of known.keys()) if (d.slice(0, 4) === y) return;   // the plan holds that year already
    const alive = core.alive();
    core.spawn(async () => {
      const got = await holidaysFor(y + '-01-01', y + '-12-31');
      if (!alive()) return;
      got.forEach((v, d) => { if (d.slice(0, 4) === y) dayHol.map.set(d, v); });
      core.render();
    });
  }
  function segKind() { return ui.seg === 'student' ? 'student' : 'trainee'; }
  function pickedOf(kind) { return ofKind(kind).filter(p => ui.picked.has(p.id)); }
  function fullWithNick(p) { return p.name + (p.nickname ? ' (' + p.nickname + ')' : ''); }
  /** "รอบ 1 ธ.ค. 2569" — the default cohort name of a start date. */
  function defaultCohort(start) {
    if (!U().isValidYmd(start)) return '';
    return 'รอบ ' + (+start.slice(8)) + ' ' + MONTHS_SHORT[+start.slice(5, 7) - 1] + ' ' + (+start.slice(0, 4) + 543);
  }
  /** A place's colours: the station tokens (utils STATIONS) for the stations, OPD dark, anything else neutral. */
  function placeColor(pl) {
    if (pl === 'opd') return OPD_COLOR;
    const st = TE.STATION_OF[pl] ? U().stationById(TE.STATION_OF[pl]) : null;
    return st ? { fill: st.border, ink: BAR_INK } : OTHER_COLOR;
  }
  /** A trainee's rank in a cohort: IPD-first before OPD-first, then the first IPD station (ipd, portable, er). */
  function rotationRank(p) {
    const b = (p.blocks || [])[0];
    if (!b) return 20;
    if (b.place === 'opd') return 10;
    const i = TE.CYCLE.indexOf(b.place);
    return i >= 0 ? i : 5;
  }
  /** The groups of a segment → [{key, label, people}] — trainees by cohort (people by start, rotation, name), students by
   *  university (people by start, name); groups by the earliest start. */
  function groups(kind) {
    const map = new Map();
    const field = kind === 'student' ? 'org' : 'cohort';
    ofKind(kind).forEach(p => { const k = p[field] || ''; if (!map.has(k)) map.set(k, []); map.get(k).push(p); });
    const sortPeople = kind === 'student'
      ? (a, b) => cmp(a.start, b.start) || cmp(a.name, b.name)
      : (a, b) => cmp(a.start, b.start) || rotationRank(a) - rotationRank(b) || cmp(a.name, b.name);
    const out = Array.from(map.entries()).map(([key, list]) => ({
      key, kind,
      label: key || (kind === 'student' ? MSG.noOrg : MSG.noCohort),
      people: list.slice().sort(sortPeople)
    }));
    return out.sort((a, b) => cmp(a.people[0].start, b.people[0].start) || cmp(a.key, b.key));
  }
  function spanText(list) { const s = TE.groupSpan(list); return s ? TE.rangeText(s.from, s.to) : ''; }
  /** The note shared by every member (non-empty), else ''. */
  function sharedNote(list) {
    const n = noteText(list[0] && list[0].note);
    return n && list.every(p => noteText(p.note) === n) ? n : '';
  }
  /** The footnotes of a group: the extras, then blocks at another place than the four columns. */
  function footnotes(list) {
    const out = [];
    list.forEach(p => {
      (p.extras || []).forEach(x => { const t = TE.extraNote(p, x); if (t) out.push(t); });
      (p.blocks || []).forEach(b => { if (TABLE_PLACES.indexOf(b.place) < 0) out.push('*** ' + TE.rangeText(b.from, b.to) + ' ' + TE.shortName(p) + ' ฝึก ' + placeLabel(b.place)); });
    });
    return out;
  }
  function sideOf(p) { const b = (p.blocks || [])[0]; return b && b.place === 'opd' ? 'opd' : 'ipd'; }

  /* ---------------------------------------------------------------- วันนี้ services (R5-SPEC §3.4) */
  /** The active staff names (+ me) — for TrainingEngine.linkStaff. */
  function staffNames(me) {
    const list = core.staff().map(x => x.name);
    if (me && list.indexOf(me) < 0) list.push(me);
    return list;
  }
  /** {[stationId]: [names]} of the trainees training at each station on a working day, without one whose own staff account
   *  already sits in that station's slots (slots: {[stationId]: [names]} as วันนี้ shows them). */
  function stationLines(date, slots) {
    if (!on() || !U().isValidYmd(date) || !TE.isWorkingDay(date, holidaysNow())) return {};
    return TE.stationTrainees({ people: P().training(), date, slots: slots || {}, staff: staffNames(''), supervisor: core.state.supervisor || '' });
  }
  /** "ฝึกงาน <Station>" of the trainees whose linked staff account is me (TrainingEngine.linkStaff). */
  function myDay(date, me) {
    if (!on() || !me || !U().isValidYmd(date) || !TE.isWorkingDay(date, holidaysNow())) return [];
    const map = P().trainingOn(date);
    const names = staffNames(me), sup = core.state.supervisor || '';
    const out = [];
    Object.keys(map).forEach(place => map[place].forEach(p => {
      if (TE.linkStaff(p, names, sup) !== me) return;
      const st = TE.STATION_OF[place] ? U().stationById(TE.STATION_OF[place]) : null;
      out.push({ icon: 'school', tone: 'lilac', main: 'ฝึกงาน ' + (st ? st.name : placeLabel(place)), sub: p.cohort || '' });
    }));
    return out;
  }

  /* ---------------------------------------------------------------- screen */
  function renderScreen(el, c) {
    const k = K();
    const p = P();
    if (!c.state.user || !p) { c.setHtml(el, `<div class="${k.card}">${c.Kit.skeleton(4)}</div>`); return; }
    const state = p.ready() ? 'ready' : p.loading() || !p.error() ? 'loading' : 'missing';
    let html = segChips();
    if (state === 'loading') html += `<div class="${k.card}" data-loading="1">${c.Kit.skeleton(6)}</div>`;
    else if (state === 'missing') {
      html += `<div class="${k.card}" data-training-empty="missing">` + c.Kit.empty({ icon: 'cloud-off', title: 'ยังไม่มีข้อมูลตารางฝึกงานในเครื่อง', hint: 'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่' }) +
        `<div class="flex justify-center pb-2"><button type="button" class="${k.btn} ${k.btnSecondary}" data-training-act="retry">${icon('refresh')}ลองใหม่</button></div></div>`;
    } else {
      if (!p.fresh()) html += `<p class="${k.textCaption} px-1" data-training-cached>${esc(MSG.cached)}</p>`;
      html += segHtml(c, segKind());
    }
    c.setHtml(el, `<div class="space-y-3 md:max-w-3xl md:mx-auto min-w-0" data-training-screen data-seg="${esc(ui.seg)}" data-state="${state}">${html}</div>`);
  }
  function segChips() {
    const k = K();
    return `<div class="flex gap-2 overflow-x-auto overscroll-x-contain pb-1" role="group" aria-label="มุมมองตารางฝึกงาน">` +
      SEGS.map(s => { const sel = s.id === ui.seg; return `<button type="button" class="${k.chip} ${sel ? k.chipOn : k.chipOff} shrink-0" data-training-seg="${s.id}" aria-pressed="${sel}">${esc(s.label)}</button>`; }).join('') + '</div>';
  }
  function actBtn(act, ic, label, tone, extra) {
    const k = K();
    return `<button type="button" class="${k.btn} ${tone || k.btnSecondary}" data-training-act="${act}"${extra || ''}>${icon(ic)}${esc(label)}</button>`;
  }
  function emptyCard(kind, title, hint) {
    const k = K();
    return `<div class="${k.card}" data-training-empty="${kind}">` + core.Kit.empty({ icon: 'school', title, hint }) + '</div>';
  }
  function segHtml(c, kind) {
    const k = K();
    const sup = c.isSup();
    const st = kind === 'student';
    let html = '';
    if (sup) {
      const n = pickedOf(kind).length;
      html += `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-training-tools>` +
        actBtn(st ? 'add-students' : 'add-trainees', st ? 'users' : 'user', st ? 'เพิ่มนักศึกษา' : 'เพิ่มเทคใหม่', k.btnPrimary) +
        actBtn('replan', 'wand', n ? 'จัดใหม่ (' + n + ' คน)' : 'จัดใหม่', k.btnSecondary, n ? '' : ' disabled') + '</div>';
    }
    if (!ui.day) ui.day = today();
    html += dayCard(kind);
    const list = groups(kind);
    if (!list.length) {
      return html + (st ? emptyCard('student', MSG.noStudent, sup ? 'กด "เพิ่มนักศึกษา" เพื่อจัดตารางหมุนเวียน' : '')
        : emptyCard('trainee', MSG.noTrainee, sup ? 'กด "เพิ่มเทคใหม่" เพื่อจัดตารางวนของเทครอบใหม่' : 'Supervisor ยังไม่ได้จัดตารางวนของเทคใหม่'));
    }
    list.forEach((g, gi) => { html += groupCard(c, g, gi); });
    return html;
  }

  /* ---- the day card "ใครฝึกที่ไหน" */
  function whoHtml(p) {
    const s = TE.shortName(p);
    return `<span class="py-3.5 underline decoration-dotted decoration-ink-300 underline-offset-4 cursor-pointer" role="button" tabindex="0" data-training-who data-short="${esc(s)}" data-full="${esc(p.name)}" title="${esc(p.name)}">${esc(s)}</span>`;
  }
  function dayCard(kind) {
    const k = K();
    const d = ui.day;
    ensureDayHolidays(d);
    const working = TE.isWorkingDay(d, dayHolidays());
    let body;
    if (!working) body = `<p class="${k.textMeta}" data-training-day-off>${esc(weekdayWord(d))} — วันหยุด ไม่มีการฝึกงาน</p>`;
    else {
      const at = {}, extra = [];
      ofKind(kind).forEach(p => {
        const pl = TE.placeOn(p, d);
        if (!pl) return;
        if (DAY_PLACES.indexOf(pl) >= 0) (at[pl] || (at[pl] = [])).push(p);
        else extra.push({ p, pl });
      });
      body = `<dl class="grid grid-cols-2 gap-x-4 gap-y-1.5">` + DAY_PLACES.map(pl =>
        `<div class="min-w-0" data-training-day-place="${pl}"><dt class="${k.textCaption}">${esc(placeLabel(pl))}</dt>` +
        `<dd class="text-sm leading-6 text-ink-900 break-words">${(at[pl] || []).map(whoHtml).join(', ') || '-'}</dd></div>`).join('') + '</dl>';
      if (extra.length) {
        body += `<p class="${k.textMeta} break-words" data-training-day-extra>ฝึกพิเศษ: ${extra.map(x => whoHtml(x.p) + esc(' (' + placeLabel(x.pl) + ')')).join(', ')}</p>`;
      }
    }
    return `<section class="${k.cardLilac} space-y-2" data-training-day="${esc(d)}"><h2 class="${k.titleCard}">ใครฝึกที่ไหน</h2>` +
      `<label class="sr-only" for="trainingDay">วันที่</label><input type="date" id="trainingDay" class="${k.input}" data-training-day-input value="${esc(d)}">${body}</section>`;
  }

  /* ---- the group view: timeline + summary table (also the previews) */
  /**
   * The place-coloured timeline of a list of people. opts: {preview}. Widths in % of the span: it fits any width.
   */
  function timelineHtml(list, opts) {
    const k = K();
    const span = TE.groupSpan(list);
    if (!span) return '';
    const preview = !!(opts && opts.preview);
    const ticks = TE.monthTicks(span.from, span.to);
    const t = today();
    const nowIn = t >= span.from && t <= span.to;
    const nowPct = nowIn ? TE.spanPct(span.from, span.to, t, t).left : 0;
    const usedPlaces = new Set();
    let hasExtra = false;
    // R6 fix 8: labels never closer than ~32 px of a 375 px screen's bar (13 %; 17 % after a label with the year)
    let lastLeft = -100, need = 0;
    const tickRow = ticks.map(x => {
      const left = TE.spanPct(span.from, span.to, x.date, x.date).left;
      if (left - lastLeft < need) return '';
      lastLeft = left;
      need = x.label.indexOf(' ') >= 0 ? 17 : 13;
      return `<span class="absolute top-0 pl-1 border-l border-ink-200 text-[0.6875rem] font-medium leading-5 text-slate-500 whitespace-nowrap" style="left:${left}%" data-training-tick="${x.date}">${esc(x.label)}</span>`;
    }).join('');
    const grid = ticks.filter(x => !x.start).map(x => `<span class="absolute inset-y-0 w-px bg-ink-100" style="left:${TE.spanPct(span.from, span.to, x.date, x.date).left}%" aria-hidden="true"></span>`).join('');
    const names = list.map(p => `<div class="h-8 flex items-center min-w-0"><span class="truncate text-sm leading-5 ${p.nickname ? 'font-semibold' : 'font-medium'} text-ink-900" title="${esc(p.name)}">${esc(TE.shortName(p))}</span></div>`).join('');
    const rows = list.map((p, i) => {
      const said = [];
      const segs = (p.blocks || []).map(b => {
        const pos = TE.spanPct(span.from, span.to, b.from, b.to);
        if (!pos.width) return '';
        usedPlaces.add(b.place);
        const col = placeColor(b.place);
        const what = placeLabel(b.place) + ' ' + TE.rangeText(b.from, b.to);
        said.push(what);
        return `<span class="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[0.625rem] font-semibold leading-none whitespace-nowrap" style="left:${pos.left}%;width:${pos.width}%;background:${col.fill};color:${col.ink};box-shadow:inset -1px 0 0 #ffffff" data-seg-place="${b.place}" title="${esc(what)}">${esc(BAR_LABEL[b.place] || '')}</span>`;
      }).join('');
      const marks = (p.extras || []).map(x => {
        const pos = TE.spanPct(span.from, span.to, x.from, x.to);
        if (!pos.width) return '';
        hasExtra = true;
        const what = (norm(x.label) || 'ฝึก ' + placeLabel(x.place)) + ' ' + TE.rangeText(x.from, x.to);
        said.push(what);
        return `<span class="absolute bottom-0 h-1.5" style="left:${pos.left}%;width:max(${pos.width}%,3px);background:${BAR_INK};box-shadow:0 -1px 0 #ffffff" data-seg-extra="${x.place}" title="${esc(what)}"></span>`;
      }).join('');
      return `<div class="h-8 flex items-center" data-training-row="${i}"><div class="relative w-full h-6 rounded-lg bg-ink-50 overflow-hidden" role="img" aria-label="${esc(TE.shortName(p) + ': ' + (said.join(', ') || 'ยังไม่ได้จัด'))}">${segs}${marks}</div></div>`;
    }).join('');
    const nowLine = nowIn ? `<span class="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-coral-600" style="left:calc(${nowPct}% - 1px)" data-training-today="${t}" aria-hidden="true"></span>` : '';
    const nowLabel = nowIn ? `<div class="flex"><div class="w-16 shrink-0"></div><div class="relative flex-1 min-w-0 h-4 overflow-hidden"><span class="absolute top-0 -translate-x-1/2 text-[0.6875rem] font-semibold leading-4 text-coral-700 whitespace-nowrap" style="left:${Math.min(92, Math.max(8, nowPct))}%">วันนี้</span></div></div>` : '';
    const legendPlaces = ['ipd', 'er', 'portable', 'opd', 'us', 'or', 'cancer', 'other'].filter(pl => usedPlaces.has(pl));
    const legend = `<div class="flex flex-wrap gap-x-3 gap-y-1 pt-1 ${k.textCaption}" data-training-legend>` + legendPlaces.map(pl => {
      const col = placeColor(pl);
      return `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-3 rounded" style="background:${col.fill}" aria-hidden="true"></span>${esc(placeLabel(pl))}</span>`;
    }).join('') + (hasExtra ? `<span class="inline-flex items-center gap-1.5"><span class="inline-block w-3 h-1.5 rounded-sm bg-ink-900" aria-hidden="true"></span>ฝึกพิเศษ</span>` : '') + '</div>';
    return `<div class="min-w-0" data-training-timeline${preview ? '="preview"' : ''} data-from="${span.from}" data-to="${span.to}">` +
      `<div class="flex"><div class="w-16 shrink-0"></div><div class="relative flex-1 min-w-0 h-5 overflow-hidden" aria-hidden="true">${tickRow}</div></div>` +
      `<div class="flex"><div class="w-16 shrink-0 pr-2">${names}</div><div class="relative flex-1 min-w-0">${grid}${rows}${nowLine}</div></div>` +
      nowLabel + legend + '</div>';
  }
  /** The ranges of one place as lines. */
  function rangeLines(ranges, cls) { return ranges.map(r => `<span class="block ${cls || ''}">${esc(TE.rangeText(r[0], r[1]))}</span>`).join(''); }
  /**
   * The summary table ชื่อ-สกุล (ชื่อเล่น) | IPD | ER | Portable | OPD. opts: {preview, sup, notes: per-person notes shown}.
   */
  function tableHtml(list, opts) {
    const k = K();
    const o = opts || {};
    const sup = !!o.sup && !o.preview;
    const th = 'px-2 py-2 text-xs font-medium leading-4 text-ink-800 bg-cream-50 border-b-2 border-brand-100 align-bottom';
    let html = `<div class="overflow-x-auto overscroll-x-contain rounded-2xl border-2 border-brand-100" data-training-table${o.preview ? '="preview"' : ''}>` +
      `<table class="w-full min-w-[36rem] border-collapse text-left"><thead><tr><th scope="col" class="${th} sticky left-0 z-[1] min-w-[11rem]">ชื่อ-สกุล (ชื่อเล่น)</th>` +
      TABLE_PLACES.map(pl => `<th scope="col" class="${th}">${esc(placeLabel(pl))}</th>`).join('') + '</tr></thead><tbody>';
    list.forEach((p, i) => {
      const r = TE.placeRanges(p);
      const meta = [];
      if (sup && p.kind === 'trainee' && p.code) meta.push(`<span class="block ${k.textMeta}" data-training-code>${esc('รหัส ' + p.code)}</span>`);
      if (o.notes && noteText(p.note)) meta.push(`<span class="block ${k.textMeta} break-words whitespace-pre-line" data-training-person-note>${esc('หมายเหตุ: ' + noteText(p.note))}</span>`);
      const tick = sup ? `<label class="shrink-0 inline-flex items-center justify-center w-11 h-11 -ml-2"><input type="checkbox" class="w-5 h-5 accent-brand-600" data-training-pick="${esc(p.id)}" aria-label="${esc('เลือก ' + p.name)}"${ui.picked.has(p.id) ? ' checked' : ''}></label>` : '';
      const tools = sup ? `<span class="mt-1 flex items-center gap-1">` +
        `<button type="button" class="${k.iconBtnRound}" data-training-act="edit" data-id="${esc(p.id)}" aria-label="${esc('แก้ไข ' + p.name)}">${icon('pencil')}</button>` +
        `<button type="button" class="${k.iconBtnRound}" data-training-act="delete" data-id="${esc(p.id)}" aria-label="${esc('ลบ ' + p.name)}">${icon('trash')}</button></span>` : '';
      const rowAttr = o.preview ? `data-training-preview-row="${i}"` : `data-training-person="${esc(p.id)}"`;
      html += `<tr class="border-t border-brand-100 align-top" ${rowAttr} data-side="${sideOf(p)}">` +
        `<th scope="row" class="sticky left-0 z-[1] bg-white px-2 py-2 text-left font-normal"><div class="flex items-start gap-1">${tick}<div class="min-w-0">` +
        `<span class="block text-sm font-medium leading-5 text-ink-900 break-words">${esc(p.name)}${p.nickname ? ` <span class="text-ink-700">(${esc(p.nickname)})</span>` : ''}</span>${meta.join('')}${tools}</div></div></th>` +
        TABLE_PLACES.map(pl => `<td class="px-2 py-2 text-xs leading-5 text-ink-900" data-place="${pl}">${rangeLines(r[pl]) || '<span class="text-slate-400">-</span>'}</td>`).join('') + '</tr>';
    });
    return html + '</tbody></table></div>';
  }
  function notesHtml(list, extraLine) {
    const k = K();
    const notes = footnotes(list);
    if (!notes.length && !extraLine) return '';
    return `<ul class="space-y-0.5 ${k.textMeta} ${k.wrapAnywhere}" data-training-notes>${notes.map(n => `<li>${esc(n)}</li>`).join('')}` +
      (extraLine ? `<li data-training-worknote>${esc(extraLine)}</li>` : '') + '</ul>';
  }
  function groupCard(c, g, gi) {
    const k = K();
    const shared = sharedNote(g.people);
    return `<section class="${k.card} space-y-3 min-w-0" data-training-group="${gi}" data-group="${esc(g.key)}" data-kind="${g.kind}">` +
      `<div class="flex flex-wrap items-center gap-2"><div class="min-w-0 flex-1"><h2 class="${k.titleCard} break-words">${esc(g.label)}</h2>` +
      `<p class="${k.textMeta}" data-training-group-meta>${esc(g.people.length + ' คน · ' + spanText(g.people))}</p></div>` +
      `<button type="button" class="${k.btn} ${k.btnTonal} ${k.btnCompact}" data-training-act="export" data-i="${gi}">${icon('image', 'w-4 h-4')}ส่งออกเป็นรูป</button></div>` +
      (shared ? `<p class="${k.note}" data-training-group-note>${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0 break-words whitespace-pre-line">${esc('หมายเหตุ: ' + shared)}</span></p>` : '') +
      timelineHtml(g.people) + tableHtml(g.people, { sup: c.isSup(), notes: !shared }) +
      notesHtml(g.people, g.kind === 'student' ? MSG.workNote : '') + '</section>';
  }

  /* ---------------------------------------------------------------- the sheet */
  function ensureSheet() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    const k = K();
    sheetEl = document.createElement('div');
    sheetEl.className = k.sheetWrap + ' md:p-4';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-labelledby', 'trainingSheetTitle');
    sheetEl.dataset.trainingSheet = '';
    sheetEl.addEventListener('click', onSheetClick);
    sheetEl.addEventListener('change', onSheetChange);
    sheetEl.addEventListener('input', onSheetInput);
    sheetEl.addEventListener('paste', onSheetPaste);
    document.body.appendChild(sheetEl);
    return sheetEl;
  }
  function openSheet(kind, title, body, actions) {
    const k = K();
    const el = ensureSheet();
    el.dataset.trainingSheet = kind;
    el.innerHTML = `<div class="uk-safe-b ${k.sheetFrame}" data-sheet-panel><div class="${k.sheetGrabber}" aria-hidden="true"></div>` +
      `<div class="${k.sheetHead}"><h2 id="trainingSheetTitle" class="flex-1 outline-none ${k.sheetTitle}" data-sheet-title tabindex="-1">${esc(title)}</h2>` +
      `<button type="button" class="${k.iconBtn}" data-sheet-close aria-label="ปิด">${icon('chevron-down')}</button></div>` +
      `<div class="${k.sheetScroll}" data-training-sheet-body>${body}</div><div class="${k.sheetActions}" data-training-sheet-actions>${actions}</div></div>`;
    core.Kit.sheet.open(el,{ initialFocus: '[data-sheet-title]', onClose: () => { ui.sheet = null; } });
  }
  /** Replaces the body / actions of the open sheet (a step of the same flow). */
  function paintSheet(body, actions) {
    if (!sheetEl) return;
    const b = sheetEl.querySelector('[data-training-sheet-body]'), a = sheetEl.querySelector('[data-training-sheet-actions]');
    if (b) { b.innerHTML = body; b.scrollTop = 0; }
    if (a && actions !== undefined) a.innerHTML = actions;
  }
  function closeSheet() { if (sheetEl && core.Kit.sheet.isOpen(sheetEl)) core.Kit.sheet.close(sheetEl, 'api'); ui.sheet = null; }
  function field(id, label, input, hint) {
    const k = K();
    return `<div><label class="${k.label}" for="${id}">${esc(label)}</label>${input}${hint ? `<p class="${k.textMeta} mt-1">${esc(hint)}</p>` : ''}</div>`;
  }
  function textInput(id, key, value, max, extra) {
    return `<input type="text" id="${id}" class="${K().input}" data-tf="${key}" value="${esc(value || '')}" maxlength="${max}"${extra || ''}>`;
  }
  /** R6 fix 11: the note keeps its line breaks (≤ 200 characters). */
  function noteInput(id, value) {
    return `<textarea id="${id}" class="${K().textarea}" data-tf="note" rows="2" maxlength="${LIMITS.note}">${esc(value || '')}</textarea>`;
  }
  function dateInput(id, key, value) { return `<input type="date" id="${id}" class="${K().input}" data-tf="${key}" value="${esc(value || '')}">`; }
  function numSelect(id, key, v) {
    let o = '';
    for (let i = 0; i <= 6; i++) o += `<option value="${i}"${i === v ? ' selected' : ''}>${i}</option>`;
    return `<select id="${id}" class="${K().select}" data-tf="${key}">${o}</select>`;
  }
  function placeSelect(value, attrs, list) {
    return `<select class="${K().select}" ${attrs}>` + (list || PLACE_OPTIONS).map(pl => `<option value="${pl}"${pl === value ? ' selected' : ''}>${esc(placeLabel(pl))}</option>`).join('') + '</select>';
  }
  function errorBox() { return `<p class="${K().fieldError} hidden" data-training-error role="alert"></p>`; }
  function showError(text) {
    const el = sheetEl && sheetEl.querySelector('[data-training-error]');
    if (!el) { core.toast('⚠️ ' + text, 4000); return; }
    el.textContent = text;
    el.classList.toggle('hidden', !text);
    if (text && typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
  }
  const val = key => { const el = sheetEl && sheetEl.querySelector('[data-tf="' + key + '"]'); return el ? el.value : ''; };
  function cancelBtn(label) { const k = K(); return `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>${esc(label || 'ยกเลิก')}</button>`; }
  function backBtn() { const k = K(); return `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-training-sheet-act="back">${icon('chevron-left')}ย้อนกลับ</button>`; }
  function saveBtn(label, off) { const k = K(); return `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-save${off ? ' disabled' : ''}>${esc(label || 'บันทึก')}</button>`; }
  function previewBtn(act) { const k = K(); return `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-sheet-act="${act}">${icon('wand')}แสดงตัวอย่าง</button>`; }
  function linkBtn(act, label) { const k = K(); return `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact} -ml-2" data-training-sheet-act="${act}">${icon('sliders', 'w-4 h-4')}${esc(label)}</button>`; }
  /** The warnings of a plan; the SHARED_STATION ones of a trainee plan as ONE line with the names. */
  function warningsHtml(list, planned) {
    const k = K();
    const box = (code, t) => `<p class="${k.note}" data-training-warning="${esc(code)}">${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0 break-words">${esc(t)}</span></p>`;
    const shared = (list || []).filter(w => w.code === 'SHARED_STATION' && w.key);
    const byKey = new Map((planned || []).map((p, i) => [String(p.id || norm(p.name) || '#' + i), p]));
    let html = shared.length ? box('SHARED_STATION', 'บางวันมีเทคใหม่อยู่ Station เดียวกัน (จัดให้ซ้ำน้อยที่สุดแล้ว): ' +
      shared.map(w => { const p = byKey.get(w.key); return p ? TE.shortName(p) : w.text.split(':')[0]; }).join(', ')) : '';
    (list || []).forEach(w => { if (shared.indexOf(w) < 0) html += box(w.code, w.text); });
    return html;
  }

  /* ---- the rows editor (auto sheet: name, nickname, code; students sheet: name, nickname) */
  function blankRow() { return { name: '', nickname: '', code: '' }; }
  function rowsHtml(rows, withCode) {
    const k = K();
    const n = rows.length;
    return `<fieldset class="space-y-2 min-w-0" data-rows><legend class="${k.label}">รายชื่อ (${n} คน)</legend>` + rows.map((r, i) =>
      `<div class="rounded-2xl border-2 border-ink-100 p-2 space-y-2" data-row="${i}">` +
      `<div class="flex items-center gap-1"><span class="w-6 shrink-0 text-center ${k.textCaption} tabular-nums" aria-hidden="true">${i + 1}</span>` +
      `<input type="text" class="${k.input} min-w-0" data-rk="name" value="${esc(r.name)}" maxlength="${LIMITS.name}" placeholder="ชื่อ สกุล" aria-label="${esc('ชื่อ-สกุล คนที่ ' + (i + 1))}" autocomplete="off">` +
      `<button type="button" class="${k.iconBtn}" data-training-sheet-act="row-del" data-i="${i}" aria-label="${esc('ลบคนที่ ' + (i + 1))}">${icon('trash')}</button></div>` +
      `<div class="flex items-center gap-1 pl-7">` +
      `<input type="text" class="${k.input} min-w-0 flex-1" data-rk="nickname" value="${esc(r.nickname)}" maxlength="${LIMITS.nickname}" placeholder="ชื่อเล่น${withCode ? '' : ' (ไม่บังคับ)'}" aria-label="${esc('ชื่อเล่น คนที่ ' + (i + 1))}" autocomplete="off">` +
      (withCode ? `<input type="text" class="${k.input} min-w-0 flex-1" data-rk="code" value="${esc(r.code)}" maxlength="${LIMITS.code}" placeholder="รหัส" aria-label="${esc('รหัสพนักงาน (ไม่บังคับ) คนที่ ' + (i + 1))}" autocomplete="off" inputmode="numeric">` : '') +
      `<button type="button" class="${k.iconBtn}" data-training-sheet-act="row-up" data-i="${i}" aria-label="${esc('เลื่อนคนที่ ' + (i + 1) + ' ขึ้น')}"${i ? '' : ' disabled'}>${icon('chevron-up')}</button>` +
      `<button type="button" class="${k.iconBtn}" data-training-sheet-act="row-down" data-i="${i}" aria-label="${esc('เลื่อนคนที่ ' + (i + 1) + ' ลง')}"${i < n - 1 ? '' : ' disabled'}>${icon('chevron-down')}</button></div></div>`).join('') +
      `<button type="button" class="${k.btn} ${k.btnTonal} ${k.btnCompact}" data-training-sheet-act="row-add"${n >= LIMITS.items ? ' disabled' : ''}>${icon('user', 'w-4 h-4')}เพิ่มคน</button>` +
      `<p class="${k.textMeta}">${esc(MSG.pasteHint)}</p></fieldset>`;
  }
  /** The rows as typed (DOM → ui.sheet.form.rows). */
  function readRows() {
    const f = ui.sheet && ui.sheet.form;
    if (!f || !sheetEl) return [];
    const box = sheetEl.querySelector('[data-rows]');
    if (!box) return f.rows;
    f.rows = Array.prototype.map.call(box.querySelectorAll('[data-row]'), r => {
      const g = n => { const x = r.querySelector('[data-rk="' + n + '"]'); return x ? x.value : ''; };
      return { name: g('name'), nickname: g('nickname'), code: g('code') };
    });
    return f.rows;
  }
  /** One pasted line "ชื่อ สกุล, ชื่อเล่น[, รหัส]" → a row. */
  function parseLine(line, withCode) {
    const a = String(line || '').split(/[,，\t]/).map(norm);
    return { name: (a[0] || '').slice(0, LIMITS.name), nickname: (a[1] || '').slice(0, LIMITS.nickname), code: withCode ? (a[2] || '').slice(0, LIMITS.code) : '' };
  }
  function rowsWithCode() { return !!(ui.sheet && ui.sheet.kind === 'auto'); }
  function rowsAct(act, i) {
    const f = ui.sheet.form;
    const rows = readRows();
    if (act === 'row-add') { if (rows.length < LIMITS.items) rows.push(blankRow()); }
    else if (act === 'row-del') { rows.splice(i, 1); if (!rows.length) rows.push(blankRow()); }
    else if (act === 'row-up' && i > 0) { const x = rows[i]; rows[i] = rows[i - 1]; rows[i - 1] = x; }
    else if (act === 'row-down' && i < rows.length - 1) { const x = rows[i]; rows[i] = rows[i + 1]; rows[i + 1] = x; }
    f.rows = rows;
    repaintRows(act === 'row-add' ? rows.length - 1 : act === 'row-up' ? i - 1 : act === 'row-down' ? i + 1 : -1);
  }
  function repaintRows(focusRow) {
    const box = sheetEl && sheetEl.querySelector('[data-rows]');
    if (!box) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = rowsHtml(ui.sheet.form.rows, rowsWithCode());
    box.replaceWith(tmp.firstElementChild);
    if (focusRow >= 0) {
      const el = sheetEl.querySelector('[data-row="' + focusRow + '"] [data-rk="name"]');
      if (el) { try { el.focus({ preventScroll: false }); } catch (e) { /* ignore */ } }
    }
  }
  /** Several lines pasted into a name box → one row per line (the first replaces the box's row). */
  function onSheetPaste(e) {
    const t = e.target;
    if (!t || !t.matches || !t.matches('[data-rk="name"]') || !ui.sheet || !ui.sheet.form || !ui.sheet.form.rows) return;
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData('text') || cd.getData('text/plain') : '';
    const lines = String(text || '').split(/\r?\n/).map(norm).filter(Boolean);
    if (!lines.length || (lines.length < 2 && !/[,，\t]/.test(lines[0]))) return;   // one plain name: the normal paste
    const withCode = rowsWithCode();
    const parsed = lines.map(l => parseLine(l, withCode)).filter(r => r.name);   // R6 fix 7: lines without a name are ignored
    if (!parsed.length) return;
    e.preventDefault();
    const rows = readRows();
    const at = +t.closest('[data-row]').dataset.row;
    // the row pasted into is kept: an empty one takes the first line, a filled one stays and the lines follow it
    const fillAt = !norm(rows[at] && rows[at].name);
    const room = LIMITS.items - rows.length + (fillAt ? 1 : 0);
    const take = parsed.slice(0, Math.max(0, room));
    if (fillAt && take.length) rows.splice(at, 1, ...take); else rows.splice(at + 1, 0, ...take);
    if (!rows.length) rows.push(blankRow());
    ui.sheet.form.rows = rows;
    repaintRows(take.length ? (fillAt ? at : at + 1) + take.length - 1 : at);
    if (parsed.length > take.length) showError('ได้ครั้งละไม่เกิน 40 คน — ตัดรายชื่อที่เกินออกแล้ว');
  }

  /* ---- the person sheet (add / edit one trainee or student, ranges set by hand) */
  function blankPerson(kind) {
    const t = today();
    return { id: '', baseVersion: 0, kind, name: '', nickname: '', code: '', org: '', cohort: '', start: t, end: U().addDays(t, kind === 'student' ? 27 : 180), blocks: [], extras: [], note: '' };
  }
  function openPerson(kind, id) {
    if (!core.isSup()) return;
    const cur = id ? byId(id) : null;
    if (id && !cur) return;
    const f = cur ? Object.assign(clone(cur), { baseVersion: cur.version }) : blankPerson(kind);
    if (f.kind === 'student') f.code = '';
    if (!f.blocks.length) f.blocks.push({ from: f.start, to: f.end, place: 'ipd' });
    ui.sheet = { kind: 'person', form: f };
    const title = cur ? 'แก้ไข' + (f.kind === 'student' ? 'นักศึกษา' : 'เทคใหม่') : f.kind === 'student' ? 'เพิ่มนักศึกษา (ทีละคน)' : 'เพิ่มเทคใหม่ (กำหนดช่วงเอง)';
    openSheet('person', title, personBody(f), cancelBtn() + saveBtn());
  }
  function personBody(f) {
    const k = K();
    const st = f.kind === 'student';
    let html = field('tfName', 'ชื่อ สกุล', textInput('tfName', 'name', f.name, LIMITS.name, ' autocomplete="off"'));
    html += field('tfNick', st ? 'ชื่อเล่น (ไม่บังคับ)' : 'ชื่อเล่น', textInput('tfNick', 'nickname', f.nickname, LIMITS.nickname));
    if (!st) html += field('tfCode', 'รหัสพนักงาน (ไม่บังคับ)', textInput('tfCode', 'code', f.code, LIMITS.code), 'เห็นเฉพาะ Supervisor');
    if (st) html += field('tfOrg', 'มหาวิทยาลัย', textInput('tfOrg', 'org', f.org, LIMITS.org, ' list="trainingOrgs"')) + orgList();
    html += field('tfCohort', st ? 'กลุ่ม (ไม่บังคับ)' : 'รอบ เช่น รอบ 1 ต.ค. 2569', textInput('tfCohort', 'cohort', f.cohort, LIMITS.cohort, st ? '' : ' list="trainingCohorts"'));
    if (!st) html += `<datalist id="trainingCohorts">${Array.from(new Set(trainees().map(p => p.cohort).filter(Boolean))).map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>`;
    html += `<div class="grid grid-cols-2 gap-2">${field('tfStart', 'เริ่ม', dateInput('tfStart', 'start', f.start))}${field('tfEnd', 'สิ้นสุด', dateInput('tfEnd', 'end', f.end))}</div>`;
    html += `<div class="space-y-2" data-tf-list="block"><p class="${k.label}">ช่วงการฝึก</p>` + f.blocks.map((b, i) => rangeRow('block', i, b)).join('') +
      `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact}" data-training-sheet-act="add-block">${icon('calendar', 'w-4 h-4')}เพิ่มช่วง</button></div>`;
    if (!st) {
      html += `<div class="space-y-2" data-tf-list="extra"><p class="${k.label}">ฝึกพิเศษ (เช่น ฝึก US 5 วัน — แทนช่วงปกติในวันนั้น)</p>` + f.extras.map((b, i) => rangeRow('extra', i, b)).join('') +
        `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact}" data-training-sheet-act="add-extra">${icon('star', 'w-4 h-4')}เพิ่มฝึกพิเศษ</button></div>`;
    }
    html += field('tfNote', 'หมายเหตุ (ไม่บังคับ)', noteInput('tfNote', f.note));
    return `<div class="space-y-3">${html}${errorBox()}</div>`;
  }
  function orgList() { return `<datalist id="trainingOrgs">${groups('student').filter(g => g.key).map(g => `<option value="${esc(g.key)}"></option>`).join('')}</datalist>`; }
  function rangeRow(kind, i, b) {
    const k = K();
    const lab = kind === 'extra' ? `<input type="text" class="${k.input}" data-tf-k="label" value="${esc(b.label || '')}" maxlength="${LIMITS.label}" placeholder="เช่น ฝึก US" aria-label="ชื่อการฝึก">` : '';
    return `<div class="rounded-2xl border-2 border-ink-100 p-2 space-y-2" data-tf-row="${kind}" data-i="${i}">` +
      `<div class="grid grid-cols-2 gap-2"><input type="date" class="${k.input}" data-tf-k="from" value="${esc(b.from || '')}" aria-label="ตั้งแต่">` +
      `<input type="date" class="${k.input}" data-tf-k="to" value="${esc(b.to || '')}" aria-label="ถึง"></div>` +
      `<div class="flex items-center gap-2"><div class="flex-1 min-w-0">${placeSelect(b.place, 'data-tf-k="place" aria-label="ที่ฝึก"')}</div>` +
      `<button type="button" class="${k.btn} ${k.btnGhostDanger} ${k.btnCompact} shrink-0" data-training-sheet-act="del-${kind}" data-i="${i}">ลบช่วง</button></div>${lab}</div>`;
  }
  /** The person form as typed (inputs → ui.sheet.form). */
  function readPerson() {
    const f = ui.sheet.form;
    ['name', 'nickname', 'code', 'org', 'cohort', 'start', 'end', 'note'].forEach(key => {
      const el = sheetEl.querySelector('[data-tf="' + key + '"]');
      if (el) f[key] = el.value;
    });
    const rows = kind => Array.prototype.map.call(sheetEl.querySelectorAll('[data-tf-row="' + kind + '"]'), r => {
      const g = n => { const x = r.querySelector('[data-tf-k="' + n + '"]'); return x ? x.value : ''; };
      const o = { from: g('from'), to: g('to'), place: g('place') };
      if (kind === 'extra') o.label = g('label');
      return o;
    });
    f.blocks = rows('block');
    if (f.kind === 'trainee') f.extras = rows('extra');
    if (f.kind === 'student') f.code = '';
    return f;
  }
  /** Validates a person as R5-SPEC §1 → the item to send, or {error}. Students always carry code '' (R6). */
  function itemOf(f) {
    const name = norm(f.name);
    if (!name) return { error: 'กรอกชื่อ สกุล' };
    const isY = U().isValidYmd;
    if (!isY(f.start) || !isY(f.end) || f.start > f.end) return { error: 'วันเริ่มต้องไม่หลังวันสิ้นสุด' };
    if (U().daysBetweenInclusive(f.start, f.end) > LIMITS.days) return { error: 'ช่วงเวลาต้องไม่เกิน 400 วัน' };
    const ranges = (list, label) => {
      const out = (list || []).filter(b => b.from || b.to).map(b => {
        const o = { from: b.from, to: b.to, place: PLACE_OPTIONS.indexOf(b.place) >= 0 ? b.place : 'other' };
        if (label) o.label = norm(b.label).slice(0, LIMITS.label);
        return o;
      });
      for (const b of out) {
        if (!isY(b.from) || !isY(b.to) || b.from > b.to) return { error: 'วันที่ของช่วงไม่ถูกต้อง' };
        if (b.from < f.start || b.to > f.end) return { error: 'ทุกช่วงต้องอยู่ระหว่างวันเริ่มและวันสิ้นสุด' };
      }
      return { list: out.sort((a, b) => cmp(a.from, b.from)) };
    };
    const bl = ranges(f.blocks, false);
    if (bl.error) return bl;
    if (bl.list.length > LIMITS.blocks) return { error: 'ช่วงการฝึกได้ไม่เกิน 40 ช่วง' };
    for (let i = 1; i < bl.list.length; i++) if (bl.list[i].from <= bl.list[i - 1].to) return { error: 'ช่วงการฝึกต้องไม่ซ้อนกัน' };
    const ex = ranges(f.extras, true);
    if (ex.error) return ex;
    if (ex.list.length > LIMITS.extras) return { error: 'ฝึกพิเศษได้ไม่เกิน 12 รายการ' };
    const st = f.kind === 'student';
    const item = {
      kind: st ? 'student' : 'trainee', name: name.slice(0, LIMITS.name), nickname: norm(f.nickname).slice(0, LIMITS.nickname),
      code: st ? '' : norm(f.code).slice(0, LIMITS.code),
      org: st ? norm(f.org).slice(0, LIMITS.org) : '', cohort: norm(f.cohort).slice(0, LIMITS.cohort),
      start: f.start, end: f.end, blocks: bl.list, extras: ex.list, note: noteText(f.note).slice(0, LIMITS.note)
    };
    if (f.id) { item.id = f.id; item.baseVersion = f.baseVersion | 0; }
    return { item };
  }
  async function savePerson(c) {
    const s = ui.sheet;
    if (!s || s.kind !== 'person' || ui.busy) return;
    const r = itemOf(readPerson());
    if (r.error) { showError(r.error); return; }
    await saveItems(c, [r.item], r.item.id ? '✅ บันทึกแล้ว' : '✅ เพิ่มแล้ว');
  }
  /** One saveTraining of 1–40 items; closes the sheet on success. */
  async function saveItems(c, items, okText) {
    if (ui.busy) return;
    if (!items.length) { showError('ไม่มีรายการที่บันทึกได้'); return; }
    if (items.length > LIMITS.items) { showError('บันทึกได้ครั้งละไม่เกิน 40 คน'); return; }
    if (!c.requireInternet()) return;
    const btn = sheetEl && sheetEl.querySelector('[data-training-save]');
    const label = btn ? btn.textContent : '';
    const alive = c.alive();
    ui.busy = 'save';
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'กำลังบันทึก…'; }
    try {
      await P().saveTraining({ items });
      if (!alive()) return;
      closeSheet();
      c.toast(okText || '✅ บันทึกแล้ว');
    } finally {
      ui.busy = '';
      if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = label || 'บันทึก'; }
      if (alive()) c.render();
    }
  }
  async function deletePerson(c, id) {
    const p = byId(id);
    if (!p || !c.isSup() || ui.busy) return;
    const alive = c.alive();
    if (!(await c.confirm('ลบ ' + p.name + ' ออกจากตารางฝึกงานหรือไม่?', { title: 'ลบรายชื่อ', okLabel: 'ลบ', danger: true })) || !alive()) return;
    if (!c.requireInternet()) return;
    ui.busy = 'delete';
    try {
      await P().deleteTraining({ ids: [id] });
      ui.picked.delete(id);
      if (alive()) c.toast('🗑️ ลบแล้ว');
    } finally { ui.busy = ''; if (alive()) c.render(); }
  }

  /* ---- the previews (auto / students / replan): the group view of the planned people */
  /**
   * The people of a preview that cannot be saved: [{name, reason}] — the ones the planner could not place (missing) and the
   * planned ones failing itemOf (R6 fix 3: nobody is dropped silently).
   */
  function previewProblems(list, missing) {
    const out = (missing || []).slice();
    list.forEach(p => { const r = itemOf(Object.assign({}, p, { id: p.id || '', baseVersion: p.baseVersion || 0 })); if (r.error) out.push({ name: p.name, reason: r.error }); });
    return out;
  }
  /** R6 fix 5: names typed twice in the rows, or already stored for that kind (saving still allowed). */
  function dupWarning(names, kind) {
    const seen = new Map();
    names.forEach(n => { const x = norm(n); if (x) seen.set(x, (seen.get(x) || 0) + 1); });
    const stored = new Set(ofKind(kind).map(p => norm(p.name)));
    const out = [];
    seen.forEach((cnt, n) => {
      if (cnt > 1) out.push(n + ' (ซ้ำในรายชื่อ)');
      else if (stored.has(n)) out.push(n + ' (มีอยู่แล้ว)');
    });
    return out.length ? [{ code: 'DUP_NAME', text: 'ชื่อซ้ำ: ' + out.join(', ') + ' — บันทึกได้ แต่จะเป็นคนละรายการ' }] : [];
  }
  /** A preview step: the body and whether anything can be saved. */
  function previewStep(kind, list, warnings, head, missing) {
    const problems = previewProblems(list, missing);
    const savable = list.length - (problems.length - (missing || []).length);
    return { body: previewHtml(kind, list, warnings, head, problems, savable), savable: savable > 0 };
  }
  function previewHtml(kind, list, warnings, head, problems, savable) {
    const k = K();
    const bad = problems || [];
    return `<div class="space-y-3" data-training-preview="${kind}">` +
      `<p class="${k.textBody}" data-training-preview-head>${esc(head)}</p>` +
      (bad.length ? `<div class="${k.banner} ${k.bannerDanger}" data-training-problems role="alert">${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<div class="min-w-0 break-words">` +
        `<p class="font-medium">${esc(savable > 0 ? 'บันทึกไม่ได้ ' + bad.length + ' คน (จะบันทึกเฉพาะคนที่เหลือ)' : 'ไม่มีรายการที่บันทึกได้')}</p>` +
        bad.map(x => `<p data-training-problem>${esc(x.name + ' — ' + x.reason)}</p>`).join('') + '</div></div>' : '') +
      warningsHtml(warnings, list) +
      (sharedNote(list) ? `<p class="${k.textMeta} break-words whitespace-pre-line" data-training-group-note>${esc('หมายเหตุ: ' + sharedNote(list))}</p>` : '') +
      timelineHtml(list, { preview: true }) + tableHtml(list, { preview: true, notes: !sharedNote(list) }) +
      notesHtml(list, list.some(p => p.kind === 'student') ? MSG.workNote : '') +
      `<p class="${k.textMeta}">${esc(MSG.unsaved)}</p>${errorBox()}</div>`;
  }
  async function holidaysFor(from, to) {
    const out = holidaysNow();
    const p = P();
    if (U().isValidYmd(from) && U().isValidYmd(to) && from <= to && U().daysBetweenInclusive(from, to) <= 400) {
      try { const r = await p.fetchStats(from, to); r.holidays.forEach((v, d) => out.set(d, v)); } catch (e) { /* the stored ones */ }
    }
    return out;
  }

  /* ---- เพิ่มเทคใหม่: the auto sheet (traineePlan) */
  function openAuto(c) {
    if (!c.isSup()) return;
    const start = U().addMonths(today(), 1).slice(0, 7) + '-01';
    ui.sheet = { kind: 'auto', step: 'form', form: { cohort: defaultCohort(start), cohortAuto: true, start, ipd: 3, opd: 3, note: '', rows: [blankRow(), blankRow()] } };
    openSheet('auto', 'เพิ่มเทคใหม่', autoBody(ui.sheet.form), cancelBtn() + previewBtn('auto-preview'));
  }
  function autoBody(f) {
    const k = K();
    return `<div class="space-y-3">` + linkBtn('single', 'กำหนดช่วงเอง (ทีละคน)') +
      field('taCohort', 'ชื่อรอบ', textInput('taCohort', 'cohort', f.cohort, LIMITS.cohort, ' autocomplete="off"')) +
      field('taStart', 'วันเริ่ม', dateInput('taStart', 'start', f.start), 'เริ่มวันไหนก็ได้ — นับเดือนจากวันเริ่ม') +
      `<div class="grid grid-cols-2 gap-2">${field('taIpd', 'IPD (เดือน)', numSelect('taIpd', 'ipd', f.ipd))}${field('taOpd', 'OPD (เดือน)', numSelect('taOpd', 'opd', f.opd))}</div>` +
      rowsHtml(f.rows, true) +
      field('taNote', 'หมายเหตุ (ไม่บังคับ — ใช้กับทุกคน)', noteInput('taNote', f.note)) +
      `<p class="${k.note}">${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(MSG.halfHint)} · IPD แบ่ง 3 ช่วง (IPD / Portable / ER) จัดให้ไม่ซ้ำ Station กับเทครอบอื่นเท่าที่ทำได้</span></p>` +
      errorBox() + '</div>';
  }
  function readAuto() {
    const f = ui.sheet.form;
    f.cohort = val('cohort');
    f.start = val('start');
    f.ipd = +val('ipd') || 0;
    f.opd = +val('opd') || 0;
    f.note = val('note');
    readRows();
    return f;
  }
  async function autoPreview(c) {
    const s = ui.sheet;
    if (!s || s.kind !== 'auto' || s.step !== 'form') return;
    const f = readAuto();
    const rows = f.rows.filter(r => norm(r.name));
    if (!rows.length) { showError('ใส่รายชื่ออย่างน้อย 1 คน'); return; }
    if (rows.length > LIMITS.items) { showError('ได้ครั้งละไม่เกิน 40 คน'); return; }
    if (!U().isValidYmd(f.start)) { showError('เลือกวันเริ่ม'); return; }
    if (f.ipd + f.opd === 0) { showError('จำนวนเดือน IPD + OPD ต้องมากกว่า 0'); return; }
    const per = TE.traineePeriods(f.start, f.ipd + f.opd);
    const alive = c.alive();
    const hol = await holidaysFor(f.start, per.length ? per[per.length - 1].to : f.start);
    if (!alive() || ui.sheet !== s) return;
    const cohort = norm(f.cohort).slice(0, LIMITS.cohort);
    const note = noteText(f.note).slice(0, LIMITS.note);
    const res = TE.traineePlan({
      people: rows.map(r => ({ name: norm(r.name).slice(0, LIMITS.name), nickname: norm(r.nickname).slice(0, LIMITS.nickname), code: norm(r.code).slice(0, LIMITS.code), note })),
      start: f.start, ipdMonths: f.ipd, opdMonths: f.opd, holidays: hol, existing: trainees(), cohort
    });
    if (!res.people.length) { showError((res.warnings[0] && res.warnings[0].text) || 'สร้างตารางไม่ได้'); return; }
    s.step = 'preview';
    s.result = res.people;
    const st = previewStep('auto', res.people, dupWarning(rows.map(r => r.name), 'trainee').concat(res.warnings), (cohort || MSG.noCohort) + ' · ' + res.people.length + ' คน · ' + TE.rangeText(res.start, res.end));
    paintSheet(st.body, backBtn() + saveBtn('บันทึกทั้งหมด', !st.savable));
  }
  function autoBack() {
    const s = ui.sheet;
    if (!s || !s.form) return;
    s.step = 'form';
    s.result = null;
    if (s.kind === 'auto') paintSheet(autoBody(s.form), cancelBtn() + previewBtn('auto-preview'));
    else if (s.kind === 'students') paintSheet(studentsBody(s.form), cancelBtn() + previewBtn('students-preview'));
  }

  /* ---- เพิ่มนักศึกษา: the students sheet (studentPlan) */
  function openStudents(c) {
    if (!c.isSup()) return;
    const t = today();
    ui.sheet = { kind: 'students', step: 'form', form: { org: '', cohort: '', start: t, end: U().addDays(t, 27), note: '', rows: [blankRow(), blankRow()] } };
    openSheet('students', 'เพิ่มนักศึกษา', studentsBody(ui.sheet.form), cancelBtn() + previewBtn('students-preview'));
  }
  function studentsBody(f) {
    const k = K();
    return `<div class="space-y-3">` + linkBtn('single', 'เพิ่มทีละคน (กำหนดช่วงเอง)') +
      field('tsOrg', 'มหาวิทยาลัย', textInput('tsOrg', 'org', f.org, LIMITS.org, ' list="trainingOrgs" autocomplete="off"')) + orgList() +
      field('tsCohort', 'กลุ่ม (ไม่บังคับ)', textInput('tsCohort', 'cohort', f.cohort, LIMITS.cohort)) +
      `<div class="grid grid-cols-2 gap-2">${field('tsStart', 'เริ่ม', dateInput('tsStart', 'start', f.start))}${field('tsEnd', 'สิ้นสุด', dateInput('tsEnd', 'end', f.end))}</div>` +
      rowsHtml(f.rows, false) +
      field('tsNote', 'หมายเหตุ (ไม่บังคับ — ใช้กับทุกคน)', noteInput('tsNote', f.note)) +
      `<p class="${k.note}">${icon('info', 'w-5 h-5 shrink-0 mt-0.5')}<span>IPD (IPD, ER, Portable) และ OPD อย่างละครึ่ง ${esc(MSG.workNote)} — คนที่เริ่มพร้อมกันแบ่งครึ่ง เริ่ม IPD ครึ่งหนึ่ง OPD ครึ่งหนึ่ง</span></p>` +
      errorBox() + '</div>';
  }
  function readStudents() {
    const f = ui.sheet.form;
    ['org', 'cohort', 'start', 'end', 'note'].forEach(key => { f[key] = val(key); });
    readRows();
    return f;
  }
  async function studentsPreview(c) {
    const s = ui.sheet;
    if (!s || s.kind !== 'students' || s.step !== 'form') return;
    const f = readStudents();
    const rows = f.rows.filter(r => norm(r.name));
    if (!rows.length) { showError('ใส่รายชื่ออย่างน้อย 1 คน'); return; }
    if (rows.length > LIMITS.items) { showError('ได้ครั้งละไม่เกิน 40 คน'); return; }
    if (!U().isValidYmd(f.start) || !U().isValidYmd(f.end) || f.start > f.end) { showError('วันเริ่มต้องไม่หลังวันสิ้นสุด'); return; }
    if (U().daysBetweenInclusive(f.start, f.end) > LIMITS.days) { showError('ช่วงเวลาต้องไม่เกิน 400 วัน'); return; }
    const org = norm(f.org).slice(0, LIMITS.org), cohort = norm(f.cohort).slice(0, LIMITS.cohort), note = noteText(f.note).slice(0, LIMITS.note);
    const list = rows.map((r, i) => ({ id: 'new' + i, name: norm(r.name).slice(0, LIMITS.name), nickname: norm(r.nickname).slice(0, LIMITS.nickname), code: '', org, cohort, start: f.start, end: f.end, note }));
    const alive = c.alive();
    const hol = await holidaysFor(f.start, f.end);
    if (!alive() || ui.sheet !== s) return;
    const res = TE.studentPlan({ students: list, holidays: hol, existing: students() });
    res.students.forEach(x => { delete x.id; });
    s.step = 'preview';
    s.result = res.students;
    const st = previewStep('students', res.students, dupWarning(rows.map(r => r.name), 'student').concat(res.warnings), (org || MSG.noOrg) + ' · ' + res.students.length + ' คน · ' + TE.rangeText(f.start, f.end));
    paintSheet(st.body, backBtn() + saveBtn('บันทึกทั้งหมด', !st.savable));
  }

  /* ---- จัดใหม่ (ticked people of the segment) */
  /**
   * The re-plan of stored people (ids) of one kind from the current store → {list, result, warnings, missing}.
   * Trainees: per (cohort, start, month counts) in the cohort's order, each keeping its stored side (ipdFirst) and the IPD
   * parts that started before today (keepBefore); existing = the other trainees, then the ones planned before.
   */
  async function computeReplan(kind, ids) {
    const want = new Set(ids);
    const list = ofKind(kind).filter(p => want.has(p.id));
    if (!list.length) return null;
    const gone = ids.filter(id => !list.some(p => p.id === id));
    let from = list[0].start, to = list[0].end;
    list.forEach(p => { if (p.start < from) from = p.start; if (p.end > to) to = p.end; });
    const hol = await holidaysFor(from, to);
    let result = [], warnings = [];
    const missing = gone.map(() => ({ name: 'อีก 1 คนที่เลือกไว้', reason: 'ถูกลบจากเครื่องอื่นแล้ว' }));
    if (kind === 'student') {
      const res = TE.studentPlan({ students: list.map(p => Object.assign(clone(p), { baseVersion: p.version, code: '' })), holidays: hol, existing: students() });
      result = res.students; warnings = res.warnings;
    } else {
      let current = trainees().filter(p => !want.has(p.id));
      const order = groups('trainee').reduce((acc, g) => acc.concat(g.people.filter(p => want.has(p.id))), []);
      const sets = new Map();
      order.forEach(p => {
        const m = TE.traineeMonths(p);
        const key = p.cohort + '|' + p.start + '|' + m.ipdMonths + '|' + m.opdMonths;
        if (!sets.has(key)) sets.set(key, { m, people: [] });
        sets.get(key).people.push(p);
      });
      sets.forEach(set => {
        const ps = set.people;
        const res = TE.traineePlan({
          people: ps.map(p => Object.assign(clone(p), { baseVersion: p.version, ipdFirst: sideOf(p) === 'ipd' })),
          start: ps[0].start, ipdMonths: set.m.ipdMonths, opdMonths: set.m.opdMonths,
          holidays: hol, existing: current, cohort: ps[0].cohort, keepBefore: today()
        });
        if (!res.people.length) {
          const why = (res.warnings[0] && res.warnings[0].text.replace(/^[^:]*:\s*/, '')) || 'จัดตารางไม่ได้';
          ps.forEach(p => missing.push({ name: p.name, reason: why }));
          return;
        }
        current = current.concat(res.people);
        result = result.concat(res.people);
        warnings = warnings.concat(res.warnings);
      });
    }
    return { list, result, warnings, missing };
  }
  function replanStep(kind, r) {
    const head = (kind === 'student' ? 'นักศึกษา' : 'เทคใหม่') + ' · ' + r.result.length + ' คน';
    return previewStep('replan', r.result, r.warnings, head, r.missing);
  }
  async function openReplan(c) {
    if (!c.isSup()) return;
    const kind = segKind();
    const ids = pickedOf(kind).map(p => p.id);
    if (!ids.length) return;
    const alive = c.alive();
    const r = await computeReplan(kind, ids);
    if (!alive() || !r) return;
    ui.sheet = { kind: 'replan', step: 'preview', of: kind, ids, result: r.result };
    const st = replanStep(kind, r);
    openSheet('replan', 'จัดใหม่ ' + r.list.length + ' คน', st.body, cancelBtn() + saveBtn('บันทึก', !st.savable));
  }
  /** R6 fix 4: after a CONFLICT the preview is planned again from the fresh store (new baseVersions). */
  async function refreshPreview(c) {
    const s = ui.sheet;
    if (!s) return;
    if (s.kind === 'replan') {
      // the CONFLICT applied the server's rows; fetch again so every ticked person is current
      const p = P();
      if (p && typeof p.refresh === 'function') { try { await p.refresh(); } catch (e) { /* the rows held */ } }
      if (ui.sheet !== s) return;
      const r = await computeReplan(s.of, s.ids);
      if (ui.sheet !== s) return;
      if (!r) { closeSheet(); return; }
      s.result = r.result;
      const st = replanStep(s.of, r);
      paintSheet(st.body, cancelBtn() + saveBtn('บันทึก', !st.savable));
    } else if ((s.kind === 'auto' || s.kind === 'students') && s.form) {
      s.step = 'form';
      await (s.kind === 'auto' ? autoPreview(c) : studentsPreview(c));
    }
  }
  /** The planned people of a preview → the items of one saveTraining. */
  function resultItems() {
    const s = ui.sheet;
    return (s.result || []).map(p => {
      const r = itemOf(Object.assign({}, p, { id: p.id || '', baseVersion: p.baseVersion || 0 }));
      return r.item || null;
    }).filter(Boolean);
  }

  /* ---------------------------------------------------------------- export per group (R6-SPEC §3.2) */
  /*
   * Inline styles only (html2canvas), black / white like the unit's own sheets, 880 px wide, drawn at scale 2. No codes.
   */
  const CELL = 'border-right:1px solid #000000;border-bottom:1px solid #000000;padding:6px 8px;text-align:center;vertical-align:middle;line-height:22px;';
  const TABLE = 'width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border-top:1px solid #000000;border-left:1px solid #000000;';
  function exportShell(inner, kind) {
    const node = document.createElement('div');
    node.setAttribute('data-training-export', 'group');
    node.setAttribute('data-export-kind', kind);
    node.style.cssText = 'width:' + EXPORT_WIDTH + 'px;box-sizing:border-box;padding:20px 24px 24px;background:#ffffff;color:#000000;font-family:' + EXPORT_FONT + ';';
    node.innerHTML = inner;
    return node;
  }
  function exportTitle(g) {
    return g.kind === 'student' ? 'ตารางฝึกงานนักศึกษา — ' + (g.key || MSG.noOrg) : 'ตารางฝึกงานเทคใหม่' + (g.key ? ' — ' + g.key : '');
  }
  function exportFile(g) { return 'ตารางฝึกงาน-' + fileSafe(g.key || (g.kind === 'student' ? MSG.noOrg : 'เทคใหม่')) + '.png'; }
  function exportHtml(g) {
    const lines = [exportTitle(g), spanText(g.people) + ' · ' + g.people.length + ' คน'];
    let html = lines.map((t, i) => `<div style="font-size:${i ? 16 : 20}px;font-weight:700;text-align:center;line-height:30px;${i === lines.length - 1 ? 'margin:0 0 14px;' : ''}" data-export-title="${i + 1}">${esc(t)}</div>`).join('');
    html += `<table style="${TABLE}"><colgroup><col style="width:28%">${'<col>'.repeat(TABLE_PLACES.length)}</colgroup><thead><tr>` +
      `<th style="${CELL}font-size:15px;font-weight:700;">ชื่อ-สกุล (ชื่อเล่น)</th>` + TABLE_PLACES.map(pl => `<th style="${CELL}font-size:15px;font-weight:700;">${esc(placeLabel(pl))}</th>`).join('') + '</tr></thead><tbody>';
    g.people.forEach(p => {
      const r = TE.placeRanges(p);
      html += `<tr data-export-row><td style="${CELL}font-size:15px;text-align:left;"><div>${esc(p.name)}</div>${p.nickname ? `<div>(${esc(p.nickname)})</div>` : ''}</td>` +
        TABLE_PLACES.map(pl => `<td style="${CELL}font-size:14px;" data-export-place="${pl}">${r[pl].map(x => `<div>${esc(TE.rangeText(x[0], x[1]))}</div>`).join('')}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table>';
    const notes = footnotes(g.people);
    const shared = sharedNote(g.people);
    const lower = [];
    notes.forEach(t => lower.push(`<div data-export-note>${esc(t)}</div>`));
    if (shared) lower.push(`<div style="white-space:pre-line;" data-export-group-note>${esc('หมายเหตุ: ' + shared)}</div>`);
    else g.people.forEach(p => { if (noteText(p.note)) lower.push(`<div style="white-space:pre-line;" data-export-person-note>${esc('หมายเหตุ ' + TE.shortName(p) + ': ' + noteText(p.note))}</div>`); });
    if (g.kind === 'student') lower.push(`<div data-export-footnote>${esc(MSG.workNote)}</div>`);
    if (lower.length) html += `<div style="margin-top:12px;font-size:15px;line-height:24px;">${lower.join('')}</div>`;
    return html;
  }
  function exportGroup() {
    const s = ui.sheet;
    if (!s || s.kind !== 'export') return null;
    return groups(s.of).filter(g => g.key === s.key)[0] || null;
  }
  function openExport(c, gi) {
    const kind = segKind();
    const g = groups(kind)[gi];
    if (!g) return;
    ui.sheet = { kind: 'export', of: kind, key: g.key };
    const k = K();
    const body = `<p class="${k.textBody} break-words">${esc(exportTitle(g))}</p>` +
      `<p class="${k.label}">ตัวอย่าง</p><div class="relative w-full overflow-hidden rounded-xl border-2 border-ink-200 bg-white" data-training-export-preview aria-hidden="true"></div>` +
      `<p class="${k.textMeta} ${k.wrapAnywhere}" data-training-export-file></p>`;
    openSheet('export', 'ส่งออกเป็นรูป (PNG)', body, cancelBtn('ปิด') +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-export-save>${icon('image')}บันทึกรูป PNG</button>`);
    const scroller = sheetEl.querySelector('[data-training-sheet-body]');
    if (scroller) scroller.style.scrollbarGutter = 'stable';
    showExport();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fitPreview);
  }
  function showExport() {
    const g = exportGroup();
    if (!g || !sheetEl) return;
    const box = sheetEl.querySelector('[data-training-export-preview]');
    const file = sheetEl.querySelector('[data-training-export-file]');
    if (box) {
      box.innerHTML = '';
      const node = exportShell(exportHtml(g), g.kind);
      node.style.position = 'absolute';
      node.style.left = '0';
      node.style.top = '0';
      node.style.transformOrigin = '0 0';
      box.appendChild(node);
    }
    if (file) file.textContent = 'ไฟล์: ' + exportFile(g);
    fitPreview();
  }
  function fitPreview() {
    if (!sheetEl || !ui.sheet || ui.sheet.kind !== 'export') return;
    const box = sheetEl.querySelector('[data-training-export-preview]');
    const node = box && box.firstElementChild;
    if (!node) return;
    for (let i = 0; i < 3; i++) {
      const w = box.clientWidth;
      if (!w) return;
      const sc = Math.min(1, w / EXPORT_WIDTH);
      node.style.transform = 'scale(' + sc + ')';
      box.style.height = Math.ceil(node.offsetHeight * sc) + 'px';
      if (box.clientWidth === w) return;
    }
  }
  async function saveExport(c) {
    const g = exportGroup();
    if (!g || ui.busy) return;
    const btn = sheetEl.querySelector('[data-training-export-save]');
    const label = btn ? btn.innerHTML : '';
    ui.busy = 'image';
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'กำลังสร้างรูป…'; }
    try {
      await c.shareImage(exportShell(exportHtml(g), g.kind), exportFile(g), { width: EXPORT_WIDTH, scale: EXPORT_SCALE });
    } finally {
      ui.busy = '';
      if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = label; }
    }
  }

  /* ---------------------------------------------------------------- events */
  function onSheetClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !c || !ui.sheet) return;
    const s = ui.sheet;
    if (t.closest('[data-training-export-save]')) { c.spawn(() => saveExport(c)); return; }
    const a = t.closest('[data-training-sheet-act]');
    if (a) {
      if (a.disabled) return;
      const act = a.dataset.trainingSheetAct;
      const i = +a.dataset.i;
      if (/^row-(add|up|down|del)$/.test(act) && s.form && s.form.rows) { rowsAct(act, i); return; }
      if (act === 'single') { openPerson(s.kind === 'students' ? 'student' : 'trainee'); return; }
      if (act === 'auto-preview') { c.spawn(() => autoPreview(c)); return; }
      if (act === 'students-preview') { c.spawn(() => studentsPreview(c)); return; }
      if (act === 'back') { autoBack(); return; }
      if (s.kind === 'person' && /^(add|del)-(block|extra)$/.test(act)) {
        const f = readPerson();
        const kind = act.slice(4);
        const list = kind === 'block' ? f.blocks : f.extras;
        if (act.slice(0, 3) === 'add') {
          const last = list[list.length - 1];
          const from = last && U().isValidYmd(last.to) ? U().addDays(last.to, 1) : f.start;
          list.push(kind === 'block' ? { from, to: f.end, place: 'ipd' } : { from, to: from, place: 'us', label: 'ฝึก US' });
        } else list.splice(i, 1);
        paintSheet(personBody(f));
      }
      return;
    }
    if (t.closest('[data-training-save]')) {
      if (s.kind === 'person') c.spawn(() => savePerson(c), { write: true });
      else if ((s.kind === 'auto' || s.kind === 'students' || s.kind === 'replan') && s.step === 'preview') {
        const ok = s.kind === 'auto' ? '✅ บันทึกตารางฝึกงานเทคใหม่แล้ว' : s.kind === 'students' ? '✅ บันทึกตารางนักศึกษาแล้ว' : '✅ จัดใหม่แล้ว';
        c.spawn(async () => {
          try { await saveItems(c, resultItems(), ok); } catch (err) {
            if (err && err.code === 'CONFLICT' && ui.sheet === s) await refreshPreview(c);
            throw err;
          }
          if (s.kind === 'replan' && !ui.sheet) ui.picked.clear();
          c.render();
        }, { write: true });
      }
    }
  }
  function onSheetChange(e) {
    const t = e && e.target;
    const s = ui.sheet;
    if (!t || !t.matches || !s) return;
    if (s.kind === 'auto' && s.form && t.matches('[data-tf="start"]') && s.form.cohortAuto) {
      const el = sheetEl.querySelector('[data-tf="cohort"]');
      if (el) { el.value = defaultCohort(t.value) || el.value; s.form.cohort = el.value; }
    }
  }
  function onSheetInput(e) {
    const t = e && e.target;
    const s = ui.sheet;
    if (t && t.matches && s && s.kind === 'auto' && s.form && t.matches('[data-tf="cohort"]')) s.form.cohortAuto = false;
  }
  function onRootClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !c || !root) return;
    const sg = t.closest('[data-training-seg]');
    if (sg) { if (ui.seg !== sg.dataset.trainingSeg) ui.picked.clear(); ui.seg = sg.dataset.trainingSeg; c.render(); return; }
    const who = t.closest('[data-training-who]');
    if (who) { toggleWho(who); return; }
    const a = t.closest('[data-training-act]');
    if (!a || a.disabled) return;
    const act = a.dataset.trainingAct;
    if (act === 'retry') { const p = P(); if (p) c.track(p.refresh()); c.render(); return; }
    if (act === 'add-trainees') { openAuto(c); return; }
    if (act === 'add-students') { openStudents(c); return; }
    if (act === 'replan') { c.spawn(() => openReplan(c)); return; }
    if (act === 'edit') { const p = byId(a.dataset.id); if (p) openPerson(p.kind, p.id); return; }
    if (act === 'delete') { c.spawn(() => deletePerson(c, a.dataset.id), { write: true }); return; }
    if (act === 'export') { openExport(c, +a.dataset.i); }
  }
  /** A name of the day card: the short name ↔ the full name. */
  function toggleWho(el) {
    const full = el.dataset.full, short = el.dataset.short;
    el.textContent = el.textContent === full ? short : full;
  }
  function onRootKey(e) {
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('[data-training-who]')) { e.preventDefault(); toggleWho(t); }
  }
  function onRootChange(e) {
    const t = e.target;
    if (!t || !core) return;
    if (t.matches('[data-training-day-input]')) { if (U().isValidYmd(t.value)) { ui.day = t.value; core.render(); } return; }
    if (t.matches('[data-training-pick]')) {
      if (t.checked) ui.picked.add(t.dataset.trainingPick); else ui.picked.delete(t.dataset.trainingPick);
      core.render();
    }
  }

  /* ---------------------------------------------------------------- registration */
  App.register({
    id: ID,
    title: 'ตารางฝึกงาน',
    icon: 'school',
    nav: { place: 'menu', section: 'mine', order: 30 },
    parent: 'menu',
    visible: c => c.serverHas('training'),
    init(c) {
      core = c;
      c.provide('training.station', stationLines);
      c.provide('training.myDay', myDay);
      c.on('logout', () => { closeSheet(); });
      c.on('role', () => { closeSheet(); ui.picked.clear(); });
    },
    mount(el) {
      root = el;
      el.addEventListener('click', onRootClick);
      el.addEventListener('change', onRootChange);
      el.addEventListener('keydown', onRootKey);
      const refit = () => { fitPreview(); if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fitPreview); };
      window.addEventListener('resize', refit);
      window.addEventListener('orientationchange', refit);
    },
    render(el, c) { renderScreen(el, c); },
    show(c, params) {
      const prm = params && typeof params === 'object' ? params : {};
      if (!ui.seg) ui.seg = 'trainee';
      if (prm.seg && SEGS.some(s => s.id === prm.seg)) { if (prm.seg !== ui.seg) ui.picked.clear(); ui.seg = prm.seg; }
      if (prm.day && U().isValidYmd(prm.day)) ui.day = prm.day;
      const p = P();
      if (p) {
        const d = U().parseYmd(c.selectedDate()) || U().parseYmd(today());
        const from = U().ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to = U().ymd(new Date(d.getFullYear(), d.getMonth() + 2, 0));
        c.track(p.ensure(from, to));
      }
    },
    hide() { closeSheet(); },
    reset() {
      closeSheet();
      if (sheetEl) { sheetEl.remove(); sheetEl = null; }
      ui.seg = ''; ui.day = ''; ui.busy = ''; ui.sheet = null; ui.picked.clear();
      if (root) { root.innerHTML = ''; root._html = ''; }
    }
  });
})();
