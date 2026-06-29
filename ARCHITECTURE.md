# Spacepoint — Architecture

> Build 3D figures *inside your phone*. Point the phone to choose a **direction**,
> slide to choose a **reach**, and a glowing dot moves through a sphere that is
> tessellated into **pyramid cells**. Touch a cell with the dot and it lights up —
> translucent and glowing — so you sculpt volumetric shapes in spherical space,
> with **zero positional drift** (orientation-only IMU + slider).

This document is the build plan: the concept, the math, the module layout, the
data model, the interaction mechanics, and a phased roadmap. The control core is
adapted and **improved** from
[`docs/orientation-aimed-spherical-pointer.md`](docs/orientation-aimed-spherical-pointer.md)
(kept verbatim for reference).

---

## 1. What it is

A handheld 3D **voxel sculptor** for the inside of a sphere.

```
   phone IMU (orientation)            slider (reach r)            paint trigger
            │                              │                           │
            ▼                              ▼                           ▼
     unit direction d  ───►  cursor = origin + d·r  ───►  cell = grid.cellAt(cursor)
            │                              │                           │
            ▼                              ▼                           ▼
      aim ray in sphere            glowing dot moves          activate / erase cell
                                                                       │
                                                                       ▼
                                              cell glows: translucent + emissive
                                              → a 3D figure grows out of lit cells
```

- **Orientation** comes from the phone IMU as a quaternion → a unit **direction**.
  Orientation never drifts in position because we never integrate acceleration.
- **Reach** is a slider, `r ∈ [0, R]`. `cursor = origin + d·r`.
- The sphere of radius `R` is partitioned into **pyramid cells** (a spherical
  voxel grid). The dot is always inside exactly one cell.
- **Activating** a cell paints it: it becomes a translucent, glowing pyramid.
  Sweep direction + reach with the trigger held and you paint streaks of cells —
  a brush in 3D. Lit cells together form the figure.

The whole sphere of pyramids is **implicit** — we compute which cell the cursor
is in analytically and only ever render the *lit* cells plus the one under the
cursor. That is the key to running smoothly on a phone.

---

## 2. The sphere of pyramids (the data model)

### 2.1 Why pyramids, and what shape they really are

A sphere "made of pyramids" is most naturally a grid in **spherical coordinates**
`(r, θ, φ)`:

- `r` — radius from center, split into `Rdiv` concentric **shells**.
- `θ` — polar angle (0 at +Y pole → π at −Y pole), split into `Tdiv` bands.
- `φ` — azimuth around the up axis (0…2π), split into `Pdiv` sectors.

Each cell spans `[r0,r1] × [θ0,θ1] × [φ0,φ1]`. Geometrically that is a **curved
truncated pyramid (frustum)** whose apex points at the center. The innermost
shell (`r0 = 0`) collapses to a **true pyramid** with its tip at the origin —
hence "sphere of pyramids." This is the standard "spherical voxel" decomposition.

```
        cross-section through the sphere

                 ▲ +Y (θ = 0 pole)
                 │
            ╱╲   │   ╱╲          each wedge = a (θ,φ) column
           ╱  ╲  │  ╱  ╲         each ring  = an r-shell
          ╱ ▕▔▏╲ │ ╱▕▔▏ ╲        a cell     = wedge ∩ shell  (a frustum)
         ╱──┼──┼─O─┼──┼──╲       innermost cells touch O → true pyramids
          ╲ ▕▁▏╱ │ ╲▕▁▏ ╱
           ╲  ╱  │  ╲  ╱
            ╲╱   │   ╲╱
                 │
```

**Index ↔ position (the only math you need):**

```
cellAt(cursor):
    v   = cursor − origin
    r   = |v|;  if r > R → outside, no cell
    θ   = acos(clamp(v.y / r, −1, 1))          // 0..π
    φ   = atan2(v.z, v.x);  if φ < 0 → φ += 2π  // 0..2π
    ir  = floor(r / R   * Rdiv)
    it  = floor(θ / π   * Tdiv)
    ip  = floor(φ / 2π  * Pdiv)
    id  = (ir * Tdiv + it) * Pdiv + ip          // single integer key
```

