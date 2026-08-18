#!/usr/bin/env python3
"""
Build the CNC program for the New Holland sign backer panel.

6 mm ACP, 6.35 mm (1/4 in) endmill, two operations:

  OP1  47 x 7.14 mm (9/32 in) mounting holes, helically interpolated
  OP2  outside profile of the 2438.4 x 812.8 mm rounded panel, with tabs

The panel is cut FACE UP, so the program is written in the same front view as
the install pattern PDF (DXF X negated).  If the sheet is run face down the
whole program must be mirrored -- the hole pattern is not symmetric.

Usage:
    python3 build_backer_gcode.py <layout.dxf> <out.nc> [--origin corner|centre]
"""
import math
import sys

from build_logo_3mf import build_parts, load_dxf

# ------------------------------------------------------------------ material
MATERIAL_T = 6.0          # ACP thickness
THROUGH = 0.5             # cut this far into the spoilboard
DEPTH = MATERIAL_T + THROUGH

# ---------------------------------------------------------------------- tool
TOOL_N = 1
TOOL_D = 6.35             # 1/4 in
TOOL_R = TOOL_D / 2.0
RPM = 18000
FEED_XY = 3000.0          # mm/min  (0.083 mm/tooth at 18k, 2 flute)
FEED_PLUNGE = 800.0
FEED_RAMP = 1500.0

# --------------------------------------------------------------------- holes
HOLE_D = 7.14             # 9/32 in clearance for a 1/4-20 screw
HELIX_PITCH = 1.3         # mm of depth per revolution

# ------------------------------------------------------------------- profile
CORNER_R = 127.0          # 5 in
PROFILE_PASSES = 2
RAMP_LEN = 60.0           # mm of path used to ramp into each pass
TABS = True
TAB_LEN = 15.0
TAB_H = 1.5
TAB_RAMP = 3.0

# --------------------------------------------------------------------- moves
SAFE_Z = 20.0             # rapid height over clamps
CLEAR_Z = 4.0             # rapid height between holes


class Prog:
    def __init__(self):
        self.out = []
        self.x = self.y = self.z = None

    def c(self, text):
        self.out.append(f"({text})")

    def raw(self, text):
        self.out.append(text)

    def _w(self, code, x=None, y=None, z=None, i=None, j=None, f=None):
        parts = [code]
        if x is not None and (self.x is None or abs(x - self.x) > 1e-6):
            parts.append(f"X{x:.4f}")
            self.x = x
        if y is not None and (self.y is None or abs(y - self.y) > 1e-6):
            parts.append(f"Y{y:.4f}")
            self.y = y
        if z is not None and (self.z is None or abs(z - self.z) > 1e-6):
            parts.append(f"Z{z:.4f}")
            self.z = z
        if i is not None:
            parts.append(f"I{i:.4f}")
        if j is not None:
            parts.append(f"J{j:.4f}")
        if f is not None:
            parts.append(f"F{f:.0f}")
        if len(parts) > 1:
            self.out.append(" ".join(parts))

    def rapid(self, x=None, y=None, z=None):
        self._w("G0", x, y, z)

    def cut(self, x=None, y=None, z=None, f=None):
        self._w("G1", x, y, z, f=f)

    def arc(self, ccw, x, y, i, j, z=None, f=None):
        self._w("G3" if ccw else "G2", x, y, z, i, j, f)

    def text(self):
        return "\n".join(self.out) + "\n"


# --------------------------------------------------------------------- holes
def hole(p, cx, cy):
    """Helically interpolate one through hole, climb (inside feature -> CW)."""
    orbit = (HOLE_D - TOOL_D) / 2.0
    p.rapid(x=cx + orbit, y=cy)
    p.rapid(z=CLEAR_Z)
    p.cut(z=0.0, f=FEED_PLUNGE)

    revs = max(1, math.ceil(DEPTH / HELIX_PITCH))
    for k in range(revs):
        z_mid = -DEPTH * (k + 0.5) / revs
        z_end = -DEPTH * (k + 1) / revs
        # two half turns per revolution: a full circle in one block is not
        # accepted by every controller
        p.arc(False, cx - orbit, cy, -orbit, 0.0, z=z_mid, f=FEED_RAMP)
        p.arc(False, cx + orbit, cy, orbit, 0.0, z=z_end, f=FEED_RAMP)
    # clean-up circle at depth
    p.arc(False, cx - orbit, cy, -orbit, 0.0, f=FEED_XY)
    p.arc(False, cx + orbit, cy, orbit, 0.0, f=FEED_XY)
    p.rapid(z=CLEAR_Z)


