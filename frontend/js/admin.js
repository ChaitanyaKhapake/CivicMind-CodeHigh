/* CivicMind — admin console */
const user = CM.requireAuth(['admin']);
const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  if (!user) return;
  renderNav('admin.html', user);
  $('addUser').addEventListener('submit', addUser);
  $('importForm').addEventListener('submit', importAssets);
  $('resetBtn').addEventListener('click', resetData);
  loadAll();
});

function loadAll() { loadStats(); loadUsers(); loadConfig(); loadComplaints(); loadResolutions(); }

async function loadStats() {
  try {
    const s = await CM.api('/api/admin/stats');
    $('aUsers').textContent = CM.num(s.users);
    $('aComplaints').textContent = CM.num(s.complaints);
    $('aOpen').textContent = `${CM.num(s.open_complaints)} open · ${s.resolution_rate === null ? '—' : s.resolution_rate + '% resolved'}`;
    $('aIncidents').textContent = CM.num(s.incidents);
    $('aResolutions').textContent = `${CM.num(s.resolutions)} verification records`;
    $('aAssets').textContent = CM.num(s.assets);
    $('aFindings').textContent = `${CM.num(s.open_findings)} open risk findings`;
    $('demoBanner').hidden = !s.demo_database;
    $('resetZone').hidden = !s.demo_database;
  } catch (e) { CM.fail(e); }
}

async function loadUsers() {
  try {
    const rows = await CM.api('/api/admin/users');
    document.querySelector('#usersTable tbody').innerHTML = rows.map(u => `
      <tr class="static">
        <td><strong>${CM.esc(u.name)}</strong></td>
        <td class="small muted">${CM.esc(u.email)}</td>
        <td><span class="badge ${u.role === 'admin' ? 'critical' : u.role === 'officer' ? 'active' : ''}">${CM.esc(CM.titleCase(u.role))}</span></td>
        <td class="small">${CM.esc(u.department || '—')}</td>
        <td class="small">${CM.esc(u.ward || '—')}</td>
      </tr>`).join('') || '<tr class="static"><td colspan="5" class="empty">No users.</td></tr>';
  } catch (e) { CM.fail(e); }
}

async function loadConfig() {
  try {
    const c = await CM.api('/api/admin/config');
    $('cfgNote').textContent = c.note;
    $('cfgCats').innerHTML = c.categories.map(x => `<span class="chip static">${CM.esc(x)}</span>`).join('');
    $('cfgDepts').innerHTML = c.departments.map(x => `<span class="chip static">${CM.esc(x)}</span>`).join('');
    if ($('uDept').options.length <= 1) {
      c.departments.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; $('uDept').appendChild(o); });
      c.wards.forEach(w => { const o = document.createElement('option'); o.value = w; o.textContent = w; $('uWard').appendChild(o); });
    }
  } catch (e) { CM.fail(e); }
}

function checkBadge(pc) {
  if (!pc || !pc.verdict) return '<span class="muted small">—</span>';
  const cls = pc.verdict === 'passed' ? 'low' : pc.verdict === 'rejected' ? 'critical' : 'medium';
  return `<span class="badge ${cls}" title="${CM.esc((pc.reasons || []).join('; '))}">${CM.esc(CM.checkLabel(pc.verdict))}</span>`;
}

async function loadComplaints() {
  try {
    const rows = await CM.api('/api/admin/complaints');
    $('acCount').textContent = rows.length;
    document.querySelector('#acTable tbody').innerHTML = rows.map(c => `
      <tr class="static">
        <td><strong>${CM.esc(c.public_id)}</strong> ${syntheticTag(c.is_synthetic)}
            <div class="tiny muted">${c.incident ? `<a class="link" href="incident.html?id=${encodeURIComponent(c.incident.id)}">${CM.esc(c.incident.public_id)}</a>` : 'not grouped'}</div></td>
        <td class="small">${CM.esc(c.citizen_name || '—')}<div class="tiny muted">${CM.esc(c.citizen_email || '')}</div></td>
        <td class="small">${CM.esc(c.category)}</td>
        <td class="small">${CM.esc(c.ward || '—')}</td>
        <td>${c.has_photo ? `<img class="thumb sm" alt="Complaint photo" data-auth-src="/api/complaints/${Number(c.id)}/photo"/>` : '—'}</td>
        <td>${checkBadge(c.photo_check)}</td>
        <td><span class="badge ${CM.sClass(c.status)}">${CM.esc(CM.statusText(c.status))}</span>
            ${c.resolved_by_name ? `<div class="tiny muted">✓ ${CM.esc(c.resolved_by_name)}</div>` : ''}</td>
        <td class="small muted">${CM.esc(CM.timeAgo(c.created_at))}</td>
      </tr>`).join('') || '<tr class="static"><td colspan="8" class="empty">No complaints yet.</td></tr>';
    CM.hydrateImages($('acTable'));
  } catch (e) { CM.fail(e); }
}

