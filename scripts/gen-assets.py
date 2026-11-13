#!/usr/bin/env python3
"""Generates the spray-paint SVG assets in assets/paint/.

Run: python3 scripts/gen-assets.py

Outputs:
  frame-<colour>.svg  solid rounded outline, used with CSS border-image (slice 30)
  fill-<colour>.svg   same shape filled solid, used with border-image `fill`
  splat-{a,b}.svg     splatter blob + specks (CSS mask)

Frame edges are straight, so border-image-repeat: round tiles seamlessly at any length.
"""
import math
import os
import random

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'paint')
os.makedirs(OUT, exist_ok=True)

COLOURS = {
    'lime': '#a2ef00',
    'red': '#df342c',
    'white': '#f2f2f2',
    'grey': '#8c8f94',
    'slate': '#3c4658',
    'steel': '#5a606d',
}

SIZE = 120  # viewBox; border-image-slice is 30


def jitter(seed, amp):
    r = random.Random(seed)
    terms = [(k, r.uniform(0, 2 * math.pi), r.uniform(0.3, 1.0) / k) for k in (1, 2, 3, 5, 7)]
    norm = sum(a for _, _, a in terms)
    return lambda t: amp * sum(a * math.sin(2 * math.pi * k * t / 60 + p) for k, p, a in terms) / norm


def ring(inset, amp, seed, step=2):
    """Points around a rectangle inset from the edge, displaced by periodic jitter."""
    sides = [jitter(seed + i, amp) for i in range(4)]
    pts = []
    lo, hi = inset, SIZE - inset
    for t in range(0, SIZE, step):  # top, left->right
        pts.append((t, lo + sides[0](t)))
    for t in range(0, SIZE, step):  # right, top->bottom
        pts.append((hi + sides[1](t), t))
    for t in range(SIZE, 0, -step):  # bottom, right->left
        pts.append((t, hi + sides[2](t)))
    for t in range(SIZE, 0, -step):  # left, bottom->top
        pts.append((lo + sides[3](t), t))
    # clamp into the corner squares so corners stay rectangular-ish
    return [(min(max(x, lo - amp), hi + amp), min(max(y, lo - amp), hi + amp)) for x, y in pts]


def path(pts):
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z'


def svg(body, vb=f'0 0 {SIZE} {SIZE}'):
    # explicit width/height matter: without them border-image sizes the SVG to the element,
    # so slice 30 no longer means 30/120 and short elements lose their edges entirely
    _, _, w, h = vb.split()
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{vb}">{body}</svg>\n'


def write(name, content):
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(content)


# Solid border band: rounded rectangle from inset 13 to 26 (slice 30), ~6px at a 14px border.
def rrect(inset, radius):
    x0 = y0 = inset
    x1 = y1 = SIZE - inset
    r = radius
    return (f'M{x0 + r},{y0} H{x1 - r} A{r},{r} 0 0 1 {x1},{y0 + r} V{y1 - r} '
            f'A{r},{r} 0 0 1 {x1 - r},{y1} H{x0 + r} A{r},{r} 0 0 1 {x0},{y1 - r} V{y0 + r} '
            f'A{r},{r} 0 0 1 {x0 + r},{y0}Z')


for name, c in COLOURS.items():
    write(f'frame-{name}.svg', svg(
        f'<path fill="{c}" fill-rule="evenodd" d="{rrect(13, 9)} {rrect(26, 2)}"/>'
    ))
    write(f'fill-{name}.svg', svg(f'<path fill="{c}" d="{rrect(13, 9)}"/>'))


def splat(seed, blob=True):
    r = random.Random(seed)
    shapes = []
    if blob:
        pts = []
        n = 28
        for i in range(n):
            a = 2 * math.pi * i / n
            rad = r.uniform(10, 15) if i % 3 else r.uniform(16, 24)
            pts.append((50 + rad * math.cos(a), 50 + rad * math.sin(a)))
        shapes.append(f'<path d="{path(pts)}"/>')
        for _ in range(6):  # streaks flying out
            a = r.uniform(0, 2 * math.pi)
            d0, d1 = r.uniform(18, 24), r.uniform(30, 44)
            w = r.uniform(.8, 2)
            x0, y0 = 50 + d0 * math.cos(a), 50 + d0 * math.sin(a)
            x1, y1 = 50 + d1 * math.cos(a), 50 + d1 * math.sin(a)
            shapes.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
                          f'stroke="#000" stroke-width="{w:.1f}" stroke-linecap="round"/>')
    for _ in range(40):  # specks
        a = r.uniform(0, 2 * math.pi)
        d = r.uniform(14, 48) if blob else r.uniform(0, 48)
        shapes.append(f'<circle cx="{50 + d * math.cos(a):.1f}" cy="{50 + d * math.sin(a):.1f}" r="{r.uniform(.5, 2.6):.1f}"/>')
    return svg(''.join(shapes), vb='0 0 100 100')


write('splat-a.svg', splat(7, blob=True))
write('splat-b.svg', splat(9, blob=False))

print('wrote', sorted(os.listdir(OUT)))
