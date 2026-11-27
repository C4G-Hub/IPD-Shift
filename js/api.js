/* =====================================================================
 * js/api.js — HTTP client for the Apps Script Web App → window.Api
 *
 *  Api.configure(url)        set the Web App URL
 *  Api.setToken(token|null)  session token sent with every request
 *  Api.call(action, params, opts) → Promise<data>   (throws ApiError)
 *      opts.timeoutMs        per attempt (default: reads 40 s, writes 45 s)
 *      opts.attempts         at most this many attempts (default: reads 2, writes 3)
 *      opts.onRetry(n)       called before attempt n (2, 3) when a transient failure is retried
 *      opts.requestId        R3 (I2): the caller's own requestId ([A-Za-z0-9_-]{16,64}, e.g. from Api.newId()) — keep
 *                            it to send the SAME write again later (a new call after the first one failed): the server
 *                            replays a write by requestId (Code.gs REPLAY_SECONDS_ = 600 s), so it runs once. Anything
 *                            else (missing, too short, other characters) → a fresh id, as without the option
 *  Api.isTransient(err)      NETWORK, BAD_RESPONSE, GOOGLE_ERROR or BUSY — worth trying again later
 *  Api.newId()               R3: a fresh 22-character [A-Za-z0-9_-] id (CSPRNG) — a photo's fileId, a chat message's cid
 *  Api.onAuthError = fn      invoked (before the throw) on a session error — AUTH_REQUIRED or
 *                            PASSWORD_CHANGE_REQUIRED — of a request sent with the CURRENT token
 *  Api.onStatus(fn)          connectivity: {type:'success'} the server answered (also with a refusal such as
 *                            VALIDATION), {type:'retrying', code} an attempt failed transiently and is retried,
 *                            {type:'failed', code} a call finally failed transiently
 *  Api.inflight / Api.onActivity(fn(count))  in-flight request tracking
 *  Api.serverVersionOk       null before the first answer; false while answers lack the action/requestId echo
 *                            (Code.gs older than 2.1.0)
 *
 * Transport: POST with Content-Type text/plain (a "simple" CORS request, so
 * no preflight — Apps Script cannot answer OPTIONS). window.fetch is looked
 * up at call time so tests can replace it.
 *
 * Every call has one requestId that all its attempts share: the server runs a write once per requestId, so
 * retrying a write whose answer was lost is safe (R3: a caller may pass its own requestId to extend this to a later
 * call that sends the same write again — opts.requestId). Google sometimes answers a POST with the GET /exec page
 * (the ping envelope) or with an HTML error page; both are recognised and retried, never taken as the answer.
 * ===================================================================== */
