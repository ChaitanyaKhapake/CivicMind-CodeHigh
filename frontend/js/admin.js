/* CivicMind — admin console (oversight of citizen complaints & officer resolutions) */
const user = CM.requireAuth(['admin']);

document.addEventListener('DOMContentLoaded', () => {
  if (!user) return;
  renderNav('admin.html', user);
  loadStats(); loadUsers(); loadConfig(); loadComplaints(); loadResolutions();
  document.getElementById('addUser').addEventListener('submit', addUser);
});

async function loadStats() {
  try {
    const s = await CM.api('/api/admin/stats');
    document.getElementById('aUsers').textContent = s.users;
    document.getElementById('aComplaints').textContent = CM.num(s.complaints);
    document.getElementById('aIncidents').textContent = s.incidents;
    document.getElementById('aResolutions').textContent = s.resolutions;
  } catch (e) { CM.toast(e.message, 'err'); }
}

async function loadUsers() {
  try {
    const rows = await CM.api('/api/admin/users');
    document.querySelector('#usersTable tbody').innerHTML = rows.map(u => `
      <tr style="cursor:default">
        <td><strong>${CM.esc(u.name)}</strong></td>
        <td class="small muted">${CM.esc(u.email)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'critical' : u.role === 'officer' ? 'active' : ''}">${CM.titleCase(u.role)}</span></td>
        <td class="small">${CM.esc(u.department || '—')}</td>
        <td class="small">${CM.esc(u.ward || '—')}</td>
      </tr>`).join('');
  } catch (e) { CM.toast(e.message, 'err'); }
}

async function loadConfig() {
  try {
    const c = await CM.api('/api/admin/config');
    document.getElementById('cfgCats').innerHTML = c.categories.map(x => `<span class="chip" style="cursor:default">${CM.esc(x)}</span>`).join('');
    document.getElementById('cfgDepts').innerHTML = c.departments.map(x => `<span class="chip" style="cursor:default">${CM.esc(x)}</span>`).join('');
  } catch (e) { CM.toast(e.message, 'err'); }
}

function evidenceBadge(pc) {
  if (!pc || !pc.verdict) return '<span class="badge">—</span>';
  const cls = pc.verdict === 'verified' ? 'low' : pc.verdict === 'flagged' ? 'critical' : 'medium';
  return `<span class="badge ${cls}" title="${CM.esc((pc.note||'') + ' ' + ((pc.reasons||[]).join('; ')))}">
            ${CM.titleCase(pc.verdict)} · ${Math.round((pc.confidence||0)*100)}%</span>`;
}

async function loadComplaints() {
  try {
    const rows = await CM.api('/api/admin/complaints');
    document.getElementById('acCount').textContent = rows.length;
    document.querySelector('#acTable tbody').innerHTML = rows.map(c => `
      <tr style="cursor:default">
        <td><strong>${CM.esc(c.public_id)}</strong><div class="tiny muted">${CM.esc(c.incident_public_id || 'not fused')}</div></td>
        <td class="small">${CM.esc(c.citizen_name || '—')}</td>
        <td class="small">${CM.esc(c.category)}</td>
        <td class="small">${CM.esc(c.ward || '—')}</td>
        <td>${c.image_path ? `<img src="${c.image_path}" style="width:44px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"/>` : '—'}</td>
        <td>${evidenceBadge(c.proof_check)}</td>
        <td><span class="badge ${CM.sClass(c.status)}">${CM.titleCase(c.status)}</span>
            ${c.officer_name ? `<div class="tiny muted" style="margin-top:3px">✓ ${CM.esc(c.officer_name)}</div>` : ''}</td>
        <td class="small muted">${CM.timeAgo(c.created_at)}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="empty">No citizen complaints yet.</td></tr>';
  } catch (e) { CM.toast(e.message, 'err'); }
}

async function loadResolutions() {
  try {
    const rows = await CM.api('/api/admin/resolutions');
    document.getElementById('arCount').textContent = rows.length;
    document.querySelector('#arTable tbody').innerHTML = rows.map(r => `
      <tr style="cursor:default">
        <td><strong>${CM.esc(r.ref || '—')}</strong>
            <div class="tiny muted">${CM.esc(r.scope === 'incident' ? 'incident' : 'single complaint')} · ${CM.esc(r.category || '')} · ${CM.esc(r.ward || '')}</div></td>
        <td class="small">${CM.esc(r.officer_name || '—')}</td>
        <td class="num small">${r.before_metric != null ? r.before_metric + ' → ' + r.after_metric : '—'}</td>
        <td><span class="badge low">▼ ${r.reduction_pct}%</span></td>
        <td>${evidenceBadge(r.proof_check)}</td>
        <td>${r.proof_path ? `<a href="${r.proof_path}" target="_blank"><img src="${r.proof_path}" style="width:44px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"/></a>` : '—'}</td>
        <td><span class="badge ${r.status === 'verified' ? 'resolved' : 'reopened'}">${CM.titleCase(r.status)}</span></td>
        <td class="small muted">${CM.timeAgo(r.verified_at)}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="empty">No resolutions yet.</td></tr>';
  } catch (e) { CM.toast(e.message, 'err'); }
}

async function addUser(e) {
  e.preventDefault();
  try {
    await CM.api('/api/admin/users', { method: 'POST', body: {
      name: document.getElementById('uName').value,
      email: document.getElementById('uEmail').value,
      password: document.getElementById('uPass').value,
      role: document.getElementById('uRole').value,
      department: document.getElementById('uDept').value || null,
      ward: document.getElementById('uWard').value || null,
    }});
    CM.toast('User created', 'ok');
    document.getElementById('addUser').reset();
    loadUsers(); loadStats();
  } catch (err) { CM.toast(err.message, 'err'); }
}

async function resetData() {
  if (!confirm('This will delete ALL complaints and incidents (user accounts are kept). Continue?')) return;
  try {
    await CM.api('/api/admin/reset', { method: 'POST' });
    CM.toast('Civic data cleared', 'ok');
    loadStats(); loadUsers(); loadConfig(); loadComplaints(); loadResolutions();
  } catch (e) { CM.toast(e.message, 'err'); }
}
