/* CivicMind — incident workspace (officer/admin) and limited citizen view.
   All server/user text is escaped with CM.esc; actions use data-act attributes. */
const user = CM.requireAuth();
const isStaff = !!user && ['officer', 'admin'].includes(user.role);
const incidentId = new URLSearchParams(location.search).get('id');
const $ = (id) => document.getElementById(id);
let inc = null, miniMap = null;

const LIFECYCLE = ['Grouped', 'Plan approved', 'Work in progress', 'Completed + proof', 'Verified'];
function lifecycleIndex(i) {
  const a = i.current_action;
  if (i.status === 'resolved') return 5;
  if (a && a.status === 'completed') return 4;
  if (a && a.status === 'in_progress') return 3;
  if (a && a.status === 'approved') return 2;
  return 1;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!user) return;
  renderNav('', user);
  $('backLink').href = CM.homeFor(user.role);
  if (!incidentId) { $('loading').innerHTML = emptyState('No incident specified.'); return; }
  $('content').addEventListener('click', onClick);
  load();
});

async function load() {
  try {
    inc = await CM.api('/api/incidents/' + encodeURIComponent(incidentId));
    document.title = `${inc.public_id} · CivicMind`;
    // Tear the old map down BEFORE its container is replaced, or Leaflet's
    // pending animation frames run against a detached element.
    if (miniMap) { miniMap.remove(); miniMap = null; }
    $('content').innerHTML = inc.view === 'staff' ? staffView(inc) : citizenView(inc);
    $('loading').hidden = true; $('content').hidden = false;
    CM.hydrateImages($('content'));
    drawMini();
  } catch (e) {
    $('loading').innerHTML = emptyState(e.status === 404 ? 'Incident not found, or you do not have access to it.' : e.message);
  }
}

/* =====================================================================
   Staff view
   ===================================================================== */
function staffView(i) {
  const p = i.priority || {};
  return `
  <div class="card prio-card prio-${CM.esc(CM.pClass(p.label))}" style="margin-top:10px">
    <div class="row spread wrap-row">
      <div>
        <div class="row wrap-row" style="gap:8px">
          <span class="badge ${CM.pClass(p.label)}">${CM.esc(p.label)} · ${CM.esc(p.score)}</span>
          <span class="badge ${CM.sClass(i.status)}">${CM.esc(CM.statusText(i.status))}</span>
          <span class="badge">${CM.esc(i.public_id)}</span>
          ${i.complaints.some(c => c.is_synthetic) ? syntheticTag(true) : ''}
        </div>
        <h1 style="margin:12px 0 4px">${CM.esc(i.title)}</h1>
        <p class="muted small" style="margin:0">📍 ${CM.esc(i.ward || 'Unmapped')} <span class="tiny">(nearest ward centre)</span> · opened ${CM.esc(CM.fmtDate(i.created_at))}
          ${i.resolved_at ? ` · resolved ${CM.esc(CM.fmtDate(i.resolved_at))}` : ''}</p>
      </div>
      <div class="stat-strip">
        <div class="s"><div class="n">${CM.esc(i.report_count)}</div><div class="l">Linked reports</div></div>
        <div class="s"><div class="n">${CM.esc(i.distinct_reporters)}</div><div class="l">Distinct reporters</div></div>
        <div class="s"><div class="n">${CM.esc(i.spread_km)} km</div><div class="l">Spread</div></div>
      </div>
    </div>
    <div class="track lifecycle" aria-label="Lifecycle">${stepper(LIFECYCLE, lifecycleIndex(i))}</div>
  </div>

  <div class="detail-grid" style="margin-top:18px">
    <div>
      ${planCard(i)}
      ${resolutionCard(i)}
      ${investigationCard(i)}
      <section class="card">
        <div class="card-h"><h3>Activity timeline</h3></div>
        <div class="timeline">${i.timeline.map(t => `<div class="tl-item"><div class="tl-t">${CM.esc(t.detail || t.action)}</div>
          <div class="tl-d">${CM.esc(t.actor || 'CivicMind')} · ${CM.esc(CM.fmtDate(t.created_at))}</div></div>`).join('') || emptyState('No activity yet.')}</div>
      </section>
    </div>
    <aside>
      <section class="card" style="margin-bottom:18px">
        <div class="card-h"><h3>Location</h3></div>
        <div id="mini" class="mini-map" role="img" aria-label="Map of incident reports"></div>
        <p class="tiny muted" style="margin:8px 0 0">● reports · ◆ linked asset · circle = grouping spread</p>
      </section>
      ${priorityCard(p)}
      ${assetCard(i.asset)}
      ${findingsCard(i.findings)}
      ${reportsCard(i)}
      ${groupingCard(i)}
    </aside>
  </div>`;
}

