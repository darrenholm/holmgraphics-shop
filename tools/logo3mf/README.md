# New Holland sign — 3D print files

Generated from `layout.dxf` (the shop's sign layout drawing).

| File | What it is |
| --- | --- |
| `newholland-letters.3mf` | 16 printable objects — 10 letters + 6 logo leaf segments |
| `newholland-install-pattern.pdf` | Front-view install pattern (page 1 at 1:1, page 2 overview) |
| `build_logo_3mf.py` | Builds the 3MF from the DXF |
| `build_install_pattern.py` | Builds the PDF from the DXF |
| `layout.dxf` | Source drawing |

## What the DXF contains

* One large rounded rectangle — the 2438.4 × 812.8 mm (8 ft × 32 in) sign panel. **Not printed**, used only as the pattern's reference outline.
* 19 closed outlines — 16 part outlines plus the three counters (the holes in `O`, `A`, `D`), which are nested into their parent letters automatically.
* 47 circles, all Ø12.7 mm (1/2 in) — one per mounting point.

The drawing is stored as a **reverse image**: viewed from −Z it reads "leaf NEW HOLLAND" upright. That is exactly the orientation face-down printing needs, so no mirroring is applied.

## How the parts are built

Each part is a **shell printed face down**:

* front face on the build plate at Z = 0, shell opening upward — **no supports needed**
* overall depth **25.4 mm (1 in)**
* wall thickness **3.0 mm** on the face and all sides, including around the counters
* every circle becomes a Ø12.7 mm post rising from the inside of the face to the open back

Each post carries a **modelled 1/4"-20 UNC internal thread**, 14 mm deep from the open back, with a 0.8 mm lead-in chamfer. The thread is cut with a 0.20 mm radial clearance so a real screw runs in without tapping; measured bore is 5.37 mm minor / 6.75 mm major diameter.

Posts do **not** protrude past the back face, so the letters sit flat against the panel. Screws go through the panel from behind into the posts.

## Printing

* Orientation is already correct — do not rotate. Print as loaded.
* **Supports: none.** The only downward-facing surfaces are the thread flanks at ~64° (0.6% of total area), which is normal for a printed thread. If your slicer is set to "support everywhere" it will try to fill the bores — turn it off.
* All 16 objects are in the file at their true sign positions, so the layout spans 2.1 m. Use the slicer's **Arrange** to lay them out; the largest part (`W`) is 229 × 180 mm, so everything fits a 256 × 256 bed.
* Total volume ≈ 1672 cm³ across all 16 parts.

## Install pattern

* **Page 1** is a 1:1 plot, 2498 × 919 mm — plot on the wide-format, tape to the face of the panel, centre-punch through the crosshairs. Check the two scale bars before drilling.
* Red circle = **7.14 mm (9/32 in)** clearance drill for the 1/4"-20 screw.
* Grey circle = the 12.7 mm post footprint behind the panel, reference only.
* **Page 2** is a tabloid overview with the part names and a hole schedule.

## Hardware

47 × 1/4"-20 × 1/2" screws (pan or truss head, plus washers if the panel is thin).
With a 3 mm panel a 1/2" screw engages ~9.7 mm of thread, about 7½ turns.

## Rebuilding

```
pip install numpy ezdxf shapely trimesh manifold3d mapbox_earcut scipy networkx lxml reportlab
python3 build_logo_3mf.py layout.dxf newholland-letters.3mf
python3 build_install_pattern.py layout.dxf newholland-install-pattern.pdf
```

Depth, wall thickness, post diameter and thread depth are constants at the top of `build_logo_3mf.py`.
