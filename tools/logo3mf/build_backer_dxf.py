#!/usr/bin/env python3
"""
Build a CAM-ready DXF of the backer panel for CorelDRAW / CamDRAW.

Three layers, so toolpaths can be assigned per layer:

  PANEL-PROFILE   the finished 94 x 32 in R5 outline (cut outside, tool right)
  HOLES-9-32      47 circles at the 9/32 in drill size (cut inside / on-line)
  REF-ARTWORK     letter and logo outlines, reference only -- do not cut

Millimetres, same coordinate frame as layout.dxf (centred on origin), so it
drops onto the existing Corel page unchanged.

Usage:
    python3 build_backer_dxf.py <layout.dxf> <out.dxf> [options]

      --rotate 90    turn the panel on the table (0/90/180/270)
      --sheet 48x96  nest centred on a sheet this size, in inches, with the
                     origin at the sheet's lower-left corner
      --mirror       reverse image, matching the as-drawn layout, for running
                     the sheet FACE DOWN.  Default output is the front view.
"""
import math
import sys

import ezdxf

from build_logo_3mf import PANEL_H, PANEL_R, PANEL_W, build_parts, load_dxf

DRILL_D = 7.14      # 9/32 in clearance for a 1/4-20 screw

LAYERS = [
    ("PANEL-PROFILE", 1),    # red
    ("HOLES-9-32", 5),       # blue
    ("REF-ARTWORK", 8),      # grey
]


def rounded_rect(msp, w, h, r, layer, T, rot):
    """Emit the panel as four lines and four true arcs."""
    hw, hh = w / 2.0, h / 2.0
    ax, ay = hw - r, hh - r
    a = {"layer": layer}
    msp.add_line(T(-ax, -hh), T(ax, -hh), dxfattribs=a)
    msp.add_line(T(hw, -ay), T(hw, ay), dxfattribs=a)
    msp.add_line(T(ax, hh), T(-ax, hh), dxfattribs=a)
    msp.add_line(T(-hw, ay), T(-hw, -ay), dxfattribs=a)
    # arcs run counter-clockwise from start angle to end angle
    for (cx, cy), a0 in (((ax, -ay), 270), ((ax, ay), 0),
                         ((-ax, ay), 90), ((-ax, -ay), 180)):
        msp.add_arc(T(cx, cy), r, a0 + rot, a0 + 90 + rot, dxfattribs=a)


def main(src, out, mirror=False, rotate=0, sheet=None):
    loops, circles = load_dxf(src)
    parts, posts = build_parts(loops, circles)

    rw = PANEL_H if rotate % 180 else PANEL_W
    rh = PANEL_W if rotate % 180 else PANEL_H
    if sheet:
        if rw > sheet[0] + 1e-6 or rh > sheet[1] + 1e-6:
            raise SystemExit("rotated panel does not fit the sheet")
        dx, dy = sheet[0] / 2.0, sheet[1] / 2.0
    else:
        dx = dy = 0.0
    a = math.radians(rotate)
    ca, sa = math.cos(a), math.sin(a)

    def T(x, y):
        return (x * ca - y * sa + dx, x * sa + y * ca + dy)

    def v(pt):
        return T(pt[0] if mirror else -pt[0], pt[1])

    doc = ezdxf.new("R2000", setup=True)
    doc.header["$INSUNITS"] = 4          # millimetres
    for name, colour in LAYERS:
        doc.layers.add(name, color=colour)
    msp = doc.modelspace()

    rounded_rect(msp, PANEL_W, PANEL_H, PANEL_R, "PANEL-PROFILE", T, rotate)

    n = 0
    for o in posts:
        for (x, y) in posts[o]:
            msp.add_circle(v((x, y)), DRILL_D / 2.0,
                           dxfattribs={"layer": "HOLES-9-32"})
            n += 1

    for o in parts:
        g = parts[o]
        msp.add_lwpolyline([v(p) for p in g.exterior.coords], close=True,
                           dxfattribs={"layer": "REF-ARTWORK"})
        for ring in g.interiors:
            msp.add_lwpolyline([v(p) for p in ring.coords], close=True,
                               dxfattribs={"layer": "REF-ARTWORK"})

    doc.saveas(out)
    print(f"wrote {out}")
    print(f"  PANEL-PROFILE  {PANEL_W:.1f} x {PANEL_H:.1f} mm "
          f"({PANEL_W/25.4:.2f} x {PANEL_H/25.4:.2f} in) R{PANEL_R:.0f}")
    print(f"  HOLES-9-32     {n} circles at {DRILL_D:.2f} mm")
    print(f"  REF-ARTWORK    {len(parts)} outlines")
    print(f"  view           {'reverse (face down)' if mirror else 'front (face up)'}")
    print(f"  rotate         {rotate} deg -> sits {rw/25.4:.2f} x {rh/25.4:.2f} in")
    if sheet:
        print(f"  nested         centred on {sheet[0]/25.4:.0f} x {sheet[1]/25.4:.0f} in, "
              f"origin at the sheet corner")


def _opt(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


if __name__ == "__main__":
    pos, skip = [], False
    for a in sys.argv[1:]:
        if skip:
            skip = False
        elif a in ("--rotate", "--sheet"):
            skip = True
        elif not a.startswith("--"):
            pos.append(a)
    sh = _opt("--sheet", None)
    main(pos[0], pos[1],
         mirror="--mirror" in sys.argv,
         rotate=int(_opt("--rotate", "0")) % 360,
         sheet=tuple(float(v) * 25.4 for v in sh.lower().split("x")) if sh else None)