function stepper(labels, idx) {
  return labels.map((s, n) => {
    const cls = n < idx ? 'done' : (n === idx ? 'current' : '');
    return `<div class="step ${cls}"><div class="bubble">${n < idx ? '✓' : n + 1}</div><div class="lbl">${CM.esc(s)}</div></div>`;
  }).join('');
}
const list = (arr) => (arr && arr.length) ? arr.map(x => `<li>${CM.esc(x)}</li>`).join('') : '<li class="muted">—</li>';

function planCard(i) {
  const a = i.current_action;
  const history = i.actions.filter(x => !a || x.id !== a.id);
  let body;
  if (!a) {
    body = '<p class="muted small">No response plan yet.</p>';
  } else {
    body = `
      <div class="row wrap-row" style="gap:6px;margin-bottom:8px">
        <span class="badge ${CM.sClass(a.status)}">Plan #${CM.esc(a.id)} · ${CM.esc(CM.statusText(a.status))}</span>
        <span class="badge" title="How this plan was drafted">${a.source ? CM.esc(CM.engineLabel(a.source)) + ' draft' : 'Draft'}</span>
        ${a.status === 'pending' ? '<span class="badge medium">Recommendation — not yet approved</span>' : ''}
      </div>
      <div id="planView">
        <p class="plan-text">${CM.esc(a.action_text)}</p>
        <div class="grid g3 kv-grid">
          <div><div class="k">Team</div><div class="v small">${CM.esc(a.assigned_team || '—')}</div></div>
          <div><div class="k">Department</div><div class="v small">${CM.esc(a.department || '—')}</div></div>
          <div><div class="k">Planned duration</div><div class="v small">${CM.esc(a.eta_hours ?? '—')} h</div></div>
        </div>
        <div class="eyebrow" style="margin-top:12px">Checklist</div>
        <ul class="small checklist">${list(a.checklist)}</ul>
        ${a.approved_by_name ? `<p class="tiny muted">Approved by ${CM.esc(a.approved_by_name)} · ${CM.esc(CM.fmtDate(a.approved_at))}</p>` : ''}
        ${a.started_at ? `<p class="tiny muted">Work started ${CM.esc(CM.fmtDate(a.started_at))}</p>` : ''}
        ${a.completed_at ? `<p class="tiny muted">Completed by ${CM.esc(a.completed_by_name || '—')} · ${CM.esc(CM.fmtDate(a.completed_at))}${a.notes ? ' — ' + CM.esc(a.notes) : ''}</p>` : ''}
      </div>
      ${a.status === 'pending' ? editForm(a) : ''}
      ${planButtons(a)}`;
  }
  const gen = i.can_generate_plan
    ? `<button class="btn sm" data-act="generate">＋ Draft a new plan</button>` : '';
  const hist = history.length ? `
      <details class="history"><summary class="small">Plan history (${history.length})</summary>
        ${history.map(h => `<div class="evidence-item"><span class="badge ${CM.sClass(h.status)}">${CM.esc(CM.statusText(h.status))}</span>
          <div class="small">#${CM.esc(h.id)} ${CM.esc(h.action_text)}
          ${h.rejection_reason ? `<div class="tiny muted">Reason: ${CM.esc(h.rejection_reason)}${h.rejected_by_name ? ' — ' + CM.esc(h.rejected_by_name) : ''}</div>` : ''}</div></div>`).join('')}
      </details>` : '';
  return `<section class="card" style="margin-bottom:18px" id="planCard">
    <div class="card-h"><h3>📋 Response plan</h3>${gen}</div>${body}${hist}</section>`;
}

