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
    python3 build_backer_gcode.py <layout.dxf> <out.nc> [options]

      --origin corner|centre   X0Y0 at the panel's lower-left (default) or centre
      --units mm|in            G21 millimetres (default) or G20 inches
      --rotate 90              turn the panel on the table (0/90/180/270)
      --sheet 48x96in          nest centred on a sheet this size, with X0Y0
                               at the sheet's lower-left corner.  Accepts an
                               "in"/"mm" suffix; bare means the program's units
      --mirror                 reverse image, for running the sheet FACE DOWN
      --split                  write <out>-op1-holes and <out>-op2-profile,
                               keeping whatever extension <out> uses
      --percent                wrap the program in % delimiters
      --dialect camdraw|iso    camdraw (the default) matches the shop's working
                               post exactly: CRLF, no comments, no spaces, no
                               preamble codes, G0/G1 only (arcs linearised),
                               millimetres.  iso gives generic ISO with G2/G3.
"""
import math
import os
import sys

from build_logo_3mf import PANEL_H, PANEL_R, PANEL_W, build_parts, load_dxf

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
CORNER_R = PANEL_R
PROFILE_PASSES = 2
RAMP_LEN = 60.0           # mm of path used to ramp into each pass
TABS = True
TAB_LEN = 15.0
TAB_H = 1.5
TAB_RAMP = 3.0

# --------------------------------------------------------------------- moves
SAFE_Z = 75.0             # retract height between features
CLEAR_Z = 2.0             # rapid down to here before plunging

# Arc linearisation, used when the dialect has no G2/G3.
CHORD_TOL = 0.01          # max deviation of a chord from the true arc, mm
MAX_STEP = 1.0            # and never step further than this along it, mm


class Prog:
    """Emits blocks.  Geometry is held in mm and converted on the way out.

    Two dialects:

      iso      spaces, ( ) comments, G2/G3 arcs, LF, full modal preamble
      camdraw  matched to the working CamDRAW post on the shop's router:
               CRLF, no comments, no spaces, no preamble codes, G0/G1 only
    """

    def __init__(self, units="mm", dialect="iso"):
        self.out = []
        self.x = self.y = self.z = None
        self.u = 1.0 if units == "mm" else 1.0 / 25.4
        self.d = 4 if units == "mm" else 5
        cam = dialect == "camdraw"
        self.sep = "" if cam else " "
        self.nl = "\r\n" if cam else "\n"
        self.comments = not cam
        self.arcs = not cam
        self.ffmt = "{:.2f}" if cam else "{:g}"

    def c(self, text):
        if self.comments:
            self.out.append(f"({text})")

    def raw(self, text):
        if text or self.comments:      # camdraw output carries no blank lines
            self.out.append(text)

    def _n(self, v):
        return f"{v * self.u:.{self.d}f}"

    def _w(self, code, x=None, y=None, z=None, i=None, j=None, f=None):
        parts = [code]
        if x is not None and (self.x is None or abs(x - self.x) > 1e-6):
            parts.append("X" + self._n(x))
            self.x = x
        if y is not None and (self.y is None or abs(y - self.y) > 1e-6):
            parts.append("Y" + self._n(y))
            self.y = y
        if z is not None and (self.z is None or abs(z - self.z) > 1e-6):
            parts.append("Z" + self._n(z))
            self.z = z
        if i is not None:
            parts.append("I" + self._n(i))
        if j is not None:
            parts.append("J" + self._n(j))
        if f is not None:
            parts.append("F" + self.ffmt.format(f * self.u))
        if len(parts) > 1:
            self.out.append(self.sep.join(parts))

    def rapid(self, x=None, y=None, z=None):
        self._w("G0", x, y, z)

    def cut(self, x=None, y=None, z=None, f=None):
        self._w("G1", x, y, z, f=f)

    def arc(self, ccw, x, y, i, j, z=None, f=None):
        if self.arcs:
            self._w("G3" if ccw else "G2", x, y, z, i, j, f)
            return
        # no G2/G3 in this dialect - walk the arc as short G1 chords
        sx, sy, sz = self.x, self.y, self.z
        cx, cy = sx + i, sy + j
        r = math.hypot(sx - cx, sy - cy)
        a0 = math.atan2(sy - cy, sx - cx)
        a1 = math.atan2(y - cy, x - cx)
        sweep = (a1 - a0) % (2 * math.pi) if ccw else -((a0 - a1) % (2 * math.pi))
        if abs(sweep) < 1e-9:                      # start == end means full turn
            sweep = 2 * math.pi if ccw else -2 * math.pi
        step = MAX_STEP
        if r > CHORD_TOL:
            step = min(step, 2.0 * math.sqrt(max(2.0 * r * CHORD_TOL
                                                 - CHORD_TOL ** 2, 1e-12)))
        n = max(2, int(math.ceil(abs(sweep) * r / step)))
        z0 = sz if z is not None else None
        for k in range(1, n + 1):
            t = k / n
            a = a0 + sweep * t
            self.cut(x=cx + r * math.cos(a), y=cy + r * math.sin(a),
                     z=None if z is None else z0 + (z - z0) * t, f=f)

    def text(self):
        return self.nl.join(self.out) + self.nl


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
    """Outside-offset rounded rectangle, CCW from the bottom edge centre.

    Built in a panel-centred frame; rotation and nesting are applied later.
    Returns ('line', x0,y0, x1,y1) and ('arc', x0,y0, x1,y1, cx,cy) tuples.
    CCW around an outside contour is a climb cut with an M3 right-hand tool.
    """
    R = r + off
    x0, x1 = -(w / 2.0 + off), w / 2.0 + off     # offset outer extents
    y0, y1 = -(h / 2.0 + off), h / 2.0 + off
    ax0, ax1 = -(w / 2.0 - r), w / 2.0 - r       # corner arc centres
    ay0, ay1 = -(h / 2.0 - r), h / 2.0 - r
    mid = 0.0

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


def xform(segs, holes, rot, dx, dy):
    """Rotate the whole job about the panel centre, then translate."""
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)

    def pt(x, y):
        return (x * ca - y * sa + dx, x * sa + y * ca + dy)

    out = []
    for s in segs:
        vals = []
        for k in range(1, len(s), 2):
            vals.extend(pt(s[k], s[k + 1]))
        out.append((s[0],) + tuple(vals))
    return out, [pt(x, y) for (x, y) in holes]


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
def check_drawing(loops):
    """The DXF outline is the *drawn* panel; the cut panel comes from the spec."""
    panel = max(range(len(loops)),
                key=lambda i: (max(p[0] for p in loops[i]) - min(p[0] for p in loops[i]))
                * (max(p[1] for p in loops[i]) - min(p[1] for p in loops[i])))
    P = loops[panel]
    w = max(p[0] for p in P) - min(p[0] for p in P)
    h = max(p[1] for p in P) - min(p[1] for p in P)

    # the outline really must be a w x h rounded rect of radius CORNER_R,
    # because that is what the toolpath is rebuilt from
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
    return w, h


def preamble(p, units, dialect):
    if dialect == "camdraw":
        # exactly what the shop's working post emits: tool, spindle, nothing
        # else.  The retract goes first so the opening XY rapid is never made
        # at an unknown Z.
        p.raw(f"T{TOOL_N}M6")
        p.raw(f"S{RPM}M3")
        p.rapid(z=SAFE_Z)
        return
    p.raw(("G20" if units == "in" else "G21") + " G90 G17 G40 G49 G64")
    p.raw("G54")
    p.raw(f"T{TOOL_N} M6")
    p.raw(f"M3 S{RPM}")
    p.rapid(z=SAFE_Z)
    p.raw("")


def postamble(p, dialect):
    if dialect == "camdraw":
        p.rapid(z=SAFE_Z)
        p.raw("M30")
        return
    p.raw("M5")
    p.rapid(z=SAFE_Z)
    p.raw("M30")


def setup_lines(w, h, units, origin, mirror, holes, tabs, op,
                rotate, sheet, rw, rh, dialect):
    """The setup notes.  Emitted as comments in ISO output; the camdraw post
    carries no comments, so they are written to a sidecar sheet instead."""
    uw = "IN" if units == "in" else "MM"
    k = (1 / 25.4) if units == "in" else 1.0
    L = ["NEW HOLLAND SIGN - BACKER PANEL" + (f" - {op}" if op else ""),
         f"PANEL {w:.1f} X {h:.1f} MM ({w/25.4:.2f} X {h/25.4:.2f} IN) R{CORNER_R:.0f}",
         f"MATERIAL 6 MM ACP - CUT {DEPTH*k:.3f} {uw} DEEP "
         f"({THROUGH*k:.3f} INTO SPOILBOARD)",
         f"TOOL T{TOOL_N} - {TOOL_D:.2f} MM (1/4 IN) 2 FLUTE ENDMILL",
         f"SPINDLE {RPM} RPM - FEED {FEED_XY*k:.1f} {uw}/MIN - "
         f"PLUNGE {FEED_PLUNGE*k:.1f} {uw}/MIN"]
    if dialect == "camdraw":
        L.append(f"UNITS {uw} - NO G20/G21 IN THE FILE, THE MACHINE DEFAULT APPLIES")
    else:
        L.append(f"UNITS {uw} ({'G20' if units == 'in' else 'G21'})")
    L.append("REVERSE IMAGE - RUN THE SHEET FACE DOWN" if mirror
             else "FRONT VIEW - RUN THE SHEET FACE UP - DO NOT MIRROR")
    if rotate:
        L.append(f"PANEL ROTATED {rotate} DEG - SITS {rw*k:.2f} X {rh*k:.2f} "
                 f"{uw} ON THE TABLE")
    if sheet:
        L.append(f"SHEET {sheet[0]*k:.2f} X {sheet[1]*k:.2f} {uw} - PANEL CENTRED ON IT")
        L.append("X0 Y0 = LOWER LEFT CORNER OF THE SHEET - Z0 = TOP OF MATERIAL")
    else:
        L.append(("X0 Y0 = LOWER LEFT CORNER OF THE PANEL" if origin == "corner"
                  else "X0 Y0 = CENTRE OF THE PANEL") + " - Z0 = TOP OF MATERIAL")
    L.append(f"RETRACT Z{SAFE_Z*k:.3f} {uw} - APPROACH Z{CLEAR_Z*k:.3f} {uw}")
    L.append(f"STOCK NEEDED {(rw + TOOL_D)*k:.2f} X {(rh + TOOL_D)*k:.2f} {uw} "
             f"PLUS CLAMPING")
    if op in (None, "OP1"):
        L.append(f"OP1 - {len(holes)} HOLES {HOLE_D*k:.4f} {uw}")
    if op in (None, "OP2"):
        L.append("OP2 - OUTSIDE PROFILE"
                 + (f" WITH {len(tabs)} TABS" if tabs else ""))
    return L


def header(p, lines):
    for line in lines:
        p.c(line)
    p.raw("")


def emit_holes(p, holes):
    p.c(f"OP1 - {len(holes)} MOUNTING HOLES THROUGH")
    for (cx, cy) in holes:
        hole(p, cx, cy)
    p.rapid(z=SAFE_Z)
    p.raw("")


def emit_profile(p, segs, tabs):
    p.c(f"OP2 - OUTSIDE PROFILE, CLIMB (CCW), {PROFILE_PASSES} PASSES")
    if tabs:
        p.c(f"TABS {TAB_LEN:.0f} MM LONG X {TAB_H:.1f} MM HIGH ON THE LAST PASS")
    s0 = segs[0]
    p.rapid(x=s0[1], y=s0[2])
    p.rapid(z=CLEAR_Z)
    p.cut(z=0.0, f=FEED_PLUNGE)
    z_prev = 0.0
    for i in range(PROFILE_PASSES):
        z_to = -DEPTH * (i + 1) / PROFILE_PASSES
        p.c(f"PASS {i+1} OF {PROFILE_PASSES}")
        profile_pass(p, segs, z_prev, z_to, tabs, RAMP_LEN)
        z_prev = z_to
    p.rapid(z=SAFE_Z)
    p.raw("")


def wrap(text, percent):
    """Some controls expect the program between % delimiters; most ignore them."""
    return f"%\n{text}%\n" if percent else text


def main(dxf_path, out_path, origin="corner", units="mm", mirror=False,
         split=False, rotate=0, sheet=None, percent=False,
         dialect="camdraw"):
    if dialect == "camdraw" and units != "mm":
        raise SystemExit("the camdraw dialect emits no G20/G21, so the machine's "
                         "default units apply - use --units mm")
    loops, circles = load_dxf(dxf_path)
    parts, posts = build_parts(loops, circles)
    dw, dh = check_drawing(loops)
    w, h = PANEL_W, PANEL_H
    if abs(dw - w) > 0.05 or abs(dh - h) > 0.05:
        print(f"  note: drawing is {dw/25.4:.2f} x {dh/25.4:.2f} in, "
              f"cutting {w/25.4:.2f} x {h/25.4:.2f} in per the panel spec")

    # everything is built panel-centred, then rotated and nested
    holes0 = [((x if mirror else -x), y)
              for o in posts for (x, y) in posts[o]]
    segs0, _ = profile_path(w, h, CORNER_R, TOOL_R)

    rw = h if rotate % 180 else w          # panel size after rotation
    rh = w if rotate % 180 else h

    if sheet:
        sw, sh = sheet
        if rw > sw + 1e-6 or rh > sh + 1e-6:
            raise SystemExit(
                f"rotated panel {rw/25.4:.2f} x {rh/25.4:.2f} in does not fit "
                f"the {sw/25.4:.2f} x {sh/25.4:.2f} in sheet")
        dx, dy = sw / 2.0, sh / 2.0        # centred on the sheet, origin = sheet corner
    elif origin == "corner":
        dx, dy = rw / 2.0, rh / 2.0        # origin = panel lower-left
    else:
        dx, dy = 0.0, 0.0                  # origin = panel centre

    segs, holes = xform(segs0, holes0, rotate, dx, dy)
    holes = order_holes(holes)
    total = sum(seg_len(s) for s in segs)
    tabs = tab_spans(segs, total)

    written = []
    if split:
        base, ext = os.path.splitext(out_path)
        ext = ext or ".nc"
        for op, body in (("OP1", lambda p: emit_holes(p, holes)),
                         ("OP2", lambda p: emit_profile(p, segs, tabs))):
            p = Prog(units, dialect)
            info = setup_lines(w, h, units, origin, mirror, holes, tabs, op,
                               rotate, sheet, rw, rh, dialect)
            header(p, info)
            preamble(p, units, dialect)
            body(p)
            postamble(p, dialect)
            name = (f"{base}-{op.lower()}-"
                    f"{'holes' if op == 'OP1' else 'profile'}{ext}")
            open(name, "w").write(wrap(p.text(), percent))
            written.append((name, p.text().count("\n")))
    else:
        p = Prog(units, dialect)
        info = setup_lines(w, h, units, origin, mirror, holes, tabs, None,
                           rotate, sheet, rw, rh, dialect)
        header(p, info)
        preamble(p, units, dialect)
        emit_holes(p, holes)
        emit_profile(p, segs, tabs)
        postamble(p, dialect)
        open(out_path, "w").write(wrap(p.text(), percent))
        written.append((out_path, p.text().count("\n")))

    if dialect == "camdraw":
        base = os.path.splitext(out_path)[0]
        note = base + "-setup.txt"
        with open(note, "w") as fh:
            fh.write("\n".join(setup_lines(w, h, units, origin, mirror, holes,
                                            tabs, None, rotate, sheet, rw, rh,
                                            dialect)) + "\n")
        written.append((note, len(setup_lines(w, h, units, origin, mirror, holes,
                                              tabs, None, rotate, sheet, rw, rh,
                                              dialect))))

    for name, n in written:
        print(f"wrote {name}  ({n} lines)")
    k = (1 / 25.4) if units == "in" else 1.0
    uw = "in" if units == "in" else "mm"
    print(f"  panel {w:.1f} x {h:.1f} mm, R{CORNER_R:.0f}")
    print(f"  dialect={dialect}  units={units}  rotate={rotate}deg  "
          f"view={'reverse (face down)' if mirror else 'front (face up)'}")
    print(f"  sits {rw/25.4:.2f} x {rh/25.4:.2f} in on the table; origin = "
          + ("sheet lower-left" if sheet else
             ("panel lower-left" if origin == "corner" else "panel centre")))
    print(f"  OP1 {len(holes)} holes {HOLE_D*k:.4f} {uw}")
    print(f"  OP2 profile {total:.0f} mm/pass x {PROFILE_PASSES} passes, "
          f"{len(tabs)} tabs")
    print(f"  stock needed {(rw + TOOL_D)*k:.2f} x {(rh + TOOL_D)*k:.2f} {uw}")


def _opt(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


TAKES_VALUE = ("--origin", "--units", "--rotate", "--sheet", "--dialect")


def parse_sheet(text, units):
    """'48x96in', '1220x2440mm', or bare '48x96' meaning the program's units."""
    if not text:
        return None
    t = text.lower().strip()
    k = 25.4 if units == "in" else 1.0
    for suffix, factor in (("in", 25.4), ('"', 25.4), ("mm", 1.0)):
        if t.endswith(suffix):
            t, k = t[:-len(suffix)], factor
            break
    a, b = (float(v) for v in t.split("x"))
    return a * k, b * k


if __name__ == "__main__":
    pos = []
    skip = False
    for a in sys.argv[1:]:
        if skip:
            skip = False
        elif a in TAKES_VALUE:
            skip = True
        elif not a.startswith("--"):
            pos.append(a)
    unit = _opt("--units", "mm")
    main(pos[0], pos[1],
         origin=_opt("--origin", "corner"),
         units=unit,
         mirror="--mirror" in sys.argv,
         split="--split" in sys.argv,
         rotate=int(_opt("--rotate", "0")) % 360,
         sheet=parse_sheet(_opt("--sheet", None), unit),
         percent="--percent" in sys.argv,
         dialect=_opt("--dialect", "camdraw"))
