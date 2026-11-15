// Public static copy. When this page is served from GitHub through a file CDN (raw.githack.com) there is no SpinDrift
// server, so this classic script runs before the app and answers the app's server calls from files in the repository:
// /data/... from the repo's data folder, the read-only /api/... calls from the same files the server reads, and
// POST /api/verdict from Lean results stored by scripts/build_static_verdicts.py (exact responses of the Lean checker,
// nothing interpolated). Anything else (runs, simulators, input values without a stored result) answers that it needs
// the live server. On the local server or on Vercel this script does nothing (add ?static=1 to test it locally).
(function () {
  var STATIC = /(^|\.)githack\.com$|(^|\.)github\.io$/.test(location.hostname) || /[?&]static=1\b/.test(location.search);
  window.SPINDRIFT_STATIC = STATIC;
  if (!STATIC) return;
  var root = new URL('../', document.currentScript.src).href;
  var realFetch = window.fetch.bind(window);
  var LEGACY = { iss: 'iss.destiny', gateway: 'gateway.halo', lunar_base: 'moon_south_pole.shackleton_rim',
    mars_transit: 'mars_transit.cruise', mars_surface: 'mars_surface.insight' };
  var GET_FILES = { '/api/locations': 'data/locations.json', '/api/combined': 'data/combined_sensor.json',
    '/api/runs': 'data/runs.json', '/api/live': 'data/live_snapshot.json' };
  var KEYS = ['shielding_factor', 'target', 'renin', 'bilirubin_isf', 'beats_averaged', 'snr_required', 'bandwidth_hz',
    'brain_signal_fT', 'brain_trials', 'nv_bandwidth_hz'];
  var stored = {};
  function json(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  function norm(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) return +v;
    return v;
  }
  function same(a, b) {
    return KEYS.every(function (k) {
      var x = norm(a && a[k]), y = norm(b && b[k]);
      if (x === null || y === null) return x === y;
      if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
      return x === y;
    });
  }
  function storedFor(id) {
    if (!stored[id]) {
      stored[id] = realFetch(root + 'data/static/verdicts/' + encodeURIComponent(id) + '.json').then(function (r) {
        if (!r.ok) throw new Error('No stored Lean results for ' + id + '.');
        return r.json();
      });
    }
    return stored[id];
  }
  window.fetch = function (input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var u;
    try { u = new URL(url, location.href); } catch (e) { return realFetch(input, init); }
    if (u.origin !== location.origin) return realFetch(input, init);
    var p = u.pathname;
    if (p.indexOf('/data/') === 0) return realFetch(root + p.slice(1) + u.search, typeof input === 'string' ? init : undefined);
    if (p.indexOf('/api/') !== 0) return realFetch(input, init);
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    if (method === 'GET') {
      if (p === '/api/health') return Promise.resolve(json({ ok: true, static: true, feeds: {} }));
      if (GET_FILES[p]) return realFetch(root + GET_FILES[p]);
      return Promise.resolve(json({ detail: 'Not in the public copy; it needs the live server.' }, 404));
    }
    if (p === '/api/verdict') {
      var body = {};
      try { body = JSON.parse(init.body || '{}'); } catch (e) { body = {}; }
      var id = LEGACY[body.location] || body.location;
      return storedFor(id).then(function (doc) {
        var hit = (doc.variants || []).find(function (v) { return same(v.inputs, body.inputs || {}); });
        return hit ? json(hit.response) : json({ detail: 'The public copy has Lean results for the menu settings, and for renin and bilirubin left empty or at the published references. Other values need the live server.' }, 503);
      }, function (e) { return json({ detail: String(e.message || e) }, 503); });
    }
    return Promise.resolve(json({ detail: 'The public copy is read-only. Runs and simulations need the live server.' }, 503));
  };
})();