Going the other way (cell → geometry) gives the 8 corner vertices of the frustum
by combining `{r0,r1} × {θ0,θ1} × {φ0,φ1}` and converting each back to Cartesian.
That is what the mesher uses to build a lit cell's pyramid.

> **Equal-volume option.** Uniform `r` slicing makes outer shells much bigger in
> volume than inner ones. If you want cells of roughly equal *size*, slice `r` so
> shell boundaries follow `r_k = R·(k/Rdiv)^(1/3)`, and optionally slice `θ` by
> `cos θ`. Start uniform; switch later if cells feel uneven. This is a one-line
> change isolated in `SphericalGrid`.

### 2.2 The grid is implicit — render only what's lit

We do **not** instantiate `Rdiv·Tdiv·Pdiv` meshes. The renderer draws only:

1. the **cursor dot** (one small sphere),
2. the **aim ray** (origin → R along `d`),
3. the **lit cells** — one `InstancedMesh` of pyramid/frustum geometry, one
   instance per activated cell (translucent + emissive),
4. the **hover cell** — a single highlighted outline of the cell currently under
   the cursor, so the user sees what they're about to paint,
5. optional faint **scaffolding** — a wireframe of a few shells/great-circles as
   a spatial reference (toggleable), so the empty sphere isn't disorienting.

This means cost scales with **lit cells**, not total cells, so `Rdiv·Tdiv·Pdiv`
can be large (a fine grid) without a rendering penalty.

### 2.3 Cell state

```ts
type CellId = number;                     // packed (ir,it,ip)
type Cell = {
  id: CellId;
  color: number;                          // base hue when lit
  intensity: number;                      // glow strength 0..1
  // r0,r1,θ0,θ1,φ0,φ1 are recomputed from id on demand (not stored)
};
type VoxelModel = {
  R: number; Rdiv: number; Tdiv: number; Pdiv: number;
  cells: Map<CellId, Cell>;               // only lit cells exist
};
```

`Map<CellId, Cell>` keyed by the packed integer makes activate / erase / "is this
lit?" all O(1). Serializing `{R,Rdiv,Tdiv,Pdiv, cells:[...]}` to JSON is the
**save format** for a figure.

---

## 3. Interaction & activation mechanics

You asked which mechanic should color a cell — a screen button, the phone's
hardware buttons, or a tap-and-hold on the slider. Here is the recommendation and
the reasoning.

### 3.1 Recommended scheme

| Action | Gesture | Why |
|---|---|---|
| **Paint (brush)** | **Hold** the on-screen trigger; sweep orientation + slider | Continuous painting of a streak — best for building shapes fast. Hold = "brush down." |
| **Toggle one cell** | **Tap** the trigger | Precise single-cell edits without a streak. |
| **Erase** | **Mode toggle** flips trigger to erase; same gestures | Reuses the same muscle memory; no separate eraser button to hunt for. |
| **Dwell (hands-free)** | Cursor rests in a cell ~400 ms → auto-activate | Accessibility / one-handed fallback. Off by default (avoids accidental paint). |
| **Pick color / layer** | A small palette/segmented control in the HUD | Independent of the paint gesture. |

The **trigger is a large thumb-reachable on-screen button** at the bottom corner,
opposite the reach slider, so both thumbs work simultaneously: one slides reach,
the other paints — while the whole phone aims direction.

### 3.2 Why not the alternatives you suggested

- **Phone hardware buttons (volume etc.):** the browser/`DeviceOrientation` path
  **cannot** read volume/power buttons reliably — they're captured by the OS. It
  would force a native shell immediately and kill the web prototype. Keep hardware
  buttons as a *later, native-only* enhancement (see §7, Capacitor phase).
- **Tap / hold *on the slider*:** the slider thumb is small and you're already
  using that thumb to set reach; overloading it makes precise reach impossible
  while painting. A separate trigger frees the slider to do one job well.

### 3.3 Nice extras (cheap, high value)

- **Haptic tick** (`navigator.vibrate(8)`) each time the cursor crosses into a new
  cell — you *feel* the grid, which hugely helps eyes-on-the-sphere sculpting.
- **Smoothing / dead-zone** on the IMU (slerp the quaternion toward the raw
  reading) so hand jitter doesn't spray stray cells.
- **Symmetry mirror** (mirror painting across a plane) for building symmetric
  figures in half the gestures.
