/* CivicMind — live city map (Leaflet) */
const user = CM.requireAuth();  // any logged-in role
const SEV_COLOR = { 1:'#2E9E5B', 2:'#8BC34A', 3:'#E0A106', 4:'#E8551E', 5:'#D9342B' };
const PRIO_COLOR = { Critical:'#D9342B', High:'#E8551E', Medium:'#E0A106', Low:'#2E9E5B' };

let CITY_CENTER = null;   // loaded from /api/config
let map, compLayer, incLayer, data = { complaints: [], incidents: [] };

document.addEventListener('DOMContentLoaded', async () => {
  if (!user) return;
  renderNav('map.html', user);
  try { const c = await CM.api('/api/config'); CITY_CENTER = c.city_center; } catch {}
  const ctr = CITY_CENTER || { lat: 20.5937, lng: 78.9629 };  // neutral fallback if config unavailable
  map = L.map('map', { zoomControl: true }).setView([ctr.lat, ctr.lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  compLayer = L.layerGroup().addTo(map);
  incLayer = L.layerGroup().addTo(map);

  ['fCategory','fSeverity','fStatus','layComplaints','layIncidents']
    .forEach(id => document.getElementById(id).addEventListener('change', render));
  loadAll();
  setInterval(loadAll, 20000);
});

async function loadAll() {
  try {
    const [comps, incs, wards] = await Promise.all([
      CM.api('/api/map/complaints'), CM.api('/api/map/incidents'), CM.api('/api/wards')
    ]);
    data.complaints = comps; data.incidents = incs;
    const sel = document.getElementById('fCategory');
    if (sel.options.length <= 1) {
      [...new Set(comps.map(c => c.category))].sort().forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
      });
    }
    render();
  } catch (e) { CM.toast(e.message, 'err'); }
}

function render() {
  const fc = document.getElementById('fCategory').value;
  const fs = document.getElementById('fSeverity').value;
  const fst = document.getElementById('fStatus').value;

  compLayer.clearLayers(); incLayer.clearLayers();
  let nc = 0, ni = 0;

  if (document.getElementById('layComplaints').checked) {
    data.complaints.filter(c => (!fc || c.category === fc) && (!fs || String(c.severity) === fs) && (!fst || c.status === fst))
      .forEach(c => {
        nc++;
        const m = L.circleMarker([c.latitude, c.longitude], {
          radius: 6, color: '#fff', weight: 1.5, fillColor: SEV_COLOR[c.severity] || '#999', fillOpacity: .9
        });
        m.bindPopup(`<div class="pop"><h4>${CM.esc(c.public_id)}</h4>
          <div class="small">${CM.esc(c.category)} · ${CM.esc(c.ward || '')}</div>
          <span class="badge ${CM.sClass(c.status)}">${CM.titleCase(c.status)}</span>
          ${c.incident_id ? `<a class="btn sm" style="margin-top:8px" href="incident.html?id=${c.incident_id}">View incident →</a>` : ''}
        </div>`);
        m.addTo(compLayer);
      });
  }

  if (document.getElementById('layIncidents').checked) {
    data.incidents.filter(i => !fc || i.category === fc)
      .forEach(i => {
        ni++;
        const col = PRIO_COLOR[i.priority_label] || '#E8551E';
        L.circle([i.centroid_lat, i.centroid_lng], {
          radius: Math.max(300, (i.spread_km || 0.5) * 1000),
          color: col, weight: 1.5, fillColor: col, fillOpacity: .12
        }).addTo(incLayer);
        i.members.forEach(m => L.circleMarker([m.latitude, m.longitude], {
          radius: 3.5, color: col, weight: 1, fillColor: col, fillOpacity: .8 }).addTo(incLayer));
        const marker = L.marker([i.centroid_lat, i.centroid_lng], {
          icon: L.divIcon({ className: '', html: `<div style="background:${col};color:#fff;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.25);border:2px solid #fff">⚠ ${i.report_count}</div>`, iconSize: [40, 24] })
        });
        marker.bindPopup(`<div class="pop"><h4>${CM.esc(i.title)}</h4>
          <div class="small muted">${CM.esc(i.public_id)} · ${CM.esc(i.ward || '')} (${CM.esc(i.zone || '')})</div>
          <div class="small" style="margin-top:6px">${i.report_count} reports · ${CM.num(i.affected_people)} people · conf ${Math.round((i.confidence||0)*100)}%</div>
          <span class="badge ${CM.pClass(i.priority_label)}">${i.priority_label} · ${i.priority_score}</span>
          <span class="badge ${CM.sClass(i.status)}">${CM.titleCase(i.status)}</span>
          <a class="btn sm primary" style="margin-top:8px" href="incident.html?id=${i.id}">Open incident →</a>
        </div>`);
        marker.addTo(incLayer);
      });
  }

  document.getElementById('cCount').textContent = nc;
  document.getElementById('iCount').textContent = ni;
}
