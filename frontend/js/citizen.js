/* CivicMind — citizen page: report, track, live updates */
const user = CM.requireAuth(['citizen']);
const $ = (id) => document.getElementById(id);
let pickLat = null, pickLng = null, pinSet = false, pickMarker = null, pickMap = null;
let CFG = { categories: [], city_center: { lat: 18.5204, lng: 73.8567 }, require_issue_photo: false };
let assist = null, assistStale = false;   // last assistant suggestion (never submitted automatically)
const LANG_KEY = 'cm_lang';

const STEPS = () => [I18N.t('step1'), I18N.t('step2'), I18N.t('step3'), I18N.t('step4')];
// Status names and "what happens next" in the citizen's language (fixed texts; English comes from the server).
const stText = (s) => (I18N.lang !== 'en' && I18N.t('st_' + s) !== 'st_' + s) ? I18N.t('st_' + s) : CM.statusText(s);
const nextText = (s, fallback) => (I18N.lang !== 'en' && I18N.t('next_' + s) !== 'next_' + s) ? I18N.t('next_' + s) : fallback;
const stepIndex = (s) => ({ submitted: 0, clustered: 1, in_progress: 2, resolved: 3 }[s] ?? 0);

document.addEventListener('DOMContentLoaded', async () => {
  if (!user) return;
  $('userName').textContent = (user.name || '').split(' ')[0] || 'there';
  renderNav('citizen.html', user);
  try { CFG = await CM.api('/api/config'); } catch (e) { CM.fail(e); }
  CFG.categories.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; $('category').appendChild(o); });
  if (CFG.require_issue_photo) $('photo').required = true;
  initLanguage();
  pickLat = CFG.city_center.lat; pickLng = CFG.city_center.lng;
  initPicker();
  $('description').addEventListener('input', () => {
    $('descCount').textContent = $('description').value.length;
    markAssistStale();
  });
  $('assistBtn').addEventListener('click', runAssistant);
  $('reportForm').addEventListener('submit', submitComplaint);
  $('trackForm').addEventListener('submit', trackComplaint);
  $('geoBtn').addEventListener('click', useGeo);
  loadStats(); loadMine(); loadFeed(); subscribe();
});

/* ---------- language ---------- */
function storedLang() { try { return localStorage.getItem(LANG_KEY); } catch { return null; } }
function initLanguage() {
  const sel = $('lang');
  I18N.LANGS.forEach(([code, label]) => { const o = document.createElement('option'); o.value = code; o.textContent = label; sel.appendChild(o); });
  sel.value = user.preferred_language || storedLang() || 'en';
  applyLanguage(sel.value);
  sel.addEventListener('change', async () => {
    applyLanguage(sel.value);
    try { localStorage.setItem(LANG_KEY, sel.value); } catch { /* private mode */ }
    clearAssist(); loadMine();
    try {
      await CM.api('/api/auth/preferences', { method: 'POST', body: { preferred_language: sel.value } });
      CM.setSession(CM.getToken(), { ...CM.getUser(), preferred_language: sel.value });
    } catch { /* the preference is a convenience; the page still works */ }
  });
}
function applyLanguage(lang) {
  I18N.apply(lang);
  if (CFG.require_issue_photo) $('photoReq').textContent = I18N.t('required');
  if (pinSet) $('locText').textContent = `📍 ${pickLat.toFixed(5)}, ${pickLng.toFixed(5)}`;
}

/* ---------- complaint assistant (suggestions only; the citizen decides) ---------- */
function clearAssist() { assist = null; assistStale = false; $('assistPanel').hidden = true; $('assistPanel').innerHTML = ''; }
function markAssistStale() {
  if (!assist || assistStale || $('description').value === assist.original_text) return;
  assistStale = true;
  const inc = $('includeTr');
  if (inc) { inc.checked = false; inc.disabled = true; }
  const note = document.createElement('p');
  note.className = 'small text-red';
  note.textContent = I18N.t('a_stale');
  $('assistPanel').prepend(note);
}

async function runAssistant() {
  const text = $('description').value;
  if (text.trim().length < 10) return CM.toast(I18N.t('a_too_short'), 'err');
  await CM.busy($('assistBtn'), '…', async () => {
    try {
      const d = await CM.api('/api/assistant/complaint', { method: 'POST',
        body: { text, language: I18N.lang, category_hint: $('category').value || null } });
      assist = d; assistStale = false;
      renderAssist(d);
    } catch (e) { CM.fail(e); }
  });
}

