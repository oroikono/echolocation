# Echolocation — working prototype

Camera → neural depth → spatial audio, with **Claude as a semantic prior** that reshapes the sound. Single file, no build step. `index.html`.

## What it does
- Rear camera → Depth Anything V2-Small (in-browser, WASM default; WebGPU via `?gpu=1`).
- Splits the view into **left / center / right** bands, takes the nearest meaningful surface per band (85th-percentile, head/chest height), EMA-smoothed so the audio doesn't jitter.
- Sonifies proximity three ways (toggle): **Hum** (volume + pitch, the Massiceti 2018 mapping), **Beep-rate** (Geiger-counter, the Bazilinskyy close-range mapping), or **Both**. Stereo-panned L/C/R.
- **Live object recognition (the reflex)**: a second on-device model (YOLOS-tiny, COCO-80) runs continuously and *names* what it sees — drawing labeled boxes, speaking the nearest object fused with depth distance ("chair, close, about 1 m, on your left"), and giving each class its own earcon. The depth model alone can only say *how far*; this says *what*. **Detect** and **Speak** toggles control compute and listening fatigue.
- **Claude as a semantic prior (the delta) — "What's there?" button**: sends the frame to Claude Haiku 4.5, which returns a 12-word spoken summary *and* a per-zone hazard class. That class **reshapes the ongoing sonification** for several seconds — a `person`, `wall`, `door`, `step`, or `object` gets a distinct timbre and salience. Open-vocabulary, so it names things the fixed COCO detector can't. The "what" rewrites the "where," instead of being a separate caption.

Both the live detector and Claude feed the **same** timbre-reshaping channel — the detector keeps it current frame-to-frame; Claude enriches it on demand.

## Run it (HTTPS is mandatory for the camera)
Pick one:

**A. Quick local + phone over Wi-Fi**
```bash
cd Echolocation
npx http-server -S -C cert.pem -K key.pem   # or any HTTPS static server
```
Plain `http://` will NOT get the camera. Easiest path is a free host:

**B. Free HTTPS host (recommended for the Pixel)**
- Drag the folder into **Netlify Drop** (app.netlify.com/drop), or
- Push to a repo and enable **GitHub Pages**, or
- `npx vercel` / Cloudflare Pages.

Then open the https URL in **Chrome on the Pixel**, allow camera, tap **Start**.

## Using it
1. **Start** — grants camera, loads the model (~50 MB first time, cached after). Engine pill shows WebGPU or WASM.
2. Point at the room. Louder/faster/higher = closer. Left–right follows the obstacle.
3. **API key** button → paste an Anthropic key (kept in memory only). Then **What's there?** speaks the scene and recolors the audio.
4. **Hum / Beep-rate / Both** to A/B the mappings live. **Mute** to talk over it.

## Demo script (90 seconds)
1. Start, walk toward a wall — beep rate ramps up. "That's the ambient *where* channel."
2. Point at a chair / bottle / person — a box appears and it **says the object** with its distance, each with a different sound. "That's the live *what* reflex — no button, no key, fully on-device."
3. Tap **What's there?** — Claude gives the full open-vocabulary scene read and the zone's tone shifts to the high-salience `person` timbre. "That's Claude reshaping the sound — the *what* changing the *where*. Open-vocabulary, names what the fixed detector can't."
4. Toggle Hum vs Beep-rate. "Both mappings are from the SSD literature, not guessed."

## Honest caveats (say these, judges respect it)
- Two models on WASM share the phone CPU — depth runs continuously, detection on an ~1–2 s throttle, so the soundscape stays live while names refresh a touch slower. Fine for a concept test, not the shippable product.
- The live detector is **COCO-80**: it knows person, chair, bottle, laptop, cup, etc. — but *not* "hand". A bare hand reads as person or nothing; that's what the open-vocabulary Claude button is for.
- Depth is **relative**, so spoken meters are an uncalibrated estimate (tune `K_NEAR`/`K_RANGE`). Metric truth needs ARCore / a metric model on the native build.
- The API key is exposed client-side. Demo-only; a serverless proxy is the real pattern. Rotate the key after.
- This is a **cane complement** for head/chest-height obstacles — not a navigation-safety system, not a cane replacement.
- Prior art exists (EyeGuide Vision, biped NOA). The delta is the **semantic-prior fusion on a commodity phone**, not "first to fuse."

## Key knobs (in `index.html`)
- `ALPHA` — depth smoothing (0.2–0.4).
- `TIMBRE` table — waveform / base pitch / salience per object class.
- zone percentile (`0.85`) and the head-height crop (`0.20`–`0.80`).
- beep interval range `lerp(0.85, 0.07, p)`.
- `DET_THRESH` — detector confidence cutoff (0.5); `DET_GAP` — rest between detections (lower = more responsive, heavier CPU).
- `K_NEAR` / `K_RANGE` — relative-depth → approximate meters calibration.
