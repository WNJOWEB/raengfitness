#!/usr/bin/env python3
"""RAENG Fitness — 15 second brand advert (v2: light, minimal, beat-locked).

Every frame is composed with numpy/Pillow and piped to ffmpeg.  Footage is the
genuine class video from raengfitness.co.uk (assets/hero-portrait.mp4); the
genuine black logo lockup closes the film.  The picture is cut to the same
128 bpm grid as audio.py (8 bars = exactly 15.000 s).

    python3 render.py --aspect 9x16 --out out/raeng-advert-9x16-silent.mp4
    python3 render.py --still 30,90,200      # PNG stills for review
"""
import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

FPS = 24
DUR = 15
NF = FPS * DUR
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
SRC = os.path.join(ASSETS, "hero-portrait.mp4")  # 540x960, 30 fps, 17.7 s
SRC_W, SRC_H = 540, 960
LOGO = os.path.join(ASSETS, "raeng-lockup-black.png")
FONT = os.path.join(ASSETS, "Archivo.ttf")

PAPER = np.array([245, 242, 235], np.float32) / 255.0  # raengfitness.co.uk background
INK = (11, 11, 11)  # DESIGN.md `ink`
MUTED = (87, 84, 78)  # DESIGN.md `muted`

BPM = 128
BEAT = 60.0 / BPM  # 0.46875 s; 32 beats = 15.000 s


def b(k):
    """beat number -> seconds"""
    return k * BEAT


def f2(t):
    return int(round(t * FPS))


def expo_out(x):
    x = float(np.clip(x, 0.0, 1.0))
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)


def io(x):
    x = float(np.clip(x, 0.0, 1.0))
    return x * x * x * (x * (6 * x - 15) + 10)  # smootherstep


class Cfg:
    def __init__(self, aspect):
        self.aspect = aspect
        if aspect == "9x16":
            self.W, self.H = 1080, 1920
            self.win = (60, 150, 960, 1320)  # x, y, w, h
            self.radius = 44
            self.text_cx, self.text_cy, self.text_w = 540, 1688, 900
            self.fs = 108
            self.head_xy = (540, 84)
            self.logo_h, self.logo_cy = 500, 760
            self.slogan_cy, self.url_cy = 1205, 1395
        else:
            self.W, self.H = 1920, 1080
            self.win = (80, 80, 880, 920)
            self.radius = 40
            self.text_cx, self.text_cy, self.text_w = 1400, 540, 800
            self.fs = 112
            self.head_xy = (1400, 120)
            self.logo_h, self.logo_cy = 470, 400
            self.slogan_cy, self.url_cy = 790, 905
        self.portrait = self.H > self.W
        self.logo_cx = self.W // 2


