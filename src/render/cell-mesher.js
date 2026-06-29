/**
 * Turns a cell into triangle / edge vertex data. Every cell is a hex box in
 * (r,theta,phi); pole-band cells have a collapsed theta edge, so they render as
 * pyramids automatically (the degenerate triangles are zero-area and harmless).
 *
 * Corner indexing matches SphericalGrid.cellCorners: index = ri*4 + ti*2 + pi.
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

const _corners = [];

/** Append a cell's filled triangles (positions + per-vertex color). */
export function appendCellFill(grid, id, color, positions, colors) {
  grid.cellCorners(id, _corners);
  for (const f of FACES) {
    const a = _corners[f[0]], b = _corners[f[1]];
    const c = _corners[f[2]], d = _corners[f[3]];
    tri(a, b, c, positions);
    tri(a, c, d, positions);
    for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b);
  }
}

/** Append a cell's wireframe edges (positions only). */
export function appendCellWire(grid, id, positions) {
  grid.cellCorners(id, _corners);
  for (const e of EDGES) {
    push(_corners[e[0]], positions);
    push(_corners[e[1]], positions);
  }
}

function tri(a, b, c, arr) {
  arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}
function push(v, arr) {
  arr.push(v.x, v.y, v.z);
}
