import * as THREE from "three";

// -90deg about X: device screen-normal (+Z) -> world up (+Y); flat phone = level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const DEG = Math.PI / 180;

/**
 * Drift-free orientation -> direction control.
 *
 * Gimbal lock is the enemy: DeviceOrientation gives Euler angles (alpha/beta/
 * gamma) which TELEPORT the reconstructed direction near beta = +/-90 even when
 * the phone moved smoothly. The robust fix (what ARKit/ARCore do) is to drive
 * the orientation from the GYROSCOPE (DeviceMotion.rotationRate), which is
 * gimbal-free, and use the Euler reading only as a slow drift correction that is
 * GATED so its singularity jumps are never injected.
 *
 *   - gyro mode (default, when DeviceMotion is available): integrate body-rate
 *     into a quaternion; gently pull toward the Euler orientation only when the
 *     two agree (no jump). Smooth through full rotations.
 *   - fallback mode: Euler quaternion + the same jump gate (hold/snap).
 *   - manual mode: setManualAim(yaw,pitch) for drag/keys.
 *
 * State quaternion `q` is the device->world orientation in the PHYSICAL device
 * frame; the rendered direction uses q * Q_FLAT.
 */
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0), // phone top edge; use (0,0,-1) for back camera
  invert = new THREE.Vector3(1, 1, 1),
  smoothing = 0.25,
} = {}) {
  const aimAxis2 = new THREE.Vector3(0, 0, 1); // phone screen normal (roll marker)
  const absQuat = new THREE.Quaternion(); // from Euler (physical frame, no Q_FLAT)
  const q = new THREE.Quaternion(); // fused orientation state (physical frame)
  const offsetInv = new THREE.Quaternion(); // recenter
  const finalQuat = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const dir = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 0, 1);
  const tmpUp = new THREE.Vector3();
  const dCur = new THREE.Vector3();
  const dAbs = new THREE.Vector3();
  const euler = new THREE.Euler();

  let heading = null;
  let hasOrientation = false;
  let mode = "imu"; // "imu" | "manual"
  let manualYaw = 0;
  let manualPitch = 0;

  // gyro fusion
  let gyroEnabled = true;
  let gyroActive = false; // became true once real rotationRate arrived
  let lastMotion = 0;

  // jump gate (shared by fallback + drift-correction trust)
  let oriInit = false;
  let rejectFrames = 0;
  let jumpGate = 0.8; // rad (~46deg) max plausible beam move between frames
  const MAX_REJECT = 12;
  const CORRECT_GAIN = 0.05; // how fast gyro is pulled toward (trusted) Euler
  let rejecting = false;

  // ---- inputs ---------------------------------------------------------------

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
    euler.set(b, a, -g, "YXZ");
    absQuat.setFromEuler(euler); // physical frame (Q_FLAT applied later)
    if (!oriInit) {
      q.copy(absQuat);
      oriInit = true;
    }
    hasOrientation = true;
  }

  /** Integrate gyroscope body rates (deg/s) into the orientation quaternion. */
  function onDeviceMotion(e) {
    if (mode !== "imu" || !gyroEnabled) return;
    const rr = e.rotationRate;
    if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
    const now = e.timeStamp || performance.now();
    let dt = e.interval || (lastMotion ? (now - lastMotion) / 1000 : 0.016);
    lastMotion = now;
    dt = Math.min(0.05, Math.max(0.001, dt));
    // W3C: rotationRate.beta=about X, gamma=about Y, alpha=about Z (deg/s)
    const wx = (rr.beta || 0) * DEG;
    const wy = (rr.gamma || 0) * DEG;
    const wz = (rr.alpha || 0) * DEG;
    const mag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (mag < 1e-6) return;
    const angle = mag * dt;
    if (Math.abs(angle) < 1e-7) return;
    const s = Math.sin(angle / 2) / mag;
    dq.set(wx * s, wy * s, wz * s, Math.cos(angle / 2));
    q.multiply(dq).normalize(); // body-frame integration
    if (oriInit) gyroActive = true;
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
      offsetInv.copy(finalQuat).invert();
    }
  }

  // ---- per-frame update -----------------------------------------------------

  function dirFrom(physQuat, out) {
    return out
      .copy(aimAxis)
      .applyQuaternion(physQuat)
      .applyQuaternion(Q_FLAT)
      .applyQuaternion(offsetInv)
      .multiply(invert)
      .normalize();
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

    // how far is the Euler reading from the current beam? big = singularity glitch
    dirFrom(q, dCur);
    dirFrom(absQuat, dAbs);
    const jump = dCur.angleTo(dAbs);

    if (gyroEnabled && gyroActive) {
      // gyro already advanced q; only correct toward Euler when it's trustworthy
      if (jump <= jumpGate) q.slerp(absQuat, CORRECT_GAIN);
      rejecting = jump > jumpGate;
    } else {
      // fallback: follow Euler, hold through a glitch, snap only if sustained
      if (jump <= jumpGate) {
        q.slerp(absQuat, smoothing);
        rejectFrames = 0;
        rejecting = false;
      } else if (rejectFrames >= MAX_REJECT) {
        q.copy(absQuat);
        rejectFrames = 0;
        rejecting = false;
      } else {
        rejectFrames++;
        rejecting = true;
      }
    }

    finalQuat.copy(q).multiply(Q_FLAT);
    dir
      .copy(aimAxis)
      .applyQuaternion(finalQuat)
      .applyQuaternion(offsetInv)
      .multiply(invert)
      .normalize();
    up
      .copy(aimAxis2)
      .applyQuaternion(finalQuat)
      .applyQuaternion(offsetInv)
      .normalize();
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
    setSmoothing(a) {
      smoothing = a;
    },
    setJumpGate(rad) {
      jumpGate = rad;
    },
    setGyro(on) {
      gyroEnabled = !!on;
      if (!on) gyroActive = false; // resync to Euler on next frame
    },
    get gyroEnabled() {
      return gyroEnabled;
    },
    get gyroActive() {
      return gyroActive;
    },
    get rejecting() {
      return rejecting;
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

/** Attach to the best available orientation + motion events. */
export function listenOrientation(pointer) {
  if ("ondeviceorientationabsolute" in window) {
    window.addEventListener("deviceorientationabsolute", pointer.onDeviceOrientation);
  }
  window.addEventListener("deviceorientation", pointer.onDeviceOrientation);
  window.addEventListener("devicemotion", pointer.onDeviceMotion);
}
