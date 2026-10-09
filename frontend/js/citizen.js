/* CivicMind — citizen dashboard: report, live-track, real-time updates */
const user = CM.requireAuth(['citizen']);
let pickLat = null, pickLng = null, pickMarker = null, pickMap = null;
let CFG = { categories: [], city_center: { lat: 0, lng: 0 } };

const STEP_LABELS = ['Submitted', 'Fused into incident', 'In progress', 'Resolved'];
function stepIndex(status) {
  return { submitted: 0, clustered: 1, in_progress: 2, resolved: 3, rejected: 0 }[status] ?? 0;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!user) return;
  document.getElementById('userName').textContent = user.name.split(' ')[0];
  renderNav('citizen.html', user);

  // Everything below is loaded from the API — nothing hardcoded in the page.
  try { CFG = await CM.api('/api/config'); } catch {}
  const sel = document.getElementById('category');
  CFG.categories.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });

  pickLat = CFG.city_center.lat; pickLng = CFG.city_center.lng;
  initPicker();

  loadStats();
  loadMine();
  subscribe();
  document.getElementById('reportForm').addEventListener('submit', submitComplaint);
  document.getElementById('geoBtn').onclick = useGeo;
});

/* ---------- map picker ---------- */
function initPicker() {
  pickMap = L.map('pickmap').setView([pickLat, pickLng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(pickMap);
  pickMarker = L.marker([pickLat, pickLng], { draggable: true }).addTo(pickMap);
  pickMarker.on('dragend', () => setPin(pickMarker.getLatLng().lat, pickMarker.getLatLng().lng));
  pickMap.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
  setTimeout(() => pickMap.invalidateSize(), 200);
}
function setPin(lat, lng) {
  pickLat = lat; pickLng = lng;
  pickMarker.setLatLng([lat, lng]);
  document.getElementById('locText').textContent = `Pin at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
function useGeo() {
  if (!navigator.geolocation) return CM.toast('Geolocation not supported', 'err');
  navigator.geolocation.getCurrentPosition(p => {
    setPin(p.coords.latitude, p.coords.longitude);
    pickMap.setView([p.coords.latitude, p.coords.longitude], 15);
  }, () => CM.toast('Could not get your location', 'err'));
}

/* ---------- submit ---------- */
async function submitComplaint(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const file = document.getElementById('photo').files[0];
  if (!file) { CM.toast('A photo of the issue is required as proof.', 'err'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> AI is checking your proof…';
  try {
    const image = await fileToDataURL(file);
    const d = await CM.api('/api/complaints', { method: 'POST', body: {
      category: document.getElementById('category').value,
      description: document.getElementById('description').value,
      latitude: pickLat, longitude: pickLng, image,
    }});
    showAIResult(d);
    CM.toast('Complaint submitted — ' + d.public_id, 'ok');
    document.getElementById('reportForm').reset();
    loadStats(); loadMine();
  } catch (err) {
    const reasons = err.detail && err.detail.reasons ? ' — ' + err.detail.reasons.join('; ') : '';
    CM.toast(err.message + reasons, 'err');
  }
  btn.disabled = false; btn.textContent = 'Submit complaint';
}

function showAIResult(d) {
  const el = document.getElementById('aiResult');
  el.style.display = 'block';
  const fused = d.incident_id
    ? `<div class="divider"></div><div class="small">🧩 Fused into incident — <a href="incident.html?id=${d.incident_id}">view it →</a></div>` : '';
  el.innerHTML = `
    <div class="card tight" style="background:var(--orange-050);border-color:var(--orange-100)">
      <div class="row spread">
        <strong>${CM.esc(d.public_id)}</strong>
        <span class="badge ${CM.sClass(d.status)}">${CM.titleCase(d.status)}</span>
      </div>
      <div class="divider" style="margin:10px 0"></div>
      <div class="row wrap-row" style="gap:8px">
        <span class="badge" style="background:var(--surface)">🏷️ ${CM.esc(d.ai.category)}</span>
        <span class="badge" style="background:var(--surface)">⚠️ Severity ${d.ai.severity}/5</span>
        <span class="badge" style="background:var(--surface)">🏢 ${CM.esc(d.ai.department || '—')}</span>
        <span class="badge" style="background:var(--surface)">🧠 ${d.ai.engine === 'sarvam' ? 'Sarvam AI' : 'Rules'} · ${Math.round(d.ai.confidence*100)}%</span>
      </div>
      <div class="row wrap-row" style="gap:8px;margin-top:8px">
        <span class="badge ${d.proof.verified ? 'low' : 'medium'}">🔎 Evidence ${CM.titleCase(d.proof.verdict)} · ${Math.round(d.proof.confidence*100)}%</span>
        <span class="badge" style="background:var(--surface)">${d.proof.engine === 'sarvam' ? 'Sarvam AI check' : 'Rules check'}</span>
      </div>
      <p class="tiny muted" style="margin:6px 0 0">${CM.esc(d.proof.note || '')}</p>
      <p class="small muted" style="margin:10px 0 0">${CM.esc(d.ai.summary)}</p>
      ${d.area && d.area.ward ? `<p class="tiny muted" style="margin:6px 0 0">Area mapped to <strong>${CM.esc(d.area.ward)}</strong> (${CM.esc(d.area.zone)} zone).</p>` : ''}
      ${fused}
    </div>`;
}

const fileToDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

/* ---------- stats & my complaints ---------- */
async function loadStats() {
  try {
    const d = await CM.api('/api/dashboard/citizen');
    document.getElementById('mMine').textContent = d.my_complaints;
    document.getElementById('mProgress').textContent = d.in_progress;
    document.getElementById('mResolved').textContent = d.resolved;
    document.getElementById('mJoined').textContent = d.incidents_joined;
  } catch (e) { /* ignore */ }
}

async function loadMine() {
  try {
    const rows = await CM.api('/api/complaints?mine=1&limit=60');
    document.getElementById('mineCount').textContent = rows.length;
    const box = document.getElementById('myComplaints');
    if (!rows.length) { box.innerHTML = '<div class="card empty">No complaints yet. Report your first civic issue above.</div>'; return; }
    box.innerHTML = rows.map(c => complaintCard(c)).join('');
  } catch (e) { CM.toast(e.message, 'err'); }
}

function complaintCard(c) {
  const si = stepIndex(c.status);
  const steps = STEP_LABELS.map((lbl, i) => {
    const cls = i < si ? 'done' : (i === si ? 'current' : '');
    return `<div class="step ${cls}"><div class="bubble">${i < si ? '✓' : i + 1}</div><div class="lbl">${lbl}</div></div>`;
  }).join('');
  const incidentLink = c.incident_id
    ? `<a class="btn sm ghost" href="incident.html?id=${c.incident_id}">View incident →</a>` : '';
  return `
    <div class="card">
      <div class="row spread wrap-row">
        <div class="row">
          <span class="badge" style="background:var(--orange-050);color:var(--orange-600)">${CM.esc(c.category)}</span>
          <strong class="small">${CM.esc(c.public_id)}</strong>
          <span class="muted small">${CM.esc(c.ward || '')}</span>
        </div>
        <div class="row">
          <span class="badge ${CM.sClass(c.status)}">${CM.titleCase(c.status)}</span>
          <span class="tiny muted">${CM.timeAgo(c.created_at)}</span>
        </div>
      </div>
      <p class="small" style="margin:12px 0">${CM.esc(c.description)}</p>
      <div class="track">${steps}</div>
      <div class="row spread" style="margin-top:8px">
        <span class="tiny muted">${c.ai_summary ? '🧠 ' + CM.esc(c.ai_summary) : ''}</span>
        ${incidentLink}
      </div>
    </div>`;
}

/* ---------- public track ---------- */
async function trackComplaint() {
  const id = document.getElementById('trackId').value.trim();
  if (!id) return;
  const el = document.getElementById('trackResult');
  try {
    const d = await CM.api('/api/track/' + encodeURIComponent(id));
    el.innerHTML = `<div class="card tight">
        <div class="row spread"><strong>${CM.esc(d.complaint.public_id)}</strong>
        <span class="badge ${CM.sClass(d.complaint.status)}">${CM.titleCase(d.complaint.status)}</span></div>
        <p class="small muted" style="margin:8px 0 0">${CM.esc(d.complaint.ai_summary || d.complaint.description)}</p>
        ${d.incident ? `<div class="divider"></div><div class="small">Part of incident <strong>${CM.esc(d.incident.public_id)}</strong> — ${CM.esc(d.incident.title)} <span class="badge ${CM.pClass(d.incident.priority_label)}">${d.incident.priority_label}</span></div>` : ''}
      </div>`;
  } catch (e) { el.innerHTML = `<p class="small" style="color:var(--red)">${CM.esc(e.message)}</p>`; }
}

/* ---------- real-time ---------- */
function subscribe() {
  const token = CM.getToken();
  if (!token || typeof EventSource === 'undefined') { setInterval(loadMine, 8000); return; }
  try {
    const es = new EventSource('api/stream?token=' + encodeURIComponent(token));
    let lastComplaints = '';
    es.addEventListener('update', (ev) => {
      const snap = JSON.parse(ev.data);
      renderFeed(snap.notifications);
      const sig = JSON.stringify(snap.complaints.map(c => c.public_id + c.status + c.updated_at));
      if (sig !== lastComplaints) { lastComplaints = sig; loadMine(); loadStats(); }
      refreshBell();
    });
    es.onerror = () => { /* browser auto-reconnects */ };
  } catch { setInterval(loadMine, 8000); }
}

function renderFeed(notifs) {
  const box = document.getElementById('liveFeed');
  if (!notifs || !notifs.length) { box.innerHTML = '<div class="empty small">No updates yet.</div>'; return; }
  const icon = { incident:'⚠️', resolved:'✅', approved:'👍', in_progress:'🔧', info:'📩' };
  box.innerHTML = notifs.map(n => `
    <div class="list-item">
      <div class="li-icon">${icon[n.type] || '📩'}</div>
      <div class="grow">
        <div style="font-weight:700;font-size:.84rem">${CM.esc(n.title)}</div>
        <div class="small muted">${CM.esc(n.message || '')}</div>
        <div class="tiny muted">${CM.timeAgo(n.created_at)}</div>
      </div>
    </div>`).join('');
}
