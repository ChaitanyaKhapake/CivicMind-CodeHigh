/* ============================================================
   CivicMind — shared client library
   API wrapper, auth/session, toasts and formatting helpers.
   ============================================================ */
const CM = (() => {
  const TOKEN_KEY = 'cm_token';
  const USER_KEY  = 'cm_user';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const getUser  = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
  const setSession = (token, user) => { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); };
  const clearSession = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };

  async function api(path, { method = 'GET', body, raw = false } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const url = path.startsWith('http') ? path : path.replace(/^\/+/, '');
    const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      let msg = 'Request failed';
      if (data && data.detail !== undefined) {
        if (typeof data.detail === 'string') msg = data.detail;
        else if (data.detail && data.detail.message) msg = data.detail.message;
        else msg = JSON.stringify(data.detail);
      } else if (typeof data === 'string') msg = data;
      if (res.status === 401 && !path.includes('/auth/login')) { clearSession(); location.href = 'index.html'; }
      const err = new Error(msg);
      err.status = res.status;
      err.detail = (data && data.detail) || null;
      throw err;
    }
    return data;
  }

  /* ---------- toast ---------- */
  function toast(msg, type = '') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = '.3s'; }, 3200);
    setTimeout(() => el.remove(), 3600);
  }

  /* ---------- auth guards ---------- */
  function requireAuth(roles) {
    const u = getUser();
    if (!u || !getToken()) { location.href = 'index.html'; return null; }
    if (roles && roles.length && !roles.includes(u.role)) { location.href = homeFor(u.role); return null; }
    return u;
  }
  const homeFor = (role) => ({ citizen: 'citizen.html', officer: 'dashboard.html', admin: 'admin.html' }[role] || 'index.html');

  async function logout() { clearSession(); location.href = 'index.html'; }

  /* ---------- formatting ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const pClass = (label) => ({ Critical:'critical', High:'high', Medium:'medium', Low:'low' }[label] || '');
  const sClass = (s) => ({ active:'active', resolved:'resolved', in_progress:'in_progress', reopened:'reopened', pending:'pending', approved:'approved', completed:'completed', clustered:'active', submitted:'pending' }[s] || '');
  const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const num = (n) => (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-IN');

  function timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z'));
    const s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return ts;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z'));
    return isNaN(d) ? ts : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  return { api, getToken, getUser, setSession, clearSession, toast, requireAuth, homeFor, logout,
           esc, pClass, sClass, titleCase, num, timeAgo, fmtDate };
})();

/* ---- friendly notice if the HTML is opened directly (file://) ---- */
if (location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#D9342B;color:#fff;' +
      'padding:12px 16px;font:600 14px/1.4 system-ui,sans-serif;text-align:center';
    b.innerHTML = 'CivicMind is a client&ndash;server app and must be opened through its server. ' +
      'Run <b>python -m uvicorn main:app --port 8000</b> inside the backend folder, ' +
      'then visit <b>http://localhost:8000</b>.';
    document.body.appendChild(b);
  });
}
