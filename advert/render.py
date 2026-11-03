#!/usr/bin/env python3
"""RAENG Fitness — 15 second brand advert renderer.

Deterministic, code-driven edit: every frame is composed with numpy/Pillow and
piped to ffmpeg.  Real class footage comes from raengfitness.co.uk
(assets/hero-portrait.mp4); the macro kettlebell surface and chalk particles
are original procedural visuals.  The genuine logo lockup is used for the end
card.  See README.md for the shot list and how to adapt to 16:9.

    python3 render.py --aspect 9x16 --out out/raeng-advert-9x16-silent.mp4
    python3 render.py --still 30,90,200,330        # PNG stills for review
"""
import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 24
DUR = 15
NF = FPS * DUR
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
SRC = os.path.join(ASSETS, "hero-portrait.mp4")  # 540x960, 30fps, 17.7s
SRC_W, SRC_H = 540, 960
LOGO = os.path.join(ASSETS, "raeng-lockup-black.png")
FONT = os.path.join(ASSETS, "Archivo.ttf")
WHITE = (250, 250, 248)

BEAT = 60.0 / 90.0  # 90 bpm; all cuts in the EXPERIENCE section land on the beat


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = np.clip(x, 0.0, 1.0)
    return 1 - (1 - x) ** 3


def f2(t):
    """seconds -> frame index"""
    return int(round(t * FPS))


class Cfg:
    def __init__(self, aspect):
        self.aspect = aspect
        if aspect == "9x16":
            self.W, self.H = 1080, 1920
        else:
            self.W, self.H = 1920, 1080
        self.portrait = self.H > self.W
        # base display size for headline statements
        self.fs = int(0.105 * self.W) if self.portrait else int(0.098 * self.H)
        self.maxw = 0.86 * self.W if self.portrait else 0.62 * self.W
        self.ty = 0.70 if self.portrait else 0.74  # headline block centre (fraction of H)


# --------------------------------------------------------------------------
# Light: a narrow diagonal studio beam
# --------------------------------------------------------------------------
class Beam:
    def __init__(self, cfg, sigma_frac, x_top=0.80, x_bot=0.26):
        W, H = cfg.W, cfg.H
        self.cfg = cfg
        self.sigma = sigma_frac * W
        self.x_top, self.x_bot = x_top, x_bot
        Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
        self.X, self.Y = X, Y

    def _n(self):
        W, H = self.cfg.W, self.cfg.H
        vx, vy = (self.x_bot - self.x_top) * W, H
        nrm = (vx * vx + vy * vy) ** 0.5
        return vy / nrm, -vx / nrm  # unit normal

    def mask(self, shift=0.0, sigma_mult=1.0):
        W = self.cfg.W
        nx, ny = self._n()
        d = (self.X - (self.x_top + shift) * W) * nx + self.Y * ny
        s = self.sigma * sigma_mult
        return np.exp(-0.5 * (d / s) ** 2).astype(np.float32)

    def at(self, x, y, shift=0.0, sigma_mult=1.0):
        W = self.cfg.W
        nx, ny = self._n()
        d = (x - (self.x_top + shift) * W) * nx + y * ny
        return np.exp(-0.5 * (d / (self.sigma * sigma_mult)) ** 2)


