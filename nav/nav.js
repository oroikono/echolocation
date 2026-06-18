// nav.js — web port of AISprint/src/live.py: webcam -> metric depth (worker)
// -> 7 sector distances -> AudioWorklet synth (same cue mapping). Double-tap adds
// the Claude scene-discussion layer (claude-discuss.js).

import { createDiscussion } from './claude-discuss.js';

const CAP_W = 322;                 // px fed to the depth model (matches desktop size)
const N = 7;
const ROI_TOP = 0.10, ROI_BOTTOM = 0.80;
const PARAMS = { mode: 'continuous', near_m: 0.5, far_m: 3.0, side_hz: 300, center_hz: 800, falloff: 2.0, sweep_period: 0.3, master: 0.8 };

const $ = (id) => document.getElementById(id);
const video = $('cam'), statusEl = $('status'), startBtn = $('start');
const grid = $('grid').getContext('2d');
const depthCtx = $('depth').getContext('2d');
const dthumb = document.createElement('canvas');
const cap = document.createElement('canvas');

let ctx = null, node = null, worker = null, running = false, busy = false, dists = new Array(N).fill(PARAMS.far_m), backend = '', stream = null;

const setStatus = (t) => { statusEl.textContent = t; };

async function openCamera(deviceId) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const v = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
  v.width = { ideal: 960 };
  stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
  video.srcObject = stream; await video.play();
}
async function listCameras() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('camsel'); if (!sel || !devs.length) return;
    sel.innerHTML = '';
    devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || ('camera ' + (i + 1)); sel.appendChild(o); });
    sel.style.display = devs.length > 1 ? '' : 'none';
  } catch {}
}
// the real way to reach the 0.5x ultra-wide on Android: zoom below 1x (if the device allows it)
async function applyZoom(z) { try { const tr = stream && stream.getVideoTracks()[0]; if (tr) await tr.applyConstraints({ advanced: [{ zoom: z }] }); } catch {} }
function setupZoom() {
  const tr = stream && stream.getVideoTracks()[0];
  const caps = tr && tr.getCapabilities ? tr.getCapabilities() : null;
  const zc = $('zoom'), lbl = $('zoomlbl');
  if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
    const mn = caps.zoom.min;
    zc.min = mn; zc.max = caps.zoom.max; zc.step = caps.zoom.step || 0.1;
    zc.value = mn; zc.style.display = ''; lbl.style.display = '';
    applyZoom(mn);                                   // default to most zoomed-out (widest FOV)
    lbl.textContent = `zoom ${(+mn).toFixed(2)}× (widest) · max ${(+caps.zoom.max).toFixed(2)}×`;
  } else { zc.style.display = 'none'; lbl.style.display = ''; lbl.textContent = 'zoom not adjustable on this camera'; }
}

async function startAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.audioWorklet.addModule('./synth-worklet.js');
  node = new AudioWorkletNode(ctx, 'echo-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(ctx.destination);
  node.port.postMessage({ params: PARAMS });
  if (ctx.state === 'suspended') await ctx.resume();
}

function startWorker() {
  worker = new Worker('./depth-worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') setStatus(`loading model… ${m.pct}%`);
    else if (m.type === 'error') { setStatus('error: ' + m.message); busy = false; }
    else if (m.type === 'dist') {
      backend = m.backend || backend;
      dists = m.dist;
      node && node.port.postMessage({ dist: dists });
      drawDepth(m);
      drawGrid();
      busy = false;
      const open = dists.map((d, i) => [d, i]).reduce((a, b) => (b[0] > a[0] ? b : a))[1];
      setStatus(`${backend.toUpperCase()} · ${PARAMS.mode} · open sector ${open + 1}/7 · far ${PARAMS.far_m.toFixed(1)}m`);
      if (running) requestAnimationFrame(loop);
    }
  };
}

function loop() {
  if (!running || busy) return;
  const vw = video.videoWidth || 4, vh = video.videoHeight || 3;
  cap.width = CAP_W; cap.height = Math.round(CAP_W * vh / vw);
  const c = cap.getContext('2d', { willReadFrequently: true });
  c.drawImage(video, 0, 0, cap.width, cap.height);
  const img = c.getImageData(0, 0, cap.width, cap.height);
  busy = true;
  worker.postMessage({ type: 'infer', buf: img.data.buffer, width: cap.width, height: cap.height }, [img.data.buffer]);
}