def order_holes(holes):
    """Nearest-neighbour ordering to keep rapids short."""
    todo = list(holes)
    path = [todo.pop(0)]
    while todo:
        cx, cy = path[-1]
        k = min(range(len(todo)),
                key=lambda i: (todo[i][0] - cx) ** 2 + (todo[i][1] - cy) ** 2)
        path.append(todo.pop(k))
    return path


# ------------------------------------------------------------------- profile
def profile_path(w, h, r, off):
    """Outside-offset rounded rectangle as segments, CCW from bottom centre.

    Returns a list of ('line', x0,y0, x1,y1) and
    ('arc', x0,y0, x1,y1, cx,cy) tuples.  CCW around an outside contour is a
    climb cut with an M3 right-hand tool.
    """
    R = r + off
    x0, x1 = -off, w + off          # offset outer extents
    y0, y1 = -off, h + off
    ax0, ax1 = r, w - r             # corner arc centres
    ay0, ay1 = r, h - r
    mid = w / 2.0

    return [
        ("line", mid, y0, ax1, y0),
        ("arc", ax1, y0, x1, ay0, ax1, ay0),
        ("line", x1, ay0, x1, ay1),
        ("arc", x1, ay1, ax1, y1, ax1, ay1),
        ("line", ax1, y1, ax0, y1),
        ("arc", ax0, y1, x0, ay1, ax0, ay1),
        ("line", x0, ay1, x0, ay0),
        ("arc", x0, ay0, ax0, y0, ax0, ay0),
        ("line", ax0, y0, mid, y0),
    ], R


def seg_len(s):
    if s[0] == "line":
        return math.hypot(s[3] - s[1], s[4] - s[2])
    _, sx, sy, ex, ey, cx, cy = s
    a0 = math.atan2(sy - cy, sx - cx)
    a1 = math.atan2(ey - cy, ex - cx)
    d = (a1 - a0) % (2 * math.pi)          # CCW sweep
    return d * math.hypot(sx - cx, sy - cy)


def tab_spans(segs, total):
    """Tab centres, as distances along the path, placed on straights only."""
    if not TABS:
        return []
    spans = []
    s0 = 0.0
    for s in segs:
        L = seg_len(s)
        if s[0] == "line" and L > 200.0:
            n = 3 if L > 1500.0 else (2 if L > 900.0 else 1)
            for k in range(n):
                spans.append(s0 + L * (k + 1) / (n + 1))
        s0 += L
    return spans