function renderAssist(d) {
  const s = d.suggestion, p = $('assistPanel'), t = I18N.t;
  const items = (arr) => arr.map(x => `<li>${CM.esc(x)}</li>`).join('');
  p.innerHTML = `
    <div class="row spread wrap-row"><strong>${CM.esc(t('a_title'))}</strong>
      <span class="badge">${CM.esc(s.engine === 'rules' ? t('a_rules') : t('a_ai'))}</span></div>
    ${d.language_mismatch ? `<p class="small text-red" style="margin:8px 0 0">${CM.esc(t('a_mismatch'))}</p>` : ''}
    <div class="kv"><span class="small muted">${CM.esc(t('a_suggested'))}</span>
      <span class="small"><strong>${CM.esc(s.category)}</strong> · ${CM.esc(s.department)}
        <button type="button" class="btn sm" id="useCat" style="margin-left:6px">${CM.esc(t('a_use'))}</button></span></div>
    <div class="kv"><span class="small muted">${CM.esc(t('a_severity'))}</span><span class="small">${CM.esc(s.severity)}/5</span></div>
    ${s.urgency_indicators.length ? `<div class="kv"><span class="small muted">${CM.esc(t('a_urgency'))}</span><span class="small">${CM.esc(s.urgency_indicators.join(', '))}</span></div>` : ''}
    ${s.follow_up_questions.length ? `<p class="small" style="margin:10px 0 2px"><strong>${CM.esc(t('a_questions'))}</strong></p><ul class="small" style="margin:0;padding-left:18px">${items(s.follow_up_questions)}</ul>` : ''}
    ${s.mentioned_places.length ? `<p class="tiny muted" style="margin:8px 0 0">${CM.esc(t('a_places'))}: ${CM.esc(s.mentioned_places.join(', '))}</p>` : ''}
    ${d.translation ? `<div class="field" style="margin:12px 0 0"><label class="f" for="trText">${CM.esc(t('a_translation'))}</label>
        <textarea id="trText" maxlength="2000" rows="3"></textarea>
        <label class="check-row"><input type="checkbox" id="includeTr"/><span>${CM.esc(t('a_include'))}</span></label></div>`
      : (d.translation_message ? `<div class="notice info">${CM.esc(d.translation_message)}</div>` : '')}
    <p class="tiny muted" style="margin:10px 0 0">${CM.esc(t('a_review'))}</p>`;
  if (d.translation) $('trText').value = d.translation.text;
  $('useCat').addEventListener('click', (ev) => { $('category').value = s.category; ev.target.textContent = t('a_used'); });
  p.hidden = false;
}

/* ---------- map picker ---------- */
function initPicker() {
  if (typeof L === 'undefined') { $('pickmap').innerHTML = emptyState('Map could not load. Use “Use my location”.'); return; }
  pickMap = L.map('pickmap').setView([pickLat, pickLng], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(pickMap);
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
      // `description` is always exactly what the citizen wrote; a translation is sent only
      // when they explicitly ticked that they reviewed it.
      const body = { category, description, latitude: pickLat, longitude: pickLng,
                     address: $('address').value.trim() || null, language: I18N.lang };
      const inc = $('includeTr');
      if (assist && !assistStale && inc && inc.checked && $('trText').value.trim()) body.translation_en = $('trText').value.trim();
      if (assist && !assistStale) body.assistant_engine = assist.suggestion.engine;
      if (file) body.image = await CM.fileToDataURL(file);
      const d = await CM.api('/api/complaints', { method: 'POST', body });
      showResult(d);
      $('reportForm').reset(); $('descCount').textContent = '0'; pinSet = false; clearAssist();
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
  const steps = STEPS().map((lbl, i) => {
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
        <span class="badge ${CM.sClass(c.status)}">${CM.esc(stText(c.status))}</span>
      </div>
      <div class="complaint-body">
        ${c.has_photo ? `<img class="thumb" alt="Your photo" data-auth-src="/api/complaints/${c.id}/photo"/>` : ''}
        <div>
          <p class="small" style="margin:0">${CM.esc(c.description)}</p>
          ${c.language && c.language.translation_en ? `<p class="tiny muted" style="margin:6px 0 0">English translation you reviewed: ${CM.esc(c.language.translation_en)}</p>` : ''}
        </div>
      </div>
      <div class="track" aria-label="Progress">${steps}</div>
      <p class="small" style="margin:6px 0"><strong>${CM.esc(I18N.t('next'))}:</strong> ${CM.esc(nextText(c.status, c.next_step))}</p>
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
        <span class="badge ${CM.sClass(d.status)}">${CM.esc(stText(d.status))}</span></div>
        <p class="small muted" style="margin:8px 0 4px">${CM.esc(d.category)} · ${CM.esc(d.ward || '')} · submitted ${CM.esc(d.submitted_on)}</p>
        ${d.incident ? `<p class="small" style="margin:0">Part of incident ${CM.esc(d.incident.public_id)} (${CM.esc(d.incident.report_count)} reports) — ${CM.esc(CM.statusText(d.incident.status))}</p>` : ''}
        <p class="small" style="margin:6px 0 0">${CM.esc(nextText(d.status, d.next_step))}</p></div>`;
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
