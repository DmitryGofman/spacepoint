import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

/**
 * Renderer + scene + camera + orbit controls + bloom, with a render-loop hook.
 *
 * `worldGroup` holds everything that belongs to the sphere (grid, lit cells,
 * hover) so it can be rotated as a whole in "drag sphere" mode while the cursor
 * beam stays fixed in world space. Bloom gives the lit cells a real glow halo.
 */
export function createScene(canvas, { cameraDist = 2.3, bloom = 0.5 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0, 0.4, cameraDist);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(2, 3, 1);
  scene.add(key);

  // post-processing: bloom for the glow
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    bloom, // strength
    0.6, // radius
    0.2 // threshold: only brighter cores bloom -> less flare at the sphere limb
  );
  composer.addPass(bloomPass);

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  let onFrame = () => {};
  renderer.setAnimationLoop(() => {
    onFrame();
    controls.update();
    composer.render();
  });

  return {
    scene,
    worldGroup,
    camera,
    controls,
    renderer,
    add: (...o) => scene.add(...o),
    addToWorld: (...o) => worldGroup.add(...o),
    setBloom: (v) => (bloomPass.strength = v),
    set onFrame(fn) {
      onFrame = fn;
    },
  };
}