def profile_pass(p, segs, z_from, z_to, tabs, extra):
    """One profile pass, ramping z_from -> z_to over RAMP_LEN then holding.

    `extra` mm of the path is re-cut past the start point so the ramp is
    cleaned up.  Tabs lift Z when the pass is deeper than the tab top.
    """
    tab_top = -(MATERIAL_T - TAB_H)
    use_tabs = tabs and z_to < tab_top - 1e-6

    total = sum(seg_len(s) for s in segs)
    walked = 0.0

    def z_at(d):
        base = z_from + (z_to - z_from) * min(1.0, d / RAMP_LEN)
        if not use_tabs:
            return base
        for t in tabs:
            half = TAB_LEN / 2.0
            dd = abs(((d - t + total / 2) % total) - total / 2)
            if dd <= half:
                return max(base, tab_top)
            if dd <= half + TAB_RAMP:
                k = (dd - half) / TAB_RAMP
                return max(base, tab_top + (base - tab_top) * k)
        return base

    def step_line(sx, sy, ex, ey, d0):
        L = math.hypot(ex - sx, ey - sy)
        # sample finely enough that ramps and tabs resolve
        n = max(1, int(math.ceil(L / 2.0))) if (d0 < RAMP_LEN + 5 or use_tabs) \
            else 1
        for k in range(1, n + 1):
            t = k / n
            p.cut(x=sx + (ex - sx) * t, y=sy + (ey - sy) * t,
                  z=z_at(d0 + L * t), f=FEED_XY)
        return L

    def step_arc(sx, sy, ex, ey, cx, cy, d0):
        L = seg_len(("arc", sx, sy, ex, ey, cx, cy))
        zs, ze = z_at(d0), z_at(d0 + L)
        if abs(zs - ze) < 1e-6 and not use_tabs:
            p.arc(True, ex, ey, cx - sx, cy - sy, f=FEED_XY)
        else:
            # break into short chords so Z can follow
            R = math.hypot(sx - cx, sy - cy)
            a0 = math.atan2(sy - cy, sx - cx)
            sweep = (math.atan2(ey - cy, ex - cx) - a0) % (2 * math.pi)
            n = max(2, int(math.ceil(L / 2.0)))
            for k in range(1, n + 1):
                a = a0 + sweep * k / n
                p.cut(x=cx + R * math.cos(a), y=cy + R * math.sin(a),
                      z=z_at(d0 + L * k / n), f=FEED_XY)
        return L

    for s in segs:
        if s[0] == "line":
            walked += step_line(s[1], s[2], s[3], s[4], walked)
        else:
            walked += step_arc(s[1], s[2], s[3], s[4], s[5], s[6], walked)

    # re-cut the ramp-in stretch at full depth
    if extra > 0:
        s = segs[0]
        L = math.hypot(s[3] - s[1], s[4] - s[2])
        t = min(1.0, extra / L)
        p.cut(x=s[1] + (s[3] - s[1]) * t, y=s[2] + (s[4] - s[2]) * t,
              z=z_to, f=FEED_XY)


