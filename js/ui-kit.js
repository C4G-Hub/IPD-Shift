/* =====================================================================
 * js/ui-kit.js — design system of "เวร IPD" → window.UiKit
 *
 * Standalone classic script (no dependencies; window.Utils is not needed). Load it BEFORE js/app.js.
 * It works in a bare page too (the unit tests run it without Tailwind). On load it injects
 * <style id="uikit-style"> (sheet enter animation, reduced motion, avatar initials, safe-area helpers).
 * The icon sprite is injected lazily on the first UiKit.icon() call (or UiKit.injectSprite()).
 * No network use, no globals besides `UiKit`.
 *
 * Tailwind note: css/tailwind.css is generated from class-like tokens found in this file, so every recipe in
 * UiKit.cls is a complete string literal (no concatenated class names, no quotes inside class names).
 * Text sizes are rem (they follow the user's text-size setting; never fixed px sizes). Nothing smaller than `text-xs`;
 * interactive targets are at least 44 px (`h-11`/`w-11`); Thai text needs
 * generous leading, so recipes never use the tight line-height utilities (none / tight).
 *
 * ---------------------------------------------------------------- PUBLIC SURFACE
 *
 * UiKit.version                        '1.6.0'  (1.6 = 3.0.1: image.decode, compress opts.crop, picture-framing recipes; 1.5 = R1b I1: dialog opts detail / maxLength / data; 1.4 = R1b: leave-model recipes, avatars.refresh; 1.3 = R1a FIX-2: rem text sizes, neutral disabled buttons, 16 px primary labels, Sarabun
 *                                      initials, dvh sheets that follow the on-screen keyboard, calendar / save-bar / stepper recipes;
 *                                      1.2 = R1a-B3 screen recipes, larger avatar initials; 1.1 = theme v2 "Pastel Kawaii": semantic
 *                                      colour families, display font, sticker buttons, stroke-2 icons, decoration glyphs)
 * UiKit.cls                            frozen map  key → complete Tailwind class string (see the CLS table below)
 *     el.className = UiKit.cls.btn + ' ' + UiKit.cls.btnPrimary;       // a primary button
 *     '<span class="' + UiKit.cls.pill + ' ' + UiKit.cls.pillOk + '">อนุมัติ</span>'
 * UiKit.esc(s)                         HTML-escapes & < > " ' (null/undefined → '')
 * UiKit.injectStyle()                  idempotent; inserts <style id="uikit-style"> (already done on load)
 *
 * Icons
 * UiKit.iconNames                      frozen array of the icon names (see ICONS below)
 * UiKit.injectSprite()                 idempotent; inserts the hidden <svg id="uikit-sprite"> with one
 *                                      <symbol id="uk-i-NAME"> per icon as the first child of <body>
 * UiKit.icon(name, extraCls)           → '<svg class="uk-icon EXTRA" aria-hidden="true" ...><use href="#uk-i-NAME"/></svg>'
 *                                      24 px grid, stroke 2, round caps/joins, colour = currentColor.
 *                                      Default size 20 px (zero-specificity rule, so `w-6 h-6` etc. override).
 *                                      Unknown name → '' (and a console.warn). Icons are decorative: put the
 *                                      text in the button, or an aria-label on an icon-only button:
 *     '<button class="' + UiKit.cls.iconBtn + '" aria-label="รีเฟรช">' + UiKit.icon('refresh') + '</button>'
 *
 * Decoration glyphs (filled, theme v2)
 * UiKit.decoNames                      frozen array: 'star', 'heart', 'sparkle'
 * UiKit.deco(name, extraCls)           → '<svg class="uk-deco EXTRA" aria-hidden="true" data-deco="NAME" fill="currentColor">…</svg>'
 *                                      default 16 px (zero-specificity rule); colour via cls.decoStar / decoHeart /
 *                                      decoSparkle (or any text-* class). Sparing use only: around the logo, empty
 *                                      states, the what's-new header, a card corner — never behind dense text, never
 *                                      as a status. There is deliberately no plus/cross glyph (the owner's rule: that
 *                                      shape appears only inside the app picture). Unknown name → '' + console.warn.
 *     '<span class="absolute -top-1 -right-1">' + UiKit.deco('sparkle', 'w-4 h-4 ' + UiKit.cls.decoStar) + '</span>'
 *
 * Avatars
 * UiKit.initials(name)                 'เกศินี' → 'ก' (a leading Thai vowel เ แ โ ใ ไ is skipped),
 *                                      'สมชาย ใจดี' → 'สจ', 'john smith' → 'JS', 'Anna' → 'A', '' → ''.
 *                                      Leading punctuation/whitespace/Thai marks are skipped; at most 2 chars
 *                                      (first + last word).
 * UiKit.avatarTone(name)               → index 0..5 of the tint (stable hash of the normalised name)
 * UiKit.avatar(name, size, opts)       → '<span class="AVATAR SIZE TINT" data-initials="ส" data-avatar="NAME" aria-hidden="true">[<img>]</span>'
 *                                      size: 'xs'|'sm'|'md'|'lg'|'xl' (default 'sm' = 32 px). Initials are drawn by
 *                                      a ::before rule from data-initials, so they are NOT part of textContent
 *                                      (exact-text test assertions keep holding). When UiKit.avatars.get(name)
 *                                      returns a URL an <img> covers the initials (removed again if it fails; a URL
 *                                      that failed once is not drawn again — avatar() and refresh() keep the initials —
 *                                      until another URL is set for that name or the registry is cleared).
 *                                      opts: { label: true } → role="img" + aria-label=name instead of aria-hidden;
 *                                            { cls: 'ring-2 ring-white' } extra classes.
 * UiKit.avatars                        in-memory registry name → image URL: blob:, data:image/png|jpeg|webp, or a same-origin
 *                                      relative path (no //host, no http(s) or other scheme, no control characters / backslashes)
 *     .set(name, url|null)             null/'' removes; any other URL is ignored
 *     .get(name)                       → url or null
 *     .clear()                         removes all (listeners get (null, null))
 *     .onChange(fn)                    fn(name, url) after every change; returns an unsubscribe function
 *     .refresh(root?, name?)           patches the <img> of every [data-avatar] under root (default document) — only
 *                                      that name's when given — to match the registry; → number changed (R1b: js/app.js
 *                                      calls it on every registry change, so no screen needs a full re-render)
 *
 * Small markup helpers
 * UiKit.pill(text, tone, icon?)        tone 'ok'|'pending'|'danger'|'partial'|'neutral' → status pill with data-tone
 * UiKit.badge(count, spokenLabel?)     count badge with aria-label "N รายการ" (or "N " + spokenLabel); '' for 0/empty;
 *                                      shows "99+" above 99
 * UiKit.skeleton(lines)                → placeholder block with data-loading="1", aria-busy, role="status"
 *                                      (lines default 3, clamped 1..12)
 * UiKit.empty({icon, title, hint, actionLabel, actionId})
 *                                      → empty state (icon circle, title, hint, optional primary button with id=actionId)
 *
 * Sheet stack (works on the app's existing modal elements: open = no `hidden` class + `flex`)
 * UiKit.sheet.open(elOrId, opts)       removes `hidden`, adds `flex`, clears inline display; sets role="dialog" and
 *                                      aria-modal="true"; pushes onto the stack; plays the 180 ms enter animation
 *                                      on the panel; remembers the focused element and moves focus inside
 *                                      (opts.initialFocus element/selector → [autofocus]/[data-autofocus] → first
 *                                      focusable → the panel). Raises z-index above the sheet below when needed.
 *                                      Re-opening an open sheet updates its opts and moves it to the top.
 *     opts.dismissible  (default true) false → Escape / backdrop / closeTop() do nothing
 *     opts.backdrop     (default false) true → a click on the wrapper itself (outside the panel) dismisses
 *     opts.onRequestClose(reason)      called INSTEAD of closing for Escape/backdrop/closeTop — hand the
 *                                      dismissal to the app's own close routine (which then hides the element)
 *     opts.onClose(reason)             after the sheet is hidden; reason 'api'|'escape'|'backdrop'|'top'|'sync'
 *     opts.initialFocus                element or selector inside the sheet
 *     opts.panel                       element or selector of the animated panel (default [data-sheet-panel] or
 *                                      the first element child)
 *     opts.animate      (default true)
 * UiKit.sheet.close(elOrId, reason?)   adds `hidden`, removes `flex` SYNCHRONOUSLY (no exit animation), pops it,
 *                                      restores focus to what was focused before it opened, calls opts.onClose
 * UiKit.sheet.closeTop(opts?)          dismisses the top sheet (respects dismissible / onRequestClose unless
 *                                      opts.force); returns true when the top sheet was dismissed or handed over
 * UiKit.sheet.top()                    → the top open sheet element or null
 * UiKit.sheet.isOpen(elOrId)           → true when the element is connected and has no `hidden` class
 *                                      (same meaning as app.js isShown())
 * UiKit.sheet.stack()                  → array of open sheet elements, bottom → top
 * UiKit.sheet.register(elOrId, opts)   adopt an element whose `hidden` class is toggled by other code: when it
 *                                      becomes visible it joins the stack (focus moved, Escape works); when it is
 *                                      hidden directly it leaves the stack (focus restored, onClose('sync')).
 *                                      Done with a MutationObserver plus a lazy sync() in every API call.
 * UiKit.sheet.sync()                   reconciles the stack with the DOM now (hidden/removed entries leave,
 *                                      visible registered elements join); returns the stack
 * UiKit.sheet.onChange(fn)             fn(stackArray, {type:'open'|'close', el, reason}); returns unsubscribe
 * UiKit.sheet.fitViewport()            keeps open sheets inside the VISUAL viewport while an on-screen keyboard covers part of the
 *                                      layout viewport (iOS Safari, Android "resizes-visual"): the wrapper gets the visual viewport's
 *                                      top/height, so the panel (.uk-sheet-max: max-height min(90dvh, 100 %)) and its action row stay above the
 *                                      keyboard; runs by itself on visualViewport resize/scroll while a sheet is open; → true when it
 *                                      lifted the sheets. Without window.visualViewport it does nothing. (Verify on a real phone.)
 * Global behaviour: Escape dismisses the top sheet and calls event.preventDefault() whenever a sheet is open
 * (also for a non-dismissible one) — an app-level Escape handler must ignore events with defaultPrevented.
 * Tab/Shift+Tab are trapped in the top sheet; focus that escapes is pulled back. <html> gets class
 * `uk-lock` (overflow hidden) while any sheet is open.
 *
 *   // adopting an existing modal (index.html: <div id="confirmLeaveModal" class="fixed ... hidden ...">)
 *   UiKit.sheet.register('confirmLeaveModal', { onRequestClose: closeConfirmLeave });
 *   function showModal(id) { UiKit.sheet.open(id); }             // or keep toggling `hidden` directly
 *   function hideModal(id) { UiKit.sheet.close(id); }
 *   document.addEventListener('keydown', e => { if (e.defaultPrevented) return; ... });
 *
 * Dialogs (Promise based replacements for confirm / prompt / alert)
 * UiKit.confirm(message, opts)         → Promise<boolean>
 * UiKit.prompt(message, defaultValue, opts) → Promise<string|null>  (null = cancelled)
 * UiKit.alert(message, opts)           → Promise<void>
 *     When window.APP_CONFIG && APP_CONFIG.NATIVE_DIALOGS is truthy they call window.confirm(message) /
 *     window.prompt(message[, defaultValue]) / window.alert(message) with the exact message (looked up at call
 *     time, so test stubs work) and resolve with the result (confirm → boolean, prompt → string or null).
 *     Otherwise they render a sheet (data-uikit-dialog="confirm|prompt|alert"): title, message with line breaks
 *     preserved, input for prompt ([data-uk-input]), buttons [data-uk-action="ok"|"cancel"].
 *     Enter = OK (Enter on a focused button activates that button), Escape / backdrop = cancel.
 *     opts: { title, okLabel ('ตกลง'), cancelLabel ('ยกเลิก'), danger (red OK button, focus starts on cancel),
 *             placeholder, inputType ('text'), icon (icon name shown above the title),
 *             R1b: detail { title, text?, avatar? (a name: UiKit.avatar), tone? 'neutral'|'ok'|'danger' } — a framed block
 *               between the title and the message ([data-uk-detail]); with native dialogs its title and text (and
 *               opts.title) are put in front of the message, separated by a blank line, because window.confirm/prompt
 *               cannot show it;
 *             maxLength (prompt) — the input stops at that many characters and a live counter "n/max" ([data-uk-count],
 *               aria-live polite) sits under it; native prompts cannot limit the input: check the answer's length;
 *             hint (prompt) — helper text under the input ([data-uk-hint], linked by aria-describedby); natively it is
 *               appended to the message in parentheses — opts.nativeHint, when given, is used there instead (shorter);
 *             data { key: value } — data-* attributes on the dialog wrapper (camelCase keys, as el.dataset) for tests and
 *               for finding the dialog again (e.g. to close it);
 *             R1b FIX-CL: multiline (prompt) — a growing <textarea> (Enter = new line, Ctrl/⌘+Enter = OK); with maxLength the
 *               text is cut at the limit (never thrown away), the counter turns to the danger tone there and is announced
 *               only from 90 %; returnFocus (element, selector or function) — where focus goes when the dialog closes and
 *               the opener was re-rendered meanwhile (otherwise the opener is found again by its id / data-* attributes);
 *               the decorative icon ([data-uk-dialog-icon]) is hidden on short screens and while a keyboard is open }
 *   if (await UiKit.confirm('ต้องการลบ "' + name + '" ออกจากระบบใช่หรือไม่?', { danger: true, okLabel: 'ลบ' })) …
 *   const pw = await UiKit.prompt('ตั้งรหัสผ่านใหม่', '', { inputType: 'password' });   // null when cancelled
 *
 * Images
 * UiKit.image.compress(fileOrBlob, opts) → Promise<{ base64, mime, width, height, chars }>
 *     opts: maxSide (1280, longest output side; never upscales), maxChars (300000, base64 length bound),
 *           mime ('image/jpeg'; 'image/png' and 'image/webp' allowed; the browser may fall back to PNG — the
 *           returned mime is what was really produced), square (false; centre crop to a square first),
 *           crop ({x, y, size}: a SQUARE region in source pixels of the decoded, upright picture — the same coordinates
 *           as image.decode's width / height — kept INSTEAD of the centre crop, so the result is square; validated and
 *           clamped into the picture: size to 1 … min(width, height), x to 0 … width − size, y to 0 … height − size; a
 *           non-finite x / y centres that axis, a missing or non-positive size takes the whole short side; absent → the
 *           old behaviour, unchanged).
 *     fileOrBlob may also be the result of image.decode (not released): its working copy is encoded, no second decode.
 *     Adaptive loop: JPEG/WebP quality 0.85 → 0.45, then the size shrinks by 25 % per round, until
 *     chars <= maxChars. JPEG output is flattened on white. Rejects with an Error whose message is Thai and can
 *     be shown to the user; err.code = 'no-file'|'not-image'|'decode'|'too-large'|'unsupported'.
 *   const r = await UiKit.image.compress(file, { square: true, maxSide: 192, maxChars: 24000 });
 * UiKit.image.decode(fileOrBlob, opts) → Promise<{ width, height, canvas, scale, release() }>
 *     Decodes once (same checks and Thai errors as compress: 'no-file'|'not-image'|'decode'|'unsupported') and keeps a
 *     working copy of at most opts.maxSide (1600) px on its longest side in `canvas` (memory on phones). width / height:
 *     the picture's natural size AFTER the EXIF orientation (browsers apply it on decode: image-orientation from-image);
 *     scale = canvas.width / width (≤ 1). release() frees the copy (removes the canvas from the page, 0 × 0) — call it
 *     when done; a released result is no longer accepted by compress ('no-file').
 *   const d = await UiKit.image.decode(file);   // show d.canvas while the user frames the picture, then:
 *   const r = await UiKit.image.compress(d, { crop: { x: 120, y: 0, size: 900 }, maxSide: 192, maxChars: 24000 });
 *   d.release();
 * UiKit.image.toObjectUrl(base64, mime) → blob: URL (accepts a full data: URL too); revoke it when done. Only image/png,
 *                                      image/jpeg and image/webp: any other type throws the Error of code 'not-image'
 * UiKit.image.jpegSize(base64)         → {width, height} read from the JPEG frame header (SOFn marker), or null when the
 *                                      data is not a JPEG (FF D8 start) or no frame header can be read. Reads only the
 *                                      header bytes (never decodes pixels), so a "decode bomb" picture can be refused
 *                                      before any <img> sees it (R1b FIX-CL CL-9: avatars are JPEG ≤ 512 px per side).
 *
 * ---------------------------------------------------------------- INTEGRATION NOTES
 * - Sheet markup: a full-screen wrapper (`fixed inset-0 ... hidden items-end md:items-center`, e.g. cls.sheetWrap)
 *   holding ONE panel element (first element child, or mark it with data-sheet-panel). Every modal in
 *   index.html has this shape. The wrapper gets class `uk-sheet` on first open; the injected rule
 *   `.uk-sheet.hidden{display:none!important}` keeps closed sheets hidden even where Tailwind is absent.
 * - Closing is always synchronous, so `hidden` is set before the next line of app code runs (tests assert
 *   !isOpen() right after settle()). Only the enter is animated (classes `uk-enter` on the wrapper and
 *   `uk-panel` on the panel, 180 ms, disabled by prefers-reduced-motion).
 * - The Escape listener is registered on `document` when this file loads, i.e. before app.js adds its own, so it
 *   runs first; it calls preventDefault() whenever a sheet is open (one Escape closes only the top sheet). The app has
 *   no Escape chain of its own: its modals join this stack (UiKit.sheet.register with onRequestClose). Any other
 *   keydown handler must still start with `if (e.defaultPrevented) return;`.
 * - Dialog sheets are appended to <body> and removed after closing; z-index is raised above any open sheet
 *   (e.g. #diagModal z-[65]). Their classes come from UiKit.cls, so css/tailwind.css must be rebuilt after this
 *   file is wired into the CSS build.
 * - Tests: boot-app sets APP_CONFIG.NATIVE_DIALOGS = true, so UiKit.confirm/prompt/alert reach the stubbed
 *   window.confirm/prompt/alert with the legacy messages, synchronously inside the call.
 *
 * ---------------------------------------------------------------- THEME (v2 "Pastel Kawaii", R1a §7)
 * Colours are SEMANTIC Tailwind families defined once in the Tailwind config of tools/build-css.html:
 *   brand (pink: primary, selection, primary buttons, active nav) · accent (sky: info, links, today) ·
 *   lilac (gradient middle, tertiary tint) · ink (navy: titles, outlines, dark surfaces) · cream (page backdrop) ·
 *   sun (yellow: stars, pending) · coral (danger, count badges). Success stays emerald, warning amber/sun.
 * Display font: `font-display` (Mitr 500/600, fallback Sarabun → system Thai) for titles, buttons, nav labels, big
 * numbers; body text, tables and inputs stay Sarabun. Only weights 500 (font-medium) and 600 (font-semibold) of
 * Mitr are loaded — never pair font-display with font-bold.
 * Contrast rules: titles ink-900, body slate-700, secondary slate-500; white text only on brand-600+, coral-600+,
 * ink-600+; on every pastel fill (100–300 steps, the header gradient) text and icons are ink-800/900.
 * Shapes: cards/lists rounded-3xl with a 2 px pastel ring (border-2 border-brand-100); buttons, inputs, tiles
 * rounded-2xl; chips, pills, avatars, icon buttons fully round. Buttons have a 4 px darker bottom edge
 * (border-b-4) that stays when pressed (only the fill darkens), so nothing shifts.
 *
 * ---------------------------------------------------------------- CLS keys
 * Type:     titleScreen titleCard textBody textMeta textCaption sectionLabel (menu section heading) label
 * Surfaces: card cardInfo (sky ring) cardLilac (lilac ring) list listRow divider
 * Buttons:  btn btnPrimary btnSecondary btnTonal btnDanger btnGhost btnLg iconBtn iconBtnRound (white sticker circle)
 * Inputs:   input select textarea
 * Chips:    chip chipOn chipOff         Option tiles: tile tileOn tileOff
 * Status:   pill pillOk pillPending pillDanger pillPartial pillNeutral   badge
 * Avatar:   avatar avatarXs avatarSm avatarMd avatarLg avatarXl avatarTint1 … avatarTint6 (initials in Sarabun: looped Thai letters
 *           are not misread as Latin ones)
 * Sheets:   sheetWrap sheetPanel sheetGrabber sheetBody sheetTitle sheetText sheetFooter dialogIcon dialogIconDanger
 *           (R1b) dialogDetail dialogDetailOk dialogDetailDanger dialogDetailTitle (opts.detail) · dialogCount (opts.maxLength)
 * Banners:  banner bannerInfo bannerOk bannerWarn bannerDanger
 * Nav:      navInner navItem navOn navOff   (R1a-B2) navRail navItemRail navIcon — the bar becomes a left rail from md:
 * Shell:    hdrIconBtn hdrPill (ink on the pastel header) · dayCell dayCellOn dayCellOff dayCellToday dayLabel dayNum
 *           dayWeekend (week strip; dayWeekend keeps text-rose-600 — a test contract, see the THEME report) ·
 *           listIcon listIconBrand listIconInfo listIconLilac listIconSun listIconDanger listIconNeutral listChevron
 *           (pastel circles that lead a row) · saveBar · sheetFrame sheetHead sheetScroll sheetActions (app sheets: a
 *           flex column whose body scrolls between a title row with ✕ and a fixed action row; UiKit's own dialogs
 *           keep sheetPanel/sheetFooter)
 * Loading:  skeleton  Empty state: empty emptyIcon emptyTitle emptyHint
 * Deco:     decoStar decoHeart decoSparkle (colours for UiKit.deco glyphs)
 * Screens:  (R1a-B3) sectionHead sectionTitle cardHead · btnSun (ink on sun-300) btnCompact (narrower button, still
 *           44 px tall) · stationCard stationEdge stationChip stationNeed slotRow slotEmpty (station cards: white sticker,
 *           coloured left edge + tinted title chip, colours inline from Utils.STATIONS) · personChip personChipMe
 *           personChipLeave personEmpty (avatar + name chips) · tag tagBrand · leaveRow (a row of the leave list) ·
 *           disclosure disclosureChevron (<details class="group"><summary>…, the chevron turns when open) · rowAction
 *           rowActionDanger (labelled icon buttons: icon above a short word) · note (cream info box)
 * FIX-2:    wrapAnywhere (user text: long URLs never widen the page) · dateCaption (Buddhist-era caption under a native date
 *           input) · calCell calCellToday calSelFill calNum calNumToday calNumSunday calNumSel calCount calCountSel (leave
 *           calendar: the week strip's selection language — selected = filled brand-600, today = accent ring / accent-700,
 *           keyboard focus = an offset ink ring) · saveBtn + saveBtnClean / saveBtnDirty (the save bar's button: secondary
 *           while nothing is unsaved, primary while the draft is dirty) · stepBtn (labelled −/+ text button) · countRow
 *           (white station row of the counts sheet)
 * R1b:      inlineTag + inlineTagPartial / inlineTagPending (tag inside a person chip: "หาหมอ 09:00–11:00", "รออนุมัติ") ·
 *           slotNote + slotNoteDanger / slotNotePartial / slotNotePending (line under a slot picker) · timeChip (preset of the
 *           leave sheet's time step, with chipOn / chipOff) timeInput (native time input) fieldError · calMarks calMarkPartial
 *           calMarkPending (leave calendar day markers) · statusBox + statusBoxPending / statusBoxRejected / statusBoxPartial /
 *           statusBoxOk (the leave sheet's status line)
 * FIX-CL:   (R1b fix round) pillRejected (dashed soft coral: a rejected request) · calMarkPartialSel / calMarkPendingSel (white
 *           markers on the selected day) calNumSundayTint (Sunday number on a strongly tinted day) · tileTight (doctor-visit
 *           tiles: the label never wraps) · navDot (a dot on a nav entry, core.badges.dot) · secretValue (a revealed
 *           password: monospaced, slashed zero) · dialogCountDanger (the prompt counter at its limit)
 * 3.0.1:    cropStage (the square picture-framing stage: up to 288 px, touch-action none, focusable) cropImage (the working
 *           canvas inside it, moved by a transform) cropMask (the round outline with the lightly dimmed corners) range (a
 *           44 px slider with a 16 px font, brand thumb)
 * Disabled buttons (btn) are neutral (ink-100 fill, ink-400 text) — a busy button (aria-busy) keeps its colours.
 *
 * ---------------------------------------------------------------- ICONS
 * Drawn for this app on a 24 px grid in the style of Lucide; several shapes are adapted from Lucide
 * (https://lucide.dev), which is distributed under the ISC License:
 *   ISC License — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 *   All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *   Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
 *   hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
 *   INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 *   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
 *   DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 *   CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 * ===================================================================== */
