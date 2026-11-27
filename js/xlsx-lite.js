/* =====================================================================
 * js/xlsx-lite.js — a minimal, dependency-free .xlsx writer → window.XlsxLite (R3-SPEC §4.4)
 *
 * Standalone classic script (no dependencies, no network, no globals besides `XlsxLite`). Load it after
 * js/ui-kit.js and before js/app.js. Features check `window.XlsxLite` and hide their Excel buttons without it.
 *
 * ---------------------------------------------------------------- PUBLIC SURFACE (frozen)
 *
 * XlsxLite.build(spec)                  → Blob, type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 * XlsxLite.bytes(spec)                  → Uint8Array (the same bytes; deterministic: equal specs give equal bytes)
 * XlsxLite.saveTable(core, filename, spec)
 *                                       → core.saveFile(build(spec), filename)   (Promise<boolean> from the app core)
 *
 * spec = { sheets: [ { name, columns: [ { header, width?, wrap? } ], rows: [ [cell, …], … ] }, … ] }
 *   - at least one sheet, at most 65,000 sheets; at most 1,048,575 data rows and 16,384 columns per sheet.
 *   - columns: row 1 = the headers (style 1: bold, light fill), frozen (pane ySplit=1). `width` in characters
 *     (else a width from the longest text of the column, 8–60). `wrap: true` (an extension) gives the column's data
 *     cells style 2 (wrap text); a text cell containing a line break gets style 2 anyway.
 *   - rows start at row 2 (row 1 when the sheet has no columns). A row may be longer than `columns`.
 *   - cell: string → inline string (t="inlineStr", <t xml:space="preserve">); finite number → number cell;
 *     null / undefined / '' → no cell at all; anything else → String(v) as text.
 *     Text: line breaks normalised to \n, invalid XML characters (C0 controls except tab/LF, U+FFFE, U+FFFF) and lone
 *     surrogates removed, cut to 32,767 UTF-16 units (never inside a surrogate pair), XML-escaped, and a literal
 *     "_xHHHH_" protected as "_x005F_xHHHH_" so Excel shows it unchanged. A text cell can never become a formula:
 *     no <f> element is ever written ("=1+1" is a string cell).
 *   - sheet names: invalid XML characters and []:*?/\ removed, leading/trailing apostrophes and spaces trimmed, cut
 *     to 31 characters; empty → "Sheet N" (N = 1-based position); duplicates (case-insensitive, like Excel) get
 *     " (2)", " (3)", … (the base is shortened so the result stays ≤ 31).
 *
 * Package: [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/styles.xml,
 * xl/worksheets/sheetN.xml. Zip: STORE (no compression), CRC-32, general-purpose flag bit 11 (UTF-8 names),
 * fixed DOS time 1980-01-01 00:00, central directory + end-of-central-directory record, no zip64 (< 4 GiB, ≤ 65,535
 * entries). Invalid input (no sheets, too many rows/columns) throws an Error whose message starts with "XlsxLite:".
 *
 * Example:
 *   XlsxLite.saveTable(core, 'ตาราง-2026-11.xlsx', { sheets: [{ name: 'ตาราง 2026-11',
 *     columns: [{ header: 'วันที่', width: 12 }, { header: 'ชื่อ' }], rows: [['2026-11-02', 'ก.'], ['2026-11-03', 3]] }] });
 * ===================================================================== */
