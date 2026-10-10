/* CivicMind citizen app — loaded right after api.js on every bundled page.
   The app is the citizen portal only: any other role is signed out (the server enforces access anyway). */
(() => {
  document.documentElement.classList.add('in-app');
  let base = '';
  try { base = localStorage.getItem('cm_api_base') || ''; } catch { /* ignore */ }
  const u = CM.getUser();
  if (!base) { location.replace('index.html'); return; }
  if (u && u.role && u.role !== 'citizen') { CM.clearSession(); location.replace('index.html?role=1'); return; }

  // A small banner while the phone is offline (requests resume when it reconnects).
  function banner() {
    let b = document.getElementById('offlineBar');
    if (navigator.onLine) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'offlineBar'; b.className = 'offline-bar'; b.setAttribute('role', 'status');
      b.textContent = 'You are offline — changes will be sent when the connection is back.';
      document.body.prepend(b);
    }
  }
  addEventListener('online', banner); addEventListener('offline', banner);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner); else banner();
})();
