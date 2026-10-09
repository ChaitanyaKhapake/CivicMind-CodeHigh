/* CivicMind — incident detail: evidence, AI investigation, action, execution, verification */
const user = CM.requireAuth();
let inc = null, miniMap = null;
const isOfficer = user && ['officer', 'admin'].includes(user.role);
const id = new URLSearchParams(location.search).get('id');

const EXEC_STEPS = ['Plan', 'Approved', 'In progress', 'Completed'];
const STATUS_STEP = { active: 0, investigating: 0, action_pending: 0, in_progress: 1, reopened: 1, resolved: 3 };

document.addEventListener('DOMContentLoaded', () => {
  if (!user) return;
  renderNav('', user);
  if (!id) { document.getElementById('loading').innerHTML = '<div class="empty">No incident specified.</div>'; return; }
  load();
});

async function load() {
  try {
    inc = await CM.api('/api/incidents/' + encodeURIComponent(id));
    render();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';
  } catch (e) {
    document.getElementById('loading').innerHTML = `<div class="empty">${CM.esc(e.message)}</div>`;
  }
}

function render() {
  const inv = inc.investigation || {};
  const action = inc.actions[0] || null;
  const res = inc.resolution;
  const stepIdx = STATUS_STEP[inc.status] ?? 0;

  document.getElementById('content').innerHTML = `
  <!-- header -->
  <div class="card" style="border-left:5px solid ${prioColor(inc.priority_label)}">
    <div class="row spread wrap-row">
      <div>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <span class="badge ${CM.pClass(inc.priority_label)}">${inc.priority_label} · ${inc.priority_score}</span>
          <span class="badge ${CM.sClass(inc.status)}">${CM.titleCase(inc.status)}</span>
          <span class="badge">${CM.esc(inc.public_id)}</span>
        </div>
        <h1 style="margin:12px 0 4px">${CM.esc(inc.title)}</h1>
        <p class="muted small" style="margin:0">📍 ${CM.esc(inc.ward || '—')} · ${CM.esc(inc.zone || '')} zone &nbsp;·&nbsp; opened ${CM.fmtDate(inc.created_at)}</p>
      </div>
      <div class="stat-strip">
        <div class="s"><div class="n">${inc.report_count}</div><div class="l">Reports fused</div></div>
        <div class="s"><div class="n">${Math.round((inc.confidence||0)*100)}%</div><div class="l">Confidence</div></div>
        <div class="s"><div class="n">${CM.num(inc.affected_people)}</div><div class="l">People affected</div></div>
      </div>
    </div>
  </div>

  <div class="detail-grid" style="margin-top:18px">
    <div>
      <!-- AI investigation -->
      <div class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>🧠 AI investigation</h3><span class="badge" style="background:var(--purple-050);color:var(--purple)">${inv.engine === 'sarvam' ? 'Sarvam AI' : 'Deterministic'}</span></div>
        <p>${CM.esc(inv.summary || inc.summary || '—')}</p>
        <div class="grid g2" style="gap:14px;margin-top:8px">
          <div>
            <div class="eyebrow" style="color:var(--blue)">Probable cause</div>
            <p class="small">${CM.esc(inv.probable_cause || inc.probable_cause || '—')}</p>
            <div class="eyebrow" style="color:var(--green)">Why linked</div>
            <ul class="small" style="padding-left:18px;margin:4px 0">${list(inv.why_linked)}</ul>
          </div>
          <div>
            <div class="eyebrow" style="color:var(--orange)">Supporting evidence</div>
            <ul class="small" style="padding-left:18px;margin:4px 0">${list(inv.supporting_evidence)}</ul>
            <div class="eyebrow" style="color:var(--red)">Conflicting / weak</div>
            <ul class="small" style="padding-left:18px;margin:4px 0">${list(inv.conflicting_evidence)}</ul>
          </div>
        </div>
        <div class="divider"></div>
        <div class="grid g2" style="gap:14px">
          <div><div class="eyebrow">Estimated impact</div><p class="small">${CM.esc(inv.impact || '—')}</p></div>
          <div><div class="eyebrow" style="color:var(--purple)">Check next</div><ul class="small" style="padding-left:18px;margin:4px 0">${list(inv.next_checks)}</ul></div>
        </div>
        ${isOfficer ? `<button class="btn sm ghost" style="margin-top:10px" onclick="rerunInvestigation()">↻ Re-run AI investigation</button>` : ''}
      </div>

      <!-- response plan -->
      <div class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>📋 Response plan</h3>${action ? `<span class="badge ${CM.sClass(action.status)}">${CM.titleCase(action.status)}</span>` : ''}</div>
        ${action ? `
          <div id="planView">
            <p style="font-weight:700;margin-bottom:10px">${CM.esc(action.action_text)}</p>
            <div class="grid g3" style="gap:10px">
              <div class="kv" style="display:block"><div class="k">Assigned team</div><div class="v small">${CM.esc(action.assigned_team || '—')}</div></div>
              <div class="kv" style="display:block"><div class="k">Department</div><div class="v small">${CM.esc(action.department || '—')}</div></div>
              <div class="kv" style="display:block"><div class="k">Estimated time</div><div class="v small">${action.eta_hours || '—'} hrs</div></div>
            </div>
            <div class="eyebrow" style="margin-top:12px">Inspection checklist</div>
            <ul class="small" style="padding-left:18px;margin:4px 0">${list(action.checklist)}</ul>
          </div>
          <div id="planEdit" style="display:none">
            <div class="field"><label class="f">Action</label><textarea id="eText">${CM.esc(action.action_text)}</textarea></div>
            <div class="grid g3" style="gap:10px">
              <div class="field"><label class="f">Team</label><input id="eTeam" value="${CM.esc(action.assigned_team || '')}"/></div>
              <div class="field"><label class="f">Department</label><input id="eDept" value="${CM.esc(action.department || '')}"/></div>
              <div class="field"><label class="f">ETA (hrs)</label><input id="eEta" type="number" value="${action.eta_hours || 24}"/></div>
            </div>
            <div class="field"><label class="f">Checklist (one per line)</label><textarea id="eCheck">${(action.checklist || []).join('\n')}</textarea></div>
          </div>
          ${isOfficer ? actionButtons(action) : '<p class="hint">Awaiting officer review.</p>'}
        ` : '<p class="muted small">No response plan yet.</p>'}
      </div>

      <!-- execution -->
      <div class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>🛠️ Execution tracking</h3></div>
        <div class="track">
          ${EXEC_STEPS.map((s, i) => `<div class="step ${i < stepIdx ? 'done' : (i === stepIdx ? 'current' : '')}">
            <div class="bubble">${i < stepIdx ? '✓' : i + 1}</div><div class="lbl">${s}</div></div>`).join('')}
        </div>
        <div class="timeline" style="margin-top:14px">
          ${action && action.created_at ? `<div class="tl-item"><div class="tl-t">Plan generated</div><div class="tl-d">${CM.fmtDate(action.created_at)}</div></div>` : ''}
          ${action && action.approved_at ? `<div class="tl-item"><div class="tl-t">Approved by officer</div><div class="tl-d">${CM.fmtDate(action.approved_at)}</div></div>` : ''}
          ${action && action.started_at ? `<div class="tl-item"><div class="tl-t">Work started</div><div class="tl-d">${CM.fmtDate(action.started_at)}</div></div>` : ''}
          ${action && action.completed_at ? `<div class="tl-item"><div class="tl-t">Work completed</div><div class="tl-d">${CM.fmtDate(action.completed_at)}${action.notes ? ' · ' + CM.esc(action.notes) : ''}</div></div>` : ''}
        </div>
        ${isOfficer && action ? completeUI(action) : ''}
      </div>

      <!-- resolution -->
      ${res ? resolutionCard(res) : `
      <div class="card">
        <div class="card-h"><h3>✅ Resolution verification</h3></div>
        <p class="muted small">No verification yet. Once field work is complete, verify whether complaint signals actually dropped.</p>
        ${isOfficer ? `<button class="btn green sm" onclick="verifyNow()">Run resolution verification</button>` : ''}
      </div>`}
    </div>

    <!-- right column -->
    <div>
      <div class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>📍 Incident area</h3></div>
        <div id="mini" style="height:230px;border-radius:12px;border:1px solid var(--line-2)"></div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>Priority breakdown</h3><span class="badge ${CM.pClass(inc.priority_label)}">${inc.priority_score}</span></div>
        <div class="kv"><span class="k">Severity</span><span class="v">${inc.severity}/5</span></div>
        <div class="kv"><span class="k">Affected people</span><span class="v">${CM.num(inc.affected_people)}</span></div>
        <div class="kv"><span class="k">Geographic spread</span><span class="v">${inc.spread_km} km</span></div>
        <div class="kv"><span class="k">Duration</span><span class="v">${inc.duration_hours} hrs</span></div>
        <div class="kv"><span class="k">Category criticality</span><span class="v">${CM.esc(inc.category)}</span></div>
        <p class="tiny muted" style="margin-top:10px">${CM.esc(inc.priority_reason || '')}</p>
        <p class="tiny muted">Prototype scoring model — not an official municipal standard.</p>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>Evidence</h3><span class="badge">${inc.evidence.length}</span></div>
        ${inc.evidence.map(e => `<div class="evidence-item"><span>•</span><div><strong class="small">${CM.esc(e.evidence_type)}</strong><div class="small muted">${CM.esc(e.value)}</div></div></div>`).join('') || '<div class="empty small">—</div>'}
      </div>

      <div class="card">
        <div class="card-h"><h3>Linked reports</h3><span class="badge">${inc.complaints.length}</span></div>
        <div style="max-height:300px;overflow:auto">
        ${inc.complaints.map(c => `<div class="evidence-item"><span>•</span><div class="grow">
            <strong class="small">${CM.esc(c.public_id)}</strong> <span class="badge ${CM.sClass(c.status)}">${CM.titleCase(c.status)}</span>
            <div class="small muted">${CM.esc(c.category)} · ${CM.esc(c.citizen_name || 'Citizen')} · ${CM.timeAgo(c.created_at)}</div>
          </div></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;

  drawMini();
}

