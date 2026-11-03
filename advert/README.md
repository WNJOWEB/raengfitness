# RAENG Fitness — 15-second brand advert (v2)

Light, minimal and beat-locked. Every frame is composed in `render.py` (numpy + Pillow → ffmpeg) and the
soundtrack is synthesised in `audio.py` (numpy only, no samples). Re-running both reproduces the film.

```
python3 render.py --aspect 9x16 --out out/raeng-advert-9x16-silent.mp4   # ~4 min
python3 audio.py  --out out/raeng-advert-audio.wav                       # ~2 s
ffmpeg -i out/raeng-advert-9x16-silent.mp4 -i out/raeng-advert-audio.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -t 15 -movflags +faststart out/raeng-advert-9x16.mp4
python3 render.py --aspect 16x9 ...                                      # landscape
```

Needs Python 3 + `numpy` + `Pillow`, and `ffmpeg` (libx264, `minterpolate`).

Outputs: `out/raeng-advert-9x16.mp4` (1080 × 1920) and `out/raeng-advert-16x9.mp4` (1920 × 1080), 24 fps,
H.264 + AAC, exactly 15.000 s.

## Direction (v2, after client feedback)

v1 was dark, textured and ambient. Feedback: not minimalist enough, a dark theme isn't the brand, the chalk
"sprinkles" were cringe, the iron soundtrack didn't work, and they wanted upbeat kettlebell-studio music.
v2 is:

- **Light**: the site's paper background (`#f5f2eb`), ink `#0b0b0b` type, muted `#57544e` for small text.
  No dust, beams, vignette, grain or crushed blacks.
- **Minimal**: one rounded footage window (the site's rounded-card language), one headline at a time, a tiny
  RAENG FITNESS header and lots of empty space. Type is Archivo 800 / 112% width, uppercase, as in
  `DESIGN.md`, rising out of a masked slot on the beat.
- **Beat-locked**: 128 bpm, 32 beats = 15.000 s. Cuts, text entrances, the window collapse and the logo all
  land on beats; each cut has a small punch-in that settles like a hit.
- **Footage**: the genuine class footage, graded bright and natural (shadows lifted, loud shirt colours
  tamed, skin kept natural).
- **Music**: an upbeat studio track, see below.

Research note: public analysis of JD Gyms' own adverts is thin and video can't be watched from here, so the
approach leans on common conventions for gym and sportswear films (cuts locked to a beat, punch-ins, speed
ramps, short bold type, a strong closing hit) plus the client's direction, not a frame-by-frame study of any
one ad.

## Shot list (beats at 128 bpm)

| Beats / time | Section | Picture | Type |
|---|---|---|---|
| 0–6 · 0–2.8 s | The detail | Window opens on the beat; hands on the handle, 0.4× slow-motion push-in | STRENGTH / IS BUILT. |
| 6–12 · 2.8–5.6 s | The movement | Slow-motion swing (0.5×, motion-interpolated) | ONE REP / AT A TIME. |
| 12–20 · 5.6–9.4 s | The experience | Eight cuts, one per beat, with punch-ins | MORE THAN / A WORKOUT. |
| 20–26 · 9.4–12.2 s | The brand | Final shot, 0.4× slow-motion, half-time music | BE PART OF / SOMETHING / STRONGER. |
| 26–28 · 12.2–13.1 s | | Window collapses to paper; the genuine black logo lockup resolves | |
| 28–32 · 13.1–15 s | The finish | Logo hold, drop on beat 28; strapline and URL rise in | BE PART OF SOMETHING STRONGER. / Visit raengfitness.co.uk |

## Sound (all synthesised, 128 bpm, Am–F–C–G)

Muffled kick and soft pad intro → groove arrives at beat 6 (four-on-the-floor kick, offbeat bass, claps, hats,
plucked arpeggio with echo) → hook melody over the cut section → half-time breakdown over the final shot →
riser and snare roll → one beat of near-silence → drop with kick, sub, crash, C-major stab and a single
kettlebell ring as the logo locks. Sidechain "pump" from the kick. About −14 LUFS, true peak about −2 dBFS.

## Brand assets (genuine)

| Asset | Source |
|---|---|
| Logo lockup | `https://raengfitness.co.uk/brand/raeng-lockup-black.png` → `assets/raeng-lockup-black.png` (used as supplied, black on paper) |
| Footage | `https://raengfitness.co.uk/media/hero-portrait.mp4` → `assets/hero-portrait.mp4` (540 × 960) |
| Typeface | Archivo variable (SIL OFL, google/fonts), the face named in `DESIGN.md` |
| Strapline / URL | From the live site |

No testimonials, statistics, prices, timetables or claims appear.

## Honest limitations

- Footage is only 540 × 960, so it is upscaled (about 1.8× in the vertical cut) and looks soft on large screens.
- Slow motion is interpolated from 30 fps, not shot at 100–120 fps.
- The people shown are RAENG's own coach and class members from the site's hero video; confirm release
  permission before using the film in paid placements.
- The music is synthetic. It is a studio-style demo; a licensed or composed track at the same tempo and
  structure would beat it. Keep the 128 bpm grid if you swap it.
