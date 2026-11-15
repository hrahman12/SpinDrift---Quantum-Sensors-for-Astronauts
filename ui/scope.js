// Scrolling trace monitor for recorded replays streamed by the server (/api/stream/{id}, Server-Sent Events).
// It only draws samples it receives; it never fills gaps or generates values.

export function createScope(canvas, { windowS = 4, fs = 200, names = [], unit = '', color = '#ff0000', label = '' }) {
  const keep = Math.max(2, Math.round(windowS * fs));
  const n = names.length;
  const bufs = names.map(() => new Float32Array(keep));
  let filled = 0, head = 0, raf = 0, dirty = true, total = 0;
  const ctx = canvas.getContext('2d');

  function push(chunks) {
    const len = chunks[0]?.length || 0;
    for (let j = 0; j < len; j++) {
      for (let k = 0; k < n; k++) bufs[k][head] = chunks[k][j];
      head = (head + 1) % keep; filled = Math.min(keep, filled + 1); total++;
    }
    dirty = true;
  }
  function values(k) {
    const out = new Float32Array(filled);
    for (let i = 0; i < filled; i++) out[i] = bufs[k][(head - filled + i + keep) % keep];
    return out;
  }
  function draw() {
    raf = requestAnimationFrame(draw);
    if (!dirty || !canvas.isConnected || canvas.offsetParent === null) return;
    dirty = false;
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // time grid: one line per second, newest sample at the right edge
    ctx.strokeStyle = 'rgba(169,212,140,0.08)'; ctx.lineWidth = 1;
    for (let s = 0; s <= windowS; s++) { const x = W - (s / windowS) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    const lane = H / Math.max(1, n);
    ctx.font = '10px "IBM Plex Mono", monospace';
    for (let k = 0; k < n; k++) {
      const v = values(k); if (!v.length) continue;
      let lo = Infinity, hi = -Infinity;
      for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
      const span = hi - lo || 1, top = k * lane + 6, h = lane - 12;
      ctx.strokeStyle = color; ctx.globalAlpha = n > 1 ? 0.92 : 1; ctx.lineWidth = n > 1 ? 1 : 1.5; ctx.beginPath();
      const x0 = W - (filled / keep) * W;
      for (let i = 0; i < v.length; i++) {
        const x = x0 + (i / keep) * W, y = top + h - ((v[i] - lo) / span) * h;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#8e9684';
      ctx.fillText(`${names[k]}  ${lo.toFixed(1)}…${hi.toFixed(1)} ${unit}`, 6, top + 9);
      if (n > 1 && k < n - 1) { ctx.strokeStyle = 'rgba(169,212,140,0.06)'; ctx.beginPath(); ctx.moveTo(0, (k + 1) * lane); ctx.lineTo(W, (k + 1) * lane); ctx.stroke(); }
    }
    ctx.fillStyle = '#666e5d';
    ctx.fillText(`${label} · ${windowS} s window · ${fs} Hz · ${total.toLocaleString('en-US')} samples received`, 6, H - 4);
  }
  return {
    push, values,
    start() { if (!raf) raf = requestAnimationFrame(draw); dirty = true; },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    get filled() { return filled; },
  };
}

export function openStream(id, onChunk, onError) {
  let es;
  try { es = new EventSource(`/api/stream/${id}`); } catch (e) { onError?.(e); return null; }
  es.onmessage = (m) => onChunk(JSON.parse(m.data));
  es.onerror = (e) => onError?.(e);
  return es;
}

// Same rule as the build's beat finder (scipy.signal.find_peaks in scripts): polarity sign, height above
// 0.5 x the 99.9th percentile of the signed signal, peaks at least minGapS apart. Returns sample indices.
export function rPeaks(v, fs, { sign = -1, minGapS = 0.4 } = {}) {
  const x = Array.from(v, (a) => sign * a);
  if (x.length < fs) return [];
  const sorted = [...x].sort((a, b) => a - b);
  const thr = 0.5 * sorted[Math.min(sorted.length - 1, Math.round(0.999 * (sorted.length - 1)))];
  const gap = Math.round(minGapS * fs), peaks = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] > thr && x[i] >= x[i - 1] && x[i] > x[i + 1]) {
      if (peaks.length && i - peaks[peaks.length - 1] < gap) { if (x[i] > x[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i; } else peaks.push(i);
    }
  }
  return peaks;
}
