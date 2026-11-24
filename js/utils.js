/* =====================================================================
 * js/utils.js — pure helpers → window.Utils
 * No DOM state, no network (onReady is the only DOM-aware helper).
 * Calendar dates are ALWAYS derived from LOCAL date parts — never from
 * toISOString(), which is UTC and yields "yesterday" before 07:00 in
 * Asia/Bangkok (bug #2 of the original app).
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- shared domain constants (identical to the backend) ---------- */
  /** `count` is the DEFAULT number of people a station needs; the supervisor can change it (stationCounts). */
  const STATIONS = Object.freeze([
    { id: 'portable',   name: 'Portable',             count: 3, bg: '#FFF4D1', border: '#FFC94A', text: '#8A5300' },
    { id: 'ipd',        name: 'IPD',                  count: 3, bg: '#DDF3FE', border: '#58C3EC', text: '#115A80' },
    { id: 'us',         name: 'US',                   count: 2, bg: '#DCF6E9', border: '#5CCB98', text: '#17694A' },
    { id: 'or',         name: 'OR',                   count: 2, bg: '#EEE9FE', border: '#AD91F2', text: '#563A8F' },
    { id: 'er',         name: 'ER',                   count: 3, bg: '#FFE3EF', border: '#FB6FA8', text: '#9A1B55' },
    { id: 'cancer',     name: 'CANCER CENTER',        count: 1, bg: '#FFE8DA', border: '#FF9A5C', text: '#93400F' },
    { id: 'supervisor', name: 'Prereview/Supervisor', count: 1, bg: '#E5EAF8', border: '#7186C4', text: '#2A3F86' }
  ].map(Object.freeze));
  const LEAVE_TYPES = Object.freeze(['พักร้อน', 'Off เวร', 'Off In charge', 'ลาป่วย', 'ลากิจ', 'ลาประชุม']);
  const QUEUE_TYPES = Object.freeze(['พักร้อน', 'Off เวร']);
  const STATION_COUNT_MIN = 1;
  const STATION_COUNT_MAX = 10;

  const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
    'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const THAI_WEEKDAYS_SHORT = Object.freeze(['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']);   // Sunday first
  /** The abbreviated weekday as written in a date ("พฤ. 26 พ.ย. 2569"), Sunday first. */
  const THAI_WEEKDAYS_ABBR = Object.freeze(['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']);
  const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DAY_MS = 86400000;

  /* ---------- dates ---------- */
  function pad2(n) { return String(n).padStart(2, '0'); }

  /** LOCAL calendar date of a Date object → 'YYYY-MM-DD' ('' for invalid input). */
  function ymd(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return String(date.getFullYear()).padStart(4, '0') + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  /** Today's LOCAL date. `now` (optional Date) makes it testable. */
  function todayStr(now) { return ymd(now instanceof Date ? now : new Date()); }

  /** True for 'YYYY-MM-DD' strings that name a real calendar date. */
  function isValidYmd(s) {
    if (typeof s !== 'string') return false;
    const m = YMD_RE.exec(s);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    return d <= daysInMonth_(y, mo);
  }

  function daysInMonth_(y, month1) {
    const dt = new Date(Date.UTC(2000, 0, 1));
    dt.setUTCFullYear(y, month1, 0); // day 0 of next month = last day of this month
    return dt.getUTCDate();
  }

  /** 'YYYY-MM-DD' → LOCAL Date at 00:00, or null when invalid. */
  function parseYmd(str) {
    if (!isValidYmd(str)) return null;
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(2000, 0, 1, 0, 0, 0, 0);
    dt.setFullYear(y, m - 1, d);
    return dt;
  }

  /** Shift a 'YYYY-MM-DD' by n days (DST-safe: works at local noon). null when invalid. */
  function addDays(str, n) {
    if (!isValidYmd(str)) return null;
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(2000, 0, 1, 12, 0, 0, 0);
    dt.setFullYear(y, m - 1, d + (Number(n) || 0));
    return ymd(dt);
  }

  /** -1 / 0 / 1 (zero-padded ISO dates compare correctly as strings). */
  function compareYmd(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /** Inclusive list of dates from..to ([] when invalid or from > to). */
  function eachDate(from, to) {
    const out = [];
    if (!isValidYmd(from) || !isValidYmd(to) || from > to) return out;
    let cur = from, guard = 0;
    while (cur <= to && guard++ < 100000) { out.push(cur); cur = addDays(cur, 1); }
    return out;
  }

  /** {from, to} of the month containing `str` ('YYYY-MM-DD', 'YYYY-MM' or a Date). */
  function monthRange(str) {
    let y, m;
    if (str instanceof Date) { y = str.getFullYear(); m = str.getMonth() + 1; }
    else {
      const mm = /^(\d{4})-(\d{2})/.exec(String(str || ''));
      if (!mm) return null;
      y = +mm[1]; m = +mm[2];
      if (m < 1 || m > 12) return null;
    }
    const yy = String(y).padStart(4, '0'), mo = pad2(m);
    return { from: yy + '-' + mo + '-01', to: yy + '-' + mo + '-' + pad2(daysInMonth_(y, m)) };
  }

  /** 'YYYY-MM' of a 'YYYY-MM-DD' / 'YYYY-MM' string or a Date ('' when invalid). */
  function monthKey(str) {
    const r = monthRange(str);
    return r ? r.from.slice(0, 7) : '';
  }

  /** The month `n` months after the one containing `str` → 'YYYY-MM' ('' when invalid). */
  function addMonths(str, n) {
    const k = monthKey(str);
    if (!k) return '';
    const total = Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1 + (Number(n) || 0);
    return String(Math.floor(total / 12)).padStart(4, '0') + '-' + pad2((total % 12) + 1);
  }

  /** "พฤศจิกายน 2569" (Buddhist year) for a month or date; '-' when invalid. */
  function thaiMonthYear(str) {
    const k = monthKey(str);
    if (!k) return '-';
    return THAI_MONTHS_FULL[Number(k.slice(5, 7)) - 1] + ' ' + (Number(k.slice(0, 4)) + 543);
  }

  /**
   * Calendar weeks of the month containing `str`, Sunday first: 7-item arrays holding 'YYYY-MM-DD' for the
   * days of that month and '' for the blanks before the 1st and after the last day. [] when invalid.
   */
  function monthGrid(str) {
    const r = monthRange(str);
    if (!r) return [];
    const cells = new Array(parseYmd(r.from).getDay()).fill('').concat(eachDate(r.from, r.to));
    while (cells.length % 7) cells.push('');
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  function utcOf_(str) {
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(Date.UTC(2000, 0, 1));
    dt.setUTCFullYear(y, m - 1, d);
    return dt.getTime();
  }

  /** Number of days in [a, b] counting both ends (a === b → 1). NaN when invalid. */
  function daysBetweenInclusive(a, b) {
    if (!isValidYmd(a) || !isValidYmd(b)) return NaN;
    return Math.round((utcOf_(b) - utcOf_(a)) / DAY_MS) + 1;
  }

  /** 'YYYY-MM-DD' (or Date) → "วันจันทร์ที่ 28 ก.ย. 2569" (Buddhist year). '-' when invalid. */
  function thaiDate(str) {
    const d = str instanceof Date ? str : parseYmd(str);
    if (!d || isNaN(d.getTime())) return '-';
    return 'วัน' + THAI_DAYS[d.getDay()] + 'ที่ ' + d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }

  /**
   * THE short date format shown to users (R1a FIX-2, Minor 1): 'YYYY-MM-DD' (or Date) → "26 พ.ย. 2569" (Buddhist year).
   * opts.weekday → "พฤ. 26 พ.ย. 2569" (the header); opts.year === false → "26 พ.ย.". '-' when invalid.
   */
  function thaiDateShort(str, opts) {
    const d = str instanceof Date ? str : parseYmd(str);
    if (!d || isNaN(d.getTime())) return '-';
    const o = opts || {};
    return (o.weekday ? THAI_WEEKDAYS_ABBR[d.getDay()] + ' ' : '') + d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] +
      (o.year === false ? '' : ' ' + (d.getFullYear() + 543));
  }

  function toDate_(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string' && v.trim()) return new Date(v);
    return null;
  }

  /** ISO timestamp → 'YYYY-MM-DD HH:MM น.' in LOCAL time ('' when invalid). */
  function formatStamp(iso) {
    const d = toDate_(iso);
    if (!d || isNaN(d.getTime())) return '';
    return ymd(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' น.';
  }

  /** ISO timestamp → 'DD/MM HH:MM น.' in LOCAL time ('' when invalid). */
  function formatStampShort(iso) {
    const d = toDate_(iso);
    if (!d || isNaN(d.getTime())) return '';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' น.';
  }

  /** ISO timestamp → "18 พ.ย. 2569 08:30 น." in LOCAL time ('' when invalid) — timestamps shown to users. */
  function thaiStamp(iso) {
    const d = toDate_(iso);
    if (!d || isNaN(d.getTime())) return '';
    return thaiDateShort(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' น.';
  }

  /** ISO timestamp → "18 พ.ย. 08:30 น." in LOCAL time ('' when invalid) — the compact form (no year). */
  function thaiStampShort(iso) {
    const d = toDate_(iso);
    if (!d || isNaN(d.getTime())) return '';
    return thaiDateShort(d, { year: false }) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' น.';
  }

  /* ---------- escaping / CSV ---------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"'`]/g, c => ESC[c]);
  }

  /**
   * One CSV cell: always quoted, inner quotes doubled, newlines → space. Text a spreadsheet would run as a
   * formula (leading = + - @ or tab — CSV injection) gets a leading apostrophe so it stays plain text.
   */
  function csvCell(v) {
    let s = (v === null || v === undefined) ? '' : String(v).replace(/\r\n|\r|\n/g, ' ');
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /** rows (array of arrays) → CSV text with UTF-8 BOM (Excel-friendly), CRLF line breaks. */
  function buildCsv(rows) {
    return '\uFEFF' + (rows || []).map(r => (r || []).map(csvCell).join(',')).join('\r\n');
  }

  /* ---------- validation (same rules as the backend) ---------- */
  const NAME_FORBIDDEN = /[,<>"'\\|;\n\r\t]/;

  /** trim + collapse internal whitespace runs to a single space. */
  function normalizeName(s) {
    return (s === null || s === undefined) ? '' : String(s).trim().replace(/\s+/g, ' ');
  }

  /**
   * Error message (Thai) or null when the name is acceptable.
   * Same order and messages as the backend's checkName_: forbidden characters are
   * checked on the RAW input, then emptiness, length, the leading character and
   * reserved names ("__…" app sentinels such as "__ALL__", Object.prototype members).
   */
  function validateName(s) {
    const raw = (s === null || s === undefined) ? '' : String(s);
    if (NAME_FORBIDDEN.test(raw)) return 'ชื่อห้ามมีอักขระ , < > " \' \\ | ; หรือการขึ้นบรรทัดใหม่/แท็บ';
    const n = normalizeName(raw);
    if (!n) return 'กรุณากรอกชื่อพนักงาน';
    if (n.length > 40) return 'ชื่อยาวได้ไม่เกิน 40 ตัวอักษร';
    if (/^[=+\-@]/.test(n)) return 'ชื่อห้ามขึ้นต้นด้วย = + - หรือ @';
    if (n.indexOf('__') === 0 || n in Object.prototype) return 'ชื่อนี้เป็นคำสงวนของระบบ กรุณาใช้ชื่ออื่น';
    return null;
  }

  /** Error message (Thai) or null. Trimmed length 4–64 (backend requirePassword_). */
  function validatePassword(s) {
    const p = (s === null || s === undefined) ? '' : String(s).trim();
    if (!p) return 'กรุณากรอกรหัสผ่าน';
    if (p.length < 4 || p.length > 64) return 'รหัสผ่านต้องมีความยาว 4–64 ตัวอักษร';
    return null;
  }

  /* ---------- leave queue ---------- */
  function stampKey_(v) { const t = Date.parse(v); return isNaN(t) ? Infinity : t; }

  /**
   * Fair queue ("คนที่ N") for one leave type on one date.
   * leavesForDate: {[name]: Leave} (insertion order = server row order) or Leave[].
   * Returns staff names sorted by (recordedAt, original index); undated entries last.
   */
  function queueOrder(leavesForDate, type) {
    let list = [];
    if (Array.isArray(leavesForDate)) list = leavesForDate.slice();
    else if (leavesForDate && typeof leavesForDate === 'object') {
      list = Object.keys(leavesForDate).map(k => {
        const l = leavesForDate[k];
        return (l && typeof l === 'object') ? Object.assign({ staff: k }, l) : { staff: k, type: l };
      });
    }
    return list
      .map((l, i) => ({ l, i, t: l ? stampKey_(l.recordedAt) : Infinity }))
      .filter(x => x.l && x.l.type === type)
      .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i))
      .map(x => x.l.staff);
  }

  function stationById(id) { return STATIONS.find(s => s.id === id) || null; }

  /**
   * Required people per station: {[stationId]: n} for all stations. Values from `raw` (the server's
   * stationCounts) are used when they are integers STATION_COUNT_MIN..MAX, anything else falls back to the
   * station's default count (e.g. an older server that does not send counts at all).
   */
  function normalizeStationCounts(raw) {
    const out = {};
    STATIONS.forEach(st => {
      const v = raw && typeof raw === 'object' ? raw[st.id] : undefined;
      out[st.id] = Number.isInteger(v) && v >= STATION_COUNT_MIN && v <= STATION_COUNT_MAX ? v : st.count;
    });
    return out;
  }

  /** Run fn once the DOM is parsed (immediately if it already is). */
  function onReady(fn) {
    if (typeof document === 'undefined' || document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', () => fn(), { once: true });
  }

  global.Utils = {
    STATIONS, LEAVE_TYPES, QUEUE_TYPES, STATION_COUNT_MIN, STATION_COUNT_MAX, THAI_WEEKDAYS_SHORT, THAI_WEEKDAYS_ABBR,
    pad2, ymd, todayStr, parseYmd, addDays, compareYmd, eachDate, monthRange, daysBetweenInclusive,
    monthKey, addMonths, thaiMonthYear, monthGrid,
    thaiDate, thaiDateShort, thaiStamp, thaiStampShort, formatStamp, formatStampShort, escapeHtml, csvCell, buildCsv,
    normalizeName, validateName, validatePassword, isValidYmd, queueOrder, stationById, normalizeStationCounts, onReady
  };
})(window);
