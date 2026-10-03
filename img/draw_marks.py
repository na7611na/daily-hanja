# 색연필(사인펜) 느낌 채점 표시를 직접 그립니다: 동그라미(꼬리 있음), 빗금
import math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops
S = 4  # 크게 그린 뒤 줄여서 부드럽게
RED = (226, 26, 32)
random.seed(7)

def stroke(size, pts, widths):
    W, H = size
    m = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(m)
    for (x, y), w in zip(pts, widths):
        r = w * S / 2
        d.ellipse((x * S - r, y * S - r, x * S + r, y * S + r), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(S * 0.6))
    # 펜 결: 가는 잡티로 군데군데 옅게
    n = Image.effect_noise((W * S, H * S), 60).filter(ImageFilter.GaussianBlur(1.2))
    n = n.point(lambda v: 255 if v > 80 else int(110 + v))
    m = ImageChops.multiply(m, n)
    m = m.resize((W, H), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), RED + (0,))
    out.putalpha(m)
    return out.crop(out.getbbox())

def circle():
    cx, cy, rx, ry, tilt = 104, 100, 74, 84, math.radians(-18)
    pts, ws = [], []
    a0, sweep, N = math.radians(28), math.radians(400), 900
    def at(a, t):
        wob = 1 + 0.03 * math.sin(2 * a + 0.8) + 0.015 * math.sin(3 * a) + 0.11 * max(0, t - 0.85) / 0.15
        ex, ey = rx * wob * math.cos(a), ry * wob * math.sin(a)
        return cx + ex * math.cos(tilt) - ey * math.sin(tilt), cy + ex * math.sin(tilt) + ey * math.cos(tilt)
    for i in range(N + 1):
        t = i / N
        a = a0 + sweep * t
        x, y = at(a, t)
        w = 9.5 * (1 + 0.12 * math.sin(3 * a + 1))
        if t < 0.04: w *= 0.7 + 0.3 * t / 0.04
        pts.append((x, y)); ws.append(w)
    # 끝에서 바깥쪽으로 살짝 삐져나가는 꼬리
    (x1, y1), (x0, y0) = pts[-1], pts[-6]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy); dx, dy = dx / L, dy / L
    rot = math.radians(-20)
    dx, dy = dx * math.cos(rot) - dy * math.sin(rot), dx * math.sin(rot) + dy * math.cos(rot)
    w0 = ws[-1]
    for i in range(1, 120):
        t = i / 120
        pts.append((x1 + dx * 34 * t, y1 + dy * 34 * t)); ws.append(max(1.0, w0 * (1 - t) ** 1.3))
    return stroke((230, 230), pts, ws)

def slash():
    p0, c, p1 = (22, 128), (70, 92), (150, 18)
    pts, ws = [], []
    N = 500
    for i in range(N + 1):
        t = i / N
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]
        w = 12 * (1 - t) ** 0.7 + 1.2
        if t < 0.03: w *= 0.85
        pts.append((x, y)); ws.append(w)
    return stroke((175, 150), pts, ws)

import sys
d = sys.argv[1]
circle().save(f'{d}/mark-ok.png', optimize=True)
slash().save(f'{d}/mark-no.png', optimize=True)
