# New Holland sign — print, install and CNC files

Generated from `layout.dxf` (the shop's sign layout drawing).

| File | What it is |
| --- | --- |
| `newholland-letters.3mf` | 16 printable objects — 10 letters + 6 logo leaf segments |
| `newholland-install-pattern.pdf` | Front-view install pattern (page 1 at 1:1, page 2 overview) |
| `newholland-backer.tap` | CNC program for the backer panel — CamDRAW dialect, mm, rotated, nested |
| `newholland-backer-setup.txt` | Setup notes for the machine (the `.tap` carries no comments) |
| `newholland-backer-op1-holes.tap` | Same job, holes only (separate-files workflow) |
| `newholland-backer-op2-profile.tap` | Same job, profile only |
| `newholland-backer-cam.dxf` | Layered DXF to toolpath yourself in CorelDRAW / CamDRAW |
| `build_logo_3mf.py` | Builds the 3MF from the DXF |
| `build_install_pattern.py` | Builds the PDF from the DXF |
| `build_backer_gcode.py` | Builds the backer-panel G-code from the DXF |
| `build_backer_dxf.py` | Builds the CAM-ready DXF from the DXF |
| `layout.dxf` | Source drawing |

## What the DXF contains

* One large rounded rectangle — the 2438.4 × 812.8 mm (96 × 32 in) sign panel as originally drawn. **Not printed**. The panel is now cut 94 × 32 in (see below), so this outline is no longer used for anything but a sanity check on the drawing.
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

* **Page 1** is a 1:1 plot, 2448 × 919 mm — plot on the wide-format, tape to the face of the panel, centre-punch through the crosshairs. Check the two scale bars before drilling.
* Red circle = **7.14 mm (9/32 in)** clearance drill for the 1/4"-20 screw.
* Grey circle = the 12.7 mm post footprint behind the panel, reference only.
* **Page 2** is a tabloid overview with the part names and a hole schedule.

## Backer panel — `newholland-backer.tap`

Finished panel **94 × 32 in** (2387.6 × 812.8 mm), R5 in corners. 6 mm ACP,
one 6.35 mm (1/4 in) 2-flute endmill, 18 000 RPM, 3000 mm/min (0.083 mm/tooth),
800 mm/min plunge. Cuts 6.5 mm deep — 0.5 mm into the spoilboard. Estimated run
time about 6 minutes.

### Dialect — this matters

The shop's control rejected generic ISO as an unknown file type. The output is
now matched to a known-good file from the same machine (`--dialect camdraw`,
the default):

| | Working post | What generic ISO did |
| --- | --- | --- |
| Line endings | CRLF | LF only |
| Comments | none | `( )` header and inline |
| Spaces | none — `G0X337.68Y192.26` | `G0 X337.6830 Y192.2617` |
| Preamble | `T3M6` then `S10000M3`, nothing else | `G20 G90 G17 G40 G49 G64`, `G54` |
| Motion | G0 and G1 only, arcs linearised | G2/G3 arcs and helices |
| Units | mm, no G20/G21 — machine default | declared `G20` inches |
| End | `G0Z75` then `M30` | `M5`, `M30` |

So the programs are now **millimetres with no unit word**, matching the
machine's default, and every arc is walked as short G1 chords held within
0.01 mm of true (measured worst case 0.0034 mm on the profile, and the holes
come out at exactly Ø7.1400 mm). Retract is Z75, approach Z2, as in the sample.

Because the file can carry no comments, the setup notes go in
`newholland-backer-setup.txt` instead.

**Feeds.** Confirmed by the shop, so these are what ship:

| | mm/min | in/min | Chipload |
| --- | --- | --- | --- |
| Cut | 3000 | 118.1 | 0.083 mm/tooth |
| Helix ramp into a hole | 1500 | 59.1 | 0.042 mm/tooth |
| Plunge | 800 | 31.5 | 0.022 mm/tooth |

18 000 RPM, 2-flute. Note these are deliberately faster than the sample TAP
from this machine, which ran S10000 with F100/F200 for a different job. They
live in `RPM`, `FEED_XY`, `FEED_RAMP` and `FEED_PLUNGE` at the top of
`build_backer_gcode.py` if they ever need revisiting.

Panel size lives in `PANEL_W` / `PANEL_H` / `PANEL_R` in `build_logo_3mf.py` and
is shared by the G-code, the CAM DXF and the install pattern, so changing it in
one place keeps all three in agreement. The artwork stays centred — at 94 in it
sits with an even 5 in margin at each end, and the nearest hole is 153 mm from
the panel edge.

* **OP1** — 47 × 7.14 mm (9/32 in) mounting holes, helically interpolated on a
  0.395 mm orbit, climb (clockwise), ordered nearest-neighbour to keep rapids
  short.
  Cut first, while the panel is still attached to the sheet.
* **OP2** — outside profile of the rounded panel, offset 3.175 mm, climb (CCW),
  2 passes, ramped in over 60 mm. 9 tabs, 15 mm long × 1.5 mm high, on the
  final pass only.

Setup as written — matched to the shop's CamDRAW workpiece:

* **Sheet 48 × 96 in, portrait.** The panel is rotated 90°, so it sits
  32 × 94 in on the table and is centred on the sheet: toolpath spans
  X 7.875–40.125, Y 0.875–95.125 in. That leaves 8 in of waste either side and
  only **1 in at each end**, so the two tabs on the short edges hold onto a thin
  strip — the six on the long edges do the real work.
* **X0 Y0 = lower-left corner of the sheet. Z0 = top of material.** This matches
  CamDRAW's XY-zero-point set to the workpiece's bottom-left.
* **Millimetres**, with no unit word in the file — the machine's default applies.
* **Face up.** The program is the front view, same as the install pattern.
  The hole pattern is **not symmetric** — running the sheet face down without
  mirroring the program puts every hole in the wrong place.

* No cutter comp — the tool offset is baked into the coordinates.
* **`.tap`** — the extension is only a naming convention, but the shop's control
  wants it. The generator writes whatever extension you name, `--split` included.

Rotating 90° clockwise instead of anticlockwise gives the *same physical part*:
the two hole patterns differ by a 180° turn, and a rounded rectangle maps onto
itself under 180°, so the panel just gets picked up the other way round. Only
face-up vs face-down actually matters, because that one is a mirror.

Options on `build_backer_gcode.py`:

| Flag | Effect |
| --- | --- |
| `--dialect iso` | generic ISO instead — spaces, comments, G2/G3 arcs, LF |
| `--units in` | inch output; refused with the camdraw dialect, which declares no units |
| `--rotate 90` | turn the panel on the table (0/90/180/270) |
| `--sheet 48x96in` | nest centred on a sheet this size, X0 Y0 at the sheet corner (accepts an `in`/`mm` suffix) |
| `--origin centre` | X0 Y0 at the panel centre instead of its lower-left corner |
| `--mirror` | reverse image, for running the sheet **face down** |
| `--split` | separate files per operation, matching CamDRAW's "create separate files" |
| `--percent` | wrap the program in `%` delimiters, if your control expects them |

### Stock

The profile toolpath spans **32.25 × 94.25 in**, so it fits a 4×8 sheet run
portrait with 1.75 in spare along the 96 in direction.

## Toolpathing it yourself — `newholland-backer-cam.dxf`

To run it through CamDRAW with your own post, import this DXF instead. It is
millimetres, in the same coordinate frame as `layout.dxf`, on three layers:

| Layer | Contents | Toolpath |
| --- | --- | --- |
| `PANEL-PROFILE` | 94 × 32 in R5 outline, 4 lines + 4 true arcs | profile, outside |
| `HOLES-9-32` | 47 circles at 7.14 mm | drill / inside profile |
| `REF-ARTWORK` | letter and logo outlines | **do not cut** — reference only |

The hole circles are already at the 9/32 in drill size, not the 1/2 in circles
in the original drawing, so they need no resizing.

It is generated with the same `--rotate` / `--sheet` / `--mirror` options as the
G-code, so the shipped copy is already rotated 90° and nested on 48 × 96 with
the origin at the sheet corner — it drops straight onto the CamDRAW workpiece.

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
python3 build_backer_gcode.py layout.dxf newholland-backer.tap \
        --rotate 90 --sheet 48x96in
python3 build_backer_gcode.py layout.dxf newholland-backer.tap \
        --rotate 90 --sheet 48x96in --split
python3 build_backer_dxf.py   layout.dxf newholland-backer-cam.dxf \
        --rotate 90 --sheet 48x96in
```

Depth, wall thickness, post diameter, thread depth and the backer panel size are constants at the top of `build_logo_3mf.py`. Feeds, speeds, tabs and cut depth are at the top of `build_backer_gcode.py`.
