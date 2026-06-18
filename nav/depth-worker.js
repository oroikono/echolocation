// depth-worker.js — metric depth in a Web Worker, then AISprint sector_distances().
// Same model as the desktop demo (Depth-Anything-V2-Metric-Indoor-Small, Levi's ONNX
// export), and the SAME per-sector distance computation as AISprint/src/synth.py.

import { pipeline, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

env.allowLocalModels = true;
env.localModelPath = new URL('models/', self.location.href).href;

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
      self.postMessage({ type: 'dist', dist: Array.from(dist), backend: be });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
