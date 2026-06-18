// nav.js — web port of AISprint/src/live.py: webcam -> metric depth (worker)
// -> 7 sector distances -> AudioWorklet synth (same cue mapping). Double-tap adds
// the Claude scene-discussion layer (claude-discuss.js).

import { createDiscussion } from './claude-discuss.js';

const CAP_W = 384;                 // px fed to the depth model (small = fast)
const N = 7;
const ROI_TOP = 0.10, ROI_BOTTOM = 0.80;
const PARAMS = { mode: 'continuous', near_m: 0.5, far_m: 3.0, side_hz: 300, center_hz: 800, falloff: 2.0, sweep_period: 0.3, master: 0.8 };

const $ = (id) => document.getElementById(id);
const video = $('cam'), statusEl = $('status'), startBtn = $('start');
const grid = $('grid').getContext('2d');
const cap = document.createElement('canvas');

let ctx = null, node = null, worker = null, running = false, busy = false, dists = new Array(N).fill(PARAMS.far_m), backend = '';

const setStatus = (t) => { statusEl.textContent = t; };

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
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    video.srcObject = s; await video.play();
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
$('far_dn').addEventListener('click', () => setFar(-0.5));
$('far_up').addEventListener('click', () => setFar(+0.5));
function setFar(d) { PARAMS.far_m = Math.max(2.0, Math.min(15.0, PARAMS.far_m + d)); node && node.port.postMessage({ params: { far_m: PARAMS.far_m } }); }
