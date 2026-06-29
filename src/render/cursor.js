import * as THREE from "three";

/** The glowing dot at the target point + a faint aim ray from origin to maxReach. */
export function createCursor(origin, maxReach, color = 0x33ff99) {
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 16, 12),
    new THREE.MeshBasicMaterial({ color })
  );

  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([origin.clone(), origin.clone()]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
  );

  const group = new THREE.Group();
  group.add(dot, ray);

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
      tip.copy(direction).multiplyScalar(maxReach).add(o);
      ray.geometry.setFromPoints([o, tip]);
    },
  };
}
