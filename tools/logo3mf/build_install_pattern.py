#!/usr/bin/env python3
"""
Build the front-view install pattern PDF for the New Holland sign.

Page 1 is a 1:1 drilling pattern meant to be plotted full size, taped to the
face of the panel and centre-punched through.  Page 2 is a dimensioned
overview on tabloid for the job folder.

Everything is drawn as the installer sees it: standing in front of the sign.
The DXF is stored as a reverse image (it is the face-down print layout), so X
is negated here to get the front view.

Usage:
    python3 build_install_pattern.py <layout.dxf> <out.pdf>
"""
import sys

from reportlab.lib.colors import Color, black
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from build_logo_3mf import NAMES, build_parts, load_dxf

CLEAR_DRILL = 7.14      # 9/32" clearance hole for a 1/4" screw
POST_OD = 12.70         # post footprint, for reference only
MARGIN = 30.0           # mm of paper around the panel

GREY = Color(0.62, 0.62, 0.62)
LIGHT = Color(0.82, 0.82, 0.82)
RED = Color(0.80, 0.10, 0.10)


def front(pt):
    """DXF (reverse image) -> front view."""
    return (-pt[0], pt[1])


def collect(dxf_path):
    loops, circles = load_dxf(dxf_path)
    parts, posts = build_parts(loops, circles)

    shapes = [len(l) for l in loops]  # noqa: F841  (kept for clarity)
    panel = max(range(len(loops)),
                key=lambda i: (max(p[0] for p in loops[i]) - min(p[0] for p in loops[i]))
                * (max(p[1] for p in loops[i]) - min(p[1] for p in loops[i])))

    order = sorted(parts, key=lambda o: -parts[o].bounds[0])
    named = list(zip(NAMES, order))
    return loops, panel, parts, posts, named


def draw_outline(c, ring, close=True):
    pts = [front(p) for p in ring]
    path = c.beginPath()
    path.moveTo(pts[0][0] * mm, pts[0][1] * mm)
    for p in pts[1:]:
        path.lineTo(p[0] * mm, p[1] * mm)
    if close:
        path.close()
    c.drawPath(path)


def draw_pattern(c, loops, panel, parts, posts, named, scale, show_marks):
    """Draw the sign at the current origin, in mm units, at 1:1 model scale."""
    lw = 0.5 / scale

    # panel outline
    c.setStrokeColor(GREY)
    c.setLineWidth(lw * 1.6)
    draw_outline(c, loops[panel])

    # letter + logo outlines
    c.setStrokeColor(GREY)
    c.setLineWidth(lw)
    for _name, o in named:
        g = parts[o]
        draw_outline(c, list(g.exterior.coords))
        for ring in g.interiors:
            draw_outline(c, list(ring.coords))

    # hole marks
    for _name, o in named:
        for (x, y) in posts[o]:
            fx, fy = front((x, y))
            if show_marks:
                # post footprint (reference)
                c.setStrokeColor(LIGHT)
                c.setLineWidth(lw)
                c.circle(fx * mm, fy * mm, (POST_OD / 2.0) * mm)
                # drill circle
                c.setStrokeColor(RED)
                c.setLineWidth(lw * 1.8)
                c.circle(fx * mm, fy * mm, (CLEAR_DRILL / 2.0) * mm)
                # crosshair
                arm = 11.0
                c.line((fx - arm) * mm, fy * mm, (fx + arm) * mm, fy * mm)
                c.line(fx * mm, (fy - arm) * mm, fx * mm, (fy + arm) * mm)
            else:
                c.setStrokeColor(RED)
                c.setFillColor(RED)
                c.setLineWidth(lw)
                c.circle(fx * mm, fy * mm, 1.6 / scale * mm, stroke=0, fill=1)

    # part names
    c.setFillColor(GREY)
    c.setFont("Helvetica-Bold", max(5.0, 9.0 / scale))
    for name, o in named:
        b = parts[o].bounds
        cx = -(b[0] + b[2]) / 2.0
        c.drawCentredString(cx * mm, (b[1] - 16.0) * mm, name)


def scale_check(c, x, y, scale):
    """A printed ruler so the installer can confirm the plot is 1:1."""
    c.setStrokeColor(black)
    c.setFillColor(black)
    c.setLineWidth(0.6)
    c.setFont("Helvetica", 8)
    c.setFont("Helvetica", 11)
    c.line(x, y, x + 100 * mm, y)
    for i in range(11):
        h = 4 * mm if i % 5 == 0 else 2 * mm
        c.line(x + i * 10 * mm, y, x + i * 10 * mm, y + h)
    c.drawString(x, y + 6 * mm, "SCALE CHECK - this bar must measure exactly 100 mm (3.937 in)")

    y2 = y - 12 * mm
    c.line(x, y2, x + 4 * 25.4 * mm, y2)
    for i in range(5):
        h = 4 * mm if i % 4 == 0 else 2 * mm
        c.line(x + i * 25.4 * mm, y2, x + i * 25.4 * mm, y2 + h)
    c.drawString(x, y2 - 9, 'and this bar exactly 4 in (101.6 mm)')


