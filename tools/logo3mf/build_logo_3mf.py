#!/usr/bin/env python3
"""
Build a printable 3MF from the New Holland sign layout DXF.

Each letter / logo segment becomes a face-down shell (hollow, open back) and
every circle in the drawing becomes an internally threaded post sized for a
1/4"-20 screw.

The face sits at Z=0 against the build plate and the shell opens upward, so
nothing needs support.  The DXF is already a reverse image, which is what
face-down printing wants, so the artwork is used as drawn.

Usage:
    python3 build_logo_3mf.py <layout.dxf> <out.3mf>
"""
import math
import sys
import zipfile
from collections import defaultdict

import numpy as np
import ezdxf
import trimesh
from shapely.geometry import Polygon, Point, MultiPolygon
from shapely.geometry.polygon import orient

# ---------------------------------------------------------------- parameters
MM = 1.0
INCH = 25.4

DEPTH = 1.00 * INCH        # overall letter depth (front face -> open back)
WALL = 3.0                 # face + side wall thickness
POST_OD = 0.50 * INCH      # matches the 1/2" circles in the drawing
BORE_DEPTH = 14.0          # threaded depth measured down from the open back
COUNTERSINK = 0.8          # lead-in chamfer at the mouth of the thread

# 1/4"-20 UNC internal thread
THREAD_MAJOR = 0.250 * INCH        # 6.350
THREAD_PITCH = INCH / 20.0         # 1.270
THREAD_H = THREAD_PITCH * math.sqrt(3) / 2.0
THREAD_CLEARANCE = 0.20            # radial slop so an FDM thread accepts a real screw

ARC_SEGMENTS = 64          # facets around a post
HELIX_STEPS = 48           # facets per thread turn

# ------------------------------------------------------------- backer panel
# Single source of truth for the finished panel, shared by the install pattern
# and the CNC program so the two can never disagree.  The DXF outline is drawn
# 96 x 32 in, but 96 in is exactly the long dimension of a 4x8 ACP sheet and
# the profile toolpath needs to sit outside the finished edge, so the panel is
# cut 94 in long.  The artwork is centred and does not move.
PANEL_W = 94.0 * INCH      # 2387.6 mm
PANEL_H = 32.0 * INCH      # 812.8 mm
PANEL_R = 5.0 * INCH       # 127.0 mm


