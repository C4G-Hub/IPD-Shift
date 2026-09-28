/* =====================================================================
 * js/api.js — HTTP client for the Apps Script Web App → window.Api
 *
 *  Api.configure(url)        set the Web App URL
 *  Api.setToken(token|null)  session token sent with every request
 *  Api.call(action, params, {timeoutMs}) → Promise<data>   (throws ApiError)
 *  Api.onAuthError = fn      invoked (before the throw) on a session error — AUTH_REQUIRED or
 *                            PASSWORD_CHANGE_REQUIRED — of a request sent with the CURRENT token
 *  Api.inflight / Api.onActivity(fn(count))  in-flight request tracking
 *
 * Transport: POST with Content-Type text/plain (a "simple" CORS request, so
 * no preflight — Apps Script cannot answer OPTIONS). window.fetch is looked
 * up at call time so tests can replace it.
 * ===================================================================== */
(function (global) {
  'use strict';

  const MSG_NETWORK = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต';
  const MSG_BAD_DEPLOYMENT = 'การตั้งค่า Web App ไม่ถูกต้อง (ต้องตั้งค่า Who has access เป็น Anyone)';
  const MSG_NOT_CONFIGURED = 'ยังไม่ได้ตั้งค่า URL ของ Web App';
  const READ_ACTIONS = ['ping', 'listUsers', 'me', 'getData', 'getAudit'];
  const SESSION_ERRORS = ['AUTH_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'];
  const RETRY_DELAY_MS = 800;

  class ApiError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
      this.message = message;
      if (details !== undefined) this.details = details;
    }
  }

  const listeners = [];

  const Api = {
    url: '',
    token: null,
    inflight: 0,
    onAuthError: null,
    lastServerTime: null,
    ApiError,

    configure(url) { this.url = String(url || '').trim(); },
    setToken(token) { this.token = token || null; },

    /** Subscribe to in-flight count changes. Returns an unsubscribe function. */
    onActivity(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },

    /**
     * Call a server action. Reads retry once after a NETWORK error; writes never auto-retry.
     * The in-flight counter is incremented synchronously (before the first await).
     */
    async call(action, params, opts) {
      const timeoutMs = (opts && opts.timeoutMs) || 25000;
      const isRead = READ_ACTIONS.indexOf(action) >= 0;
      const token = Api.token;
      bump_(1);
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            return await once_(action, params || {}, token, timeoutMs);
          } catch (e) {
            if (isRead && attempt === 0 && e && e.code === 'NETWORK') { await sleep_(RETRY_DELAY_MS); continue; }
            // A reply to a token that has since been replaced (password change, new login) says nothing
            // about the current session, so it must not log the user out.
            if (e && SESSION_ERRORS.indexOf(e.code) >= 0 && token === Api.token && typeof Api.onAuthError === 'function') {
              try { Api.onAuthError(e); } catch (hookErr) { console.error(hookErr); }
            }
            throw e;
          }
        }
      } finally {
        bump_(-1);
      }
    }
  };

  function bump_(delta) {
    Api.inflight = Math.max(0, Api.inflight + delta);
    listeners.slice().forEach(fn => { try { fn(Api.inflight); } catch (e) { console.error(e); } });
  }

  function sleep_(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function once_(action, params, token, timeoutMs) {
    if (!Api.url) throw new ApiError('NOT_CONFIGURED', MSG_NOT_CONFIGURED);

    const payload = Object.assign({}, params, { action: action });
    if (token) payload.token = token;
    else delete payload.token;

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
        reject(new ApiError('NETWORK', MSG_NETWORK, { reason: 'timeout' }));
      }, timeoutMs);
    });

    let text;
    try {
      const request = global.fetch(Api.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      }).then(res => res.text());
      text = await Promise.race([request, timeout]);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK', MSG_NETWORK, { reason: String((e && e.message) || e) });
    } finally {
      clearTimeout(timer);
    }

    let env;
    try { env = JSON.parse(text); } catch (e) { env = null; }
    if (!env || typeof env !== 'object' || typeof env.ok !== 'boolean') {
      throw new ApiError('BAD_DEPLOYMENT', MSG_BAD_DEPLOYMENT);
    }
    if (env.serverTime) Api.lastServerTime = env.serverTime;
    if (env.ok) return env.data === undefined ? {} : env.data;

    const err = env.error || {};
    throw new ApiError(err.code || 'SERVER_ERROR', err.message || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์', err.details);
  }

  global.ApiError = ApiError;
  global.Api = Api;
})(window);
