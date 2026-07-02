import * as THREE from "three";
import {
  createAimPointer,
  requestOrientationPermission,
  listenOrientation,
} from "./sensors/aim-pointer.js";
import { SphericalGrid } from "./core/spherical-grid.js";
import { VoxelModel } from "./core/voxel-model.js";
import { createBrush } from "./core/brush.js";
import { createScene } from "./render/scene.js";
import { createCursor } from "./render/cursor.js";
import { createLitCells } from "./render/lit-cells.js";
import { createHover } from "./render/hover.js";
import { createScaffold } from "./render/scaffold.js";
import { saveFigure, loadFigure } from "./persistence/store.js";

// ---- config ---------------------------------------------------------------
const ORIGIN = new THREE.Vector3(0, 0, 0);
const MAX_REACH = 1.0; // == grid.R, so the cursor spans the whole sphere
const TAP_MS = 150; // press shorter than this (no cell change) = tap-toggle
const TOP_PITCH = 1.5533; // ~89deg up: beam points at the top of the sphere
const PALETTE = [0x33ff99, 0x4aa8ff, 0xff9d3f, 0xff5d73, 0xffd23f, 0xb96bff];

// ---- wiring ---------------------------------------------------------------
const canvas = document.getElementById("view");
const view = createScene(canvas);

const grid = new SphericalGrid({ R: MAX_REACH, Rdiv: 8, Tdiv: 16, Pdiv: 32, origin: ORIGIN });
const model = new VoxelModel(grid);
const brush = createBrush(grid);
const pointer = createAimPointer({ origin: ORIGIN });

const scaffold = createScaffold(grid);
const litCells = createLitCells(grid, model);
const hover = createHover(grid);
const cursor = createCursor(ORIGIN, MAX_REACH, PALETTE[0]);
// the sphere (grid/cells/hover) lives in worldGroup so "drag sphere" can rotate
// it as a whole; the cursor beam stays fixed in world space.
view.addToWorld(scaffold.object3d, litCells.object3d, hover.object3d);
view.add(cursor.object3d);

// phone-orientation hologram at the sphere center (toggle in Settings)
const holo = new THREE.Group();
{
  const bodyGeo = new THREE.BoxGeometry(0.16, 0.32, 0.018);
  holo.add(
    new THREE.Mesh(
      bodyGeo,
      new THREE.MeshBasicMaterial({ color: 0x33ddff, transparent: true, opacity: 0.1, side: THREE.DoubleSide })
    )
  );
  holo.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({ color: 0x7fefff, transparent: true, opacity: 0.9 })
    )
  );
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.13, 0.27),
    new THREE.MeshBasicMaterial({ color: 0x2aa8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  screen.position.z = 0.01;
  holo.add(screen);
  const topMark = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.025, 0.025),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  topMark.position.y = 0.16; // marks the phone's TOP edge (the aim direction)
  holo.add(topMark);
}
holo.visible = false;
view.add(holo);

loadFigure(model);

// ---- interaction state ----------------------------------------------------
let reach = MAX_REACH * 0.6;
let paintColor = PALETTE[0];
let eraseMode = false;
let lastHover = -2;

const press = { down: false, t0: 0, startCell: -1, decided: false, brushing: false };
const target = new THREE.Vector3(); // beam tip in world space (for the cursor)
const localTarget = new THREE.Vector3(); // beam tip in the sphere's frame (for grid/brush)

function applyCells(ids) {
  for (const id of ids) {
    if (eraseMode) model.erase(id);
    else model.light(id, paintColor, 1);
  }
}

function beginPress() {
  press.down = true;
  press.t0 = performance.now();
  press.startCell = grid.cellAt(localTarget);
  press.decided = false;
  press.brushing = false;
  model.beginEdit(); // everything until endPress is one Undo step
}

function endPress() {
  if (!press.down) return;
  press.down = false;
  if (!press.decided) {
    // quick tap, never moved cell -> toggle the one cell
    if (eraseMode) model.erase(press.startCell);
    else model.toggle(press.startCell, paintColor, 1);
  } else if (press.brushing) {
    brush.end();
  }
  model.commitEdit();
}

