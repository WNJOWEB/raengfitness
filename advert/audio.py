#!/usr/bin/env python3
"""Synthesised sound design for the RAENG Fitness 15s advert (numpy only, no samples).

Timeline (matches render.py):
  0-3s   sub-bass atmosphere, kettlebell handle clink + chalk grip (~1.3s)
  3-6s   slow-motion swing: whooshes, deep percussion, controlled breathing
  6-10s  cuts on the 90 bpm grid: percussion drives every cut, breathing quickens
  10-13s riser through the final shot and the black, 13.0s restrained impact
  13-15s sub + metallic ring-out with reverb tail
"""
import argparse
import wave

import numpy as np

SR = 48000
T = 15.0
N = int(SR * T)
t = np.arange(N) / SR
rng = np.random.default_rng(42)
BEAT = 60 / 90


def stereo(x, pan=0.0):
    l = np.sqrt(0.5 * (1 - pan))
    r = np.sqrt(0.5 * (1 + pan))
    return np.stack([x * l, x * r], 1)


def place(buf, sig, t0, pan=0.0, gain=1.0):
    i = int(t0 * SR)
    n = min(len(sig), N - i)
    if n <= 0:
        return
    buf[i:i + n] += stereo(sig[:n] * gain, pan)


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


def env_ad(n, a, d):
    tt = np.arange(n) / SR
    return np.minimum(tt / max(a, 1e-4), 1) * np.exp(-tt / d)


def kick(f0=120, f1=42, dur=1.0, pdec=0.07, adec=0.30, click=0.25):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    ph = 2 * np.pi * (f1 * tt + (f0 - f1) * pdec * (1 - np.exp(-tt / pdec)))
    s = np.sin(ph) * np.exp(-tt / adec)
    s += click * noise(n, 1500, 6000) * np.exp(-tt / 0.008)
    return s


def taiko(dur=1.6, f=64):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * (f + 40 * np.exp(-tt / 0.05)) * tt) * np.exp(-tt / 0.55)
    s += 0.35 * np.sin(2 * np.pi * f * 2.3 * tt) * np.exp(-tt / 0.18)
    s += 0.4 * noise(n, 300, 2500) * np.exp(-tt / 0.05)
    return s


def metal(f=620, dur=2.0, amp=1.0, decay=0.6):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    s = np.zeros(n)
    for ratio, a, d in ((1.0, 1.0, 1.0), (2.76, 0.6, 0.62), (5.40, 0.4, 0.38), (8.93, 0.25, 0.22), (13.3, 0.12, 0.12)):
        s += a * np.sin(2 * np.pi * f * ratio * tt + rng.random() * 6.28) * np.exp(-tt / (decay * d))
    s += 0.8 * noise(n, 2500, 9000) * np.exp(-tt / 0.006)
    return s * amp


def whoosh(dur=0.9, lo=300, hi=2200, peak=0.45):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    x = noise(n, lo, hi)
    e = np.sin(np.pi * np.clip(tt / dur, 0, 1)) ** 2
    e = np.where(tt / dur < peak, (tt / (dur * peak)) ** 2, np.cos((tt / dur - peak) / (1 - peak) * np.pi / 2) ** 2)
    return x * e


def breath(dur, kind):
    n = int(SR * dur)
    tt = np.arange(n) / SR
    x = noise(n, 500, 2400) + 0.5 * noise(n, 1800, 4500)
    u = tt / dur
    if kind == "in":
        e = np.sin(np.pi * u ** 0.8) ** 2
    else:
        e = np.where(u < 0.2, (u / 0.2) ** 1.5, np.exp(-(u - 0.2) * 3.2))
    return x * e


def reverb_ir(dur=2.2, seed=0):
    r = np.random.default_rng(seed)
    n = int(SR * dur)
    tt = np.arange(n) / SR
    ir = r.standard_normal(n) * np.exp(-tt / (dur / 5.5))
    ir = fft_filter(ir, 120, 5500)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    return ir / np.sqrt((ir ** 2).sum())   # unit energy so the wet level is predictable


def conv(x, ir):
    n = len(x) + len(ir)
    nf = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nf) * np.fft.rfft(ir, nf), nf)[: len(x)]


