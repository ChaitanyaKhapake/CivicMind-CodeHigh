/* CivicMind — citizen page: report, track, live updates */
const user = CM.requireAuth(['citizen']);
const $ = (id) => document.getElementById(id);
let pickLat = null, pickLng = null, pinSet = false, pickMarker = null, pickMap = null;
let CFG = { categories: [], city_center: { lat: 18.5204, lng: 73.8567 }, require_issue_photo: false };
let assist = null, assistStale = false;   // last assistant suggestion (never submitted automatically)
let locSource = 'map', locAccuracy = null, geocoded = null;   // how the pin was set (stored with the report)
let recorder = null, voice = null;          // voice: { id, transcript, status } after upload
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
  $('reportForm').addEventListener('submit', reviewComplaint);
  $('reviewEdit').addEventListener('click', () => { $('reviewPanel').hidden = true; $('reportForm').hidden = false; });
  $('reviewSend').addEventListener('click', sendComplaint);
  $('trackForm').addEventListener('submit', trackComplaint);
  $('geoBtn').addEventListener('click', useGeo);
  $('photo').addEventListener('change', previewPhoto);
  $('photoRemove').addEventListener('click', () => { $('photo').value = ''; previewPhoto(); $('photo').click(); });
  $('recBtn').addEventListener('click', startRecording);
  $('recStop').addEventListener('click', () => recorder && recorder.stop());
  $('recDiscard').addEventListener('click', discardRecording);
  $('useTranscript').addEventListener('click', () => {
    $('description').value = $('transcript').value.trim(); $('descCount').textContent = $('description').value.length;
    markAssistStale(); CM.toast(I18N.t('rec_used'), 'ok'); });
  $('recLang').value = ['en', 'hi', 'mr'].includes(I18N.lang) ? I18N.lang : 'en';
  initChat();
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
  pickMarker.on('dragend', () => setPin(pickMarker.getLatLng().lat, pickMarker.getLatLng().lng, false));
  pickMap.on('click', e => setPin(e.latlng.lat, e.latlng.lng, false));
  setTimeout(() => pickMap.invalidateSize(), 200);
}
function setPin(lat, lng, fromDevice) {
  pickLat = lat; pickLng = lng; pinSet = true;
  if (pickMarker) pickMarker.setLatLng([lat, lng]);
  if (fromDevice) locSource = 'device';
  else if (locSource === 'device' || locSource === 'device_adjusted') locSource = 'device_adjusted';
  else locSource = 'map';
  $('locText').textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
function useGeo() {
  const info = $('geoInfo');
  if (!navigator.geolocation) { info.textContent = I18N.t('geo_unsupported'); return; }
  info.textContent = I18N.t('geo_asking');
  navigator.geolocation.getCurrentPosition(async (p) => {
    const { latitude: lat, longitude: lng, accuracy } = p.coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { info.textContent = I18N.t('geo_failed'); return; }
    setPin(lat, lng, true); locAccuracy = Math.round(accuracy || 0) || null;
    if (pickMap) pickMap.setView([lat, lng], 17);
    info.textContent = I18N.t('geo_found') + (locAccuracy ? ` (±${locAccuracy} m)` : '') + ' ' + I18N.t('geo_adjust');
    try {
      const g = await CM.api(`/api/geo/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      if (g.available) {
        geocoded = g.address;
        if (!$('address').value.trim()) $('address').value = (g.landmark || g.address).slice(0, 300);
        info.textContent += ' ' + I18N.t('geo_address') + ' ' + g.address + ' — ' + g.attribution;
      } else {
        geocoded = null; info.textContent += ' ' + (g.message || I18N.t('geo_no_address'));
      }
    } catch { info.textContent += ' ' + I18N.t('geo_no_address'); }
  }, (err) => {
    info.textContent = err && err.code === 1 ? I18N.t('geo_denied') : I18N.t('geo_failed');
  }, { timeout: 12000, enableHighAccuracy: true, maximumAge: 30000 });
}

/* ---------- photo (mandatory) ---------- */
function previewPhoto() {
  const f = $('photo').files[0];
  const box = $('photoPreview');
  if (!f) { box.hidden = true; $('photoImg').removeAttribute('src'); return; }
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) {
    $('photo').value = ''; box.hidden = true; CM.toast(I18N.t('photo_invalid'), 'err'); return;
  }
  $('photoImg').src = URL.createObjectURL(f); box.hidden = false;
}

/* ---------- voice description (≤ 15 s, transcribed on the server) ---------- */
async function startRecording() {
  discardRecording();
  try {
    recorder = await VoiceRecorder.start({
      onTick: (sec) => { $('recTime').textContent = sec.toFixed(1); },
      onStop: (blob, seconds) => finishRecording(blob, seconds),
    });
  } catch (e) {
    CM.toast(e && e.name === 'NotAllowedError' ? I18N.t('rec_denied') : (e.message || I18N.t('rec_failed')), 'err'); return;
  }
  $('recBtn').hidden = true; $('recStop').hidden = false; $('recDot').hidden = false;
}

async function finishRecording(blob, seconds) {
  recorder = null;
  $('recBtn').hidden = false; $('recStop').hidden = true; $('recDot').hidden = true;
  $('recAudio').src = URL.createObjectURL(blob); $('recReview').hidden = false;
  $('recStatus').textContent = I18N.t('rec_uploading');
  try {
    const d = await CM.api('/api/voice', { method: 'POST', body: { audio: await VoiceRecorder.toDataURL(blob), language: $('recLang').value } });
    voice = { id: d.voice_id, transcript: d.transcript, status: d.transcription_status };
    $('recStatus').textContent = `${d.duration_s.toFixed(1)} s · ${d.message}`;
    $('recDisclosure').textContent = d.disclosure;
    if (d.transcript) { $('transcript').value = d.transcript; $('transcriptBox').hidden = false; }
  } catch (e) { voice = null; $('recStatus').textContent = e.message + ' ' + I18N.t('rec_type_instead'); }
}

function discardRecording() {
  if (recorder) { const r = recorder; recorder = null; r.stop(); }
  voice = null; $('recReview').hidden = true; $('transcriptBox').hidden = true; $('transcript').value = '';
  $('recAudio').removeAttribute('src'); $('recStatus').textContent = '';
}

/* ---------- submit: validate -> review -> send ---------- */
function formProblems() {
  const problems = [];
  if (!$('category').value) problems.push(I18N.t('err_category'));
  if ($('description').value.trim().length < 10) problems.push(I18N.t('err_description'));
  if (!pinSet) problems.push(I18N.t('err_location'));
  if (!$('photo').files[0]) problems.push(I18N.t('err_photo'));
  return problems;
}

function reviewComplaint(e) {
  e.preventDefault();
  const err = $('formError'); err.hidden = true;
  const problems = formProblems();
  if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; return; }
  const t = I18N.t, inc = $('includeTr');
  $('reviewBody').innerHTML = `
    <div class="kv"><span class="muted small">${CM.esc(t('category'))}</span><span class="small">${CM.esc($('category').value)}</span></div>
    <div class="small" style="margin:8px 0"><strong>${CM.esc(t('problem'))}</strong><p style="margin:4px 0;white-space:pre-line">${CM.esc($('description').value.trim())}</p></div>
    ${voice ? `<p class="tiny muted">${CM.esc(t('review_voice'))}</p>` : ''}
    ${inc && inc.checked ? `<p class="tiny muted">${CM.esc(t('review_translation'))}</p>` : ''}
    <div class="kv"><span class="muted small">${CM.esc(t('location'))}</span><span class="small">${CM.esc(pickLat.toFixed(5))}, ${CM.esc(pickLng.toFixed(5))}${locAccuracy ? ' (±' + CM.esc(locAccuracy) + ' m)' : ''}</span></div>
    ${$('address').value.trim() ? `<div class="kv"><span class="muted small">${CM.esc(t('address'))}</span><span class="small">${CM.esc($('address').value.trim())}</span></div>` : ''}
    <img class="thumb" alt="" src="${CM.esc($('photoImg').src)}" style="margin-top:8px"/>
    <p class="tiny muted" style="margin-top:8px">${CM.esc(t('review_privacy'))}</p>`;
  $('reportForm').hidden = true; $('reviewPanel').hidden = false; $('reviewSend').focus();
}

async function sendComplaint() {
  const err = $('formError'); err.hidden = true;
  await CM.busy($('reviewSend'), '…', async () => {
    try {
      // `description` is always exactly what the citizen wrote or chose; an AI transcript or translation
      // is never substituted silently and is stored separately.
      const body = { category: $('category').value, description: $('description').value.trim(),
                     latitude: pickLat, longitude: pickLng, address: $('address').value.trim() || null,
                     language: I18N.lang, location_source: locSource, location_accuracy_m: locAccuracy,
                     geocoded_address: geocoded, image: await CM.fileToDataURL($('photo').files[0]) };
      const inc = $('includeTr');
      if (assist && !assistStale && inc && inc.checked && $('trText').value.trim()) body.translation_en = $('trText').value.trim();
      if (assist && !assistStale) body.assistant_engine = assist.suggestion.engine;
      if (voice) body.voice_id = voice.id;
      const d = await CM.api('/api/complaints', { method: 'POST', body });
      showResult(d);
      $('reportForm').reset(); $('descCount').textContent = '0'; pinSet = false; clearAssist(); discardRecording(); previewPhoto();
      locSource = 'map'; locAccuracy = null; geocoded = null; $('geoInfo').textContent = '';
      $('locText').textContent = I18N.t('loc_hint');
      $('reviewPanel').hidden = true; $('reportForm').hidden = false;
      loadStats(); loadMine(); loadFeed();
    } catch (ex) {
      $('reviewPanel').hidden = true; $('reportForm').hidden = false;
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
      ${estimateLine(c.estimate)}
      ${c.voice ? `<p class="tiny muted" style="margin:4px 0">🎤 ${CM.esc(I18N.t('card_voice'))} ${c.voice.transcript ? '— ' + CM.esc(c.voice.transcript) : '(' + CM.esc(c.voice.transcription_status) + ')'}</p>` : ''}
      ${(c.resolution_photos || []).length ? `<div class="row wrap-row" style="gap:6px;margin:6px 0">${c.resolution_photos.map(p =>
        `<img class="thumb sm" alt="${CM.esc(p.label)}" title="${CM.esc(p.label)}" data-auth-src="${CM.esc(p.url)}"/>`).join('')}</div>` : ''}
      ${(c.history || []).length ? `<details class="small"><summary>${CM.esc(I18N.t('history'))} (${c.history.length})</summary>
        <div class="timeline" style="margin-top:6px">${c.history.map(h => `<div class="tl-item"><div class="tl-t">${CM.esc(h.label)}</div>
          <div class="tl-d">${CM.esc(CM.fmtDate(h.at))}</div></div>`).join('')}</div></details>` : ''}
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

function estimateLine(e) {
  if (!e) return '';
  const label = { actual: I18N.t('est_actual'), scheduled: I18N.t('est_scheduled'), estimated: I18N.t('est_estimated'),
                  pending: I18N.t('est_pending') }[e.kind] || e.kind;
  return `<p class="tiny" style="margin:2px 0"><strong>${CM.esc(label)}</strong>${e.at ? ': ' + CM.esc(CM.fmtDate(e.at)) : ''}
    <span class="muted">· ${CM.esc(e.basis)}</span></p>`;
}

/* ---------- civic help chatbot ---------- */
function initChat() {
  addChat('bot', I18N.t('chat_hello'));
  renderSuggestions(null);
  $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('chatInput').value); });
  $('chatSuggest').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) sendChat(b.dataset.q); });
  $('chatLog').addEventListener('click', (e) => { const b = e.target.closest('[data-draft]'); if (b) useDraft(JSON.parse(b.dataset.draft)); });
}
function renderSuggestions(list) {
  const qs = list || { en: ['How do I report a problem?', 'What photo do I need?', 'Status of my complaints'],
                       hi: ['समस्या कैसे दर्ज करें?', 'कौन-सी फ़ोटो चाहिए?', 'मेरी शिकायत की स्थिति'],
                       mr: ['समस्या कशी नोंदवायची?', 'कोणता फोटो लागतो?', 'माझी तक्रार कुठे आहे?'] }[I18N.lang] || [];
  $('chatSuggest').innerHTML = qs.map(q => `<button type="button" class="chip" data-q="${CM.esc(q)}">${CM.esc(q)}</button>`).join('');
}
function addChat(who, text, draft) {
  const row = document.createElement('div');
  row.className = 'chat-msg ' + who;
  const p = document.createElement('div'); p.className = 'bubble-text'; p.textContent = text;   // plain text only
  row.appendChild(p);
  if (draft) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm'; b.textContent = I18N.t('chat_use_draft');
    b.dataset.draft = JSON.stringify(draft); row.appendChild(b);
  }
  $('chatLog').appendChild(row); $('chatLog').scrollTop = $('chatLog').scrollHeight;
}
async function sendChat(text) {
  text = (text || '').trim();
  if (!text) return;
  $('chatInput').value = '';
  addChat('me', text);
  try {
    const r = await CM.api('/api/assistant/chat', { method: 'POST', body: { message: text, language: I18N.lang } });
    addChat('bot', r.reply, r.draft);
    if (r.suggestions) renderSuggestions(r.suggestions);
  } catch (e) { addChat('bot', e.message); }
}
function useDraft(d) {
  if ([...$('category').options].some(o => o.value === d.category)) $('category').value = d.category;
  $('description').value = d.description; $('descCount').textContent = d.description.length; markAssistStale();
  $('reportForm').scrollIntoView({ behavior: 'smooth' }); $('description').focus();
  CM.toast(I18N.t('chat_draft_used'), 'ok');
}