(function (global) {
  'use strict';

  const doc = global.document;

  /* ---------------------------------------------------------------- class recipes */
  const cls = Object.freeze({
    // type — titles, buttons, nav labels and big numbers use the display font (Mitr, see tools/build-css.html)
    titleScreen: 'font-display text-lg font-semibold leading-8 text-ink-900',
    titleCard: 'font-display text-base font-medium leading-7 text-ink-900',
    textBody: 'text-sm leading-6 text-slate-700',
    textMeta: 'text-[0.8125rem] leading-5 text-slate-500',
    textCaption: 'text-xs font-medium leading-4 text-slate-500',
    sectionLabel: 'px-1 pb-2 font-display text-[0.8125rem] font-medium leading-5 tracking-wide text-ink-500',
    label: 'block text-sm font-medium leading-6 text-ink-800',
    // surfaces — white stickers: a 2 px pastel ring, big radius, no heavy shadow
    card: 'bg-white border-2 border-brand-100 rounded-3xl p-4',
    cardInfo: 'bg-white border-2 border-accent-100 rounded-3xl p-4',
    cardLilac: 'bg-white border-2 border-lilac-100 rounded-3xl p-4',
    list: 'bg-white border-2 border-brand-100 rounded-3xl overflow-hidden divide-y divide-brand-100',
    listRow: 'flex items-center gap-3 w-full px-4 min-h-[56px] text-left text-sm leading-6 text-ink-800 active:bg-brand-50 focus-visible:outline-none focus-visible:bg-brand-50',
    divider: 'border-t border-brand-100',
    // buttons — "chunky sticker buttons": solid fill + a darker 4 px bottom edge; pressed = darker fill (no shift)
    // (no font size here: each tone sets its own — in the stylesheet a later utility such as text-sm would beat text-base)
    btn: 'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-2xl font-display font-medium leading-5 select-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 [&:disabled:not([aria-busy=true])]:bg-ink-100 [&:disabled:not([aria-busy=true])]:border-ink-100 [&:disabled:not([aria-busy=true])]:text-ink-400',
    // primary labels are 16 px (R1a FIX-2 polish), the other tones 14 px
    btnPrimary: 'bg-brand-600 border-b-4 border-brand-800 text-white text-base active:bg-brand-700',
    btnSecondary: 'bg-white border-2 border-b-4 border-ink-200 text-ink-800 text-sm active:bg-ink-50',
    btnTonal: 'bg-brand-50 border-2 border-b-4 border-brand-100 text-brand-700 text-sm active:bg-brand-100',
    btnDanger: 'bg-coral-600 border-b-4 border-coral-700 text-white text-sm active:bg-coral-700',
    btnGhost: 'bg-transparent text-ink-700 text-sm active:bg-ink-50',
    btnLg: 'h-12 text-base w-full',
    iconBtn: 'inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full text-ink-700 active:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50',
    iconBtnRound: 'inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full bg-white border-2 border-b-4 border-ink-200 text-ink-700 active:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 disabled:opacity-50',
    // inputs
    input: 'w-full h-11 px-3.5 rounded-2xl border-2 border-ink-200 bg-white text-sm leading-6 text-ink-900 placeholder-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200',
    select: 'w-full h-11 pl-3.5 pr-8 rounded-2xl border-2 border-ink-200 bg-white text-sm leading-6 text-ink-900 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200',
    textarea: 'w-full min-h-[88px] px-3.5 py-2 rounded-2xl border-2 border-ink-200 bg-white text-sm leading-6 text-ink-900 placeholder-slate-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200',
    // filter chips
    chip: 'inline-flex items-center gap-1.5 h-11 px-4 rounded-full border-2 font-display text-sm font-medium leading-5 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1',
    chipOff: 'bg-white border-brand-100 text-ink-800 active:bg-brand-50',
    chipOn: 'bg-brand-600 border-brand-600 text-white',
    // option tiles
    tile: 'flex items-center justify-center gap-1.5 h-12 px-3 rounded-2xl border-2 text-sm font-medium leading-5 text-center select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50',
    // R1b FIX-CL CL-20: the doctor-visit tiles (icon + "หาหมอ (เช้า)") — less padding, the label never wraps (360 px, 130 % text)
    tileTight: 'flex items-center justify-center gap-1 h-12 px-2 rounded-2xl border-2 text-sm font-medium leading-5 text-center whitespace-nowrap select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50',
    tileOff: 'bg-white border-ink-100 text-ink-800 active:bg-brand-50',
    tileOn: 'bg-brand-50 border-brand-500 text-brand-700',
    // status (never by colour alone: a pill always carries a word, optionally an icon)
    pill: 'inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-xs font-medium leading-4 border whitespace-nowrap',
    pillOk: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    pillPending: 'bg-sun-100 border-sun-300 text-amber-800',
    pillDanger: 'bg-coral-50 border-coral-200 text-coral-700',
    pillPartial: 'bg-accent-50 border-accent-200 text-accent-700',
    pillNeutral: 'bg-ink-50 border-ink-100 text-ink-700',
    // R1b FIX-CL CL-22: a rejected request — soft coral, outlined and dashed (an absence is the filled coral pillDanger)
    pillRejected: 'bg-white border-dashed border-coral-300 text-coral-700',
    badge: 'inline-block min-w-[20px] h-5 px-1.5 rounded-full bg-coral-600 text-white text-xs font-bold leading-5 text-center tabular-nums',
    // avatar
    avatar: 'relative inline-flex shrink-0 items-center justify-center rounded-full font-body font-semibold overflow-hidden select-none',
    // initials stay clearly readable at every size (R1a-B3): the letter takes about half of the circle
    avatarXs: 'w-6 h-6 text-xs',
    avatarSm: 'w-8 h-8 text-[0.9375rem]',
    avatarMd: 'w-10 h-10 text-lg',
    avatarLg: 'w-16 h-16 text-[1.75rem]',
    avatarXl: 'w-24 h-24 text-[2.5rem]',
    avatarTint1: 'bg-brand-100 text-brand-800',
    avatarTint2: 'bg-accent-100 text-accent-800',
    avatarTint3: 'bg-sun-200 text-ink-800',
    avatarTint4: 'bg-lilac-100 text-lilac-800',
    avatarTint5: 'bg-emerald-100 text-emerald-800',
    avatarTint6: 'bg-coral-100 text-coral-700',
    // sheets
    sheetWrap: 'fixed inset-0 z-[60] hidden items-end md:items-center justify-center bg-ink-900/40',
    sheetPanel: 'w-full md:max-w-md uk-sheet-max overflow-y-auto overscroll-contain bg-white rounded-t-3xl md:rounded-3xl shadow-2xl shadow-ink-900/20',
    sheetGrabber: 'mx-auto mt-2.5 mb-1 w-12 h-1.5 rounded-full bg-brand-200 md:hidden',
    sheetBody: 'px-5 pt-3 pb-2 space-y-3',
    sheetTitle: 'font-display text-lg font-medium leading-8 text-ink-900',
    sheetText: 'text-sm leading-6 text-slate-700 whitespace-pre-line break-words',
    sheetFooter: 'sticky bottom-0 flex gap-2 px-5 pt-3 pb-4 bg-white',
    dialogIcon: 'flex items-center justify-center w-14 h-14 rounded-full bg-brand-100 text-brand-700',
    dialogIconDanger: 'flex items-center justify-center w-14 h-14 rounded-full bg-coral-100 text-coral-700',
    // R1b (I1): the framed block above a dialog's message (opts.detail) and the counter under a prompt's input (opts.maxLength)
    dialogDetail: 'flex items-center gap-3 p-3 rounded-2xl border-2 bg-cream-50 border-cream-100',
    dialogDetailOk: 'flex items-center gap-3 p-3 rounded-2xl border-2 bg-emerald-50 border-emerald-100',
    dialogDetailDanger: 'flex items-center gap-3 p-3 rounded-2xl border-2 bg-coral-50 border-coral-100',
    dialogDetailTitle: 'font-display text-base font-medium leading-6 text-ink-900 break-words',
    dialogCount: 'text-xs font-medium leading-4 text-slate-500 text-right tabular-nums',
    dialogCountDanger: 'text-xs font-semibold leading-4 text-coral-700 text-right tabular-nums',
    // 3.0.1: framing a profile picture — a square stage (at most 288 px, never wider than its card), the picture inside
    // moved with a transform, a round outline with the corners outside it lightly dimmed (avatars are circles)
    cropStage: 'relative block w-full max-w-[288px] aspect-square mx-auto overflow-hidden rounded-3xl bg-lilac-50 border-2 border-brand-100 touch-none select-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
    cropImage: 'absolute left-0 top-0 max-w-none origin-top-left pointer-events-none',
    cropMask: 'absolute inset-0 rounded-full pointer-events-none border-2 border-white ring-[9999px] ring-white/60',
    range: 'block w-full h-11 min-w-0 text-base accent-brand-600 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-full',
    // banners
    banner: 'flex items-start gap-3 p-3 rounded-2xl border-2 text-sm leading-6',
    bannerInfo: 'bg-accent-50 border-accent-100 text-ink-800',
    bannerOk: 'bg-emerald-50 border-emerald-100 text-emerald-800',
    bannerWarn: 'bg-amber-50 border-sun-200 text-amber-900',
    bannerDanger: 'bg-coral-50 border-coral-100 text-coral-700',
    // bottom navigation (the active entry's icon pill is tinted brand-100 by the inline <style> of index.html)
    navInner: 'grid grid-flow-col auto-cols-fr',
    navItem: 'nav-btn relative flex flex-col items-center justify-center gap-0.5 h-14 font-display text-xs font-medium leading-4 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400',
    navOn: 'text-brand-700',
    navOff: 'text-slate-500',
    navRail: 'md:grid-flow-row md:auto-rows-min md:gap-1 md:px-2',
    navItemRail: 'pt-1 pb-1.5 md:py-0 md:h-[72px] md:w-full md:rounded-2xl',
    navIcon: 'nav-ic inline-flex items-center justify-center w-14 h-7 rounded-full transition-colors',
    // R1b FIX-CL CL-14: a dot without a count on a nav entry (e.g. การลา while an own rejection is not dismissed)
    navDot: 'block w-2.5 h-2.5 rounded-full bg-coral-600 ring-2 ring-white',
    // app shell: pastel gradient header (ink text), week strip, menu rows, save bar, sheets with a title row
    hdrIconBtn: 'inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full text-ink-900 active:bg-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800 disabled:opacity-60',
    hdrPill: 'inline-flex items-center gap-1.5 h-8 min-w-0 max-w-[8.5rem] px-2.5 rounded-full bg-white/70 text-xs font-medium leading-4 text-ink-800 active:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800',
    dayCell: 'week-day flex flex-col items-center justify-center gap-0.5 h-14 min-w-0 rounded-2xl select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800 focus-visible:ring-offset-2',
    dayCellOn: 'bg-brand-600 text-white shadow-md shadow-brand-600/30',
    dayCellOff: 'text-ink-800 active:bg-brand-50',
    dayCellToday: 'bg-accent-50 text-accent-700 ring-2 ring-inset ring-accent-300 active:bg-accent-100',
    dayLabel: 'text-xs font-medium leading-4',
    dayNum: 'font-display text-base font-medium leading-6 tabular-nums',
    dayWeekend: 'text-rose-600',
    listIcon: 'inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full',
    listIconBrand: 'bg-brand-100 text-brand-700',
    listIconInfo: 'bg-accent-100 text-accent-800',
    listIconLilac: 'bg-lilac-100 text-lilac-700',
    listIconSun: 'bg-sun-100 text-amber-800',
    listIconDanger: 'bg-coral-100 text-coral-700',
    listIconNeutral: 'bg-ink-50 text-ink-700',
    listChevron: 'w-5 h-5 shrink-0 text-ink-300',
    saveBar: 'fixed inset-x-0 md:left-[88px] z-30 border-t border-brand-100 bg-white/95 backdrop-blur',
    sheetFrame: 'flex flex-col w-full md:max-w-md uk-sheet-max bg-white rounded-t-3xl md:rounded-3xl shadow-2xl shadow-ink-900/20 overflow-hidden',
    sheetHead: 'flex items-center gap-2 pl-5 pr-2 pt-2 pb-1',
    sheetScroll: 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pt-1 pb-4 space-y-3',
    sheetActions: 'flex-none flex gap-2 px-5 pt-3 pb-4 border-t border-brand-100 bg-white',
    // loading / empty
    skeleton: 'animate-pulse rounded-xl bg-lilac-100',
    empty: 'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
    emptyIcon: 'relative flex items-center justify-center w-14 h-14 rounded-full bg-brand-50 text-brand-500',
    emptyTitle: 'font-display text-base font-medium leading-7 text-ink-900',
    emptyHint: 'text-sm leading-6 text-slate-500',
    // decoration glyphs (UiKit.deco): small, sparse, never behind dense text
    decoStar: 'text-sun-300',
    decoHeart: 'text-brand-300',
    decoSparkle: 'text-accent-300',
    // screens (R1a-B3): section heads, card heads, station cards, people chips, leave rows, disclosure rows, row actions
    sectionHead: 'flex items-center gap-2 min-h-[44px] px-1',
    sectionTitle: 'font-display text-base font-medium leading-6 text-ink-900',
    cardHead: 'flex items-center gap-3 min-w-0',
    btnSun: 'bg-sun-300 border-b-4 border-sun-500 text-ink-900 text-sm active:bg-sun-400',
    btnCompact: 'h-11 px-3.5 rounded-2xl',
    // the colour edge is a full-height strip INSIDE the card's border; overflow-hidden clips it to the inner radius
    stationCard: 'relative overflow-hidden bg-white border-2 border-brand-100 rounded-3xl pl-5 pr-4 py-3',
    stationEdge: 'absolute left-0 inset-y-0 w-1.5',
    stationChip: 'inline-flex items-center min-h-[32px] px-3 rounded-full font-display text-sm font-medium leading-5 break-words',
    stationNeed: 'text-[0.8125rem] font-medium leading-5 text-slate-600 whitespace-nowrap tabular-nums',
    slotRow: 'flex items-center gap-2.5',
    slotEmpty: 'inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full border-2 border-dashed border-ink-200 text-xs font-medium leading-4 text-slate-500 tabular-nums',
    personChip: 'inline-flex items-center gap-1.5 max-w-full min-h-[36px] pl-1 pr-3 py-0.5 rounded-full border-2 bg-white border-ink-100 text-sm font-medium leading-5 text-ink-900',
    personChipMe: 'inline-flex items-center gap-1.5 max-w-full min-h-[36px] pl-1 pr-3 py-0.5 rounded-full border-2 bg-brand-50 border-brand-300 text-sm font-medium leading-5 text-brand-800',
    personChipLeave: 'inline-flex items-center gap-1.5 max-w-full min-h-[36px] pl-1 pr-3 py-0.5 rounded-full border-2 border-dashed bg-coral-50 border-coral-300 text-sm font-medium leading-5 text-coral-700',
    personEmpty: 'inline-flex items-center min-h-[36px] px-3 rounded-full border-2 border-dashed border-ink-100 text-sm leading-5 text-slate-500',
    tag: 'inline-flex items-center h-6 px-2 rounded-full bg-ink-50 border border-ink-100 text-xs font-medium leading-4 text-ink-700 whitespace-nowrap',
    tagBrand: 'inline-flex items-center h-6 px-2 rounded-full bg-brand-50 border border-brand-200 text-xs font-medium leading-4 text-brand-800 whitespace-nowrap',
    leaveRow: 'flex items-center gap-3 w-full px-4 py-2 min-h-[60px] text-left text-sm leading-6 text-ink-800 active:bg-brand-50 focus-visible:outline-none focus-visible:bg-brand-50',
    disclosure: 'flex items-center gap-3 w-full min-h-[56px] px-4 py-2 cursor-pointer select-none text-left focus-visible:outline-none focus-visible:bg-brand-50',
    disclosureChevron: 'w-5 h-5 shrink-0 text-ink-400 transition-transform group-open:rotate-180',
    rowAction: 'inline-flex flex-col items-center justify-center gap-0.5 min-w-[52px] h-12 px-1.5 rounded-2xl font-display text-xs font-medium leading-4 text-ink-700 active:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50',
    rowActionDanger: 'inline-flex flex-col items-center justify-center gap-0.5 min-w-[52px] h-12 px-1.5 rounded-2xl font-display text-xs font-medium leading-4 text-coral-700 active:bg-coral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral-400 disabled:opacity-50',
    note: 'flex items-start gap-2.5 p-3 rounded-2xl bg-cream-50 border-2 border-cream-100 text-sm leading-6 text-slate-700',
    // R1b FIX-CL CL-19: a revealed password — monospaced (0/O and 1/l/I differ), slashed zero, a little letter spacing
    secretValue: 'font-mono text-lg font-semibold leading-7 tracking-wider slashed-zero text-ink-900',
    // R1a FIX-2
    wrapAnywhere: '[overflow-wrap:anywhere]',
    dateCaption: 'mt-1 px-1 text-xs font-medium leading-4 text-slate-500 tabular-nums',
    // leave calendar (one selection language with the week strip)
    calCell: 'cal-day relative h-14 rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-800 focus-visible:ring-offset-2',
    calCellToday: 'border-2 border-accent-400',
    calSelFill: 'absolute -inset-px rounded-xl bg-brand-600 shadow-md shadow-brand-600/30',
    calNum: 'absolute top-1 left-1 min-w-[20px] px-1 rounded-full text-xs font-semibold leading-5 tabular-nums',
    calNumToday: 'bg-white text-accent-700 ring-1 ring-accent-300',
    calNumSunday: 'text-coral-700',
    // R1b FIX-CL CL-13: a Sunday number on a strongly tinted cell (3+ people) sits on a white chip (AA for 12 px text)
    calNumSundayTint: 'bg-white text-coral-700',
    calNumSel: 'bg-brand-600 text-white',
    calCount: 'cal-count absolute bottom-0.5 inset-x-0 text-xs font-semibold leading-4 whitespace-nowrap text-rose-900',
    calCountSel: 'cal-count absolute bottom-0.5 inset-x-0.5 rounded-full bg-brand-600 text-xs font-semibold leading-4 whitespace-nowrap text-white',
    // the save bar's button: quiet while nothing is unsaved, the primary action while the draft is dirty
    saveBtn: 'inline-flex items-center justify-center gap-2 h-11 min-w-[9.5rem] px-5 rounded-2xl font-display font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 [&:disabled:not([aria-busy=true])]:bg-ink-100 [&:disabled:not([aria-busy=true])]:border-ink-100 [&:disabled:not([aria-busy=true])]:text-ink-400',
    saveBtnClean: 'bg-white border-2 border-b-4 border-ink-200 text-ink-800 text-sm active:bg-ink-50',
    saveBtnDirty: 'bg-brand-600 border-b-4 border-brand-800 text-white text-base active:bg-brand-700',
    // station-count steppers: a word, never a chevron (the station name is in the aria-label)
    stepBtn: 'count-step inline-flex items-center justify-center min-w-[52px] h-11 px-3 rounded-2xl bg-white border-2 border-b-4 border-ink-200 font-display text-sm font-medium leading-5 text-ink-800 active:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 [&:disabled:not([aria-busy=true])]:bg-ink-100 [&:disabled:not([aria-busy=true])]:border-ink-100 [&:disabled:not([aria-busy=true])]:text-ink-400',
    countRow: 'flex items-center justify-between gap-2 py-2 pl-3 pr-2 rounded-2xl bg-white border-2 border-brand-100',
    // R1b (leave model): a small tag INSIDE a person chip / next to a name — a doctor visit with its time, a pending request
    inlineTag: 'inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full border text-xs font-medium leading-4 whitespace-nowrap',
    inlineTagPartial: 'bg-accent-50 border-accent-200 text-accent-800',
    inlineTagPending: 'bg-sun-100 border-sun-300 text-amber-800',
    // the line under a Supervisor's slot picker (aligned with the name, after the 32 px avatar + gap)
    slotNote: 'flex items-center gap-1.5 pl-[42px] text-xs font-medium leading-4',
    slotNoteDanger: 'text-coral-700',
    slotNotePartial: 'text-accent-800',
    slotNotePending: 'text-amber-800',
    // time-range step of the leave sheet: preset chips in a wrapping row, two native time inputs side by side
    // R1b FIX-CL CL-23: the same typeface (Sarabun) as the time fields next to them
    timeChip: 'inline-flex items-center justify-center h-11 px-3.5 rounded-full border-2 text-sm font-semibold leading-5 tabular-nums select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1',
    timeInput: 'w-full h-11 px-3 rounded-2xl border-2 border-ink-200 bg-white text-base leading-6 text-ink-900 tabular-nums focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-200 aria-[invalid=true]:border-coral-400',
    fieldError: 'flex items-start gap-1.5 text-[0.8125rem] font-medium leading-5 text-coral-700',
    // leave calendar: small markers for days that also have a doctor visit / a pending request (never colour alone:
    // the cell's aria-label and the legend say what they mean)
    // R1b FIX-CL CL-13: the markers sit in their own row between the number and the count (never on the number), differ by
    // shape (circle = doctor visit, diamond = pending) as well as colour, and are dark enough for 3:1 on every cell tint;
    // on the selected (brand-600) cell they are white
    calMarks: 'absolute top-[27px] left-1.5 flex items-center gap-1.5',
    calMarkPartial: 'block w-2 h-2 rounded-full bg-accent-800',
    calMarkPending: 'block w-2 h-2 rotate-45 rounded-[1px] bg-amber-800',
    calMarkPartialSel: 'block w-2 h-2 rounded-full bg-white',
    calMarkPendingSel: 'block w-2 h-2 rotate-45 rounded-[1px] bg-white',
    // a status line that leads with an icon in a pastel circle (leave sheet: pending / rejected / decided)
    statusBox: 'flex items-start gap-3 p-3 rounded-2xl border-2 text-sm leading-6',
    statusBoxPending: 'bg-sun-50 border-sun-200 text-ink-900',
    statusBoxRejected: 'bg-coral-50 border-coral-200 text-ink-900',
    statusBoxPartial: 'bg-accent-50 border-accent-100 text-ink-900',
    statusBoxOk: 'bg-emerald-50 border-emerald-100 text-ink-900'
  });

  const AVATAR_SIZES = Object.freeze({ xs: cls.avatarXs, sm: cls.avatarSm, md: cls.avatarMd, lg: cls.avatarLg, xl: cls.avatarXl });
  const AVATAR_TINTS = Object.freeze([cls.avatarTint1, cls.avatarTint2, cls.avatarTint3, cls.avatarTint4, cls.avatarTint5, cls.avatarTint6]);
  const PILL_TONES = Object.freeze({ ok: cls.pillOk, pending: cls.pillPending, danger: cls.pillDanger, partial: cls.pillPartial, neutral: cls.pillNeutral, rejected: cls.pillRejected });
  const SKELETON_WIDTHS = ['w-full', 'w-5/6', 'w-2/3', 'w-3/4', 'w-1/2'];

  /* ---------------------------------------------------------------- basics */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function byId(elOrId) {
    if (!elOrId) return null;
    if (typeof elOrId === 'string') return doc.getElementById(elOrId);
    return elOrId.nodeType === 1 ? elOrId : null;
  }

  const STYLE_TEXT = [
    '@keyframes uk-fade-in{from{opacity:0}to{opacity:1}}',
    '@keyframes uk-sheet-in{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}',
    '.uk-enter{animation:uk-fade-in 180ms ease-out both}',
    '.uk-enter .uk-panel{animation:uk-sheet-in 180ms cubic-bezier(.2,.8,.2,1) both}',
    '@media (prefers-reduced-motion:reduce){.uk-enter,.uk-enter .uk-panel{animation:none!important}}',
    '[data-initials]::before{content:attr(data-initials)}',
    '[data-initials]>img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}',
    ':where(svg.uk-icon){width:1.25rem;height:1.25rem;flex-shrink:0;vertical-align:middle}',
    ':where(svg.uk-deco){width:1rem;height:1rem;flex-shrink:0;vertical-align:middle}',
    // a busy button (app.js withBusy: disabled + aria-busy + busy label) stays readable instead of looking disabled
    'button[aria-busy="true"]:disabled{opacity:.8;cursor:progress}',
    '.uk-sheet.hidden{display:none!important}',
    // sheets: at most 90 % of the visible height (dvh where supported: iOS toolbars), and never taller than their wrapper,
    // which fitViewport() shrinks to the visual viewport while an on-screen keyboard is open (R1a FIX-2 C-M8)
    '.uk-sheet-max{max-height:90vh;max-height:min(90vh,100%);max-height:min(90dvh,100%)}',
    'html.uk-lock{overflow:hidden}',
    '.uk-safe-t{padding-top:env(safe-area-inset-top,0px)}',
    '.uk-safe-b{padding-bottom:env(safe-area-inset-bottom,0px)}',
    '.uk-safe-pb{padding-bottom:calc(1rem + env(safe-area-inset-bottom,0px))}',
    '.uk-safe-x{padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)}',
    // R1b FIX-CL CL-17: on a short screen (landscape, or an on-screen keyboard: html.uk-kb, set by fitViewport) a dialog's
    // decorative icon makes room, so the field and the buttons stay visible above the keyboard
    '@media (max-height:500px){[data-uk-dialog-icon]{display:none!important}}',
    'html.uk-kb [data-uk-dialog-icon]{display:none!important}',
    // a growing multi-line prompt field (opts.multiline): at most about six lines, then it scrolls
    'textarea[data-uk-input]{resize:none;overflow-y:auto;max-height:10.5rem;min-height:4.75rem;padding-top:.5rem;padding-bottom:.5rem;line-height:1.5rem}',
    '@media (max-height:500px){textarea[data-uk-input]{min-height:3rem;max-height:6rem}[data-uk-detail] [data-avatar]{display:none}}',
    // a dialog scrolls as a whole above its sticky button row: a field scrolled into view stays clear of that row
    '[data-uk-input]{scroll-margin-bottom:5.5rem;scroll-margin-top:1rem}'
  ].join('\n');

  function injectStyle() {
    if (!doc) return null;
    let st = doc.getElementById('uikit-style');
    if (st) return st;
    st = doc.createElement('style');
    st.id = 'uikit-style';
    st.textContent = STYLE_TEXT;
    (doc.head || doc.documentElement).appendChild(st);
    return st;
  }

  /* ---------------------------------------------------------------- icons */
  const ICONS = {
    // navigation
    'calendar': '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    'calendar-check': '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    'calendar-off': '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="m9 18.5 6-6"/>',
    'table': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    'menu': '<path d="M4 6h16M4 12h16M4 18h16"/>',
    'message': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'bar-chart': '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V7M18 17v-8"/>',
    'alert-triangle': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    'inbox': '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    'sliders': '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    // actions
    'refresh': '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    'plus': '<path d="M5 12h14M12 5v14"/>',
    'minus': '<path d="M5 12h14"/>',
    'x': '<path d="M18 6 6 18M6 6l12 12"/>',
    'check': '<path d="M20 6 9 17l-5-5"/>',
    'pencil': '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>',
    'trash': '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
    'copy': '<rect x="9" y="9" width="13" height="13" rx="3"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'clipboard': '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
    'send': '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    'search': '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/>',
    'filter': '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    'sort': '<path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16"/>',
    'wand': '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
    'swap': '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
    'more': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    // status and objects
    'key': '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    'eye': '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20"/>',
    'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'lock': '<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    'image': '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    'crown': '<path d="M3 7l4 5 5-7 5 7 4-5-2 11H5z"/><path d="M5 21h14"/>',
    'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'cloud-off': '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.19"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07"/>',
    'stethoscope': '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 12 0v-4"/><circle cx="20" cy="10" r="2"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>'
  };
  const iconNames = Object.freeze(Object.keys(ICONS));

  function injectSprite() {
    if (!doc) return null;
    let sp = doc.getElementById('uikit-sprite');
    if (sp) return sp;
    const host = doc.body || doc.documentElement;
    if (!host) return null;
    const symbols = iconNames.map(function (n) {
      return '<symbol id="uk-i-' + n + '" viewBox="0 0 24 24">' + ICONS[n] + '</symbol>';
    }).join('');
    const wrap = doc.createElement('div');
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" id="uikit-sprite" aria-hidden="true" focusable="false"' +
      ' style="position:absolute;width:0;height:0;overflow:hidden">' + symbols + '</svg>';
    sp = wrap.firstChild;
    host.insertBefore(sp, host.firstChild);
    return sp;
  }

  function icon(name, extraCls) {
    if (!Object.prototype.hasOwnProperty.call(ICONS, name)) {
      try { global.console.warn('UiKit.icon: unknown icon "' + name + '"'); } catch (e) { /* ignore */ }
      return '';
    }
    injectSprite();
    const c = 'uk-icon' + (extraCls ? ' ' + esc(extraCls) : '');
    return '<svg class="' + c + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icon="' + name + '">' +
      '<use href="#uk-i-' + name + '"></use></svg>';
  }


  /* ---------------------------------------------------------------- decoration glyphs */
  // Small FILLED glyphs taken from the app picture (stars, hearts, sparkles) for sparing decoration: around the
  // logo, in empty states, in the what's-new header, in a card corner. Never behind dense text, never as a status.
  // Deliberately no plus/cross shape: the sparkle has unequal, curved arms (a twinkle, not a cross).
  const DECO = {
    'star': '<path d="M12 3.2 14.6 9.2 21.1 9.8 16.2 14.2 17.6 20.6 12 17.2 6.4 20.6 7.8 14.2 2.9 9.8 9.4 9.2z"/>',
    'heart': '<path d="M12 20.4s-8-4.7-8-10.4A4.4 4.4 0 0 1 12 7.4 4.4 4.4 0 0 1 20 10c0 5.7-8 10.4-8 10.4z"/>',
    'sparkle': '<path d="M12 2.5C12.7 8.4 14.6 11 19.5 12 14.6 13 12.7 15.6 12 21.5 11.3 15.6 9.4 13 4.5 12 9.4 11 11.3 8.4 12 2.5z"/>'
  };
  const decoNames = Object.freeze(Object.keys(DECO));

  /** Filled decoration glyph (aria-hidden); colour = currentColor (cls.decoStar / decoHeart / decoSparkle). */
  function deco(name, extraCls) {
    if (!Object.prototype.hasOwnProperty.call(DECO, name)) {
      try { global.console.warn('UiKit.deco: unknown glyph "' + name + '"'); } catch (e) { /* ignore */ }
      return '';
    }
    const c = 'uk-deco' + (extraCls ? ' ' + esc(extraCls) : '');
    return '<svg class="' + c + '" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"' +
      ' stroke-linejoin="round" aria-hidden="true" focusable="false" data-deco="' + name + '">' + DECO[name] + '</svg>';
  }

  /* ---------------------------------------------------------------- initials & avatars */
  // Thai leading vowels (sara e, ae, o, ai maimuan, ai maimalai) and Thai combining marks / signs that cannot start
  // a name visually. U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E are combining; U+0E2F (ฯ), U+0E46 (ๆ) are signs.
  function isSkippable(ch) {
    const c = ch.codePointAt(0);
    if (c >= 0x0E40 && c <= 0x0E44) return true;
    if (c === 0x0E31 || (c >= 0x0E34 && c <= 0x0E3A) || (c >= 0x0E47 && c <= 0x0E4E)) return true;
    if (c === 0x0E2F || c === 0x0E46 || c === 0x0E45) return true;
    if (/\s/.test(ch)) return true;
    // ASCII and general punctuation / symbols
    if (/[!-\/:-@\[-`{-~ -¿ -⁯]/.test(ch)) return true;
    return false;
  }
  function firstLetter(word) {
    const chars = Array.from(word);
    for (let i = 0; i < chars.length; i++) {
      if (!isSkippable(chars[i])) return chars[i].toUpperCase();
    }
    return '';
  }
  function normName(name) {
    if (name === null || name === undefined) return '';
    return String(name).replace(/\s+/g, ' ').trim();
  }
  function initials(name) {
    const words = normName(name).split(' ').filter(function (w) { return firstLetter(w) !== ''; });
    if (!words.length) return '';
    const a = firstLetter(words[0]);
    if (words.length === 1) return a;
    return a + firstLetter(words[words.length - 1]);
  }
  function avatarTone(name) {
    const s = normName(name);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h % AVATAR_TINTS.length;
  }

  /**
   * Avatar image URLs (hardened in R1a fix B-8): a blob: URL, a data:image/png|jpeg|webp URL, or a same-origin relative
   * path. Refused: control characters or backslashes anywhere ("java\tscript:", "\\host"), protocol-relative //host,
   * absolute http(s) and every other scheme (javascript:, data:text/html, …), and a path that resolves elsewhere.
   */
  function safeUrl(url) {
    if (typeof url !== 'string') return null;
    const u = url.trim();
    if (!u || /[\u0000-\u001F\u007F\\]/.test(u)) return null;
    if (/^blob:/i.test(u) || /^data:image\/(png|jpeg|webp)[;,]/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(u) || u.slice(0, 2) === '//') return null;
    try {
      const base = doc && doc.baseURI ? doc.baseURI : global.location.href;
      if (new global.URL(u, base).origin !== new global.URL(base).origin) return null;
    } catch (e) { return null; }
    return u;                                            // same-origin relative URL
  }

  const avatarMap = new Map();
  const avatarListeners = [];
  const brokenAvatarUrls = new Set();   // R1b I1: URLs whose <img> failed to load: the initials stay, no new <img> for them
  /** The URL to draw for a normalised name, or null (none, or its picture failed to load). */
  function avatarUrl(k) {
    const u = avatarMap.has(k) ? avatarMap.get(k) : null;
    return u && !brokenAvatarUrls.has(u) ? u : null;
  }
  function notifyAvatars(name, url) {
    avatarListeners.slice().forEach(function (fn) {
      try { fn(name, url); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }
  const avatars = Object.freeze({
    set: function (name, url) {
      const k = normName(name);
      if (!k) return;
      const u = url === null || url === undefined || url === '' ? null : safeUrl(url);
      if (u === null && url !== null && url !== undefined && url !== '') return;   // unsafe → ignored
      const prev = avatarMap.has(k) ? avatarMap.get(k) : null;
      if (u === null) avatarMap.delete(k); else avatarMap.set(k, u);
      if (prev !== u) notifyAvatars(k, u);
    },
    get: function (name) {
      const k = normName(name);
      return avatarMap.has(k) ? avatarMap.get(k) : null;
    },
    clear: function () {
      const had = avatarMap.size > 0;
      avatarMap.clear();
      brokenAvatarUrls.clear();
      if (had) notifyAvatars(null, null);
    },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      avatarListeners.push(fn);
      return function () { const i = avatarListeners.indexOf(fn); if (i >= 0) avatarListeners.splice(i, 1); };
    },
    /**
     * Brings every avatar ([data-avatar]) under root (default document) in line with the registry: adds, replaces or
     * removes its <img>. name: only that person's avatars (null/undefined = all). Cheap DOM patch, no re-render;
     * names are compared, never put into a selector. → number of avatars changed.
     */
    refresh: function (root, name) {
      const scope = root && typeof root.querySelectorAll === 'function' ? root : doc;
      if (!scope) return 0;
      const only = name === null || name === undefined ? null : normName(name);
      let n = 0;
      Array.prototype.forEach.call(scope.querySelectorAll('[data-avatar]'), function (el) {
        const who = el.getAttribute('data-avatar');
        if (only !== null && who !== only) return;
        const url = avatarUrl(who);
        let img = null;
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.hasAttribute('data-uk-avatar-img')) { img = c; break; }
        if (!url) { if (img) { el.removeChild(img); n++; } return; }
        if (img && img.getAttribute('src') === url) return;
        if (img) img.setAttribute('src', url);
        else {   // the attributes in the order avatar() writes them, so a later re-render sees identical markup
          img = doc.createElement('img');
          img.setAttribute('src', url);
          img.setAttribute('alt', '');
          img.setAttribute('data-uk-avatar-img', '1');
          img.setAttribute('draggable', 'false');
          el.appendChild(img);
        }
        n++;
      });
      return n;
    }
  });

  function avatar(name, size, opts) {
    opts = opts || {};
    const n = normName(name);
    const sizeCls = AVATAR_SIZES[size] || AVATAR_SIZES.sm;
    const tint = AVATAR_TINTS[avatarTone(n)];
    const ini = initials(n) || '?';
    const extra = opts.cls ? ' ' + esc(opts.cls) : '';
    const a11y = opts.label ? ' role="img" aria-label="' + esc(n) + '"' : ' aria-hidden="true"';
    const url = avatarUrl(n);
    const img = url ? '<img src="' + esc(url) + '" alt="" data-uk-avatar-img="1" draggable="false">' : '';
    return '<span class="' + cls.avatar + ' ' + sizeCls + ' ' + tint + extra + '" data-initials="' + esc(ini) + '"' +
      ' data-avatar="' + esc(n) + '"' + a11y + '>' + img + '</span>';
  }

  /* ---------------------------------------------------------------- small markup helpers */
  function pill(text, tone, iconName) {
    const t = PILL_TONES[tone] ? tone : 'neutral';
    return '<span class="' + cls.pill + ' ' + PILL_TONES[t] + '" data-tone="' + t + '">' +
      (iconName ? icon(iconName, 'w-3.5 h-3.5') : '') + esc(text) + '</span>';
  }
  function badge(count, spokenLabel) {
    const n = Number(count);
    if (!isFinite(n) || n <= 0) return '';
    const shown = n > 99 ? '99+' : String(Math.floor(n));
    const spoken = Math.floor(n) + ' ' + (spokenLabel ? String(spokenLabel) : 'รายการ');
    return '<span class="' + cls.badge + '" role="status" aria-label="' + esc(spoken) + '">' + shown + '</span>';
  }
  function skeleton(lines) {
    let n = Math.floor(Number(lines));
    if (!isFinite(n) || n < 1) n = 3;
    if (n > 12) n = 12;
    let out = '<div class="space-y-2" data-loading="1" aria-busy="true" role="status" aria-label="กำลังโหลด">';
    for (let i = 0; i < n; i++) {
      out += '<div class="' + cls.skeleton + ' h-4 ' + SKELETON_WIDTHS[i % SKELETON_WIDTHS.length] + '"></div>';
    }
    return out + '</div>';
  }
  function empty(o) {
    o = o || {};
    // the icon circle wears one small sparkle (decoration, see deco())
    const ic = o.icon && ICONS[o.icon] ? '<div class="' + cls.emptyIcon + '">' + icon(o.icon, 'w-7 h-7') +
      '<span class="absolute -top-1 -right-1">' + deco('sparkle', 'w-4 h-4 ' + cls.decoStar) + '</span></div>' : '';
    const title = o.title ? '<p class="' + cls.emptyTitle + '">' + esc(o.title) + '</p>' : '';
    const hint = o.hint ? '<p class="' + cls.emptyHint + '">' + esc(o.hint) + '</p>' : '';
    const btn = o.actionLabel ? '<button type="button"' + (o.actionId ? ' id="' + esc(o.actionId) + '"' : '') +
      ' class="' + cls.btn + ' ' + cls.btnTonal + ' mt-2">' + esc(o.actionLabel) + '</button>' : '';
    return '<div class="' + cls.empty + '" data-empty="1">' + ic + title + hint + btn + '</div>';
  }

  /* ---------------------------------------------------------------- sheet stack */
  const FOCUSABLE = 'a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable="true"]';
  const stack = [];                 // entries { el, opts, restore, zSet }
  const known = [];                 // elements opened or registered (adopted by sync when shown directly)
  const knownOpts = new WeakMap();  // el → default opts
  const sheetListeners = [];
  let observer = null;
  let syncing = false;

  function isVisible(el) { return !!el && el.isConnected && !el.classList.contains('hidden'); }
  function findEntry(el) { for (let i = 0; i < stack.length; i++) if (stack[i].el === el) return i; return -1; }

  function hiddenByAncestor(node, root) {
    for (let n = node; n && n !== root; n = n.parentElement) {
      if (n.hidden || n.classList.contains('hidden')) return true;
    }
    return false;
  }
  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (n) {
      if (n.disabled) return false;
      if (n.getAttribute('tabindex') === '-1') return false;
      if (n.tagName === 'INPUT' && n.type === 'hidden') return false;
      if (hiddenByAncestor(n, root)) return false;
      return n.getClientRects().length > 0;
    });
  }
  function focusEl(n) {
    if (!n || typeof n.focus !== 'function') return;
    try { n.focus({ preventScroll: true }); } catch (e) { try { n.focus(); } catch (e2) { /* ignore */ } }
  }
  function panelOf(entry) {
    const p = entry.opts.panel;
    if (p && p.nodeType === 1) return p;
    if (typeof p === 'string') { const q = entry.el.querySelector(p); if (q) return q; }
    return entry.el.querySelector('[data-sheet-panel]') || entry.el.firstElementChild || entry.el;
  }
  function initialFocus(entry) {
    const el = entry.el;
    let t = entry.opts.initialFocus;
    if (typeof t === 'string') t = el.querySelector(t);
    if (t && t.nodeType === 1 && el.contains(t)) return t;
    const auto = el.querySelector('[autofocus],[data-autofocus]');
    if (auto && focusables(el).indexOf(auto) >= 0) return auto;
    const list = focusables(el);
    if (list.length) return list[0];
    const panel = panelOf(entry);
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
    return panel;
  }
  function zOf(el) {
    const z = parseInt(global.getComputedStyle(el).zIndex, 10);
    return isFinite(z) ? z : 0;
  }
  function raiseZ(entry) {
    let below = 0;
    stack.forEach(function (e) { if (e !== entry) below = Math.max(below, zOf(e.el)); });
    if (stack.length > 1 && zOf(entry.el) <= below) {
      entry.el.style.zIndex = String(below + 1);
      entry.zSet = true;
    }
  }
  function updateLock() {
    if (!doc || !doc.documentElement) return;
    doc.documentElement.classList.toggle('uk-lock', stack.length > 0);
  }
  function emit(type, el, reason) {
    const snapshot = stack.map(function (e) { return e.el; });
    sheetListeners.slice().forEach(function (fn) {
      try { fn(snapshot, { type: type, el: el, reason: reason }); } catch (e) { setTimeout(function () { throw e; }, 0); }
    });
  }
  function observe(el) {
    if (typeof global.MutationObserver !== 'function') return;
    if (!observer) observer = new global.MutationObserver(function () { sync(); });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  function remember(el, opts) {
    if (known.indexOf(el) < 0) known.push(el);
    if (opts) knownOpts.set(el, opts);
    observe(el);
  }

  /**
   * R1b FIX-CL CL-15: a selector that finds the element that opened a sheet again after a re-render replaced that node — its
   * id, else its tag and data-* attributes, prefixed by the nearest ancestor with an id or data-* attributes (e.g. the inbox
   * row of a button). State attributes (busy / loading / state / pressed) are left out: they change while the sheet is open.
   */
  const VOLATILE_ATTR = /^data-(busy|state|loading|status|leave-status|request-status|locked|count|uk-.*)$/;
  function attrQuote(v) { return '"' + String(v).replace(/["\\]/g, '\\$&') + '"'; }
  function ownSelector(node) {
    if (!node || node.nodeType !== 1) return '';
    if (node.id) return '[id=' + attrQuote(node.id) + ']';
    const parts = [];
    Array.prototype.forEach.call(node.attributes, function (a) {
      if (/^data-/.test(a.name) && !VOLATILE_ATTR.test(a.name)) parts.push('[' + a.name + '=' + attrQuote(a.value) + ']');
    });
    return parts.length ? node.tagName.toLowerCase() + parts.join('') : '';
  }
  function focusSelector(el) {
    const own = ownSelector(el);
    if (!own || own.indexOf('[id=') === 0) return own;
    for (let p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
      const ps = ownSelector(p);
      if (ps) return ps + ' ' + own;
    }
    return own;
  }
  /**
   * The element focus returns to when a sheet closes: the remembered node, or — re-rendered meanwhile — opts.returnFocus
   * (element, selector or function → element), then the same selector as the node had, but only when exactly ONE element
   * matches it (never "a button like it" of another person's row — reviewer 2). null → the fallback (setFallbackFocus).
   */
  function restoreTarget(entry) {
    const r = entry.restore;
    if (r && r.isConnected) return r;
    const rf = entry.opts && entry.opts.returnFocus;
    let el = null;
    try {
      el = typeof rf === 'function' ? rf() : typeof rf === 'string' ? doc.querySelector(rf) : rf && rf.nodeType === 1 ? rf : null;
    } catch (e) { el = null; }
    if (el && el.isConnected) return el;
    if (!entry.restoreSel) return null;
    try {
      const all = doc.querySelectorAll(entry.restoreSel);
      el = all.length === 1 ? all[0] : null;
    } catch (e) { el = null; }
    return el && el.isConnected && !el.disabled ? el : null;
  }
  let fallbackFocus = null;   // () → element: where focus goes when the opener is gone and nothing unambiguous replaces it

  /** Pushes an already visible element onto the stack (shared by open() and sync()). */
  function adopt(el, opts, animate) {
    const entry = { el: el, opts: opts || {}, restore: null, restoreSel: '', restoreOwn: '', zSet: false };
    const active = doc.activeElement;
    if (active && active !== doc.body && !el.contains(active)) {
      entry.restore = active;
      entry.restoreSel = focusSelector(active);
      entry.restoreOwn = ownSelector(active);
    }
    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.classList.add('uk-sheet');
    stack.push(entry);
    raiseZ(entry);
    updateLock();
    if (animate && entry.opts.animate !== false) {
      const panel = panelOf(entry);
      panel.classList.add('uk-panel');
      el.classList.remove('uk-enter');
      void el.offsetWidth;   // restart the animation
      el.classList.add('uk-enter');
      const done = function () { el.classList.remove('uk-enter'); };
      el.addEventListener('animationend', function h(e) { if (e.target === panel) { done(); el.removeEventListener('animationend', h); } });
      setTimeout(done, 260);
    }
    focusEl(initialFocus(entry));
    bindViewport();
    fitViewport();
    emit('open', el, 'open');
    return entry;
  }

  /** Removes stack entry i (the element is already hidden or detached). */
  /* ---- on-screen keyboard (R1a FIX-2 C-M8): keep open sheets inside the visual viewport ---- */
  let vvBound = false;
  function keyboardOpen(vv) { return !!vv && global.innerHeight - vv.height > 120; }
  function clearFit(el) { if (el.style.height) { el.style.top = ''; el.style.height = ''; el.style.bottom = ''; } }
  function fitViewport() {
    const vv = global.visualViewport;
    const kb = keyboardOpen(vv);
    if (doc && doc.documentElement) doc.documentElement.classList.toggle('uk-kb', kb && stack.length > 0);
    stack.forEach(function (e) {
      if (!kb) { clearFit(e.el); return; }
      e.el.style.top = Math.max(0, Math.round(vv.offsetTop || 0)) + 'px';
      e.el.style.height = Math.round(vv.height) + 'px';
      e.el.style.bottom = 'auto';
    });
    return kb && stack.length > 0;
  }
  function onViewportResize() {
    if (!fitViewport()) return;
    // the field being typed into stays visible inside the (now shorter) sheet body
    const a = doc.activeElement, t = stack[stack.length - 1];
    if (a && t && t.el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && typeof a.scrollIntoView === 'function') {
      try { a.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    }
  }
  function bindViewport() {
    const vv = global.visualViewport;
    if (vvBound || !vv || typeof vv.addEventListener !== 'function') return;
    vvBound = true;
    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', fitViewport);
  }

  function drop(i, reason) {
    const entry = stack[i];
    const el = entry.el;
    clearFit(el);
    const hadFocus = el.contains(doc.activeElement) || doc.activeElement === doc.body || !doc.activeElement;
    stack.splice(i, 1);
    // sheets opened from inside this one inherit its restore target
    for (let j = i; j < stack.length; j++) {
      if (stack[j].restore && el.contains(stack[j].restore)) {
        stack[j].restore = entry.restore;
        stack[j].restoreSel = entry.restoreSel;
        stack[j].restoreOwn = entry.restoreOwn;
      }
    }
    el.classList.remove('uk-enter');
    if (entry.zSet) { el.style.zIndex = ''; entry.zSet = false; }
    updateLock();
    if (doc.documentElement && !stack.length) doc.documentElement.classList.remove('uk-kb');
    if (hadFocus) {
      const top = stack[stack.length - 1];
      const r = restoreTarget(entry);
      if (r && (!top || top.el.contains(r))) focusEl(r);
      else if (top) focusEl(initialFocus(top));
      else if (fallbackFocus) {
        let f = null;
        try { f = fallbackFocus(); } catch (e) { f = null; }
        if (f && f.isConnected) focusEl(f);
      }
    }
    if (typeof entry.opts.onClose === 'function') {
      try { entry.opts.onClose(reason); } catch (e) { setTimeout(function () { throw e; }, 0); }
    }
    emit('close', el, reason);
  }

  function sync() {
    if (syncing) return stack.map(function (e) { return e.el; });
    syncing = true;
    try {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (i < stack.length && !isVisible(stack[i].el)) drop(i, 'sync');
      }
      for (let k = known.length - 1; k >= 0; k--) if (!known[k].isConnected && findEntry(known[k]) < 0) known.splice(k, 1);
      known.forEach(function (el) {
        if (isVisible(el) && findEntry(el) < 0) adopt(el, knownOpts.get(el), false);
      });
    } finally {
      syncing = false;
    }
    return stack.map(function (e) { return e.el; });
  }

  function open(elOrId, opts) {
    const el = byId(elOrId);
    if (!el) return null;
    const merged = Object.assign({}, knownOpts.get(el) || {}, opts || {});
    syncing = true;
    try {
      remember(el, knownOpts.get(el) || (opts ? merged : null));
      const i = findEntry(el);
      if (i >= 0 && isVisible(el)) {
        const entry = stack.splice(i, 1)[0];
        entry.opts = merged;
        stack.push(entry);
        raiseZ(entry);
        emit('open', el, 'reopen');
        return el;
      }
      if (i >= 0) drop(i, 'sync');
      el.classList.remove('hidden');
      el.classList.add('flex');
      el.style.display = '';
      adopt(el, merged, true);
    } finally {
      syncing = false;
    }
    sync();
    return el;
  }

  function close(elOrId, reason) {
    const el = byId(elOrId);
    if (!el) return false;
    syncing = true;
    try {
      el.classList.add('hidden');
      el.classList.remove('flex');
      el.classList.remove('uk-enter');
      const i = findEntry(el);
      if (i >= 0) drop(i, reason || 'api');
    } finally {
      syncing = false;
    }
    sync();
    return true;
  }

  function requestClose(entry, reason) {
    if (entry.opts.dismissible === false) return false;
    if (typeof entry.opts.onRequestClose === 'function') {
      try { entry.opts.onRequestClose(reason); } catch (e) { setTimeout(function () { throw e; }, 0); }
      sync();
      return true;
    }
    close(entry.el, reason);
    return true;
  }

  function closeTop(o) {
    sync();
    const top = stack[stack.length - 1];
    if (!top) return false;
    if (o && o.force) { close(top.el, 'top'); return true; }
    return requestClose(top, 'top');
  }

  const sheet = Object.freeze({
    open: open,
    close: close,
    closeTop: closeTop,
    top: function () { sync(); const t = stack[stack.length - 1]; return t ? t.el : null; },
    isOpen: function (elOrId) { sync(); return isVisible(byId(elOrId)); },
    stack: function () { return sync(); },
    register: function (elOrId, opts) {
      const el = byId(elOrId);
      if (!el) return null;
      remember(el, Object.assign({}, opts || {}));
      sync();
      return el;
    },
    sync: sync,
    fitViewport: fitViewport,
    /** fn() → element (e.g. the current screen's heading): focus goes there when a sheet closes, its opener is gone and no
     *  single element replaces it (null removes it). */
    setFallbackFocus: function (fn) { fallbackFocus = typeof fn === 'function' ? fn : null; },
    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      sheetListeners.push(fn);
      return function () { const i = sheetListeners.indexOf(fn); if (i >= 0) sheetListeners.splice(i, 1); };
    }
  });

  function onKeydown(e) {
    if (e.key !== 'Escape' && e.key !== 'Esc' && e.key !== 'Tab') return;
    sync();
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Tab') {
      const list = focusables(top.el);
      if (!list.length) { e.preventDefault(); focusEl(initialFocus(top)); return; }
      const first = list[0];
      const last = list[list.length - 1];
      const a = doc.activeElement;
      if (!top.el.contains(a)) { e.preventDefault(); focusEl(e.shiftKey ? last : first); }
      else if (e.shiftKey && a === first) { e.preventDefault(); focusEl(last); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); focusEl(first); }
      return;
    }
    e.preventDefault();
    requestClose(top, 'escape');
  }
  function onFocusIn(e) {
    const top = stack[stack.length - 1];
    if (!top || !isVisible(top.el)) return;
    const t = e.target;
    if (t === global || t === doc || top.el.contains(t)) return;
    focusEl(initialFocus(top));
  }
  let downTarget = null;
  function onMouseDown(e) { downTarget = e.target; }
  function onClick(e) {
    const top = stack[stack.length - 1];
    if (!top || e.target !== top.el || downTarget !== top.el) return;
    if (!top.opts.backdrop) return;
    requestClose(top, 'backdrop');
  }
  function onImgError(e) {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-uk-avatar-img')) return;
    const src = t.getAttribute('src');
    if (src) brokenAvatarUrls.add(src);   // never tried again (no flicker, no repeated load errors) until a new URL is set
    if (t.parentNode) t.parentNode.removeChild(t);
  }

  /* ---------------------------------------------------------------- dialogs */
  function nativeDialogs() {
    const c = global.APP_CONFIG;
    return !!(c && c.NATIVE_DIALOGS);
  }

  let dialogSeq = 0;
  function buildDialog(kind, message, defaultValue, o) {
    return new Promise(function (resolve) {
      dialogSeq++;
      const id = 'uk-dlg-' + dialogSeq;
      const cancelValue = kind === 'confirm' ? false : kind === 'prompt' ? null : undefined;
      const titleText = o.title || (kind === 'confirm' ? 'ยืนยัน' : kind === 'prompt' ? 'กรอกข้อมูล' : 'แจ้งเตือน');
      const wrap = doc.createElement('div');
      wrap.className = cls.sheetWrap;
      wrap.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-labelledby', id + '-t');
      wrap.setAttribute('aria-describedby', id + '-m');
      wrap.setAttribute('data-uikit-dialog', kind);
      const okCls = cls.btn + ' ' + (o.danger ? cls.btnDanger : cls.btnPrimary) + ' flex-1';
      const det = o.detail && typeof o.detail === 'object' && o.detail.title ? o.detail : null;
      const maxLen = kind === 'prompt' && Number(o.maxLength) > 0 ? Math.floor(Number(o.maxLength)) : 0;
      const multi = kind === 'prompt' && !!o.multiline;
      const detTone = det && det.tone === 'ok' ? cls.dialogDetailOk : det && det.tone === 'danger' ? cls.dialogDetailDanger : cls.dialogDetail;
      const cancelBtn = kind === 'alert' ? '' :
        '<button type="button" class="' + cls.btn + ' ' + cls.btnSecondary + ' flex-1" data-uk-action="cancel">' +
        esc(o.cancelLabel || 'ยกเลิก') + '</button>';
      wrap.innerHTML =
        '<div class="' + cls.sheetPanel + ' uk-safe-b" data-sheet-panel>' +
          '<div class="' + cls.sheetGrabber + '" aria-hidden="true"></div>' +
          '<div class="' + cls.sheetBody + '">' +
            (o.icon && ICONS[o.icon] ? '<div class="' + (o.danger ? cls.dialogIconDanger : cls.dialogIcon) + '" data-uk-dialog-icon>' + icon(o.icon, 'w-7 h-7') + '</div>' : '') +
            '<h2 id="' + id + '-t" class="' + cls.sheetTitle + '"></h2>' +
            (det ? '<div class="' + detTone + '" data-uk-detail>' + (det.avatar ? avatar(String(det.avatar), 'md') : '') +
              '<div class="min-w-0 flex-1"><p class="' + cls.dialogDetailTitle + '">' + esc(det.title) + '</p>' +
              (det.text ? '<p class="' + cls.textMeta + '">' + esc(det.text) + '</p>' : '') + '</div></div>' : '') +
            '<p id="' + id + '-m" class="' + cls.sheetText + '"></p>' +
            (multi ? '<textarea data-uk-input rows="2" class="' + cls.input + '" autocomplete="off" enterkeyhint="enter"></textarea>'
              : kind === 'prompt' ? '<input data-uk-input class="' + cls.input + '" autocomplete="off">' : '') +
            (maxLen ? '<p class="' + cls.dialogCount + '" data-uk-count aria-live="off"></p>' : '') +
            (kind === 'prompt' && o.hint ? '<p id="' + id + '-h" class="' + cls.textCaption + '" data-uk-hint></p>' : '') +
          '</div>' +
          '<div class="' + cls.sheetFooter + '">' + cancelBtn +
            '<button type="button" class="' + okCls + '" data-uk-action="ok">' + esc(o.okLabel || 'ตกลง') + '</button>' +
          '</div>' +
        '</div>';
      wrap.querySelector('#' + id + '-t').textContent = titleText;
      wrap.querySelector('#' + id + '-m').textContent = message === null || message === undefined ? '' : String(message);
      const input = wrap.querySelector('[data-uk-input]');
      if (input) {
        if (!multi) input.type = o.inputType || 'text';
        if (o.placeholder) input.placeholder = String(o.placeholder);
        input.value = defaultValue === null || defaultValue === undefined ? '' : String(defaultValue);
        input.setAttribute('aria-labelledby', id + '-m');
        const hint = wrap.querySelector('[data-uk-hint]');
        if (hint) {
          hint.textContent = String(o.hint);
          input.setAttribute('aria-describedby', id + '-h');
        }
        if (maxLen) {
          // R1b FIX-CL CL-17: never longer than maxLen (an IME or a paste can push past maxlength: the text is cut, never
          // thrown away); the counter turns to the danger tone at the limit and is announced only near it (from 90 %)
          input.maxLength = maxLen;
          const count = wrap.querySelector('[data-uk-count]');
          let cut = false;
          // counted and cut by code points (an emoji is one character, never split into half a surrogate pair), and never
          // longer than maxLen UTF-16 units either (what a server's String.length limit counts)
          const fit = function (v) {
            const cps = Array.from(v);
            let out = '';
            for (let i = 0; i < cps.length && i < maxLen; i++) {
              if (out.length + cps[i].length > maxLen) break;
              out += cps[i];
            }
            return out;
          };
          input.value = fit(input.value);   // a longer default is cut quietly
          const upd = function () {
            const v = input.value;
            if (Array.from(v).length > maxLen || v.length > maxLen) {
              const f = fit(v);
              if (f !== v) { input.value = f; cut = true; }
            }
            const n = Array.from(input.value).length;
            const full = n >= maxLen || input.value.length >= maxLen;
            count.textContent = n + '/' + maxLen + (full && cut ? ' — ตัดให้เหลือ ' + maxLen + ' ตัวอักษรแล้ว' : full ? ' — ครบจำนวนแล้ว' : '');
            count.className = full ? cls.dialogCountDanger : cls.dialogCount;
            count.setAttribute('aria-live', n >= Math.floor(maxLen * 0.9) ? 'polite' : 'off');
            count.setAttribute('data-full', full ? '1' : '');
          };
          upd();
          input.addEventListener('input', upd);
        }
        if (multi) {
          // grows with its text (up to the CSS max-height, then it scrolls)
          const grow = function () { input.style.height = 'auto'; input.style.height = input.scrollHeight + 2 + 'px'; };
          input.addEventListener('input', grow);
          setTimeout(function () {
            grow();
            if (doc.activeElement === input) { try { input.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
          }, 0);
        }
      }
      if (o.data && typeof o.data === 'object') {
        Object.keys(o.data).forEach(function (k) {
          if (/^[a-z][A-Za-z0-9]*$/.test(k) && o.data[k] !== undefined && o.data[k] !== null) wrap.dataset[k] = String(o.data[k]);
        });
      }
      let settled = false;
      function settle(v) {
        if (settled) return;
        settled = true;
        resolve(v);
      }
      function finish(ok) {
        const v = ok ? (kind === 'confirm' ? true : kind === 'prompt' ? (input ? input.value : '') : undefined) : cancelValue;
        settle(v);
        close(wrap, ok ? 'ok' : 'cancel');
      }
      wrap.addEventListener('click', function (e) {
        const b = e.target && e.target.closest ? e.target.closest('[data-uk-action]') : null;
        if (b && wrap.contains(b)) finish(b.getAttribute('data-uk-action') === 'ok');
      });
      wrap.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.isComposing) return;
        // R1b FIX-CL CL-17: in a multi-line field Enter is a new line (Ctrl / ⌘ + Enter confirms)
        if (multi && e.target === input && !(e.ctrlKey || e.metaKey)) return;
        const b = e.target && e.target.closest ? e.target.closest('[data-uk-action]') : null;
        e.preventDefault();
        finish(b ? b.getAttribute('data-uk-action') === 'ok' : true);
      });
      (doc.body || doc.documentElement).appendChild(wrap);
      let focusTarget = input || wrap.querySelector('[data-uk-action="ok"]');
      if (o.danger && kind === 'confirm') focusTarget = wrap.querySelector('[data-uk-action="cancel"]');
      open(wrap, {
        backdrop: true,
        initialFocus: focusTarget,
        returnFocus: o.returnFocus,
        onRequestClose: function () { finish(false); },
        onClose: function () {
          settle(cancelValue);
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        }
      });
      if (input) {
        try { input.select(); } catch (e) { /* ignore */ }
        // R1b FIX-CL CL-17: on a short screen the field is scrolled into the dialog's visible part (the buttons are fixed below)
        try { input.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
      }
    });
  }

  /** Native dialogs cannot show opts.detail / opts.hint: the detail lines (and the title) go in front, the hint behind. */
  function nativeText(message, o) {
    const det = o && o.detail && typeof o.detail === 'object' && o.detail.title ? o.detail : null;
    const hint = o && (o.nativeHint || o.hint);
    if (hint) message = (message === null || message === undefined ? '' : String(message)) + ' (' + String(hint) + ')';
    if (!det) return message;
    const head = [o.title, det.title, det.text].filter(function (x) { return x !== undefined && x !== null && String(x) !== ''; });
    return head.join('\n') + '\n\n' + (message === null || message === undefined ? '' : String(message));
  }
  function confirmDialog(message, opts) {
    if (nativeDialogs()) {
      try { return Promise.resolve(!!global.confirm(nativeText(message, opts))); } catch (e) { return Promise.reject(e); }
    }
    return buildDialog('confirm', message, null, opts || {});
  }
  function promptDialog(message, defaultValue, opts) {
    if (nativeDialogs()) {
      try {
        const text = nativeText(message, opts);
        const r = defaultValue === undefined ? global.prompt(text) : global.prompt(text, defaultValue);
        return Promise.resolve(r === null || r === undefined ? null : String(r));
      } catch (e) { return Promise.reject(e); }
    }
    return buildDialog('prompt', message, defaultValue, opts || {});
  }
  function alertDialog(message, opts) {
    if (nativeDialogs()) {
      try { global.alert(message); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
    }
    return buildDialog('alert', message, null, opts || {}).then(function () { return undefined; });
  }

  /* ---------------------------------------------------------------- images */
  const IMG_MSG = {
    'no-file': 'ไม่พบไฟล์รูปภาพ กรุณาเลือกรูปอีกครั้ง',
    'not-image': 'ไฟล์นี้ไม่ใช่รูปภาพ กรุณาเลือกไฟล์รูป (JPG หรือ PNG)',
    'decode': 'เปิดรูปนี้ไม่ได้ ไฟล์อาจเสียหายหรือเป็นชนิดที่ไม่รองรับ กรุณาเลือกรูปอื่น',
    'too-large': 'ย่อรูปให้มีขนาดเล็กพอไม่ได้ กรุณาเลือกรูปอื่น',
    'unsupported': 'อุปกรณ์นี้ย่อรูปไม่ได้ กรุณาลองบนเบราว์เซอร์อื่น'
  };
  const OUT_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  function imgError(code) { const e = new Error(IMG_MSG[code]); e.code = code; return e; }

  function decodeImage(blob) {
    return new Promise(function (resolve, reject) {
      const URLo = global.URL;
      if (!URLo || typeof URLo.createObjectURL !== 'function') { reject(imgError('unsupported')); return; }
      const url = URLo.createObjectURL(blob);
      const img = new global.Image();
      img.onload = function () {
        URLo.revokeObjectURL(url);
        if (!img.naturalWidth || !img.naturalHeight) reject(imgError('decode')); else resolve(img);
      };
      img.onerror = function () { URLo.revokeObjectURL(url); reject(imgError('decode')); };
      img.src = url;
    });
  }

  /** The checks every image entry point makes before decoding: → an Error to reject with, or null. */
  function checkFile(file) {
    if (!file || typeof global.Blob !== 'function' || !(file instanceof global.Blob)) return imgError('no-file');
    if (file.type && !/^image\//i.test(file.type)) return imgError('not-image');
    if (/^image\/svg/i.test(file.type || '')) return imgError('not-image');
    if (!file.size) return imgError('decode');
    return null;
  }

  /**
   * The square region of a w × h source that compress keeps: opts.crop {x, y, size} (source pixels) validated and clamped
   * into the picture — size to 1 … min(w, h), x / y to 0 … w − size / h − size (a non-finite x or y centres that axis, a
   * missing / non-positive size takes the whole short side) — or, without crop, the centre square (o.square) / the whole
   * picture. → {sx, sy, sw, sh} in source pixels.
   */
  function cropRegion(w, h, o) {
    const c = o.crop;
    if (c && typeof c === 'object') {
      const short = Math.min(w, h);
      let size = Number(c.size);
      size = isFinite(size) && size > 0 ? Math.max(1, Math.min(short, size)) : short;
      let x = Number(c.x), y = Number(c.y);
      x = isFinite(x) ? Math.max(0, Math.min(w - size, x)) : (w - size) / 2;
      y = isFinite(y) ? Math.max(0, Math.min(h - size, y)) : (h - size) / 2;
      return { sx: x, sy: y, sw: size, sh: size };
    }
    if (o.square) {
      const s = Math.min(w, h);
      return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), sw: s, sh: s };
    }
    return { sx: 0, sy: 0, sw: w, sh: h };
  }

  /**
   * src: anything drawImage takes (the decoded <img>, or the working canvas of image.decode); w × h: the picture's size
   * in SOURCE pixels; k: src pixels per source pixel (1 for the <img>, the working copy's scale for its canvas).
   */
  function encodeLoop(src, w, h, k, o) {
    const r = cropRegion(w, h, o);
    // in the drawable's own pixels (the output never upscales beyond what the drawable holds)
    const sx = r.sx * k, sy = r.sy * k, sw = Math.max(1, r.sw * k), sh = Math.max(1, r.sh * k);
    const canvas = doc.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || typeof canvas.toDataURL !== 'function') throw imgError('unsupported');
    const lossy = o.mime !== 'image/png';
    const qualities = lossy ? [0.85, 0.75, 0.65, 0.55, 0.45] : [undefined];
    let scale = Math.min(1, o.maxSide / Math.max(sw, sh));
    for (let round = 0; round < 40; round++) {
      const W = Math.max(1, Math.round(sw * scale));
      const H = Math.max(1, Math.round(sh * scale));
      canvas.width = W;
      canvas.height = H;
      if (o.mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* ignore */ }
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
      for (let qi = 0; qi < qualities.length; qi++) {
        const url = qualities[qi] === undefined ? canvas.toDataURL(o.mime) : canvas.toDataURL(o.mime, qualities[qi]);
        const comma = url.indexOf(',');
        const head = url.slice(0, comma);
        const base64 = url.slice(comma + 1);
        if (base64.length <= o.maxChars) {
          const m = /^data:([^;,]+)/.exec(head);
          canvas.width = 0; canvas.height = 0;   // frees the bitmap at once (iOS counts canvas memory)
          return { base64: base64, mime: m ? m[1] : o.mime, width: W, height: H, chars: base64.length };
        }
        // the browser fell back to PNG (no lossy encoder) — quality steps are pointless
        if (head.indexOf(o.mime) < 0) break;
      }
      if (W <= 8 && H <= 8) break;
      scale *= 0.75;
    }
    canvas.width = 0; canvas.height = 0;
    throw imgError('too-large');
  }

  /** Pictures made by image.decode and not released yet (compress accepts them in place of a file). */
  const decodedLive = typeof global.WeakMap === 'function' ? new global.WeakMap() : null;

  /**
   * Decodes a picture ONCE and keeps a working copy of at most opts.maxSide (1600) px on its longest side in a canvas (a
   * 12-megapixel photo would otherwise stay in memory at full size while the user frames it). The browser applies the
   * EXIF orientation when it decodes (`image-orientation: from-image`, the default of every current browser), so width /
   * height are the upright size. → {width, height, canvas, scale, release()}.
   */
  function decode(file, opts) {
    const o = Object.assign({ maxSide: 1600 }, opts || {});
    const maxSide = Math.max(1, Math.floor(Number(o.maxSide) || 1600));
    const bad = checkFile(file);
    if (bad) return Promise.reject(bad);
    return decodeImage(file).then(function (img) {
      const w = img.naturalWidth, h = img.naturalHeight;
      const k = Math.min(1, maxSide / Math.max(w, h));
      const canvas = doc.createElement('canvas');
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) throw imgError('unsupported');
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* ignore */ }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try { img.removeAttribute('src'); } catch (e) { /* ignore */ }
      let live = true;
      const out = Object.freeze({
        width: w,
        height: h,
        canvas: canvas,
        scale: canvas.width / w,
        release: function () {
          if (!live) return;
          live = false;
          if (decodedLive) decodedLive.delete(out);
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
          canvas.width = 0; canvas.height = 0;
        }
      });
      if (decodedLive) decodedLive.set(out, true);
      return out;
    });
  }

  function compress(file, opts) {
    const o = Object.assign({ maxSide: 1280, maxChars: 300000, mime: 'image/jpeg', square: false }, opts || {});
    o.maxSide = Math.max(1, Math.floor(Number(o.maxSide) || 1280));
    o.maxChars = Math.max(1, Math.floor(Number(o.maxChars) || 300000));
    if (OUT_MIMES.indexOf(o.mime) < 0) o.mime = 'image/jpeg';
    if (decodedLive && file && typeof file === 'object' && decodedLive.has(file)) {
      try { return Promise.resolve(encodeLoop(file.canvas, file.width, file.height, file.scale, o)); } catch (e) { return Promise.reject(e); }
    }
    const bad = checkFile(file);
    if (bad) return Promise.reject(bad);
    return decodeImage(file).then(function (img) { return encodeLoop(img, img.naturalWidth, img.naturalHeight, 1, o); });
  }

  /** Only image types make blob: URLs (R1a fix B-8): a text/html blob would run script in the app's origin if opened. */
  const OBJECT_URL_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  function toObjectUrl(base64, mime) {
    let b = String(base64 || '');
    let m = mime;
    const dm = /^data:([^;,]+)?(;base64)?,/.exec(b);
    if (dm) { if (!m && dm[1]) m = dm[1]; b = b.slice(dm[0].length); }
    m = String(m || '').trim().toLowerCase();
    if (OBJECT_URL_TYPES.indexOf(m) < 0) throw imgError('not-image');
    const bin = global.atob(b.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return global.URL.createObjectURL(new global.Blob([bytes], { type: m }));
  }

  /**
   * The pixel size of a JPEG from its frame header: walks the marker segments after SOI (FF D8) up to the first SOFn
   * (C0–CF except C4 DHT, C8 JPG, CC DAC). → {width, height} or null (not a JPEG, a truncated/garbled header, zero size).
   */
  function jpegSize(base64) {
    let s = String(base64 || '');
    const dm = /^data:[^,]*,/.exec(s);
    if (dm) s = s.slice(dm[0].length);
    let bin;
    try { bin = global.atob(s.replace(/\s+/g, '')); } catch (e) { return null; }
    const at = i => bin.charCodeAt(i) & 0xFF;
    if (bin.length < 4 || at(0) !== 0xFF || at(1) !== 0xD8) return null;
    let i = 2;
    for (let guard = 0; guard < 4096 && i + 3 < bin.length; guard++) {
      if (at(i) !== 0xFF) return null;
      let m = at(i + 1);
      while (m === 0xFF && i + 2 < bin.length) { i++; m = at(i + 1); }   // fill bytes
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }   // markers without a length
      if (m === 0xD9 || m === 0xDA) return null;                                        // end / scan before any frame header
      const len = (at(i + 2) << 8) | at(i + 3);
      if (len < 2) return null;
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        if (i + 8 >= bin.length || len < 7) return null;
        const height = (at(i + 5) << 8) | at(i + 6);
        const width = (at(i + 7) << 8) | at(i + 8);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      i += 2 + len;
    }
    return null;
  }

  /* ---------------------------------------------------------------- wiring */
  if (doc) {
    injectStyle();
    doc.addEventListener('keydown', onKeydown);
    doc.addEventListener('focusin', onFocusIn);
    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('click', onClick);
    doc.addEventListener('error', onImgError, true);
  }

  global.UiKit = Object.freeze({
    version: '1.6.0',
    cls: cls,
    esc: esc,
    injectStyle: injectStyle,
    iconNames: iconNames,
    injectSprite: injectSprite,
    icon: icon,
    decoNames: decoNames,
    deco: deco,
    initials: initials,
    avatarTone: avatarTone,
    avatar: avatar,
    avatars: avatars,
    pill: pill,
    badge: badge,
    skeleton: skeleton,
    empty: empty,
    sheet: sheet,
    confirm: confirmDialog,
    prompt: promptDialog,
    alert: alertDialog,
    image: Object.freeze({ compress: compress, decode: decode, toObjectUrl: toObjectUrl, jpegSize: jpegSize })
  });
})(window);
