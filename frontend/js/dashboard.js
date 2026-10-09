/* CivicMind — officer dashboard */
const user = CM.requireAuth(['officer', 'admin']);
const C = { orange:'#E8551E', green:'#2E9E5B', blue:'#2F6FDB', purple:'#7B4FD1',
            red:'#D9342B', amber:'#E0A106', line:'#ECE2D3', ink:'#6B6157' };
const PALETTE = [C.orange,C.blue,C.green,C.purple,C.amber,C.red,'#3AA6A0','#B0592F','#7A8B99','#C77DBA'];

document.addEventListener('DOMContentLoaded', () => {
  if (!user) return;
  renderNav('dashboard.html', user);
  loadDashboard();
  loadCharts();
});

async function loadDashboard() {
  try {
    const d = await CM.api('/api/dashboard');
    const m = d.metrics;
    set('kTotal', CM.num(m.total_complaints));
    set('kOpen', CM.num(m.open_complaints));
    set('kActive', CM.num(m.active_incidents));
    set('kCritical', CM.num(m.critical_incidents));
    set('kResolved', CM.num(m.resolved_complaints));
    set('kResolvedSub', CM.num(m.resolved_incidents) + ' incident' + (m.resolved_incidents === 1 ? '' : 's') + ' closed');
    set('kAffected', CM.num(m.affected_citizens));
    set('kResponse', m.avg_response_hours + 'h');
    set('kRate', m.resolution_rate + '%');

    document.querySelector('#queueTable tbody').innerHTML = d.priority_queue.map(q => `
      <tr onclick="location.href='incident.html?id=${q.id}'">
        <td><strong>${CM.esc(q.public_id)}</strong><div class="tiny muted">${CM.esc(q.title)}</div></td>
        <td class="small">${CM.esc(q.category)}</td>
        <td class="small">${CM.esc(q.ward || '—')}</td>
        <td class="num">${q.report_count}</td>
        <td class="num">${CM.num(q.affected_people)}</td>
        <td><span class="badge ${CM.pClass(q.priority_label)}">${q.priority_label} · ${q.priority_score}</span></td>
        <td><span class="badge ${CM.sClass(q.status)}">${CM.titleCase(q.status)}</span></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">No active incidents. Run detection.</td></tr>';

    document.getElementById('alerts').innerHTML = d.alerts.length ? d.alerts.map(a => `
      <div class="list-item" onclick="location.href='incident.html?id=${a.id}'">
        <div class="li-icon" style="background:var(--red-050)">🚨</div>
        <div class="grow">
          <div style="font-weight:700;font-size:.86rem">${CM.esc(a.title)}</div>
          <div class="tiny muted">${a.report_count} reports · ${CM.num(a.affected_people)} people · ${CM.esc(a.ward)}</div>
        </div>
        <span class="badge ${CM.pClass(a.priority_label)}">${a.priority_label}</span>
      </div>`).join('') : '<div class="empty small">No high-priority alerts.</div>';

    document.getElementById('activity').innerHTML = d.recent_activity.map(a => `
      <div class="tl-item">
        <div class="tl-t">${CM.esc(a.detail || a.action)}</div>
        <div class="tl-d">${CM.esc(a.actor || '')} · ${CM.timeAgo(a.created_at)}</div>
      </div>`).join('') || '<div class="empty small">No activity yet.</div>';

    const reports = d.recent_reports || [];
    document.getElementById('repCount').textContent = reports.length;
    document.querySelector('#reportsTable tbody').innerHTML = reports.map(r => `
      <tr>
        <td><strong>${CM.esc(r.public_id)}</strong>${r.incident_id ? '<div class="tiny muted">in incident</div>' : ''}</td>
        <td class="small">${CM.esc(r.category)}</td>
        <td class="small">${CM.esc(r.ward || '—')}</td>
        <td class="small">${CM.esc(r.citizen_name || '—')}</td>
        <td class="num"><span class="badge ${r.severity >= 4 ? 'critical' : r.severity === 3 ? 'medium' : 'low'}">${r.severity}</span></td>
        <td><span class="badge ${r.proof_verified ? 'low' : 'medium'}">${r.proof_verified ? '✓ checked' : 'review'}</span></td>
        <td><span class="badge ${CM.sClass(r.status)}">${CM.titleCase(r.status)}</span></td>
        <td class="small muted">${CM.timeAgo(r.created_at)}</td>
        <td>${r.status === 'resolved'
              ? `<span class="badge resolved" title="Resolved by ${CM.esc(r.officer_name || '')}">✓ ${CM.esc((r.officer_name || 'Resolved').split(' ')[0])}</span>`
              : `<button class="btn sm primary" onclick="openResolve(${r.complaint_id}, '${CM.esc(r.public_id)}')">✔ Resolve</button>`}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty">No citizen reports yet. Reports appear here the moment a citizen submits one.</td></tr>';
  } catch (e) { CM.toast(e.message, 'err'); }
}
const set = (id, v) => document.getElementById(id).textContent = v;

let charts = {};
async function loadCharts() {
  try {
    const d = await CM.api('/api/dashboard/charts');
    const grid = { color: C.line };

    charts.cat = new Chart(document.getElementById('cCat'), {
      type: 'doughnut',
      data: { labels: d.categories.map(c => c.category),
        datasets: [{ data: d.categories.map(c => c.c), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 9, font: { size: 10 }, padding: 8 } } } }
    });

    charts.trend = new Chart(document.getElementById('cTrend'), {
      type: 'line',
      data: { labels: d.trend.map(t => t.day.slice(5)),
        datasets: [
          { label: 'Created', data: d.trend.map(t => t.created), borderColor: C.orange, backgroundColor: 'rgba(232,85,30,.12)', fill: true, tension: .35, borderWidth: 2, pointRadius: 3 },
          { label: 'Resolved', data: d.trend.map(t => t.resolved), borderColor: C.green, backgroundColor: 'rgba(46,158,91,.12)', fill: true, tension: .35, borderWidth: 2, pointRadius: 3 } ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: { x: { grid: { display: false } }, y: { grid, beginAtZero: true } } }
    });

    charts.prio = new Chart(document.getElementById('cPrio'), {
      type: 'bar',
      data: { labels: d.priorities.map(p => p.label),
        datasets: [{ data: d.priorities.map(p => p.c),
          backgroundColor: d.priorities.map(p => CM.pClass(p.label) === 'critical' ? C.red : CM.pClass(p.label) === 'high' ? C.orange : CM.pClass(p.label) === 'medium' ? C.amber : C.green),
          borderRadius: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid, beginAtZero: true } } }
    });

    charts.ward = new Chart(document.getElementById('cWard'), {
      type: 'bar',
      data: { labels: d.by_ward.map(w => w.ward),
        datasets: [{ data: d.by_ward.map(w => w.c), backgroundColor: C.blue, borderRadius: 8 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid, beginAtZero: true }, y: { grid: { display: false } } } }
    });
  } catch (e) { CM.toast('Charts: ' + e.message, 'err'); }
}

async function runDetect() {
  const btn = document.getElementById('detectBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Detecting…';
  try {
    const d = await CM.api('/api/incidents/detect', { method: 'POST' });
    CM.toast(`Detection complete — ${d.detected} new incident(s)`, 'ok');
    loadDashboard(); loadCharts();
  } catch (e) { CM.toast(e.message, 'err'); }
  btn.disabled = false; btn.innerHTML = '⚡ Run incident detection';
}

/* ---------- resolve a single complaint (with AI-verified proof) ---------- */
let _resolving = null;

let _plan = null;

async function openResolve(complaintId, publicId) {
  _resolving = complaintId; _plan = null;
  let c = {};
  try { c = await CM.api('/api/complaints/' + complaintId); } catch (e) { CM.toast(e.message, 'err'); }
  document.getElementById('resolveModal').innerHTML = `
    <div style="position:fixed;inset:0;background:rgba(32,27,22,.55);z-index:200;display:grid;place-items:center;padding:18px" onclick="if(event.target===this)closeResolve()">
      <div class="card" style="max-width:600px;width:100%;max-height:92vh;overflow:auto">
        <div class="card-h"><h3>Resolve ${CM.esc(publicId)}</h3>
          <button class="btn sm ghost" onclick="closeResolve()">✕</button></div>
        <div class="row" style="gap:14px;align-items:flex-start">
          ${c.image_path ? `<img src="${c.image_path}" alt="issue" style="width:130px;height:100px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"/>` : ''}
          <div>
            <div class="row wrap-row" style="gap:6px">
              <span class="badge" style="background:var(--orange-050);color:var(--orange-600)">${CM.esc(c.category || '')}</span>
              <span class="badge">${CM.esc(c.ward || '')}</span>
            </div>
            <p class="small" style="margin:8px 0 0">${CM.esc(c.description || '')}</p>
          </div>
        </div>
        <div class="divider"></div>
        <div class="eyebrow">🤖 AI resolution plan</div>
        <div id="planBox" style="margin-top:8px"><div class="skeleton" style="height:14px;width:70%"></div><div class="skeleton" style="height:14px;width:50%;margin-top:8px"></div></div>
        <div class="divider"></div>
        <div class="field">
          <label class="f">Proof-of-resolution photo <span style="color:var(--red)">*</span></label>
          <input type="file" id="rProof" accept="image/*"/>
          <div class="hint">Required — the AI verifies this photo (and rejects a blank, tiny or re-used image) before the issue is marked solved.</div>
        </div>
        <div class="field">
          <label class="f">Completion notes (optional)</label>
          <textarea id="rNotes" style="min-height:64px" placeholder="e.g. Pothole filled and road levelled"></textarea>
        </div>
        <button class="btn primary block" id="rBtn" onclick="submitResolve()">Submit proof &amp; mark solved</button>
      </div>
    </div>`;
  // Fetch the AI plan asynchronously so the panel opens instantly.
  try {
    const p = await CM.api('/api/complaints/' + complaintId + '/plan');
    _plan = p;
    const box = document.getElementById('planBox');
    if (box) box.innerHTML = planHtml(p);
  } catch (e) {
    const box = document.getElementById('planBox');
    if (box) box.innerHTML = '<p class="hint">AI plan unavailable right now — proceed manually.</p>';
  }
}

function planHtml(p) {
  const cl = (p.checklist || []).map(x => `<li>${CM.esc(x)}</li>`).join('') || '<li class="muted">—</li>';
  return `
    <div class="card tight" style="background:var(--orange-050);border-color:var(--orange-100)">
      <p style="font-weight:700;margin:0 0 8px">${CM.esc(p.action_text || '—')}</p>
      <div class="row wrap-row" style="gap:8px">
        <span class="badge" style="background:var(--surface)">🏢 ${CM.esc(p.assigned_team || p.department || '—')}</span>
        <span class="badge" style="background:var(--surface)">⏱️ Est. time: ${CM.esc(p.eta_label || (p.eta_hours + ' hrs'))}</span>
        <span class="badge" style="background:var(--surface)">${p.engine === 'sarvam' ? '🧠 Sarvam AI' : 'Rules'}</span>
      </div>
      <div class="eyebrow" style="margin-top:10px">Inspection checklist</div>
      <ul class="small" style="padding-left:18px;margin:4px 0 0">${cl}</ul>
    </div>`;
}

function closeResolve() { document.getElementById('resolveModal').innerHTML = ''; _resolving = null; _plan = null; }

async function submitResolve() {
  const f = document.getElementById('rProof').files[0];
  if (!f) { CM.toast('A proof-of-resolution photo is required.', 'err'); return; }
  const btn = document.getElementById('rBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> AI is verifying your proof…';
  try {
    const proof = await fileToDataURL(f);
    const notes = document.getElementById('rNotes').value;
    const body = { notes, proof };
    if (_plan) { body.plan = _plan; body.eta_hours = _plan.eta_hours; }
    const res = await CM.api('/api/complaints/' + _resolving + '/resolve', { method: 'POST', body });
    CM.toast('Resolved — AI proof check: ' + ((res.proof || {}).verdict || 'ok'), 'ok');
    closeResolve(); loadDashboard(); loadCharts();
  } catch (e) {
    const r = e.detail && e.detail.reasons ? ' — ' + e.detail.reasons.join('; ') : '';
    CM.toast(e.message + r, 'err');
    btn.disabled = false; btn.textContent = 'Submit proof & mark solved';
  }
}
const fileToDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});
