# New Holland sign — print, install and CNC files

Generated from `layout.dxf` (the shop's sign layout drawing).

| File | What it is |
| --- | --- |
| `newholland-letters.3mf` | 16 printable objects — 10 letters + 6 logo leaf segments |
| `newholland-install-pattern.pdf` | Front-view install pattern (page 1 at 1:1, page 2 overview) |
| `newholland-backer.nc` | CNC program for the 6 mm ACP backer panel |
| `build_logo_3mf.py` | Builds the 3MF from the DXF |
| `build_install_pattern.py` | Builds the PDF from the DXF |
| `build_backer_gcode.py` | Builds the backer-panel G-code from the DXF |
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

## Backer panel — `newholland-backer.nc`

6 mm ACP, one 6.35 mm (1/4 in) 2-flute endmill, 18 000 RPM, 3000 mm/min
(0.083 mm/tooth), 800 mm/min plunge. Cuts 6.5 mm deep — 0.5 mm into the
spoilboard. Estimated run time about 6 minutes.

* **OP1** — 47 × 7.14 mm (9/32 in) mounting holes, helically interpolated on a
  0.395 mm orbit, climb (G2), ordered nearest-neighbour to keep rapids short.
  Cut first, while the panel is still attached to the sheet.
* **OP2** — outside profile of the 2438.4 × 812.8 mm R127 rounded panel,
  offset 3.175 mm, climb (CCW), 2 passes, ramped in over 60 mm.
  9 tabs, 15 mm long × 1.5 mm high, on the final pass only.

Setup as written:

* **Face up.** The program is the front view, same as the install pattern.
  The hole pattern is **not symmetric** — running the sheet face down without
  mirroring the program puts every hole in the wrong place.
* **X0 Y0 = lower-left corner of the finished panel. Z0 = top of material.**
* Generic ISO output (G0/G1/G2/G3, G17/G21/G90, M3/M5/M6/M30). No canned
  cycles, no full-circle arc blocks, no cutter comp — the offset is baked into
  the coordinates.

### Stock size — read before ordering

The finished panel is 2438.4 mm long, which is exactly the long dimension of a
standard 4×8 ACP sheet. With the tool offset outward the program needs
**2444.8 × 819.2 mm** of stock, so **a 4×8 sheet is 6.35 mm too short**.
Either order oversize stock (2500 mm or 3050 mm lengths), or shorten the panel
by ~10 mm and regenerate. The generator does not check this for you.

## Hardware

47 × 1/4"-20 × 1/2" screws (pan or truss head).

Through the 6 mm ACP panel a 1/2" (12.7 mm) screw leaves **6.7 mm** in the post
— about 5¼ turns of 1/4"-20. That is enough for parts this light, but there is
no spare: add a washer and you are down to ~5.5 mm. If you want full 12.7 mm
engagement, move to 3/4" screws; the posts are bored 14 mm deep, so they take a
3/4" screw with no change to the printed parts.

## Rebuilding

```
pip install numpy ezdxf shapely trimesh manifold3d mapbox_earcut scipy networkx lxml reportlab
python3 build_logo_3mf.py layout.dxf newholland-letters.3mf
python3 build_install_pattern.py layout.dxf newholland-install-pattern.pdf
python3 build_backer_gcode.py layout.dxf newholland-backer.nc
```

Depth, wall thickness, post diameter and thread depth are constants at the top of `build_logo_3mf.py`.
