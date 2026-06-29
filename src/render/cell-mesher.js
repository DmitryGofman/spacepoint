import * as THREE from "three";

/**
 * Turns a cell into triangle / edge vertex data. Two cell shapes exist:
 *  - hex  : a normal (r,theta,phi) box with 8 corners.
 *  - cap  : a merged pole cell spanning all phi (a cone/bowl shell), used for the
 *           top and bottom bands so there's no phi singularity at the poles.
 *
 * Corner indexing for hex matches SphericalGrid.cellCorners: index = ri*4+ti*2+pi.
 */

const C = (ri, ti, pi) => ri * 4 + ti * 2 + pi;

const FACES = [
  [C(0, 0, 0), C(0, 1, 0), C(0, 1, 1), C(0, 0, 1)], // inner (r0)
  [C(1, 0, 0), C(1, 0, 1), C(1, 1, 1), C(1, 1, 0)], // outer (r1)
  [C(0, 0, 0), C(0, 0, 1), C(1, 0, 1), C(1, 0, 0)], // theta low
  [C(0, 1, 0), C(1, 1, 0), C(1, 1, 1), C(0, 1, 1)], // theta high
  [C(0, 0, 0), C(1, 0, 0), C(1, 1, 0), C(0, 1, 0)], // phi low
  [C(0, 0, 1), C(0, 1, 1), C(1, 1, 1), C(1, 0, 1)], // phi high
];

const EDGES = [
  [C(0, 0, 0), C(0, 0, 1)], [C(0, 0, 1), C(0, 1, 1)],
  [C(0, 1, 1), C(0, 1, 0)], [C(0, 1, 0), C(0, 0, 0)],
  [C(1, 0, 0), C(1, 0, 1)], [C(1, 0, 1), C(1, 1, 1)],
  [C(1, 1, 1), C(1, 1, 0)], [C(1, 1, 0), C(1, 0, 0)],
  [C(0, 0, 0), C(1, 0, 0)], [C(0, 0, 1), C(1, 0, 1)],
  [C(0, 1, 1), C(1, 1, 1)], [C(0, 1, 0), C(1, 1, 0)],
];

const CAP_SEG = 24; // phi resolution of a pole cap
const _corners = [];

// --- public, shape-aware API ------------------------------------------------

/** Append a cell's filled triangles (positions + per-vertex color). */
export function appendCellFill(grid, id, color, positions, colors) {
  if (grid.isCap(id)) {
    appendCapFill(grid, grid.capParams(id), color, positions, colors);
  } else {
    grid.cellCorners(id, _corners);
    appendHexFill(_corners, color, positions, colors);
  }
}

/** Append a cell's wireframe edges (positions only). */
export function appendCellWire(grid, id, positions) {
  if (grid.isCap(id)) {
    appendCapWire(grid, grid.capParams(id), positions);
  } else {
    grid.cellCorners(id, _corners);
    appendHexWire(_corners, positions);
  }
}

// --- hex --------------------------------------------------------------------

function appendHexFill(corners, color, positions, colors) {
  for (const f of FACES) {
    const a = corners[f[0]], b = corners[f[1]], c = corners[f[2]], d = corners[f[3]];
    tri(a, b, c, positions); tri(a, c, d, positions);
    for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b);
  }
}

function appendHexWire(corners, positions) {
  for (const e of EDGES) {
    push(corners[e[0]], positions);
    push(corners[e[1]], positions);
  }
}

// --- cap (cone/bowl shell spanning all phi) ---------------------------------

function appendCapFill(grid, p, color, positions, colors) {
  const tPole = p.top ? 0 : Math.PI;
  const apexOut = grid.toCartesian(p.r1, tPole, 0, new THREE.Vector3());
  const apexIn = grid.toCartesian(p.r0, tPole, 0, new THREE.Vector3());
  let oPrev = grid.toCartesian(p.r1, p.tRim, 0, new THREE.Vector3());
  let iPrev = grid.toCartesian(p.r0, p.tRim, 0, new THREE.Vector3());
  for (let j = 1; j <= CAP_SEG; j++) {
    const phi = (j / CAP_SEG) * Math.PI * 2;
    const oCur = grid.toCartesian(p.r1, p.tRim, phi, new THREE.Vector3());
    const iCur = grid.toCartesian(p.r0, p.tRim, phi, new THREE.Vector3());
    tri(apexOut, oPrev, oCur, positions); // outer cap surface
    tri(apexIn, iCur, iPrev, positions); // inner cap surface
    // rim band between inner and outer rings
    tri(iPrev, oPrev, oCur, positions);
    tri(iPrev, oCur, iCur, positions);
    for (let i = 0; i < 12; i++) colors.push(color.r, color.g, color.b);
    oPrev = oCur;
    iPrev = iCur;
  }
}

function appendCapWire(grid, p, positions) {
  const v = new THREE.Vector3();
  // outer rim ring
  let prev = grid.toCartesian(p.r1, p.tRim, 0, new THREE.Vector3());
  for (let j = 1; j <= CAP_SEG; j++) {
    const phi = (j / CAP_SEG) * Math.PI * 2;
    const cur = grid.toCartesian(p.r1, p.tRim, phi, v);
    push(prev, positions);
    push(cur, positions);
    prev = cur.clone();
  }
  // a few meridians from apex to rim for shape definition
  const tPole = p.top ? 0 : Math.PI;
  const apex = grid.toCartesian(p.r1, tPole, 0, new THREE.Vector3());
  for (let m = 0; m < 4; m++) {
    const phi = (m / 4) * Math.PI * 2;
    push(apex, positions);
    push(grid.toCartesian(p.r1, p.tRim, phi, v), positions);
  }
}

// --- helpers ----------------------------------------------------------------

function tri(a, b, c, arr) {
  arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}
function push(v, arr) {
  arr.push(v.x, v.y, v.z);
}
