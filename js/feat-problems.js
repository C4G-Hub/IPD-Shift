/* =====================================================================
 * js/feat-problems.js — feature "problems" (แจ้งปัญหา) → App.register (R3-SPEC §4.6, track PR)
 *
 * Problem reports per station with up to 3 photos. Uses only App.core (developer note of the registry section in
 * js/app.js), UiKit and XlsxLite; the server actions are Code.gs 3.2's reportProblem, addProblemPhoto,
 * removeProblemPhoto, resolveProblem, reopenProblem, deleteProblem, purgeProblemPhotos, getProblems and getFile.
 *
 *  id 'problems' · title "แจ้งปัญหา" · icon alert-triangle · nav เมนู → ของฉัน (order 20) · parent 'menu' · visible while
 *  core.serverHas('problem'). On an older server nothing is shown, the station-card button stays off (app.js checks the
 *  feature too) and no request is sent.
 *
 * Data: core.domain('problem', {persist: true}) holds {range, problems, storage} of the default range (the server's
 * today − 90 … today, every open problem included). It is fetched only while the screen is shown (on show and when the
 * heartbeat's versions.problem differs) or when a service asks (problems.ensure), never while the remote version is ''
 * (no problem at all: a domain holding data of an older version is emptied once the heartbeat confirmed it); knownVersion
 * is sent only when the stored range is the current default range. Own writes apply their answer with touch(). A custom
 * range ("กำหนดเอง", ≤ 400 days) is fetched into memory only.
 *
 * Screen: "แจ้งปัญหาใหม่" (primary, alert-triangle — never a plus glyph), status chips ยังไม่แก้ · แก้แล้ว · ทั้งหมด, Station
 * select (ทุก Station, the 7 stations, อื่นๆ), range select (90 วันล่าสุด / กำหนดเอง with two date inputs), "Excel (.xlsx)"
 * (hidden without window.XlsxLite); the Supervisor also sees the storage meter (warn from 80 %) and "ล้างรูปเก่า". Cards:
 * station chip, #id, status pill, the detail clamped to 3 lines (escaped, pre-wrap, overflow-wrap anywhere), reporter
 * and resolver meta, photo count, and the outbox line "รอส่งรูป N รูป — แตะเพื่อส่งอีกครั้ง".
 *
 * Sheets (own elements on <body>, the UiKit sheet stack):
 *  - report: Station (preselected from a station card), detail textarea (counter, 1,000), the PDPA notice (always shown),
 *    "แนบรูป (ไม่เกิน 3 รูป)" (native file input, multiple). Photos are processed ONE AT A TIME: UiKit.image.decode →
 *    compress(decoded, {maxSide 1280, maxChars 160,000}) → release(); only the base64 is kept (+ a preview blob: URL,
 *    revoked on removal / close). Text and station live in core.store.draft('problems:new') until sent. "ส่ง" →
 *    reportProblem → every photo is first put into core.media store 'outbox' (`<problemId>:<fileId>` → {user,
 *    problemId, fileId, mime, data, at}) and then sent with addProblemPhoto ("กำลังส่งรูป 1/3…"); a sent photo leaves the
 *    outbox, a transient failure keeps it (retried on the next show, on 'online' and on a tap of the card's outbox line),
 *    STORAGE_FULL and every other refusal drop it with the server's message.
 *  - detail: everything of one problem, photos in a 3-column grid (each read from media store 'blobs' `photo:<fileId>`
 *    or loaded once with getFile, checked with UiKit.image.jpegSize ≤ 2048 px BEFORE a blob: URL is made, cached as a
 *    Blob; every URL is revoked when the sheet closes), "รูปถูกล้างแล้ว N รูป"; actions แก้แล้ว (optional note ≤ 500 via
 *    core.prompt), แนบรูปเพิ่ม (reporter / Supervisor while open, < 3), Supervisor: เปิดอีกครั้ง, ลบเรื่องนี้.
 *  - view: one photo at full width, "ลบรูปนี้" under it (reporter while open, or the Supervisor; with a confirmation).
 *  - purge (Supervisor): "ล้างรูปของเรื่องที่แก้แล้วก่อนวันที่" (default today − 90) → a count preview (getProblems of
 *    the 399 days before that date, memory only) → confirmation → purgeProblemPhotos{problems: the previewed ids} in
 *    chunks of ≤ 200 (R3 FIX-CL L-6: exactly what was counted); the toast reports the server's real count.
 *  - R3 FIX-CL: the storage meter counts photos ("พื้นที่เก็บรูป: ใช้ไป N รูป · ประมาณ P % (เก็บได้อีกราว M รูป)"; below 0.1 % "น้อยกว่า 0.1 %"); a custom
 *    range remembers the problem version it was loaded at and reloads on show / stale when the server's differs;
 *    destructive actions in a sheet body (ลบเรื่องนี้, ลบรูปนี้) use UiKit.cls.btnGhostDanger.
 *
 * Services: core.provide('problems.report', stationId → opens the report sheet over the current screen) — this also
 * turns on the station-card button of วันนี้ — and core.provide('problems', {ensure() → Promise<bool>, list() →
 * Problem[] (the default range), openSummary() → {count, oldestDays, byStation}}).
 *
 * DOM hooks for tests: [data-pr="head|storage|list|caption"], buttons [data-pr-act="…"], [data-pr-status], filters
 * [data-pr-filter="station|range|from|to"], cards [data-problem-id], sheets [data-pr-sheet="report|detail|view|purge"],
 * report fields [data-pr-in="station|detail"], #prReportPhotoInput, #prDetailPhotoInput, [data-pr-pdpa],
 * [data-pr-progress], [data-pr-preview], [data-pr-photo="<fileId>"].
 * Every async flow runs through core.spawn / core.track and re-checks core.alive() after each await.
 * ===================================================================== */
