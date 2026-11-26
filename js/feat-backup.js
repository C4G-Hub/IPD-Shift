/* =====================================================================
 * js/feat-backup.js — ทีมแทนเวรวันนี้ / ข้อความแทนเวร (R2-SPEC §0.16, §4.6, track BU) → App.register
 *
 *  - Panel 'backup' on วันนี้ (core.station.addPanel, order 10 — above RO's proposal) for EVERY logged-in user while the
 *    server has 'plan': title "ทีมแทนเวรวันนี้" ("ทีมแทนเวร · 24 พ.ย." for another date) + pill "N คน"; one row per helper
 *    coming to this unit (avatar, name, "มีวันลา" when absent that day, a station chip: ER / Portable as named, IPD for
 *    this unit's default) under the subtitle "มาช่วย IPD/ER/Portable"; a collapsed
 *    "ไปช่วยหน่วยอื่น (N)" list (name → unit); "วางโดย … เวลา 08:12 น."; the original text on demand (collapsed, shown as
 *    text — never as HTML); the empty state "ยังไม่มีข้อความแทนเวรของวันนี้" — for everyone but the Supervisor one slim
 *    line instead of a card (FIX-BU B-1). "วางข้อความแทนเวร" / "แก้ข้อความแทนเวร"
 *    for the Supervisor only (R2-SPEC §0.28, the server's rule); disabled offline (the app's no-internet
 *    text), while the date's plan data is not on this device, and for dates beyond today ± 7 (the server's window).
 *  - Sheet "ข้อความแทนเวร" (#buSheet, built once, UiKit sheet stack, chevron-down close like the other sheets — no cross):
 *    step 1 "วางจากคลิปบอร์ด" (navigator.clipboard.readText; hidden when unsupported; a refusal explains the long-press
 *    paste) and a <textarea> (16 px, ≤ 4,000 characters, prefilled with the saved text when editing) → "อ่านข้อความ" → PlanEngine.parseBackupMessage(text, plan.engineStaff(),
 *    plan.aliasesMap(), {selectedDate, today}) → step 2 the review: the date read from the message (a choice between the
 *    message's date and the selected one when they differ: dateMatches === false), the questions — AMBIGUOUS (radio of
 *    the candidates + "ไม่นับ"), FUZZY ("ใช่" / "ไม่ใช่", no default), UNMATCHED (a select of the active staff + "ไม่นับ";
 *    asked for this unit's names AND other units' names, R2-SPEC §0.16 "unmatched names are asked") —, the helpers per unit,
 *    the away list, "หมายเหตุในข้อความ" (remarks, never parsed) and other notes. "บันทึก" stays disabled while any question is
 *    open → plan.saveBackupMsg({date, text, helpers:[{name, station}], away:[{name, unit}]}) → toast. The Supervisor may
 *    tick "จำ "…" เป็นชื่อเรียกของ …" on an answered unmatched / fuzzy name: ONE plan.setProfiles after the save.
 *    "ลบข้อความ" (Supervisor) sends text ''. Server refusals: VALIDATION / TOO_LARGE stay in the sheet,
 *    FORBIDDEN closes it (core.handleError shows the server's text and refreshes).
 *  - The saved helpers / away feed the daily proposal through js/plan-data.js (proposalInput); nothing here touches RO.
 * Data: core.use('plan') only. Every message string (text, names, units, remarks) is escaped (core.esc).
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !window.PlanEngine) return;   // the boot guard stopped app.js
  const PE = window.PlanEngine;

  const ID = 'backup';
  const SHEET_ID = 'buSheet';
  const TEXT_MAX = 4000;          // server BACKUP_TEXT_MAX_
  const DAYS = 7;                 // server BACKUP_DAYS_: a message is dated within today ± 7
  const ALIAS_MAX = 30;           // setProfiles: each alias 1–30 characters
  const ALIASES_PER = 10;         // setProfiles: at most 10 aliases per person
  const UNIT_MAX = 40;            // saveBackupMsg: away unit 1–40 characters
  const SKIP = '__skip__';        // the "ไม่นับ" answer of a select
  const HONORIFICS = PE.HONORIFICS.slice().sort((a, b) => b.length - a.length);
  const MSG = {
    noInternet: 'ไม่มีอินเทอร์เน็ต — ยังบันทึกไม่ได้',
    saved: '✅ บันทึกข้อความแทนเวรแล้ว',
    deleted: '🗑️ ลบข้อความแทนเวรแล้ว',
    empty: 'วางข้อความก่อน แล้วกด "อ่านข้อความ"',
    tooLong: 'ข้อความยาวเกิน ' + TEXT_MAX.toLocaleString('en-US') + ' ตัวอักษร — ตัดส่วนที่ไม่เกี่ยวข้องออกก่อน',
    window: 'วางข้อความแทนเวรได้เฉพาะวันที่ภายใน ' + DAYS + ' วันก่อนหรือหลังวันนี้'
  };

  let core = null;
  let st = null;                  // the open sheet: see openSheet()
  let sheetEl = null;
  let awayOpen = false;           // the panel's disclosures (kept across renders)
  let textOpen = false;
  let lastAnswers = Object.create(null);   // answers by question key: kept when the text is edited and read again

  /* ---------------------------------------------------------------- small helpers */
  const esc = s => core.esc(s);
  const K = () => core.Kit.cls;
  const U = () => core.U;
  const today = () => U().todayStr();
  const plan = c => (c || core).use('plan');

  function enabled(c) { return !!c.state.user && c.serverHas('plan') && !!plan(c); }
  /** R2-SPEC §0.28: only the Supervisor posts, edits and deletes the message (the server checks again). */
  function canPost(c) { return !!c.state.user && c.isSup(); }
  function canDelete(c, b) { return !!b && canPost(c); }
  function offline() { return navigator.onLine === false; }
  function inWindow(date) {
    const n = U().daysBetweenInclusive(today(), date) - 1;
    return isFinite(n) && Math.abs(n) <= DAYS;
  }
  function activeSet(c) { return new Set(c.staff().map(s => s.name)); }
  function shortDate(date) { return U().thaiDateShort(date, { year: false }); }
  function dayRef(date) { return date === today() ? 'วันนี้' : 'วันที่ ' + U().thaiDateShort(date); }
  function stationOf(id) { return U().STATIONS.filter(s => s.id === id)[0] || null; }
  /** The chip of a helper's station; '' (no hint) is this unit's own IPD (FIX-BU B-2: IPD gets a chip like ER / Portable). */
  function stationChip(id) {
    const s = stationOf(id || 'ipd');
    if (!s) return '';
    return '<span class="' + K().tag + '" style="background:' + s.bg + ';border-color:' + s.border + ';color:' + s.text + '" data-bu-station="' + esc(s.id) + '">' + esc(s.name) + '</span>';
  }
  /** FIX-BU B-2: the leave type when `name` has a full-day (blocking) leave on `date` in the loaded data, else ''. */
  function leaveOf(c, date, name) {
    const map = U().isValidYmd(date) ? c.leavesOn(date) : null;
    const l = map && Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
    return l && c.isAbsent(l) ? String(l.type || '') : '';
  }
  /** "มีวันลา" next to a helper who is absent that day (the type in the title). */
  function leaveTag(c, date, name) {
    const t = leaveOf(c, date, name);
    return t ? '<span class="shrink-0" data-bu-leave="' + esc(t) + '" title="' + esc(t) + '">' + core.Kit.pill('มีวันลา', 'danger') + '</span>' : '';
  }
  function timeOf(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return '';
    const p = n => (n < 10 ? '0' : '') + n;
    return { date: U().todayStr(d), hm: p(d.getHours()) + ':' + p(d.getMinutes()) };
  }

  /* ---------------------------------------------------------------- the panel on วันนี้ */
  function renderPanel(el, c) {
    if (!el.dataset.buWired) {
      el.dataset.buWired = '1';
      el.addEventListener('click', e => {
        const b = e.target && e.target.closest && e.target.closest('#buOpenBtn');
        if (b && !b.disabled) openSheet(c, c.selectedDate());
      });
      el.addEventListener('toggle', e => {
        const d = e.target;
        if (d && d.hasAttribute && d.hasAttribute('data-bu-away-list')) awayOpen = d.open;
        if (d && d.hasAttribute && d.hasAttribute('data-bu-original')) textOpen = d.open;
      }, true);
    }
    if (!enabled(c)) { el.hidden = true; c.setHtml(el, ''); return; }
    const html = panelHtml(c);
    el.hidden = !html;
    c.setHtml(el, html);
  }

  function panelHtml(c) {
    const p = plan(c);
    const date = c.selectedDate();
    const known = p.covers(date, date);
    const b = known ? p.backup(date) : null;
    const k = K();
    const title = date === today() ? 'ทีมแทนเวรวันนี้' : 'ทีมแทนเวร · ' + shortDate(date);
    const act = activeSet(c);
    const label = n => esc(n) + (act.has(n) ? '' : ' <span class="' + k.textCaption + '">(ลบแล้ว)</span>');
    // FIX-BU B-1: without a message, staff (no button) get one slim line instead of a card; nothing while it loads
    if (!canPost(c) && !b) {
      if (!known) return '';
      return '<section class="flex items-center gap-2 min-h-[44px] px-3 rounded-2xl border-2 border-dashed border-brand-100 bg-white/70" data-bu-card data-bu-compact data-date="' + esc(date) + '">' +
        core.Kit.icon('users', 'w-4 h-4 shrink-0 text-lilac-700') +
        '<p class="min-w-0 text-[0.8125rem] leading-5 text-slate-500"><span class="font-medium text-ink-800" data-bu-title>' + esc(title) + '</span> · ' +
        '<span data-bu-empty>ยังไม่มีข้อความแทนเวร</span></p></section>';
    }
    let body;
    if (!known && p.loading()) {
      body = core.Kit.skeleton(2);
    } else if (!known) {
      body = '<p class="' + k.textMeta + '" data-bu-unknown>ยังไม่ได้โหลดข้อมูลทีมแทนเวรของ' + esc(dayRef(date)) + '</p>';
    } else if (!b) {
      body = '<p class="' + k.textMeta + '" data-bu-empty>ยังไม่มีข้อความแทนเวรของ' + esc(dayRef(date)) + '</p>';
    } else {
      const rows = b.helpers.length
        ? '<ul class="space-y-2" data-bu-helpers>' + b.helpers.map(h =>
          '<li class="flex items-center gap-2.5 min-w-0" data-bu-row="' + esc(h.name) + '">' + core.Kit.avatar(h.name, 'sm') +
          '<span class="min-w-0 flex-1 break-words text-sm font-medium leading-6 text-ink-900">' + label(h.name) + '</span>' +
          leaveTag(c, date, h.name) + stationChip(h.station) + '</li>').join('') + '</ul>'
        : '<p class="' + k.textMeta + '" data-bu-nohelpers>' + (date === today() ? 'วันนี้' : 'วันนั้น') + 'ไม่มีคนจากทีมแทนเวรมาช่วยหน่วยเรา</p>';
      const away = b.away.length
        ? '<details class="group rounded-2xl border-2 border-brand-100" data-bu-away-list' + (awayOpen ? ' open' : '') + '>' +
          '<summary class="' + k.disclosure + '"><span class="flex-1 min-w-0 text-sm font-medium leading-6 text-ink-800">ไปช่วยหน่วยอื่น (' + b.away.length + ')</span>' +
          core.Kit.icon('chevron-down', k.disclosureChevron) + '</summary>' +
          '<ul class="px-4 pb-4 space-y-1">' + b.away.map(a =>
            '<li class="flex flex-wrap items-center gap-x-2 text-sm leading-6 text-slate-700" data-bu-away-item="' + esc(a.name) + '" data-unit="' + esc(a.unit) + '">' +
            '<span class="font-medium text-ink-900 break-words">' + label(a.name) + '</span><span aria-hidden="true">→</span><span class="break-words">' + esc(a.unit) + '</span></li>').join('') +
          '</ul></details>'
        : '';
      const t = timeOf(b.postedAt);
      const when = !t ? '' : (t.date === date ? ' เวลา ' + t.hm + ' น.' : ' · ' + shortDate(t.date) + ' ' + t.hm + ' น.');
      const meta = '<p class="' + k.textMeta + '" data-bu-meta>วางโดย ' + esc(b.postedBy || '-') + esc(when) + '</p>';
      const original = '<details class="group" data-bu-original' + (textOpen ? ' open' : '') + '>' +
        '<summary class="inline-flex items-center gap-1 min-h-[44px] cursor-pointer select-none text-sm font-medium leading-6 text-accent-700">ดูข้อความต้นฉบับ' +
        core.Kit.icon('chevron-down', 'w-4 h-4 shrink-0 transition-transform group-open:rotate-180') + '</summary>' +
        '<pre class="mt-1 p-3 rounded-2xl bg-cream-50 border-2 border-cream-100 font-body text-sm leading-6 text-slate-700 whitespace-pre-wrap break-words ' + k.wrapAnywhere + '" data-bu-text>' + esc(b.text) + '</pre></details>';
      body = rows + away + meta + original;
    }
    let action = '';
    if (canPost(c)) {
      const off = offline();
      const out = !inWindow(date);
      const dis = off || out || !known;
      action = '<div class="space-y-1">' +
        '<button type="button" id="buOpenBtn" data-mode="' + (b ? 'edit' : 'new') + '" class="' + k.btn + ' ' + k.btnTonal + ' w-full"' + (dis ? ' disabled' : '') + '>' +
        core.Kit.icon(b ? 'pencil' : 'clipboard', 'w-5 h-5') + (b ? 'แก้ข้อความแทนเวร' : 'วางข้อความแทนเวร') + '</button>' +
        (off ? '<p class="' + k.textCaption + ' text-center" data-bu-offline>' + esc(MSG.noInternet) + '</p>'
          : out ? '<p class="' + k.textCaption + ' text-center" data-bu-window>' + esc(MSG.window) + '</p>' : '') +
        '</div>';
    }
    const pill = b ? core.Kit.pill(b.helpers.length + ' คน', b.helpers.length ? 'partial' : 'neutral') : '';
    return '<section class="' + k.card + ' space-y-3" data-bu-card data-date="' + esc(date) + '" aria-labelledby="buTitle">' +
      '<div class="' + k.cardHead + '"><span class="' + k.listIcon + ' ' + k.listIconLilac + '">' + core.Kit.icon('users', 'w-5 h-5') + '</span>' +
      '<div class="flex-1 min-w-0"><h2 id="buTitle" class="' + k.titleCard + '" data-bu-title>' + esc(title) + '</h2>' +
      (b ? '<p class="' + k.textCaption + '" data-bu-sub>มาช่วย IPD/ER/Portable</p>' : '') + '</div>' +
      (pill ? '<span data-bu-count>' + pill + '</span>' : '') + '</div>' + body + action + '</section>';
  }

  /* ---------------------------------------------------------------- the sheet */
  function ensureSheet() {
    if (sheetEl && sheetEl.isConnected) return sheetEl;
    const k = K();
    const el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = k.sheetWrap + ' md:p-4';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'buSheetTitle');
    el.innerHTML = '<div class="uk-safe-b ' + k.sheetFrame + '" data-sheet-panel>' +
      '<div class="' + k.sheetGrabber + '" aria-hidden="true"></div>' +
      '<div class="' + k.sheetHead + '"><h2 id="buSheetTitle" class="flex-1 outline-none ' + k.sheetTitle + '" data-sheet-title tabindex="-1">ข้อความแทนเวร</h2>' +
      '<button type="button" class="' + k.iconBtn + '" data-sheet-close aria-label="ปิด">' + core.Kit.icon('chevron-down', 'w-5 h-5') + '</button></div>' +
      '<div class="' + k.sheetScroll + '" data-bu-body></div>' +
      '<div class="' + k.sheetActions + '" data-bu-actions></div></div>';
    el.addEventListener('click', onSheetClick);
    el.addEventListener('change', onSheetChange);
    el.addEventListener('input', onSheetInput);
    document.body.appendChild(el);
    sheetEl = el;
    return el;
  }

  function openSheet(c, date) {
    if (!enabled(c) || !canPost(c) || !U().isValidYmd(date)) return;
    const existing = plan(c).backup(date);
    st = { date, existing, step: 'input', text: existing ? existing.text : '', res: null, qs: [], dateQ: null, error: '', busy: false };
    lastAnswers = Object.create(null);
    const el = ensureSheet();
    renderSheet();
    core.Kit.sheet.open(el, { initialFocus: '[data-sheet-title]', onClose: () => { if (st && !st.busy) st = null; } });
  }
  function closeSheet() {
    st = null;
    if (sheetEl && core.Kit.sheet.isOpen(sheetEl)) core.Kit.sheet.close(sheetEl, 'api');
  }

  function canReadClipboard() {
    const cb = navigator.clipboard;
    return !!cb && typeof cb.readText === 'function';
  }
  /** FIX-BU B-4: the clipboard's text into the field; a refusal (permission, no text access) explains the long-press paste. */
  async function pasteClipboard(c) {
    const s = st;
    if (!s || s.step !== 'input' || s.busy || s.clipBusy || !canReadClipboard()) return;
    const alive = c.alive();
    s.clipBusy = true;
    s.clipHint = '';
    renderSheet();
    let t = null;
    try { t = await navigator.clipboard.readText(); } catch (e) { t = null; }
    s.clipBusy = false;
    if (!alive() || st !== s || s.step !== 'input') return;
    if (t === null) s.clipHint = 'อ่านคลิปบอร์ดไม่ได้ — แตะค้างในช่องข้อความแล้วเลือก "วาง"';
    else if (!cleanText(t)) s.clipHint = 'คลิปบอร์ดว่าง — คัดลอกข้อความจาก LINE ก่อน';
    else { s.text = String(t); s.error = ''; }
    renderSheet();
  }
  /** The leaves of the dates the review may flag (selected / message date) are loaded quietly when missing. */
  function loadLeaves(c, dates) {
    const s = st;
    const need = dates.filter((d, i) => U().isValidYmd(d) && dates.indexOf(d) === i && ['ready', 'cached'].indexOf(c.dayView(d)) < 0);
    if (!need.length) return;
    need.forEach(d => {
      c.track(Promise.resolve(c.ensureRange(d, d)).catch(() => false))
        .then(() => { if (st === s && s.step === 'review') renderSheet(); });
    });
  }

  /** The text as the server will keep it: CRLF → LF, trimmed. */
  function cleanText(v) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim(); }

  /** Reads the textarea and parses it → the review step (or an error under the field). */
  function parse() {
    const c = core;
    if (!st) return;
    const ta = sheetEl.querySelector('#buText');
    const text = cleanText(ta ? ta.value : st.text);
    st.text = ta ? ta.value : st.text;
    if (!text) { st.error = MSG.empty; renderSheet(); return; }
    if (text.length > TEXT_MAX) { st.error = MSG.tooLong; renderSheet(); return; }
    const p = plan(c);
    const res = PE.parseBackupMessage(text, p.engineStaff(), p.aliasesMap(), { selectedDate: st.date, today: today() });
    st.clean = text;
    st.res = res;
    st.qs = buildQuestions(res);
    st.dateQ = res.dateMatches === false && res.date ? { msgDate: res.date, answer: lastAnswers['date|' + res.date] } : null;
    st.error = '';
    st.step = 'review';
    loadLeaves(c, [st.date, res.date]);
    renderSheet();
    const t = sheetEl.querySelector('[data-sheet-title]');
    if (t) t.focus();
  }

  /** One question per (kind, raw): AMBIGUOUS, FUZZY, UNMATCHED (this unit or another). */
  function buildQuestions(res) {
    const out = [], seen = Object.create(null);
    res.entries.forEach(e => e.resolved.forEach(r => {
      let kind = '';
      if (r.name && r.how === 'fuzzy') kind = 'fuzzy';
      else if (!r.name && r.ambiguous) kind = 'ambiguous';
      else if (!r.name) kind = 'unmatched';
      if (!kind) return;
      const key = kind + '|' + r.raw;
      if (seen[key]) return;
      seen[key] = true;
      const q = { key, kind, raw: r.raw, name: r.name || '', candidates: r.ambiguous ? r.ambiguous.slice() : [], thisUnit: e.isThisUnit, unit: e.unit,
        answer: undefined, alias: false };
      const prev = lastAnswers[key];
      if (prev && prev.answer !== undefined && validAnswer(q, prev.answer)) { q.answer = prev.answer; q.alias = !!prev.alias; }
      out.push(q);
    }));
    return out;
  }
  function validAnswer(q, v) {
    if (q.kind === 'fuzzy') return v === 'yes' || v === 'no';
    if (v === '') return true;
    if (q.kind === 'ambiguous') return q.candidates.indexOf(v) >= 0;
    return activeSet(core).has(v);
  }
  function questionOf(kind, raw) { return st.qs.filter(q => q.key === kind + '|' + raw)[0] || null; }
  /** The person a question's answer names ('' = not counted / not answered). */
  function personOfQ(q) {
    if (!q || q.answer === undefined) return '';
    if (q.kind === 'fuzzy') return q.answer === 'yes' ? q.name : '';
    return q.answer;
  }
  function personOf(r) {
    if (r.name && r.how !== 'fuzzy') return r.name;
    if (r.name) return personOfQ(questionOf('fuzzy', r.raw));
    return personOfQ(questionOf(r.ambiguous ? 'ambiguous' : 'unmatched', r.raw));
  }
  function openCount() {
    if (!st || st.step !== 'review') return 0;
    return st.qs.filter(q => q.answer === undefined).length + (st.dateQ && !st.dateQ.answer ? 1 : 0);
  }
  /** helpers / away from the entries and the answers (helpers first, as PlanEngine's finishBlock: a helper is never away). */
  function compute() {
    const act = activeSet(core);
    const helpers = [], away = [], hs = new Set(), as = new Set();
    st.res.entries.forEach(e => {
      if (!e.isThisUnit) return;
      e.resolved.forEach(r => {
        const n = personOf(r);
        if (n && act.has(n) && !hs.has(n)) { hs.add(n); helpers.push({ name: n, station: e.station || '' }); }
      });
    });
    st.res.entries.forEach(e => {
      if (e.isThisUnit) return;
      e.resolved.forEach(r => {
        const n = personOf(r);
        if (n && act.has(n) && !hs.has(n) && !as.has(n)) {
          as.add(n);
          away.push({ name: n, unit: String(e.unit || 'หน่วยอื่น').trim().slice(0, UNIT_MAX) || 'หน่วยอื่น' });
        }
      });
    });
    return { helpers, away };
  }
  function saveDate() {
    if (st.dateQ) return st.dateQ.answer || '';
    return st.date;
  }

  /** The alias the Supervisor may remember for `raw` → `person` ('' when it cannot be one: setProfiles' rules). */
  function aliasFor(raw, person) {
    let a = String(raw || '').trim().replace(/\s+/g, ' ');
    for (let i = 0; i < HONORIFICS.length; i++) {
      if (a.indexOf(HONORIFICS[i]) === 0) {
        const rest = a.slice(HONORIFICS[i].length).trim();
        if (rest.length >= 2) a = rest;
        break;
      }
    }
    if (!a || a.length > ALIAS_MAX || U().validateName(a)) return '';
    const key = PE.lightKey(a);
    if (core.staff().some(s => PE.lightKey(s.name) === key)) return '';
    const p = plan();
    const map = p.aliasesMap();
    if (Object.keys(map).some(x => PE.lightKey(x) === key)) return '';
    const prof = p.profile(person);
    if (prof && prof.aliases.length >= ALIASES_PER) return '';
    return a;
  }
  function aliasItems() {
    if (!core.isSup()) return [];
    const by = new Map();
    st.qs.forEach(q => {
      if (!q.alias || (q.kind !== 'unmatched' && q.kind !== 'fuzzy')) return;
      const person = personOfQ(q);
      const a = person ? aliasFor(q.raw, person) : '';
      if (!a) return;
      if (!by.has(person)) by.set(person, []);
      const l = by.get(person);
      if (l.map(PE.lightKey).indexOf(PE.lightKey(a)) < 0) l.push(a);
    });
    const items = [];
    by.forEach((list, name) => {
      const prof = plan().profile(name);
      const aliases = (prof ? prof.aliases.slice() : []).concat(list).slice(0, ALIASES_PER);
      items.push({ name, patch: { aliases } });
    });
    return items;
  }

  /* ---------------------------------------------------------------- sheet rendering */
  function renderSheet() {
    if (!st || !sheetEl) return;
    const body = sheetEl.querySelector('[data-bu-body]');
    const actions = sheetEl.querySelector('[data-bu-actions]');
    const focusKey = document.activeElement && sheetEl.contains(document.activeElement) ? document.activeElement.getAttribute('data-bu-focus') : null;
    sheetEl.querySelector('[data-sheet-title]').textContent = st.existing ? 'แก้ข้อความแทนเวร' : 'ข้อความแทนเวร';
    body.setAttribute('data-bu-step', st.step);
    if (st.step === 'input') { body.innerHTML = inputHtml(); actions.innerHTML = inputActions(); }
    else { body.innerHTML = reviewHtml(); actions.innerHTML = reviewActions(); }
    if (focusKey) {
      const f = sheetEl.querySelector('[data-bu-focus="' + focusKey.replace(/["\\]/g, '\\$&') + '"]');
      if (f) f.focus();
    }
  }

  function errorHtml() {
    return st.error ? '<p class="' + K().fieldError + '" role="alert" data-bu-error>' + esc(st.error) + '</p>' : '';
  }

  function inputHtml() {
    const k = K();
    const n = cleanText(st.text).length;
    const del = canDelete(core, st.existing)
      ? '<button type="button" class="' + k.btn + ' ' + k.btnGhost + ' text-coral-700" id="buDeleteBtn" data-bu-act="delete" data-bu-focus="delete"' + (st.busy ? ' disabled aria-busy="true"' : '') + '>' +
        core.Kit.icon('trash', 'w-5 h-5') + (st.busy ? 'กำลังลบ…' : 'ลบข้อความ') + '</button>' : '';
    // FIX-BU B-4: "วางจากคลิปบอร์ด" only where the browser offers navigator.clipboard.readText
    const clip = canReadClipboard()
      ? '<button type="button" class="' + k.btn + ' ' + k.btnSecondary + ' w-full" id="buClipBtn" data-bu-act="clip" data-bu-focus="clip"' + (st.busy || st.clipBusy ? ' disabled' : '') + '>' +
        core.Kit.icon('clipboard', 'w-5 h-5') + 'วางจากคลิปบอร์ด</button>' +
        (st.clipHint ? '<p class="' + k.textCaption + '" role="status" data-bu-cliphint>' + esc(st.clipHint) + '</p>' : '')
      : '';
    return '<p class="' + k.textMeta + '">' + esc(dayRef(st.date)) + ' · ' + esc(U().thaiDate(st.date)) + '</p>' + clip +
      '<div class="space-y-1"><label for="buText" class="' + k.label + '">ข้อความจาก LINE</label>' +
      '<textarea id="buText" rows="8" class="' + k.textarea + ' text-base" placeholder="วางข้อความจาก LINE ที่นี่" maxlength="' + (TEXT_MAX * 2) + '" data-bu-focus="text"' + (st.busy ? ' disabled' : '') + '>' + esc(st.text) + '</textarea>' +
      '<p class="' + (n > TEXT_MAX ? k.dialogCountDanger : k.dialogCount) + '" data-bu-chars aria-live="polite">' + n.toLocaleString('en-US') + '/' + TEXT_MAX.toLocaleString('en-US') + '</p></div>' +
      errorHtml() +
      '<p class="' + k.textCaption + '">ระบบอ่านวันที่และรายชื่อให้ตรวจก่อนบันทึก — ข้อความของวันเดียวกันที่บันทึกใหม่จะแทนที่ของเดิม</p>' + del;
  }
  function inputActions() {
    const k = K();
    return '<button type="button" class="flex-1 ' + k.btn + ' ' + k.btnSecondary + '" id="buCancelBtn" data-bu-act="cancel" data-bu-focus="cancel">ยกเลิก</button>' +
      '<button type="button" class="flex-1 min-w-0 ' + k.btn + ' ' + k.btnPrimary + '" id="buParseBtn" data-bu-act="parse" data-bu-focus="parse"' + (st.busy ? ' disabled' : '') + '>อ่านข้อความ</button>';
  }

  function section(title, inner, attrs) {
    return '<div class="space-y-2"' + (attrs || '') + '><h3 class="' + K().sectionTitle + ' text-sm">' + esc(title) + '</h3>' + inner + '</div>';
  }
  function ansBtn(q, value, labelHtml, on, disabled) {
    const k = K();
    return '<button type="button" role="radio" aria-checked="' + (on ? 'true' : 'false') + '" class="' + k.tile + ' ' + (on ? k.tileOn : k.tileOff) + ' min-w-0"' +
      ' data-bu-act="ans" data-q="' + esc(q) + '" data-bu-ans="' + esc(value) + '" data-bu-focus="' + esc(q + '=' + value) + '"' + (disabled ? ' disabled' : '') + '>' + labelHtml + '</button>';
  }

  function questionHtml(q, i) {
    const k = K();
    const where = q.thisUnit ? 'มาช่วย ' + q.unit : 'ไป ' + q.unit;
    let head, opts;
    if (q.kind === 'ambiguous') {
      head = '"' + esc(q.raw) + '" หมายถึงใคร?';
      opts = '<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="' + esc(q.raw) + '">' +
        q.candidates.map(n => ansBtn(q.key, n, '<span class="truncate">' + esc(n) + '</span>', q.answer === n)).join('') +
        ansBtn(q.key, '', 'ไม่นับ', q.answer === '') + '</div>';
    } else if (q.kind === 'fuzzy') {
      head = '"' + esc(q.raw) + '" = ' + esc(q.name) + ' ใช่ไหม?';
      opts = '<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="' + esc(q.raw) + '">' +
        ansBtn(q.key, 'yes', 'ใช่', q.answer === 'yes') + ansBtn(q.key, 'no', 'ไม่ใช่', q.answer === 'no') + '</div>';
    } else {
      head = 'ไม่พบ "' + esc(q.raw) + '" ในรายชื่อ';
      const staff = core.staff();
      const group = (g, label) => {
        const list = staff.filter(s => s.group === g);
        return list.length ? '<optgroup label="' + label + '">' + list.map(s => '<option value="' + esc(s.name) + '"' + (q.answer === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</optgroup>' : '';
      };
      const id = 'buPick' + i;
      opts = '<label for="' + id + '" class="sr-only">เลือกชื่อของ "' + esc(q.raw) + '"</label>' +
        '<select id="' + id + '" class="' + k.select + '" data-bu-pick="' + esc(q.key) + '" data-bu-focus="' + esc('pick=' + q.key) + '">' +
        '<option value=""' + (q.answer === undefined ? ' selected' : '') + '>— เลือกชื่อ —</option>' +
        '<option value="' + SKIP + '"' + (q.answer === '' ? ' selected' : '') + '>ไม่นับ</option>' +
        group('backup', 'ทีมแทนเวร') + group('regular', 'คนประจำ') + '</select>';
    }
    let alias = '';
    const person = personOfQ(q);
    if (core.isSup() && person && (q.kind === 'unmatched' || q.kind === 'fuzzy')) {
      const a = aliasFor(q.raw, person);
      if (a) {
        alias = '<label class="flex items-center gap-3 min-h-[44px] text-sm leading-6 text-ink-800 cursor-pointer">' +
          '<input type="checkbox" class="w-5 h-5 shrink-0 accent-brand-600" data-bu-alias="' + esc(q.key) + '" data-bu-focus="' + esc('alias=' + q.key) + '"' + (q.alias ? ' checked' : '') + '>' +
          '<span class="min-w-0 break-words">จำ "' + esc(a) + '" เป็นชื่อเรียกของ ' + esc(person) + '</span></label>';
      }
    }
    const status = q.answer === undefined ? '' : (person ? '' : '<p class="' + k.textCaption + '" data-bu-skipped>ไม่นับคนนี้</p>');
    return '<div class="p-3 rounded-2xl border-2 ' + (q.answer === undefined ? 'border-sun-300 bg-sun-50' : 'border-ink-100 bg-white') + ' space-y-2"' +
      ' data-bu-q="' + esc(q.key) + '" data-kind="' + q.kind + '" data-raw="' + esc(q.raw) + '" data-answered="' + (q.answer === undefined ? '0' : '1') + '">' +
      '<p class="text-sm font-medium leading-6 text-ink-900 break-words">' + head + '</p>' +
      '<p class="' + k.textCaption + '">' + esc(where) + '</p>' + opts + status + alias + '</div>';
  }

  function dateQuestionHtml() {
    const k = K();
    const q = st.dateQ;
    const msgOk = inWindow(q.msgDate);
    return '<div class="p-3 rounded-2xl border-2 ' + (q.answer ? 'border-ink-100 bg-white' : 'border-sun-300 bg-sun-50') + ' space-y-2" data-bu-q="date" data-kind="date" data-answered="' + (q.answer ? '1' : '0') + '">' +
      '<p class="text-sm font-medium leading-6 text-ink-900" data-bu-mismatch>ข้อความนี้เป็นของวันที่ ' + esc(U().thaiDateShort(q.msgDate)) + ' แต่คุณกำลังดูวันที่ ' + esc(U().thaiDateShort(st.date)) + '</p>' +
      '<div class="flex flex-col gap-2" role="radiogroup" aria-label="บันทึกเป็นวันที่">' +
      ansBtn('date', q.msgDate, 'บันทึกเป็นวันที่ ' + esc(shortDate(q.msgDate)), q.answer === q.msgDate, !msgOk) +
      ansBtn('date', st.date, 'บันทึกเป็นวันที่ ' + esc(shortDate(st.date)), q.answer === st.date) + '</div>' +
      (msgOk ? '' : '<p class="' + k.textCaption + '">' + esc(MSG.window) + '</p>') + '</div>';
  }

  /** Notes from the parser's warnings that the user should see (never questions). */
  function notesOf(res) {
    const out = [];
    res.warnings.forEach(w => {
      if (w.code === 'HELP_NOTE') out.push((w.name ? w.name + ': ' : '') + w.note);
      else if (w.code === 'UNPARSED_LINE') out.push('อ่านบรรทัดนี้ไม่ออก (ไม่นับ): ' + w.text);
      else if (w.code === 'UNKNOWN_UNIT') out.push('ไม่รู้จักหน่วย "' + w.unit + '" — นับเป็นไปช่วยหน่วยอื่น');
      else if (w.code === 'MULTI_UNIT') out.push('บรรทัดหนึ่งมีหลายหน่วย ("' + w.unit + '") — ตรวจรายชื่อให้ถูกต้อง');
      else if (w.code === 'DUPLICATE_PERSON') out.push(w.name + ' อยู่ในหลายหน่วย (' + w.units.join(', ') + ')');
      else if (w.code === 'NO_NAMES') out.push('มีบรรทัดที่ไม่มีชื่อคน');
      else if (w.code === 'DUPLICATE_DATE') out.push('ข้อความมีวันที่เดียวกันซ้ำ ' + w.count + ' ชุด — ใช้ชุดสุดท้าย');
      else if (w.code === 'MULTIPLE_BLOCKS') out.push('ข้อความมี ' + w.count + ' วัน — ใช้เฉพาะส่วนของวันที่ ' + (res.date ? U().thaiDateShort(res.date) : 'ที่ไม่มีวันที่'));
      else if (w.code === 'RELATIVE_DATE') out.push('ข้อความเขียนว่า "วันนี้/พรุ่งนี้" แทนวันที่');
    });
    return out;
  }

  function reviewHtml() {
    const k = K();
    const res = st.res;
    const out = compute();
    const target = saveDate();
    let dateLine;
    if (!res.date) dateLine = 'ไม่พบวันที่ในข้อความ — จะบันทึกเป็นวันที่ ' + U().thaiDateShort(st.date);
    else if (res.dateMatches) dateLine = 'ข้อความของวันที่ ' + U().thaiDateShort(res.date) + ' (ตรงกับวันที่เลือก)';
    else dateLine = 'ข้อความของวันที่ ' + U().thaiDateShort(res.date);
    let html = '<p class="flex items-start gap-2 text-sm font-medium leading-6 text-ink-900" data-bu-date="' + esc(res.date || '') + '">' +
      core.Kit.icon('calendar', 'w-5 h-5 shrink-0 mt-0.5 text-ink-500') + '<span class="min-w-0">' + esc(dateLine) + '</span></p>';
    if (target && target !== st.date && plan().backup(target)) {
      html += '<p class="' + k.note + '" data-bu-overwrite>' + core.Kit.icon('info', 'w-5 h-5 shrink-0 mt-0.5') +
        '<span>วันที่ ' + esc(U().thaiDateShort(target)) + ' มีข้อความแทนเวรอยู่แล้ว — ข้อความนี้จะแทนที่ของเดิม</span></p>';
    }
    const qCount = st.qs.length + (st.dateQ ? 1 : 0);
    if (qCount) {
      html += section('ต้องเลือก (' + qCount + ')', (st.dateQ ? dateQuestionHtml() : '') + st.qs.map(questionHtml).join(''), ' data-bu-questions');
    }
    const helpers = out.helpers.length
      ? '<div class="flex flex-wrap gap-2">' + out.helpers.map(h =>
        '<span class="' + k.personChip + '" data-bu-helper="' + esc(h.name) + '" data-station="' + esc(h.station) + '">' + core.Kit.avatar(h.name, 'xs') +
        '<span class="break-words">' + esc(h.name) + '</span>' + leaveTag(core, saveDate() || st.date, h.name) + stationChip(h.station) + '</span>').join('') + '</div>'
      : '<p class="' + k.textMeta + '" data-bu-nohelpers>— ไม่มี</p>';
    html += section('มาช่วยหน่วยนี้ (IPD/ER/Portable)', helpers, ' data-bu-helpers');
    const away = out.away.length
      ? '<ul class="space-y-1">' + out.away.map(a =>
        '<li class="flex flex-wrap items-center gap-x-2 text-sm leading-6 text-slate-700" data-bu-away-row="' + esc(a.name) + '" data-unit="' + esc(a.unit) + '">' +
        '<span class="font-medium text-ink-900 break-words">' + esc(a.name) + '</span><span aria-hidden="true">→</span><span class="break-words">' + esc(a.unit) + '</span></li>').join('') + '</ul>'
      : '<p class="' + k.textMeta + '" data-bu-noaway>— ไม่มี</p>';
    html += section('ไปหน่วยอื่น', away, ' data-bu-away');
    if (res.remarks.length) {
      html += section('หมายเหตุในข้อความ', '<ul class="space-y-1 list-disc pl-5 text-sm leading-6 text-slate-700">' +
        res.remarks.map(r => '<li class="break-words">' + esc(r) + '</li>').join('') + '</ul>', ' data-bu-remarks');
    }
    const notes = notesOf(res);
    if (notes.length) {
      html += section('ข้อสังเกต', '<ul class="space-y-1 list-disc pl-5 text-sm leading-6 text-slate-700">' +
        notes.map(r => '<li class="break-words ' + k.wrapAnywhere + '">' + esc(r) + '</li>').join('') + '</ul>', ' data-bu-notes');
    }
    if (!res.entries.length) html += '<p class="' + k.note + '" data-bu-nothing>' + core.Kit.icon('info', 'w-5 h-5 shrink-0 mt-0.5') + '<span>อ่านไม่พบรายชื่อในข้อความ — ตรวจว่าวางข้อความถูกชุด</span></p>';
    const left = openCount();
    if (left) html += '<p class="' + k.textCaption + ' text-amber-800" data-bu-left="' + left + '">ตอบคำถามให้ครบก่อนบันทึก (เหลือ ' + left + ' ข้อ)</p>';
    html += errorHtml();
    return html;
  }
  function reviewActions() {
    const k = K();
    const dis = st.busy || openCount() > 0 || !saveDate();
    return '<button type="button" class="flex-1 ' + k.btn + ' ' + k.btnSecondary + '" id="buBackBtn" data-bu-act="back" data-bu-focus="back"' + (st.busy ? ' disabled' : '') + '>แก้ข้อความ</button>' +
      '<button type="button" class="flex-1 min-w-0 ' + k.btn + ' ' + k.btnPrimary + '" id="buSaveBtn" data-bu-act="save" data-bu-focus="save"' + (dis ? ' disabled' : '') + (st.busy ? ' aria-busy="true"' : '') + '>' +
      (st.busy ? 'กำลังบันทึก…' : 'บันทึก') + '</button>';
  }

  /* ---------------------------------------------------------------- sheet events */
  function onSheetClick(e) {
    const b = e.target && e.target.closest && e.target.closest('[data-bu-act]');
    if (!b || b.disabled || !st) return;
    const act = b.getAttribute('data-bu-act');
    if (act === 'cancel') closeSheet();
    else if (act === 'parse') parse();
    else if (act === 'clip') core.spawn(() => pasteClipboard(core));
    else if (act === 'back') { if (!st.busy) { st.step = 'input'; st.error = ''; renderSheet(); } }
    else if (act === 'save') core.spawn(() => save(core));
    else if (act === 'delete') core.spawn(() => remove(core));
    else if (act === 'ans') answer(b.getAttribute('data-q'), b.getAttribute('data-bu-ans'));
  }
  function onSheetChange(e) {
    const t = e.target;
    if (!st || !t || !t.getAttribute) return;
    if (t.hasAttribute('data-bu-pick')) {
      const v = t.value;
      answer(t.getAttribute('data-bu-pick'), v === SKIP ? '' : (v === '' ? undefined : v));
    } else if (t.hasAttribute('data-bu-alias')) {
      const q = st.qs.filter(x => x.key === t.getAttribute('data-bu-alias'))[0];
      if (q) { q.alias = !!t.checked; remember(q); }
    }
  }
  function onSheetInput(e) {
    const t = e.target;
    if (!st || !t || t.id !== 'buText') return;
    st.text = t.value;
    if (st.error) { st.error = ''; const er = sheetEl.querySelector('[data-bu-error]'); if (er) er.remove(); }
    const n = cleanText(t.value).length;
    const cnt = sheetEl.querySelector('[data-bu-chars]');
    if (cnt) {
      cnt.textContent = n.toLocaleString('en-US') + '/' + TEXT_MAX.toLocaleString('en-US');
      cnt.className = n > TEXT_MAX ? K().dialogCountDanger : K().dialogCount;
    }
  }
  function remember(q) { lastAnswers[q.key] = { answer: q.answer, alias: q.alias }; }
  function answer(key, value) {
    if (!st || st.step !== 'review' || st.busy) return;
    if (key === 'date') {
      if (!st.dateQ || (value !== st.dateQ.msgDate && value !== st.date)) return;
      if (value === st.dateQ.msgDate && !inWindow(value)) return;
      st.dateQ.answer = value;
      lastAnswers['date|' + st.dateQ.msgDate] = value;
    } else {
      const q = st.qs.filter(x => x.key === key)[0];
      if (!q) return;
      if (value !== undefined && !validAnswer(q, value)) return;
      q.answer = value;
      if (!personOfQ(q)) q.alias = false;
      remember(q);
    }
    st.error = '';
    renderSheet();
  }

  /* ---------------------------------------------------------------- writes */
  async function save(c) {
    const s = st;
    if (!s || s.busy || s.step !== 'review' || openCount() > 0) return;
    const date = saveDate();
    if (!date) return;
    if (!c.requireInternet()) return;
    const out = compute();
    const items = aliasItems();
    const alive = c.alive();
    s.busy = true;
    s.error = '';
    renderSheet();
    try {
      await plan(c).saveBackupMsg({ date, text: s.clean, helpers: out.helpers, away: out.away });
    } catch (e) {
      if (!alive()) return;
      s.busy = false;
      if (e && e.name === 'ApiError' && (e.code === 'VALIDATION' || e.code === 'TOO_LARGE')) {
        s.error = e.message;
        if (st === s) renderSheet();
        return;
      }
      if (e && e.code === 'FORBIDDEN') { if (st === s) closeSheet(); }
      else if (st === s) renderSheet();
      c.handleError(e, { write: true });
      return;
    }
    if (!alive()) return;
    if (st === s) closeSheet();
    const where = date === c.selectedDate() ? '' : ' (' + dayRef(date) + ')';
    c.toast(MSG.saved + where);
    if (!items.length) return;
    try {
      await plan(c).setProfiles({ items });
      if (alive()) c.toast(MSG.saved + where + ' · จำชื่อเรียกอื่นแล้ว');
    } catch (e) {
      if (!alive()) return;
      c.toast('⚠️ บันทึกข้อความแทนเวรแล้ว แต่จำชื่อเรียกอื่นไม่สำเร็จ: ' + (e && e.message ? e.message : ''), 0, { error: true });
    }
  }

  async function remove(c) {
    const s = st;
    if (!s || s.busy || !canDelete(c, s.existing)) return;
    if (!c.requireInternet()) return;
    const alive = c.alive();
    const ok = await c.confirm('ลบข้อความแทนเวรของ' + dayRef(s.date) + 'ใช่หรือไม่?\nรายชื่อทีมแทนเวรของวันนั้นจะหายไปด้วย',
      { title: 'ลบข้อความแทนเวร', okLabel: 'ลบข้อความ', cancelLabel: 'ยกเลิก', danger: true, icon: 'trash', data: { buDialog: 'delete' } });
    if (!ok || !alive() || st !== s) return;
    s.busy = true;
    s.error = '';
    renderSheet();
    try {
      await plan(c).saveBackupMsg({ date: s.date, text: '', helpers: [], away: [] });
    } catch (e) {
      if (!alive()) return;
      s.busy = false;
      if (e && e.code === 'FORBIDDEN') { if (st === s) closeSheet(); }
      else if (st === s) renderSheet();
      c.handleError(e, { write: true });
      return;
    }
    if (!alive()) return;
    if (st === s) closeSheet();
    c.toast(MSG.deleted);
  }

  /* ---------------------------------------------------------------- registration */
  App.register({
    id: ID,
    title: 'ทีมแทนเวร',
    nav: { place: 'none' },
    visible: () => false,   // no screen: the panel on วันนี้ is the whole feature
    init(c) {
      core = c;
      c.station.addPanel({ id: ID, order: 10, render: renderPanel });
      // the Supervisor role may go away (role transfer, server without 'plan'): close an open sheet
      c.on('role', () => { if (st && !st.busy && !canPost(c)) closeSheet(); });
      c.on('data', () => { if (st && !st.busy && !(enabled(c) && canPost(c))) closeSheet(); });
      c.on('online', () => c.render());
      window.addEventListener('offline', () => { if (c.state.user) c.render(); });
    },
    reset() {
      st = null;
      awayOpen = false;
      textOpen = false;
      lastAnswers = Object.create(null);
      if (sheetEl) {
        if (core && core.Kit.sheet.isOpen(sheetEl)) core.Kit.sheet.close(sheetEl, 'api');
        sheetEl.remove();
        sheetEl = null;
      }
    }
  });
})();
