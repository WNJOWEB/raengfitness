# RAENG Fitness — 15-second brand advert

Code-driven edit: every frame is composed in `render.py` (numpy + Pillow → ffmpeg), and the
soundtrack is synthesised in `audio.py` (numpy only, no samples). Re-running both reproduces
the film exactly.

```
python3 render.py --aspect 9x16 --out out/raeng-advert-9x16-silent.mp4   # ~6 min
python3 audio.py  --out out/raeng-advert-audio.wav                       # ~1 s
ffmpeg -i out/raeng-advert-9x16-silent.mp4 -i out/raeng-advert-audio.wav \
  -c:v copy -c:a aac -b:a 256k -t 15 -movflags +faststart out/raeng-advert-9x16.mp4
python3 render.py --aspect 16x9 ...                                      # landscape adaptation
```

Needs: Python 3 with `numpy` and `Pillow`, and `ffmpeg` (libx264, `minterpolate`).

## Output

- `out/raeng-advert-9x16.mp4` — 1080 × 1920, 24 fps, H.264 + AAC, exactly 15.000 s.
- 16:9 (1920 × 1080) is built from the same timeline: `--aspect 16x9` re-flows every crop, type size
  and the end card. It is lower fidelity than the vertical cut because the only genuine footage is
  540 × 960 portrait.

## Brand assets (genuine)

| Asset | Source |
|---|---|
| Logo lockup (R mark with Thai แรง, wordmark, STRENGTH • COMMUNITY • DISCIPLINE) | `https://raengfitness.co.uk/brand/raeng-lockup-black.png` → `assets/raeng-lockup-black.png`. Recoloured white (same artwork, alpha preserved) for the black end card. Not redrawn. |
| Class footage | `https://raengfitness.co.uk/media/hero-portrait.mp4` → `assets/hero-portrait.mp4` (the site's own hero loop, 540 × 960). |
| Typeface | Archivo variable (weight 800, width 112%, uppercase, −0.02 em), the face named in `DESIGN.md`. SIL OFL, from google/fonts. |
| Strapline / URL | "Be part of something stronger." and raengfitness.co.uk, both taken from the live site. |

No testimonials, statistics, prices, timetables or claims appear in the advert.

## Shot list

| Time | Section | Picture | Type |
|---|---|---|---|
| 0–3 s | The detail | Black → narrow diagonal studio beam on procedural cast-iron macro texture, chalk dust drifting in the beam, slow push-in; a hand grips the handle (real footage, 0.4× slow-motion, only visible inside the beam) | STRENGTH IS BUILT. |
| 3–6 s | The movement | Real swing footage, 0.5× motion-interpolated slow-motion, shallow depth-of-field, chalk in the light shaft, slow push | ONE REP AT A TIME. |
| 6–10 s | The experience | Six cuts, each landing on the beat of a 90 bpm grid (0.667 s), mixing normal-speed and slow-motion shots; punch-in on each | MORE THAN A WORKOUT. |
| 10–13 s | The brand | Final shot at 0.4× slow-motion, falls to pure black; logo wipes in with a blur-to-sharp settle | BE PART OF SOMETHING STRONGER. |
| 13–15 s | The finish | Logo hold; impact at 13.0 s; strapline and URL resolve | Be part of something stronger. / Visit raengfitness.co.uk |

Grade: partial desaturation (loud shirts tamed, skin kept natural), crushed blacks, S-curve,
vignette, luminance-dependent film grain that is almost absent on the pure-black end card.

## Sound design (all synthesised)

Sub-bass atmosphere that swells to the end card → kettlebell handle clink and chalk/grip
texture (1.3 s) → whooshes and deep taiko-style percussion for the swing → controlled breathing
that quickens in the experience section → kick on every cut → rising noise riser through the
final shot and black → restrained sub impact with metallic ring and reverb tail at 13.0 s.
Integrated loudness ≈ −14 LUFS, true peak ≈ −2 dBFS.

## Honest limitations

- The site has no macro or sweat footage and the real clips are low resolution (540 × 960). The
  opening macro surface and chalk are original procedural visuals, not photography; the real
  footage is upscaled and graded dark, soft and grainy to suit. A 4K shoot would be the next step.
- 100–120 fps slow-motion is simulated by motion interpolation from 30 fps; it is not true high-speed capture.
- The people in the footage are RAENG's own class members and coach from the site's hero video.
  Confirm release permission before using the film in paid placements.
- The audio is synthetic. A licensed sound designer could replace `audio.py` stems while keeping the same cue timings.