async function loadResolutions() {
  try {
    const rows = await CM.api('/api/admin/resolutions');
    $('arCount').textContent = rows.length;
    document.querySelector('#arTable tbody').innerHTML = rows.map(r => {
      const img = !r.has_proof ? '—' : r.scope === 'incident' && r.action_id
        ? `<img class="thumb sm" alt="Proof photo" data-auth-src="/api/actions/${Number(r.action_id)}/proof"/>`
        : r.scope === 'complaint' ? `<img class="thumb sm" alt="Proof photo" data-auth-src="/api/complaints/${Number(r.id)}/resolution-photo"/>` : '✓';
      return `
      <tr class="static">
        <td><strong>${r.incident_id ? `<a class="link" href="incident.html?id=${encodeURIComponent(r.incident_id)}">${CM.esc(r.ref)}</a>` : CM.esc(r.ref)}</strong>
            <div class="tiny muted">${CM.esc(r.scope === 'incident' ? 'incident' : 'single complaint')} · ${CM.esc(r.category || '')} · ${CM.esc(r.ward || '')}</div></td>
        <td class="small">${CM.esc(r.officer_name || '—')}</td>
        <td class="small">${CM.esc(CM.titleCase(r.verification_type || ''))}<div>${checkBadge(r.proof_check)}</div></td>
        <td class="num small">${r.before_metric != null ? CM.esc(r.before_metric) + ' → ' + CM.esc(r.after_metric) : '—'}</td>
        <td>${img}</td>
        <td><span class="badge ${r.status === 'verified' ? 'resolved' : 'reopened'}">${r.status === 'verified' ? 'Resolved' : 'Reopened'}</span></td>
        <td class="small muted">${CM.esc(CM.timeAgo(r.verified_at))}</td>
      </tr>`; }).join('') || '<tr class="static"><td colspan="7" class="empty">No resolutions yet.</td></tr>';
    CM.hydrateImages($('arTable'));
  } catch (e) { CM.fail(e); }
}

async function addUser(e) {
  e.preventDefault();
  const err = $('uError'); err.hidden = true;
  const body = { name: $('uName').value.trim(), email: $('uEmail').value.trim(), password: $('uPass').value,
                 role: $('uRole').value, department: $('uDept').value || null, ward: $('uWard').value || null };
  if (body.name.length < 2 || !body.email || body.password.length < 8) {
    err.textContent = 'Name, a valid email and a password of at least 8 characters are required.'; err.hidden = false; return;
  }
  await CM.busy($('uBtn'), 'Creating…', async () => {
    try {
      await CM.api('/api/admin/users', { method: 'POST', body });
      CM.toast(`${CM.titleCase(body.role)} account created`, 'ok');
      $('addUser').reset(); loadUsers(); loadStats();
    } catch (ex) { err.textContent = ex.message + ((ex.reasons || []).length ? ' — ' + ex.reasons.join('; ') : ''); err.hidden = false; }
  });
}

async function importAssets(e) {
  e.preventDefault();
  const err = $('gError'); err.hidden = true;
  const f = $('gFile').files[0], source = $('gSource').value.trim();
  if (!f) { err.textContent = 'Choose a GeoJSON file.'; err.hidden = false; return; }
  if (f.size > 2 * 1024 * 1024) { err.textContent = 'File is larger than 2 MB.'; err.hidden = false; return; }
  if (source.length < 2) { err.textContent = 'Describe the data source.'; err.hidden = false; return; }
  await CM.busy($('gBtn'), 'Importing…', async () => {
    let geojson;
    try { geojson = JSON.parse(await f.text()); }
    catch { err.textContent = 'The file is not valid JSON.'; err.hidden = false; return; }
    try {
      const s = await CM.api('/api/assets/import', { method: 'POST', body: { geojson, data_source: source, is_synthetic: $('gSynthetic').checked } });
      $('importResult').innerHTML = `
        <div class="card tight soft">
          <strong>Import finished</strong>
          <p class="small">${CM.esc(s.imported)} imported · ${CM.esc(s.duplicates.length)} duplicate (skipped) · ${CM.esc(s.rejected.length)} rejected · ${CM.esc(s.total)} total</p>
          ${s.duplicates.length ? `<p class="tiny muted">Duplicates: ${CM.esc(s.duplicates.slice(0, 20).join(', '))}</p>` : ''}
          ${s.rejected.length ? `<ul class="tiny">${s.rejected.slice(0, 20).map(r => `<li>Feature ${CM.esc(r.index)}: ${CM.esc(r.reason)}</li>`).join('')}</ul>` : ''}
        </div>`;
      loadStats();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

async function resetData() {
  if ($('resetConfirm').value !== 'RESET') return CM.toast('Type RESET to confirm.', 'err');
  await CM.busy($('resetBtn'), 'Resetting…', async () => {
    try {
      await CM.api('/api/admin/reset', { method: 'POST', body: { confirm: 'RESET' } });
      $('resetConfirm').value = '';
      CM.toast('Demo civic data cleared', 'ok'); loadAll();
    } catch (e) { CM.fail(e); }
  });
}
