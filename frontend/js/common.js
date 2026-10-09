/* ============================================================
   CivicMind — shared shell: navbar, live notification bell.
   ============================================================ */
const NAV_LINKS = {
  citizen: [['citizen.html','Report & Track'], ['map.html','Live Map']],
  officer: [['dashboard.html','Dashboard'], ['map.html','Live Map']],
  admin:   [['admin.html','Admin'], ['dashboard.html','Dashboard'], ['map.html','Live Map']],
};

function renderNav(active, user) {
  const links = (NAV_LINKS[user.role] || []).map(([href, label]) => {
    const cls = (href === active) ? 'active' : '';
    return `<a class="${cls}" href="${href}">${label}</a>`;
  }).join('');
  const initials = (user.name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const html = `
    <div class="wrap nav-inner">
      <a class="brand" href="${CM.homeFor(user.role)}">
        <img src="assets/logo.svg" alt="CivicMind"/> Civic<span style="color:var(--orange)">Mind</span>
      </a>
      <nav class="nav-links">${links}</nav>
      <div class="nav-right">
        <button class="btn ghost bell" id="bellBtn" title="Notifications" onclick="openBell()">
          🔔<span class="dot" id="bellDot" style="display:none">0</span>
        </button>
        <div class="user-chip">
          <div class="avatar">${initials}</div>
          <div style="line-height:1.15">
            <div style="font-weight:700;font-size:.82rem">${CM.esc(user.name)}</div>
            <div class="tiny muted" style="text-transform:capitalize">${user.role}</div>
          </div>
        </div>
        <button class="btn sm ghost" onclick="CM.logout()">Logout</button>
      </div>
    </div>`;
  const nav = document.getElementById('nav');
  if (nav) nav.innerHTML = html;
  startBell(user);
}

/* ---------- notifications bell ---------- */
let _bellTimer = null;
async function refreshBell() {
  try {
    const d = await CM.api('/api/notifications?unread=1');
    const dot = document.getElementById('bellDot');
    if (dot) { dot.style.display = d.unread ? 'grid' : 'none'; dot.textContent = d.unread > 9 ? '9+' : d.unread; }
  } catch (e) { /* silent */ }
}
function startBell(user) { refreshBell(); _bellTimer = setInterval(refreshBell, 15000); }

async function openBell() {
  try {
    const d = await CM.api('/api/notifications');
    let panel = document.getElementById('bellPanel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'bellPanel';
    panel.className = 'card';
    panel.style.cssText = 'position:fixed;top:74px;right:22px;width:360px;max-height:70vh;overflow:auto;z-index:120;box-shadow:var(--shadow-lg)';
    const items = d.items.length ? d.items.map(n => `
      <div class="list-item" style="cursor:default">
        <div class="li-icon">${({incident:'⚠️',resolved:'✅',approved:'👍',in_progress:'🔧',info:'📩'})[n.type]||'📩'}</div>
        <div class="grow">
          <div style="font-weight:700;font-size:.86rem">${CM.esc(n.title)}</div>
          <div class="small muted">${CM.esc(n.message||'')}</div>
          <div class="tiny muted" style="margin-top:4px">${CM.timeAgo(n.created_at)}</div>
        </div>
      </div>`).join('') : '<div class="empty">No notifications yet.</div>';
    panel.innerHTML = `<div class="card-h"><h3>Notifications</h3>
        <button class="btn sm ghost" onclick="markAllRead()">Mark all read</button></div>
        <div class="list">${items}</div>`;
    document.body.appendChild(panel);
    setTimeout(() => document.addEventListener('click', _closeBellOnce), 50);
  } catch (e) { CM.toast(e.message, 'err'); }
}
function _closeBellOnce(ev) {
  const p = document.getElementById('bellPanel');
  if (p && !p.contains(ev.target) && ev.target.id !== 'bellBtn' && !ev.target.closest('#bellBtn')) {
    p.remove(); document.removeEventListener('click', _closeBellOnce);
  }
}
async function markAllRead() {
  await CM.api('/api/notifications/read', { method: 'POST' });
  CM.toast('All marked as read', 'ok'); refreshBell();
  const p = document.getElementById('bellPanel'); if (p) p.remove();
}