function editForm(a) {
  // Every value is escaped — including inside <textarea>, where an unescaped
  // "</textarea>" in a checklist item would otherwise break out into HTML.
  return `
    <div id="planEdit" hidden>
      <div class="field"><label class="f" for="eText">Action</label><textarea id="eText" maxlength="400">${CM.esc(a.action_text)}</textarea></div>
      <div class="grid g3" style="gap:10px">
        <div class="field"><label class="f" for="eTeam">Team</label><input id="eTeam" maxlength="120" value="${CM.esc(a.assigned_team || '')}"/></div>
        <div class="field"><label class="f" for="eDept">Department</label><input id="eDept" maxlength="120" value="${CM.esc(a.department || '')}"/></div>
        <div class="field"><label class="f" for="eEta">Duration (h)</label><input id="eEta" type="number" min="1" max="720" value="${CM.esc(a.eta_hours || 24)}"/></div>
      </div>
      <div class="field"><label class="f" for="eCheck">Checklist (one item per line)</label><textarea id="eCheck">${CM.esc((a.checklist || []).join('\n'))}</textarea></div>
    </div>
    <div id="rejectBox" hidden>
      <div class="field"><label class="f" for="rejectReason">Why reject this plan?</label>
        <input id="rejectReason" maxlength="300" placeholder="e.g. Wrong department — needs Drainage team"/></div>
    </div>`;
}

function planButtons(a) {
  if (a.status === 'pending') return `
    <div class="row wrap-row" style="margin-top:14px">
      <button class="btn green" data-act="approve">✔ Approve</button>
      <button class="btn" data-act="toggleEdit" id="editBtn">✎ Edit</button>
      <button class="btn primary" data-act="saveEdit" id="saveEdit" hidden>Save edits &amp; approve</button>
      <button class="btn red" data-act="toggleReject" id="rejectBtn">✕ Reject</button>
      <button class="btn red" data-act="confirmReject" id="confirmReject" hidden>Confirm rejection</button>
    </div>`;
  if (a.status === 'approved') return `<button class="btn blue" style="margin-top:14px" data-act="start">▶ Mark work started</button>`;
  if (a.status === 'in_progress') return `
    <div class="card tight soft" style="margin-top:14px">
      <div class="field"><label class="f" for="proofFile">Proof-of-work photo <span class="text-red">*</span></label>
        <input type="file" id="proofFile" accept="image/jpeg,image/png,image/webp"/>
        <div class="hint">Required to complete. Must be a new photo; automated checks reject blank, tiny or re-used images.</div></div>
      <div class="field"><label class="f" for="proofNotes">Completion notes</label>
        <textarea id="proofNotes" maxlength="500" placeholder="What was done?"></textarea></div>
      <div class="form-error" id="proofError" role="alert" hidden></div>
      <button class="btn green" data-act="complete" id="proofBtn">Submit proof &amp; complete</button>
    </div>`;
  return '';
}

function resolutionCard(i) {
  const r = i.resolution;
  const canVerify = i.actions.some(a => a.status === 'completed' && a.has_proof) && ['resolved', 'in_progress'].includes(i.status);
  if (!r) return `<section class="card" style="margin-bottom:18px"><div class="card-h"><h3>✅ Verification</h3></div>
    <p class="muted small">Not verified yet. Verification needs a completed plan with an accepted proof photo.</p></section>`;
  const ok = r.status === 'verified';
  const pc = r.proof_check || {};
  return `
  <section class="card result-card ${ok ? 'ok' : 'bad'}" style="margin-bottom:18px">
    <div class="card-h"><h3>✅ Verification</h3><span class="badge ${ok ? 'resolved' : 'reopened'}">${ok ? 'Resolved' : 'Reopened'}</span></div>
    <div class="before-after">
      <div class="ba-box"><div class="tiny muted">LINKED REPORTS</div><div class="n">${CM.esc(r.before_metric ?? '—')}</div></div>
      <div class="arrow-big" aria-hidden="true">→</div>
      <div class="ba-box ${ok ? 'after' : ''}"><div class="tiny muted">NEW RELATED REPORTS SINCE WORK</div><div class="n">${CM.esc(r.after_metric ?? '—')}</div></div>
    </div>
    <p class="small" style="margin-top:12px">${CM.esc(r.summary)}</p>
    <p class="small"><strong>Officer:</strong> ${CM.esc(r.officer_name || '—')} · <strong>Check:</strong> ${CM.esc(CM.titleCase(r.verification_type))} · ${CM.esc(CM.fmtDate(r.verified_at))}</p>
    ${pc.verdict ? `<p class="small"><strong>Proof photo:</strong> ${CM.esc(CM.checkLabel(pc.verdict))}. <span class="muted">${CM.esc(pc.note || '')}</span></p>` : ''}
    ${r.has_proof && r.action_id ? `<img class="proof-img" alt="Proof-of-work photo" data-auth-src="/api/actions/${Number(r.action_id)}/proof"/>` : ''}
    ${canVerify ? `<button class="btn sm" style="margin-top:10px" data-act="verify">↻ Re-check for recurrence</button>` : ''}
  </section>`;
}

