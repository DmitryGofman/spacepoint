import * as THREE from "three";
import { appendCellFill, appendCellWire } from "./cell-mesher.js";

/**
 * Renders the lit cells of a VoxelModel as translucent, glowing pyramids.
 *
 * Spherical cells are not congruent, so we can't InstancedMesh one geometry;
 * instead we rebuild a single merged BufferGeometry whenever the model changes
 * (model.dirty). Cost scales with the number of *lit* cells, not the whole grid.
 *
 * Look: normal alpha blending (NOT additive) so overlapping cells stay coloured
 * and translucent instead of stacking to pure white, with a brighter wireframe
 * overlay so the pyramids read as crisp shapes. Overall glow is adjustable.
 */
export function createLitCells(grid, model, opacity = 0.42) {
  const fillGeom = new THREE.BufferGeometry();
  const fillMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeom, fillMat);
  fill.frustumCulled = false;

  const edgeGeom = new THREE.BufferGeometry();
  const edgeMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: Math.min(1, opacity + 0.35),
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(edgeGeom, edgeMat);
  edges.frustumCulled = false;

  const group = new THREE.Group();
  group.add(fill, edges);

  const color = new THREE.Color();

  function rebuild() {
    const pos = [];
    const col = [];
    const epos = [];
    const ecol = [];
    for (const cell of model.cells.values()) {
      color.set(cell.color).multiplyScalar(cell.intensity);
      appendCellFill(grid, cell.id, color, pos, col);
      const before = epos.length;
      appendCellWire(grid, cell.id, epos);
      const verts = (epos.length - before) / 3;
      for (let i = 0; i < verts; i++) ecol.push(color.r, color.g, color.b);
    }
    setAttr(fillGeom, pos, col);
    setAttr(edgeGeom, epos, ecol);
    model.dirty = false;
  }

  rebuild();

  return {
    object3d: group,
    update() {
      if (model.dirty) rebuild();
    },
    setOpacity(v) {
      fillMat.opacity = v;
      edgeMat.opacity = Math.min(1, v + 0.35);
    },
  };
}

function setAttr(geom, positions, colors) {
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geom.computeBoundingSphere();
}
