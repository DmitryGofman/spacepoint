/**
 * Turns a cell's 8 corners into triangle and edge vertex data.
 *
 * Corner indexing matches SphericalGrid.cellCorners: index = ri*4 + ti*2 + pi.
 *   ri: 0 = inner radius, 1 = outer radius
 *   ti: 0 = low theta,    1 = high theta
 *   pi: 0 = low phi,      1 = high phi
 */

// corner index helper
const C = (ri, ti, pi) => ri * 4 + ti * 2 + pi;

// The 6 quad faces of the hexahedral cell, each as 4 corner indices (CCW-ish).
const FACES = [
  [C(0, 0, 0), C(0, 1, 0), C(0, 1, 1), C(0, 0, 1)], // inner (r0)
  [C(1, 0, 0), C(1, 0, 1), C(1, 1, 1), C(1, 1, 0)], // outer (r1)
  [C(0, 0, 0), C(0, 0, 1), C(1, 0, 1), C(1, 0, 0)], // theta low
  [C(0, 1, 0), C(1, 1, 0), C(1, 1, 1), C(0, 1, 1)], // theta high
  [C(0, 0, 0), C(1, 0, 0), C(1, 1, 0), C(0, 1, 0)], // phi low
  [C(0, 0, 1), C(0, 1, 1), C(1, 1, 1), C(1, 0, 1)], // phi high
];

// The 12 edges as corner index pairs (inner quad, outer quad, radial connectors).
const EDGES = [
  [C(0, 0, 0), C(0, 0, 1)], [C(0, 0, 1), C(0, 1, 1)],
  [C(0, 1, 1), C(0, 1, 0)], [C(0, 1, 0), C(0, 0, 0)],
  [C(1, 0, 0), C(1, 0, 1)], [C(1, 0, 1), C(1, 1, 1)],
  [C(1, 1, 1), C(1, 1, 0)], [C(1, 1, 0), C(1, 0, 0)],
  [C(0, 0, 0), C(1, 0, 0)], [C(0, 0, 1), C(1, 0, 1)],
  [C(0, 1, 1), C(1, 1, 1)], [C(0, 1, 0), C(1, 1, 0)],
];

/** Append a cell's 12 triangles (positions + per-vertex color) to arrays. */
export function appendCellTriangles(corners, color, positions, colors) {
  const r = color.r, g = color.g, b = color.b;
  for (const f of FACES) {
    const a = corners[f[0]], bb = corners[f[1]];
    const cc = corners[f[2]], dd = corners[f[3]];
    // two triangles: a,b,c and a,c,d
    pushVert(a, positions); pushVert(bb, positions); pushVert(cc, positions);
    pushVert(a, positions); pushVert(cc, positions); pushVert(dd, positions);
    for (let i = 0; i < 6; i++) colors.push(r, g, b);
  }
}

/** Append a cell's 12 edges (line segment positions) to an array. */
export function appendCellEdges(corners, positions) {
  for (const e of EDGES) {
    pushVert(corners[e[0]], positions);
    pushVert(corners[e[1]], positions);
  }
}

function pushVert(v, arr) {
  arr.push(v.x, v.y, v.z);
}