# ---------------------------------------------------------------------- main
def main(dxf_path, out_path, origin="corner"):
    loops, circles = load_dxf(dxf_path)
    parts, posts = build_parts(loops, circles)

    panel = max(range(len(loops)),
                key=lambda i: (max(p[0] for p in loops[i]) - min(p[0] for p in loops[i]))
                * (max(p[1] for p in loops[i]) - min(p[1] for p in loops[i])))
    P = loops[panel]
    w = max(p[0] for p in P) - min(p[0] for p in P)
    h = max(p[1] for p in P) - min(p[1] for p in P)

    # sanity: the DXF outline really is a w x h rounded rect of radius CORNER_R
    hx, hy = w / 2.0, h / 2.0
    worst = 0.0
    for x, y in P:
        ax, ay = abs(x), abs(y)
        if ax > hx - CORNER_R and ay > hy - CORNER_R:
            worst = max(worst, abs(math.hypot(ax - (hx - CORNER_R),
                                              ay - (hy - CORNER_R)) - CORNER_R))
        else:
            worst = max(worst, min(abs(ax - hx), abs(ay - hy)))
    if worst > 0.3:
        raise SystemExit(f"panel outline is not a R{CORNER_R} rounded rect "
                         f"(worst deviation {worst:.3f} mm)")

    # front view (negate X, matching the install pattern), then choose origin
    def to_g(pt):
        gx, gy = -pt[0], pt[1]
        if origin == "corner":
            return gx + w / 2.0, gy + h / 2.0
        return gx, gy

    holes = order_holes([to_g((x, y)) for o in posts for (x, y) in posts[o]])

    segs, R_off = profile_path(w, h, CORNER_R, TOOL_R)
    if origin == "centre":
        segs = [(s[0],) + tuple(v - (w / 2.0 if k % 2 == 0 else h / 2.0)
                                for k, v in enumerate(s[1:]))
                for s in segs]
    total = sum(seg_len(s) for s in segs)
    tabs = tab_spans(segs, total)

    p = Prog()
    p.c("NEW HOLLAND SIGN - BACKER PANEL")
    p.c(f"PANEL {w:.1f} x {h:.1f} MM ({w/25.4:.2f} X {h/25.4:.2f} IN) R{CORNER_R:.0f}")
    p.c(f"MATERIAL 6 MM ACP - CUT {DEPTH:.1f} MM DEEP ({THROUGH:.1f} INTO SPOILBOARD)")
    p.c(f"TOOL T{TOOL_N} - {TOOL_D:.2f} MM (1/4 IN) 2 FLUTE ENDMILL")
    p.c(f"SPINDLE {RPM} RPM - FEED {FEED_XY:.0f} MM/MIN - PLUNGE {FEED_PLUNGE:.0f}")
    p.c("SHEET IS CUT FACE UP - THIS IS THE FRONT VIEW - DO NOT MIRROR")
    if origin == "corner":
        p.c("X0 Y0 = LOWER LEFT CORNER OF THE PANEL - Z0 = TOP OF MATERIAL")
    else:
        p.c("X0 Y0 = CENTRE OF THE PANEL - Z0 = TOP OF MATERIAL")
    p.c(f"STOCK NEEDED {w + TOOL_D:.1f} X {h + TOOL_D:.1f} MM PLUS CLAMPING")
    p.c(f"OP1 {len(holes)} HOLES {HOLE_D:.2f} MM   OP2 OUTSIDE PROFILE"
        f"{' WITH ' + str(len(tabs)) + ' TABS' if tabs else ''}")
    p.raw("")
    p.raw("G21 G90 G17 G40 G49 G64")
    p.raw("G54")
    p.raw(f"T{TOOL_N} M6")
    p.raw(f"M3 S{RPM}")
    p.rapid(z=SAFE_Z)
    p.raw("")

    p.c(f"OP1 - {len(holes)} MOUNTING HOLES {HOLE_D:.2f} MM THROUGH")
    for (cx, cy) in holes:
        hole(p, cx, cy)
    p.rapid(z=SAFE_Z)
    p.raw("")

    p.c("OP2 - OUTSIDE PROFILE, CLIMB (CCW), "
        f"{PROFILE_PASSES} PASSES")
    if tabs:
        p.c(f"TABS {TAB_LEN:.0f} MM LONG X {TAB_H:.1f} MM HIGH ON THE LAST PASS")
    s0 = segs[0]
    p.rapid(x=s0[1], y=s0[2])
    p.rapid(z=CLEAR_Z)
    p.cut(z=0.0, f=FEED_PLUNGE)
    z_prev = 0.0
    for i in range(PROFILE_PASSES):
        z_to = -DEPTH * (i + 1) / PROFILE_PASSES
        p.c(f"PASS {i+1} OF {PROFILE_PASSES} TO Z{z_to:.2f}")
        profile_pass(p, segs, z_prev, z_to, tabs, RAMP_LEN)
        z_prev = z_to
    p.rapid(z=SAFE_Z)
    p.raw("")

    p.raw("M5")
    p.raw("G0 Z" + f"{SAFE_Z:.4f}")
    p.raw("M30")

    with open(out_path, "w") as f:
        f.write(p.text())

    lines = p.text().count("\n")
    print(f"wrote {out_path}  ({lines} lines)")
    print(f"  panel {w:.1f} x {h:.1f} mm, R{CORNER_R:.0f}, origin={origin}")
    print(f"  OP1 {len(holes)} holes {HOLE_D:.2f} mm")
    print(f"  OP2 profile {total:.0f} mm/pass x {PROFILE_PASSES} passes, {len(tabs)} tabs")
    print(f"  stock needed {w + TOOL_D:.1f} x {h + TOOL_D:.1f} mm")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    org = "centre" if "--origin" in sys.argv and \
        sys.argv[sys.argv.index("--origin") + 1] == "centre" else "corner"
    main(args[0], args[1], org)
