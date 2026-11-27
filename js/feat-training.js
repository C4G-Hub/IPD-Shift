/* =====================================================================
 * js/feat-training.js — feature "training" (ตารางฝึกงาน): trainee rotations and student schedules (R5-SPEC §3.3 / §3.4)
 *
 * Data: core.use('plan') (js/plan-data.js: training(), trainingOn(date), saveTraining, deleteTraining, holidays(),
 * fetchStats) only. Engine: window.TrainingEngine (js/training-engine.js, pure). Everything is gated on
 * core.serverHas('training') (Code.gs 3.4): a 3.3 server shows no entry, no line on วันนี้ and sends nothing.
 *
 *  - Screen 'training' (เมนู → ของฉัน, order 30, "ตารางฝึกงาน", icon school; everyone views, the Supervisor edits).
 *    Segments เทคใหม่ · นักศึกษา ([data-training-seg]).
 *    เทคใหม่: one card per cohort ([data-training-cohort], trainees grouped by `cohort`, '' = the unnamed group) with picture
 *    A's table on screen (TrainingEngine.periodRows: the period column + one column per trainee, the IPD station of the
 *    period, a dark "OPD" cell; the wrapper scrolls sideways on its own, the page never does), the footnotes of the extras
 *    ("***(26-30 ต.ค.) <first name> ฝึก US") and one row per person: name (nickname), code (Supervisor), the IPD / OPD summary
 *    (ipdOpdSummary), edit / delete (Supervisor). "ส่งออกเป็นรูป" per cohort.
 *    นักศึกษา: a date picker "วันที่" with who is where that day (IPD / ER / Portable / OPD; working days only), then one
 *    card per university (org; '' = "ไม่ระบุมหาวิทยาลัย") with the students by start: name, period, the blocks as chips
 *    ("IPD 1–5 ธ.ค."), a checkbox (Supervisor, for "จัดใหม่") and edit / delete; "ส่งออกเป็นรูป" per university.
 *  - Supervisor flows (one sheet element, kinds person · gen · students · replan · export):
 *    "เพิ่มเทคใหม่" / "เพิ่มนักศึกษา" (single) / edit = the person sheet (name, nickname, code, university or cohort, start,
 *    end, the blocks editor — rows from–to + place, "เพิ่มช่วง", "ลบช่วง" — the extras editor with a label for trainees,
 *    note) → saveTraining {items: [one]}; delete asks first → deleteTraining.
 *    "สร้างตารางวนอัตโนมัติ" (gen): the cohort name, new people one per line "ชื่อ สกุล, ชื่อเล่น, รหัส" plus ticks for the stored
 *    trainees of that cohort, start date, unit เดือน / 4 สัปดาห์, IPD / OPD months → TrainingEngine.traineePlan → a preview
 *    (picture A's table) → "บันทึกทั้งหมด" = ONE saveTraining (stored people keep id + baseVersion).
 *    "เพิ่มนักศึกษา" → "หลายคนพร้อมกัน" (students): university, group label, start, end, names one per line ("ชื่อ สกุล" or
 *    "ชื่อ สกุล, รหัส", ≤ 40) → TrainingEngine.studentPlan with existing = the stored students and the holidays of the
 *    period (plan.holidays() + plan.fetchStats(start, end).holidays) → preview (chips) → one saveTraining.
 *    "จัดใหม่" (replan): the ticked students → studentPlan (existing = the other stored students) → preview → save.
 *    Errors go through core.spawn({write: true}) → core.handleError (CONFLICT: plan-data already applied the server's rows).
 *  - Exports (core.shareImage(node, file, {width: 880, scale: 2}); inline styles, black / white like R4's pictures):
 *    per cohort "ตารางวน (IPD)" = picture A (title "ตารางนักรังสีการแพทย์ (<cohort>)" or "ตารางวนนักรังสีการแพทย์", line 2
 *    "แผนกผู้ป่วยใน (IPD)", header "ชื่อ สกุล" over "(ชื่อเล่น)", black cells for OPD / none, footnotes) and "ตารางสรุป
 *    IPD/OPD" = picture B (รายชื่อ | IPD | OPD; the name cell "ชื่อ สกุล" / "(รหัส)" — the Supervisor only — / ชื่อเล่น);
 *    per university (or every student, "ทุกมหาวิทยาลัย") "ตารางหมุนเวียนนักศึกษาฝึกงาน <มหาวิทยาลัย>" + the period, ชื่อ-สกุล |
 *    IPD | ER | Portable | OPD with the date ranges ("1–5 ธ.ค. 2569"), footnote "นับเฉพาะวันทำการ (ไม่รวมเสาร์-อาทิตย์และวันหยุด)".
 *    The export sheet: radio rows, a preview scaled to the sheet width, "บันทึกรูป PNG".
 *  - วันนี้ (R5-SPEC §3.4) — services read by the core:
 *    core.provide('training.station', (date, slots) → {[stationId]: [names]}): on a working day the trainees (never students)
 *    at each station (ipd / portable / er, and us / or / cancer through an extra), nickname else first name, leaving out a
 *    trainee whose own staff account already sits in that station's slots (TrainingEngine.stationTrainees); {} otherwise.
 *    core.provide('training.myDay', (date, name) → [{icon, tone, main}]): "ฝึกงาน <Station>" for the trainees linked to the
 *    logged-in account (TrainingEngine.linkStaff: trainees log in as "<first name>(Trainee)"; the Supervisor's plain name
 *    never links by first name).
 * DOM hooks for tests: #tab-training [data-training-screen] (data-seg, data-state), [data-training-seg], [data-training-act],
 * [data-training-cohort] (data-cohort), [data-training-table], [data-training-person="<id>"], [data-training-org],
 * [data-training-student="<id>"], [data-training-chip], [data-training-day], the sheet [data-training-sheet="<kind>"] with
 * [data-tf="<field>"], [data-tf-row="block|extra"], [data-training-preview], [data-training-error], [data-training-save],
 * export: [data-training-export-pick], [data-training-export-preview], [data-training-export="trainA|trainB|students"].
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
  const LIMITS = { name: 80, nickname: 30, code: 20, org: 80, cohort: 60, note: 200, label: 30, blocks: 40, extras: 12, days: 400, items: 40 };
  const EXPORT_WIDTH = 880;
  const EXPORT_SCALE = 2;
  const EXPORT_FONT = 'Sarabun,"Noto Sans Thai","Leelawadee UI",sans-serif';
  const MSG = {
    cached: 'ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)',
    noTrainee: 'ยังไม่มีตารางวนของเทคใหม่',
    noStudent: 'ยังไม่มีนักศึกษาฝึกงาน',
    workNote: 'นับเฉพาะวันทำการ (ไม่รวมเสาร์-อาทิตย์และวันหยุด)',
    noOrg: 'ไม่ระบุมหาวิทยาลัย',
    noCohort: 'เทคใหม่ (ไม่ระบุรอบ)'
  };

  let core = null;
  let root = null;
  let sheetEl = null;
  const ui = {
    seg: '',          // 'trainee' | 'student'
    day: '',          // the นักศึกษา date picker
    picked: new Set(),// ticked students (จัดใหม่)
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
  function trainees() { return people().filter(x => x.kind === 'trainee'); }
  function students() { return people().filter(x => x.kind === 'student'); }
  function byId(id) { return people().filter(x => x.id === id)[0] || null; }
  function norm(v) { return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function clone(v) { return v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)); }
  function placeLabel(p) { return TE.PLACE_LABEL[p] || p; }
  function fileSafe(s) { return norm(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'ตาราง'; }
  function weekdayWord(date) { return U().thaiDateShort(date, { weekday: true }); }
  /** A trainee's rank in the rotation: IPD-first people before OPD-first ones, then by the first station (ipd, portable, er). */
  function rotationRank(p) {
    const b = (p.blocks || [])[0];
    const i = b ? TE.CYCLE.indexOf(b.place) : -1;
    return i >= 0 ? i : b && b.place === 'opd' ? 10 : 20;
  }
  /** Trainees grouped by cohort → [{cohort, people}] by the earliest start; people by start, rotation rank, name. */
  function cohorts() {
    const map = new Map();
    trainees().forEach(p => { if (!map.has(p.cohort)) map.set(p.cohort, []); map.get(p.cohort).push(p); });
    const out = Array.from(map.entries()).map(([cohort, list]) => ({ cohort, people: list.slice().sort((a, b) => cmp(a.start, b.start) || rotationRank(a) - rotationRank(b) || cmp(a.name, b.name)) }));
    return out.sort((a, b) => cmp(a.people[0].start, b.people[0].start) || cmp(a.cohort, b.cohort));
  }
  /** Students grouped by university → [{org, people}] (people by start, then name). */
  function orgs() {
    const map = new Map();
    students().forEach(p => { if (!map.has(p.org)) map.set(p.org, []); map.get(p.org).push(p); });
    const out = Array.from(map.entries()).map(([org, list]) => ({ org, people: list.slice().sort((a, b) => cmp(a.start, b.start) || cmp(a.name, b.name)) }));
    return out.sort((a, b) => cmp(a.people[0].start, b.people[0].start) || cmp(a.org, b.org));
  }
  function cohortTitle(c) { return c ? c : MSG.noCohort; }
  function periodOf(list) {
    let from = '', to = '';
    list.forEach(p => { if (!from || p.start < from) from = p.start; if (!to || p.end > to) to = p.end; });
    return from ? TE.rangeText(from, to) : '';
  }
  function holidaysNow() { const p = P(); return p ? p.holidays() : new Map(); }

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
      html += ui.seg === 'student' ? studentSegHtml(c) : traineeSegHtml(c);
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

  /* ---- เทคใหม่ */
  function traineeSegHtml(c) {
    const k = K();
    let html = '';
    if (c.isSup()) {
      html += `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-training-tools>${actBtn('gen', 'wand', 'สร้างตารางวนอัตโนมัติ', k.btnPrimary)}${actBtn('add-trainee', 'user', 'เพิ่มเทคใหม่')}</div>`;
    }
    const list = cohorts();
    if (!list.length) return html + emptyCard('trainee', MSG.noTrainee, c.isSup() ? 'กด "สร้างตารางวนอัตโนมัติ" เพื่อจัดตารางวนของเทครอบใหม่' : 'Supervisor ยังไม่ได้จัดตารางวนของเทคใหม่');
    list.forEach((g, gi) => { html += cohortCard(c, g, gi); });
    return html;
  }
  /** Picture A's table on screen: period | one column per trainee. */
  function rotationTable(list, opts) {
    const k = K();
    const pr = TE.periodRows(list);
    const th = 'px-1.5 py-2 text-xs font-medium leading-4 text-ink-800 bg-cream-50 border-b-2 border-brand-100 align-bottom';
    let html = `<div class="overflow-x-auto overscroll-x-contain rounded-2xl border-2 border-brand-100" data-training-table${opts && opts.preview ? '="preview"' : ''}>` +
      `<table class="w-full border-collapse text-left"><thead><tr><th scope="col" class="${th} min-w-[6.5rem]">ช่วงเวลาการฝึก</th>` +
      list.map(p => `<th scope="col" class="${th} text-center min-w-[4rem]"><span class="block break-words">${esc(TE.shortName(p))}</span></th>`).join('') + '</tr></thead><tbody>';
    pr.rows.forEach(r => {
      html += `<tr class="border-t border-brand-100" data-training-period="${esc(r.from)}"><th scope="row" class="px-1.5 py-2 text-xs font-medium leading-5 text-ink-800 align-middle">${esc(r.label)}</th>` +
        r.places.map(pl => (pl && pl !== 'opd'
          ? `<td class="px-1.5 py-2 text-center text-sm font-medium leading-5 text-ink-900" data-place="${pl}">${esc(placeLabel(pl))}</td>`
          : `<td class="px-1.5 py-2 text-center text-xs font-medium leading-5 bg-ink-800 text-white" data-place="${pl || 'none'}">${pl ? 'OPD' : ''}</td>`)).join('') + '</tr>';
    });
    html += '</tbody></table></div>';
    const notes = footnotes(list);
    if (notes.length) html += `<ul class="space-y-0.5 ${k.textMeta} ${k.wrapAnywhere}" data-training-notes>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
    return html;
  }
  function footnotes(list) {
    const out = [];
    list.forEach(p => (p.extras || []).forEach(x => { const t = TE.extraNote(p, x); if (t) out.push(t); }));
    return out;
  }
  function cohortCard(c, g, gi) {
    const k = K();
    const sup = c.isSup();
    const rows = g.people.map(p => {
      const s = TE.ipdOpdSummary(p);
      const meta = [p.nickname ? '(' + p.nickname + ')' : '', sup && p.code ? 'รหัส ' + p.code : ''].filter(Boolean).join(' ');
      return `<li class="py-2.5 flex items-start gap-2" data-training-person="${esc(p.id)}"><div class="min-w-0 flex-1">` +
        `<p class="text-sm font-medium leading-6 text-ink-900 break-words">${esc(p.name)}${meta ? ` <span class="${k.textMeta}">${esc(meta)}</span>` : ''}</p>` +
        `<p class="${k.textMeta}" data-training-summary>IPD ${esc(s.ipd || '-')} · OPD ${esc(s.opd || '-')}</p></div>` +
        (sup ? editButtons(p) : '') + '</li>';
    }).join('');
    return `<section class="${k.card} space-y-3 min-w-0" data-training-cohort="${gi}" data-cohort="${esc(g.cohort)}">` +
      `<div class="flex flex-wrap items-center gap-2"><div class="min-w-0 flex-1"><h2 class="${k.titleCard} break-words">${esc(cohortTitle(g.cohort))}</h2>` +
      `<p class="${k.textMeta}">${esc(g.people.length + ' คน · ' + periodOf(g.people))}</p></div>` +
      `<button type="button" class="${k.btn} ${k.btnTonal} ${k.btnCompact}" data-training-act="export-cohort" data-i="${gi}">${icon('image', 'w-4 h-4')}ส่งออกเป็นรูป</button></div>` +
      rotationTable(g.people) + `<ul class="divide-y-2 divide-brand-50">${rows}</ul></section>`;
  }
  function editButtons(p) {
    const k = K();
    return `<span class="shrink-0 inline-flex items-center gap-1">` +
      `<button type="button" class="${k.iconBtnRound}" data-training-act="edit" data-id="${esc(p.id)}" aria-label="${esc('แก้ไข ' + p.name)}">${icon('pencil')}</button>` +
      `<button type="button" class="${k.iconBtnRound}" data-training-act="delete" data-id="${esc(p.id)}" aria-label="${esc('ลบ ' + p.name)}">${icon('trash')}</button></span>`;
  }

  /* ---- นักศึกษา */
  function chipsOf(p) {
    return (p.blocks || []).map(b => `<span class="inline-flex items-center min-h-[28px] px-2.5 rounded-full border border-ink-100 bg-ink-50 text-xs font-medium leading-4 text-ink-800" data-training-chip="${b.place}">` +
      `${esc(placeLabel(b.place) + ' ' + TE.rangeText(b.from, b.to, { year: false }))}</span>`).join('');
  }
  function studentSegHtml(c) {
    const k = K();
    const sup = c.isSup();
    let html = '';
    if (sup) {
      const n = ui.picked.size;
      html += `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2" data-training-tools>${actBtn('add-students', 'users', 'เพิ่มนักศึกษา', k.btnPrimary)}` +
        actBtn('replan', 'wand', n ? 'จัดใหม่ (' + n + ' คน)' : 'จัดใหม่', k.btnSecondary, n ? '' : ' disabled') + '</div>';
    }
    if (!ui.day) ui.day = today();
    html += dayCard(c);
    const list = orgs();
    if (!list.length) return html + emptyCard('student', MSG.noStudent, sup ? 'กด "เพิ่มนักศึกษา" เพื่อจัดตารางหมุนเวียน' : '');
    list.forEach((g, gi) => {
      html += `<section class="${k.card} space-y-2 min-w-0" data-training-org="${gi}" data-org-name="${esc(g.org)}">` +
        `<div class="flex flex-wrap items-center gap-2"><div class="min-w-0 flex-1"><h2 class="${k.titleCard} break-words">${esc(g.org || MSG.noOrg)}</h2>` +
        `<p class="${k.textMeta}">${esc(g.people.length + ' คน · ' + periodOf(g.people))}</p></div>` +
        `<button type="button" class="${k.btn} ${k.btnTonal} ${k.btnCompact}" data-training-act="export-org" data-i="${gi}">${icon('image', 'w-4 h-4')}ส่งออกเป็นรูป</button></div>` +
        `<ul class="divide-y-2 divide-brand-50">` + g.people.map(p => {
          const tick = sup ? `<label class="shrink-0 inline-flex items-center justify-center w-11 h-11 -ml-2"><input type="checkbox" class="w-5 h-5 accent-brand-600" data-training-pick="${esc(p.id)}" aria-label="${esc('เลือก ' + p.name)}"${ui.picked.has(p.id) ? ' checked' : ''}></label>` : '';
          return `<li class="py-2.5 flex items-start gap-2" data-training-student="${esc(p.id)}">${tick}<div class="min-w-0 flex-1">` +
            `<p class="text-sm font-medium leading-6 text-ink-900 break-words">${esc(p.name)}${sup && p.code ? ` <span class="${k.textMeta}">${esc('รหัส ' + p.code)}</span>` : ''}</p>` +
            `<p class="${k.textMeta}">${esc(TE.rangeText(p.start, p.end) + (p.cohort ? ' · ' + p.cohort : ''))}</p>` +
            `<div class="mt-1.5 flex flex-wrap gap-1.5">${chipsOf(p) || `<span class="${k.textMeta}">ยังไม่ได้จัด</span>`}</div></div>` +
            (sup ? editButtons(p) : '') + '</li>';
        }).join('') + '</ul></section>';
    });
    return html;
  }
  function dayCard(c) {
    const k = K();
    const d = ui.day;
    const working = TE.isWorkingDay(d, holidaysNow());
    let body;
    if (!working) body = `<p class="${k.textMeta}" data-training-day-off>${esc(weekdayWord(d))} — วันหยุด ไม่มีการฝึกงาน</p>`;
    else {
      const at = {};
      students().forEach(p => { const pl = TE.placeOn(p, d); if (pl) (at[pl] || (at[pl] = [])).push(p.name); });
      body = `<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">` + DAY_PLACES.map(pl =>
        `<div class="min-w-0" data-training-day-place="${pl}"><dt class="${k.textCaption}">${esc(placeLabel(pl))}</dt>` +
        `<dd class="text-sm leading-6 text-ink-900 break-words">${esc((at[pl] || []).join(', ') || '-')}</dd></div>`).join('') + '</dl>';
    }
    return `<section class="${k.cardLilac} space-y-2" data-training-day="${esc(d)}"><label class="${k.label}" for="trainingDay">วันที่</label>` +
      `<input type="date" id="trainingDay" class="${k.input}" data-training-day-input value="${esc(d)}">${body}</section>`;
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
    core.Kit.sheet.open(el, { initialFocus: '[data-sheet-title]', onClose: () => { ui.sheet = null; } });
  }
  /** Replaces the body / actions of the open sheet (a step of the same flow). */
  function paintSheet(body, actions) {
    if (!sheetEl) return;
    const b = sheetEl.querySelector('[data-training-sheet-body]'), a = sheetEl.querySelector('[data-training-sheet-actions]');
    if (b) { b.innerHTML = body; b.scrollTop = 0; }
    if (a) a.innerHTML = actions;
  }
  function closeSheet() { if (sheetEl && core.Kit.sheet.isOpen(sheetEl)) core.Kit.sheet.close(sheetEl, 'api'); ui.sheet = null; }
  function field(id, label, input, hint) {
    const k = K();
    return `<div><label class="${k.label}" for="${id}">${esc(label)}</label>${input}${hint ? `<p class="${k.textMeta} mt-1">${esc(hint)}</p>` : ''}</div>`;
  }
  function textInput(id, key, value, max, extra) {
    return `<input type="text" id="${id}" class="${K().input}" data-tf="${key}" value="${esc(value || '')}" maxlength="${max}"${extra || ''}>`;
  }
  function dateInput(id, key, value) { return `<input type="date" id="${id}" class="${K().input}" data-tf="${key}" value="${esc(value || '')}">`; }
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
  const checked = key => { const el = sheetEl && sheetEl.querySelector('[data-tf="' + key + '"]:checked'); return el ? el.value : ''; };
  function saveActions(label) {
    const k = K();
    return `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-save>${esc(label || 'บันทึก')}</button>`;
  }

  /* ---- the person sheet (add / edit one trainee or student) */
  function blankPerson(kind) {
    const t = today();
    return { id: '', baseVersion: 0, kind, name: '', nickname: '', code: '', org: '', cohort: '', start: t, end: U().addDays(t, kind === 'student' ? 27 : 180), blocks: [], extras: [], note: '' };
  }
  function openPerson(kind, id) {
    if (!core.isSup()) return;
    const cur = id ? byId(id) : null;
    if (id && !cur) return;
    const f = cur ? Object.assign(clone(cur), { baseVersion: cur.version }) : blankPerson(kind);
    if (!f.blocks.length) f.blocks.push({ from: f.start, to: f.end, place: f.kind === 'student' ? 'ipd' : 'ipd' });
    ui.sheet = { kind: 'person', form: f };
    openSheet('person', cur ? 'แก้ไข' + (f.kind === 'student' ? 'นักศึกษา' : 'เทคใหม่') : f.kind === 'student' ? 'เพิ่มนักศึกษา' : 'เพิ่มเทคใหม่', personBody(f), saveActions());
  }
  function personBody(f) {
    const k = K();
    const st = f.kind === 'student';
    let html = (st && !f.id ? `<button type="button" class="${k.btn} ${k.btnTonal} w-full" data-training-sheet-act="many">${icon('users')}หลายคนพร้อมกัน</button>` : '') +
      field('tfName', 'ชื่อ สกุล', textInput('tfName', 'name', f.name, LIMITS.name, ' autocomplete="off"'));
    if (!st) html += field('tfNick', 'ชื่อเล่น', textInput('tfNick', 'nickname', f.nickname, LIMITS.nickname));
    html += field('tfCode', st ? 'รหัสนักศึกษา (ไม่บังคับ)' : 'รหัสพนักงาน (ไม่บังคับ)', textInput('tfCode', 'code', f.code, LIMITS.code), 'เห็นเฉพาะ Supervisor');
    if (st) html += field('tfOrg', 'มหาวิทยาลัย', textInput('tfOrg', 'org', f.org, LIMITS.org));
    html += field('tfCohort', st ? 'กลุ่ม (ไม่บังคับ)' : 'รอบ เช่น เข้าใหม่รอบเดือนตุลาคม', textInput('tfCohort', 'cohort', f.cohort, LIMITS.cohort, ' list="trainingCohorts"')) +
      `<datalist id="trainingCohorts">${Array.from(new Set(trainees().map(p => p.cohort).filter(Boolean))).map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>`;
    html += `<div class="grid grid-cols-2 gap-2">${field('tfStart', 'เริ่ม', dateInput('tfStart', 'start', f.start))}${field('tfEnd', 'สิ้นสุด', dateInput('tfEnd', 'end', f.end))}</div>`;
    html += `<div class="space-y-2" data-tf-list="block"><p class="${k.label}">ช่วงการฝึก</p>` + f.blocks.map((b, i) => rangeRow('block', i, b)).join('') +
      `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact}" data-training-sheet-act="add-block">${icon('calendar', 'w-4 h-4')}เพิ่มช่วง</button></div>`;
    if (!st) {
      html += `<div class="space-y-2" data-tf-list="extra"><p class="${k.label}">ฝึกพิเศษ (เช่น ฝึก US 5 วัน — แทนช่วงปกติในวันนั้น)</p>` + f.extras.map((b, i) => rangeRow('extra', i, b)).join('') +
        `<button type="button" class="${k.btn} ${k.btnGhost} ${k.btnCompact}" data-training-sheet-act="add-extra">${icon('star', 'w-4 h-4')}เพิ่มฝึกพิเศษ</button></div>`;
    }
    html += field('tfNote', 'หมายเหตุ (ไม่บังคับ)', textInput('tfNote', 'note', f.note, LIMITS.note));
    return `<div class="space-y-3">${html}${errorBox()}</div>`;
  }
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
    return f;
  }
  /** Validates a person as R5-SPEC §1 → the item to send, or {error}. */
  function itemOf(f) {
    const name = norm(f.name);
    if (!name) return { error: 'กรอกชื่อ สกุล' };
    const isY = U().isValidYmd;
    if (!isY(f.start) || !isY(f.end) || f.start > f.end) return { error: 'วันเริ่มต้องไม่หลังวันสิ้นสุด' };
    if (U().daysBetweenInclusive(f.start, f.end) > LIMITS.days) return { error: 'ช่วงเวลาต้องไม่เกิน 400 วัน' };
    const ranges = (list, label) => {
      const out = list.filter(b => b.from || b.to).map(b => {
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
    const ex = ranges(f.kind === 'trainee' ? f.extras : (f.extras || []), true);
    if (ex.error) return ex;
    if (ex.list.length > LIMITS.extras) return { error: 'ฝึกพิเศษได้ไม่เกิน 12 รายการ' };
    const item = {
      kind: f.kind, name: name.slice(0, LIMITS.name), nickname: norm(f.nickname).slice(0, LIMITS.nickname), code: norm(f.code).slice(0, LIMITS.code),
      org: f.kind === 'student' ? norm(f.org).slice(0, LIMITS.org) : '', cohort: norm(f.cohort).slice(0, LIMITS.cohort),
      start: f.start, end: f.end, blocks: bl.list, extras: ex.list, note: norm(f.note).slice(0, LIMITS.note)
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
    if (!items.length || ui.busy) return;
    if (items.length > LIMITS.items) { showError('บันทึกได้ครั้งละไม่เกิน 40 คน'); return; }
    if (!c.requireInternet()) return;
    const btn = sheetEl && sheetEl.querySelector('[data-training-save]');
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
      if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'บันทึก'; }
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

  /* ---- สร้างตารางวนอัตโนมัติ (trainee cohort) */
  function parseLines(text, max) {
    return String(text || '').split(/\r?\n/).map(l => l.split(/[,，]/).map(norm)).filter(a => a[0]).slice(0, max);
  }
  function openGen(c) {
    if (!c.isSup()) return;
    const k = K();
    const start = U().addMonths(today(), 1).slice(0, 7) + '-01';
    const list = cohorts();
    ui.sheet = { kind: 'gen', step: 'form' };
    const body = `<div class="space-y-3">` +
      field('tgCohort', 'ชื่อรอบ', textInput('tgCohort', 'cohort', '', LIMITS.cohort, ' list="trainingCohortsGen" placeholder="เช่น เข้าใหม่รอบเดือนตุลาคม"')) +
      `<datalist id="trainingCohortsGen">${list.filter(g => g.cohort).map(g => `<option value="${esc(g.cohort)}"></option>`).join('')}</datalist>` +
      `<div data-tg-existing></div>` +
      field('tgPeople', 'รายชื่อใหม่ (บรรทัดละคน)', `<textarea id="tgPeople" class="${k.textarea}" rows="4" data-tf="people" placeholder="ชื่อ สกุล, ชื่อเล่น, รหัส"></textarea>`, 'ครึ่งแรกของรายชื่อเริ่ม IPD ก่อน ที่เหลือเริ่ม OPD ก่อน') +
      field('tgStart', 'เริ่ม', dateInput('tgStart', 'start', start), 'แบบรายเดือนใช้เดือนของวันที่เลือก') +
      `<fieldset><legend class="${k.label}">หน่วย</legend><div class="grid grid-cols-2 gap-2">` +
      ['month', 'block4w'].map((u, i) => `<label class="flex items-center gap-2 min-h-[44px] px-3 rounded-2xl border-2 border-ink-200 ${k.textBody}"><input type="radio" name="tgUnit" value="${u}" class="w-5 h-5 accent-brand-600" data-tf="unit"${i ? '' : ' checked'}>${u === 'month' ? 'เดือน' : '4 สัปดาห์'}</label>`).join('') +
      `</div></fieldset>` +
      `<div class="grid grid-cols-2 gap-2">${field('tgIpd', 'IPD (เดือน)', numSelect('tgIpd', 'ipd', 3))}${field('tgOpd', 'OPD (เดือน)', numSelect('tgOpd', 'opd', 3))}</div>` +
      `<p class="${k.textMeta}">IPD วน IPD → Portable → ER คนละ Station ในช่วงเดียวกัน</p>${errorBox()}</div>`;
    openSheet('gen', 'สร้างตารางวนอัตโนมัติ', body, `<button type="button" class="${K().btn} ${K().btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${K().btn} ${K().btnPrimary} flex-1" data-training-sheet-act="gen-preview">${icon('wand')}แสดงตัวอย่าง</button>`);
    syncGenExisting();
  }
  function numSelect(id, key, v) {
    let o = '';
    for (let i = 0; i <= 6; i++) o += `<option value="${i}"${i === v ? ' selected' : ''}>${i}</option>`;
    return `<select id="${id}" class="${K().select}" data-tf="${key}">${o}</select>`;
  }
  /** Ticks for the stored trainees of the typed cohort (regenerate them). */
  function syncGenExisting() {
    const box = sheetEl && sheetEl.querySelector('[data-tg-existing]');
    if (!box) return;
    const k = K();
    const name = norm(val('cohort'));
    const g = cohorts().filter(x => x.cohort === name)[0];
    const list = g ? g.people : [];
    box.innerHTML = list.length ? `<fieldset class="space-y-1"><legend class="${k.label}">คนในรอบนี้ที่บันทึกแล้ว (จัดใหม่ด้วย)</legend>` +
      list.map(p => `<label class="flex items-center gap-3 min-h-[44px] ${k.textBody}"><input type="checkbox" class="w-5 h-5 accent-brand-600" data-tg-keep="${esc(p.id)}" checked><span class="min-w-0 break-words">${esc(p.name + (p.nickname ? ' (' + p.nickname + ')' : ''))}</span></label>`).join('') + '</fieldset>' : '';
  }
  function genPreview(c) {
    const s = ui.sheet;
    if (!s || s.kind !== 'gen') return;
    const cohort = norm(val('cohort'));
    const keep = Array.prototype.filter.call(sheetEl.querySelectorAll('[data-tg-keep]'), x => x.checked).map(x => byId(x.dataset.tgKeep)).filter(Boolean);
    const fresh = parseLines(val('people'), LIMITS.items).map(a => ({ name: a[0].slice(0, LIMITS.name), nickname: (a[1] || '').slice(0, LIMITS.nickname), code: (a[2] || '').slice(0, LIMITS.code) }));
    const list = keep.map(p => Object.assign(clone(p), { baseVersion: p.version })).concat(fresh);
    if (!list.length) { showError('ใส่รายชื่ออย่างน้อย 1 คน'); return; }
    if (list.length > LIMITS.items) { showError('ได้ครั้งละไม่เกิน 40 คน'); return; }
    const start = val('start');
    if (!U().isValidYmd(start)) { showError('เลือกวันเริ่ม'); return; }
    const unit = checked('unit') === 'block4w' ? 'block4w' : 'month';
    const res = TE.traineePlan({ people: list, start, unit, ipdMonths: +val('ipd'), opdMonths: +val('opd'), cohort });
    if (!res.people.length) { showError((res.warnings[0] && res.warnings[0].text) || 'สร้างตารางไม่ได้'); return; }
    s.step = 'preview';
    s.result = res.people;
    const k = K();
    paintSheet(`<div class="space-y-3" data-training-preview="gen"><p class="${k.textBody}">${esc((cohort || MSG.noCohort) + ' · ' + res.people.length + ' คน · ' + periodOf(res.people))}</p>` +
      res.warnings.map(w => `<p class="${k.note}">${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(w.text)}</span></p>`).join('') +
      rotationTable(res.people, { preview: true }) +
      `<ul class="space-y-1 ${k.textMeta}">${res.people.map(p => { const x = TE.ipdOpdSummary(p); return `<li>${esc(p.name + ': IPD ' + (x.ipd || '-') + ' · OPD ' + (x.opd || '-'))}</li>`; }).join('')}</ul>` +
      `<p class="${k.textMeta}">ผลที่ได้ยังไม่ถูกบันทึก — ตรวจแล้วกดบันทึกทั้งหมด</p>${errorBox()}</div>`,
    `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-save>บันทึกทั้งหมด</button>`);
  }
  function genItems() {
    return ui.sheet.result.map(p => {
      const r = itemOf(Object.assign({}, p, { kind: 'trainee', baseVersion: p.baseVersion || 0, id: p.id || '' }));
      return r.item || null;
    }).filter(Boolean);
  }

  /* ---- นักศึกษา หลายคนพร้อมกัน / จัดใหม่ */
  function openStudents(c) {
    if (!c.isSup()) return;
    const k = K();
    const t = today();
    ui.sheet = { kind: 'students', step: 'form' };
    const body = `<div class="space-y-3">` +
      field('tsOrg', 'มหาวิทยาลัย', textInput('tsOrg', 'org', '', LIMITS.org, ' list="trainingOrgs"')) +
      `<datalist id="trainingOrgs">${orgs().filter(g => g.org).map(g => `<option value="${esc(g.org)}"></option>`).join('')}</datalist>` +
      field('tsCohort', 'กลุ่ม (ไม่บังคับ)', textInput('tsCohort', 'cohort', '', LIMITS.cohort)) +
      `<div class="grid grid-cols-2 gap-2">${field('tsStart', 'เริ่ม', dateInput('tsStart', 'start', t))}${field('tsEnd', 'สิ้นสุด', dateInput('tsEnd', 'end', U().addDays(t, 27)))}</div>` +
      field('tsNames', 'รายชื่อ (บรรทัดละคน, ไม่เกิน 40)', `<textarea id="tsNames" class="${k.textarea}" rows="6" data-tf="names" placeholder="ชื่อ สกุล หรือ ชื่อ สกุล, รหัส"></textarea>`) +
      `<p class="${k.textMeta}">IPD (IPD, ER, Portable) และ OPD อย่างละครึ่ง ${esc(MSG.workNote)} — คนที่เริ่มพร้อมกันแบ่งครึ่ง เริ่ม IPD ครึ่งหนึ่ง OPD ครึ่งหนึ่ง</p>${errorBox()}</div>`;
    openSheet('students', 'เพิ่มนักศึกษา (หลายคนพร้อมกัน)', body, `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-sheet-act="students-preview">${icon('wand')}แสดงตัวอย่าง</button>`);
  }
  async function holidaysFor(from, to) {
    const out = holidaysNow();
    const p = P();
    if (U().daysBetweenInclusive(from, to) <= 400) {
      try { const r = await p.fetchStats(from, to); r.holidays.forEach((v, d) => out.set(d, v)); } catch (e) { /* the stored ones */ }
    }
    return out;
  }
  async function studentsPreview(c) {
    const s = ui.sheet;
    if (!s || s.kind !== 'students') return;
    const org = norm(val('org')), cohort = norm(val('cohort')), start = val('start'), end = val('end');
    const lines = parseLines(val('names'), 1000);
    if (!lines.length) { showError('ใส่รายชื่ออย่างน้อย 1 คน'); return; }
    if (lines.length > LIMITS.items) { showError('ได้ครั้งละไม่เกิน 40 คน'); return; }
    if (!U().isValidYmd(start) || !U().isValidYmd(end) || start > end) { showError('วันเริ่มต้องไม่หลังวันสิ้นสุด'); return; }
    if (U().daysBetweenInclusive(start, end) > LIMITS.days) { showError('ช่วงเวลาต้องไม่เกิน 400 วัน'); return; }
    const list = lines.map((a, i) => ({ id: 'new' + i, name: a[0].slice(0, LIMITS.name), code: (a[1] || '').slice(0, LIMITS.code), org: org.slice(0, LIMITS.org), cohort, start, end, nickname: '', note: '' }));
    const alive = c.alive();
    const hol = await holidaysFor(start, end);
    if (!alive() || ui.sheet !== s) return;
    const res = TE.studentPlan({ students: list, holidays: hol, existing: students() });
    res.students.forEach(x => { delete x.id; });
    showStudentPreview(res, 'บันทึกทั้งหมด');
  }
  function showStudentPreview(res, label) {
    const s = ui.sheet;
    const k = K();
    s.step = 'preview';
    s.result = res.students;
    paintSheet(`<div class="space-y-3" data-training-preview="${s.kind}">` +
      res.warnings.map(w => `<p class="${k.note}">${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span>${esc(w.text)}</span></p>`).join('') +
      `<ul class="divide-y-2 divide-brand-50">` + res.students.map((p, i) => {
        const ch = res.choices[i];
        return `<li class="py-2"><p class="text-sm font-medium leading-6 text-ink-900 break-words">${esc(p.name)}</p>` +
          `<p class="${k.textMeta}">${esc(TE.rangeText(p.start, p.end) + ' · เริ่ม ' + (ch && ch.ipdFirst ? 'IPD' : 'OPD'))}</p>` +
          `<div class="mt-1.5 flex flex-wrap gap-1.5">${chipsOf(p)}</div></li>`;
      }).join('') + '</ul>' +
      `<p class="${k.textMeta}">${esc(MSG.workNote)} — ผลที่ได้ยังไม่ถูกบันทึก</p>${errorBox()}</div>`,
    `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-save>${esc(label)}</button>`);
  }
  async function openReplan(c) {
    if (!c.isSup()) return;
    const list = students().filter(p => ui.picked.has(p.id));
    if (!list.length) return;
    let from = list[0].start, to = list[0].end;
    list.forEach(p => { if (p.start < from) from = p.start; if (p.end > to) to = p.end; });
    const alive = c.alive();
    const hol = await holidaysFor(from, to);
    if (!alive()) return;
    const res = TE.studentPlan({ students: list.map(p => Object.assign(clone(p), { baseVersion: p.version })), holidays: hol, existing: students() });
    ui.sheet = { kind: 'replan', step: 'preview' };
    openSheet('replan', 'จัดใหม่ ' + list.length + ' คน', '', '');
    showStudentPreview(res, 'บันทึก');
  }
  function studentItems() {
    return ui.sheet.result.map(p => { const r = itemOf(Object.assign({}, p, { kind: 'student', id: p.id || '', baseVersion: p.baseVersion || 0 })); return r.item || null; }).filter(Boolean);
  }

  /* ---------------------------------------------------------------- exports (R5-SPEC §3.3) */
  /*
   * Inline styles only (html2canvas), black / white like the unit's own sheets, 880 px wide, drawn at scale 2.
   */
  const CELL = 'border-right:1px solid #000000;border-bottom:1px solid #000000;padding:6px 8px;text-align:center;vertical-align:middle;line-height:22px;';
  const TABLE = 'width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;border-top:1px solid #000000;border-left:1px solid #000000;';
  function exportShell(kind, inner) {
    const node = document.createElement('div');
    node.setAttribute('data-training-export', kind);
    node.style.cssText = 'width:' + EXPORT_WIDTH + 'px;box-sizing:border-box;padding:20px 24px 24px;background:#ffffff;color:#000000;font-family:' + EXPORT_FONT + ';';
    node.innerHTML = inner;
    return node;
  }
  function titleHtml(lines) {
    return lines.map((t, i) => `<div style="font-size:${i ? 17 : 20}px;font-weight:700;text-align:center;line-height:30px;${i === lines.length - 1 ? 'margin:0 0 14px;' : ''}" data-export-title="${i + 1}">${esc(t)}</div>`).join('');
  }
  /** Picture A — ตารางวน (IPD). */
  function trainAHtml(g) {
    const pr = TE.periodRows(g.people);
    const n = g.people.length;
    let html = titleHtml([g.cohort ? 'ตารางนักรังสีการแพทย์ (' + g.cohort + ')' : 'ตารางวนนักรังสีการแพทย์', 'แผนกผู้ป่วยใน (IPD)']);
    html += `<table style="${TABLE}"><colgroup><col style="width:${n > 4 ? 26 : 32}%">${'<col>'.repeat(n)}</colgroup><thead><tr>` +
      `<th style="${CELL}font-size:15px;font-weight:700;">ช่วงเวลาการฝึก</th>` +
      g.people.map(p => `<th style="${CELL}font-size:15px;font-weight:700;" data-export-person><div>${esc(p.name)}</div><div>(${esc(p.nickname || TE.firstName(p.name))})</div></th>`).join('') +
      '</tr></thead><tbody>';
    pr.rows.forEach(r => {
      html += `<tr data-export-period="${esc(r.from)}"><td style="${CELL}font-size:15px;">${esc(r.label)}</td>` +
        r.places.map(pl => (pl && pl !== 'opd'
          ? `<td style="${CELL}font-size:16px;" data-export-place="${pl}">${esc(placeLabel(pl))}</td>`
          : `<td style="${CELL}background:#000000;" data-export-place="${pl || 'none'}" data-export-black="1"></td>`)).join('') + '</tr>';
    });
    html += '</tbody></table>';
    const notes = footnotes(g.people);
    if (notes.length) html += `<div style="margin-top:12px;font-size:15px;line-height:24px;" data-export-notes>${notes.map(t => `<div data-export-note>${esc(t)}</div>`).join('')}</div>`;
    return html;
  }
  /** Picture B — ตารางสรุป IPD/OPD (the code line only for the Supervisor). */
  function trainBHtml(g) {
    const sup = core.isSup();
    let html = titleHtml([g.cohort ? 'ตารางนักรังสีการแพทย์ (' + g.cohort + ')' : 'ตารางนักรังสีการแพทย์']);
    html += `<table style="${TABLE}"><colgroup><col style="width:40%"><col><col></colgroup><thead><tr>` +
      ['รายชื่อ', 'IPD', 'OPD'].map(t => `<th style="${CELL}font-size:16px;font-weight:700;">${t}</th>`).join('') + '</tr></thead><tbody>';
    g.people.forEach(p => {
      const s = TE.ipdOpdSummary(p);
      html += `<tr data-export-row><td style="${CELL}font-size:16px;"><div>${esc(p.name)}</div>` +
        (sup && p.code ? `<div data-export-code>(${esc(p.code)})</div>` : '') + (p.nickname ? `<div>${esc(p.nickname)}</div>` : '') + '</td>' +
        `<td style="${CELL}font-size:16px;" data-export-ipd>${esc(s.ipd)}</td><td style="${CELL}font-size:16px;" data-export-opd>${esc(s.opd)}</td></tr>`;
    });
    return html + '</tbody></table>';
  }
  /** The student table — per university or everyone. */
  function studentsHtml(org, list) {
    const cols = ['ipd', 'er', 'portable', 'opd'];
    let html = titleHtml(['ตารางหมุนเวียนนักศึกษาฝึกงาน' + (org ? ' ' + org : ''), periodOf(list)]);
    html += `<table style="${TABLE}"><colgroup><col style="width:28%">${'<col>'.repeat(cols.length)}</colgroup><thead><tr>` +
      `<th style="${CELL}font-size:15px;font-weight:700;">ชื่อ-สกุล</th>` + cols.map(c => `<th style="${CELL}font-size:15px;font-weight:700;">${esc(placeLabel(c))}</th>`).join('') + '</tr></thead><tbody>';
    list.forEach(p => {
      html += `<tr data-export-student><td style="${CELL}font-size:15px;text-align:left;">${esc(p.name)}${!org && p.org ? `<div style="font-size:13px;">${esc(p.org)}</div>` : ''}</td>` +
        cols.map(c => `<td style="${CELL}font-size:14px;" data-export-place="${c}">${(p.blocks || []).filter(b => b.place === c).map(b => `<div>${esc(TE.rangeText(b.from, b.to))}</div>`).join('')}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table>';
    return html + `<div style="margin-top:12px;font-size:14px;line-height:22px;" data-export-footnote>${esc(MSG.workNote)}</div>`;
  }
  /** The export choices of a cohort / the students. */
  function exportChoices(s) {
    if (s.scope === 'cohort') {
      const g = cohorts()[s.i];
      if (!g) return [];
      const stem = fileSafe(g.cohort || TE.monthYear(g.people[0].start.slice(0, 7)));
      return [
        { id: 'trainA', label: 'ตารางวน (IPD)', file: 'ตารางวน-IPD-' + stem + '.png', node: () => exportShell('trainA', trainAHtml(g)) },
        { id: 'trainB', label: 'ตารางสรุป IPD/OPD', file: 'ตารางสรุป-IPD-OPD-' + stem + '.png', node: () => exportShell('trainB', trainBHtml(g)) }
      ];
    }
    const list = orgs();
    const out = list.map((g, i) => ({ id: 'org' + i, label: g.org || MSG.noOrg, file: 'ตารางนักศึกษา-' + fileSafe(g.org || 'ไม่ระบุ') + '.png', node: () => exportShell('students', studentsHtml(g.org, g.people)) }));
    if (list.length > 1) {
      const all = students().slice().sort((a, b) => cmp(a.org, b.org) || cmp(a.start, b.start) || cmp(a.name, b.name));
      out.push({ id: 'all', label: 'ทุกมหาวิทยาลัย', file: 'ตารางนักศึกษา-ทั้งหมด.png', node: () => exportShell('students', studentsHtml('', all)) });
    }
    return out;
  }
  function openExport(c, scope, i) {
    const s = { kind: 'export', scope, i };
    const list = exportChoices(s);
    if (!list.length) return;
    s.choice = scope === 'org' ? 'org' + i : list[0].id;
    ui.sheet = s;
    const k = K();
    const body = `<div class="space-y-2" role="radiogroup" aria-label="แบบตาราง" data-training-export-picks>${picksHtml(list, s.choice)}</div>` +
      `<p class="${k.label}">ตัวอย่าง</p><div class="relative w-full overflow-hidden rounded-xl border-2 border-ink-200 bg-white" data-training-export-preview aria-hidden="true"></div>` +
      `<p class="${k.textMeta} ${k.wrapAnywhere}" data-training-export-file></p>`;
    openSheet('export', 'ส่งออกเป็นรูป (PNG)', body, `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ปิด</button>` +
      `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-training-export-save>${icon('image')}บันทึกรูป PNG</button>`);
    const scroller = sheetEl.querySelector('[data-training-sheet-body]');
    if (scroller) scroller.style.scrollbarGutter = 'stable';
    showChoice();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fitPreview);
  }
  function picksHtml(list, choice) {
    return list.map(x => {
      const sel = x.id === choice;
      return `<button type="button" role="radio" aria-checked="${sel}" data-training-export-pick="${x.id}" class="w-full min-h-[44px] flex items-center gap-3 px-3 py-2 rounded-2xl border-2 text-left ${sel ? 'border-brand-400 bg-brand-50' : 'border-ink-200 bg-white'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">` +
        `<span class="w-5 h-5 shrink-0 rounded-full border-2 ${sel ? 'border-brand-600' : 'border-slate-400'} flex items-center justify-center" aria-hidden="true">${sel ? '<span class="w-2.5 h-2.5 rounded-full bg-brand-600"></span>' : ''}</span>` +
        `<span class="min-w-0 flex-1 text-sm font-medium leading-6 text-ink-900 break-words">${esc(x.label)}</span></button>`;
    }).join('');
  }
  function currentChoice() {
    const s = ui.sheet;
    if (!s || s.kind !== 'export') return null;
    return exportChoices(s).filter(x => x.id === s.choice)[0] || null;
  }
  function showChoice() {
    const x = currentChoice();
    if (!x || !sheetEl) return;
    const box = sheetEl.querySelector('[data-training-export-preview]');
    const file = sheetEl.querySelector('[data-training-export-file]');
    const picks = sheetEl.querySelector('[data-training-export-picks]');
    if (picks) picks.innerHTML = picksHtml(exportChoices(ui.sheet), ui.sheet.choice);
    if (box) {
      box.innerHTML = '';
      const node = x.node();
      node.style.position = 'absolute';
      node.style.left = '0';
      node.style.top = '0';
      node.style.transformOrigin = '0 0';
      box.appendChild(node);
    }
    if (file) file.textContent = 'ไฟล์: ' + x.file;
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
    const x = currentChoice();
    if (!x || ui.busy) return;
    const btn = sheetEl.querySelector('[data-training-export-save]');
    const label = btn ? btn.innerHTML : '';
    ui.busy = 'image';
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'กำลังสร้างรูป…'; }
    try {
      await c.shareImage(x.node(), x.file, { width: EXPORT_WIDTH, scale: EXPORT_SCALE });
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
    const pick = t.closest('[data-training-export-pick]');
    if (pick) { s.choice = pick.dataset.trainingExportPick; showChoice(); return; }
    if (t.closest('[data-training-export-save]')) { c.spawn(() => saveExport(c)); return; }
    const a = t.closest('[data-training-sheet-act]');
    if (a) {
      const act = a.dataset.trainingSheetAct;
      if (act === 'many') { openStudents(c); return; }
      if (act === 'gen-preview') { genPreview(c); return; }
      if (act === 'students-preview') { c.spawn(() => studentsPreview(c)); return; }
      if (s.kind === 'person' && /^(add|del)-(block|extra)$/.test(act)) {
        const f = readPerson();
        const kind = act.slice(4);
        const list = kind === 'block' ? f.blocks : f.extras;
        if (act.slice(0, 3) === 'add') {
          const last = list[list.length - 1];
          const from = last && U().isValidYmd(last.to) ? U().addDays(last.to, 1) : f.start;
          list.push(kind === 'block' ? { from, to: f.end, place: 'ipd' } : { from, to: from, place: 'us', label: 'ฝึก US' });
        } else list.splice(+a.dataset.i, 1);
        paintSheet(personBody(f), saveActions());
      }
      return;
    }
    if (t.closest('[data-training-save]')) {
      if (s.kind === 'person') c.spawn(() => savePerson(c), { write: true });
      else if (s.kind === 'gen' && s.step === 'preview') c.spawn(() => saveItems(c, genItems(), '✅ บันทึกตารางวนแล้ว'), { write: true });
      else if ((s.kind === 'students' || s.kind === 'replan') && s.step === 'preview') {
        c.spawn(async () => { await saveItems(c, studentItems(), '✅ บันทึกตารางนักศึกษาแล้ว'); if (s.kind === 'replan' && !ui.sheet) ui.picked.clear(); c.render(); }, { write: true });
      }
    }
  }
  function onSheetChange(e) {
    const t = e && e.target;
    if (t && t.matches && t.matches('[data-tf="cohort"]') && ui.sheet && ui.sheet.kind === 'gen') syncGenExisting();
  }
  function onRootClick(e) {
    const c = core;
    const t = e.target && e.target.closest ? e.target : null;
    if (!t || !c || !root) return;
    const sg = t.closest('[data-training-seg]');
    if (sg) { ui.seg = sg.dataset.trainingSeg; c.render(); return; }
    const a = t.closest('[data-training-act]');
    if (!a || a.disabled) return;
    const act = a.dataset.trainingAct;
    if (act === 'retry') { const p = P(); if (p) c.track(p.refresh()); c.render(); return; }
    if (act === 'add-trainee') { openPerson('trainee'); return; }
    if (act === 'add-students') { openPerson('student'); return; }
    if (act === 'gen') { openGen(c); return; }
    if (act === 'replan') { c.spawn(() => openReplan(c)); return; }
    if (act === 'edit') { const p = byId(a.dataset.id); if (p) openPerson(p.kind, p.id); return; }
    if (act === 'delete') { c.spawn(() => deletePerson(c, a.dataset.id), { write: true }); return; }
    if (act === 'export-cohort') { openExport(c, 'cohort', +a.dataset.i); return; }
    if (act === 'export-org') { openExport(c, 'org', +a.dataset.i); }
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
      const refit = () => { fitPreview(); if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(fitPreview); };
      window.addEventListener('resize', refit);
      window.addEventListener('orientationchange', refit);
    },
    render(el, c) { renderScreen(el, c); },
    show(c, params) {
      const prm = params && typeof params === 'object' ? params : {};
      if (!ui.seg) ui.seg = 'trainee';
      if (prm.seg && SEGS.some(s => s.id === prm.seg)) ui.seg = prm.seg;
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
