#!/usr/bin/env python3
"""Synthesised soundtrack for the RAENG Fitness 15 s advert (numpy only, no samples).

An upbeat 128 bpm "kettlebell studio" track: four-on-the-floor kick, offbeat bass,
claps and hats, a plucked arpeggio and a simple hook over Am - F - C - G.  8 bars =
exactly 15.000 s, and every picture cut in render.py lands on this grid.

  beats 0-6    intro: muffled kick, soft pad, hats           (STRENGTH IS BUILT.)
  beats 6-12   groove arrives: bass, claps, plucks            (ONE REP AT A TIME.)
  beats 12-20  full energy, hook plays, a cut on every beat   (MORE THAN A WORKOUT.)
  beats 20-26  half-time breakdown over the final shot        (BE PART OF SOMETHING STRONGER.)
  beats 26-28  riser + snare roll, a beat of near-silence
  beat 28      drop: kick, sub, crash, C major stab as the logo locks; rings out to 15 s
"""
import argparse
import wave

import numpy as np

SR = 48000
T = 15.0
N = int(SR * T)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
B = 60.0 / 128.0  # one beat


def bt(k):
    return k * B


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def fft_filter(x, lo=None, hi=None, order=4):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    if hi:
        g *= 1 / (1 + (f / hi) ** (2 * order))
    return np.fft.irfft(X * g, len(x))


def noise(n, lo=None, hi=None):
    return fft_filter(rng.standard_normal(n), lo, hi)


HP_NOISE = fft_filter(rng.standard_normal(SR * 4), 6500, None)
BP_NOISE = fft_filter(rng.standard_normal(SR * 4), 1200, 7500)


def slice_noise(src, n):
    i = int(rng.integers(0, len(src) - n))
    return src[i:i + n]


def adsr(n, a, d, s, r):
    tt = np.arange(n) / SR
    dur = n / SR
    e = np.minimum(tt / max(a, 1e-4), 1.0)
    e = e * (s + (1 - s) * np.exp(-np.maximum(tt - a, 0) / max(d, 1e-4)))
    rel = np.clip((dur - tt) / max(r, 1e-4), 0, 1)
    return e * rel


def stereo(x, pan=0.0):
    return np.stack([x * np.sqrt(0.5 * (1 - pan)), x * np.sqrt(0.5 * (1 + pan))], 1)


def place(buf, sig, t0, pan=0.0, gain=1.0):
    i = int(round(t0 * SR))
    if i >= N:
        return
    n = min(len(sig), N - i)
    buf[i:i + n] += stereo(sig[:n] * gain, pan)


# ---------------------------------------------------------------- instruments
def kick(soft=False):
    n = int(SR * 0.5)
    tt = np.arange(n) / SR
    f = 46 + 110 * np.exp(-tt / 0.028)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-tt / 0.17)
    if not soft:
        s += 0.35 * noise(n, 1800, 7000) * np.exp(-tt / 0.006)
    else:
        s = fft_filter(s, None, 220)
    return s


def clap():
    n = int(SR * 0.28)
    tt = np.arange(n) / SR
    x = slice_noise(BP_NOISE, n)
    e = np.zeros(n)
    for o in (0.0, 0.011, 0.022):
        e += np.exp(-np.maximum(tt - o, 0) / 0.006) * (tt >= o)
    e = e * 0.6 + np.exp(-tt / 0.07) * 0.8
    return x * e * 0.9


def hat(open_=False, vel=1.0):
    n = int(SR * (0.22 if open_ else 0.05))
    tt = np.arange(n) / SR
    return slice_noise(HP_NOISE, n) * np.exp(-tt / (0.07 if open_ else 0.012)) * vel


def pluck(f, dur=0.5):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = np.zeros(n)
    for k in range(1, 9):
        if f * k > 9000:
            break
        s += np.sin(2 * np.pi * f * k * tt) / k ** 0.8 * np.exp(-tt / (0.20 / k ** 0.45))
    return s * np.minimum(tt / 0.002, 1)


