import * as THREE from "three";

// -90deg about X: device screen-normal (+Z) -> world up (+Y); flat phone = level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const DEG = Math.PI / 180;

/**
 * Original, direct orientation control (the version that felt best):
 *   quaternion = Euler(beta, alpha, -gamma, 'YXZ') * Q_FLAT
 *   direction  = aimAxis rotated by that quaternion
 * Absolute (compass-referenced) and 1:1 — a phone circle traces a circle.
 *
 * Kept minimal. The only additions over the raw version:
 *  - light smoothing (slerp) to take the edge off sensor jitter;
 *  - recenter() and an optional sensitivity gain (default 1.0 = untouched);
 *  - a TRANSPARENT continuity gate: it does nothing during normal aiming and
 *    only holds for a few frames when the Euler reading teleports (gimbal lock),
 *    so it can't change the feel — it just softens the rare pole jump.
 *  - manual mode (setManualAim) for the drag-sphere / keyboard controls.
 */
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0), // phone top edge
  invert = new THREE.Vector3(1, 1, 1),
  smoothing = 0.5,
  sensitivity = 1.0, // 1.0 = direct 1:1
} = {}) {
  const aimAxis2 = new THREE.Vector3(0, 0, 1); // screen normal (roll marker)
  const raw = new THREE.Quaternion(); // latest device orientation (incl. Q_FLAT)
  const smooth = new THREE.Quaternion(); // smoothed
  const qRef = new THREE.Quaternion(); // recenter reference
  const qRefInv = new THREE.Quaternion();
  const qRel = new THREE.Quaternion();
  const qEff = new THREE.Quaternion();
  const dir = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 0, 1);
  const tmpUp = new THREE.Vector3();
  const gCur = new THREE.Vector3();
  const gCand = new THREE.Vector3();
  const euler = new THREE.Euler();

  let heading = null;
  let hasOrientation = false;
  let oriInit = false;
  let mode = "imu";
  let manualYaw = 0;
  let manualPitch = 0;
  const lastOri = { alpha: 0, beta: 0, gamma: 0 };

  // transparent continuity gate
  let rejectFrames = 0;
  let jumpGate = 1.2; // rad (~69deg): only true teleports exceed this in a frame
  const MAX_REJECT = 8;

  function onDeviceOrientation(e) {
    if (mode !== "imu") return;
    let aDeg = e.alpha || 0;
    if (e.webkitCompassHeading != null) {
      heading = e.webkitCompassHeading;
      aDeg = 360 - heading;
    } else if (e.absolute === true && e.alpha != null) {
      heading = (360 - e.alpha) % 360;
    }
    const a = aDeg * DEG;
    const b = (e.beta || 0) * DEG;
    const g = (e.gamma || 0) * DEG;
    lastOri.alpha = aDeg;
    lastOri.beta = e.beta || 0;
    lastOri.gamma = e.gamma || 0;
    euler.set(b, a, -g, "YXZ");
    raw.setFromEuler(euler).multiply(Q_FLAT);
    if (!oriInit) {
      smooth.copy(raw);
      qRef.copy(raw);
      oriInit = true;
    }
    hasOrientation = true;
  }

  function setManualAim(yaw, pitch) {
    mode = "manual";
    manualYaw = yaw;
    manualPitch = Math.max(-1.5533, Math.min(1.5533, pitch));
  }
  function setAimMode(m) {
    mode = m === "manual" ? "manual" : "imu";
  }
  function recenter() {
    if (mode === "manual") {
      manualYaw = 0;
      manualPitch = 0;
    } else {
      qRef.copy(smooth);
    }
  }

  // scale a quaternion's rotation angle by k (shortest-arc)
  function scaleAngle(quat, k, out) {
    if (k === 1) return out.copy(quat);
    let x = quat.x, y = quat.y, z = quat.z, w = quat.w;
    if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
    const v = Math.sqrt(x * x + y * y + z * z);
    if (v < 1e-8) return out.set(0, 0, 0, 1);
    const angle = 2 * Math.atan2(v, w) * k;
    const s = Math.sin(angle / 2) / v;
    return out.set(x * s, y * s, z * s, Math.cos(angle / 2));
  }

  function update() {
    if (mode === "manual") {
      const cp = Math.cos(manualPitch);
      dir
        .set(Math.sin(manualYaw) * cp, Math.sin(manualPitch), Math.cos(manualYaw) * cp)
        .multiply(invert)
        .normalize();
      tmpUp.set(0, 1, 0);
      up.copy(tmpUp).addScaledVector(dir, -tmpUp.dot(dir));
      if (up.lengthSq() < 1e-4) up.set(0, 0, 1);
      up.normalize();
      return dir;
    }

    // transparent gate: does nothing unless the reading teleports
    gCur.copy(aimAxis).applyQuaternion(smooth).normalize();
    gCand.copy(aimAxis).applyQuaternion(raw).normalize();
    const jump = gCur.angleTo(gCand);
    if (jump <= jumpGate) {
      smooth.slerp(raw, smoothing);
      rejectFrames = 0;
    } else if (rejectFrames >= MAX_REJECT) {
      smooth.copy(raw);
      rejectFrames = 0;
    } else {
      rejectFrames++;
    }

    // amplify deviation from recenter (sensitivity 1.0 -> untouched)
    qRefInv.copy(qRef).invert();
    qRel.copy(smooth).multiply(qRefInv);
    scaleAngle(qRel, sensitivity, qRel);
    qEff.copy(qRel).multiply(qRef);

    dir.copy(aimAxis).applyQuaternion(qEff).multiply(invert).normalize();
    up.copy(aimAxis2).applyQuaternion(qEff).normalize();
    return dir;
  }

  function target(reach, out = new THREE.Vector3()) {
    return out.copy(dir).multiplyScalar(reach).add(origin);
  }

  return {
    onDeviceOrientation,
    setManualAim,
    setAimMode,
    recenter,
    update,
    target,
    setSmoothing(a) {
      smoothing = a;
    },
    setSensitivity(k) {
      sensitivity = k;
    },
    setJumpGate(r) {
      jumpGate = r;
    },
    get debugInfo() {
      return { mode, ori: lastOri, hasOrientation };
    },
    get direction() {
      return dir;
    },
    get up() {
      return up;
    },
    get heading() {
      return heading;
    },
    get hasOrientation() {
      return hasOrientation;
    },
    get mode() {
      return mode;
    },
    get isManual() {
      return mode === "manual";
    },
  };
}

/** iOS needs a user gesture + HTTPS to grant orientation. */
export async function requestOrientationPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    const res = await D.requestPermission();
    if (res !== "granted") throw new Error("orientation permission denied");
  }
}

/** Attach to the best available orientation event (absolute preferred). */
export function listenOrientation(pointer) {
  if ("ondeviceorientationabsolute" in window) {
    window.addEventListener("deviceorientationabsolute", pointer.onDeviceOrientation);
  }
  window.addEventListener("deviceorientation", pointer.onDeviceOrientation);
}