function investigationCard(i) {
  const inv = i.investigation || {};
  return `
  <section class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>🔎 Investigation notes</h3><span class="badge">${CM.esc(CM.engineLabel(inv.engine))}</span></div>
    <p>${CM.esc(inv.summary || i.summary || '—')}</p>
    <div class="grid g2" style="gap:14px">
      <div><div class="eyebrow">Possible cause</div><p class="small">${CM.esc(inv.probable_cause || i.probable_cause || '—')}</p>
        <div class="eyebrow">Why these reports are linked</div><ul class="small">${list(inv.why_linked)}</ul></div>
      <div><div class="eyebrow">Supporting</div><ul class="small">${list(inv.supporting_evidence)}</ul>
        <div class="eyebrow">Gaps / conflicting</div><ul class="small">${list(inv.conflicting_evidence)}</ul></div>
    </div>
    <div class="eyebrow">Check next</div><ul class="small">${list(inv.next_checks)}</ul>
    <p class="tiny muted">Suggestions only. Hedged by design — verify on site.</p>
    <button class="btn sm ghost" data-act="investigate">↻ Regenerate notes</button>
  </section>`;
}

function priorityCard(p) {
  return `
  <section class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Why this priority</h3><span class="badge ${CM.pClass(p.label)}">${CM.esc(p.score)}/100</span></div>
    ${(p.factors || []).map(f => `
      <div class="factor">
        <div class="row spread small"><span>${CM.esc(f.label)}</span><strong>${CM.esc(f.points)} / ${CM.esc(f.max)}</strong></div>
        <div class="bar" role="img" aria-label="${CM.esc(f.label)} ${CM.esc(f.points)} of ${CM.esc(f.max)}"><span style="width:${Math.max(0, Math.min(100, (Number(f.points) / Number(f.max)) * 100))}%"></span></div>
        <div class="tiny muted">${CM.esc(f.detail)}</div>
      </div>`).join('') || emptyState('No factor breakdown stored.')}
    <p class="tiny muted" style="margin-top:8px">Prototype triage policy (${CM.esc(p.model || 'additive')}), not an official municipal standard.</p>
  </section>`;
}

function assetCard(a) {
  if (!a) return `<section class="card" style="margin-bottom:18px"><div class="card-h"><h3>🏗️ Linked infrastructure</h3></div>
    <p class="small muted">No compatible asset within the match radius. Nothing is assumed.</p></section>`;
  const overdue = a.inspection_overdue === true ? '<span class="badge critical">Inspection overdue</span>' :
                  a.inspection_overdue === false ? '<span class="badge low">Inspection up to date</span>' : '<span class="badge">No inspection data</span>';
  return `
  <section class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>🏗️ Linked infrastructure</h3><a class="small link" href="assets.html?id=${Number(a.id)}">Asset record →</a></div>
    <div class="row wrap-row" style="gap:6px"><strong>${CM.esc(a.asset_code)}</strong>
      <span class="badge ${CM.sevClass(a.criticality)}">${CM.esc(CM.titleCase(a.criticality))}</span>${syntheticTag(a.is_synthetic)}</div>
    <p class="small" style="margin:6px 0">${CM.esc(a.type_label)} — ${CM.esc(a.name)}</p>
    ${a.criticality_reason ? `<p class="tiny muted">Critical because: ${CM.esc(a.criticality_reason)}</p>` : ''}
    <div class="kv"><span class="k">Matched reports</span><span class="v">${CM.esc(a.matched_reports)} of ${CM.esc(inc.report_count)}</span></div>
    <div class="kv"><span class="k">Closest report</span><span class="v">${CM.esc(Math.round(a.min_distance_m))} m</span></div>
    <div class="kv"><span class="k">Last inspected</span><span class="v">${CM.esc(CM.fmtDay(a.last_inspected_at))}</span></div>
    <div style="margin:8px 0">${overdue}</div>
    <div class="eyebrow">Recent maintenance</div>
    ${(a.recent_maintenance || []).map(m => `<div class="evidence-item"><span class="badge">${CM.esc(CM.titleCase(m.event_type))}</span>
      <div class="small">${CM.esc(CM.fmtDay(m.performed_at))} — ${CM.esc(m.outcome || '')} ${syntheticTag(m.is_synthetic)}
      <div class="tiny muted">Source: ${CM.esc(m.data_source)}</div></div></div>`).join('') || '<p class="small muted">No maintenance records.</p>'}
    <p class="tiny muted">Match rule: nearest compatible asset type within the configured radius.</p>
  </section>`;
}

