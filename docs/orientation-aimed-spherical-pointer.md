# Orientation-Aimed Spherical Pointer

A small, **drift-free** 3D control scheme: a phone's orientation picks a
**direction**, a slider picks a **distance** along that direction, and together
they place a point **anywhere inside a sphere**. Because it uses only orientation
(never integrated position), there is **no drift** — unlike accelerometer
double-integration.

Use it to aim a robot end-effector, a cursor, a camera focus point, a light,
etc. This file is self-contained: concept → math → portable code → a prompt you
can paste into another project to regenerate it.

---

## 1. Concept

```
        phone orientation                 reach slider
              │                                 │
              ▼                                 ▼
        unit direction  d   ───────────►  target = origin + d · r
              │                                 │
              ▼                                 ▼
      (ray from origin)                 (point on the sphere)
```

- **Direction `d`**: a unit vector derived from the phone's orientation
  quaternion. We use the phone's **top edge (local +Y)** as the "pointing" axis
  ("point the top of the phone where you want it to go"). Swap to **−Z** to aim
  the *back camera* like a remote.
- **Reach `r`**: a slider in `[0, maxReach]`.
- **Target**: `origin + d * r`. Sweep orientation to rotate the ray over the
  unit sphere; slide `r` to move the point in/out along it ⇒ reach any point in
  the spherical workspace.

---

## 2. The math (the only non-obvious parts)

**Device orientation → quaternion.** Browsers give Euler angles
`alpha` (yaw/Z), `beta` (pitch/X), `gamma` (roll/Y). Build the quaternion in
`YXZ` order, then apply a **−90° rotation about X**. That correction maps the
device's screen-normal (local **+Z**) to world **up (+Y)**, so a phone lying
flat on its back reads as *level / parallel to the ground*. It is the standard
W3C-deviceorientation → three.js fix (same `q1` used by three's
`DeviceOrientationControls`). Skip it and a flat phone reads as "standing up".

```
q = Euler(beta, alpha, -gamma, 'YXZ')  ⊗  Quaternion(-√½, 0, 0, √½)
```

**Absolute heading (optional, kills yaw drift).** On iOS the
`deviceorientation` event carries `webkitCompassHeading` (degrees clockwise from
north). Use `alpha = 360 − webkitCompassHeading` so yaw is magnetometer-locked
and north-referenced instead of drifting. On Android, `deviceorientationabsolute`
gives an absolute `alpha`.

**Aim direction.** `d = normalize( q · localAxis )`, where `localAxis = (0,1,0)`
(top edge) or `(0,0,-1)` (back camera).

**Per-axis inversion.** If one axis feels mirrored on your rig, negate that
component of `d` — it's a coordinate-frame convention, not a bug.

---

## 3. Portable code (three.js, framework-agnostic)

`aim-pointer.js` — no framework, ~40 lines, depends only on `three`:

```js
import * as THREE from "three";

// -90° about X: device screen-normal (+Z) -> world up (+Y); flat phone = level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

// Choose the pointing axis: (0,1,0) = phone top edge, (0,0,-1) = back camera.
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0),
  invert = new THREE.Vector3(1, 1, 1), // per-axis sign flips if a rig is mirrored
} = {}) {
  const quat = new THREE.Quaternion();
  const dir = new THREE.Vector3(1, 0, 0);
  let heading = null; // degrees from north, or null if no magnetometer

  // attach to the `deviceorientation` event
  function onDeviceOrientation(e) {
    let aDeg = e.alpha || 0;
    if (e.webkitCompassHeading != null) {
      heading = e.webkitCompassHeading; // iOS absolute heading
      aDeg = 360 - heading;
    } else if (e.absolute === true && e.alpha != null) {
      heading = (360 - e.alpha) % 360; // Android absolute orientation
    }
    const a = (aDeg * Math.PI) / 180;
    const b = ((e.beta || 0) * Math.PI) / 180;
    const g = ((e.gamma || 0) * Math.PI) / 180;
    quat.setFromEuler(new THREE.Euler(b, a, -g, "YXZ")).multiply(Q_FLAT);
    dir.copy(aimAxis).applyQuaternion(quat).multiply(invert).normalize();
  }

  // world-space target point at distance `reach` along the aim direction
  function target(reach, out = new THREE.Vector3()) {
    return out.copy(dir).multiplyScalar(reach).add(origin);
  }

  return {
    onDeviceOrientation,
    target,
    get direction() { return dir; },
    get quaternion() { return quat; },
    get heading() { return heading; },
  };
}

// iOS needs a user gesture + HTTPS to grant motion/orientation.
export async function startAimPointer(pointer) {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    const res = await D.requestPermission(); // must be called from a tap handler
    if (res !== "granted") throw new Error("orientation permission denied");
  }
  window.addEventListener("deviceorientation", pointer.onDeviceOrientation);
}
```

