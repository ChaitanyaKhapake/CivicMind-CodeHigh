/* CivicMind citizen app — sign-in / registration (citizen accounts only) and server address. */
const $ = (id) => document.getElementById(id);
const SERVER_KEY = 'cm_api_base';

function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }
function setTab(register) {
  $('loginForm').hidden = register; $('registerForm').hidden = !register;
  $('tabLogin').classList.toggle('active', !register); $('tabRegister').classList.toggle('active', register);
  $('tabLogin').setAttribute('aria-selected', String(!register)); $('tabRegister').setAttribute('aria-selected', String(register));
}
$('tabLogin').addEventListener('click', () => setTab(false));
$('tabRegister').addEventListener('click', () => setTab(true));

const getServer = () => { try { return localStorage.getItem(SERVER_KEY) || ''; } catch { return ''; } };
function normalise(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  const withScheme = /^https?:\/\//i.test(u) ? u : 'http://' + u;
  try { const p = new URL(withScheme); return p.origin + p.pathname.replace(/\/+$/, ''); } catch { return null; }
}

async function testServer(base, quiet) {
  const status = $('serverStatus');
  if (!quiet) status.textContent = 'Connecting…';
  try {
    const res = await fetch(base + '/api/health', { cache: 'no-store' });
    const h = await res.json();
    if (!res.ok || h.status !== 'ok') throw new Error();
    status.textContent = `✓ Connected to CivicMind (${h.city || 'city'}).`;
    status.className = 'tiny text-green';
    loadWards();
    return true;
  } catch {
    status.textContent = '✗ Could not reach a CivicMind server at this address. Check the address, the Wi-Fi network, and that the server is running.';
    status.className = 'tiny text-red';
    return false;
  }
}

function showServer() {
  const s = getServer();
  $('serverLabel').textContent = s ? s.replace(/^https?:\/\//, '') : 'not set';
  $('serverUrl').value = s || (window.CM_APP && CM_APP.defaultServer) || '';
  if (!s) $('serverBox').open = true;
}

$('serverForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = normalise($('serverUrl').value);
  if (!base) { $('serverStatus').textContent = 'Enter an address such as https://civicmind.example.org'; return; }
  try { localStorage.setItem(SERVER_KEY, base); } catch { /* ignore */ }
  showServer();
  if (await testServer(base)) $('serverBox').open = false;
});

function needServer(errEl) {
  if (getServer()) return false;
  $('serverBox').open = true;
  showError(errEl, 'Set the CivicMind server address first (below).');
  return true;
}

function enterApp(d) {
  if (!d.user || d.user.role !== 'citizen') {          // the app is the citizen portal only
    CM.clearSession(); $('roleNote').hidden = false; return;
  }
  CM.setSession(d.token, d.user);
  location.href = 'citizen.html';
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim(), password = $('password').value;
  showError($('loginError'), ''); $('roleNote').hidden = true;
  if (needServer($('loginError'))) return;
  if (!email || !password) return showError($('loginError'), 'Enter your email and password.');
  await CM.busy($('loginBtn'), 'Signing in…', async () => {
    try { enterApp(await CM.api('/api/auth/login', { method: 'POST', body: { email, password } })); }
    catch (err) { showError($('loginError'), err.status === 0 ? 'Cannot reach the server. Check your connection and the server address.' : err.message); }
  });
});

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { name: $('rName').value.trim(), email: $('rEmail').value.trim(), password: $('rPass').value, ward: $('rWard').value || null };
  showError($('registerError'), '');
  if (needServer($('registerError'))) return;
  if (body.name.length < 2) return showError($('registerError'), 'Please enter your name.');
  if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(body.email)) return showError($('registerError'), 'Enter a valid email address.');
  if (body.password.length < 8) return showError($('registerError'), 'Password must be at least 8 characters.');
  await CM.busy($('registerBtn'), 'Creating account…', async () => {
    try { enterApp(await CM.api('/api/auth/register', { method: 'POST', body })); }
    catch (err) { showError($('registerError'), err.status === 0 ? 'Cannot reach the server. Check your connection and the server address.' : err.message); }
  });
});

let wardsLoaded = false;
async function loadWards() {
  if (wardsLoaded) return;
  try {
    const c = await CM.api('/api/config');
    (c.wards || []).forEach(w => { const o = document.createElement('option'); o.value = w.ward; o.textContent = w.ward; $('rWard').appendChild(o); });
    wardsLoaded = true;
  } catch { /* optional field */ }
}

(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('expired')) $('expiredNote').hidden = false;
  if (q.get('role')) $('roleNote').hidden = false;
  showServer();
  const base = getServer();
  if (!base) return;
  if (!(await testServer(base, true))) { $('serverBox').open = true; return; }
  const u = CM.getUser();                       // an existing valid citizen session goes straight in
  if (u && CM.getToken()) {
    try {
      const me = await CM.api('/api/auth/me');
      if (me.role === 'citizen') location.href = 'citizen.html'; else { CM.clearSession(); $('roleNote').hidden = false; }
    } catch { CM.clearSession(); }
  }
})();