- **Reach detents / snap** so the slider lands cleanly on shell centers instead
  of straddling shell boundaries.

---

## 4. Module layout

A small, framework-agnostic core (depends only on `three`) with thin adapters
around it. Plain ES modules + Vite; no UI framework needed to start.

```
spacepoint/
├─ index.html                 # canvas, HUD mount, viewport meta (no pinch-zoom)
├─ src/
│  ├─ app.js                  # composition root: wires sensors→core→render→ui, runs the loop
│  │
│  ├─ sensors/
│  │  └─ aim-pointer.js       # IMU → quaternion → direction d; reach→target. (improved §6)
│  │
│  ├─ core/                   # pure logic, no DOM, no three rendering — unit-testable
│  │  ├─ spherical-grid.js    # cellAt(point), cellCorners(id), neighbors(id), pack/unpack
│  │  ├─ voxel-model.js       # VoxelModel: activate/erase/toggle/clear, serialize/load
│  │  └─ brush.js             # turns a stream of cursor cells + trigger state into edits
│  │
│  ├─ render/
│  │  ├─ scene.js             # three scene, camera, lights, render loop hooks
│  │  ├─ cursor.js            # the glowing dot + aim ray
│  │  ├─ cell-mesher.js       # frustum/pyramid geometry from a CellId
│  │  ├─ lit-cells.js         # InstancedMesh of lit cells (translucent + emissive glow)
│  │  ├─ hover.js             # highlight outline of the cell under the cursor
│  │  └─ scaffold.js          # optional faint shell/great-circle reference wireframe
│  │
│  ├─ input/
│  │  ├─ reach-slider.js      # <input range> → reach value (+ detents)
│  │  ├─ paint-trigger.js     # tap vs hold detection → 'toggle' | 'brush' | 'release'
│  │  └─ gestures.js          # camera orbit/zoom on the viewport (separate from aiming)
│  │
│  ├─ ui/
│  │  ├─ hud.js               # palette, mode (paint/erase), symmetry, scaffold toggle
│  │  └─ permission-gate.js   # iOS "Grant sensors & start" tap → requestPermission()
│  │
│  └─ persistence/
│     └─ store.js             # save/load figures (localStorage now; file/export later)
│
├─ docs/
│  └─ orientation-aimed-spherical-pointer.md   # original control note (reference)
└─ ARCHITECTURE.md            # this file
```

### Data flow (one frame)

```
deviceorientation event ─► aim-pointer ─┐
reach-slider value ─────────────────────┤─► cursor = origin + d·reach
                                         │
                       core/spherical-grid.cellAt(cursor) ─► hoverCellId
                                         │
paint-trigger state ─► core/brush(hoverCellId, triggerState) ─► edits
                                         │
                       core/voxel-model.apply(edits)  (the source of truth)
                                         │
       render/{cursor, hover, lit-cells} read model + cursor ─► draw
```

**Boundaries that matter:**
- `core/*` is pure (no `three` rendering, no DOM): it's the testable brain — given
  a point it returns a cell; given edits it mutates the model. Rendering and
  sensors are replaceable shells around it.
- `sensors/aim-pointer.js` is the only place that knows about IMU quirks.
- `render/*` only *reads* the model + cursor; it never owns state.

---

## 5. Rendering the glow (translucent + emissive, still see-through)

The look you described — "glow but still see-through" — is an **additive /
transparent emissive** material:

- `MeshStandardMaterial` (or `MeshBasicMaterial`) with `transparent: true`,
  `opacity ≈ 0.35`, `emissive` set to the cell color, `emissiveIntensity` driven
  by `cell.intensity`, and `depthWrite: false` so overlapping translucent cells
  blend instead of z-fighting.
- One `InstancedMesh` holds all lit cells; per-instance color via
  `setColorAt`. Re-glow / pulse by animating `emissiveIntensity`.
- For a real bloom halo, add a post-processing **UnrealBloomPass** (optional —
  costs a little GPU; gate it behind a "quality" toggle for low-end phones).
- Faces use `side: THREE.DoubleSide` so you can see lit cells from inside the
  sphere as the cursor moves among them.

Edges: draw a thin emissive `LineSegments` wireframe per lit cell (or just the
hover cell) so pyramids read as crisp shapes rather than blurry blobs.