# ------------------------------------------------------------------ dxf load
def load_dxf(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    loops, circles = [], []
    for e in msp:
        if e.dxftype() == "LWPOLYLINE":
            loops.append([(p[0], p[1]) for p in e.get_points("xy")])
        elif e.dxftype() == "ELLIPSE":
            c = e.dxf.center
            r = math.hypot(e.dxf.major_axis.x, e.dxf.major_axis.y)
            circles.append((c.x, c.y, r))
    return loops, circles


def build_parts(loops, circles):
    """Drop the panel outline, nest counters into their letters, bind posts."""
    shapes = [orient(Polygon(p).buffer(0), 1.0) for p in loops]
    panel = max(range(len(shapes)), key=lambda i: shapes[i].area)

    idx = [i for i in range(len(shapes)) if i != panel]
    parent = {}
    for i in idx:
        for j in idx:
            if i != j and shapes[j].area > shapes[i].area \
                    and shapes[j].contains(shapes[i].representative_point()):
                parent[i] = j

    outers = [i for i in idx if i not in parent]
    parts = {}
    for o in outers:
        holes = [loops[k] for k, v in parent.items() if v == o]
        parts[o] = orient(Polygon(loops[o], holes).buffer(0), 1.0)

    posts = defaultdict(list)
    for cx, cy, _r in circles:
        owner = [o for o in outers if parts[o].contains(Point(cx, cy))]
        if len(owner) != 1:
            raise SystemExit(f"circle at ({cx:.1f},{cy:.1f}) maps to {owner}")
        posts[owner[0]].append((cx, cy))
    return parts, posts


# ------------------------------------------------------------------- threads
def thread_cavity(z_top):
    """Solid to subtract from a post to leave a 1/4"-20 tapped hole.

    Built as a helical sweep of the thread groove unioned with the core bore,
    then clipped in Z so the hole gets a flat bottom.
    """
    r_major = THREAD_MAJOR / 2.0 + THREAD_CLEARANCE
    r_minor = r_major - (5.0 / 8.0) * THREAD_H
    p = THREAD_PITCH

    # Groove cross-section in (r, z), one pitch tall, 60 degree flanks.
    profile = [
        (r_minor - 0.15, -6.0 * p / 16.0),
        (r_major,        -1.0 * p / 16.0),
        (r_major,         1.0 * p / 16.0),
        (r_minor - 0.15,  6.0 * p / 16.0),
    ]

    z_lo = z_top - BORE_DEPTH
    z_hi = z_top + 2.0
    turns = (z_hi - z_lo) / p + 2.0
    steps = int(turns * HELIX_STEPS)

    verts, faces = [], []
    n = len(profile)
    for k in range(steps + 1):
        t = k / HELIX_STEPS                      # turns travelled
        ang = 2.0 * math.pi * t
        z_axis = z_lo - p + p * t
        ca, sa = math.cos(ang), math.sin(ang)
        for r, dz in profile:
            verts.append((r * ca, r * sa, z_axis + dz))

    for k in range(steps):
        a, b = k * n, (k + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((a + i, b + i, b + j))
            faces.append((a + i, b + j, a + j))
    # caps (profile is a convex quad)
    faces.append((0, 2, 1))
    faces.append((0, 3, 2))
    last = steps * n
    faces.append((last + 0, last + 1, last + 2))
    faces.append((last + 0, last + 2, last + 3))

    helix = trimesh.Trimesh(np.asarray(verts), np.asarray(faces), process=True)
    helix.fix_normals()

    core = trimesh.creation.cylinder(
        radius=r_minor, height=(z_hi - z_lo) + 4.0, sections=ARC_SEGMENTS)
    core.apply_translation((0, 0, (z_lo + z_hi) / 2.0))

    cavity = trimesh.boolean.union([helix, core], engine="manifold")

    clip = trimesh.creation.cylinder(
        radius=r_major + 1.0, height=(z_hi - z_lo), sections=ARC_SEGMENTS)
    clip.apply_translation((0, 0, (z_lo + z_hi) / 2.0))
    cavity = trimesh.boolean.intersection([cavity, clip], engine="manifold")

    # lead-in chamfer at the mouth so a screw starts square
    cone = trimesh.creation.cone(
        radius=r_major + COUNTERSINK, height=r_major + COUNTERSINK,
        sections=ARC_SEGMENTS)
    cone.apply_transform(trimesh.transformations.rotation_matrix(math.pi, [1, 0, 0]))
    cone.apply_translation((0, 0, z_top))
    return trimesh.boolean.union([cavity, cone], engine="manifold")


def threaded_post():
    """One post: solid cylinder from the inside of the face to the open back."""
    h = DEPTH - WALL
    post = trimesh.creation.cylinder(
        radius=POST_OD / 2.0, height=h, sections=ARC_SEGMENTS)
    post.apply_translation((0, 0, WALL + h / 2.0))
    return trimesh.boolean.difference([post, thread_cavity(DEPTH)], engine="manifold")


# --------------------------------------------------------------------- solid
def extrude(poly, height, z0=0.0):
    geoms = poly.geoms if isinstance(poly, MultiPolygon) else [poly]
    meshes = []
    for g in geoms:
        if g.is_empty or g.area < 1e-9:
            continue
        m = trimesh.creation.extrude_polygon(g, height)
        m.apply_translation((0, 0, z0))
        meshes.append(m)
    if not meshes:
        return None
    return meshes[0] if len(meshes) == 1 else trimesh.boolean.union(meshes, engine="manifold")


def make_shell(poly, post_xy, post_proto):
    solid = extrude(poly, DEPTH)
    inner = poly.buffer(-WALL, join_style=2, mitre_limit=2.0)
    if not inner.is_empty:
        cavity = extrude(inner, DEPTH - WALL + 2.0, z0=WALL)
        if cavity is not None:
            solid = trimesh.boolean.difference([solid, cavity], engine="manifold")

    posts = []
    for (x, y) in post_xy:
        p = post_proto.copy()
        p.apply_translation((x, y, 0.0))
        posts.append(p)
    if posts:
        solid = trimesh.boolean.union([solid] + posts, engine="manifold")
    return solid


# ---------------------------------------------------------------- 3mf writer
DECIMALS = 5  # vertex precision written to the file


def finalize(mesh):
    """Snap to the precision we actually write, then re-clean.

    Rounding on export can collapse near-coincident vertices into degenerate
    triangles, so do the rounding here and validate the result rather than
    trusting the full-precision mesh.
    """
    m = mesh.copy()
    m.vertices = np.round(m.vertices, DECIMALS)
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.remove_unreferenced_vertices()
    m.fix_normals()
    if not m.is_watertight:
        raise SystemExit("mesh lost watertightness when rounded for export")
    return m


MODEL_HEAD = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<model unit="millimeter" xml:lang="en-US" '
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
    ' <metadata name="Application">holmgraphics build_logo_3mf.py</metadata>\n'
    ' <metadata name="Title">New Holland sign - shell letters</metadata>\n'
    ' <resources>\n'
)


def write_3mf(path, objects):
    out = [MODEL_HEAD]
    for oid, (name, mesh) in enumerate(objects, start=1):
        out.append(f'  <object id="{oid}" type="model" name="{name}">\n   <mesh>\n    <vertices>\n')
        for v in mesh.vertices:
            out.append(f'     <vertex x="{v[0]:.{DECIMALS}f}" y="{v[1]:.{DECIMALS}f}" z="{v[2]:.{DECIMALS}f}"/>\n')
        out.append('    </vertices>\n    <triangles>\n')
        for f in mesh.faces:
            out.append(f'     <triangle v1="{f[0]}" v2="{f[1]}" v3="{f[2]}"/>\n')
        out.append('    </triangles>\n   </mesh>\n  </object>\n')
    out.append(' </resources>\n <build>\n')
    for oid in range(1, len(objects) + 1):
        out.append(f'  <item objectid="{oid}"/>\n')
    out.append(' </build>\n</model>\n')
    model = "".join(out)

    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        '</Relationships>\n'
    )
    ctypes = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '</Types>\n'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("[Content_Types].xml", ctypes)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)