def build():
    dry = np.zeros((N, 2))   # kept dry
    wet = np.zeros((N, 2))   # sent to reverb

    # --- 1. atmospheric bass: always present, builds to the end card --------
    lvl = np.interp(t, [0, 1.5, 6, 10, 12.3, 13.0, 15], [0.10, 0.22, 0.34, 0.50, 0.62, 0.45, 0.22])
    drone = (np.sin(2 * np.pi * 43.65 * t) + 0.7 * np.sin(2 * np.pi * 43.65 * 1.004 * t)
             + 0.45 * np.sin(2 * np.pi * 65.41 * t + 0.6 * np.sin(2 * np.pi * 0.11 * t))
             + 0.18 * np.sin(2 * np.pi * 87.3 * t))
    drone *= (0.8 + 0.2 * np.sin(2 * np.pi * 0.17 * t)) * lvl * 0.42
    air = fft_filter(rng.standard_normal(N), 60, 340) * np.interp(t, [0, 3, 10, 12.5, 15], [0.02, 0.05, 0.12, 0.16, 0.06]) * 3.0
    pad_l = air
    pad_r = fft_filter(rng.standard_normal(N), 60, 340) * np.interp(t, [0, 3, 10, 12.5, 15], [0.02, 0.05, 0.12, 0.16, 0.06]) * 3.0
    dry[:, 0] += drone + pad_l
    dry[:, 1] += drone + pad_r

    # --- 2. kettlebell metal + chalk / grip detail (0-3s) -------------------
    place(wet, metal(640, 2.2, 0.50, 0.9), 1.28, -0.1)          # handle touched
    place(wet, metal(980, 1.2, 0.16, 0.35), 1.50, 0.15)         # rattle
    place(wet, metal(410, 1.8, 0.14, 0.7), 2.10, -0.2)          # bell shifts
    chalk = noise(int(1.1 * SR), 3500, 11000)
    am = 0.5 + 0.5 * np.sin(2 * np.pi * 37 * np.arange(len(chalk)) / SR + 3 * np.sin(2 * np.pi * 5 * np.arange(len(chalk)) / SR))
    ce = np.sin(np.pi * np.linspace(0, 1, len(chalk))) ** 1.5
    place(dry, chalk * am * ce, 1.15, 0.0, 0.16)
    place(dry, noise(int(0.5 * SR), 2500, 9000) * np.sin(np.pi * np.linspace(0, 1, int(0.5 * SR))) ** 2, 2.05, 0.2, 0.07)
    # first grip thump
    place(dry, kick(90, 38, 1.2, 0.09, 0.4, 0.1), 1.30, 0, 0.55)

    # --- 3. slow-motion swing 3-6s ------------------------------------------
    sw = [3.15, 4.40, 5.65]
    for k, s in enumerate(sw):
        place(dry, whoosh(1.0, 250, 1800), s - 0.1, -0.3 + 0.3 * k, 0.30)
        place(dry, taiko(1.8, 58 + 2 * k), s + 0.55 if k else 3.0, 0, 0.85 if k else 0.8)
        place(wet, taiko(1.8, 58), s + 0.55 if k else 3.0, 0, 0.35)
    place(wet, metal(330, 2.0, 0.10, 0.5), 3.65, 0.3)
    place(wet, metal(330, 2.0, 0.10, 0.5), 4.90, -0.3)

    # --- 4. controlled breathing --------------------------------------------
    bt = 3.35
    while bt < 10.0:
        cyc = 2.1 if bt < 6.0 else 1.34
        amp = np.interp(bt, [3.3, 6.0, 10.0], [0.040, 0.070, 0.105])
        place(dry, breath(cyc * 0.42, "in"), bt, -0.12, amp)
        place(dry, breath(cyc * 0.5, "out"), bt + cyc * 0.45, 0.12, amp * 1.25)
        bt += cyc

    # --- 5. percussion on the 90bpm grid, locked to the picture cuts --------
    for k in range(6):
        tt0 = 6.0 + k * BEAT
        g = 0.55 + 0.07 * k
        place(dry, kick(130, 44, 0.9, 0.06, 0.26, 0.22), tt0, 0, g)
        place(wet, taiko(1.2, 66), tt0, 0, 0.22)
        place(dry, whoosh(0.34, 800, 6000, 0.7), tt0 - 0.30, 0.0, 0.16)  # swish into each cut
        h = tt0 + BEAT / 2
        place(dry, noise(int(0.09 * SR), 5000, 12000) * env_ad(int(0.09 * SR), 0.001, 0.02), h, 0.2, 0.10 + 0.01 * k)
    place(dry, taiko(2.4, 52), 10.0, 0, 1.05)                          # arrival of the final shot
    place(wet, taiko(2.4, 52), 10.0, 0, 0.6)

    # --- 6. riser across the final shot + black, then the hit at 13.0 -------
    r0, r1 = 10.3, 12.96
    n = int((r1 - r0) * SR)
    tt = np.linspace(0, 1, n)
    rs = noise(n, 350, 6500) + 0.8 * noise(n, 1200, 9000)
    rs *= tt ** 2.6 * 0.42 * (1 - np.clip((tt - 0.985) / 0.015, 0, 1))
    sweep = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (tt * 3.0)) / SR) * tt ** 3 * 0.05
    place(dry, rs, r0, 0.0)
    place(wet, rs * 0.4, r0, 0.0)
    place(dry, sweep, r0, 0.0)

    hit = 13.0
    n = int(3.2 * SR)
    th = np.arange(n) / SR
    sub = np.sin(2 * np.pi * (40 + 70 * np.exp(-th / 0.07)) * th) * np.exp(-th / 1.25)
    body = noise(n, 70, 1800) * np.exp(-th / 0.22) * 0.55
    ring = metal(310, 3.2, 0.14, 1.4)[:n] + 0.5 * metal(466, 3.2, 0.08, 1.1)[:n]
    place(dry, sub * 0.95 + body, hit, 0, 1.0)
    place(wet, body * 0.8 + ring, hit, 0, 1.0)
    place(dry, taiko(2.4, 46), hit, 0, 0.55)

    # --- reverb send ---------------------------------------------------------
    for ch, seed in ((0, 1), (1, 2)):
        dry[:, ch] += conv(wet[:, ch], reverb_ir(2.4, seed)) * 1.6 + wet[:, ch] * 0.5

    # --- master ---------------------------------------------------------------
    for ch in (0, 1):
        dry[:, ch] = fft_filter(dry[:, ch], 28, 17500, order=3)
    m = dry
    m *= np.minimum(t / 0.04, 1)[:, None] * np.clip((T - t) / 0.6, 0, 1)[:, None] ** 1.5
    m = m * 0.62                      # gain staging
    m = np.tanh(m * 1.2) / 1.2        # gentle soft limiter
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
    print("wrote", a.out, f"{len(m) / SR:.3f}s")


if __name__ == "__main__":
    main()