(function (global) {
  'use strict';

  const CLIENT_VERSION = '3.2.0';
  const MSG_NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต';
  const MSG_BAD_DEPLOYMENT = 'การตั้งค่า Web App ไม่ถูกต้อง (ต้องตั้งค่า Who has access เป็น Anyone)';
  const MSG_BAD_RESPONSE = 'เซิร์ฟเวอร์ตอบกลับผิดพลาดชั่วคราว';
  const MSG_GOOGLE_ERROR = 'เซิร์ฟเวอร์ Google ขัดข้องชั่วคราว';
  const MSG_NOT_CONFIGURED = 'ยังไม่ได้ตั้งค่า URL ของ Web App';
  const READ_ACTIONS = ['ping', 'listUsers', 'me', 'getData', 'getAudit', 'getMyPassword', 'getAvatars', 'getPlan',
    'getProblems', 'getFile', 'getChat'];   // R3 reads (R3-SPEC §4.1)
  const SESSION_ERRORS = ['AUTH_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'];
  const TRANSIENT = ['NETWORK', 'BAD_RESPONSE', 'GOOGLE_ERROR', 'BUSY'];
  const READ_POLICY = { timeoutMs: 40000, waits: [1500] };           // 2 attempts
  const WRITE_POLICY = { timeoutMs: 45000, waits: [2000, 5000] };    // 3 attempts (the server dedupes by requestId)
  /** A non-JSON answer is either Google's sign-in/access page (deployment not shared with "Anyone") or an error page. */
  const SIGN_IN_PAGE = /accounts\.google\.com|ServiceLogin|<title>[^<]*(?:Google Accounts|Sign in)/i;
  const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const ID_LENGTH = 22;
  const CALLER_ID = /^[A-Za-z0-9_-]{16,64}$/;   // opts.requestId (the server accepts 8–64; ours are ≥ 16)

  class ApiError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.message = message;
      if (details !== undefined) this.details = details;
    }
  }

  const activityListeners = [];
  const statusListeners = [];

  const Api = {
    url: '',
    token: null,
    inflight: 0,
    onAuthError: null,
    lastServerTime: null,
    serverVersionOk: null,
    clientVersion: CLIENT_VERSION,
    ApiError,

    configure(url) { this.url = String(url || '').trim(); },
    setToken(token) { this.token = token || null; },

    /** Subscribe to in-flight count changes. Returns an unsubscribe function. */
    onActivity(fn) { return subscribe_(activityListeners, fn); },
    /** Subscribe to connectivity events (see the header). Returns an unsubscribe function. */
    onStatus(fn) { return subscribe_(statusListeners, fn); },
    isTransient(err) { return !!err && TRANSIENT.indexOf(err.code) >= 0; },
    /** R3: a new 22-character id of [A-Za-z0-9_-] from the browser's CSPRNG (the requestId generator) — for a photo's
     *  fileId and a chat message's cid, which the server uses to make a retried write idempotent. */
    newId() { return newRequestId_(); },

    /**
     * Call a server action; transient failures are retried (reads: 2 attempts, 1.5 s apart; writes: 3 attempts,
     * waiting 2 s then 5 s). The in-flight counter is incremented synchronously (before the first await).
     */
    async call(action, params, opts) {
      opts = opts || {};
      const policy = READ_ACTIONS.indexOf(action) >= 0 ? READ_POLICY : WRITE_POLICY;
      const waits = policy.waits.slice(0, Math.max(0, (opts.attempts || Infinity) - 1));
      const timeoutMs = opts.timeoutMs || policy.timeoutMs;
      const token = Api.token;
      const requestId = typeof opts.requestId === 'string' && CALLER_ID.test(opts.requestId) ? opts.requestId : newRequestId_();
      bump_(1);
      try {
        for (let attempt = 1; ; attempt++) {
          const outcome = await attempt_(action, params || {}, token, requestId, timeoutMs);
          if (outcome.ok) {
            notify_(statusListeners, { type: 'success' });
            return outcome.data;
          }
          const err = outcome.error;
          if (!Api.isTransient(err)) {
            if (outcome.answered) notify_(statusListeners, { type: 'success' });   // reachable, it just said no
            // A reply to a token that has since been replaced (password change, new login) says nothing
            // about the current session, so it must not log the user out.
            if (SESSION_ERRORS.indexOf(err.code) >= 0 && token === Api.token && typeof Api.onAuthError === 'function') {
              try { Api.onAuthError(err); } catch (hookErr) { console.error(hookErr); }
            }
            throw err;
          }
          if (attempt > waits.length) {
            notify_(statusListeners, { type: 'failed', code: err.code });
            throw err;
          }
          notify_(statusListeners, { type: 'retrying', code: err.code });
          if (typeof opts.onRetry === 'function') {
            try { opts.onRetry(attempt + 1); } catch (hookErr) { console.error(hookErr); }
          }
          await sleep_(waits[attempt - 1]);
        }
      } finally {
        bump_(-1);
      }
    }
  };

  function subscribe_(list, fn) {
    if (typeof fn !== 'function') return () => {};
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }

  function notify_(list, value) {
    list.slice().forEach(fn => { try { fn(value); } catch (e) { console.error(e); } });
  }

  function bump_(delta) {
    Api.inflight = Math.max(0, Api.inflight + delta);
    notify_(activityListeners, Api.inflight);
  }

  function sleep_(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** ≥ 16 characters of [A-Za-z0-9_-] from the browser's CSPRNG (the server accepts /^[A-Za-z0-9_-]{8,64}$/). */
  function newRequestId_() {
    const bytes = new Uint8Array(ID_LENGTH);
    global.crypto.getRandomValues(bytes);
    let id = '';
    bytes.forEach(b => { id += ID_CHARS[b & 63]; });
    return id;
  }

  /** One round trip → {ok:true, data} | {ok:false, error, answered} (answered: the server itself refused). */
  async function attempt_(action, params, token, requestId, timeoutMs) {
    let env;
    try {
      env = await send_(action, params, token, requestId, timeoutMs);
    } catch (e) {
      return { ok: false, error: e, answered: false };
    }
    if (env.ok) return { ok: true, data: env.data === undefined ? {} : env.data };
    const err = env.error || {};
    return { ok: false, answered: true, error: new ApiError(err.code || 'SERVER_ERROR', err.message || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์', err.details) };
  }

  /** POSTs the request and returns the server's envelope; transport-level problems throw an ApiError. */
  async function send_(action, params, token, requestId, timeoutMs) {
    if (!Api.url) throw new ApiError('NOT_CONFIGURED', MSG_NOT_CONFIGURED);
    const payload = Object.assign({}, params, { action: action, requestId: requestId, clientVersion: CLIENT_VERSION });
    if (token) payload.token = token;
    else delete payload.token;

    const text = await fetchText_(JSON.stringify(payload), timeoutMs);
    let env = null;
    try { env = JSON.parse(text); } catch (e) { /* not JSON: see below */ }
    if (!env || typeof env !== 'object' || typeof env.ok !== 'boolean') {
      throw SIGN_IN_PAGE.test(text)
        ? new ApiError('BAD_DEPLOYMENT', MSG_BAD_DEPLOYMENT)
        : new ApiError('GOOGLE_ERROR', MSG_GOOGLE_ERROR);
    }
    if (isBounce_(env, action, requestId)) throw new ApiError('BAD_RESPONSE', MSG_BAD_RESPONSE);
    Api.serverVersionOk = typeof env.action === 'string';
    if (env.serverTime) Api.lastServerTime = env.serverTime;
    return env;
  }

  /**
   * The answer belongs to another request: the echoed action / requestId differ from ours. A server older
   * than 2.1.0 echoes nothing, but its GET /exec page is still recognisable: ping data ({version, timeZone})
   * answering an action that is not ping.
   */
  function isBounce_(env, action, requestId) {
    if (typeof env.action === 'string' && env.action !== action) return true;
    if (typeof env.requestId === 'string' && env.requestId !== requestId) return true;
    const d = env.data;
    return action !== 'ping' && typeof env.action !== 'string' && !!d && typeof d.timeZone === 'string' && typeof d.version === 'string';
  }

  async function fetchText_(body, timeoutMs) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
        reject(new ApiError('NETWORK', MSG_NETWORK, { reason: 'timeout' }));
      }, timeoutMs);
    });
    try {
      const request = global.fetch(Api.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      }).then(res => res.text());
      return await Promise.race([request, timeout]);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK', MSG_NETWORK, { reason: String((e && e.message) || e) });
    } finally {
      clearTimeout(timer);
    }
  }

  global.ApiError = ApiError;
  global.Api = Api;
})(window);
