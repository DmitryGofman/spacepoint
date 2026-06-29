import * as THREE from "three";

/**
 * Line-fill brush via segment supersampling.
 *
 * A fast sweep can move the cursor past several cells between two frames.
 * Rather than a true 3-axis DDA (fragile on a *curved* spherical grid), we walk
 * the segment from the previous cursor point to the current one in small steps
 * (~half the smallest cell extent) and look up the cell at each step. The result
 * is deduped against the cells already touched this stroke, so fast strokes stay
 * solid and we never paint the same cell twice within one stroke.
 */
export function createBrush(grid) {
  const step = grid.sampleStep();
  const last = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const stroke = new Set(); // cell ids touched this stroke
  let active = false;

  function pushCell(id, into) {
    if (id < 0 || stroke.has(id)) return;
    stroke.add(id);
    into.push(id);
  }

  return {
    /** Begin a stroke at `point`. Returns the first cell ([] if outside). */
    begin(point) {
      active = true;
      stroke.clear();
      last.copy(point);
      const out = [];
      pushCell(grid.cellAt(point), out);
      return out;
    },

    /** Continue the stroke to `point`. Returns the newly touched cell ids. */
    move(point) {
      if (!active) return [];
      const out = [];
      const dist = probe.copy(point).sub(last).length();
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 1; i <= n; i++) {
        probe.copy(last).lerp(point, i / n);
        pushCell(grid.cellAt(probe), out);
      }
      last.copy(point);
      return out;
    },

    end() {
      active = false;
      const cells = [...stroke];
      stroke.clear();
      return cells;
    },

    get active() {
      return active;
    },
  };
}
