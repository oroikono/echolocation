// claude-discuss.js — portable Claude voice scene-discussion module.
//
// Drop into ANY echolocation web app. You give it a <video>; it adds the rest:
//   double-tap  = capture a fresh anchor frame + describe it, then start a voice chat about it
//   single-tap  = ask a follow-up (also interrupts speech)
//   long-press  = STOP everything (cancel speech, stop listening, end the conversation)
//   say "stop" / "quiet" / "cancel" = same stop, by voice
//   "look again" = just double-tap again -> new frame, fresh conversation
//
// OPTIONAL: if no API key (and no proxy) is configured, the navigation app still
// runs fully; double-tap just politely says scene description is off.
//
// Voice in (SpeechRecognition) and out (speechSynthesis) run on-device for free.
// Only the Claude calls cost money -> they go to `endpoint` with either a pasted
// key (dev) or, in production, a serverless proxy that holds the key (getApiKey -> null).

const DEFAULT_SYSTEM = `You are the eyes of a blind person who is walking. You are looking at ONE photo they just captured; every question in this conversation is about that same photo.
- First answer: at most two short spoken sentences. Hazards and obstacles first (steps, curbs, poles, people, doors, low things at head height), then a brief layout. Use side/clock directions ("on your left", "straight ahead").
- Follow-ups: answer only what was asked, in one or two spoken sentences. Plain spoken words, no markdown, no lists.
- Only state what you can actually see. If you cannot tell, say so plainly ("I can't tell from this photo"). Never invent obstacles, text, or distances.
- If the photo is too dark, blurry, or blank to be useful, reply exactly: "unclear: " then the reason in a few words.`;

