import * as THREE from "three";

// The filter works in a Z-up world (the device "flat on its back" frame).
// Q_FLAT maps that to three.js Y-up at the very end, so a flat phone reads level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const DEG = Math.PI / 180;
const WORLD_UP = new THREE.Vector3(0, 0, 1); // "up" inside the filter's Z-up frame

/**
 * QUATERNION-ONLY orientation control (no Euler angles, no compass).
 *
 * A complementary filter fused entirely from DeviceMotion:
 *   1. integrate the GYROSCOPE (rotationRate) into a quaternion -> smooth and
 *      gimbal-free; a full rotation around any axis never jumps.
 *   2. anchor pitch & roll to the ACCELEROMETER gravity vector with a small
 *      quaternion nudge each frame -> pitch is absolute and drift-free (this is
 *      what was missing before). The sign of gravity is auto-resolved, so the
 *      iOS/Android accel sign difference is handled automatically.
 * Yaw has no magnetometer (avoids compass jitter); it drifts very slowly and
 * Recenter resets it.
 *
 * Manual mode (setManualAim) drives the beam from yaw/pitch for drag/keyboard.
 */
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0), // phone top edge
  invert = new THREE.Vector3(1, 1, 1),
  smoothing = 0.25,
  tiltGain = 0.04, // how hard gravity pulls pitch/roll back each frame
} = {}) {
  const aimAxis2 = new THREE.Vector3(0, 0, 1); // screen normal (roll marker)
  const q = new THREE.Quaternion(); // fused orientation: device -> Z-up world
  const qOut = new THREE.Quaternion(); // smoothed output
  const offsetInv = new THREE.Quaternion(); // recenter
  const finalQuat = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const corrQ = new THREE.Quaternion();
  const dir = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 0, 1);
  const tmpUp = new THREE.Vector3();
  const accUp = new THREE.Vector3();
  const measUp = new THREE.Vector3();
  const corrAxis = new THREE.Vector3();

  let mode = "imu"; // "imu" | "manual"
  let manualYaw = 0;
  let manualPitch = 0;

  let gyroEnabled = true;
  let gyroActive = false;
  let hasOrientation = false;
  let seeded = false;
  let lastT = 0;

  const lastRate = { alpha: 0, beta: 0, gamma: 0 };
  const lastAccel = { x: 0, y: 0, z: 0 };

  // ---- the only sensor input: DeviceMotion ---------------------------------

  function onDeviceMotion(e) {
    if (mode !== "imu" || !gyroEnabled) return;
    const rr = e.rotationRate;
    const ag = e.accelerationIncludingGravity;
    if (!rr) return;

    const now = performance.now();
    let dt = lastT ? (now - lastT) / 1000 : 0.016;
    lastT = now;
    if (!(dt > 0) || dt > 0.1) dt = 0.016;

    lastRate.alpha = rr.alpha || 0;
    lastRate.beta = rr.beta || 0;
    lastRate.gamma = rr.gamma || 0;

    // gravity (device frame), if present
    let gMag = 0;
    if (ag) {
      lastAccel.x = ag.x || 0;
      lastAccel.y = ag.y || 0;
      lastAccel.z = ag.z || 0;
      gMag = Math.hypot(lastAccel.x, lastAccel.y, lastAccel.z);
    }

    // Seed the orientation from the first gravity reading so we start level
    // (yaw arbitrary). Falls back to identity if no accel.
    if (!seeded) {
      if (gMag > 4) {
        accUp.set(lastAccel.x / gMag, lastAccel.y / gMag, lastAccel.z / gMag);
        // q * accUp = WORLD_UP  (minimal rotation aligning gravity to up)
        q.setFromUnitVectors(accUp, WORLD_UP);
        qOut.copy(q);
        seeded = true;
      } else if (rr) {
        seeded = true; // no accel; start from identity
        qOut.copy(q);
      }
    }
    gyroActive = true;
    hasOrientation = true;

    // 1) integrate gyro (pure quaternion). W3C body axes: beta=X, gamma=Y, alpha=Z
    const wx = (rr.beta || 0) * DEG;
    const wy = (rr.gamma || 0) * DEG;
    const wz = (rr.alpha || 0) * DEG;
    const mag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (mag > 1e-7) {
      const ang = mag * dt;
      const s = Math.sin(ang / 2) / mag;
      dq.set(wx * s, wy * s, wz * s, Math.cos(ang / 2));
      q.multiply(dq).normalize();
    }

    // 2) gravity tilt correction (absolute pitch/roll), sign auto-resolved
    if (gMag > 4 && gMag < 14) {
      accUp.set(lastAccel.x / gMag, lastAccel.y / gMag, lastAccel.z / gMag);
      measUp.copy(accUp).applyQuaternion(q); // device-up expressed in world
      if (measUp.dot(WORLD_UP) < 0) measUp.multiplyScalar(-1); // handle accel sign
      corrAxis.crossVectors(measUp, WORLD_UP);
      const sl = corrAxis.length();
      if (sl > 1e-6) {
        corrAxis.multiplyScalar(1 / sl);
        const a = Math.acos(Math.min(1, Math.max(-1, measUp.dot(WORLD_UP)))) * tiltGain;
        corrQ.setFromAxisAngle(corrAxis, a);
        q.premultiply(corrQ).normalize(); // world-frame nudge -> only tilts pitch/roll
      }
    }
  }

  // ---- modes / recenter -----------------------------------------------------

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
      offsetInv.copy(finalQuat).invert();
    }
  }

  // ---- per-frame output -----------------------------------------------------

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

    qOut.slerp(q, smoothing); // light smoothing of the fused quaternion
    finalQuat.copy(qOut).multiply(Q_FLAT);
    dir
      .copy(aimAxis)
      .applyQuaternion(finalQuat)
      .applyQuaternion(offsetInv)
      .multiply(invert)
      .normalize();
    up.copy(aimAxis2).applyQuaternion(finalQuat).applyQuaternion(offsetInv).normalize();
    return dir;
  }

  function target(reach, out = new THREE.Vector3()) {
    return out.copy(dir).multiplyScalar(reach).add(origin);
  }

  return {
    onDeviceMotion,
    setManualAim,
    setAimMode,
    recenter,
    update,
    target,
    setSmoothing(a) {
      smoothing = a;
    },
    setGyro(on) {
      gyroEnabled = !!on;
    },
    get gyroEnabled() {
      return gyroEnabled;
    },
    get gyroActive() {
      return gyroActive;
    },
    get debugInfo() {
      return { gyroActive, mode, rate: lastRate, accel: lastAccel };
    },
    get direction() {
      return dir;
    },
    get up() {
      return up;
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

/** iOS needs a user gesture + HTTPS to grant motion. */
export async function requestOrientationPermission() {
  const reqs = [];
  const DM = window.DeviceMotionEvent;
  const DO = window.DeviceOrientationEvent;
  if (DM && typeof DM.requestPermission === "function") reqs.push(DM.requestPermission());
  if (DO && typeof DO.requestPermission === "function") reqs.push(DO.requestPermission());
  if (reqs.length) {
    const res = await Promise.all(reqs);
    if (res.some((r) => r !== "granted")) throw new Error("motion permission denied");
  }
}

/** Quaternion path needs only DeviceMotion (gyro + accel). */
export function listenOrientation(pointer) {
  window.addEventListener("devicemotion", pointer.onDeviceMotion);
}
