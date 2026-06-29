# Spacepoint

Build 3D figures *inside your phone*. Point the phone to choose a **direction**,
slide to choose a **reach**, and a glowing dot moves through a sphere tessellated
into **pyramid cells**. Touch a cell with the dot and it lights up — translucent
and glowing — so you sculpt volumetric shapes in spherical space, with **zero
positional drift** (orientation-only IMU + slider).

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the full build plan: concept, math
  (the spherical pyramid grid), module layout, interaction mechanics, and a
  phased roadmap.
- **[docs/orientation-aimed-spherical-pointer.md](docs/orientation-aimed-spherical-pointer.md)**
  — the drift-free orientation+reach control core this is built on.

Status: design phase. See the roadmap in ARCHITECTURE.md §8.