export function createDiscussion(opts = {}) {
  const cfg = {
    video: null,
    endpoint: 'https://api.anthropic.com/v1/messages', // or your proxy URL
    getApiKey: () => null,        // dev: returns pasted key; production proxy: null
    model: 'claude-sonnet-4-6',
    maxTokens: 350,
    captureWidth: 768,
    jpegQuality: 0.6,
    maxTurns: 6,
    systemPrompt: DEFAULT_SYSTEM,
    onStatus: () => {},
    ...opts,
  };
  if (!cfg.video) throw new Error('createDiscussion: opts.video (HTMLVideoElement) is required');

  let history = [];
  let anchor = null;
  let busy = false, listening = false, lastAnswer = '', voiceReady = false;
  let aborted = false, warnedNoKey = false;
  const recog = makeRecognizer();

  // stop by voice; available() = is Claude usable at all (key pasted, or a proxy endpoint)
  const STOP_WORDS = /\b(stop|quiet|cancel|silence|enough|never\s?mind|shut\s?up)\b/i;
  const usingProxy = cfg.endpoint && !/api\.anthropic\.com/i.test(cfg.endpoint);
  const available = () => usingProxy || !!(cfg.getApiKey && cfg.getApiKey());

  // ---- caption (non-blocking) with a dismiss (×) button ----
  let dismissed = false;
  const caption = document.createElement('div');
  Object.assign(caption.style, {
    position: 'fixed', left: '12px', right: '12px', bottom: '12px', zIndex: '99999',
    font: '600 16px -apple-system,system-ui,sans-serif', color: '#fff', background: '#000a',
    padding: '10px 36px 10px 12px', borderRadius: '10px', pointerEvents: 'none', whiteSpace: 'pre-wrap',
  });
  const msg = document.createElement('span');
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×'; closeBtn.setAttribute('aria-label', 'hide message');
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px',
    borderRadius: '50%', border: 'none', background: '#cc1557', color: '#fff',
    font: '700 15px system-ui', lineHeight: '24px', padding: '0', pointerEvents: 'auto', cursor: 'pointer',
  });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissed = true; caption.style.display = 'none'; });
  caption.append(msg, closeBtn);
  document.body.appendChild(caption);
  const say = (t) => { msg.textContent = t; cfg.onStatus(t); if (!dismissed) caption.style.display = ''; };

  // ---- gestures on window; ignore taps on real UI so host controls keep working ----
  const isUI = (t) => t && t.closest && t.closest('button,input,select,textarea,a,label,[role=button]');
  let lastTap = 0, pressTimer = null;
  addEventListener('pointerdown', (e) => {
    if (isUI(e.target)) return;
    pressTimer = setTimeout(() => { pressTimer = null; onLongPress(); }, 600);
  });
  addEventListener('pointerup', (e) => {
    if (isUI(e.target)) return;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } else return; // long-press already fired
    const now = Date.now();
    if (now - lastTap < 300) { lastTap = 0; onDoubleTap(); }
    else { lastTap = now; setTimeout(() => { if (lastTap && Date.now() - lastTap >= 300) { lastTap = 0; onSingleTap(); } }, 320); }
  });

  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- frame capture + on-device quality gate ----
  function grabFrame() {
    const v = cfg.video, vw = v.videoWidth || 640, vh = v.videoHeight || 480;
    const w = cfg.captureWidth, h = Math.round(w * vh / vw);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(v, 0, 0, w, h);
    return { dataURL: c.toDataURL('image/jpeg', cfg.jpegQuality), ctx: x, w, h };
  }
  function gateReason({ ctx, w, h }) {
    const d = ctx.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0, prev = 0, edge = 0;
    for (let i = 0; i < d.length; i += 32) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; n++; edge += Math.abs(l - prev); prev = l;
    }
    const mean = sum / n, sharp = edge / n;
    if (mean < 18) return "it's too dark. Try facing a window or turning on a light.";
    if (mean > 238) return "it's washed out. Point away from the bright light.";
    if (sharp < 2.2) return "the view's blank or the lens may be covered. Try facing forward.";
    return null;
  }

  // ---- triggers ----
  async function onDoubleTap() {
    if (busy) return;
    if (!available()) return warnNoKey();
    dismissed = false; caption.style.display = '';
    aborted = false; unlockAudio(); speechSynthesis.cancel();
    let frame, tries = 0;
    while (true) {
      frame = grabFrame();
      const bad = gateReason(frame);
      if (!bad) break;
      tries++;
      if (tries >= 3) { buzz([200]); say(bad); speak(bad); return; }
      buzz([40, 60, 40]); say('one sec, looking again…'); await sleep(350);
    }
    buzz([60]);
    anchor = frame.dataURL.split(',')[1];
    history = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: anchor }, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'Describe what is in front of me for safe walking. Hazards first.' },
    ] }];
    await turn();
    if (aborted) return;
    await waitSpeechDone(); armMic();
  }
  function onSingleTap() {
    if (!available()) return warnNoKey();
    unlockAudio();
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    aborted = false;
    if (!anchor) return onDoubleTap();
    armMic();
  }
  function onLongPress() { stopAll(); }

  function stopAll() {
    aborted = true;
    try { speechSynthesis.cancel(); } catch {}
    listening = false; try { recog && recog.stop(); } catch {}
    busy = false; buzz([30]); say('stopped — double-tap to look again.');
  }
  function warnNoKey() {
    buzz([120]);
    const m = 'Scene description is off. Add an API key to turn it on.';
    say(m); if (!warnedNoKey) { unlockAudio(); speak(m); warnedNoKey = true; }
  }

  // ---- voice in ----
  function makeRecognizer() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => { const t = (e.results[0][0].transcript || '').trim(); listening = false; if (t) ask(t); };
    r.onerror = () => { listening = false; };
    r.onend = () => { listening = false; };
    return r;
  }
  function armMic() { if (!recog || busy || listening || aborted) return; try { listening = true; recog.start(); say('listening… (say "stop" or long-press to stop)'); } catch {} }
  async function ask(text) {
    if (STOP_WORDS.test(text)) { stopAll(); return; }
    if (!anchor) return;
    aborted = false;
    history.push({ role: 'user', content: [{ type: 'text', text }] });
    await turn();
    if (aborted) return;
    await waitSpeechDone(); armMic();
  }

  // ---- the Claude turn, streamed into TTS sentence-by-sentence ----
  function trimmed() {
    if (history.length <= 1 + cfg.maxTurns * 2) return history;
    return [history[0], ...history.slice(-cfg.maxTurns * 2)];
  }
  async function turn() {
    busy = true; aborted = false; say('…thinking');
    const key = cfg.getApiKey && cfg.getApiKey();
    const headers = { 'content-type': 'application/json' };
    if (key) {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    const body = {
      model: cfg.model, max_tokens: cfg.maxTokens, stream: true,
      system: [{ type: 'text', text: cfg.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: trimmed(),
    };
    let full = '', spoke = 0;
    try {
      const res = await fetch(cfg.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok || !res.body) throw new Error((await res.text()).slice(0, 140));
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        if (aborted) { try { reader.cancel(); } catch {} break; }
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          try {
            const j = JSON.parse(line.slice(5).trim());
            if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
              full += j.delta.text; say(full);
              const m = full.slice(spoke).match(/^[\s\S]*?[.!?]\s/);
              if (m) { speak(full.slice(spoke, spoke + m[0].length)); spoke += m[0].length; }
            }
          } catch {}
        }
      }
      if (!aborted && spoke < full.length) speak(full.slice(spoke));
      history.push({ role: 'assistant', content: full || '(no answer)' });
      lastAnswer = full;
    } catch (err) {
      if (!aborted) { const msg = 'Error: ' + err.message; say(msg); speak("Sorry, I couldn't reach Claude."); }
    } finally { busy = false; }
  }

  // ---- voice out ----
  function unlockAudio() { if (voiceReady) return; try { speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); } catch {} voiceReady = true; }
  function speak(t) { if (aborted) return; try { const u = new SpeechSynthesisUtterance(t); u.rate = 1.1; speechSynthesis.speak(u); } catch {} }
  function waitSpeechDone() {
    return new Promise((res) => {
      const t = setInterval(() => { if (aborted || !speechSynthesis.speaking) { clearInterval(t); res(); } }, 150);
      setTimeout(() => { clearInterval(t); res(); }, 9000);
    });
  }

  say(recog ? 'Double-tap to look & talk · long-press or say "stop" to stop. (× to hide)' : 'Double-tap to describe the scene · long-press to stop. (× to hide)');
  setTimeout(() => { if (!busy && !listening && !dismissed) caption.style.display = 'none'; }, 6000); // auto-hide idle hint
  return { destroy() { caption.remove(); try { recog && recog.stop(); } catch {} } };
}