def saw(f, n, K, det=0.0):
    tt = np.arange(n) / SR
    ff = f * 2 ** (det / 1200.0)
    K = max(1, min(K, int(9000 / ff)))
    ks = np.arange(1, K + 1)[:, None]
    return (np.sin(2 * np.pi * ff * ks * tt[None, :]) / ks).sum(0)


def pad_note(f, dur, K=12):
    n = int(SR * (dur + 0.25))
    s = (saw(f, n, K, -9) + saw(f, n, K, 0) + saw(f, n, K, 9)) / 3
    return s * adsr(n, 0.05, 1.0, 0.9, 0.25)


def bass_note(f, dur):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = saw(f, n, 9) * 0.6 + np.sin(2 * np.pi * f * tt) * 0.9
    s = fft_filter(s, None, 900, 2)
    return s * adsr(n, 0.004, 0.18, 0.65, 0.03)


def lead_note(f, dur):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * tt) * np.minimum(tt / 0.25, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    s = np.zeros(n)
    for k in range(1, 10):
        if f * k > 7500:
            break
        s += np.sin(k * ph) / k
        s += np.sin(k * ph * 1.004) / k
    return s * 0.5 * adsr(n, 0.008, 0.25, 0.7, 0.07)


def metal(f=640, dur=1.4, decay=0.5):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = np.zeros(n)
    for ratio, a, d in ((1.0, 1.0, 1.0), (2.76, 0.6, 0.6), (5.4, 0.35, 0.35), (8.93, 0.2, 0.2)):
        s += a * np.sin(2 * np.pi * f * ratio * tt + rng.random() * 6.28) * np.exp(-tt / (decay * d))
    s += 0.7 * noise(n, 2500, 9000) * np.exp(-tt / 0.006)
    return s


def reverb_ir(dur=1.8, seed=0):
    r = np.random.default_rng(seed)
    n = int(SR * dur)
    tt = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-tt / (dur / 5.0))
    ir = fft_filter(ir, 150, 6500)
    ir[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
    return ir / np.sqrt((ir ** 2).sum())


def conv(x, ir):
    n = len(x) + len(ir)
    nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[: len(x)]


# ---------------------------------------------------------------- arrangement
CHORDS = [  # (name, bass midi, pad tones, arp tones)
    ("Am", 33, [57, 60, 64], [69, 72, 76, 81]),
    ("F", 29, [53, 57, 60], [65, 69, 72, 77]),
    ("C", 36, [55, 60, 64], [72, 76, 79, 84]),
    ("G", 31, [50, 55, 59], [67, 71, 74, 79]),
]
UNITS = [0, 0, 1, 1, 2, 2, 3, 3, 0, 0, 1, 1, 3, 3, 2, 2]  # 16 units x 2 beats

HOOK = [  # (beat, midi, length in beats) over G, Am
    (12.0, 74, 0.75), (12.75, 71, 0.25), (13.0, 74, 1.0), (14.0, 76, 0.75), (14.75, 72, 0.25), (15.0, 76, 1.0),
    (16.0, 81, 0.75), (16.75, 79, 0.25), (17.0, 76, 1.0), (18.0, 72, 0.75), (18.75, 76, 0.25), (19.0, 79, 1.0),
]


def build():
    dry = np.zeros((N, 2))
    wet = np.zeros((N, 2))
    sc = np.zeros((N, 2))  # sidechained bed: pad, bass, arp, hook
    kicks = []

    def K(beat, soft=False, g=1.0):
        kicks.append(bt(beat))
        place(dry, kick(soft), bt(beat), 0, 0.95 * g)

    # ---- kick -------------------------------------------------------------
    for k in range(0, 6):
        K(k, soft=True, g=0.55 + 0.05 * k)            # intro: muffled, building
    for k in range(6, 20):
        K(k)                                           # four on the floor
    for k in (20, 22, 24):
        K(k, g=0.9)                                    # half-time over the final shot

    # ---- clap, hats ----------------------------------------------------------
    for k in range(7, 20, 2):
        place(dry, clap(), bt(k), 0.05, 0.42)          # 2 and 4 of each bar
    for k in (22, 26):
        place(dry, clap(), bt(k), 0.05, 0.36)
    for k in range(0, 26):
        v = 0.35 if k < 6 else 0.55
        place(dry, hat(True, v), bt(k + 0.5), 0.15, 0.30)       # offbeat open hat
        if 6 <= k < 20:
            for q in (0.25, 0.75):
                place(dry, hat(False, 0.5), bt(k + q), -0.15, 0.17)
        elif k < 6:
            place(dry, hat(False, 0.5), bt(k), -0.1, 0.12)

    # ---- brand sound: a kettlebell clink on the very first beat ----------------
    place(wet, metal(700, 1.2, 0.45), 0.0, -0.1, 0.30)

    # ---- bass ---------------------------------------------------------------------
    for u, ci in enumerate(UNITS):
        root = CHORDS[ci][1]
        b0 = u * 2.0
        if b0 < 4:
            continue
        if b0 < 20:
            for k in (b0, b0 + 1):
                alt = (int(k) % 4 == 3)
                place(sc, bass_note(mtof(root + (12 if alt else 0)), bt(0.42)), bt(k + 0.5), 0, 0.55 if b0 >= 6 else 0.35)
        elif b0 < 28:
            place(sc, bass_note(mtof(root), bt(1.95)), bt(b0), 0, 0.5)
    place(sc, bass_note(mtof(36), bt(3.8)), bt(28), 0, 0.6)

    # ---- pad ---------------------------------------------------------------------------
    pad = np.zeros((N, 2))
    for u, ci in enumerate(UNITS):
        for j, m in enumerate(CHORDS[ci][2]):
            place(pad, pad_note(mtof(m), bt(2.0)), bt(u * 2.0), (-0.3, 0.0, 0.3)[j], 0.16)
    gain = np.interp(t, [bt(0), bt(4), bt(6), bt(12), bt(20), bt(26), bt(28), bt(32)],
                     [0.35, 0.6, 0.8, 0.85, 1.0, 1.0, 1.0, 0.6])
    sc += pad * gain[:, None]

    # ---- arpeggio (pluck) -----------------------------------------------------------------
    arp = np.zeros((N, 2))
    pat = [0, 1, 2, 3, 2, 1, 2, 3]
    for u, ci in enumerate(UNITS):
        b0 = u * 2.0
        tones = CHORDS[ci][3]
        for s16 in range(8):
            beat = b0 + s16 * 0.25
            if beat < 4 or (20 <= beat < 26 and s16 % 2) or 26 <= beat < 28:
                continue
            g = 0.26 if beat < 6 else (0.40 if beat < 20 else (0.30 if beat < 26 else 0.26))
            place(arp, pluck(mtof(tones[pat[s16]])), bt(beat), -0.35 if s16 % 2 else 0.35, g)
    sc += arp * 0.9
    d = int(0.75 * B * SR)  # dotted-eighth echo
    echo = np.zeros_like(arp)
    echo[d:] = arp[:-d][:, ::-1] * 0.30
    echo[2 * d:] += arp[:-2 * d] * 0.12
    wet += echo * 0.5
    dry += echo * 0.5

    # ---- hook (lead) ------------------------------------------------------------------------
    for beat, m, ln in HOOK:
        nt = lead_note(mtof(m), bt(ln) * 0.95)
        place(sc, nt, bt(beat), 0.0, 0.30)
        place(wet, nt, bt(beat), 0.0, 0.12)

    # ---- sidechain: the bed pumps from the kick -----------------------------------------------
    kt = np.array(sorted(kicks + [bt(28.0)]))
    idx = np.searchsorted(kt, t, side="right") - 1
    since = np.where(idx >= 0, t - kt[np.maximum(idx, 0)], 9.0)
    depth = np.interp(t, [bt(0), bt(6), bt(20), bt(28)], [0.45, 0.7, 0.55, 0.3])
    bed = sc * (1 - depth * np.exp(-since / 0.16))[:, None]

    # ---- a beat of near-silence before the drop (27.5 - 28) --------------------------------------
    gate = np.ones(N)
    g0, g1 = bt(27.5), bt(28.0)
    gate[(t >= g0) & (t < g1)] = 0.10
    ramp = (t >= g0 - 0.02) & (t < g0)
    gate[ramp] = np.linspace(1, 0.10, ramp.sum())
    bed *= gate[:, None]
    dry *= gate[:, None]
    wet *= gate[:, None]

    # ---- riser + snare roll (26 - 28) ---------------------------------------------------------------
    r0, r1 = bt(26.0), bt(28.0) - 0.02
    n = int((r1 - r0) * SR)
    u = np.linspace(0, 1, n)
    lo = noise(n, 200, 1500) * np.clip(1 - u * 1.6, 0, 1)
    hi = noise(n, 2500, 11000) * np.clip(u * 1.4 - 0.2, 0, 1)
    riser = (lo * 0.8 + hi * 1.1) * (u ** 2.0) * 0.9
    sweep = np.sin(2 * np.pi * np.cumsum(200 * 2 ** (u * 3.2)) / SR) * u ** 3 * 0.10
    place(dry, riser + sweep, r0, 0.0, 0.55)
    place(wet, riser * 0.4, r0, 0.0, 0.5)
    k = 26.0
    while k < 27.97:
        v = 0.25 + 0.75 * (k - 26.0) / 2.0
        nn = int(SR * 0.09)
        tt = np.arange(nn) / SR
        sn = (slice_noise(BP_NOISE, nn) * 0.8 + np.sin(2 * np.pi * 190 * tt) * 0.5) * np.exp(-tt / 0.04)
        place(dry, sn, bt(k), 0.0, 0.40 * v)
        k += 0.25 if k < 27.0 else 0.125

    # ---- the drop at beat 28: logo locks -----------------------------------------------------------------
    h = bt(28.0)
    place(dry, kick(), h, 0, 1.15)
    n = int(SR * 2.4)
    th = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(42 + 95 * np.exp(-th / 0.06)) / SR) * np.exp(-th / 0.9)
    place(dry, sub, h, 0, 0.85)
    crash = noise(n, 4500, None) * np.exp(-th / 0.8)
    place(dry, crash, h, 0.1, 0.35)
    place(wet, crash, h, 0.0, 0.30)
    place(wet, metal(520, 2.0, 0.9), h, 0.0, 0.22)           # one clean kettlebell ring on the logo
    for m in (60, 64, 67, 72, 76):                           # C major stab
        stab = lead_note(mtof(m), 0.55)
        place(dry, stab, h, (m - 66) / 40.0, 0.16)
        place(wet, stab, h, 0.0, 0.16)
    place(dry, kick(), bt(30.0), 0, 0.55)
    place(dry, clap(), bt(30.0), 0.0, 0.25)

    # ---- reverb + master ------------------------------------------------------------------------------------
    for ch, seed in ((0, 1), (1, 2)):
        wet[:, ch] = conv(wet[:, ch], reverb_ir(1.9, seed)) * 1.1 + wet[:, ch] * 0.15
    m = dry + bed + wet
    for ch in (0, 1):
        m[:, ch] = fft_filter(m[:, ch], 30, 17000, order=3)
    m *= np.minimum(t / 0.01, 1)[:, None] * np.clip((T - t) / 0.7, 0, 1)[:, None] ** 1.4
    rms = np.sqrt((m ** 2).mean())
    m *= 10 ** (-15.0 / 20) / rms                      # target RMS ~ -15 dBFS, then glue
    m = np.tanh(m * 1.25) / 1.25
    m *= min(1.0, 0.89 / np.abs(m).max())
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="out/raeng-advert-audio.wav")
    a = ap.parse_args()
    m = build()
    pcm = (np.clip(m, -1, 1) * 32767).astype("<i2")
    with wave.open(a.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", a.out, f"{len(m) / SR:.3f}s", "peak", round(float(np.abs(m).max()), 3))


if __name__ == "__main__":
    main()
