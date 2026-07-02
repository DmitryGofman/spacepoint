import * as THREE from "three";

// Z-up (device flat) world -> three.js Y-up at the output; flat phone = level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const DEG = Math.PI / 180;

/**
 * QUATERNION-ONLY orientation control that has NO poles.
 *
 * The orientation is integrated purely from the GYROSCOPE (DeviceMotion
 * .rotationRate) into a quaternion. A quaternion has no gimbal lock, so the beam
 * sails straight through "phone pointing up/down" — it never stops or locks at a
 * pole, and a full circle stays continuous. DeviceOrientation is used only to
 * seed a sensible starting tilt; after that it's pure gyro.
 *
 * Drift (the price of gyro-only) is corrected by Recenter: it re-zeros the
 * reference so "where you point now" becomes forward.
 *
 * A final on-screen continuity clamp guarantees the beam can never jump more
 * than a set angle per frame, whatever the sensors do.
 */
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0), // phone top edge
  invert = new THREE.Vector3(1, 1, 1),
  sensitivity = 1.0, // 1.0 = direct 1:1
  maxStepDeg = 18, // on-screen continuity clamp (per frame)
} = {}) {
  const aimAxis2 = new THREE.Vector3(0, 0, 1); // screen normal (roll marker)
  const q = new THREE.Quaternion(); // gyro-integrated orientation (physical frame)
  const qRef = new THREE.Quaternion(); // recenter reference
  const qRefInv = new THREE.Quaternion();
  const qRel = new THREE.Quaternion();
  const qEff = new THREE.Quaternion();
  const finalQuat = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const absEuler = new THREE.Euler();
  const dir = new THREE.Vector3(0, 0, -1);
  const desired = new THREE.Vector3(0, 0, -1);
  const up = new THREE.Vector3(0, 1, 0);
  const tmpUp = new THREE.Vector3();
  const maxStep = maxStepDeg * DEG;

  let heading = null;
  let hasOrientation = false;
  let gyroActive = false;
  let seeded = false;
  let havePrev = false;
  let lastMotion = 0;
  let mode = "imu";
  let manualYaw = 0;
  let manualPitch = 0;
  const lastOri = { alpha: 0, beta: 0, gamma: 0 };
  const lastRate = { alpha: 0, beta: 0, gamma: 0 };

  // ---- inputs ---------------------------------------------------------------

  // DeviceOrientation: only used to seed the initial tilt (once) + diagnostics.
  function onDeviceOrientation(e) {
    let aDeg = e.alpha || 0;
    if (e.webkitCompassHeading != null) {
      heading = e.webkitCompassHeading;
      aDeg = 360 - heading;
    } else if (e.absolute === true && e.alpha != null) {
      heading = (360 - e.alpha) % 360;
    }
    lastOri.alpha = aDeg;
    lastOri.beta = e.beta || 0;
    lastOri.gamma = e.gamma || 0;
    hasOrientation = true;
    if (!seeded) {
      const a = aDeg * DEG;
      const b = (e.beta || 0) * DEG;
      const g = (e.gamma || 0) * DEG;
      euler.set(b, a, -g, "YXZ");
      q.setFromEuler(euler);
      qRef.copy(q);
      seeded = true;
    }
  }

  // DeviceMotion: the real driver — integrate body rate into the quaternion.
  function onDeviceMotion(e) {
    if (mode !== "imu") return;
    const rr = e.rotationRate;
    if (!rr) return;
    const now = performance.now();
    let dt = lastMotion ? (now - lastMotion) / 1000 : 0.016;
    lastMotion = now;
    if (!(dt > 0) || dt > 0.1) dt = 0.016;
    if (!seeded) {
      qRef.copy(q);
      seeded = true;
    }
    gyroActive = true;
    lastRate.alpha = rr.alpha || 0;
    lastRate.beta = rr.beta || 0;
    lastRate.gamma = rr.gamma || 0;
    // W3C: rotationRate.beta=about X, gamma=about Y, alpha=about Z (deg/s)
    const wx = (rr.beta || 0) * DEG;
    const wy = (rr.gamma || 0) * DEG;
    const wz = (rr.alpha || 0) * DEG;
    const mag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (mag < 1e-7) return;
    const ang = mag * dt;
    const s = Math.sin(ang / 2) / mag;
    dq.set(wx * s, wy * s, wz * s, Math.cos(ang / 2));
    q.multiply(dq).normalize(); // pure quaternion integration — no poles
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
      qRef.copy(q); // "forward" = where you point now
      havePrev = false; // snap the beam to the new forward
    }
  }

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
      desired
        .set(Math.sin(manualYaw) * cp, Math.sin(manualPitch), Math.cos(manualYaw) * cp)
        .multiply(invert)
        .normalize();
      dir.copy(desired);
      havePrev = true;
      tmpUp.set(0, 1, 0);
      up.copy(tmpUp).addScaledVector(dir, -tmpUp.dot(dir));
      if (up.lengthSq() < 1e-4) up.set(0, 0, 1);
      up.normalize();
      return dir;
    }

    // beam orientation = phone rotation since recenter (amplified by sensitivity).
    // Q_FLAT is a LEFT frame-transform (Z-up world -> render Y-up); putting it on
    // the right would make yaw rotate about the beam's own axis (beam wouldn't move).
    qRefInv.copy(qRef).invert();
    qRel.copy(q).multiply(qRefInv); // world-frame rotation from recenter to now
    scaleAngle(qRel, sensitivity, qEff);
    finalQuat.copy(Q_FLAT).multiply(qEff);
    desired.copy(aimAxis).applyQuaternion(finalQuat).multiply(invert).normalize();

    // on-screen continuity clamp: the beam can never teleport
    if (!havePrev) {
      dir.copy(desired);
      havePrev = true;
    } else {
      const a = dir.angleTo(desired);
      if (a > maxStep && a > 1e-6) dir.lerp(desired, maxStep / a).normalize();
      else dir.copy(desired);
    }

    up.copy(aimAxis2).applyQuaternion(finalQuat).normalize();
    return dir;
  }

  function target(reach, out = new THREE.Vector3()) {
    return out.copy(dir).multiplyScalar(reach).add(origin);
  }

  return {
    onDeviceOrientation,
    onDeviceMotion,
    setManualAim,
    setAimMode,
    recenter,
    update,
    target,
    setSensitivity(k) {
      sensitivity = k;
    },
    /** render-frame orientation of the phone (for the hologram) = Q_FLAT * qEff */
    getOrientation(out) {
      return out.copy(finalQuat);
    },
    get debugInfo() {
      absEuler.setFromQuaternion(qEff, "YXZ");
      return {
        mode,
        ori: lastOri,
        rate: lastRate,
        abs: { pitch: absEuler.x / DEG, yaw: absEuler.y / DEG, roll: absEuler.z / DEG },
        hasOrientation,
        gyroActive,
      };
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
    get gyroActive() {
      return gyroActive;
    },
    get mode() {
      return mode;
    },
    get isManual() {
      return mode === "manual";
    },
  };
}

/** iOS needs a user gesture + HTTPS to grant motion AND orientation. */
export async function requestOrientationPermission() {
  const reqs = [];
  const DO = window.DeviceOrientationEvent;
  const DM = window.DeviceMotionEvent;
  if (DO && typeof DO.requestPermission === "function") reqs.push(DO.requestPermission());
  if (DM && typeof DM.requestPermission === "function") reqs.push(DM.requestPermission());
  if (reqs.length) {
    const res = await Promise.all(reqs);
    if (res.some((r) => r !== "granted")) throw new Error("motion/orientation permission denied");
  }
}

/** Needs DeviceMotion (gyro). Orientation only seeds the initial tilt. */
export function listenOrientation(pointer) {
  window.addEventListener("deviceorientation", pointer.onDeviceOrientation);
  window.addEventListener("devicemotion", pointer.onDeviceMotion);
}
