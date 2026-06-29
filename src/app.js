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
const PALETTE = [0x33ff99, 0x4aa8ff, 0xff5d73, 0xffd23f, 0xb96bff];

// ---- wiring ---------------------------------------------------------------
const canvas = document.getElementById("view");
const view = createScene(canvas);

const grid = new SphericalGrid({ R: MAX_REACH, Rdiv: 6, Tdiv: 12, Pdiv: 24, origin: ORIGIN });
const model = new VoxelModel(grid);
const brush = createBrush(grid);
const pointer = createAimPointer({ origin: ORIGIN });

const scaffold = createScaffold(grid);
const litCells = createLitCells(grid, model);
const hover = createHover(grid);
const cursor = createCursor(ORIGIN, MAX_REACH, PALETTE[0]);
view.add(scaffold.object3d, litCells.object3d, hover.object3d, cursor.object3d);

loadFigure(model);

// ---- interaction state ----------------------------------------------------
let reach = MAX_REACH * 0.6;
let paintColor = PALETTE[0];
let eraseMode = false;
let lastHover = -2;

const press = { down: false, t0: 0, startCell: -1, decided: false, brushing: false };
const target = new THREE.Vector3();

function applyCells(ids) {
  for (const id of ids) {
    if (eraseMode) model.erase(id);
    else model.light(id, paintColor, 1);
  }
}

function beginPress() {
  press.down = true;
  press.t0 = performance.now();
  press.startCell = grid.cellAt(target);
  press.decided = false;
  press.brushing = false;
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
}

function tickPress(hoverId) {
  if (!press.down) return;
  if (!press.decided) {
    const held = performance.now() - press.t0 > TAP_MS;
    const moved = hoverId !== press.startCell && hoverId >= 0;
    if (held || moved) {
      press.decided = true;
      press.brushing = true;
      applyCells(brush.begin(target));
    }
    return;
  }
  if (press.brushing) applyCells(brush.move(target));
}

// ---- main loop ------------------------------------------------------------
view.onFrame = () => {
  const dir = pointer.update();
  pointer.target(reach, target);
  cursor.update(target, dir);

  const hoverId = grid.cellAt(target);
  hover.update(hoverId);
  if (hoverId !== lastHover && hoverId >= 0) {
    if (navigator.vibrate) navigator.vibrate(6); // feel the grid
    lastHover = hoverId;
  }

  tickPress(hoverId);
  litCells.update();
};

// ---- HUD ------------------------------------------------------------------
const ui = (id) => document.getElementById(id);

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

ui("recenter").addEventListener("click", () => pointer.recenter());

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

// ---- sensor start (iOS gesture) + desktop fallback ------------------------
const startBtn = ui("start");
startBtn.addEventListener("click", async () => {
  try {
    await requestOrientationPermission();
    listenOrientation(pointer);
    startBtn.classList.add("hidden");
    flash("sensors on");
  } catch (err) {
    flash("no sensors - using keys");
  }
});

// Desktop fallback: arrow keys aim, drag isn't needed. Active until IMU data.
let yaw = 0;
let pitch = 0.3;
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.key));
window.addEventListener("keyup", (e) => keys.delete(e.key));
setInterval(() => {
  if (pointer.hasOrientation) return;
  const s = 0.04;
  if (keys.has("ArrowLeft")) yaw += s;
  if (keys.has("ArrowRight")) yaw -= s;
  if (keys.has("ArrowUp")) pitch += s;
  if (keys.has("ArrowDown")) pitch -= s;
  pointer.setManualAim(yaw, pitch);
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