---

## 6. Improved control core (`sensors/aim-pointer.js`)

Same drift-free idea as the reference doc, improved for sculpting:

1. **Quaternion smoothing** — slerp the live quaternion toward the raw reading
   (`q.slerp(raw, α)`, α≈0.25) to kill hand jitter so you don't spray cells.
2. **Direction as output of the smoothed quaternion**, not the raw one.
3. **Recenter / calibration** — capture an offset quaternion on a "set forward"
   tap so "straight ahead" is wherever the user is comfortable, not magnetic
   north. (`d = offset⁻¹ · q · axis`.)
4. **Absolute heading when present** (iOS `webkitCompassHeading`, Android
   `deviceorientationabsolute`) to keep yaw drift-free — kept from the original.
5. **Configurable aim axis** (+Y top-edge vs −Z back-camera) and **per-axis
   invert** — kept from the original.
6. **Reach mapping hook** — let reach map non-linearly (e.g. ease) so inner
   shells are easier to hit precisely.

Interface (unchanged shape, so it stays a drop-in):
`onDeviceOrientation(event)`, `target(reach, out?)`, `direction`, `quaternion`,
plus new `recenter()` and `setSmoothing(α)`. Full reference implementation and
the iOS permission flow live in
[`docs/orientation-aimed-spherical-pointer.md`](docs/orientation-aimed-spherical-pointer.md).

---

## 7. Tech stack & platform

- **Three.js** for rendering (the control core already targets it).
- **Vanilla ES modules + Vite** dev server. No framework needed for v1; the HUD
  is a handful of DOM controls. (Add a framework only if the UI grows.)
- **HTTPS is mandatory** for IMU on iOS — Vite's `--https` locally, any static
  host (GitHub Pages / Netlify / Vercel) in prod.
- **Single origin, no iframe** — iOS blocks motion/orientation inside iframes.
- **Viewport**: `maximum-scale=1, user-scalable=no` so pinch controls *your*
  camera, not the browser.
- **Later (native):** wrap with **Capacitor** to (a) read hardware buttons as a
  paint trigger, (b) get steadier sensor rates, (c) ship to app stores. The web
  core stays unchanged; Capacitor is an outer shell.

---

## 8. Build roadmap (phased, each phase is usable)

**Phase 0 — Skeleton.** `index.html` + Vite + three scene with an empty sphere
scaffold and orbit camera. Renders, does nothing yet.

**Phase 1 — Control core.** Port the improved `aim-pointer.js`; add the reach
slider and iOS permission gate. A glowing dot + aim ray move inside the sphere.
*Milestone: you can fly the dot anywhere in the sphere, drift-free.*

**Phase 2 — Grid + hover.** `spherical-grid.js` `cellAt()`; highlight the cell
under the cursor (`hover.js`). Haptic tick on cell-cross. *Milestone: you see
which pyramid you're "touching."*

**Phase 3 — Paint.** `paint-trigger.js` (tap/hold) + `brush.js` + `voxel-model.js`
+ `lit-cells.js` instanced glow. *Milestone: you sculpt — lit translucent
pyramids form figures.* This is the core app.

**Phase 4 — Sculpt polish.** Erase mode, palette, symmetry mirror, reach detents,
quaternion smoothing/recenter, optional bloom.

**Phase 5 — Persist & share.** Save/load figures (localStorage → JSON export);
shareable links; screenshot/turntable export.

**Phase 6 — Native (optional).** Capacitor shell: hardware-button trigger,
higher sensor rate, store builds. Later: camera/AR-marker fusion for true
position (see reference doc §6) if you ever want to *walk around* the figure.

---

## 9. Open questions to decide before Phase 3

- **Grid resolution** `Rdiv × Tdiv × Pdiv` — start coarse (e.g. `6 × 12 × 24`)
  for chunky, easy-to-hit pyramids; raise for detail. Tune by feel.
- **Pole handling** — `φ` sectors all converge at the θ-poles, making polar cells
  thin slivers. Option: merge the top/bottom `θ` band into single cap cells.
- **Equal-volume vs uniform** shell slicing (§2.1) — uniform first.
- **Reach precision near center** — small `r` means cells are tiny and crowded;
  a non-linear reach map (§6.6) or a center dead-zone helps.
