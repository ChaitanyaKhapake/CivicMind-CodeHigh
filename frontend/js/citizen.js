/* CivicMind — citizen page: report, track, live updates */
const user = CM.requireAuth(['citizen']);
const $ = (id) => document.getElementById(id);
let pickLat = null, pickLng = null, pinSet = false, pickMarker = null, pickMap = null;
let CFG = { categories: [], city_center: { lat: 18.5204, lng: 73.8567 }, require_issue_photo: false };

const STEPS = ['Submitted', 'Grouped / reviewed', 'Work in progress', 'Resolved'];
const stepIndex = (s) => ({ submitted: 0, clustered: 1, in_progress: 2, resolved: 3 }[s] ?? 0);

document.addEventListener('DOMContentLoaded', async () => {
  if (!user) return;
  $('userName').textContent = (user.name || '').split(' ')[0] || 'there';
  renderNav('citizen.html', user);
  try { CFG = await CM.api('/api/config'); } catch (e) { CM.fail(e); }
  CFG.categories.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('category').appendChild(o); });
  if (CFG.require_issue_photo) { $('photoReq').textContent = '(required)'; $('photo').required = true; }
  pickLat = CFG.city_center.lat; pickLng = CFG.city_center.lng;
  initPicker();
  $('description').addEventListener('input', () => { $('descCount').textContent = $('description').value.length; });
  $('reportForm').addEventListener('submit', submitComplaint);
  $('trackForm').addEventListener('submit', trackComplaint);
  $('geoBtn').addEventListener('click', useGeo);
  loadStats(); loadMine(); loadFeed(); subscribe();
});

