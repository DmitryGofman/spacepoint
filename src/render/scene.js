import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Renderer + scene + camera + orbit controls + resize, with a render-loop hook. */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0, 0.5, 3);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  // Two-finger / right-drag orbit; keep one-finger free for UI if desired.

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(2, 3, 1);
  scene.add(key);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  let onFrame = () => {};
  renderer.setAnimationLoop(() => {
    onFrame();
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    controls,
    renderer,
    add: (...o) => scene.add(...o),
    set onFrame(fn) {
      onFrame = fn;
    },
  };
}