// colorized metric-depth view (the "thermo" map, like live.py)
function drawDepth(m) {
  if (!m.depth) return;
  dthumb.width = m.dw; dthumb.height = m.dh;
  dthumb.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.depth), m.dw, m.dh), 0, 0);
  depthCtx.imageSmoothingEnabled = true;
  depthCtx.drawImage(dthumb, 0, 0, depthCtx.canvas.width, depthCtx.canvas.height);
}

// simple sector readout (mirrors live.py overlay: per-sector proximity bars + open arrow)
function drawGrid() {
  const W = grid.canvas.width, H = grid.canvas.height;
  grid.clearRect(0, 0, W, H);
  const sw = W / N, near = PARAMS.near_m, far = PARAMS.far_m;
  let openI = 0, openD = -1;
  for (let i = 0; i < N; i++) {
    const d = dists[i], prox = Math.max(0, Math.min(1, (far - d) / (far - near)));
    const barH = prox * H;
    grid.fillStyle = `rgb(${Math.round(255 * prox)},${Math.round(255 * (1 - prox))},60)`;
    grid.fillRect(i * sw + 2, H - barH, sw - 4, barH);
    grid.fillStyle = '#fff'; grid.font = '11px system-ui';
    grid.fillText(d < far ? d.toFixed(1) : 'open', i * sw + 4, 12);
    if (d > openD) { openD = d; openI = i; }
  }
  grid.strokeStyle = '#39d98a'; grid.lineWidth = 3;
  grid.beginPath(); grid.moveTo(W / 2, H); grid.lineTo((openI + 0.5) * sw, 16); grid.stroke();
}

async function start() {
  if (running) return;
  startBtn.disabled = true; setStatus('requesting camera…');
  try {
    await openCamera($('camsel').value || null);
    await listCameras();
    setupZoom();
    await startAudio();
    startWorker();
    running = true; startBtn.textContent = 'running';
    setStatus('loading metric depth model…');
    // double-tap Claude layer (paste key kept in memory; swap to proxy for public)
    createDiscussion({ video, getApiKey: () => $('key').value.trim(), model: 'claude-sonnet-4-6' });
    loop();
  } catch (e) { setStatus('error: ' + e.message); startBtn.disabled = false; }
}

startBtn.addEventListener('click', start);
for (const m of ['continuous', 'pulse', 'sweep']) {
  $('m_' + m).addEventListener('click', () => {
    PARAMS.mode = m; node && node.port.postMessage({ params: { mode: m } });
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('on', b.id === 'm_' + m));
  });
}
$('camsel').addEventListener('change', async () => { if (running) { try { await openCamera($('camsel').value); setupZoom(); } catch {} } });
$('zoom').addEventListener('input', () => { const z = parseFloat($('zoom').value); applyZoom(z); $('zoomlbl').textContent = `zoom ${z.toFixed(2)}×`; });
$('widest').addEventListener('click', () => { const z = parseFloat($('zoom').min || '1'); $('zoom').value = z; applyZoom(z); $('zoomlbl').textContent = `zoom ${z.toFixed(2)}× (widest)`; });
$('far_dn').addEventListener('click', () => setFar(-0.5));
$('far_up').addEventListener('click', () => setFar(+0.5));

// API key: paste once, saved on THIS device (localStorage). No submit — claude-discuss reads it live.
const keyEl = $('key');
if (keyEl) {
  keyEl.value = localStorage.ANTHROPIC_KEY || '';
  const saveKey = () => { localStorage.ANTHROPIC_KEY = keyEl.value.trim(); setStatus(keyEl.value.trim() ? 'API key saved on this device ✓ — double-tap to describe' : 'API key cleared'); };
  keyEl.addEventListener('input', saveKey);
  keyEl.addEventListener('change', saveKey);
}

function setFar(d) { PARAMS.far_m = Math.max(2.0, Math.min(15.0, PARAMS.far_m + d)); node && node.port.postMessage({ params: { far_m: PARAMS.far_m } }); }
