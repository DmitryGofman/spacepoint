# Spacepoint

Build 3D figures *inside your phone*. Point the phone to choose a **direction**,
slide to choose a **reach**, and a glowing dot moves through a sphere tessellated
into **pyramid cells**. Touch a cell with the dot and it lights up — translucent
and glowing — so you sculpt volumetric shapes in spherical space, with **zero
positional drift** (orientation-only IMU + slider).

## Run it

```bash
npm install
npm run dev      # serves over HTTPS (needed for the iOS motion sensors)
```

Open the printed `https://<your-lan-ip>:<port>/` URL **on your phone** (same
Wi-Fi), accept the self-signed cert, tap **Grant sensors & start**, then:

- **Aim** by pointing the phone (the top edge is the pointer).
- **Reach** with the vertical slider on the right.
- **Paint** by holding the big trigger and sweeping — release to navigate.
- **Tap** the trigger to toggle a single cell. Switch **Paint/Erase**, pick a
  color, **Recenter** the forward direction, toggle the **Grid**, **Clear**, or
  **Save**.

No phone handy? It runs on desktop too: **arrow keys** aim, **space** paints,
**drag** orbits the camera.

## How it works

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the full design: the spherical pyramid
  grid, the analytic cell indexing, the line-fill brush, module layout, and the
  interaction model.
- **[docs/orientation-aimed-spherical-pointer.md](docs/orientation-aimed-spherical-pointer.md)**
  — the drift-free orientation+reach control core this is built on.

### Code map

```
src/
  app.js                 composition root + main loop + HUD wiring
  sensors/aim-pointer.js  IMU -> smoothed quaternion -> aim direction (+ recenter, desktop fallback)
  core/spherical-grid.js  pyramid-cell grid: cellAt(point), cellCorners(id)
  core/voxel-model.js     lit-cell state (the figure) + serialize/load
  core/brush.js           line-fill brush (segment supersampling)
  render/*                three.js scene, glowing cells, cursor, hover, scaffold
  persistence/store.js    save/load to localStorage
```

Status: Phases 0–3 of the roadmap (ARCHITECTURE.md §8) are implemented — you can
aim, reach, and sculpt. Next: erase/symmetry polish, persistence/export, native.
