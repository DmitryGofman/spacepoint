import * as THREE from "three";

/**
 * The cursor blob at the target point + a faint aim ray from origin to maxReach.
 *
 * Two orientation markers sit on the blob so you can read how your phone is held:
 *  - aim marker  (near-black) on the side facing the aim direction = the phone's
 *    top edge / where it points.
 *  - screen marker (dark slate-blue) on the side facing the phone's screen normal
 *    = which way the screen faces, so you can read the blob's roll/orientation.
 */
export function createCursor(origin, maxReach, color = 0x33ff99) {
  const RADIUS = 0.03;

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 20, 14),
    new THREE.MeshBasicMaterial({ color })
  );

  const aimMarker = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.5, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x05070d })
  );
  const screenMarker = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.42, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x24405f })
  );

  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin.clone(), origin.clone()]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
  );

  const group = new THREE.Group();
  group.add(dot, aimMarker, screenMarker, ray);

  const tip = new THREE.Vector3();
  const o = origin.clone();

  return {
    object3d: group,
    setColor(c) {
      dot.material.color.set(c);
      ray.material.color.set(c);
    },
    /** target = blob position; direction = aim dir; up = screen-normal dir. */
    update(target, direction, up) {
      dot.position.copy(target);
      aimMarker.position.copy(direction).multiplyScalar(RADIUS * 0.85).add(target);
      if (up) screenMarker.position.copy(up).multiplyScalar(RADIUS * 0.85).add(target);
      tip.copy(direction).multiplyScalar(maxReach).add(o);
      ray.geometry.setFromPoints([o, tip]);
    },
  };
}