function findingsCard(list_) {
  if (!list_ || !list_.length) return '';
  return `
  <section class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>🚩 Risk findings</h3><span class="badge">${list_.length}</span></div>
    ${list_.map(f => `
      <div class="finding sev-${CM.esc(f.severity)}">
        <div class="row wrap-row" style="gap:6px"><span class="badge ${CM.sevClass(f.severity)}">${CM.esc(CM.titleCase(f.severity))}</span>
          <strong class="small">${CM.esc(f.rule_title)}</strong>${syntheticTag(f.is_synthetic)}
          <span class="badge ${CM.sClass(f.status)}">${CM.esc(CM.statusText(f.status))}</span></div>
        <p class="small" style="margin:6px 0">${CM.esc(f.explanation)}</p>
        <p class="tiny muted" style="margin:0 0 6px">Next step: ${CM.esc(f.recommended_step || '—')}</p>
        ${f.status === 'open' ? `<button class="btn sm ghost" data-act="ack" data-id="${Number(f.id)}">Acknowledge</button>
          <button class="btn sm ghost" data-act="dismiss" data-id="${Number(f.id)}">Dismiss</button>` : ''}
      </div>`).join('')}
  </section>`;
}

function reportsCard(i) {
  return `
  <section class="card" style="margin-bottom:18px">
    <div class="card-h"><h3>Linked reports</h3><span class="badge">${i.complaints.length}</span></div>
    <div class="scroll-list">
    ${i.complaints.map(c => `
      <div class="report-item">
        ${c.has_photo ? `<img class="thumb" alt="Report photo" data-auth-src="/api/complaints/${Number(c.id)}/photo"/>` : ''}
        <div class="grow">
          <div class="row wrap-row" style="gap:6px"><strong class="small">${CM.esc(c.public_id)}</strong>
            <span class="badge ${CM.sClass(c.status)}">${CM.esc(CM.statusText(c.status))}</span>${syntheticTag(c.is_synthetic)}</div>
          <div class="tiny muted">${CM.esc(c.category)} · ${CM.esc(c.citizen_name || 'Citizen')} · ${CM.esc(CM.timeAgo(c.created_at))} · severity ${CM.esc(c.severity)}/5</div>
          <p class="small" style="margin:4px 0">${CM.esc(c.description)}</p>
          ${c.asset_match ? `<div class="tiny">🏗️ ${CM.esc(c.asset_match.asset_code)} · ${CM.esc(Math.round(c.asset_match.distance_m || 0))} m ·
             <span class="muted">${CM.esc(c.asset_match.status)}</span>
             ${c.asset_match.status === 'auto' ? `<button class="link-btn" data-act="matchOk" data-id="${Number(c.id)}">confirm</button> ·
               <button class="link-btn" data-act="matchNo" data-id="${Number(c.id)}">not this asset</button>` : ''}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>
  </section>`;
}

function groupingCard(i) {
  const g = i.grouping_basis;
  if (!g) return '';
  return `<section class="card"><div class="card-h"><h3>Grouping rule</h3></div>
    <p class="small">Reports within <strong>${CM.esc(g.radius_km)} km</strong> and <strong>${CM.esc(g.window_hours)} h</strong> of each other,
      same or configured-related category (${CM.esc((g.categories || []).join(', '))}); at least ${CM.esc(g.min_reports)} reports.</p>
    <p class="tiny muted">Deterministic — no AI is used to decide grouping.</p></section>`;
}

/* =====================================================================
   Citizen view (limited: no other citizens' details or exact points)
   ===================================================================== */
function citizenView(i) {
  const idx = { active: 1, in_progress: i.current_action && i.current_action.status === 'in_progress' ? 3 : 2, reopened: 1, resolved: 5 }[i.status] ?? 1;
  const a = i.current_action;
  return `
  <div class="card" style="margin-top:10px">
    <div class="row wrap-row" style="gap:8px"><span class="badge ${CM.sClass(i.status)}">${CM.esc(CM.statusText(i.status))}</span>
      <span class="badge">${CM.esc(i.public_id)}</span><span class="badge ${CM.pClass(i.priority.label)}">${CM.esc(i.priority.label)} priority</span></div>
    <h1 style="margin:12px 0 4px">${CM.esc(i.title)}</h1>
    <p class="muted small">Your report is one of ${CM.esc(i.report_count)} similar reports grouped into this incident. Other citizens' details are private.</p>
    <div class="track lifecycle">${stepper(LIFECYCLE, idx)}</div>
  </div>
  <div class="detail-grid" style="margin-top:18px">
    <div>
      <section class="card" style="margin-bottom:18px"><div class="card-h"><h3>Response</h3></div>
        ${a ? `<p><strong>${CM.esc(a.action_text)}</strong></p><p class="small muted">${CM.esc(a.department || '')} · ${CM.esc(CM.statusText(a.status))}</p>`
            : '<p class="small muted">An officer is reviewing this incident.</p>'}
        ${i.resolution ? `<p class="small">${i.resolution.status === 'verified' ? '✅ Resolved' : '↻ Reopened'} on ${CM.esc(CM.fmtDay(i.resolution.verified_at))}${i.resolution.officer_name ? ' by officer ' + CM.esc(i.resolution.officer_name) : ''}.</p>` : ''}
      </section>
      <section class="card"><div class="card-h"><h3>Progress</h3></div>
        <div class="timeline">${i.timeline.map(t => `<div class="tl-item"><div class="tl-t">${CM.esc(t.action)}</div><div class="tl-d">${CM.esc(CM.fmtDate(t.created_at))}</div></div>`).join('') || emptyState('No updates yet.')}</div>
      </section>
    </div>
    <aside>
      <section class="card" style="margin-bottom:18px"><div class="card-h"><h3>Approximate area</h3></div>
        <div id="mini" class="mini-map" role="img" aria-label="Approximate incident area"></div></section>
      <section class="card"><div class="card-h"><h3>My reports here</h3></div>
        ${i.my_reports.map(r => `<div class="evidence-item"><strong class="small">${CM.esc(r.public_id)}</strong>
          <span class="badge ${CM.sClass(r.status)}">${CM.esc(CM.statusText(r.status))}</span></div>`).join('')}
      </section>
    </aside>
  </div>`;
}

/* =====================================================================
   Actions
   ===================================================================== */
async function post(path, body, okMsg) {
  try { await CM.api(path, { method: 'POST', body: body || {} }); CM.toast(okMsg, 'ok'); await load(); }
  catch (e) { CM.fail(e); if (e.status === 409) load(); }
}

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act, a = inc && inc.current_action;
  const run = (label, fn) => CM.busy(btn, label, fn);
  switch (act) {
    case 'approve': return run('Approving…', () => post(`/api/actions/${a.id}/approve`, {}, 'Plan approved'));
    case 'toggleEdit': {
      const ed = $('planEdit'), show = ed.hidden;
      ed.hidden = !show; $('planView').hidden = show; $('saveEdit').hidden = !show;
      btn.textContent = show ? 'Cancel edit' : '✎ Edit'; return;
    }
    case 'saveEdit': return run('Saving…', () => post(`/api/actions/${a.id}/approve`, {
      action_text: $('eText').value.trim(), assigned_team: $('eTeam').value.trim(),
      department: $('eDept').value.trim(), eta_hours: Number($('eEta').value),
      checklist: $('eCheck').value.split('\n').map(s => s.trim()).filter(Boolean),
    }, 'Plan edited and approved'));
    case 'toggleReject': {
      const box = $('rejectBox'); box.hidden = !box.hidden; $('confirmReject').hidden = box.hidden;
      if (!box.hidden) $('rejectReason').focus(); return;
    }
    case 'confirmReject': {
      const reason = $('rejectReason').value.trim();
      if (reason.length < 3) return CM.toast('Please give a reason (at least 3 characters).', 'err');
      return run('Rejecting…', () => post(`/api/actions/${a.id}/reject`, { reason }, 'Plan rejected — you can draft a new one'));
    }
    case 'start': return run('Updating…', () => post(`/api/actions/${a.id}/start`, {}, 'Work marked as started'));
    case 'complete': {
      const f = $('proofFile').files[0], err = $('proofError');
      err.hidden = true;
      if (!f) { err.textContent = 'A proof-of-work photo is required.'; err.hidden = false; return; }
      return run('Checking photo…', async () => {
        try {
          const proof = await CM.fileToDataURL(f);
          const r = await CM.api(`/api/actions/${a.id}/complete`, { method: 'POST', body: { notes: $('proofNotes').value.trim(), proof } });
          CM.toast(r.incident_status === 'resolved' ? 'Work completed — incident verified and resolved' : 'Completed, but new related reports reopened the incident', 'ok');
          await load();
        } catch (ex) {
          err.textContent = ex.message + ((ex.reasons || []).length ? ' — ' + ex.reasons.join('; ') : '');
          err.hidden = false;
        }
      });
    }
    case 'verify': return run('Checking…', async () => {
      try {
        const r = await CM.api(`/api/incidents/${inc.id}/verify`, { method: 'POST' });
        CM.toast(r.status === 'verified' ? 'Still resolved — no new related reports' : 'Reopened — new related reports found', r.status === 'verified' ? 'ok' : 'err');
        await load();
      } catch (ex) { CM.fail(ex); }
    });
    case 'generate': return run('Drafting…', () => post(`/api/incidents/${inc.id}/plans`, {}, 'New plan drafted — review it below'));
    case 'investigate': return run('Generating…', () => post(`/api/incidents/${inc.id}/investigate`, {}, 'Investigation notes updated'));
    case 'ack': return run('…', () => post(`/api/risk/findings/${btn.dataset.id}/review`, { status: 'acknowledged' }, 'Finding acknowledged'));
    case 'dismiss': return run('…', () => post(`/api/risk/findings/${btn.dataset.id}/review`, { status: 'dismissed' }, 'Finding dismissed'));
    case 'matchOk': return run('…', () => post(`/api/complaints/${btn.dataset.id}/asset-match`, { status: 'confirmed' }, 'Asset match confirmed'));
    case 'matchNo': return run('…', () => post(`/api/complaints/${btn.dataset.id}/asset-match`, { status: 'rejected' }, 'Asset match removed'));
  }
}