# --------------------------------------------------------------------------
# Footage
# --------------------------------------------------------------------------
def grade(img):
    """Bright, natural, a touch warm.  Opens up the dark gym; tames loud shirts."""
    y = np.clip(img, 0, 1) ** 0.63 * 1.12
    y = np.clip(y, 0, 1)
    s = y * y * (3 - 2 * y)
    y = y * 0.7 + s * 0.3
    g = (y @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    chroma = (y.max(-1) - y.min(-1))[..., None]
    k = 0.90 / (1 + 1.1 * chroma)
    y = g + (y - g) * k
    y = y * np.array([1.02, 1.0, 0.975], np.float32)
    return np.clip(y, 0, 1)


class Clip:
    """A crop of the source, push-in and a percussive punch on the cut."""

    def __init__(self, cfg, ss, speed, cx, cy, ch, z0=1.0, z1=1.10, punch=0.0, pan=(0, 0)):
        self.cfg, self.ss, self.speed = cfg, ss, speed
        self.z0, self.z1, self.punch, self.pan = z0, z1, punch, pan
        _, _, ww, wh = cfg.win
        ratio = ww / wh
        cw, chh = ch * ratio, ch
        if cw > SRC_W:
            cw, chh = SRC_W, SRC_W / ratio
        if chh > SRC_H:
            chh, cw = SRC_H, SRC_H * ratio
        x0 = int(np.clip(cx - cw / 2, 0, SRC_W - cw))
        y0 = int(np.clip(cy - chh / 2, 0, SRC_H - chh))
        self.crop = (int(cw) // 2 * 2, int(chh) // 2 * 2, x0, y0)
        self.SW, self.SH = int(ww * 1.25) // 2 * 2, int(wh * 1.25) // 2 * 2
        self.ww, self.wh = ww, wh

    def raw(self, n):
        cw, ch, x0, y0 = self.crop
        if self.speed < 1:
            pre = f"setpts=PTS/{self.speed},minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"
        else:
            pre = "fps=24"
        vf = f"{pre},crop={cw}:{ch}:{x0}:{y0},scale={self.SW}:{self.SH}:flags=lanczos"
        cmd = ["ffmpeg", "-v", "error", "-ss", f"{self.ss}", "-i", SRC, "-vf", vf,
               "-frames:v", str(n), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
        size = self.SW * self.SH * 3
        last = None
        for _ in range(n):
            buf = p.stdout.read(size)
            if len(buf) < size:
                buf = last
            if buf is None:
                break
            last = buf
            yield np.frombuffer(buf, np.uint8).reshape(self.SH, self.SW, 3)
        p.stdout.close()
        p.wait()

    def frames(self, n):
        for i, a in enumerate(self.raw(n)):
            u = i / max(1, n - 1)
            z = self.z0 + (self.z1 - self.z0) * u
            z += self.punch * np.exp(-(i / FPS) / 0.10)  # settles in like a hit
            w, h = self.SW / z, self.SH / z
            px = self.pan[0] * (u - 0.5)
            x = (self.SW - w) / 2 * (1 + px)
            y = (self.SH - h) / 2
            im = Image.fromarray(a).resize((self.ww, self.wh), Image.BICUBIC, box=(x, y, x + w, y + h))
            yield grade(np.asarray(im, np.float32) / 255.0)


def rounded_mask(w, h, r):
    ss = 3
    im = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(im).rounded_rectangle((0, 0, w * ss - 1, h * ss - 1), radius=r * ss, fill=255)
    return np.asarray(im.resize((w, h), Image.LANCZOS), np.float32)[..., None] / 255.0


# --------------------------------------------------------------------------
# Type: lines rise out of an invisible slot (masked reveal), on the beat
# --------------------------------------------------------------------------
class Lines:
    def __init__(self, cfg, lines, t_ins, t_out, cy=None, cx=None, size=None, wght=800, wdth=112,
                 track=-0.02, color=INK, maxw=None, dur=0.42):
        self.cfg, self.t_ins, self.t_out, self.color, self.dur = cfg, t_ins, t_out, color, dur
        size = size or cfg.fs
        maxw = maxw or cfg.text_w
        while True:
            font = ImageFont.truetype(FONT, size)
            font.set_variation_by_axes([wght, wdth])
            widths = [sum(font.getlength(c) + track * size for c in ln) - track * size for ln in lines]
            if max(widths) <= maxw or size < 16:
                break
            size = int(size * 0.97)
        self.size = size
        self.lh = int(size * 1.16)
        cx = cx if cx is not None else cfg.text_cx
        cy = cy if cy is not None else cfg.text_cy
        top = int(cy - self.lh * len(lines) / 2)
        self.slots = []
        for k, ln in enumerate(lines):
            w = int(widths[k]) + 8
            im = Image.new("L", (w, self.lh), 0)
            d = ImageDraw.Draw(im)
            x = 4
            for ch in ln:
                d.text((x, int(size * 0.10)), ch, font=font, fill=255)
                x += font.getlength(ch) + track * size
            self.slots.append((np.asarray(im, np.float32) / 255.0, cx - w // 2, top + k * self.lh))

    def draw(self, out, t):
        for k, (m, x0, y0) in enumerate(self.slots):
            tin = self.t_ins[k]
            if t < tin or t >= self.t_out:
                continue
            lh = m.shape[0]
            p = expo_out((t - tin) / self.dur)
            xd = self.dur * 0.8
            q = expo_out((t - self.t_out + xd) / xd) if t > self.t_out - xd else 0.0
            dy = -int(q * lh * 1.05) if q > 0 else int((1 - p) * lh * 1.05)
            sh = np.zeros_like(m)
            if dy >= 0:
                if dy < lh:
                    sh[dy:] = m[: lh - dy]
            elif -dy < lh:
                sh[: lh + dy] = m[-dy:]
            reg = out[y0:y0 + lh, x0:x0 + m.shape[1]]
            al = sh[..., None]
            reg *= (1 - al)
            reg += al * (np.array(self.color, np.float32) / 255.0)


# --------------------------------------------------------------------------
# End card: the genuine black lockup on paper
# --------------------------------------------------------------------------
class Logo:
    def __init__(self, cfg, t0, t_hit):
        self.cfg, self.t0, self.t_hit = cfg, t0, t_hit
        im = Image.open(LOGO).convert("RGBA")
        im = im.crop(im.getbbox())
        lh = cfg.logo_h
        self.base = im.resize((int(im.width * lh / im.height), lh), Image.LANCZOS)

    def draw(self, out, t):
        if t < self.t0:
            return
        p = expo_out((t - self.t0) / 0.5)
        dt = t - self.t_hit
        s = (0.93 + 0.07 * p) * (1 + (0.012 * np.exp(-dt / 0.14) if dt > 0 else 0))
        w, h = self.base.size
        im = self.base.resize((int(w * s), int(h * s)), Image.LANCZOS)
        a = np.asarray(im.split()[3], np.float32)[..., None] / 255.0 * min(1.0, p * 1.6)
        hh, ww = a.shape[:2]
        x0, y0 = self.cfg.logo_cx - ww // 2, self.cfg.logo_cy - hh // 2
        reg = out[y0:y0 + hh, x0:x0 + ww]
        rgb = np.asarray(im.convert("RGB"), np.float32) / 255.0
        reg *= (1 - a)
        reg += a * rgb


# --------------------------------------------------------------------------
# Timeline (beats @128 bpm)
# --------------------------------------------------------------------------
T_CLOSE = b(26.0)       # window collapses
T_CLOSE_END = b(27.0)
T_LOGO = b(27.0)
T_HIT = b(28.0)         # impact + chord, logo locks


def build(cfg):
    # (start beat, Clip(ss, speed, cx, cy, crop height, z0, z1, punch))
    shots = [
        (0.0, Clip(cfg, 6.10, 0.40, 300, 560, 520, 1.00, 1.14, 0.0)),            # hands on the handle
        (6.0, Clip(cfg, 0.95, 0.50, 250, 560, 700, 1.00, 1.18, 0.06, (0.5, 0))),  # slow-motion swing
        (12.0, Clip(cfg, 6.85, 1.0, 270, 520, 700, 1.00, 1.10, 0.07)),            # coach, bell down
        (13.0, Clip(cfg, 7.80, 1.0, 290, 560, 800, 1.00, 1.08, 0.07)),            # hinge
        (14.0, Clip(cfg, 8.45, 1.0, 330, 500, 640, 1.00, 1.10, 0.07)),            # bell through the frame
        (15.0, Clip(cfg, 10.0, 1.0, 270, 470, 600, 1.00, 1.10, 0.07)),            # effort
        (16.0, Clip(cfg, 11.45, 1.0, 270, 440, 760, 1.00, 1.08, 0.07)),           # bell overhead
        (17.0, Clip(cfg, 12.40, 1.0, 270, 560, 760, 1.00, 1.08, 0.07)),           # hinge, wide
        (18.0, Clip(cfg, 13.80, 1.0, 300, 560, 700, 1.00, 1.08, 0.07)),           # goblet squat
        (19.0, Clip(cfg, 15.10, 1.0, 270, 560, 740, 1.00, 1.08, 0.07)),           # goblet, class behind
        (20.0, Clip(cfg, 16.70, 0.40, 280, 580, 760, 1.00, 1.16, 0.0)),           # final shot, slow
    ]
    starts = [f2(b(s[0])) for s in shots]
    ends = starts[1:] + [f2(T_CLOSE_END) + 1]
    gens = [(st, en, s[1]) for st, en, s in zip(starts, ends, shots)]

    L = [
        Lines(cfg, ["STRENGTH", "IS BUILT."], [b(1.0), b(2.0)], b(6.0)),
        Lines(cfg, ["ONE REP", "AT A TIME."], [b(7.0), b(8.0)], b(12.0)),
        Lines(cfg, ["MORE THAN", "A WORKOUT."], [b(12.5), b(14.0)], b(20.0)),
        Lines(cfg, ["BE PART OF", "SOMETHING", "STRONGER."], [b(21.0), b(22.0), b(23.0)], b(26.0),
              size=int(cfg.fs * 0.94)),
    ]
    sub = int(cfg.fs * 0.50)
    slogan = ["BE PART OF", "SOMETHING STRONGER."] if cfg.portrait else ["BE PART OF SOMETHING STRONGER."]
    L.append(Lines(cfg, slogan, [b(29.0), b(29.5)][: len(slogan)], 99, cy=cfg.slogan_cy, cx=cfg.W // 2,
                   size=sub, wght=800, wdth=108, track=0.0, maxw=cfg.W * 0.9))
    L.append(Lines(cfg, ["Visit raengfitness.co.uk"], [b(30.5)], 99, cy=cfg.url_cy, cx=cfg.W // 2,
                   size=int(cfg.fs * 0.34), wght=500, wdth=100, track=0.05, color=MUTED, maxw=cfg.W * 0.9))
    head = Lines(cfg, ["RAENG FITNESS"], [0.05], T_CLOSE + 0.25, cy=cfg.head_xy[1], cx=cfg.head_xy[0],
                 size=int(cfg.fs * 0.27), wght=700, wdth=100, track=0.30, color=MUTED, maxw=cfg.W * 0.8, dur=0.5)
    return gens, L, head, Logo(cfg, T_LOGO, T_HIT)


def compose(cfg):
    gens, texts, head, logo = build(cfg)
    H, W = cfg.H, cfg.W
    wx, wy, ww, wh = cfg.win
    full_mask = rounded_mask(ww, wh, cfg.radius)
    live = {}
    for i in range(NF):
        t = i / FPS
        out = np.empty((H, W, 3), np.float32)
        out[:] = PAPER
        frame = None
        for gi, (st, en, clip) in enumerate(gens):
            if st <= i < en:
                if gi not in live:
                    live[gi] = clip.frames(en - st)
                frame = next(live[gi], None)
            elif i >= en:
                live.pop(gi, None)
        # open on beat 0; collapse into the logo on beats 26-27
        po = expo_out(t / 0.45)
        pc = io((t - T_CLOSE) / (T_CLOSE_END - T_CLOSE))
        g = po * (1 - pc)
        if frame is not None and g > 0.004:
            wc = max(2, int(ww * (0.32 + 0.68 * g)))
            hc = max(2, int(wh * g))
            xa, ya = (ww - wc) // 2, (wh - hc) // 2
            sub = frame[ya:ya + hc, xa:xa + wc]
            if g >= 0.999:
                m = full_mask[ya:ya + hc, xa:xa + wc]
            else:
                m = rounded_mask(wc, hc, min(cfg.radius, hc // 2, wc // 2))
            reg = out[wy + ya:wy + ya + hc, wx + xa:wx + xa + wc]
            reg[:] = reg * (1 - m) + sub * m
        head.draw(out, t)
        for tx in texts:
            tx.draw(out, t)
        logo.draw(out, t)
        yield i, (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aspect", default="9x16", choices=["9x16", "16x9"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--still", default=None, help="comma list of frame numbers -> PNGs next to --out")
    ap.add_argument("--keep", default=None, help="full render, but also save these frames as PNG")
    ap.add_argument("--crf", type=int, default=16)
    a = ap.parse_args()
    cfg = Cfg(a.aspect)
    out = a.out or os.path.join(HERE, "out", f"raeng-advert-{a.aspect}-silent.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if a.still:
        stills = {int(x) for x in a.still.split(",")}
        for i, fr in compose(cfg):
            if i in stills:
                Image.fromarray(fr).save(out.replace(".mp4", f"_f{i:03d}.png"))
            if i >= max(stills):
                break
        return
    keep = {int(x) for x in a.keep.split(",")} if a.keep else set()
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{cfg.W}x{cfg.H}",
           "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf),
           "-pix_fmt", "yuv420p", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709",
           "-color_trc", "bt709", "-movflags", "+faststart", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i, fr in compose(cfg):
        if i in keep:
            Image.fromarray(fr).save(out.replace(".mp4", f"_f{i:03d}.png"))
        p.stdin.write(fr.tobytes())
        if i % 24 == 0:
            print(f"frame {i}/{NF}", file=sys.stderr, flush=True)
    p.stdin.close()
    p.wait()


if __name__ == "__main__":
    main()