# ---------------------------------------------------------------------- main
NAMES = ["Leaf-1", "Leaf-2", "Leaf-3", "Leaf-4", "Leaf-5", "Leaf-6",
         "N", "E", "W", "H", "O", "L-1", "L-2", "A", "N-2", "D"]


def main(dxf_path, out_path):
    loops, circles = load_dxf(dxf_path)
    parts, posts = build_parts(loops, circles)
    print(f"{len(parts)} parts, {sum(len(v) for v in posts.values())} posts")

    proto = threaded_post()
    print(f"post prototype: watertight={proto.is_watertight} volume={proto.volume:.1f}mm^3")

    # The DXF is already drawn as a reverse image: viewed from -Z (the front
    # face, which prints against the bed) it reads "leaf NEW HOLLAND" upright,
    # so no mirroring is applied.  X therefore runs right-to-left and the leaf
    # sits at the high-X end.
    order = sorted(parts, key=lambda o: -parts[o].bounds[0])
    xs = [c for o in parts for c in (parts[o].bounds[0], parts[o].bounds[2])]
    ys = [c for o in parts for c in (parts[o].bounds[1], parts[o].bounds[3])]
    cx, cy = (min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0

    objects = []
    for name, o in zip(NAMES, order):
        poly = parts[o]
        pxy = posts[o]
        mesh = make_shell(poly, pxy, proto)
        mesh.apply_translation((-cx, -cy, 0.0))
        mesh = finalize(mesh)
        b = mesh.bounds
        print(f"  {name:7s} {b[1][0]-b[0][0]:6.1f} x {b[1][1]-b[0][1]:6.1f} x "
              f"{b[1][2]-b[0][2]:5.1f} mm  posts={len(pxy):2d}  "
              f"vol={mesh.volume/1000:7.1f} cm^3  watertight={mesh.is_watertight}")
        objects.append((name, mesh))

    write_3mf(out_path, objects)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
