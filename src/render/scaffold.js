import * as THREE from "three";

/**
 * A faint spatial reference so the empty sphere isn't disorienting:
 * the outer boundary as a lat/long wireframe sphere plus the three axis lines.
 * Toggleable.
 */
export function createScaffold(grid) {
  const group = new THREE.Group();

  const shell = new THREE.LineSegments(
    new THREE.WireframeGeometry(
      new THREE.SphereGeometry(grid.R, grid.Pdiv, grid.Tdiv)
    ),
    new THREE.LineBasicMaterial({
      color: 0x335577,
      transparent: true,
      opacity: 0.18,
    })
  );
  shell.position.copy(grid.origin);
  group.add(shell);

  const axisPts = [];
  const R = grid.R * 1.05;
  const o = grid.origin;
  axisPts.push(o.x - R, o.y, o.z, o.x + R, o.y, o.z);
  axisPts.push(o.x, o.y - R, o.z, o.x, o.y + R, o.z);
  axisPts.push(o.x, o.y, o.z - R, o.x, o.y, o.z + R);
  const axes = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(axisPts, 3)
    ),
    new THREE.LineBasicMaterial({
      color: 0x446688,
      transparent: true,
      opacity: 0.3,
    })
  );
  group.add(axes);

  return {
    object3d: group,
    set visible(v) {
      group.visible = v;
    },
    get visible() {
      return group.visible;
    },
  };
}