(function () {
  'use strict';

  const App = window.App;
  if (!App || typeof App.register !== 'function' || !App.core) return;   // app.js did not start (boot guard)

  const ID = 'problems';
  const DETAIL_MAX = 1000;
  const NOTE_MAX = 500;
  const PHOTO_MAX = 3;
  const PHOTO_SIDE = 1280;              // R3-SPEC §0.7: longest side of an uploaded photo
  const PHOTO_CHARS = 160000;           // client bound of the base64 (the server accepts 180,000)
  const SERVER_CHARS = 180000;          // the largest photo accepted from the server
  const MAX_PX = 2048;                  // no picture wider or taller than this is ever turned into a blob: URL
  const WORK_SIDE = 1600;               // decode's working copy (memory of phones)
  const MAX_FILE_BYTES = 30 * 1024 * 1024;
  const RECENT_DAYS = 90;
  const RANGE_MAX = 400;
  const PHOTO_EST_CHARS = 120000;       // R3 FIX-CL L-7: a typical stored photo (the meter's "เก็บได้อีกราว M รูป")
  const PURGE_CHUNK = 200;              // purgeProblemPhotos{problems} takes at most 200 ids per request
  const FILE_ID = /^[A-Za-z0-9_-]{16,40}$/;
  const OUTBOX_KEY = /^(\d{1,9}):([A-Za-z0-9_-]{16,40})$/;
  const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const DRAFT_KEY = 'problems:new';
  const OUTBOX_FLAG = 'problems:outbox';
  const OUTBOX = 'outbox';
  const BLOBS = 'blobs';
  const PHOTO_PREFIX = 'photo:';
  const OTHER = 'other';
  const OTHER_LABEL = 'อื่นๆ';
  const STATUS_CHIPS = [{ id: 'open', label: 'ยังไม่แก้' }, { id: 'resolved', label: 'แก้แล้ว' }, { id: 'all', label: 'ทั้งหมด' }];

  const MSG = {
    title: 'แจ้งปัญหา',
    newBtn: 'แจ้งปัญหาใหม่',
    empty: 'ยังไม่มีเรื่องที่แจ้งในช่วงนี้',
    emptyHint: 'กด แจ้งปัญหาใหม่ เพื่อแจ้งเรื่องแรก',
    detailPlaceholder: 'เช่น แอร์ไม่เย็น เครื่องพิมพ์เสีย ประตูล็อกไม่ได้',
    pdpa: 'ห้ามถ่ายติดใบหน้า ชื่อ หรือ HN ของผู้ป่วย (PDPA) — ถ่ายเฉพาะอุปกรณ์หรือสถานที่',
    attach: 'แนบรูป (ไม่เกิน 3 รูป)',
    attachMore: 'แนบรูปเพิ่ม',
    pickStation: 'เลือก Station',
    needStation: 'กรุณาเลือก Station',
    needDetail: 'กรุณาพิมพ์รายละเอียดปัญหา (1–1,000 ตัวอักษร)',
    preparing: 'กำลังเตรียมรูป…',
    sending: 'กำลังส่ง…',
    sendingPhoto: (i, n) => 'กำลังส่งรูป ' + i + '/' + n + '…',
    reported: '✅ แจ้งปัญหาแล้ว',
    resolved: '✅ บันทึกว่าแก้แล้ว',
    reopened: '↩️ เปิดเรื่องอีกครั้งแล้ว',
    deleted: '🗑️ ลบเรื่องแล้ว',
    photoRemoved: '🗑️ ลบรูปแล้ว',
    purged: n => '🧹 ล้างรูปแล้ว ' + n + ' รูป',
    excel: '📥 ดาวน์โหลด Excel แล้ว',
    photoQueued: '⚠️ แจ้งปัญหาแล้ว แต่ส่งรูปไม่สำเร็จ — รูปเก็บไว้ในเครื่อง จะส่งอีกครั้งอัตโนมัติ',
    photoRetryFailed: '⚠️ ส่งรูปไม่สำเร็จ — รูปยังเก็บไว้ในเครื่อง ลองอีกครั้งเมื่อเชื่อมต่อได้',
    outboxLine: n => 'รอส่งรูป ' + n + ' รูป — แตะเพื่อส่งอีกครั้ง',
    sendingOutbox: n => 'กำลังส่งรูปที่รอส่ง ' + n + ' รูป…',
    removedLine: n => 'รูปถูกล้างแล้ว ' + n + ' รูป',
    tooMany: 'แนบรูปได้ไม่เกิน 3 รูปต่อเรื่อง',
    fileTooBig: 'ไฟล์รูปใหญ่เกินไป (เกิน 30 MB) กรุณาเลือกรูปอื่น',
    imageFailed: 'เปิดรูปนี้ไม่ได้ (เช่น รูปแบบ HEIC จากบางเครื่อง) — ลองถ่ายภาพหน้าจอของรูปนั้นแล้วเลือกภาพหน้าจอแทน หรือเลือกรูปอื่น',
    noJpeg: 'เบราว์เซอร์นี้แปลงรูปให้เป็นแบบที่ระบบรับไม่ได้ — ลองเปิดแอปด้วย Chrome หรือ Safari แล้วเลือกรูปอีกครั้ง',
    photoLoadFailed: 'โหลดรูปไม่ได้ — แตะเพื่อลองใหม่',
    badPhoto: 'ไฟล์รูปไม่ถูกต้อง',
    deleteConfirm: id => 'ลบเรื่อง #' + id + ' — ข้อความและรูปจะถูกลบ กู้คืนไม่ได้',
    removePhotoConfirm: 'ลบรูปนี้ใช่หรือไม่?\nลบแล้วกู้คืนไม่ได้',
    resolvePrompt: 'หมายเหตุการแก้ (ไม่บังคับ)',
    purgeLabel: 'ล้างรูปของเรื่องที่แก้แล้วก่อนวันที่',
    purgeConfirm: (n, m) => 'ลบรูปของ ' + n + ' เรื่อง (' + m + ' รูป) — ข้อความยังอยู่ ลบแล้วกู้คืนไม่ได้',
    purgeNone: 'ไม่มีรูปของเรื่องที่แก้แล้วก่อนวันที่นี้',
    purgeCount: (n, m) => 'เรื่องที่แก้แล้วก่อนวันที่นี้และยังมีรูป: ' + n + ' เรื่อง (' + m + ' รูป)',
    rangeError: 'ช่วงวันที่ต้องไม่เกิน 400 วัน',
    rangeOrder: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด',
    cached: 'ข้อมูลที่บันทึกไว้ในเครื่อง (ยังไม่ได้อัปเดต)',
    loadFailed: 'โหลดรายการไม่สำเร็จ',
    connection: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ลองอีกครั้ง',
    maybeSent: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ถ้าเรื่องนี้ขึ้นในรายการแล้ว ไม่ต้องส่งซ้ำ',
    storageWarn: 'พื้นที่เก็บรูปใกล้เต็ม — ล้างรูปของเรื่องที่แก้แล้วเพื่อให้แนบรูปใหม่ได้'
  };

  let C = null;                 // App.core (set in init)
  let dom = null;               // core.domain('problem')
  let root = null;              // the screen's <section>
  let built = false;            // the skeleton exists in root
  const ref = {};               // skeleton parts by data-pr name

  /** Filters of the screen (memory only; a go('problems', {status}) sets the status). */
  const ui = { status: 'open', station: '', range: 'recent', from: '', to: '', rangeError: '', busy: '' };
  /** The custom range, fetched into memory (never the domain). */
  /** R3 FIX-CL L-5: `version` = the problem version the list was loaded at (reloaded on show / stale when it differs). */
  const custom = { key: '', seq: 0, loading: false, error: null, problems: null, storage: null, version: '' };
  /** The outbox index (the photo data stays in IndexedDB): key → {problemId, fileId, at}. */
  const outbox = { loaded: false, loading: null, items: new Map(), running: false, inflight: new Set(), gen: 0 };
  /** The report sheet. photos: [{fileId, mime, data, url}]; queue: Files waiting to be processed (one at a time). */
  const report = { el: null, seq: 0, photos: [], queue: [], processing: false, sending: false, progress: '', error: '' };
  /** The detail sheet of one problem. urls: fileId → blob: URL (revoked on close); state: fileId → 'loading' | message. */
  const detail = { el: null, id: 0, gen: 0, urls: new Map(), state: new Map(), busy: '', progress: '', error: '' };
  const view = { el: null, fileId: '' };
  const purge = { el: null, seq: 0, before: '', loading: false, preview: null, error: '', busy: false };

  /* ---------------------------------------------------------------- small helpers */
  const U = () => C.U;
  const K = () => C.Kit.cls;
  const esc = s => C.esc(s);
  const icon = (n, c) => C.Kit.icon(n, c);
  const today = () => U().todayStr();
  const me = () => C.myName();
  const kit = () => C.Kit;
  function isSup() { return !!C && C.isSup(); }
  function sessionError(e) { return !!e && (e.code === 'AUTH_REQUIRED' || e.code === 'PASSWORD_CHANGE_REQUIRED'); }
  function deviceOffline() { return navigator.onLine === false; }
  function on() { return !!C && !!C.state.session && C.serverHas('problem'); }
  /** R3 FIX-CL L-11: escaped text whose fixed phrases never break inside (Thai line breaking splits "ผู้/ป่วย"). */
  function escNowrap(text, phrases) {
    let out = esc(text);
    phrases.forEach(p => { out = out.split(esc(p)).join('<span class="whitespace-nowrap">' + esc(p) + '</span>'); });
    return out;
  }
  const PDPA_PHRASES = ['HN ของผู้ป่วย', 'ใบหน้า', 'สถานที่'];
  function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function stationLabel(id) {
    if (id === OTHER) return OTHER_LABEL;
    const s = U().stationById(id);
    return s ? s.name : OTHER_LABEL;
  }
  function stationIds() { return U().STATIONS.map(s => s.id).concat([OTHER]); }
  function validStation(id) { return typeof id === 'string' && stationIds().indexOf(id) >= 0; }

  /** ISO stamp → local Date or null. */
  function stampDate(iso) {
    if (typeof iso !== 'string' || !iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  /** ISO stamp → local 'YYYY-MM-DD' ('' when invalid). */
  function stampYmd(iso) { const d = stampDate(iso); return d ? U().ymd(d) : ''; }
  /** "อ. 24 พ.ย. 08:12 น." (weekday) or "25 พ.ย. 10:00 น." */
  function stampText(iso, weekday) {
    const d = stampDate(iso);
    if (!d) return '';
    return U().thaiDateShort(d, { weekday: !!weekday, year: false }) + ' ' + U().pad2(d.getHours()) + ':' + U().pad2(d.getMinutes()) + ' น.';
  }
  /** "24/11/2569 08:12" (Excel). */
  function stampXl(iso) {
    const d = stampDate(iso);
    if (!d) return '';
    const p = U().pad2;
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + (d.getFullYear() + 543) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** The detail / note as the server stores it: CRLF → LF, trimmed. */
  function normText(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim(); }

  function errText(e) {
    if (!e) return '';
    if (e.name !== 'ApiError') return (e && e.message) || 'เกิดข้อผิดพลาด';
    if (C.Api.isTransient(e)) return e.code === 'BUSY' ? e.message : MSG.connection;
    return e.message || 'เกิดข้อผิดพลาด';
  }
  /** A refused write: its message as an error toast (the core already handles session errors). */
  function toastError(e) {
    if (sessionError(e)) return;
    if (e && e.name !== 'ApiError') console.error('[problems]', e);
    C.toast('⚠️ ' + errText(e), 0, { error: true });
  }

  /* ---------------------------------------------------------------- data cleaning (server answers, persisted copies) */
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }

  /** A Problem as the server describes it, cleaned (hostile or corrupted data never reaches the page). null = drop. */
  function cleanProblem(p) {
    if (!p || typeof p !== 'object') return null;
    const id = Number(p.id);
    if (!(Number.isInteger(id) && id > 0)) return null;
    if (p.status === 'deleted') return null;
    const status = p.status === 'resolved' ? 'resolved' : 'open';
    const seen = new Set();
    const photos = (Array.isArray(p.photos) ? p.photos : []).filter(f => {
      if (typeof f !== 'string' || !FILE_ID.test(f) || seen.has(f)) return false;
      seen.add(f);
      return true;
    }).slice(0, PHOTO_MAX);
    const removed = Number(p.photosRemoved);
    return {
      id,
      station: validStation(p.station) ? p.station : OTHER,
      detail: str(p.detail, DETAIL_MAX * 2),
      status,
      reportedBy: str(p.reportedBy, 100),
      reportedAt: str(p.reportedAt, 40),
      resolvedBy: status === 'resolved' ? str(p.resolvedBy, 100) : '',
      resolvedAt: status === 'resolved' ? str(p.resolvedAt, 40) : '',
      resolveNote: status === 'resolved' ? str(p.resolveNote, NOTE_MAX * 2) : '',
      photos,
      photosRemoved: Number.isInteger(removed) && removed > 0 ? Math.min(removed, 99) : 0,
      updatedAt: str(p.updatedAt, 40)
    };
  }
  function cleanList(list) {
    const out = [], ids = new Set();
    (Array.isArray(list) ? list : []).forEach(x => {
      const p = cleanProblem(x);
      if (p && !ids.has(p.id)) { ids.add(p.id); out.push(p); }
    });
    return out.sort((a, b) => b.id - a.id);
  }
  function cleanStorage(s) {
    if (!s || typeof s !== 'object') return null;
    const used = Number(s.used), budget = Number(s.budget), files = Number(s.files);
    if (!(isFinite(used) && used >= 0 && isFinite(budget) && budget > 0)) return null;
    return { used: Math.floor(used), budget: Math.floor(budget), files: isFinite(files) && files >= 0 ? Math.floor(files) : 0 };
  }
  function cleanRange(r) {
    return r && typeof r === 'object' && U().isValidYmd(r.from) && U().isValidYmd(r.to) ? { from: r.from, to: r.to } : null;
  }

  /** The domain's data, cleaned. */
  function domData() {
    const d = dom && dom.data && typeof dom.data === 'object' ? dom.data : {};
    return { range: cleanRange(d.range), problems: cleanList(d.problems), storage: cleanStorage(d.storage) };
  }
  /** R3 FIX-CL2 Q-2: the domain holds data (fetched in this or an earlier session, or the offline copy). */
  function hasLoaded() { return !!dom && (dom.version !== '' || !!domData().range); }
  /** The stored range is today's default range (± 1 day for the server's Bangkok date). */
  function rangeIsCurrent(range) {
    if (!range) return false;
    const n = U().daysBetweenInclusive(range.to, today());
    return n >= 0 && n <= 2;
  }

  /* ---------------------------------------------------------------- domain loading */
  /** A heartbeat said "no problem at all" ('') while the domain holds data of an older version: empty it. */
  function maybeClear() {
    if (!dom || !C.state.lastSync || dom.remote !== '' || dom.version === '') return;
    dom.commit(dom.begin(), '', () => ({ range: null, problems: [], storage: null }));
  }

  /**
   * The default range: fetched when the remote version differs from the stored one or the stored range is not today's.
   * → Promise<bool> (true when the domain holds current data; never rejects).
   */
  function loadDomain(force) {
    if (!on()) return Promise.resolve(false);
    const remote = dom.remote;
    if (!remote) { maybeClear(); return Promise.resolve(!dom.error); }
    const d = domData();
    const current = rangeIsCurrent(d.range);
    if (!force && current && dom.version === remote) return Promise.resolve(true);
    return dom.load(version => {
      const params = current && version ? { knownVersion: version } : {};
      return C.call('getProblems', params).then(r => {
        if (!r || typeof r !== 'object') throw new Error('bad answer');
        if (r.unchanged === true) return null;
        return { version: typeof r.problemVersion === 'string' ? r.problemVersion : '',
          data: { range: cleanRange(r.range), problems: cleanList(r.problems), storage: cleanStorage(r.storage) } };
      });
    }).then(() => !dom.error, () => false);
  }

  function customKey() { return ui.from + '|' + ui.to; }
  function customValid() {
    const f = ui.from, t = ui.to;
    if (!U().isValidYmd(f) || !U().isValidYmd(t)) return MSG.rangeError;
    if (f > t) return MSG.rangeOrder;
    if (U().daysBetweenInclusive(f, t) > RANGE_MAX || t > today()) return MSG.rangeError;
    return '';
  }
  /** The custom range into memory (one request per range; a newer range wins). */
  function loadCustom(force) {
    if (!on()) return;
    ui.rangeError = customValid();
    if (ui.rangeError) { custom.problems = null; custom.error = null; custom.loading = false; custom.key = ''; return; }
    const key = customKey();
    if (!force && custom.key === key && (custom.problems || custom.loading)) return;
    const my = ++custom.seq;
    if (custom.key !== key) { custom.problems = null; custom.version = ''; }   // a refresh of the same range keeps its list meanwhile
    custom.key = key;
    custom.loading = true;
    custom.error = null;
    const alive = C.alive();
    const from = ui.from, to = ui.to;
    C.spawn(async () => {
      try {
        const r = await C.call('getProblems', { from, to });
        if (!alive() || my !== custom.seq) return;
        custom.problems = cleanList(r && r.problems);
        custom.storage = cleanStorage(r && r.storage);
        custom.version = r && typeof r.problemVersion === 'string' ? r.problemVersion : '';
      } catch (e) {
        if (!alive() || my !== custom.seq) return;
        custom.error = e;
      } finally {
        if (alive() && my === custom.seq) { custom.loading = false; C.render(); }
      }
    });
  }

  /** R3 FIX-CL L-5: the custom list was loaded at another problem version than the server now announces. */
  function customStale() {
    return ui.range === 'custom' && !!custom.problems && !custom.loading && !!dom && !!dom.remote && custom.version !== dom.remote;
  }
  function refreshCustom() { if (customStale()) loadCustom(true); }

  /* ---------------------------------------------------------------- applying own writes */
  function patchCustom(fn) {
    if (!custom.problems) return;
    custom.problems = cleanList(fn(custom.problems.slice()));
  }
  /** A write's answer {problem, storage?}: the domain (touch) and the custom list. */
  function applyProblem(raw, storage) {
    const p = cleanProblem(raw);
    const st = cleanStorage(storage);
    if (!p && !st) return null;
    dom.touch(data => {
      const base = data && typeof data === 'object' ? data : {};
      let list = Array.isArray(base.problems) ? base.problems.filter(x => !(x && p && Number(x.id) === p.id)) : [];
      if (p) list = [p].concat(list);
      return { range: base.range || null, problems: list, storage: st || base.storage || null };
    });
    if (p) {
      patchCustom(list => {
        const at = list.findIndex(x => x.id === p.id);
        if (at >= 0) list[at] = p;
        else if (ui.to >= stampYmd(p.reportedAt) && ui.from <= stampYmd(p.reportedAt)) list.unshift(p);
        return list;
      });
    }
    if (st) custom.storage = st;
    refreshSheets();
    return p;
  }
  function dropProblem(id, storage) {
    const st = cleanStorage(storage);
    dom.touch(data => {
      const base = data && typeof data === 'object' ? data : {};
      const list = Array.isArray(base.problems) ? base.problems.filter(x => !(x && Number(x.id) === id)) : [];
      return { range: base.range || null, problems: list, storage: st || base.storage || null };
    });
    patchCustom(list => list.filter(x => x.id !== id));
    if (st) custom.storage = st;
  }
  function storageNow() {
    const a = domData().storage;
    return ui.range === 'custom' && custom.storage ? custom.storage : a;
  }

  function findProblem(id) {
    const n = Number(id);
    const inCustom = custom.problems ? custom.problems.filter(p => p.id === n)[0] : null;
    return domData().problems.filter(p => p.id === n)[0] || inCustom || null;
  }
  function sourceList() { return ui.range === 'custom' ? (custom.problems || []) : domData().problems; }
  function filtered() {
    return sourceList().filter(p => (ui.status === 'all' || p.status === ui.status) && (!ui.station || p.station === ui.station));
  }
  function isReporter(p) { return !!p && !!p.reportedBy && p.reportedBy === me(); }
  function canAddPhoto(p) { return !!p && p.status === 'open' && (isSup() || isReporter(p)) && p.photos.length + pendingCount(p.id) < PHOTO_MAX; }
  function canRemovePhoto(p) { return !!p && (isSup() || (isReporter(p) && p.status === 'open')); }

  /* ---------------------------------------------------------------- photos: processing, checks */
  function photoError(msg) { const e = new Error(msg); e.photo = true; return e; }
  function imageErrorText(e) {
    if (e && e.photo) return e.message;
    if (e && e.code === 'decode') return MSG.imageFailed;
    if (e && typeof e.code === 'string' && e.message && e.name !== 'ApiError') return e.message;   // UiKit's Thai messages
    return MSG.imageFailed;
  }
  /** A JPEG base64 the app may turn into a picture: charset, magic bytes, size, frame header ≤ MAX_PX (never decoded). */
  function validJpeg(data, maxChars) {
    if (typeof data !== 'string' || !data || data.length > (maxChars || SERVER_CHARS) || data.length % 4 !== 0) return false;
    if (data.indexOf('/9j/') !== 0 || !B64.test(data)) return false;
    const s = kit().image.jpegSize ? kit().image.jpegSize(data) : null;
    return !!s && s.width <= MAX_PX && s.height <= MAX_PX;
  }
  function b64Blob(data) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }
  function validBlob(v) {
    return !!v && typeof v === 'object' && typeof v.size === 'number' && typeof v.slice === 'function' &&
      v.type === 'image/jpeg' && v.size > 0 && v.size <= SERVER_CHARS;
  }
  function revoke(url) { if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } } }

  /**
   * One chosen file → {fileId, mime, data} (decode once, compress the working copy, release it at once; only the base64
   * is kept). Rejects with a Thai message. null when the session ended meanwhile.
   */
  async function processFile(file, alive) {
    if (!file || typeof file.size !== 'number') throw photoError(MSG.imageFailed);
    if (file.size > MAX_FILE_BYTES) throw photoError(MSG.fileTooBig);
    let d = null, r = null;
    try {
      d = await C.track(kit().image.decode(file, { maxSide: WORK_SIDE }));
      if (!alive()) return null;
      r = await C.track(kit().image.compress(d, { maxSide: PHOTO_SIDE, maxChars: PHOTO_CHARS, mime: 'image/jpeg' }));
    } finally {
      if (d) { try { d.release(); } catch (e) { /* ignore */ } }
    }
    if (!alive()) return null;
    if (!r || r.mime !== 'image/jpeg') throw photoError(MSG.noJpeg);
    if (!(r.chars <= PHOTO_CHARS) || !validJpeg(r.base64, PHOTO_CHARS)) throw photoError(MSG.imageFailed);
    return { fileId: C.Api.newId(), mime: 'image/jpeg', data: r.base64 };
  }

  /* ---------------------------------------------------------------- outbox */
  function pendingCount(problemId) {
    let n = 0;
    outbox.items.forEach(it => { if (it.problemId === problemId) n++; });
    return n;
  }
  function validEntry(v, key) {
    const m = OUTBOX_KEY.exec(String(key));
    return !!m && !!v && typeof v === 'object' && v.user === me() && Number(v.problemId) === Number(m[1]) && v.fileId === m[2] &&
      v.mime === 'image/jpeg' && validJpeg(v.data, SERVER_CHARS);
  }
  /**
   * Reads the outbox index from IndexedDB once per session (entries of another user or broken ones are deleted). The
   * per-user draft flag 'problems:outbox' (set while something is queued; wiped at logout with the outbox itself) keeps
   * IndexedDB closed on devices that never queued a photo.
   */
  function ensureOutbox() {
    if (outbox.loaded) return Promise.resolve();
    if (outbox.loading) return outbox.loading;
    if (!C.store.draft.get(OUTBOX_FLAG)) { outbox.loaded = true; return Promise.resolve(); }
    const alive = C.alive(), gen = outbox.gen;
    const p = C.track((async () => {
      let keys = [];
      try { keys = await C.media.keys(OUTBOX); } catch (e) { keys = []; }
      if (!alive() || gen !== outbox.gen) return;
      for (const key of (keys || []).filter(k => typeof k === 'string')) {
        let v = null;
        try { v = await C.media.get(OUTBOX, key); } catch (e) { v = null; }
        if (!alive() || gen !== outbox.gen) return;
        if (validEntry(v, key)) outbox.items.set(key, { problemId: Number(v.problemId), fileId: v.fileId, at: Number(v.at) || 0 });
        else C.media.del(OUTBOX, key).catch(() => {});
      }
      outbox.loaded = true;
      syncOutboxFlag();
    })()).then(() => { if (outbox.loading === p) outbox.loading = null; if (alive()) C.render(); },
      () => { if (outbox.loading === p) outbox.loading = null; });
    outbox.loading = p;
    return p;
  }
  /** Puts a photo into the outbox (IndexedDB first, then the index). → key */
  async function queuePhoto(problemId, photo) {
    const key = problemId + ':' + photo.fileId;
    const at = Date.now() + outbox.items.size / 1000;
    try {
      await C.media.put(OUTBOX, key, { user: me(), problemId, fileId: photo.fileId, mime: photo.mime, data: photo.data, at });
    } catch (e) { console.error('[problems] outbox write failed:', e && e.name); }
    outbox.items.set(key, { problemId, fileId: photo.fileId, at });
    syncOutboxFlag();
    return key;
  }
  function unqueue(key) {
    outbox.items.delete(key);
    C.media.del(OUTBOX, key).catch(() => {});
    syncOutboxFlag();
  }
  function syncOutboxFlag() {
    if (outbox.items.size) C.store.draft.set(OUTBOX_FLAG, 1);
    else if (outbox.loaded) C.store.draft.remove(OUTBOX_FLAG);
  }

  /**
   * Sends one photo. → 'ok' | {drop: message} (refused: removed from the outbox) | {stop: error} (transient or the session
   * ended: kept for the next try).
   */
  async function uploadOne(key, entry, alive) {
    outbox.inflight.add(key);
    let ans = null, err = null;
    try {
      ans = await C.userCall('addProblemPhoto', { id: entry.problemId, fileId: entry.fileId, mime: entry.mime, data: entry.data });
    } catch (e) { err = e; }
    outbox.inflight.delete(key);
    if (!alive()) return { stop: err || new Error('session') };
    if (!err) {
      unqueue(key);
      applyProblem(ans && ans.problem, ans && ans.storage);
      return 'ok';
    }
    if (sessionError(err) || err.name !== 'ApiError' || C.Api.isTransient(err)) return { stop: err };
    unqueue(key);   // STORAGE_FULL, PHOTOS_FULL, PROBLEM_CLOSED, NOT_FOUND, FORBIDDEN, BAD_PHOTO, TOO_LARGE: retrying cannot help
    return { drop: errText(err) };
  }

  /** The outbox, one photo at a time (one run at a time). why: 'show' | 'online' | 'tap'. */
  function retryOutbox(why, onlyProblem) {
    if (!on() || outbox.running || deviceOffline()) return;
    outbox.running = true;
    const alive = C.alive(), gen = outbox.gen;
    C.spawn(async () => {
      let drop = '', stopped = null, sent = 0;
      try {
        await ensureOutbox();
        if (!alive() || gen !== outbox.gen) return;
        const keys = Array.from(outbox.items.keys())
          .filter(k => !onlyProblem || outbox.items.get(k).problemId === onlyProblem)
          .sort((a, b) => outbox.items.get(a).at - outbox.items.get(b).at);
        for (const key of keys) {
          if (!alive() || gen !== outbox.gen) return;
          if (outbox.inflight.has(key) || !outbox.items.has(key)) continue;
          let v = null;
          try { v = await C.media.get(OUTBOX, key); } catch (e) { v = null; }
          if (!alive() || gen !== outbox.gen) return;
          if (!validEntry(v, key)) { unqueue(key); continue; }
          C.render();
          const res = await uploadOne(key, { problemId: Number(v.problemId), fileId: v.fileId, mime: v.mime, data: v.data }, alive);
          if (res === 'ok') { sent++; continue; }
          if (res.drop) { drop = drop || res.drop; continue; }
          stopped = res.stop;
          break;
        }
      } finally {
        if (gen === outbox.gen) outbox.running = false;
      }
      if (!alive()) return;
      C.render();
      if (drop) C.toast('⚠️ ' + drop, 0, { error: true });
      else if (stopped && why === 'tap' && !sessionError(stopped)) C.toast(MSG.photoRetryFailed, 0, { error: true });
      return sent;
    });
  }

  /* ---------------------------------------------------------------- the screen */
  function skeleton() {
    return `<div class="space-y-3 md:max-w-2xl md:mx-auto">` +
      `<div data-pr="head" class="space-y-3"></div>` +
      `<div data-pr="storage"></div>` +
      `<p data-pr="caption" class="hidden"></p>` +
      `<div data-pr="list" class="space-y-3" aria-live="polite"></div>` +
      `</div>`;
  }
  function ensureBuilt(el) {
    if (built && el.querySelector('[data-pr="head"]')) return;
    el.innerHTML = skeleton();
    el._html = '';
    ['head', 'storage', 'caption', 'list'].forEach(n => { ref[n] = el.querySelector('[data-pr="' + n + '"]'); });
    built = true;
  }

  function dateCaption(id, v) {
    return U().isValidYmd(v) ? `<p id="${id}" class="${K().dateCaption}">${esc(U().thaiDateShort(v))}</p>` : '';
  }

  function headHtml() {
    const k = K();
    const chips = STATUS_CHIPS.map(s => {
      const onC = ui.status === s.id;
      return `<button type="button" class="${k.chip} ${onC ? k.chipOn : k.chipOff}" data-pr-act="status" data-pr-status="${s.id}" aria-pressed="${onC}">${esc(s.label)}</button>`;
    }).join('');
    const stOpts = `<option value="">ทุก Station</option>` + U().STATIONS.map(s =>
      `<option value="${esc(s.id)}"${ui.station === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('') +
      `<option value="${OTHER}"${ui.station === OTHER ? ' selected' : ''}>${OTHER_LABEL}</option>`;
    const rgOpts = `<option value="recent"${ui.range === 'recent' ? ' selected' : ''}>${RECENT_DAYS} วันล่าสุด</option>` +
      `<option value="custom"${ui.range === 'custom' ? ' selected' : ''}>กำหนดเอง</option>`;
    let html = `<button type="button" class="${k.btn} ${k.btnPrimary} w-full sm:w-auto" data-pr-act="new">${icon('alert-triangle', 'w-5 h-5')}${esc(MSG.newBtn)}</button>` +
      `<div class="flex flex-wrap gap-2" role="group" aria-label="สถานะ">${chips}</div>` +
      `<div class="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">` +
      `<div class="min-w-0"><label class="${k.label}" for="prFilterStation">Station</label>` +
      `<select id="prFilterStation" class="${k.select}" data-pr-filter="station">${stOpts}</select></div>` +
      `<div class="min-w-0"><label class="${k.label}" for="prFilterRange">ช่วงเวลา</label>` +
      `<select id="prFilterRange" class="${k.select}" data-pr-filter="range">${rgOpts}</select></div></div>`;
    if (ui.range === 'custom') {
      // I2: side by side only when each date field gets 8.5rem, else stacked — a native date field that will not get
      // narrower (iOS) never leaves the screen (index.html summary range pattern)
      html += `<div class="flex flex-wrap gap-2" data-pr="custom">` +
        `<div class="flex-1 basis-[8.5rem] max-w-full"><label class="${k.label}" for="prFilterFrom">ตั้งแต่</label>` +
        `<input type="date" id="prFilterFrom" class="${k.input}" data-pr-filter="from" max="${today()}" value="${esc(ui.from)}" aria-describedby="prFilterFromBe">` +
        dateCaption('prFilterFromBe', ui.from) + `</div>` +
        `<div class="flex-1 basis-[8.5rem] max-w-full"><label class="${k.label}" for="prFilterTo">ถึง</label>` +
        `<input type="date" id="prFilterTo" class="${k.input}" data-pr-filter="to" max="${today()}" value="${esc(ui.to)}" aria-describedby="prFilterToBe">` +
        dateCaption('prFilterToBe', ui.to) + `</div></div>`;
      if (ui.rangeError) html += `<p class="${k.fieldError}" role="alert" data-pr-range-error>${icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5')}<span>${esc(ui.rangeError)}</span></p>`;
    }
    if (window.XlsxLite) {
      html += `<button type="button" class="${k.btn} ${k.btnSecondary} w-full sm:w-auto" data-pr-act="xlsx"${ui.busy === 'xlsx' ? ' disabled aria-busy="true"' : ''}>` +
        `${icon('download', 'w-5 h-5')}Excel (.xlsx)</button>`;
    }
    return html;
  }

  function storageHtml() {
    if (!isSup()) return '';
    const k = K();
    const s = storageNow();
    if (!s) return '';
    const exact = Math.min(100, Math.max(0, s.used * 100 / s.budget));
    const pct = Math.round(exact);
    const warn = pct >= 80;
    // R3 FIX-CL L-7: counted in photos — P with one decimal below 10 %, M = what the rest holds at ≈ 120,000 characters a photo
    const pText = exact < 10 ? exact.toFixed(1) : String(pct);
    // R3 F (leftover): a share too small for one decimal reads "น้อยกว่า 0.1 %", never "ประมาณ 0.0 %"
    const pPart = exact < 0.1 ? 'น้อยกว่า 0.1 %' : 'ประมาณ ' + pText + ' %';
    const left = Math.max(0, Math.floor((s.budget - s.used) / PHOTO_EST_CHARS));
    const empty = !(s.files > 0) && !(s.used > 0);
    const bar = warn ? 'bg-amber-500' : 'bg-brand-500';
    const nw = t => `<span class="whitespace-nowrap">${esc(t)}</span>`;
    return `<section class="${k.card} space-y-2" aria-label="พื้นที่เก็บรูป" data-pr-storage data-tone="${warn ? 'warn' : 'ok'}">` +
      `<p class="flex items-start gap-2 ${k.textBody}">${icon('image', 'w-5 h-5 shrink-0 mt-0.5 ' + (warn ? 'text-amber-700' : 'text-brand-600'))}` +
      `<span class="min-w-0 tabular-nums" data-pr-storage-text>${nw('พื้นที่เก็บรูป:')} ` +
      // R3 FIX-CL2 Q-5: nothing stored → "ยังไม่มีรูป" (never "ใช้ไป 0 รูป · น้อยกว่า 0.1 %")
      (empty ? nw('ยังไม่มีรูป') : `${nw('ใช้ไป ' + fmtInt(s.files) + ' รูป')} · ${nw(pPart)}`) +
      ` ${nw('(เก็บได้อีกราว ' + fmtInt(left) + ' รูป)')}</span></p>` +
      `<div class="h-2.5 rounded-full bg-ink-50 overflow-hidden" role="progressbar" aria-label="พื้นที่เก็บรูปที่ใช้ไป" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">` +
      `<div class="h-full rounded-full ${bar}" style="width:${pct}%"></div></div>` +
      (warn ? `<p class="${k.banner} ${k.bannerWarn}" data-pr-storage-warn>${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0">${esc(MSG.storageWarn)}</span></p>` : '') +
      `<button type="button" class="${k.btn} ${k.btnSecondary} w-full sm:w-auto" data-pr-act="purge">${icon('trash', 'w-5 h-5')}ล้างรูปเก่า</button>` +
      `</section>`;
  }

  function stationChip(id) {
    const k = K();
    const s = U().stationById(id);
    if (!s) return `<span class="${k.stationChip} bg-ink-50 text-ink-700">${OTHER_LABEL}</span>`;
    return `<span class="${k.stationChip}" style="background:${s.bg};color:${s.text}">${esc(s.name).replace('/', '/<wbr>')}</span>`;
  }
  function statusPill(p) {
    return p.status === 'resolved' ? kit().pill('แก้แล้ว', 'ok') : kit().pill('ยังไม่แก้', 'pending');
  }
  function reportedMeta(p) {
    return [p.reportedBy ? 'แจ้งโดย ' + p.reportedBy : 'แจ้งเมื่อ', stampText(p.reportedAt, true)].filter(Boolean).join(' · ');
  }
  function resolvedMeta(p) {
    return p.status === 'resolved' ? ['แก้แล้วโดย ' + (p.resolvedBy || '-'), stampText(p.resolvedAt, false)].filter(Boolean).join(' · ') : '';
  }

  function cardHtml(p) {
    const k = K();
    const n = pendingCount(p.id);
    const photoCount = p.photos.length
      ? `<span class="inline-flex items-center gap-1 ${k.textCaption}" data-pr-photo-count>${icon('image', 'w-4 h-4')}${p.photos.length} รูป</span>` : '';
    const resolved = resolvedMeta(p);
    const retrying = outbox.running && n > 0;
    return `<article class="${k.card} space-y-2" data-problem-id="${p.id}" data-status="${p.status}">` +
      `<button type="button" class="block w-full min-h-[44px] text-left space-y-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-pr-act="open" data-id="${p.id}" aria-label="เรื่อง #${p.id} ${esc(stationLabel(p.station))} ${p.status === 'resolved' ? 'แก้แล้ว' : 'ยังไม่แก้'}">` +
      `<span class="flex flex-wrap items-center gap-2">${stationChip(p.station)}` +
      `<span class="font-display text-sm font-medium leading-5 text-ink-900 tabular-nums">#${p.id}</span>${statusPill(p)}${photoCount}</span>` +
      `<span class="block line-clamp-3 whitespace-pre-wrap break-words ${k.wrapAnywhere} ${k.textBody}" data-pr-detail>${esc(p.detail)}</span>` +
      `<span class="block ${k.textMeta}" data-pr-meta>${esc(reportedMeta(p))}</span>` +
      (resolved ? `<span class="block ${k.textMeta}" data-pr-resolved-meta>${esc(resolved)}</span>` : '') +
      `</button>` +
      (n ? `<button type="button" class="${k.banner} ${k.bannerWarn} w-full text-left" data-pr-act="retry" data-id="${p.id}"${retrying ? ' aria-busy="true"' : ''}>` +
        `${icon('refresh', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0" data-pr-outbox>${esc(retrying ? MSG.sendingOutbox(n) : MSG.outboxLine(n))}</span></button>` : '') +
      `</article>`;
  }

  function listHtml() {
    const k = K();
    if (ui.range === 'custom') {
      if (ui.rangeError) return '';
      if (custom.loading && !custom.problems) return `<div class="${k.card}">${kit().skeleton(4)}</div>`;
      if (custom.error && !custom.problems) return errorCard(custom.error, 'custom');
    } else if (!domData().range && !domData().problems.length) {
      if (dom.loading) return `<div class="${k.card}">${kit().skeleton(4)}</div>`;
      if (dom.error) return errorCard(dom.error, 'domain');
    }
    const list = filtered();
    if (!list.length) {
      return `<div class="${k.card}" data-pr-empty>${kit().empty({ icon: 'alert-triangle', title: MSG.empty, hint: MSG.emptyHint })}</div>`;
    }
    return list.map(cardHtml).join('');
  }
  function errorCard(e, which) {
    const k = K();
    return `<div class="${k.card} space-y-3" data-pr-error>` +
      kit().empty({ icon: 'cloud-off', title: MSG.loadFailed, hint: errText(e) }) +
      `<button type="button" class="${k.btn} ${k.btnSecondary} w-full" data-pr-act="reload" data-which="${which}">${icon('refresh', 'w-5 h-5')}ลองอีกครั้ง</button></div>`;
  }

  /** setHtml for a part of the screen, keeping the focus on the control the user was in (same data-pr-* attributes). */
  function paint(el, html) {
    if (!el) return;
    const a = document.activeElement;
    let sel = '';
    if (a && el.contains(a)) {
      const attrs = ['data-pr-filter', 'data-pr-status', 'data-pr-act'];
      for (const n of attrs) {
        if (a.hasAttribute(n)) { sel = '[' + n + '="' + String(a.getAttribute(n)).replace(/[^a-z0-9-]/gi, '') + '"]'; break; }
      }
    }
    C.setHtml(el, html);
    if (sel && !el.contains(document.activeElement)) {
      const n = el.querySelector(sel);
      if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  function renderScreen(el) {
    if (!el || !C) return;
    ensureBuilt(el);
    paint(ref.head, headHtml());
    paint(ref.storage, storageHtml());
    const k = K();
    const cachedOnly = ui.range !== 'custom' && !!dom.error && (domData().range || domData().problems.length);
    if (ref.caption) {
      ref.caption.className = cachedOnly ? 'flex items-center gap-2 px-1 ' + k.textCaption : 'hidden';
      C.setHtml(ref.caption, cachedOnly ? icon('cloud-off', 'w-4 h-4 shrink-0') + `<span>${esc(MSG.cached)}</span>` : '');
    }
    paint(ref.list, listHtml());
  }

  /* ---------------------------------------------------------------- sheets: shared */
  function makeSheet(kind) {
    const k = K();
    const el = document.createElement('div');
    el.className = k.sheetWrap + ' md:p-4';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'prSheetTitle-' + kind);
    el.dataset.prSheet = kind;
    el.addEventListener('click', onSheetClick);
    el.addEventListener('change', onSheetChange);
    el.addEventListener('input', onSheetInput);
    el.addEventListener('keydown', onSheetKey);
    document.body.appendChild(el);
    return el;
  }
  function sheetHtml(kind, title, body, actions) {
    const k = K();
    return `<div class="uk-safe-b ${k.sheetFrame}" data-sheet-panel><div class="${k.sheetGrabber}" aria-hidden="true"></div>` +
      `<div class="${k.sheetHead}"><h2 id="prSheetTitle-${kind}" class="flex-1 min-w-0 outline-none break-words ${k.sheetTitle}" data-sheet-title tabindex="-1">${esc(title)}</h2>` +
      `<button type="button" class="${k.iconBtn}" data-sheet-close aria-label="ปิด">${icon('chevron-down', 'w-5 h-5')}</button></div>` +
      `<div class="${k.sheetScroll}" data-pr-body>${body}</div><div class="${k.sheetActions}" data-pr-actions>${actions}</div></div>`;
  }
  function isOpen(el) { return !!el && kit().sheet.isOpen(el); }
  function closeSheet(el) { if (isOpen(el)) kit().sheet.close(el, 'api'); }
  function closeAll() {
    closeSheet(view.el);
    closeSheet(purge.el);
    closeSheet(detail.el);
    closeSheet(report.el);
  }
  /** After a data change: the open detail / view sheets show the new state. */
  function refreshSheets() {
    if (isOpen(detail.el)) {
      const p = findProblem(detail.id);
      if (!p) { closeSheet(view.el); closeSheet(detail.el); return; }
      if (view.fileId && p.photos.indexOf(view.fileId) < 0) closeSheet(view.el);
      renderDetail();
    }
  }

  /* ---------------------------------------------------------------- report sheet */
  function openReport(stationId) {
    if (!on()) return;
    if (!report.el || !report.el.isConnected) report.el = makeSheet('report');
    report.seq++;
    dropReportPhotos();
    report.queue = [];
    report.processing = false;
    report.sending = false;
    report.progress = '';
    report.error = '';
    const k = K();
    const draft = C.store.draft.get(DRAFT_KEY) || {};
    const station = validStation(stationId) ? stationId : (validStation(draft.station) ? draft.station : '');
    const text = typeof draft.detail === 'string' ? draft.detail.slice(0, DETAIL_MAX) : '';
    if (validStation(stationId)) saveDraft(station, text);
    const opts = `<option value="">${esc(MSG.pickStation)}</option>` + stationIds().map(id =>
      `<option value="${esc(id)}"${station === id ? ' selected' : ''}>${esc(stationLabel(id))}</option>`).join('');
    const body =
      `<div><label class="${k.label}" for="prReportStation">Station</label>` +
      `<select id="prReportStation" class="${k.select}" data-pr-in="station">${opts}</select></div>` +
      `<div><label class="${k.label}" for="prReportDetail">รายละเอียดปัญหา</label>` +
      `<textarea id="prReportDetail" class="${k.textarea} min-h-[120px] resize-none" data-pr-in="detail" maxlength="${DETAIL_MAX}" rows="4" placeholder="${esc(MSG.detailPlaceholder)}" aria-describedby="prReportCount">${esc(text)}</textarea>` +
      `<p id="prReportCount" class="${k.dialogCount} mt-1" data-pr-count aria-live="off"></p></div>` +
      `<div class="space-y-2" data-pr-photos-box>` +
      `<p class="${k.banner} ${k.bannerWarn}" data-pr-pdpa>${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0">${escNowrap(MSG.pdpa, PDPA_PHRASES)}</span></p>` +
      `<div data-pr-photos class="space-y-2"></div>` +
      `<input type="file" id="prReportPhotoInput" accept="image/*" multiple class="sr-only" tabindex="-1" aria-hidden="true">` +
      `</div>` +
      `<p class="${k.fieldError} hidden" role="alert" data-pr-error></p>` +
      `<p class="${k.textMeta} hidden" role="status" data-pr-progress></p>`;
    report.el.innerHTML = sheetHtml('report', MSG.title, body, '');
    kit().sheet.open(report.el, { initialFocus: '[data-sheet-title]', onClose: onReportClosed });
    renderReport();
  }
  function onReportClosed() {
    report.seq++;
    report.queue = [];
    report.processing = false;
    dropReportPhotos();
  }
  function dropReportPhotos() {
    report.photos.forEach(ph => revoke(ph.url));
    report.photos = [];
  }
  function saveDraft(station, detailText) {
    if (!station && !detailText) { C.store.draft.remove(DRAFT_KEY); return; }   // discarded: its request id goes too
    const old = C.store.draft.get(DRAFT_KEY) || {};
    const d = { station: station || '', detail: detailText || '' };
    if (typeof old.rid === 'string' && typeof old.ridFor === 'string') { d.rid = old.rid; d.ridFor = old.ridFor; }
    C.store.draft.set(DRAFT_KEY, d);
  }
  /**
   * R3 (I2): the requestId of this draft's reportProblem. A send whose answer was lost may have been stored by the server;
   * sending the SAME station + text again reuses the id, so the server replays the first answer (Code.gs replay, 600 s)
   * instead of storing a second report. A changed draft gets a new id (a replay would answer with the old text). The id
   * lives in the draft and goes with it (sent, discarded, logout).
   */
  function reportRequestId(station, text) {
    const d = C.store.draft.get(DRAFT_KEY) || {};
    const key = station + '\n' + text;
    if (typeof d.rid === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d.rid) && d.ridFor === key) return d.rid;
    const rid = C.Api.newId();
    C.store.draft.set(DRAFT_KEY, { station, detail: typeof d.detail === 'string' && d.detail ? d.detail : text, rid, ridFor: key });
    return rid;
  }
  function reportEl(sel) { return report.el ? report.el.querySelector(sel) : null; }

  function renderReport() {
    if (!report.el) return;
    const k = K();
    const ta = reportEl('[data-pr-in="detail"]');
    const count = reportEl('[data-pr-count]');
    if (ta && count) {
      const n = ta.value.length;
      count.className = (n >= DETAIL_MAX ? k.dialogCountDanger : k.dialogCount) + ' mt-1';
      count.textContent = fmtInt(n) + '/' + fmtInt(DETAIL_MAX);
    }
    const busy = report.sending;
    const box = reportEl('[data-pr-photos]');
    if (box) {
      const left = PHOTO_MAX - report.photos.length - report.queue.length - (report.processing ? 1 : 0);
      const tiles = report.photos.map((ph, i) =>
        `<div class="relative" data-pr-preview="${esc(ph.fileId)}">` +
        `<img src="${esc(ph.url)}" alt="รูปที่ ${i + 1}" class="block w-full aspect-square object-cover rounded-2xl border-2 border-brand-100 bg-lilac-50" draggable="false">` +
        `<button type="button" class="${k.btn} ${k.btnSecondary} w-full mt-1" data-pr-act="drop-photo" data-file="${esc(ph.fileId)}"${busy ? ' disabled' : ''}>ลบ</button></div>`).join('');
      const working = report.processing || report.queue.length
        ? `<div class="flex items-center justify-center aspect-square rounded-2xl border-2 border-dashed border-brand-200 ${k.textCaption} text-center p-2" data-pr-processing>${esc(MSG.preparing)}</div>` : '';
      let html = tiles || working ? `<div class="grid grid-cols-3 gap-2">${tiles}${working}</div>` : '';
      if (left > 0 && !busy) {
        html += `<label for="prReportPhotoInput" role="button" tabindex="0" data-pr-pick class="${k.btn} ${k.btnTonal} w-full cursor-pointer">${icon('camera', 'w-5 h-5')}${esc(MSG.attach)}</label>`;
      }
      C.setHtml(box, html);
    }
    const err = reportEl('[data-pr-error]');
    if (err) {
      err.classList.toggle('hidden', !report.error);
      C.setHtml(err, report.error ? icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5') + `<span class="min-w-0">${esc(report.error)}</span>` : '');
    }
    const prog = reportEl('[data-pr-progress]');
    if (prog) { prog.classList.toggle('hidden', !report.progress); prog.textContent = report.progress; }
    ['station', 'detail'].forEach(n => { const f = reportEl('[data-pr-in="' + n + '"]'); if (f) f.disabled = busy; });
    const acts = reportEl('[data-pr-actions]');
    if (acts) {
      const wait = report.processing || report.queue.length > 0;
      C.setHtml(acts,
        `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close${busy ? ' disabled' : ''}>ยกเลิก</button>` +
        `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-pr-act="send"${busy || wait ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>` +
        `${busy ? esc(MSG.sending) : wait ? esc(MSG.preparing) : icon('send', 'w-5 h-5') + 'ส่ง'}</button>`);
    }
  }

  /** Files chosen in the report sheet: queued and processed one at a time. */
  function addReportFiles(files) {
    if (!files.length || report.sending) return;
    const room = PHOTO_MAX - report.photos.length - report.queue.length - (report.processing ? 1 : 0);
    const take = files.slice(0, Math.max(0, room));
    report.error = files.length > take.length ? MSG.tooMany : '';
    report.queue = report.queue.concat(take);
    renderReport();
    if (!report.processing) C.spawn(processReportQueue);
  }
  async function processReportQueue() {
    if (report.processing) return;
    const alive = C.alive(), my = report.seq;
    report.processing = true;
    try {
      while (report.queue.length) {
        const file = report.queue.shift();
        renderReport();
        let ph = null;
        try { ph = await processFile(file, alive); }
        catch (e) { if (alive() && my === report.seq) report.error = imageErrorText(e); }
        if (!alive() || my !== report.seq) return;
        if (ph) {
          let url = '';
          try { url = kit().image.toObjectUrl(ph.data, ph.mime); } catch (e) { url = ''; }
          if (url) report.photos.push({ fileId: ph.fileId, mime: ph.mime, data: ph.data, url });
          else report.error = MSG.imageFailed;
        }
      }
    } finally {
      if (my === report.seq) { report.processing = false; renderReport(); }
    }
  }

  async function submitReport() {
    if (!report.el || report.sending || report.processing || report.queue.length || !on()) return;
    const sel = reportEl('[data-pr-in="station"]'), ta = reportEl('[data-pr-in="detail"]');
    const station = sel ? sel.value : '';
    const text = normText(ta ? ta.value : '');
    if (!validStation(station)) { report.error = MSG.needStation; renderReport(); if (sel) sel.focus(); return; }
    if (!text || text.length > DETAIL_MAX) { report.error = MSG.needDetail; renderReport(); if (ta) ta.focus(); return; }
    if (!C.requireInternet()) return;
    const alive = C.alive(), my = report.seq;
    const photos = report.photos.slice();
    report.sending = true;
    report.error = '';
    report.progress = MSG.sending;
    renderReport();
    let problem = null;
    try {
      const ans = await C.userCall('reportProblem', { station, detail: text }, { requestId: reportRequestId(station, text) });
      problem = cleanProblem(ans && ans.problem);
    } catch (e) {
      if (!alive() || my !== report.seq) return;
      report.sending = false;
      report.progress = '';
      report.error = sessionError(e) ? '' : e && e.name === 'ApiError' && C.Api.isTransient(e) && e.code !== 'BUSY' ? MSG.maybeSent : errText(e);
      renderReport();
      // the answer may have been lost after the server stored the report: the list shows it before anyone sends it again
      if (e && e.name === 'ApiError' && C.Api.isTransient(e)) loadDomain(true);
      return;
    }
    if (!alive()) return;
    C.store.draft.remove(DRAFT_KEY);
    if (!problem) {   // the server answered without a readable problem: the report exists; show the fresh list
      report.sending = false;
      closeSheet(report.el);
      C.toast(MSG.reported);
      loadDomain(true);
      return;
    }
    applyProblem(problem);
    // every photo goes to the outbox first (a reload or a lost connection keeps it), then up one at a time
    const keys = [];
    for (const ph of photos) {
      keys.push(await queuePhoto(problem.id, ph));
      if (!alive()) return;
    }
    let drop = '', stopped = false;
    for (let i = 0; i < photos.length; i++) {
      if (my === report.seq) { report.progress = MSG.sendingPhoto(i + 1, photos.length); renderReport(); }
      const res = await uploadOne(keys[i], { problemId: problem.id, fileId: photos[i].fileId, mime: photos[i].mime, data: photos[i].data }, alive);
      if (!alive()) return;
      if (res === 'ok') continue;
      if (res.drop) { drop = drop || res.drop; continue; }
      stopped = true;
      break;
    }
    report.sending = false;
    report.progress = '';
    if (my === report.seq) closeSheet(report.el);
    C.render();
    if (drop) C.toast('⚠️ ' + drop, 0, { error: true });
    else if (stopped) C.toast(MSG.photoQueued, 0, { error: true });
    else C.toast(MSG.reported);
  }

  /* ---------------------------------------------------------------- detail sheet */
  function openDetail(id) {
    const p = findProblem(id);
    if (!p) return;
    if (!detail.el || !detail.el.isConnected) detail.el = makeSheet('detail');
    if (detail.id !== p.id) releaseDetail();
    detail.id = p.id;
    detail.busy = '';
    detail.progress = '';
    detail.error = '';
    // the file input lives outside the parts renderDetail rewrites: a photo arriving while the native picker is open must
    // not replace the element whose change event brings the chosen files
    detail.el.innerHTML = sheetHtml('detail', 'เรื่อง #' + p.id, '', '') +
      `<input type="file" id="prDetailPhotoInput" accept="image/*" multiple class="sr-only" tabindex="-1" aria-hidden="true">`;
    kit().sheet.open(detail.el, { initialFocus: '[data-sheet-title]', onClose: onDetailClosed });
    renderDetail();
  }
  /** Every blob: URL of the detail sheet is revoked; late photo loads of it are ignored. */
  function releaseDetail() {
    detail.gen++;
    detail.urls.forEach(revoke);
    detail.urls.clear();
    detail.state.clear();
  }
  function onDetailClosed() {
    closeSheet(view.el);
    releaseDetail();
    detail.id = 0;
    detail.busy = '';
    detail.progress = '';
  }

  function renderDetail() {
    if (!isOpen(detail.el)) return;
    const p = findProblem(detail.id);
    if (!p) return;
    const k = K();
    const body = detail.el.querySelector('[data-pr-body]');
    const acts = detail.el.querySelector('[data-pr-actions]');
    const busy = !!detail.busy;
    let html = `<div class="flex flex-wrap items-center gap-2">${stationChip(p.station)}${statusPill(p)}</div>` +
      `<p class="whitespace-pre-wrap break-words ${k.wrapAnywhere} ${k.textBody}" data-pr-detail-full>${esc(p.detail)}</p>` +
      `<p class="${k.textMeta}">${esc(reportedMeta(p))}</p>`;
    if (p.status === 'resolved') {
      html += `<div class="${k.banner} ${k.bannerOk}" data-pr-resolved>${icon('check', 'w-5 h-5 shrink-0 mt-0.5')}<div class="min-w-0 space-y-1">` +
        `<p>${esc(resolvedMeta(p))}</p>` +
        (p.resolveNote ? `<p class="whitespace-pre-wrap break-words ${k.wrapAnywhere}" data-pr-note>${esc(p.resolveNote)}</p>` : '') + `</div></div>`;
    }
    if (p.photos.length) {
      html += `<div class="grid grid-cols-3 gap-2" data-pr-photos-grid>` + p.photos.map((fid, i) => {
        const url = detail.urls.get(fid);
        const st = detail.state.get(fid);
        if (url) {
          return `<button type="button" class="block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" data-pr-act="view" data-file="${esc(fid)}" data-pr-photo="${esc(fid)}" aria-label="ดูรูปที่ ${i + 1}">` +
            `<img src="${esc(url)}" alt="รูปที่ ${i + 1}" class="block w-full aspect-square object-cover rounded-2xl border-2 border-brand-100 bg-lilac-50" draggable="false"></button>`;
        }
        if (st && st !== 'loading') {
          return `<button type="button" class="flex items-center justify-center min-w-0 aspect-square rounded-2xl border-2 border-dashed border-coral-200 bg-coral-50 p-1.5 text-xs font-medium leading-4 text-coral-700 text-center break-words" data-pr-act="photo-retry" data-file="${esc(fid)}" data-pr-photo="${esc(fid)}" data-state="error">${esc(st)}</button>`;
        }
        return `<div class="min-w-0 aspect-square rounded-2xl ${k.skeleton}" data-pr-photo="${esc(fid)}" data-state="loading" role="status" aria-label="กำลังโหลดรูปที่ ${i + 1}"></div>`;
      }).join('') + `</div>`;
    }
    if (p.photosRemoved > 0) {
      html += `<p class="flex items-center gap-2 ${k.textMeta}" data-pr-removed>${icon('image', 'w-4 h-4 shrink-0')}<span>${esc(MSG.removedLine(p.photosRemoved))}</span></p>`;
    }
    const pending = pendingCount(p.id);
    if (pending) {
      html += `<button type="button" class="${k.banner} ${k.bannerWarn} w-full text-left" data-pr-act="retry" data-id="${p.id}">${icon('refresh', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0">${esc(MSG.outboxLine(pending))}</span></button>`;
    }
    if (detail.progress) html += `<p class="${k.textMeta}" role="status" data-pr-progress>${esc(detail.progress)}</p>`;
    if (detail.error) html += `<p class="${k.fieldError}" role="alert" data-pr-error>${icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5')}<span class="min-w-0">${esc(detail.error)}</span></p>`;
    const extra = [];
    if (canAddPhoto(p)) {
      extra.push(`<p class="${k.banner} ${k.bannerWarn}" data-pr-pdpa>${icon('alert-triangle', 'w-5 h-5 shrink-0 mt-0.5')}<span class="min-w-0">${escNowrap(MSG.pdpa, PDPA_PHRASES)}</span></p>` +
        (busy ? `<button type="button" class="${k.btn} ${k.btnTonal} w-full" disabled>${icon('camera', 'w-5 h-5')}${esc(MSG.attachMore)}</button>`
          : `<label for="prDetailPhotoInput" role="button" tabindex="0" data-pr-pick class="${k.btn} ${k.btnTonal} w-full cursor-pointer">${icon('camera', 'w-5 h-5')}${esc(MSG.attachMore)}</label>`));
    }
    if (isSup()) {
      // R3 FIX-CL L-9: a destructive action in a sheet body = UiKit.cls.btnGhostDanger (coral text, no fill)
      extra.push(`<button type="button" class="${k.btn} ${k.btnGhostDanger} w-full" data-pr-act="delete" data-id="${p.id}"${busy ? ' disabled' : ''}>${icon('trash', 'w-5 h-5')}ลบเรื่องนี้</button>`);
    }
    if (extra.length) html += `<div class="space-y-2 pt-1">${extra.join('')}</div>`;
    C.setHtml(body, html);
    let main = '';
    if (p.status === 'open') {
      main = `<button type="button" class="${k.btn} ${k.btnPrimary} flex-1" data-pr-act="resolve" data-id="${p.id}"${busy ? ' disabled' : ''}${detail.busy === 'resolve' ? ' aria-busy="true"' : ''}>` +
        `${detail.busy === 'resolve' ? 'กำลังบันทึก…' : icon('check', 'w-5 h-5') + 'แก้แล้ว'}</button>`;
    } else if (isSup()) {
      main = `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-pr-act="reopen" data-id="${p.id}"${busy ? ' disabled' : ''}${detail.busy === 'reopen' ? ' aria-busy="true"' : ''}>` +
        `${detail.busy === 'reopen' ? 'กำลังบันทึก…' : icon('refresh', 'w-5 h-5') + 'เปิดอีกครั้ง'}</button>`;
    }
    C.setHtml(acts, `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ปิด</button>` + main);
    loadDetailPhotos(p);
  }

  function loadDetailPhotos(p) {
    const gen = detail.gen;
    p.photos.forEach(fid => {
      if (detail.urls.has(fid) || detail.state.has(fid)) return;
      detail.state.set(fid, 'loading');
      C.spawn(() => loadPhoto(fid, gen));
    });
  }
  /** One photo: the Blob cache, else getFile (checked before any blob: URL), then a URL of this sheet. */
  async function loadPhoto(fid, gen) {
    const alive = C.alive();
    const live = () => alive() && gen === detail.gen;
    let blob = null;
    try { const v = await C.media.get(BLOBS, PHOTO_PREFIX + fid); if (validBlob(v)) blob = v; } catch (e) { blob = null; }
    if (!live()) return;
    if (!blob) {
      let ans = null;
      try { ans = await C.call('getFile', { id: fid }); } catch (e) {
        if (!live()) return;
        detail.state.set(fid, e && e.code === 'NOT_FOUND' ? errText(e) : MSG.photoLoadFailed);
        renderDetail();
        return;
      }
      if (!live()) return;
      const data = ans && ans.id === fid && ans.mime === 'image/jpeg' ? ans.data : '';
      if (!validJpeg(data, SERVER_CHARS)) { detail.state.set(fid, MSG.badPhoto); renderDetail(); return; }
      blob = b64Blob(data);
      C.media.put(BLOBS, PHOTO_PREFIX + fid, blob).catch(e => console.error('[problems] photo cache failed:', e && e.name));
    }
    let url = '';
    try { url = URL.createObjectURL(blob); } catch (e) { url = ''; }
    if (!live()) { revoke(url); return; }
    if (!url) { detail.state.set(fid, MSG.photoLoadFailed); renderDetail(); return; }
    detail.urls.set(fid, url);
    detail.state.delete(fid);
    renderDetail();
  }

  async function resolveDetail() {
    const p = findProblem(detail.id);
    if (!p || p.status !== 'open' || detail.busy) return;
    const alive = C.alive();
    const ans = await C.prompt(MSG.resolvePrompt, '', {
      title: 'บันทึกว่าแก้แล้ว — เรื่อง #' + p.id, okLabel: 'แก้แล้ว', multiline: true, maxLength: NOTE_MAX, icon: 'check',
      placeholder: 'เช่น เปลี่ยนอะไหล่แล้ว', data: { prResolve: String(p.id) }
    });
    if (!alive() || ans === null || ans === undefined || detail.id !== p.id) return;
    if (!C.requireInternet()) return;
    const note = normText(ans).slice(0, NOTE_MAX);
    await detailWrite('resolve', () => C.userCall('resolveProblem', note ? { id: p.id, note } : { id: p.id }), res => {
      applyProblem(res && res.problem);
      C.toast(MSG.resolved);
    });
  }
  async function reopenDetail() {
    const p = findProblem(detail.id);
    if (!p || p.status !== 'resolved' || !isSup() || detail.busy || !C.requireInternet()) return;
    await detailWrite('reopen', () => C.userCall('reopenProblem', { id: p.id }), res => {
      applyProblem(res && res.problem);
      C.toast(MSG.reopened);
    });
  }
  async function deleteDetail() {
    const p = findProblem(detail.id);
    if (!p || !isSup() || detail.busy) return;
    const alive = C.alive();
    const ok = await C.confirm(MSG.deleteConfirm(p.id), { title: 'ลบเรื่องนี้', danger: true, okLabel: 'ลบเรื่อง', icon: 'trash' });
    if (!alive() || !ok || !C.requireInternet()) return;
    await detailWrite('delete', () => C.userCall('deleteProblem', { id: p.id }), res => {
      forgetPhotos(p);
      dropProblem(p.id, res && res.storage);
      closeSheet(view.el);
      closeSheet(detail.el);
      C.toast(MSG.deleted);
    });
  }
  /** Drops a problem's cached photos and queued uploads (deleted, or its photos are gone). */
  function forgetPhotos(p) {
    p.photos.forEach(fid => { C.media.del(BLOBS, PHOTO_PREFIX + fid).catch(() => {}); });
    Array.from(outbox.items.keys()).forEach(key => { if (outbox.items.get(key).problemId === p.id) unqueue(key); });
  }
  /** A write of the detail sheet: busy state, the answer, or the error (a vanished problem refreshes the list). */
  async function detailWrite(kind, send, done) {
    const alive = C.alive(), id = detail.id;
    detail.busy = kind;
    detail.error = '';
    renderDetail();
    let res = null, err = null;
    try { res = await send(); } catch (e) { err = e; }
    if (!alive()) return;
    if (detail.id === id) detail.busy = '';
    if (err) {
      if (err.code === 'NOT_FOUND') {
        dropProblem(id);
        closeSheet(view.el);
        closeSheet(detail.el);
        loadDomain(true);
      } else if (err.code === 'FORBIDDEN') loadDomain(true);
      toastError(err);
      renderDetail();
      return;
    }
    done(res);
    renderDetail();
  }

  /** "แนบรูปเพิ่ม": each chosen file is processed, queued and sent before the next one is decoded. */
  async function addDetailPhotos(files) {
    const p = findProblem(detail.id);
    if (!p || !files.length || detail.busy || !canAddPhoto(p)) return;
    if (!C.requireInternet()) return;
    const room = PHOTO_MAX - p.photos.length - pendingCount(p.id);
    const take = files.slice(0, Math.max(0, room));
    const alive = C.alive(), id = p.id, gen = detail.gen;
    detail.busy = 'photo';
    detail.error = files.length > take.length ? MSG.tooMany : '';
    let drop = '', stopped = false;
    try {
      for (let i = 0; i < take.length; i++) {
        if (gen === detail.gen) { detail.progress = MSG.preparing; renderDetail(); }
        let ph = null;
        try { ph = await processFile(take[i], alive); } catch (e) {
          if (!alive()) return;
          if (gen === detail.gen) detail.error = imageErrorText(e);
          continue;
        }
        if (!alive() || !ph) return;
        const key = await queuePhoto(id, ph);
        if (!alive()) return;
        if (gen === detail.gen) { detail.progress = MSG.sendingPhoto(i + 1, take.length); renderDetail(); }
        const res = await uploadOne(key, { problemId: id, fileId: ph.fileId, mime: ph.mime, data: ph.data }, alive);
        if (!alive()) return;
        if (res === 'ok') continue;
        if (res.drop) { drop = drop || res.drop; continue; }
        stopped = true;
        break;
      }
    } finally {
      if (gen === detail.gen) { detail.busy = ''; detail.progress = ''; }
    }
    renderDetail();
    C.render();
    if (drop) C.toast('⚠️ ' + drop, 0, { error: true });
    else if (stopped) C.toast(MSG.photoRetryFailed, 0, { error: true });
  }

  /* ---------------------------------------------------------------- view sheet (one photo) */
  function openView(fid) {
    const p = findProblem(detail.id);
    const url = detail.urls.get(fid);
    if (!p || !url) return;
    if (!view.el || !view.el.isConnected) view.el = makeSheet('view');
    view.fileId = fid;
    const k = K();
    const i = p.photos.indexOf(fid);
    // R3 FIX-CL L-9: "ลบรูปนี้" is a coral ghost button under the photo; the footer has only "ปิด"
    const body = `<img src="${esc(url)}" alt="รูปที่ ${i + 1} ของเรื่อง #${p.id}" class="block w-full h-auto rounded-2xl border-2 border-brand-100 bg-lilac-50" draggable="false" data-pr-full>` +
      (canRemovePhoto(p) ? `<button type="button" class="${k.btn} ${k.btnGhostDanger} w-full" data-pr-act="remove-photo" data-file="${esc(fid)}">${icon('trash', 'w-5 h-5')}ลบรูปนี้</button>` : '');
    const actions = `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ปิด</button>`;
    view.el.innerHTML = sheetHtml('view', 'รูปที่ ' + (i + 1) + ' — เรื่อง #' + p.id, body, actions);
    kit().sheet.open(view.el, { initialFocus: '[data-sheet-title]', backdrop: true, onClose: () => { view.fileId = ''; } });
  }
  async function removePhoto(btn, fid) {
    const p = findProblem(detail.id);
    if (!p || !canRemovePhoto(p) || p.photos.indexOf(fid) < 0) return;
    const alive = C.alive();
    const ok = await C.confirm(MSG.removePhotoConfirm, { title: 'ลบรูปนี้', danger: true, okLabel: 'ลบรูป', icon: 'trash' });
    if (!alive() || !ok || !C.requireInternet()) return;
    let res = null, err = null;
    await C.withBusy(btn, 'กำลังลบ…', async () => {
      try { res = await C.userCall('removeProblemPhoto', { id: p.id, fileId: fid }); } catch (e) { err = e; }
    });
    if (!alive()) return;
    if (err) {
      if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN') loadDomain(true);
      toastError(err);
      return;
    }
    C.media.del(BLOBS, PHOTO_PREFIX + fid).catch(() => {});
    const url = detail.urls.get(fid);
    detail.urls.delete(fid);
    detail.state.delete(fid);
    closeSheet(view.el);
    revoke(url);
    applyProblem(res && res.problem, res && res.storage);
    C.toast(MSG.photoRemoved);
  }

  /* ---------------------------------------------------------------- purge sheet (Supervisor) */
  function openPurge() {
    if (!isSup() || !on()) return;
    if (!purge.el || !purge.el.isConnected) purge.el = makeSheet('purge');
    purge.before = U().addDays(today(), -RECENT_DAYS);
    purge.preview = null;
    purge.error = '';
    purge.busy = false;
    const k = K();
    const body = `<p class="${k.textBody}">ข้อความของเรื่องยังอยู่ ลบเฉพาะรูป เพื่อคืนพื้นที่เก็บรูป</p>` +
      `<div><label class="${k.label}" for="prPurgeBefore">${esc(MSG.purgeLabel)}</label>` +
      `<input type="date" id="prPurgeBefore" class="${k.input}" data-pr-in="before" max="${today()}" value="${esc(purge.before)}" aria-describedby="prPurgeBeforeBe">` +
      `<div data-pr-purge-caption></div></div>` +
      `<div data-pr-purge-preview aria-live="polite"></div>`;
    purge.el.innerHTML = sheetHtml('purge', 'ล้างรูปเก่า', body, '');
    kit().sheet.open(purge.el, { initialFocus: '[data-sheet-title]', onClose: () => { purge.seq++; purge.preview = null; } });
    loadPurgePreview();
  }
  function renderPurge() {
    if (!isOpen(purge.el)) return;
    const k = K();
    const cap = purge.el.querySelector('[data-pr-purge-caption]');
    if (cap) C.setHtml(cap, dateCaption('prPurgeBeforeBe', purge.before));
    const box = purge.el.querySelector('[data-pr-purge-preview]');
    let html = '';
    if (purge.loading) html = kit().skeleton(2);
    else if (purge.error) html = `<p class="${k.fieldError}" role="alert">${icon('alert-triangle', 'w-4 h-4 shrink-0 mt-0.5')}<span class="min-w-0">${esc(purge.error)}</span></p>`;
    else if (purge.preview) {
      const pv = purge.preview;
      html = `<p class="${k.note}" data-pr-purge-count data-problems="${pv.problems}" data-files="${pv.files}">${icon('image', 'w-5 h-5 shrink-0 mt-0.5')}` +
        `<span class="min-w-0">${esc(pv.problems ? MSG.purgeCount(pv.problems, pv.files) : MSG.purgeNone)}</span></p>`;
    }
    if (box) C.setHtml(box, html);
    const acts = purge.el.querySelector('[data-pr-actions]');
    const can = !!purge.preview && purge.preview.problems > 0 && !purge.loading && !purge.busy;
    if (acts) {
      C.setHtml(acts, `<button type="button" class="${k.btn} ${k.btnSecondary} flex-1" data-sheet-close>ยกเลิก</button>` +
        `<button type="button" class="${k.btn} ${k.btnDanger} flex-1" data-pr-act="purge-run"${can ? '' : ' disabled'}${purge.busy ? ' aria-busy="true"' : ''}>` +
        `${purge.busy ? 'กำลังล้าง…' : icon('trash', 'w-5 h-5') + 'ล้างรูป'}</button>`);
    }
  }
  /** The count preview: resolved problems of the 399 days before the date that still hold photos (memory only). */
  function loadPurgePreview() {
    const before = purge.before;
    const my = ++purge.seq;
    purge.preview = null;
    purge.error = '';
    if (!U().isValidYmd(before) || before > today()) { purge.loading = false; purge.error = 'กรุณาเลือกวันที่ไม่เกินวันนี้'; renderPurge(); return; }
    purge.loading = true;
    renderPurge();
    const alive = C.alive();
    C.spawn(async () => {
      let r = null, err = null;
      try { r = await C.call('getProblems', { from: U().addDays(before, -(RANGE_MAX - 1)), to: U().addDays(before, -1) }); } catch (e) { err = e; }
      if (!alive() || my !== purge.seq) return;
      purge.loading = false;
      if (err) { purge.error = sessionError(err) ? '' : errText(err); renderPurge(); return; }
      const list = cleanList(r && r.problems).filter(p => p.status === 'resolved' && p.photos.length > 0 && stampYmd(p.resolvedAt) && stampYmd(p.resolvedAt) < before);
      purge.preview = { problems: list.length, files: list.reduce((n, p) => n + p.photos.length, 0), ids: list.map(p => p.id) };
      renderPurge();
    });
  }
  async function runPurge() {
    const pv = purge.preview, before = purge.before;
    if (!pv || !pv.problems || !pv.ids || !pv.ids.length || purge.busy || !isSup()) return;
    const alive = C.alive();
    const ok = await C.confirm(MSG.purgeConfirm(pv.problems, pv.files), { title: 'ล้างรูปเก่า', danger: true, okLabel: 'ล้างรูป', icon: 'trash' });
    if (!alive() || !ok || before !== purge.before || !C.requireInternet()) return;
    purge.busy = true;
    renderPurge();
    // R3 FIX-CL L-6: exactly the problems the confirmation counted (their ids, ≤ 200 per request) — never `before`, which
    // would also reach problems resolved earlier than the 399 days the preview reads
    const ids = pv.ids.slice();
    const done = new Set();
    let res = null, err = null, removed = 0;
    for (let i = 0; i < ids.length && !err; i += PURGE_CHUNK) {
      const chunk = ids.slice(i, i + PURGE_CHUNK);
      try { res = await C.userCall('purgeProblemPhotos', { problems: chunk }); } catch (e) { err = e; }
      if (!alive()) return;
      if (!err) {
        chunk.forEach(id => done.add(id));
        removed += res && res.removed && Number(res.removed.files) >= 0 ? Number(res.removed.files) : 0;
      }
    }
    purge.busy = false;
    if (err && !done.size) { toastError(err); renderPurge(); return; }
    // locally: the photos of the purged problems are gone (the next fetch brings the server's view)
    const purged = p => done.has(p.id) && p.photos.length > 0;
    const strip = p => purged(p) ? Object.assign({}, p, { photosRemoved: p.photosRemoved + p.photos.length, photos: [] }) : p;
    domData().problems.filter(purged).forEach(p => p.photos.forEach(fid => { C.media.del(BLOBS, PHOTO_PREFIX + fid).catch(() => {}); }));
    const st = cleanStorage(res && res.storage);
    dom.touch(data => {
      const base = data && typeof data === 'object' ? data : {};
      return { range: base.range || null, problems: cleanList(base.problems).map(strip), storage: st || base.storage || null };
    });
    patchCustom(list => list.map(strip));
    if (st) custom.storage = st;
    closeSheet(purge.el);
    C.render();
    if (err) toastError(err);   // a later chunk failed: what was removed is shown, the rest stays
    else C.toast(MSG.purged(removed));
    loadDomain(true);
  }

  /* ---------------------------------------------------------------- Excel */
  async function exportXlsx() {
    const X = window.XlsxLite;
    if (!X || ui.busy) return;
    const rows = filtered().map(p => [p.id, stationLabel(p.station), p.detail, p.status === 'resolved' ? 'แก้แล้ว' : 'ยังไม่แก้',
      p.reportedBy, stampXl(p.reportedAt), p.resolvedBy, stampXl(p.resolvedAt), p.resolveNote, p.photos.length]);
    const spec = { sheets: [{ name: 'แจ้งปัญหา', columns: [
      { header: 'เลขที่', width: 8 }, { header: 'Station', width: 20 }, { header: 'รายละเอียด', width: 50, wrap: true },
      { header: 'สถานะ', width: 11 }, { header: 'ผู้แจ้ง', width: 16 }, { header: 'เวลาแจ้ง', width: 17 },
      { header: 'ผู้แก้/ผู้ตรวจ', width: 16 }, { header: 'เวลาแก้', width: 17 }, { header: 'หมายเหตุการแก้', width: 40, wrap: true },
      { header: 'จำนวนรูป', width: 10 }], rows }] };
    const alive = C.alive();
    ui.busy = 'xlsx';
    C.render();
    let ok = false;
    try { ok = await X.saveTable(C, 'แจ้งปัญหา-' + today() + '.xlsx', spec); }
    finally { if (alive()) { ui.busy = ''; C.render(); } }
    if (alive() && ok) C.toast(MSG.excel);
  }

  /* ---------------------------------------------------------------- events */
  function act(t) { return t && t.closest ? t.closest('[data-pr-act]') : null; }

  function onRootClick(e) {
    const b = act(e.target);
    if (!b || b.disabled || !C) return;
    const a = b.dataset.prAct;
    if (a === 'new') { if (C.requireInternet()) openReport(ui.station); return; }
    if (a === 'status') { ui.status = b.dataset.prStatus; C.render(); return; }
    if (a === 'open') { openDetail(Number(b.dataset.id)); return; }
    if (a === 'retry') { retryOutbox('tap', Number(b.dataset.id)); C.render(); return; }
    if (a === 'xlsx') { C.spawn(exportXlsx); return; }
    if (a === 'purge') { openPurge(); return; }
    if (a === 'reload') { if (b.dataset.which === 'custom') loadCustom(true); else C.spawn(() => loadDomain(true)); C.render(); }
  }
  function onRootChange(e) {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.prFilter || !C) return;
    const f = t.dataset.prFilter;
    if (f === 'station') ui.station = validStation(t.value) ? t.value : '';
    else if (f === 'range') {
      ui.range = t.value === 'custom' ? 'custom' : 'recent';
      if (ui.range === 'custom') {
        if (!ui.to) ui.to = today();
        if (!ui.from) ui.from = U().addDays(ui.to, -RECENT_DAYS);
        loadCustom(false);
      } else C.spawn(() => loadDomain(false));
    } else if (f === 'from' || f === 'to') {
      ui[f] = t.value;
      loadCustom(false);
    }
    C.render();
  }

  function onSheetClick(e) {
    const b = act(e.target);
    if (!b || b.disabled || !C) return;
    const a = b.dataset.prAct;
    switch (a) {
      case 'send': C.spawn(submitReport); break;
      case 'drop-photo': {
        const fid = b.dataset.file;
        const at = report.photos.findIndex(ph => ph.fileId === fid);
        if (at >= 0 && !report.sending) { revoke(report.photos[at].url); report.photos.splice(at, 1); report.error = ''; renderReport(); }
        break;
      }
      case 'resolve': C.spawn(resolveDetail); break;
      case 'reopen': C.spawn(reopenDetail); break;
      case 'delete': C.spawn(deleteDetail); break;
      case 'retry': retryOutbox('tap', Number(b.dataset.id)); break;
      case 'view': openView(b.dataset.file); break;
      case 'photo-retry': {
        const fid = b.dataset.file;
        detail.state.delete(fid);
        const p = findProblem(detail.id);
        if (p) loadDetailPhotos(p);
        renderDetail();
        break;
      }
      case 'remove-photo': C.spawn(() => removePhoto(b, b.dataset.file)); break;
      case 'purge-run': C.spawn(runPurge); break;
      default: break;
    }
  }
  function onSheetChange(e) {
    const t = e.target;
    if (!t || !C) return;
    if (t.id === 'prReportPhotoInput' || t.id === 'prDetailPhotoInput') {
      const files = Array.prototype.slice.call(t.files || []);
      t.value = '';   // the same file can be chosen again
      if (t.id === 'prReportPhotoInput') addReportFiles(files);
      else C.spawn(() => addDetailPhotos(files));
      return;
    }
    if (t.dataset && t.dataset.prIn === 'station') {
      const ta = reportEl('[data-pr-in="detail"]');
      saveDraft(t.value, ta ? ta.value : '');
      if (report.error === MSG.needStation) { report.error = ''; renderReport(); }
      return;
    }
    if (t.dataset && t.dataset.prIn === 'before') {
      purge.before = t.value;
      loadPurgePreview();
    }
  }
  function onSheetInput(e) {
    const t = e.target;
    if (!t || !t.dataset || t.dataset.prIn !== 'detail' || !C) return;
    const sel = reportEl('[data-pr-in="station"]');
    saveDraft(sel ? sel.value : '', t.value);
    if (report.error === MSG.needDetail && normText(t.value)) report.error = '';
    renderReport();
  }
  /** The picker labels open the file chooser with Enter / Space too. */
  function onSheetKey(e) {
    if (e.defaultPrevented) return;
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute('data-pr-pick') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      t.click();
    }
  }

  /* ---------------------------------------------------------------- services */
  const service = Object.freeze({
    /** The default range is current (fetched when needed). → Promise<bool> */
    ensure() { return C ? loadDomain(false) : Promise.resolve(false); },
    /** Problems of the default range (open ones always included), newest first; copies. */
    list() { return C && on() ? domData().problems : []; },
    /** {count, oldestDays, byStation: {stationId|'other': n}} of the open problems. */
    openSummary() {
      const out = { count: 0, oldestDays: 0, byStation: {} };
      if (!C || !on()) return out;
      const t = today();
      domData().problems.filter(p => p.status === 'open').forEach(p => {
        out.count++;
        out.byStation[p.station] = (out.byStation[p.station] || 0) + 1;
        const d = stampYmd(p.reportedAt);
        const n = d ? U().daysBetweenInclusive(d, t) - 1 : 0;
        if (n > out.oldestDays) out.oldestDays = n;
      });
      return out;
    }
  });

  /* ---------------------------------------------------------------- registration */
  App.register({
    id: ID,
    title: MSG.title,
    icon: 'alert-triangle',
    nav: { place: 'menu', section: 'mine', order: 20 },
    parent: 'menu',
    visible: c => c.serverHas('problem'),
    init(c) {
      C = c;
      dom = c.domain('problem', { persist: true, empty: { range: null, problems: [], storage: null } });
      // R3 FIX-CL2 Q-2: while วันนี้ is shown its "ปัญหาค้าง N" pills read this domain — once it holds data it follows the
      // server there too (stale = the version changed: one getProblems with knownVersion); never loaded = no pill, no request
      dom.onStale(() => {
        if (c.current() === ID) { loadDomain(false); refreshCustom(); }
        else if (c.current() === 'station' && hasLoaded()) loadDomain(false);
      });
      c.provide('problems.report', stationId => openReport(stationId));
      c.provide('problems', service);
      c.on('online', () => { if (outbox.items.size || C.store.draft.get(OUTBOX_FLAG)) retryOutbox('online'); });
      c.on('login', () => { outbox.gen++; outbox.loaded = false; outbox.loading = null; outbox.items.clear(); outbox.running = false; });
      c.on('logout', () => closeAll());
      c.on('data', p => {
        if (p && p.domain === 'problem') refreshSheets();
        else if (c.current() === ID) maybeClear();
      });
    },
    mount(el) {
      root = el;
      el.addEventListener('click', onRootClick);
      el.addEventListener('change', onRootChange);
    },
    render(el) { renderScreen(el); },
    show(c, params) {
      const prm = params && typeof params === 'object' ? params : {};
      if (STATUS_CHIPS.some(s => s.id === prm.status)) ui.status = prm.status;
      if (prm.station !== undefined) ui.station = validStation(prm.station) ? prm.station : '';
      maybeClear();
      loadDomain(false);
      if (ui.range === 'custom') loadCustom(customStale());
      C.spawn(() => ensureOutbox().then(() => retryOutbox('show')));
    },
    hide() {
      closeSheet(view.el);
      closeSheet(purge.el);
      closeSheet(detail.el);
    },
    reset() {
      closeAll();
      [report, detail, view, purge].forEach(s => { if (s.el) { s.el.remove(); s.el = null; } });
      releaseDetail();
      detail.id = 0; detail.busy = ''; detail.progress = ''; detail.error = '';
      report.seq++; report.queue = []; report.processing = false; report.sending = false; report.progress = ''; report.error = '';
      dropReportPhotos();
      view.fileId = '';
      purge.seq++; purge.preview = null; purge.loading = false; purge.busy = false; purge.error = '';
      custom.seq++; custom.key = ''; custom.loading = false; custom.error = null; custom.problems = null; custom.storage = null; custom.version = '';
      outbox.gen++; outbox.loaded = false; outbox.loading = null; outbox.items.clear(); outbox.running = false; outbox.inflight.clear();
      ui.status = 'open'; ui.station = ''; ui.range = 'recent'; ui.from = ''; ui.to = ''; ui.rangeError = ''; ui.busy = '';
      built = false;
      Object.keys(ref).forEach(k => { delete ref[k]; });
      if (root) { root.innerHTML = ''; root._html = ''; }
    }
  });
})();
