# Echolocation — working prototype

Camera → neural depth → spatial audio, with **Claude as a semantic prior** that reshapes the sound. Single file, no build step. `index.html`.

## What it does
- Rear camera → Depth Anything V2-Small (in-browser, WebGPU with WASM fallback).
- Splits the view into **left / center / right** bands, takes the nearest meaningful surface per band (85th-percentile, head/chest height), EMA-smoothed so the audio doesn't jitter.
- Sonifies proximity three ways (toggle): **Hum** (volume + pitch, the Massiceti 2018 mapping), **Beep-rate** (Geiger-counter, the Bazilinskyy close-range mapping), or **Both**. Stereo-panned L/C/R.
- **The delta — "What's there?" button**: sends the frame to Claude Haiku 4.5, which returns a 12-word spoken summary *and* a per-zone hazard class. That class **reshapes the ongoing sonification** for 8 seconds — a `person`, `wall`, `door`, `step`, or `object` gets a distinct timbre and salience. The "what" rewrites the "where," instead of being a separate caption.

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
2. Have someone step into frame left. Tap **What's there?** — Claude says "person ahead left," and the left zone's tone changes to the bright high-salience `person` timbre. "That's Claude reshaping the sound — the *what* changing the *where*. No other tool fuses the two on a phone."
3. Toggle Hum vs Beep-rate. "Both mappings are from the SSD literature, not guessed."

## Honest caveats (say these, judges respect it)
- In-browser depth is ~5–10 fps on WebGPU, slower on WASM — fine for a concept test, not the shippable product.
- The API key is exposed client-side. Demo-only; a serverless proxy is the real pattern. Rotate the key after.
- This is a **cane complement** for head/chest-height obstacles — not a navigation-safety system, not a cane replacement.
- Prior art exists (EyeGuide Vision, biped NOA). The delta is the **semantic-prior fusion on a commodity phone**, not "first to fuse."

## Key knobs (in `index.html`)
- `ALPHA` — depth smoothing (0.2–0.4).
- `TIMBRE` table — waveform / base pitch / salience per object class.
- zone percentile (`0.85`) and the head-height crop (`0.20`–`0.80`).
- beep interval range `lerp(0.85, 0.07, p)`.