**Wiring it into a three.js scene** (sphere/dot + ray + slider):

```js
import { createAimPointer, startAimPointer } from "./aim-pointer.js";

const origin = new THREE.Vector3(0, 1, 0); // e.g. a shoulder/base point
const maxReach = 2.5;
const pointer = createAimPointer({ origin, maxReach });

// the controlled point
const dot = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x33ff99 })
);
scene.add(dot);

// the aim ray (origin -> maxReach along the direction)
const ray = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([origin, origin]),
  new THREE.LineBasicMaterial({ color: 0x33ff99, transparent: true, opacity: 0.5 })
);
scene.add(ray);

let reach = 1.5; // driven by an <input type="range">
document.querySelector("#reach").addEventListener("input", (e) => {
  reach = +e.target.value;
});
document.querySelector("#start").addEventListener("click", () => startAimPointer(pointer));

// in your render loop:
function update() {
  pointer.target(reach, dot.position);
  const tip = pointer.direction.clone().multiplyScalar(maxReach).add(origin);
  ray.geometry.setFromPoints([origin, tip]);
}
```

```html
<button id="start">Grant sensors & start</button>
<input id="reach" type="range" min="0.3" max="2.5" step="0.05" value="1.5" />
```

That's the whole control. Everything else (a robot arm, an IK solver, etc.) just
consumes `pointer.target(reach)` as its goal point.

---

## 4. Platform notes

- **iOS** requires HTTPS **and** a tap to call `DeviceOrientationEvent.requestPermission()`.
- **Must be its own origin** — iOS blocks motion/orientation inside iframes.
- `webkitCompassHeading` is iOS-only; Android uses `deviceorientationabsolute`.
- Disable browser pinch-zoom (`<meta name="viewport" ... maximum-scale=1, user-scalable=no>`) if you want pinch to control your own camera.

---

## 5. Regeneration prompt (paste into another project)

> Build an **orientation-aimed spherical pointer** control for a web app using
> three.js. A phone's orientation defines a unit **direction** vector and a
> slider defines a **reach** distance; the controlled target point is
> `origin + direction * reach`, so the user can place a point anywhere in a
> sphere with **zero drift** (orientation only — no accelerometer integration).
>
> Requirements:
> 1. Listen to the `deviceorientation` event. Build the orientation quaternion
>    from `(beta, alpha, -gamma)` in `YXZ` Euler order, then multiply by a −90°
>    rotation about X (`Quaternion(-√½,0,0,√½)`) so a flat phone reads level.
> 2. Prefer absolute heading when available (`webkitCompassHeading` on iOS:
>    `alpha = 360 − heading`) so yaw is north-referenced and drift-free.
> 3. The aim direction is the phone's local **+Y** (top edge) rotated by the
>    quaternion, normalized. Expose an option to use **−Z** (back camera) and a
>    per-axis invert in case a rig is mirrored.
> 4. `target = origin + aimDirection * reach`, with `reach` from a range slider.
> 5. Render a small sphere at the target and a faint line (ray) from `origin`
>    along the direction to `maxReach`.
> 6. On iOS, gate sensor start behind a button that calls
>    `DeviceOrientationEvent.requestPermission()` (HTTPS + user gesture).
> 7. Keep the sensor/orientation logic in a standalone, framework-agnostic
>    module that only depends on three.js and exposes
>    `onDeviceOrientation(event)`, `target(reach)`, and `direction`.

---

## 6. Optional fusions (to make it "more coordinate-based")

| Signal | Web API | Gives you | Note |
|---|---|---|---|
| Gyro + accel + mag | `deviceorientation` | reliable **orientation** | already used here |
| Magnetometer | `webkitCompassHeading` | absolute **heading** | kills yaw drift |
| Camera + AR marker | `getUserMedia` + WASM CV (ArUco/AprilTag) | drift-free **position** | best browser path to real position |
| Acoustic Doppler/sonar | Web Audio (`AudioContext` + mic) | **velocity / distance** | near-ultrasonic chirp; noisy, fusion-only |
| ARKit + LiDAR | native iOS only | cm **6-DoF** | not exposed to Safari; needs a native app |

**Position is the hard part:** orientation is rock-solid from the IMU, but no
IMU signal gives absolute position without drift. For true position add a camera
(marker tracking) in-browser, or go native for ARKit/LiDAR.