function tickPress(hoverId) {
  if (!press.down) return;
  if (!press.decided) {
    const held = performance.now() - press.t0 > TAP_MS;
    const moved = hoverId !== press.startCell && hoverId >= 0;
    if (held || moved) {
      press.decided = true;
      press.brushing = true;
      applyCells(brush.begin(localTarget));
    }
    return;
  }
  if (press.brushing) applyCells(brush.move(localTarget));
}

// ---- main loop ------------------------------------------------------------
view.onFrame = () => {
  const dir = pointer.update();
  pointer.target(reach, target);
  cursor.update(target, dir, pointer.up);

  // map the world-space beam tip into the (possibly rotated) sphere frame
  view.worldGroup.updateWorldMatrix(true, false);
  localTarget.copy(target);
  view.worldGroup.worldToLocal(localTarget);

  const hoverId = grid.cellAt(localTarget);
  hover.update(hoverId);
  if (hoverId !== lastHover && hoverId >= 0) {
    if (navigator.vibrate) navigator.vibrate(6); // feel the grid
    lastHover = hoverId;
  }

  tickPress(hoverId);
  litCells.update();

  if (holo.visible) pointer.getOrientation(holo.quaternion);

  if (showSensors) {
    const d = pointer.debugInfo;
    const f = (n) => (n >= 0 ? " " : "") + n.toFixed(1);
    sensorDbg.textContent =
      `gyro ${d.gyroActive ? "ON " : "off"}  orient ${d.hasOrientation ? "ON " : "off"}\n` +
      `rate(deg/s) pitchβ${f(d.rate.beta)} rollγ${f(d.rate.gamma)} yawα${f(d.rate.alpha)}\n` +
      `angle(deg)  pitch${f(d.abs.pitch)} yaw${f(d.abs.yaw)} roll${f(d.abs.roll)}\n` +
      `beam x${f(dir.x)}  y${f(dir.y)}  z${f(dir.z)}`;
  }
};

// ---- HUD ------------------------------------------------------------------
const ui = (id) => document.getElementById(id);

// shared aim state (used by IMU recenter, drag-aim, and keyboard fallback)
let yaw = 0;
let pitch = 0.3;
let aimMode = "imu"; // "imu" | "beam" (drag cursor) | "sphere" (rotate sphere)

ui("reach").addEventListener("input", (e) => (reach = +e.target.value));

const trigger = ui("trigger");
const triggerDown = (e) => {
  e.preventDefault();
  beginPress();
};
const triggerUp = (e) => {
  e.preventDefault();
  endPress();
};
trigger.addEventListener("pointerdown", triggerDown);
trigger.addEventListener("pointerup", triggerUp);
trigger.addEventListener("pointercancel", triggerUp);
trigger.addEventListener("pointerleave", triggerUp);

ui("mode").addEventListener("click", (e) => {
  eraseMode = !eraseMode;
  e.target.textContent = eraseMode ? "Erase" : "Paint";
  e.target.classList.toggle("erase", eraseMode);
});

ui("recenter").addEventListener("click", () => {
  if (pointer.isManual) {
    yaw = 0;
    pitch = TOP_PITCH; // beam to the top of the sphere
    pointer.setManualAim(yaw, pitch);
  } else {
    pointer.recenter(); // IMU neutral = aim axis = top of the sphere
  }
});

ui("undo").addEventListener("click", () => {
  if (!model.undo()) flash("nothing to undo");
});

ui("clear").addEventListener("click", () => model.clear());

ui("save").addEventListener("click", () => {
  saveFigure(model);
  flash("saved");
});

const scaffoldBtn = ui("scaffold");
scaffoldBtn.addEventListener("click", () => {
  scaffold.visible = !scaffold.visible;
  scaffoldBtn.classList.toggle("off", !scaffold.visible);
});

// color palette
const palette = ui("palette");
PALETTE.forEach((c, i) => {
  const sw = document.createElement("button");
  sw.className = "swatch" + (i === 0 ? " active" : "");
  sw.style.background = "#" + c.toString(16).padStart(6, "0");
  sw.addEventListener("click", () => {
    paintColor = c;
    cursor.setColor(c);
    palette.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
  });
  palette.appendChild(sw);
});

// ---- settings: aim mode (IMU / drag beam / drag sphere) + opacity + glow ---
ui("settings").addEventListener("click", () => ui("panel").classList.toggle("open"));