# --------------------------------------------------------------------------
# Chalk dust drifting through the beam
# --------------------------------------------------------------------------
class Dust:
    def __init__(self, cfg, beam, n=320, seed=7, gain=1.0):
        self.cfg, self.beam, self.gain = cfg, beam, gain
        r = np.random.default_rng(seed)
        self.n = n
        self.p = r.random((n, 2)).astype(np.float64)  # normalised position
        self.z = r.random(n)  # depth 0 near .. 1 far
        self.v = np.stack([r.normal(0.004, 0.006, n), r.normal(-0.018, 0.008, n)], 1)
        self.ph = r.random(n) * 6.28
        self.sz = 0.8 + (1 - self.z) ** 1.6 * 5.5
        self.br = 0.35 + 0.65 * r.random(n)

    def render(self, t, shift=0.0, sigma_mult=1.6):
        W, H = self.cfg.W, self.cfg.H
        w, h = W // 2, H // 2
        pos = (self.p + self.v * t * 4.0) % 1.0
        pos[:, 0] += 0.012 * np.sin(t * 0.9 + self.ph)
        pos[:, 1] += 0.008 * np.cos(t * 0.7 + self.ph * 1.3)
        x, y = pos[:, 0] * W, pos[:, 1] * H
        lit = self.beam.at(x, y, shift, sigma_mult)
        tw = 0.65 + 0.35 * np.sin(t * 3.1 + self.ph * 2)
        val = np.clip(lit * self.br * tw * self.gain, 0, 1)
        out = np.zeros((h, w), np.float32)
        for lo, hi, blur in ((0.0, 0.34, 3.2), (0.34, 0.68, 1.5), (0.68, 1.01, 0.6)):
            sel = (self.z >= lo) & (self.z < hi) & (val > 0.02)
            if not sel.any():
                continue
            im = Image.new("L", (w, h), 0)
            d = ImageDraw.Draw(im)
            for xi, yi, vi, si in zip(x[sel] / 2, y[sel] / 2, val[sel], self.sz[sel] / 2):
                rr = max(0.6, si)
                d.ellipse((xi - rr, yi - rr, xi + rr, yi + rr), fill=int(255 * vi))
            im = im.filter(ImageFilter.GaussianBlur(blur))
            out += np.asarray(im, np.float32) / 255.0 * (1.0 + 0.9 * blur / 3.2)
        big = Image.fromarray(np.clip(out * 255, 0, 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
        return np.asarray(big, np.float32) / 255.0


# --------------------------------------------------------------------------
# Grade: monochrome-leaning, deep blacks, natural skin, no loud colours
# --------------------------------------------------------------------------
class Grade:
    def __init__(self, cfg):
        W, H = cfg.W, cfg.H
        Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((X / W - 0.5) * 2) ** 2 * 0.9 + ((Y / H - 0.5) * 2) ** 2 * 0.9)
        self.vig = (1 - 0.62 * np.clip(r, 0, 1.3) ** 2.2).astype(np.float32)[..., None]
        v = np.clip((Y / H - 0.45) / 0.55, 0, 1)
        self.bottom = (1 - 0.82 * v * v * (3 - 2 * v)).astype(np.float32)[..., None] if cfg.portrait else None

    def __call__(self, img, bottom=True, lift=1.0, sat=0.72):
        g = img @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        g = g[..., None]
        chroma = (img.max(-1) - img.min(-1))[..., None]
        k = sat / (1 + 2.6 * chroma)
        img = g + (img - g) * k
        img = np.clip((img - 0.035) / 0.93, 0, 1) ** 1.22 * lift
        s = img * img * (3 - 2 * img)
        img = img * 0.45 + s * 0.55
        img = img * np.array([1.025, 1.0, 0.965], np.float32)  # faint warmth, skin stays natural
        img = img * self.vig
        if bottom and self.bottom is not None:
            img = img * self.bottom
        return np.clip(img, 0, 1)


def blur_f(img, radius):
    u8 = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    return np.asarray(u8.filter(ImageFilter.GaussianBlur(radius)), np.float32) / 255.0


class DoF:
    """Shallow depth of field: sharp focal ellipse, blurred falloff."""

    def __init__(self, cfg, fx=0.5, fy=0.5, rx=0.32, ry=0.26, radius=9):
        W, H = cfg.W, cfg.H
        Y, X = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt(((X / W - fx) / rx) ** 2 + ((Y / H - fy) / ry) ** 2)
        self.m = smooth((d - 0.55) / 1.1).astype(np.float32)[..., None]
        self.radius = radius

    def __call__(self, img):
        return img * (1 - self.m) + blur_f(img, self.radius) * self.m


# --------------------------------------------------------------------------
# Real footage clip, graded
# --------------------------------------------------------------------------
class Clip:
    def __init__(self, cfg, ss, speed, cx, cy, ch, z0=1.0, z1=1.12, pan0=(0, 0), pan1=(0, 0)):
        self.cfg, self.ss, self.speed = cfg, ss, speed
        self.z0, self.z1, self.pan0, self.pan1 = z0, z1, pan0, pan1
        W, H = cfg.W, cfg.H
        if cfg.portrait:
            cw, chh = ch * W / H, ch
        else:
            cw = min(SRC_W, ch * 9 / 16 * 1.7)
            chh = cw * H / W
        cw, chh = min(cw, SRC_W), min(chh, SRC_H)
        x0 = int(np.clip(cx - cw / 2, 0, SRC_W - cw))
        y0 = int(np.clip(cy - chh / 2, 0, SRC_H - chh))
        self.crop = (int(cw) // 2 * 2, int(chh) // 2 * 2, x0, y0)
        self.SW, self.SH = int(W * 1.25) // 2 * 2, int(H * 1.25) // 2 * 2

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
        W, H = self.cfg.W, self.cfg.H
        for i, a in enumerate(self.raw(n)):
            u = i / max(1, n - 1)
            e = smooth(u) * 0.35 + u * 0.65
            z = self.z0 + (self.z1 - self.z0) * e
            px = self.pan0[0] + (self.pan1[0] - self.pan0[0]) * e
            py = self.pan0[1] + (self.pan1[1] - self.pan0[1]) * e
            w, h = self.SW / z, self.SH / z
            x = (self.SW - w) / 2 * (1 + px)
            y = (self.SH - h) / 2 * (1 + py)
            im = Image.fromarray(a).resize((W, H), Image.BICUBIC, box=(x, y, x + w, y + h))
            yield np.asarray(im, np.float32) / 255.0


# --------------------------------------------------------------------------
# Procedural macro kettlebell surface
# --------------------------------------------------------------------------
def fnoise(rng, h, w, beta):
    f = np.fft.fftfreq(h)[:, None] ** 2 + np.fft.rfftfreq(w)[None, :] ** 2
    f[0, 0] = 1
    spec = np.fft.rfft2(rng.standard_normal((h, w)).astype(np.float32)) * (f ** (-beta / 4)).astype(np.float32)
    spec[0, 0] = 0
    a = np.fft.irfft2(spec, s=(h, w)).astype(np.float32)
    return a / a.std()


class Macro:
    """Cast-iron kettlebell surface under a narrow beam, slow push-in."""

    def __init__(self, cfg, beam):
        self.cfg, self.beam = cfg, beam
        W, H = cfg.W, cfg.H
        self.TW, self.TH = int(W * 1.45) // 2 * 2, int(H * 1.45) // 2 * 2
        rng = np.random.default_rng(11)
        h = 1.0 * fnoise(rng, self.TH, self.TW, 2.4) + 0.55 * fnoise(rng, self.TH, self.TW, 1.5) \
            + 0.40 * fnoise(rng, self.TH, self.TW, 0.7)
        gy, gx = np.gradient(h)
        k = 0.85 / gx.std()
        nx, ny = -gx * k, -gy * k
        nz = np.ones_like(nx)
        nl = np.sqrt(nx * nx + ny * ny + nz * nz)
        nx, ny, nz = nx / nl, ny / nl, nz / nl
        L = np.array([0.58, -0.38, 0.45]); L /= np.linalg.norm(L)
        Hv = L + np.array([0, 0, 1.0]); Hv /= np.linalg.norm(Hv)
        diff = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
        spec = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1) ** 70
        chalk = smooth(fnoise(rng, self.TH, self.TW, 1.7) * 0.7 - 0.55) * (0.5 + 0.5 * smooth(fnoise(rng, self.TH, self.TW, 0.4) * 0.8))
        lit = 0.42 * diff ** 1.6 + 1.5 * spec * (1 - 0.7 * chalk) + 0.55 * chalk * (0.35 + diff)
        lit = np.clip(lit / np.percentile(lit, 99.6), 0, 1)
        self.lit = Image.fromarray((lit * 255).astype(np.uint8))

    def frame(self, i, n):
        W, H = self.cfg.W, self.cfg.H
        u = i / max(1, n - 1)
        z = 1.0 + 0.42 * (smooth(u) * 0.4 + u * 0.6)
        w, h = self.TW / z, self.TH / z
        x = (self.TW - w) * (0.55 - 0.1 * u)
        y = (self.TH - h) * 0.5
        tex = np.asarray(self.lit.resize((W, H), Image.BICUBIC, box=(x, y, x + w, y + h)), np.float32) / 255.0
        return tex[..., None]


# --------------------------------------------------------------------------
# Typography
# --------------------------------------------------------------------------
class Type:
    def __init__(self, cfg, lines, t_in, t_out, ycen, size=None, wght=800, wdth=112, track=-0.02,
                 stagger=0.13, color=WHITE, align="center", fade_out=0.35, xcen=None):
        self.cfg, self.t_in, self.t_out, self.stagger, self.color = cfg, t_in, t_out, stagger, color
        self.fade_out = fade_out
        size = size or cfg.fs
        # fit to width
        while True:
            font = ImageFont.truetype(FONT, size)
            font.set_variation_by_axes([wght, wdth])
            widths = [self._w(font, ln, track, size) for ln in lines]
            if max(widths) <= cfg.maxw or size < 20:
                break
            size = int(size * 0.96)
        self.size = size
        lh = int(size * 1.12)
        self.lh = lh
        W, H = cfg.W, cfg.H
        pad = int(size * 0.5)
        self.layers = []
        total = lh * len(lines)
        ytop = int(ycen * H - total / 2)
        xc = int((xcen if xcen is not None else 0.5) * W)
        for k, ln in enumerate(lines):
            lw = widths[k]
            im = Image.new("L", (int(lw) + pad * 2, lh + pad * 2), 0)
            d = ImageDraw.Draw(im)
            x = pad
            asc = int(size * 0.12)
            for ch in ln:
                d.text((x, pad + asc), ch, font=font, fill=255)
                x += font.getlength(ch) + track * size
            m = np.asarray(im, np.float32) / 255.0
            sh = np.asarray(im.filter(ImageFilter.GaussianBlur(size * 0.22)), np.float32) / 255.0
            self.layers.append((m, sh, xc - im.width // 2, ytop + k * lh - pad))

    @staticmethod
    def _w(font, ln, track, size):
        return sum(font.getlength(c) + track * size for c in ln) - track * size

    def draw(self, out, t):
        if t < self.t_in or t > self.t_out:
            return
        W, H = self.cfg.W, self.cfg.H
        fo = 1 - smooth((t - (self.t_out - self.fade_out)) / self.fade_out)
        for k, (m, sh, x0, y0) in enumerate(self.layers):
            p = float(ease_out((t - self.t_in - k * self.stagger) / 0.95))
            if p <= 0:
                continue
            a = p * fo
            yy = y0 + int((1 - p) * self.lh * 0.5)
            mm, ss = m, sh
            if p < 0.98:
                r = (1 - p) * self.size * 0.12
                mm = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255.0
            h, w = mm.shape
            ya, yb = max(0, yy), min(H, yy + h)
            xa, xb = max(0, x0), min(W, x0 + w)
            if ya >= yb or xa >= xb:
                continue
            sl = (slice(ya - yy, yb - yy), slice(xa - x0, xb - x0))
            reg = out[ya:yb, xa:xb]
            reg *= (1 - 0.72 * a * np.clip(ss[sl] * 1.3, 0, 1))[..., None]
            al = (a * mm[sl])[..., None]
            reg *= (1 - al)
            reg += al * (np.array(self.color, np.float32) / 255.0)


# --------------------------------------------------------------------------
# Logo end card
# --------------------------------------------------------------------------
class LogoCard:
    def __init__(self, cfg, t0, t_hit):
        self.cfg, self.t0, self.t_hit = cfg, t0, t_hit
        W, H = cfg.W, cfg.H
        im = Image.open(LOGO).convert("RGBA")
        im = im.crop(im.getbbox())
        a = im.split()[3]
        white = Image.new("RGBA", im.size, WHITE + (255,))
        white.putalpha(a)  # genuine artwork, recoloured white for the black end card
        lh = int(0.232 * H) if cfg.portrait else int(0.40 * H)
        lw = int(im.width * lh / im.height)
        self.base = white.resize((lw, lh), Image.LANCZOS)
        self.cx = W // 2
        self.cy = int(0.385 * H) if cfg.portrait else int(0.40 * H)

    def draw(self, out, t):
        if t < self.t0:
            return
        W, H = self.cfg.W, self.cfg.H
        p = float(ease_out((t - self.t0) / 1.1))
        wipe = float(smooth((t - self.t0) / 0.75))
        dt = t - self.t_hit
        pulse = 1 + (0.014 * np.exp(-dt / 0.16) if dt > 0 else 0)
        s = (1.06 - 0.06 * p) * pulse
        lw, lh = self.base.size
        im = self.base.resize((int(lw * s), int(lh * s)), Image.LANCZOS)
        a = np.asarray(im.split()[3], np.float32) / 255.0
        hh, ww = a.shape
        xs = (np.arange(ww, dtype=np.float32)[None, :] / ww + np.arange(hh, dtype=np.float32)[:, None] / hh * 0.35) / 1.35
        a *= smooth((wipe * 1.5 - xs) / 0.5).astype(np.float32) * p
        blur = (1 - p) * 14
        if blur > 0.3:
            a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255.0
        x0, y0 = self.cx - ww // 2, self.cy - hh // 2
        reg = out[y0:y0 + hh, x0:x0 + ww]
        # bloom on the impact
        if dt > 0:
            bl = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(26)), np.float32) / 255.0
            reg += (0.30 * np.exp(-dt / 0.28) * bl)[..., None]
        reg *= (1 - a[..., None])
        reg += a[..., None] * (np.array(WHITE, np.float32) / 255.0)


# --------------------------------------------------------------------------
# Timeline
# --------------------------------------------------------------------------
def build(cfg):
    beam_tight = Beam(cfg, 0.075)
    beam_soft = Beam(cfg, 0.20, 0.82, 0.30)
    grade = Grade(cfg)
    macro = Macro(cfg, beam_tight)
    dust_macro = Dust(cfg, beam_tight, n=420, seed=3, gain=1.25)
    dust_wide = Dust(cfg, beam_soft, n=260, seed=5, gain=0.85)
    dof_a = DoF(cfg, 0.5, 0.5, 0.30, 0.22, 10)
    dof_b = DoF(cfg, 0.5, 0.42, 0.40, 0.32, 7)
    black = np.zeros((cfg.H, cfg.W, 3), np.float32)

    # ---- THE DETAIL 0-3s : darkness, macro iron, hand enters the beam -------
    n1 = f2(3.0) + 6
    hand = Clip(cfg, 6.15, 0.40, 300, 560, 520, 1.0, 1.10, pan0=(0.6, 0.0), pan1=(0.0, 0.0))

    def s1():
        hg = hand.frames(n1 - f2(1.0))
        for i in range(n1):
            t = i / FPS
            shift = -0.05 * t / 3.0
            m = beam_tight.mask(shift)
            inten = float(smooth((t - 0.30) / 1.5))
            surf = np.clip(macro.frame(i, n1) * 2.5, 0, 1) ** 1.15 * m[..., None] * inten   # macro iron, lit hard
            surf = surf * np.array([0.93, 0.95, 0.98], np.float32) + 0.006
            if i >= f2(1.0):
                hf = grade(next(hg), bottom=False, lift=1.0, sat=0.6)
                wide = np.clip(beam_tight.mask(shift, 2.4) * 1.35, 0, 1)[..., None]
                a = float(smooth((t - 1.0) / 0.9)) * wide ** 0.9
                surf = surf * (1 - a) + hf * wide * a * (0.55 + 0.45 * inten)
            yield dof_a(surf) if i % 1 == 0 else surf

    # ---- THE MOVEMENT 3-6s : slow-motion swing ------------------------------
    n2 = f2(3.0) + 4
    swing = Clip(cfg, 0.95, 0.5, 150, 590, 520, 1.0, 1.16, pan0=(-0.3, 0.1), pan1=(0.2, 0.0))

    def s2():
        for i, f in enumerate(swing.frames(n2)):
            yield dof_b(grade(f, lift=1.3))

    # ---- THE EXPERIENCE 6-10s : cuts on the beat -----------------------------
    cuts = [
        # ss, speed, cx, cy, ch, z0, z1
        (6.10, 1.0, 270, 500, 800, 1.00, 1.14),   # coach, bell to chest
        (7.85, 1.0, 270, 560, 800, 1.00, 1.12),   # hinge
        (8.80, 0.6, 270, 440, 640, 1.00, 1.10),   # bell swings through
        (9.95, 0.6, 270, 400, 560, 1.00, 1.14),   # sweat, effort
        (12.45, 0.8, 270, 540, 760, 1.00, 1.12),  # hinge, wide
        (13.55, 0.8, 270, 480, 700, 1.00, 1.12),  # goblet hold
    ]
    exp_clips = [Clip(cfg, *c[:2], c[2], c[3], c[4], c[5], c[6]) for c in cuts]
    exp_starts = [round((6.0 + k * BEAT) * FPS) for k in range(6)] + [f2(10.0)]

    # ---- THE BRAND 10-13s : final shot, slow, to black ----------------------
    n4 = f2(1.9) + 2
    fin = Clip(cfg, 16.95, 0.4, 270, 560, 700, 1.0, 1.18, pan0=(0, 0.1), pan1=(0, 0))

    def s4():
        for i, f in enumerate(fin.frames(n4)):
            t = i / FPS
            g = dof_b(grade(f, lift=1.55))
            yield g * (1 - float(smooth((t - 1.2) / 0.55)))

    def exp_gen(k):
        c = exp_clips[k]
        n = exp_starts[k + 1] - exp_starts[k] + 4

        def gen():
            for f in c.frames(n):
                yield dof_b(grade(f, lift=1.22))
        return gen()

    def blackgen(n):
        def g():
            for _ in range(n):
                yield black
        return g()

    shots = [(0, n1, s1(), 0, "macro"), (f2(3.0), n2, s2(), 6, "swing")]
    for k in range(6):
        shots.append((exp_starts[k], exp_starts[k + 1] - exp_starts[k] + 4, exp_gen(k), 3, "exp"))
    shots.append((f2(10.0), n4, s4(), 3, "fin"))

    # overlays
    ty = cfg.ty
    texts = [
        Type(cfg, ["STRENGTH", "IS BUILT."], 0.95, 2.95, ty),
        Type(cfg, ["ONE REP", "AT A TIME."], 3.30, 5.95, ty),
        Type(cfg, ["MORE THAN", "A WORKOUT."], 6.10, 9.90, ty),
        Type(cfg, ["BE PART OF", "SOMETHING", "STRONGER."], 10.10, 11.55, ty - 0.02, fade_out=0.3),
    ]
    sub_size = int(cfg.fs * 0.50)
    brand_y = 0.645 if cfg.portrait else 0.735
    brand_lines = ["BE PART OF SOMETHING STRONGER."] if not cfg.portrait else ["BE PART OF", "SOMETHING STRONGER."]
    texts.append(Type(cfg, brand_lines, 13.15, 99, brand_y, size=sub_size, wght=700, wdth=108, track=0.02, stagger=0.15, fade_out=0.01))
    url_size = int(cfg.fs * 0.33)
    texts.append(Type(cfg, ["Visit raengfitness.co.uk"], 13.65, 99, 0.80 if cfg.portrait else 0.88,
                      size=url_size, wght=500, wdth=100, track=0.07, color=(200, 200, 196), fade_out=0.01))
    logo = LogoCard(cfg, 12.33, 13.0)

    return dict(shots=shots, texts=texts, logo=logo, dust_macro=dust_macro, dust_wide=dust_wide,
                beam_soft=beam_soft, black=black)


def compose(cfg, only=None):
    B = build(cfg)
    shots, texts, logo = B["shots"], B["texts"], B["logo"]
    rng = np.random.default_rng(1234)
    H, W = cfg.H, cfg.W
    live = []  # (start, end, gen, fade)
    pending = list(shots)
    for i in range(NF):
        while pending and pending[0][0] <= i:
            st, ln, gen, fade, _ = pending.pop(0)
            live.append((st, st + ln, gen, fade))
        out = np.zeros((H, W, 3), np.float32)
        for st, en, gen, fade in list(live):
            if i >= en:
                live.remove((st, en, gen, fade))
                continue
            if only is not None and i not in only and i + 1 not in only and False:
                pass
            f = next(gen, None)
            if f is None:
                live.remove((st, en, gen, fade))
                continue
            a = 1.0 if fade == 0 else float(smooth((i - st + 0.5) / fade))
            out = out * (1 - a) + f * a
        t = i / FPS
        # chalk dust + faint light shaft (beam) on all footage
        if t < 3.0:
            out += B["dust_macro"].render(t, -0.05 * t / 3.0, 1.0)[..., None] * 0.95
        elif t < 11.6:
            sh = 0.02 * np.sin(t * 0.4)
            amt = 0.55 if t < 6.0 else 0.35
            out += B["dust_wide"].render(t, sh)[..., None] * amt
            if t >= 3.0:
                out += (B["beam_soft"].mask(sh)[..., None] * 0.035)
        for tx in texts:
            tx.draw(out, t)
        logo.draw(out, t)
        # film grain, near-nothing on pure black
        lum = out.mean(-1, keepdims=True)
        gr = rng.standard_normal((H, W, 1)).astype(np.float32)
        out = out + gr * 0.04 * np.sqrt(np.clip(lum, 0, 1) + 0.001) * (0.8 + 0.4 * (1 - np.clip(lum * 2, 0, 1)))
        yield i, (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aspect", default="9x16", choices=["9x16", "16x9"])
    ap.add_argument("--out", default=None)
    ap.add_argument("--still", default=None, help="comma list of frame numbers -> PNGs next to --out")
    ap.add_argument("--crf", type=int, default=15)
    ap.add_argument("--keep", default=None, help="full render, but also save these frames as PNG")
    a = ap.parse_args()
    cfg = Cfg(a.aspect)
    out = a.out or os.path.join(HERE, "out", f"raeng-advert-{a.aspect}-silent.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    stills = {int(x) for x in a.still.split(",")} if a.still else None
    if stills:
        last = max(stills)
        for i, fr in compose(cfg):
            if i in stills:
                Image.fromarray(fr).save(out.replace(".mp4", f"_f{i:03d}.png"))
            if i >= last:
                break
        return
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{cfg.W}x{cfg.H}",
           "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf),
           "-pix_fmt", "yuv420p", "-profile:v", "high", "-colorspace", "bt709", "-color_primaries", "bt709",
           "-color_trc", "bt709", "-movflags", "+faststart", out]
    keep = {int(x) for x in a.keep.split(',')} if a.keep else set()
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i, fr in compose(cfg):
        if i in keep:
            Image.fromarray(fr).save(out.replace('.mp4', f'_f{i:03d}.png'))
        p.stdin.write(fr.tobytes())
        if i % 24 == 0:
            print(f"frame {i}/{NF}", file=sys.stderr, flush=True)
    p.stdin.close()
    p.wait()


if __name__ == "__main__":
    main()