/* ---------- buttons ---------- */
function actionButtons(a) {
  if (a.status === 'pending') return `
    <div class="row wrap-row" style="margin-top:14px">
      <button class="btn green" onclick="approve()">✔ Approve plan</button>
      <button class="btn" onclick="toggleEdit()">✎ Edit plan</button>
      <button class="btn red" onclick="reject()">✕ Reject</button>
      <button class="btn primary" id="saveEdit" style="display:none" onclick="saveEdit()">Save & approve</button>
    </div>`;
  if (a.status === 'approved') return `<button class="btn blue" style="margin-top:14px" onclick="startWork()">▶ Mark work in progress</button>`;
  if (a.status === 'in_progress') return `<p class="hint" style="margin-top:10px">Submit your proof of resolution in the Execution section below to close this incident.</p>`;
  return `<button class="btn" style="margin-top:14px" onclick="verifyNow()">↻ Re-verify resolution</button>`;
}

function completeUI(a) {
  if (a.status === 'completed') return `<div class="row" style="margin-top:14px"><span class="badge completed">✓ Work completed — proof submitted</span></div>`;
  if (a.status === 'rejected') return `<div class="row" style="margin-top:14px"><span class="badge reopened">Plan rejected</span></div>`;
  if (a.status === 'pending') return `<p class="hint" style="margin-top:10px">Approve the response plan first.</p>`;
  return `
    <div class="row wrap-row" style="margin-top:14px">
      <button class="btn green" onclick="toggleComplete()">✔ Mark completed &amp; submit proof</button>
    </div>
    <div id="completePanel" style="display:none;margin-top:12px">
      <div class="field">
        <label class="f">Proof-of-resolution photo <span style="color:var(--red)">*</span></label>
        <input type="file" id="proofFile" accept="image/*"/>
        <div class="hint">Required — the AI verifies this photo before the incident can be closed.</div>
      </div>
      <div class="field">
        <label class="f">Completion notes (optional)</label>
        <textarea id="proofNotes" style="min-height:60px" placeholder="e.g. Pipeline section replaced, road dried and reopened"></textarea>
      </div>
      <button class="btn primary" id="proofBtn" onclick="submitProof()">Submit proof &amp; close incident</button>
    </div>`;
}
function toggleComplete() {
  const p = document.getElementById('completePanel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}
async function submitProof() {
  const f = document.getElementById('proofFile').files[0];
  if (!f) { CM.toast('A proof-of-resolution photo is required.', 'err'); return; }
  const btn = document.getElementById('proofBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> AI is verifying your proof…';
  try {
    const proof = await fileToDataURL(f);
    const notes = document.getElementById('proofNotes').value;
    await CM.api(`/api/actions/${inc.actions[0].id}/complete`, { method: 'POST', body: { notes, proof } });
    CM.toast('Proof verified — incident closed', 'ok');
    load();
  } catch (e) {
    const r = e.detail && e.detail.reasons ? ' — ' + e.detail.reasons.join('; ') : '';
    CM.toast(e.message + r, 'err');
    btn.disabled = false; btn.textContent = 'Submit proof & close incident';
  }
}
const fileToDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

function toggleEdit() {
  const v = document.getElementById('planView'), e = document.getElementById('planEdit'), s = document.getElementById('saveEdit');
  const show = e.style.display === 'none';
  e.style.display = show ? 'block' : 'none';
  v.style.display = show ? 'none' : 'block';
  s.style.display = show ? 'inline-flex' : 'none';
}
async function approve() { await act(`/api/actions/${inc.actions[0].id}/approve`, {}); }
async function saveEdit() {
  await act(`/api/actions/${inc.actions[0].id}/approve`, {
    action_text: document.getElementById('eText').value,
    assigned_team: document.getElementById('eTeam').value,
    department: document.getElementById('eDept').value,
    eta_hours: Number(document.getElementById('eEta').value),
    checklist: document.getElementById('eCheck').value.split('\n').filter(Boolean),
  });
}
async function reject() {
  const reason = prompt('Reason for rejection?') || '';
  await act(`/api/actions/${inc.actions[0].id}/reject`, { reason });
}
async function startWork() { await act(`/api/actions/${inc.actions[0].id}/start`, {}); }
async function verifyNow() { await act(`/api/incidents/${inc.id}/verify`, {}); }
async function rerunInvestigation() { await act(`/api/incidents/${inc.id}/investigate`, {}); }

async function act(path, body) {
  try { await CM.api(path, { method: 'POST', body }); CM.toast('Updated', 'ok'); load(); }
  catch (e) { CM.toast(e.message, 'err'); }
}

/* ---------- helpers ---------- */
function list(arr) { return (arr && arr.length) ? arr.map(x => `<li>${CM.esc(x)}</li>`).join('') : '<li class="muted">—</li>'; }
function prioColor(l) { return ({ Critical:'#D9342B', High:'#E8551E', Medium:'#E0A106', Low:'#2E9E5B' }[l] || '#E8551E'); }

function resolutionCard(res) {
  const before = res.before_metric, after = res.after_metric;
  const good = res.status === 'verified';
  const pc = res.proof_check || {};
  const proofBlock = pc.verdict ? `
    <div class="divider"></div>
    <div class="eyebrow">AI proof-of-resolution check</div>
    <div class="row wrap-row" style="gap:8px;margin-top:6px">
      <span class="badge ${pc.verdict === 'verified' ? 'low' : 'medium'}">🔎 ${CM.titleCase(pc.verdict)} · ${Math.round((pc.confidence || 0) * 100)}%</span>
      <span class="badge" style="background:var(--surface)">${pc.engine === 'sarvam' ? 'Sarvam AI' : 'Rules'}</span>
    </div>
    <p class="tiny muted" style="margin-top:6px">${CM.esc(pc.note || '')}</p>` : '';
  return `
  <div class="card" style="border-left:5px solid ${good ? 'var(--green)' : 'var(--red)'}">
    <div class="card-h"><h3>✅ Resolution verification</h3>
      <span class="badge ${good ? 'resolved' : 'reopened'}">${good ? 'Verified resolved' : 'Reopened'}</span></div>
    <div class="before-after">
      <div class="ba-box"><div class="tiny muted">BEFORE</div><div class="n">${before}</div><div class="tiny muted">reports</div></div>
      <div class="arrow-big">→</div>
      <div class="ba-box after"><div class="tiny muted">AFTER</div><div class="n">${after}</div><div class="tiny muted">reports</div></div>
    </div>
    <div class="row spread" style="margin-top:14px">
      <span class="badge" style="background:var(--green-050);color:var(--green)">▼ ${res.reduction_pct}% reduction</span>
      <span class="badge">Confidence ${Math.round((res.resolution_confidence||0)*100)}%</span>
    </div>
    <p class="small" style="margin-top:12px">${CM.esc(res.summary || '')}</p>
    ${res.officer_name ? `<p class="small"><strong>Resolved by:</strong> ${CM.esc(res.officer_name)}</p>` : ''}
    ${proofBlock}
    ${res.proof_path ? `<div style="margin-top:12px"><div class="eyebrow">Proof of resolution</div>
      <img src="${res.proof_path}" alt="proof of resolution" style="max-width:100%;border-radius:10px;border:1px solid var(--line);margin-top:6px"/></div>` : ''}
    <p class="tiny muted" style="margin-top:10px">Verified ${CM.fmtDate(res.verified_at)}</p>
    ${isOfficer ? `<button class="btn sm ghost" style="margin-top:8px" onclick="verifyNow()">↻ Re-verify</button>` : ''}
  </div>`;
}

function drawMini() {
  setTimeout(() => {
    if (miniMap) { miniMap.remove(); miniMap = null; }
    miniMap = L.map('mini', { zoomControl: false, attributionControl: false }).setView([inc.centroid_lat, inc.centroid_lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(miniMap);
    const col = prioColor(inc.priority_label);
    L.circle([inc.centroid_lat, inc.centroid_lng], { radius: Math.max(300, (inc.spread_km || .5) * 1000),
      color: col, weight: 1.5, fillColor: col, fillOpacity: .15 }).addTo(miniMap);
    inc.complaints.forEach(c => L.circleMarker([c.latitude, c.longitude],
      { radius: 5, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: .9 }).addTo(miniMap));
    L.marker([inc.centroid_lat, inc.centroid_lng], { icon: L.divIcon({ className: '',
      html: `<div style="background:${col};width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>`, iconSize: [16, 16] }) }).addTo(miniMap);
    miniMap.invalidateSize();
  }, 120);
}
