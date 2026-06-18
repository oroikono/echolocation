// depth-worker.js — metric depth in a Web Worker, then AISprint sector_distances().
// Same model as the desktop demo (Depth-Anything-V2-Metric-Indoor-Small, Levi's ONNX
// export), and the SAME per-sector distance computation as AISprint/src/synth.py.

import { pipeline, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

env.allowLocalModels = true;
env.localModelPath = new URL('models/', self.location.href).href;
// dev flag: open the app with ?fresh=1 to bypass the model cache (no manual cache-clearing while iterating)
if (new URLSearchParams(self.location.search).has('fresh')) env.useBrowserCache = false;
// use all cores for WASM (only takes effect when the page is cross-origin isolated; see coi-serviceworker.js)
try { env.backends.onnx.wasm.numThreads = Math.min(8, (self.navigator && self.navigator.hardwareConcurrency) || 4); } catch {}

const MODEL = 'depth-anything-v2-metric-indoor-small';
let estimator = null, backend = '';

async function load(force) {
  if (estimator) return backend;
  const prog = (p) => { if (p.status === 'progress' && p.file) self.postMessage({ type: 'progress', file: p.file, pct: Math.round(p.progress || 0) }); };
  if (force !== 'wasm') {
    try { estimator = await pipeline('depth-estimation', MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback: prog }); backend = 'webgpu'; return backend; }
    catch (e) { self.postMessage({ type: 'info', message: 'WebGPU unavailable -> WASM' }); }
  }
  estimator = await pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: prog });
  backend = 'wasm'; return backend;
}

// numpy-style linear-interpolation percentile (matches np.percentile default)
function percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

// EXACT port of AISprint sector_distances(): 7 sectors, ROI band, 20th percentile (meters)
function sectorDistances(data, H, W, n = 7, rt = 0.10, rb = 0.80, pct = 20) {
  const top = Math.floor(rt * H), bot = Math.floor(rb * H);
  const out = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    const x0 = Math.floor(s * W / n), x1 = Math.floor((s + 1) * W / n);
    const vals = [];
    for (let y = top; y < bot; y++) { const row = y * W; for (let x = x0; x < x1; x++) vals.push(data[row + x]); }
    vals.sort((a, b) => a - b);
    out[s] = vals.length ? percentile(vals, pct) : 0;
  }
  return out;
}

// jet-like colormap: t in [0,1] -> [r,g,b] (near = red/hot, far = blue)
function turbo(t) {
  const r = Math.round(255 * Math.min(Math.max(1.5 - Math.abs(4 * t - 3), 0), 1));
  const g = Math.round(255 * Math.min(Math.max(1.5 - Math.abs(4 * t - 2), 0), 1));
  const b = Math.round(255 * Math.min(Math.max(1.5 - Math.abs(4 * t - 1), 0), 1));
  return [r, g, b];
}

// small colorized depth thumbnail (per-frame normalized; near = hot), like live.py colorize_depth
function depthThumb(data, H, W, DW = 96, DH = 72) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < data.length; i += 7) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const inv = 1 / (mx - mn + 1e-6);
  const rgba = new Uint8ClampedArray(DW * DH * 4);
  for (let y = 0; y < DH; y++) {
    const sy = Math.floor(y * H / DH);
    for (let x = 0; x < DW; x++) {
      const sx = Math.floor(x * W / DW);
      const t = 1 - (data[sy * W + sx] - mn) * inv;     // near = 1 = hot
      const [r, g, b] = turbo(t); const o = (y * DW + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return { rgba, DW, DH };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'infer') {
      const be = await load(m.force);
      const img = new RawImage(new Uint8ClampedArray(m.buf), m.width, m.height, 4).rgb();
      const out = await estimator(img);
      const pd = out.predicted_depth, dims = pd.dims;
      const H = dims.length === 3 ? dims[1] : dims[0];
      const W = dims.length === 3 ? dims[2] : dims[1];
      const dist = sectorDistances(pd.data, H, W);
      const th = depthThumb(pd.data, H, W);
      self.postMessage({ type: 'dist', dist: Array.from(dist), depth: th.rgba.buffer, dw: th.DW, dh: th.DH, backend: be }, [th.rgba.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