/* =====================================================================
   Mini map
   ===================================================================== */
function drawMini() {
  const el = $('mini');
  if (!el) return;
  if (typeof L === 'undefined') { el.innerHTML = emptyState('Map unavailable offline.'); return; }
  const col = { Critical: '#D9342B', High: '#E8551E', Medium: '#E0A106', Low: '#2E9E5B' }[inc.priority.label] || '#E8551E';
  miniMap = L.map(el, { zoomControl: true, attributionControl: true }).setView([inc.centroid_lat, inc.centroid_lng], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(miniMap);
  if (inc.view === 'staff') {
    L.circle([inc.centroid_lat, inc.centroid_lng], { radius: Math.max(40, (inc.spread_km || 0) * 1000), color: col, weight: 1.5, fillOpacity: .1 }).addTo(miniMap);
    const pts = [];
    inc.complaints.forEach(c => {
      pts.push([c.latitude, c.longitude]);
      L.circleMarker([c.latitude, c.longitude], { radius: 6, color: '#fff', weight: 1.5, fillColor: col, fillOpacity: .95 })
        .bindTooltip(c.public_id).addTo(miniMap);
    });
    if (inc.asset) {
      pts.push([inc.asset.latitude, inc.asset.longitude]);
      L.marker([inc.asset.latitude, inc.asset.longitude], { icon: L.divIcon({ className: '', iconSize: [18, 18],
        html: '<div class="asset-pin" style="background:#2F6FDB"></div>' }) }).bindTooltip(inc.asset.asset_code).addTo(miniMap);
    }
    if (pts.length > 1) miniMap.fitBounds(pts, { padding: [30, 30], maxZoom: 17, animate: false });
  } else {
    L.circle([inc.centroid_lat, inc.centroid_lng], { radius: 250, color: col, weight: 1.5, fillOpacity: .12 }).addTo(miniMap);
  }
  const m = miniMap;
  setTimeout(() => { if (m === miniMap && m && document.body.contains(el)) m.invalidateSize(); }, 100);
}