// IMU: one-finger orbits camera, IMU aims. beam/sphere: one-finger handled by
// us below; OrbitControls keeps only pinch-zoom (enableRotate off). Pinch zoom
// stays available in every mode.
function setAimMode(m) {
  aimMode = m;
  const imu = m === "imu";
  view.controls.enableRotate = imu;
  view.controls.enableZoom = true;
  if (imu) {
    pointer.setAimMode("imu");
  } else {
    // sphere: beam parked at the top; you rotate the sphere under it
    yaw = 0;
    pitch = TOP_PITCH;
    pointer.setManualAim(yaw, pitch);
  }
  document
    .querySelectorAll("#aimseg button")
    .forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
}
document.querySelectorAll("#aimseg button").forEach((b) =>
  b.addEventListener("click", () => setAimMode(b.dataset.mode))
);

const opacitySlider = ui("opacity");
opacitySlider.addEventListener("input", (e) => {
  litCells.setOpacity(+e.target.value);
  ui("opacityVal").textContent = (+e.target.value).toFixed(2);
});
const glowSlider = ui("glow");
glowSlider.addEventListener("input", (e) => {
  view.setBloom(+e.target.value);
  ui("glowVal").textContent = (+e.target.value).toFixed(2);
});
ui("sens").addEventListener("input", (e) => {
  pointer.setSensitivity(+e.target.value);
  ui("sensVal").textContent = (+e.target.value).toFixed(1) + "×";
});
const sensorDbg = ui("sensordbg");
let showSensors = false;
ui("sensordbgchk").addEventListener("change", (e) => {
  showSensors = e.target.checked;
  sensorDbg.classList.toggle("show", showSensors);
});

ui("holochk").addEventListener("change", (e) => {
  holo.visible = e.target.checked;
});

// ---- one-finger drag on the canvas: rotate the sphere (Drag-sphere mode) ----
const canvasEl = ui("view");
const activePointers = new Set();
let dragging = false;
let lastX = 0, lastY = 0;
const rot = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

canvasEl.addEventListener("pointerdown", (e) => {
  activePointers.add(e.pointerId);
  if (aimMode !== "sphere") return; // IMU mode: OrbitControls handles it
  if (activePointers.size > 1) { dragging = false; return; } // 2 fingers -> pinch zoom
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
canvasEl.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = (e.clientX - lastX) * 0.01;
  const dy = (e.clientY - lastY) * 0.01;
  rot.setFromAxisAngle(AXIS_Y, dx);
  view.worldGroup.quaternion.premultiply(rot);
  rot.setFromAxisAngle(AXIS_X, dy);
  view.worldGroup.quaternion.premultiply(rot);
  lastX = e.clientX;
  lastY = e.clientY;
});
function endPointer(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) dragging = false;
}
canvasEl.addEventListener("pointerup", endPointer);
canvasEl.addEventListener("pointercancel", endPointer);

// ---- sensor start (iOS gesture) + desktop fallback ------------------------
const startBtn = ui("start");
startBtn.addEventListener("click", async () => {
  try {
    await requestOrientationPermission();
    listenOrientation(pointer);
    setAimMode("imu"); // make sure IMU drives the beam right away
    startBtn.classList.add("hidden");
    flash("sensors on");
  } catch (err) {
    flash("no sensors - using keys");
  }
});

// Desktop fallback: arrow keys aim. Active whenever there's no IMU data.
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));
setInterval(() => {
  if (pointer.hasOrientation || aimMode === "sphere") return;
  const s = 0.04;
  let moved = false;
  if (keys.has("ArrowLeft")) (yaw += s), (moved = true);
  if (keys.has("ArrowRight")) (yaw -= s), (moved = true);
  if (keys.has("ArrowUp")) (pitch += s), (moved = true);
  if (keys.has("ArrowDown")) (pitch -= s), (moved = true);
  // only take over (manual mode) on an actual keypress, so a phone with no
  // keyboard never blocks the IMU from driving the beam.
  if (moved) pointer.setManualAim(yaw, pitch);
}, 16);
// space = paint trigger on desktop
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !press.down) {
    e.preventDefault();
    beginPress();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") endPress();
});

function flash(msg) {
  const el = ui("status");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1400);
}

// inert unless the URL ends in #debug — used by the headless test harness
if (location.hash === "#debug") {
  window.__sp = {
    pointer,
    model,
    get aimMode() {
      return aimMode;
    },
  };
}
