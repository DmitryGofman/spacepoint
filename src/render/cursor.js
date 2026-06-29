import * as THREE from "three";

/**
 * The cursor blob at the target point + a faint aim ray from origin to maxReach.
 *
 * The blob carries an orientation marker: a small dark cap on the side facing
 * the aim direction (the phone's top edge / speaker), so you can always tell
 * which way the blob — and therefore your phone — is pointing.
 */
export function createCursor(origin, maxReach, color = 0x33ff99) {
  const RADIUS = 0.032;

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 20, 14),
    new THREE.MeshBasicMaterial({ color })
  );

  // dark "nose" marker = where the top of the phone points
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 0.52, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x0a0d14 })
  );

  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin.clone(), origin.clone()]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
  );

  const group = new THREE.Group();
  group.add(dot, marker, ray);

  const tip = new THREE.Vector3();
  const o = origin.clone();

  return {
    object3d: group,
    setColor(c) {
      dot.material.color.set(c);
      ray.material.color.set(c);
    },
    /** target = current dot position; direction = unit aim direction. */
    update(target, direction) {
      dot.position.copy(target);
      // marker sits on the blob surface, on the outward (pointing) side
      marker.position.copy(direction).multiplyScalar(RADIUS * 0.85).add(target);
      tip.copy(direction).multiplyScalar(maxReach).add(o);
      ray.geometry.setFromPoints([o, tip]);
    },
  };
}