/* ---------- map picker ---------- */
function initPicker() {
  if (typeof L === 'undefined') { $('pickmap').innerHTML = emptyState('Map could not load. Use “Use my location”.'); return; }
  pickMap = L.map('pickmap').setView([pickLat, pickLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(pickMap);
  pickMarker = L.marker([pickLat, pickLng], { draggable: true }).addTo(pickMap);
  pickMarker.on('dragend', () => setPin(pickMarker.getLatLng().lat, pickMarker.getLatLng().lng));
  pickMap.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
  setTimeout(() => pickMap.invalidateSize(), 200);
}
function setPin(lat, lng) {
  pickLat = lat; pickLng = lng; pinSet = true;
  if (pickMarker) pickMarker.setLatLng([lat, lng]);
  $('locText').textContent = `Pin set at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
function useGeo() {
  if (!navigator.geolocation) return CM.toast('Location is not available in this browser.', 'err');
  navigator.geolocation.getCurrentPosition(p => {
    setPin(p.coords.latitude, p.coords.longitude);
    if (pickMap) pickMap.setView([p.coords.latitude, p.coords.longitude], 16);
  }, () => CM.toast('Could not get your location. Tap the map instead.', 'err'), { timeout: 10000 });
}

/* ---------- submit ---------- */
async function submitComplaint(e) {
  e.preventDefault();
  const err = $('formError');
  err.hidden = true;
  const category = $('category').value, description = $('description').value.trim();
  const file = $('photo').files[0];
  const problems = [];
  if (!category) problems.push('Choose a category.');
  if (description.length < 10) problems.push('Describe the issue in at least 10 characters.');
  if (!pinSet) problems.push('Set the location on the map (tap the map or use your location).');
  if (CFG.require_issue_photo && !file) problems.push('A photo is required.');
  if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; return; }

  await CM.busy($('submitBtn'), 'Submitting…', async () => {
    try {
      const body = { category, description, latitude: pickLat, longitude: pickLng,
                     address: $('address').value.trim() || null };
      if (file) body.image = await CM.fileToDataURL(file);
      const d = await CM.api('/api/complaints', { method: 'POST', body });
      showResult(d);
      $('reportForm').reset(); $('descCount').textContent = '0'; pinSet = false;
      $('locText').textContent = 'Tap the map or drag the pin to the exact spot.';
      loadStats(); loadMine(); loadFeed();
    } catch (ex) {
      err.textContent = ex.message + ((ex.reasons || []).length ? ' — ' + ex.reasons.join('; ') : '');
      err.hidden = false;
    }
  });
}

function showResult(d) {
  const c = d.classification;
  $('result').innerHTML = `
    <div class="card tight success-card">
      <div class="row spread wrap-row">
        <strong>Report ${CM.esc(d.public_id)} received</strong>
        <span class="badge ${CM.sClass(d.status)}">${CM.esc(CM.statusText(d.status))}</span>
      </div>
      <div class="tracking-code">
        <div class="tiny muted">Your private tracking code</div>
        <div class="code" id="trackingCode">${CM.esc(d.tracking_code)}</div>
        <button type="button" class="btn sm ghost" id="copyCode">Copy</button>
      </div>
      <div class="row wrap-row" style="gap:6px;margin-top:8px">
        <span class="badge">${CM.esc(c.category)}</span>
        <span class="badge">Severity ${CM.esc(c.severity)}/5</span>
        <span class="badge">${CM.esc(c.department)}</span>
        <span class="badge" title="Which engine classified this report">${CM.esc(CM.engineLabel(c.engine))}</span>
      </div>
      ${d.photo ? `<p class="tiny muted" style="margin:8px 0 0">Photo: ${CM.esc(CM.checkLabel(d.photo.verdict))}.</p>` : ''}
      ${d.area && d.area.ward ? `<p class="tiny muted" style="margin:4px 0 0">Area: ${CM.esc(d.area.ward)} (nearest ward centre — approximate).</p>` : ''}
      ${d.asset_match ? `<p class="tiny muted" style="margin:4px 0 0">Likely related to ${CM.esc(d.asset_match.type_label)} ${CM.esc(d.asset_match.asset_code)} (${Math.round(d.asset_match.distance_m)} m away).</p>` : ''}
      <p class="small" style="margin:10px 0 0"><strong>What happens next:</strong> ${CM.esc(d.next_step)}</p>
    </div>`;
  $('copyCode').addEventListener('click', () => {
    navigator.clipboard?.writeText(d.tracking_code).then(() => CM.toast('Tracking code copied', 'ok'), () => {});
  });
}

/* ---------- stats & my complaints ---------- */
async function loadStats() {
  try {
    const d = await CM.api('/api/dashboard/citizen');
    $('mMine').textContent = d.my_complaints; $('mProgress').textContent = d.in_progress;
    $('mResolved').textContent = d.resolved; $('mJoined').textContent = d.incidents_joined;
  } catch { /* shown elsewhere */ }
}

async function loadMine() {
  const box = $('myComplaints');
  try {
    const rows = await CM.api('/api/complaints?limit=100');
    $('mineCount').textContent = rows.length;
    if (!rows.length) { box.innerHTML = '<div class="card empty">You have not reported anything yet. Use the form above to report your first issue.</div>'; return; }
    box.innerHTML = rows.map(complaintCard).join('');
    CM.hydrateImages(box);
  } catch (e) { box.innerHTML = `<div class="card empty">Could not load your reports. ${CM.esc(e.message)}</div>`; }
}

function complaintCard(c) {
  const si = stepIndex(c.status);
  const steps = STEPS.map((lbl, i) => {
    const cls = c.status === 'rejected' ? '' : (i < si || (i === si && c.status === 'resolved') ? 'done' : (i === si ? 'current' : ''));
    return `<div class="step ${cls}"><div class="bubble">${cls === 'done' ? '✓' : i + 1}</div><div class="lbl">${lbl}</div></div>`;
  }).join('');
  const inc = c.incident ? `<a class="btn sm ghost" href="incident.html?id=${encodeURIComponent(c.incident.id)}">Incident ${CM.esc(c.incident.public_id)} →</a>` : '';
  return `
    <article class="card">
      <div class="row spread wrap-row">
        <div class="row wrap-row">
          <span class="badge cat">${CM.esc(c.category)}</span>
          <strong class="small">${CM.esc(c.public_id)}</strong>
          <span class="muted small">${CM.esc(c.ward || '')}</span>
        </div>
        <span class="badge ${CM.sClass(c.status)}">${CM.esc(CM.statusText(c.status))}</span>
      </div>
      <div class="complaint-body">
        ${c.has_photo ? `<img class="thumb" alt="Your photo" data-auth-src="/api/complaints/${c.id}/photo"/>` : ''}
        <p class="small" style="margin:0">${CM.esc(c.description)}</p>
      </div>
      <div class="track" aria-label="Progress">${steps}</div>
      <p class="small" style="margin:6px 0"><strong>Next:</strong> ${CM.esc(c.next_step)}</p>
      ${c.status === 'resolved' && c.resolved_by_name ? `<p class="small muted" style="margin:0 0 6px">Resolved by officer ${CM.esc(c.resolved_by_name)} on ${CM.esc(CM.fmtDay(c.resolved_at))}.</p>` : ''}
      <div class="row spread wrap-row tiny muted">
        <span>Tracking code <code>${CM.esc(c.tracking_code || '—')}</code> · submitted ${CM.esc(CM.fmtDate(c.created_at))} · updated ${CM.esc(CM.timeAgo(c.updated_at))}</span>
        ${inc}
      </div>
    </article>`;
}

/* ---------- tracking ---------- */
async function trackComplaint(e) {
  e.preventDefault();
  const code = $('trackId').value.trim().toUpperCase();
  const el = $('trackResult');
  if (!code) return;
  try {
    const d = await CM.api('/api/track/' + encodeURIComponent(code));
    el.innerHTML = `<div class="card tight">
        <div class="row spread"><strong>${CM.esc(d.public_id)}</strong>
        <span class="badge ${CM.sClass(d.status)}">${CM.esc(CM.statusText(d.status))}</span></div>
        <p class="small muted" style="margin:8px 0 4px">${CM.esc(d.category)} · ${CM.esc(d.ward || '')} · submitted ${CM.esc(d.submitted_on)}</p>
        ${d.incident ? `<p class="small" style="margin:0">Part of incident ${CM.esc(d.incident.public_id)} (${CM.esc(d.incident.report_count)} reports) — ${CM.esc(CM.statusText(d.incident.status))}</p>` : ''}
        <p class="small" style="margin:6px 0 0">${CM.esc(d.next_step)}</p></div>`;
  } catch (ex) { el.innerHTML = `<p class="small text-red">${CM.esc(ex.message)}</p>`; }
}

/* ---------- updates feed + real-time ---------- */
async function loadFeed() {
  try { renderFeed((await CM.api('/api/notifications')).items.slice(0, 10)); } catch { /* ignore */ }
}
function renderFeed(notifs) {
  const box = $('liveFeed');
  box.innerHTML = '';
  if (!notifs || !notifs.length) { box.innerHTML = emptyState('No updates yet.'); return; }
  notifs.forEach(n => box.appendChild(noteItem(n)));
}

let pollTimer = null;
function startPolling() {
  $('liveDot').textContent = 'Auto-refresh every 15 s';
  if (pollTimer) return;
  pollTimer = setInterval(() => { if (!document.hidden) { loadMine(); loadStats(); loadFeed(); } }, 15000);
}
function subscribe() {
  const token = CM.getToken();
  if (!token || typeof EventSource === 'undefined') return startPolling();
  let lastSig = '', failures = 0;
  const es = new EventSource('api/stream?token=' + encodeURIComponent(token));
  es.addEventListener('update', (ev) => {
    failures = 0;
    $('liveDot').textContent = 'Live updates on';
    let snap; try { snap = JSON.parse(ev.data); } catch { return; }
    renderFeed(snap.notifications);
    const sig = JSON.stringify(snap.complaints.map(c => c.public_id + c.status + c.updated_at));
    if (lastSig && sig !== lastSig) { loadMine(); loadStats(); }
    lastSig = sig;
    refreshBell();
  });
  es.addEventListener('denied', () => { es.close(); CM.clearSession(); location.href = 'index.html?expired=1'; });
  es.onerror = () => {
    failures += 1;
    // CLOSED = the server refused the stream (e.g. expired session) — the browser won't retry.
    if (es.readyState === EventSource.CLOSED || failures >= 3) { es.close(); startPolling(); }
  };
}
