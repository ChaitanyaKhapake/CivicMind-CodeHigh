/* CivicMind — landing + auth logic (no hardcoded accounts or role tabs) */

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const d = await CM.api('/api/auth/login', { method: 'POST', body: {
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    }});
    CM.setSession(d.token, d.user);
    CM.toast(`Welcome, ${d.user.name.split(' ')[0]}`, 'ok');
    setTimeout(() => location.href = d.home, 400);
  } catch (err) {
    CM.toast(err.message, 'err');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

document.getElementById('showRegister').onclick = (e) => {
  e.preventDefault();
  const f = document.getElementById('registerForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
};

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const d = await CM.api('/api/auth/register', { method: 'POST', body: {
      name: document.getElementById('rName').value,
      email: document.getElementById('rEmail').value,
      password: document.getElementById('rPass').value,
      ward: document.getElementById('rWard').value || null,
    }});
    CM.setSession(d.token, d.user);
    CM.toast('Account created', 'ok');
    setTimeout(() => location.href = d.home, 400);
  } catch (err) { CM.toast(err.message, 'err'); }
});

(async () => {
  // Live stats (all from the API — nothing hardcoded in the page)
  try {
    const h = await CM.api('/api/health');
    document.getElementById('sComplaints').textContent = CM.num(h.complaints);
    document.getElementById('sIncidents').textContent = CM.num(h.incidents);
    document.getElementById('sAI').textContent = h.ai_enabled ? 'Sarvam AI' : 'Rules';
  } catch {}
  try {
    const c = await CM.api('/api/config');
    document.getElementById('sCats').textContent = c.categories.length;
  } catch {}

  // Demo credentials — rendered only if enabled in the config file.
  // Clicking a chip FILLS the form (it does not auto-submit).
  try {
    const d = await CM.api('/api/demo-credentials');
    if (d.enabled && d.accounts.length) {
      const box = document.getElementById('demoBox');
      const fill = document.getElementById('demoFill');
      box.style.display = 'block';
      d.accounts.forEach(a => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = a.role.charAt(0).toUpperCase() + a.role.slice(1);
        chip.title = `Fill ${a.email}`;
        chip.onclick = () => {
          document.getElementById('email').value = a.email;
          document.getElementById('password').value = a.password;
          CM.toast(`${a.role} credentials filled — press Sign in`, 'ok');
        };
        fill.appendChild(chip);
      });
    }
  } catch {}

  // If a VALID session already exists, go straight to the right dashboard.
  // We verify the token with the server first so a stale/expired session
  // can never bounce the user in a redirect loop.
  const u = CM.getUser();
  if (u && CM.getToken()) {
    try {
      await CM.api('/api/auth/me');
      location.href = CM.homeFor(u.role);
    } catch { CM.clearSession(); }
  }
})();