(function (global) {
  'use strict';

  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const MAX_TEXT = 32767;
  const MAX_ROWS = 1048576;
  const MAX_COLS = 16384;
  const MAX_SHEET_NAME = 31;
  const MAX_SHEETS = 65000;          // (sheets + 5 fixed parts) must stay ≤ 65,535 zip entries
  const DOS_TIME = 0;                // 00:00:00
  const DOS_DATE = (0 << 9) | (1 << 5) | 1;   // 1980-01-01

  /* ---------------------------------------------------------------- text */

  // a surrogate pair (kept), a lone surrogate, or a character XML 1.0 forbids (both removed)
  const BAD_XML = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
  const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  const THAI_MARKS = /[ัิ-ฺ็-๎]/g;   // zero-width Thai vowels/tone marks (column width only)

  /** Removes invalid XML characters and lone surrogates; keeps valid surrogate pairs. */
  function cleanXml(s) {
    return s.replace(BAD_XML, m => (m.length === 2 ? m : ''));
  }
  /** XML-escapes & < > " ' (text nodes and attribute values). */
  function esc(s) {
    return s.replace(/[&<>"']/g, c => XML_ESC[c]);
  }
  /** Cell text: normalised line breaks, clean XML, ≤ 32,767 UTF-16 units (a pair is never split). */
  function cellText(v) {
    let s = cleanXml(String(v).replace(/\r\n?/g, '\n'));
    if (s.length > MAX_TEXT) {
      let n = MAX_TEXT;
      const c = s.charCodeAt(n - 1);
      if (c >= 0xD800 && c <= 0xDBFF) n--;
      s = s.slice(0, n);
    }
    return s;
  }
  /** Text as it goes into <t>: escaped, and Excel's own _xHHHH_ escape protected by escaping its underscore. */
  function textXml(s) {
    return esc(s).replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1');
  }
  /** Width in characters of a text (longest line, Thai combining marks not counted). */
  function textWidth(s) {
    let w = 0;
    const lines = s.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].length > 200 ? 200 : lines[i].replace(THAI_MARKS, '').length;
      if (l > w) w = l;
    }
    return w;
  }

  /* ---------------------------------------------------------------- names and references */

  /** 0-based column index → letters ("A", …, "Z", "AA", …). */
  function colName(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** Sheet names per Excel's rules (see the header); returns one name per sheet, all distinct ignoring case. */
  function sheetNames(sheets) {
    const used = {};
    return sheets.map((sh, i) => {
      const raw = sh && sh.name !== null && sh.name !== undefined ? String(sh.name) : '';
      let base = cleanXml(raw).replace(/[\[\]:*?\/\\]/g, '').replace(/^[\s']+|[\s']+$/g, '');
      base = cutName(base, MAX_SHEET_NAME).replace(/[\s']+$/g, '');
      if (!base) base = 'Sheet ' + (i + 1);
      let name = base;
      for (let k = 2; used[name.toLowerCase()]; k++) {
        const tail = ' (' + k + ')';
        name = cutName(base, MAX_SHEET_NAME - tail.length) + tail;
      }
      used[name.toLowerCase()] = true;
      return name;
    });
  }
  /** Cuts to n UTF-16 units without splitting a surrogate pair. */
  function cutName(s, n) {
    if (s.length <= n) return s;
    const c = s.charCodeAt(n - 1);
    return s.slice(0, c >= 0xD800 && c <= 0xDBFF ? n - 1 : n);
  }

  /* ---------------------------------------------------------------- parts */

  /**
   * One cell's XML, or '' for an empty cell. style: 0 normal, 1 header, 2 wrap (forced: wrapCol).
   * widths (optional): the per-column text width accumulator.
   */
  function cellXml(v, ref, header, wrapCol, widths, col) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && isFinite(v)) {
      if (widths && col < widths.length) { const w = String(v).length; if (w > widths[col]) widths[col] = w; }
      return '<c r="' + ref + '"' + (header ? ' s="1"' : '') + '><v>' + String(v) + '</v></c>';
    }
    const s = cellText(v);
    if (s === '') return '';
    if (widths && col < widths.length) { const w = textWidth(s); if (w > widths[col]) widths[col] = w; }
    const style = header ? 1 : (wrapCol || s.indexOf('\n') >= 0 ? 2 : 0);
    return '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + ' t="inlineStr"><is><t xml:space="preserve">' +
      textXml(s) + '</t></is></c>';
  }

  /** The worksheet XML of one sheet. */
  function sheetXml(sh) {
    const columns = Array.isArray(sh.columns) ? sh.columns : [];
    const rows = Array.isArray(sh.rows) ? sh.rows : [];
    const hasHead = columns.length > 0;
    const first = hasHead ? 2 : 1;
    if (columns.length > MAX_COLS) throw new Error('XlsxLite: more than ' + MAX_COLS + ' columns');
    if (rows.length + first - 1 > MAX_ROWS) throw new Error('XlsxLite: more than ' + MAX_ROWS + ' rows');
    const widths = columns.map(() => 0);
    const wraps = columns.map(c => !!(c && c.wrap));
    const fixed = columns.map(c => (c && typeof c.width === 'number' && isFinite(c.width) && c.width > 0 ? Math.min(255, c.width) : 0));
    const letters = [];
    const letter = i => letters[i] || (letters[i] = colName(i));
    let maxCol = columns.length;
    let lastRow = 0;
    const out = [];
    if (hasHead) {
      let cells = '';
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c] || {};
        cells += cellXml(col.header, letter(c) + '1', true, false, widths, c);
      }
      out.push('<row r="1">' + cells + '</row>');
      lastRow = 1;
    }
    for (let r = 0; r < rows.length; r++) {
      const row = Array.isArray(rows[r]) ? rows[r] : [];
      if (row.length > MAX_COLS) throw new Error('XlsxLite: more than ' + MAX_COLS + ' columns');
      const n = r + first;
      let cells = '';
      for (let c = 0; c < row.length; c++) cells += cellXml(row[c], letter(c) + n, false, wraps[c], widths, c);
      if (cells) {
        out.push('<row r="' + n + '">' + cells + '</row>');
        lastRow = n;
        if (row.length > maxCol) maxCol = row.length;
      }
    }
    const dim = lastRow ? 'A1:' + letter(Math.max(0, maxCol - 1)) + lastRow : 'A1';
    let xml = XML_HEAD + '<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
      '<dimension ref="' + dim + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' +
      (hasHead ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '') +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>';
    if (hasHead) {
      xml += '<cols>';
      for (let c = 0; c < columns.length; c++) {
        const w = fixed[c] || Math.min(60, Math.max(8, widths[c] + 2));
        xml += '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>';
      }
      xml += '</cols>';
    }
    return xml + '<sheetData>' + out.join('') + '</sheetData></worksheet>';
  }

  function contentTypesXml(n) {
    let s = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    for (let i = 1; i <= n; i++) {
      s += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    return s + '</Types>';
  }
  function rootRelsXml() {
    return XML_HEAD + '<Relationships xmlns="' + NS_PKG_REL + '">' +
      '<Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  }
  function workbookXml(names) {
    let s = XML_HEAD + '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>';
    names.forEach((nm, i) => { s += '<sheet name="' + esc(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; });
    return s + '</sheets></workbook>';
  }
  function workbookRelsXml(n) {
    let s = XML_HEAD + '<Relationships xmlns="' + NS_PKG_REL + '">';
    for (let i = 1; i <= n; i++) {
      s += '<Relationship Id="rId' + i + '" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
    }
    return s + '<Relationship Id="rId' + (n + 1) + '" Type="' + NS_REL + '/styles" Target="styles.xml"/></Relationships>';
  }
  /** Styles: cellXfs 0 = normal, 1 = bold header with a light fill, 2 = wrap text (top-aligned). */
  function stylesXml() {
    return XML_HEAD + '<styleSheet xmlns="' + NS_MAIN + '">' +
      '<fonts count="2">' +
      '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
      '<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
      '</fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1D6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  /* ---------------------------------------------------------------- zip (STORE) */

  let crcTable = null;
  /** CRC-32 (IEEE 802.3, the zip polynomial) of bytes → unsigned 32-bit number. */
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /** files: [{name, data: Uint8Array}] → one STORE zip archive. */
  function zip(files) {
    const enc = new TextEncoder();
    if (files.length > 65535) throw new Error('XlsxLite: more than 65,535 zip entries');
    const items = files.map(f => ({ name: enc.encode(f.name), data: f.data, crc: crc32(f.data) }));
    let size = 22;
    items.forEach(it => { size += 30 + it.name.length + it.data.length + 46 + it.name.length; });
    if (size > 0xFFFFFFFF) throw new Error('XlsxLite: the workbook is larger than 4 GiB');
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let p = 0;
    const u16 = v => { dv.setUint16(p, v, true); p += 2; };
    const u32 = v => { dv.setUint32(p, v >>> 0, true); p += 4; };
    items.forEach(it => {
      it.offset = p;
      u32(0x04034B50); u16(20); u16(0x0800); u16(0); u16(DOS_TIME); u16(DOS_DATE);
      u32(it.crc); u32(it.data.length); u32(it.data.length); u16(it.name.length); u16(0);
      out.set(it.name, p); p += it.name.length;
      out.set(it.data, p); p += it.data.length;
    });
    const cdStart = p;
    items.forEach(it => {
      u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0); u16(DOS_TIME); u16(DOS_DATE);
      u32(it.crc); u32(it.data.length); u32(it.data.length); u16(it.name.length); u16(0); u16(0);
      u16(0); u16(0); u32(0); u32(it.offset);
      out.set(it.name, p); p += it.name.length;
    });
    const cdSize = p - cdStart;
    u32(0x06054B50); u16(0); u16(0); u16(items.length); u16(items.length); u32(cdSize); u32(cdStart); u16(0);
    return out;
  }

  /* ---------------------------------------------------------------- public */

  /** spec → the .xlsx file as bytes (see the header for the spec). */
  function bytes(spec) {
    const sheets = spec && Array.isArray(spec.sheets) ? spec.sheets : null;
    if (!sheets || !sheets.length) throw new Error('XlsxLite: spec.sheets must hold at least one sheet');
    if (sheets.length > MAX_SHEETS) throw new Error('XlsxLite: more than ' + MAX_SHEETS + ' sheets');
    const names = sheetNames(sheets);
    const enc = new TextEncoder();
    const files = [
      { name: '[Content_Types].xml', xml: contentTypesXml(sheets.length) },
      { name: '_rels/.rels', xml: rootRelsXml() },
      { name: 'xl/workbook.xml', xml: workbookXml(names) },
      { name: 'xl/_rels/workbook.xml.rels', xml: workbookRelsXml(sheets.length) },
      { name: 'xl/styles.xml', xml: stylesXml() }
    ];
    sheets.forEach((sh, i) => { files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', xml: sheetXml(sh || {}) }); });
    return zip(files.map(f => ({ name: f.name, data: enc.encode(f.xml) })));
  }

  /** spec → Blob of the .xlsx file. */
  function build(spec) {
    return new Blob([bytes(spec)], { type: MIME });
  }

  /** Builds the workbook and hands it to core.saveFile (download / share sheet) → its Promise<boolean>. */
  function saveTable(core, filename, spec) {
    return core.saveFile(build(spec), filename);
  }

  global.XlsxLite = Object.freeze({ build, bytes, saveTable });
})(window);
