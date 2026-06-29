import * as THREE from "three";
import { appendCellWire } from "./cell-mesher.js";

/** A bright outline of the cell currently under the cursor (what a tap edits). */
export function createHover(grid, color = 0xffffff) {
  const geom = new THREE.BufferGeometry();
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(geom, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 999;

  let current = -2;

  return {
    object3d: lines,
    update(id) {
      if (id === current) return;
      current = id;
      if (id < 0) {
        lines.visible = false;
        return;
      }
      lines.visible = true;
      const pos = [];
      appendCellWire(grid, id, pos);
      geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geom.computeBoundingSphere();
    },
  };
}