def main(dxf_path, out_path):
    loops, panel, parts, posts, named = collect(dxf_path)
    xs = [p[0] for p in loops[panel]]
    ys = [p[1] for p in loops[panel]]
    pw, ph = max(xs) - min(xs), max(ys) - min(ys)
    n_holes = sum(len(v) for v in posts.values())

    c = canvas.Canvas(out_path)

    # ---------------------------------------------------------- page 1: 1:1
    W = (pw + 2 * MARGIN) * mm
    H = (ph + 2 * MARGIN + 46) * mm
    c.setPageSize((W, H))
    c.saveState()
    c.translate((MARGIN + pw / 2.0) * mm, (MARGIN + 34 + ph / 2.0) * mm)
    draw_pattern(c, loops, panel, parts, posts, named, 1.0, True)
    c.restoreState()

    # centre lines for registration
    c.setStrokeColor(RED)
    c.setLineWidth(0.5)
    c.setDash(6, 6)
    cx = (MARGIN + pw / 2.0) * mm
    cy = (MARGIN + 34 + ph / 2.0) * mm
    c.line(cx, cy - (ph / 2.0 + 14) * mm, cx, cy + (ph / 2.0 + 14) * mm)
    c.line(cx - (pw / 2.0 + 14) * mm, cy, cx + (pw / 2.0 + 14) * mm, cy)
    c.setDash()

    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 30)
    c.drawString(MARGIN * mm, (ph + 2 * MARGIN + 24) * mm,
                 "NEW HOLLAND SIGN - INSTALL PATTERN - FRONT VIEW - PRINT 1:1")
    c.setFont("Helvetica", 15)
    c.drawString(MARGIN * mm, (ph + 2 * MARGIN + 14) * mm,
                 f"Panel {pw:.1f} x {ph:.1f} mm ({pw/25.4:.2f} x {ph/25.4:.2f} in)   -   "
                 f"{n_holes} holes   -   red circle = {CLEAR_DRILL:.2f} mm (9/32 in) clearance "
                 f"drill for 1/4-20 x 1/2 in screw")
    c.drawString(MARGIN * mm, (ph + 2 * MARGIN + 6) * mm,
                 f"Grey circle = {POST_OD:.1f} mm post footprint on the back of each letter "
                 f"(reference only - do not drill to this size).  Dashed lines = panel centre.")
    scale_check(c, MARGIN * mm, 20 * mm, 1.0)
    c.showPage()

    # ------------------------------------------------- page 2: overview
    TW, TH = 17 * 25.4 * mm, 11 * 25.4 * mm
    c.setPageSize((TW, TH))
    s = min((17 * 25.4 - 40) / pw, (11 * 25.4 - 90) / ph)
    c.saveState()
    c.translate(TW / 2.0, TH / 2.0 + 10 * mm)
    c.scale(s, s)
    draw_pattern(c, loops, panel, parts, posts, named, s, False)
    c.restoreState()

    c.setFillColor(black)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(20 * mm, TH - 18 * mm, "NEW HOLLAND SIGN - OVERVIEW (NOT TO SCALE)")
    c.setFont("Helvetica", 9)
    rows = [
        f"Panel: {pw:.1f} x {ph:.1f} mm  ({pw/25.4:.2f} x {ph/25.4:.2f} in)",
        f"Parts: {len(named)} printed pieces  -  10 letters + 6 logo leaf segments",
        f"Fixings: {n_holes} x 1/4-20 x 1/2 in screws, driven from behind the panel",
        f"Panel drill: {CLEAR_DRILL:.2f} mm (9/32 in) clearance at every marked centre",
        "Letters are hollow shells, 25.4 mm deep, 3 mm wall, threaded posts moulded in.",
    ]
    y = 30 * mm
    for r in reversed(rows):
        c.drawString(20 * mm, y, r)
        y += 5 * mm

    # per-part hole count
    c.setFont("Helvetica", 8)
    x = TW - 150 * mm
    y = 46 * mm
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, "HOLES PER PART")
    c.setFont("Helvetica", 8)
    col = 0
    for i, (name, o) in enumerate(named):
        cx2 = x + (i // 8) * 32 * mm
        cy2 = y - 5 * mm - (i % 8) * 4.4 * mm
        c.drawString(cx2, cy2, f"{name}: {len(posts[o])}")
        col = max(col, i // 8)
    c.showPage()

    c.save()
    print(f"wrote {out_path}")
    print(f"  page 1: {W/mm:.1f} x {H/mm:.1f} mm  (1:1 pattern)")
    print(f"  page 2: 17 x 11 in overview")
    print(f"  {n_holes} holes across {len(named)} parts")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
