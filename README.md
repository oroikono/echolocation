# Echolocation — v5, an AI-curated auditory scene

Levi's original idea — phone camera → CNN depth → real-time echolocation audio — elevated from "sonify the depth map" to **"sonify an AI-curated, world-anchored auditory scene."** Single file, no build. `index.html`.

## The thesis (the delta)
Every sensory-substitution device sonifies the scene by **fixed rules** — it has no idea what matters, so it either dumps everything (fatiguing, the #1 reason these tools get abandoned) or uses a dumb nearest-surface rule. v5 puts a **vision-language model in the loop as the attention manager of the soundscape**: Claude decides, every few seconds, which 2–4 things deserve a sound, and the audio engine spends its scarce voices on exactly those. I couldn't find prior work doing this. It's also why Claude is structurally load-bearing here, not a bolt-on caption.

Three engineering pieces, each grounded and phone-feasible:
1. **Claude as curator** — ranks the scene by what a *walking* person needs (`{x, class, hazard, salience}`), open-vocabulary (names a hand, a curb, a doorway).
2. **Looming hazards** — flagged hazards don't beep, they *loom*: tremolo rate + loudness rise with approach (the mapping that beat everything for reaction time in driving studies; new to a phone SSD).
3. **World-locking** — the phone's gyroscope (`DeviceOrientation`) anchors each object in space, so when you turn, the curb keeps sounding from where the curb actually is. Out-of-view objects become edge arrows + panned audio.

## Built for the Pixel (one model, not two)
The Pixel's Chrome has no working WebGPU, so everything is single-threaded WASM. Running two neural nets (depth + a detector) froze it. v5 fixes this by design: **the only on-device model is depth.** The "what" moves off-device to Claude. Two-rate system:

- **Fast loop — on-device, continuous (~5–10 Hz):** Depth Anything V2-Small (WASM) → proximity per bearing; gyro → world-lock pan; render spatial audio. This is the "where", smooth and local.
- **Slow loop — Claude, ~every 3 s:** one frame → ranked objects. This is the "what". Between calls, the fast loop keeps the flagged bearings tracked from depth + gyro alone.

That split is honest to perception: you re-identify things slowly but track their distance fast.

## How Claude is called
Anthropic **API**, not a subscription. The app `fetch`es `api.anthropic.com` with an **API key** from the Anthropic **Console** (console.anthropic.com) — pay-as-you-go. A Claude.ai Pro/Max plan does **not** grant API access. The sprint credits ($150/participant, CHF 6000 team prize) are API credits → make a key, paste it in the **API key** panel. Model is **Claude Haiku 4.5** (cheap/fast); a low-res frame every ~3 s is fractions of a cent.

## Run it (HTTPS mandatory for camera + gyro)
Live: **https://oroikono.github.io/echolocation/** (GitHub Pages, this repo).
Or host yourself: drag the folder into Netlify Drop, or `npx vercel`, or any HTTPS static host. Plain `http://` won't get the camera or motion sensors.

WebGPU fast path (non-Pixel devices that support it): add `?gpu=1` to the URL; it still falls back to WASM if that backend is broken.

## Using it
1. **Start** — grants camera + motion, loads the depth model (cached after). Engine pill shows WASM/WebGPU; heading pill shows the gyro.
2. Point at the room. The quiet **bed** (Hum/Beep) is raw depth in L/C/R. Tap **API key**, paste a Console key → Claude starts **curating**: named objects get their own world-locked voices, hazards loom.
3. **Turn the phone** — curated sounds stay anchored in space. Toggle **World-lock: off** to feel the difference.
4. **Auto-curate: off** → only the manual **What's there?** button calls Claude (saves credits). **Mute** to talk over it.

## Demo script (90 seconds)
1. Start with no key — "this quiet bed is raw on-device depth, the *where*."
2. Add key. Point at a person/doorway — Claude names them, each gets a distinct world-locked voice. "Claude is the *what*, and it decides what's worth a sound — that's the new part."
3. Walk toward a hazard — it **looms** (faster, louder). "Looming, the fastest-reaction mapping from the driving literature, on a phone."
4. **Turn the phone** — the object stays put / becomes an edge arrow. "World-locked from the gyro. Turn away and the curb is still behind you."

## Honest caveats (say these — judges respect it)
- Depth is **relative**: spoken metres are an uncalibrated estimate (tune `K_NEAR`/`K_RANGE`). Metric truth needs ARCore / a metric model on the native build.
- The "what" lags the "where" by the curate cadence (~3 s) and needs connectivity; offline → graceful depth-only bed.
- World-locking uses relative gyro heading (not true north); if it turns the wrong way on a device, flip `GYRO_SIGN`. FOV is assumed `FOV_DEG = 65`.
- The API key is client-side (demo-only); use a serverless proxy for anything public and rotate after.
- This is a **cane complement** for head/chest-height obstacles — not a navigation-safety system, not a cane replacement.
- Prior art exists (EchoSee does live 3D-map spatial audio on iPhone LiDAR; Soundscape did GPS beacons; looming is proven in cars). The delta is **a VLM as the real-time attention/bandwidth manager of the soundscape**, world-locked, on a commodity no-LiDAR phone.

## Key knobs (top of the `<script>`)
- `CURATE_MS` — Claude cadence (the "what" rate / credit usage).
- `MAX_OBJ` — how many voices the curator may light up at once.
- `FOV_DEG` — assumed camera horizontal field of view (bearing math).
- `GYRO_SIGN` — flip if world-locking turns the wrong way.
- `K_NEAR`/`K_RANGE` — relative-depth → approximate metres.
- `BED_GAIN`/`OBJ_GAIN` — ambient bed vs curated-object loudness.
- `ALPHA` — depth smoothing.
