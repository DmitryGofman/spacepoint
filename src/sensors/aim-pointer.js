import * as THREE from "three";

// -90deg about X: device screen-normal (+Z) -> world up (+Y); flat phone = level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const DEG = Math.PI / 180;

/**
 * Direct orientation control (the version that felt best) that ALSO never jumps.
 *
 * Primary = absolute DeviceOrientation: quaternion = Euler(beta,alpha,-gamma,YXZ)
 * -> the beam locks to your true, compass-referenced orientation (direct, 1:1).
 *
 * The only failure of that path is gimbal lock: as the phone passes straight
 * up/down, the reported Euler angles teleport for a few frames. So we also
 * integrate the GYROSCOPE (DeviceMotion.rotationRate) as a gimbal-free backup:
 * every frame the beam is normally snapped to the absolute reading, but when the
 * absolute reading disagrees violently with where the gyro says we are (a
 * singularity glitch), we let the gyro carry the beam smoothly through it and
 * resume the absolute lock the instant the reading is sane again. No hold, no
 * snap -> a full circle stays continuous.
 *
 * All quaternions here are in the PHYSICAL device frame; Q_FLAT is applied only
 * at the output.
 */
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0), // phone top edge
  invert = new THREE.Vector3(1, 1, 1),
  smoothing = 0.5, // how tightly the beam locks to the absolute reading
  sensitivity = 1.0, // 1.0 = direct 1:1
} = {}) {
  const aimAxis2 = new THREE.Vector3(0, 0, 1); // screen normal (roll marker)
  const qAbs = new THREE.Quaternion(); // absolute orientation from Euler (physical)
  const q = new THREE.Quaternion(); // working orientation (gyro-carried + abs-locked)
  const qRef = new THREE.Quaternion(); // recenter reference (physical)
  const qRefInv = new THREE.Quaternion();
  const qRel = new THREE.Quaternion();
  const qEff = new THREE.Quaternion();
  const finalQuat = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const dir = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 0, 1);
  const tmpUp = new THREE.Vector3();
  const euler = new THREE.Euler();

  let heading = null;
  let hasOrientation = false;
  let oriInit = false;
  let gyroActive = false;
  let lastMotion = 0;
  let mode = "imu";
  let manualYaw = 0;
  let manualPitch = 0;
  const lastOri = { alpha: 0, beta: 0, gamma: 0 };

  let bridging = false;
  let jumpGate = 0.9; // rad (~52deg): abs-vs-gyro disagreement that means "glitch"

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
    lastOri.alpha = aDeg;
    lastOri.beta = e.beta || 0;
    lastOri.gamma = e.gamma || 0;
    euler.set(b, a, -g, "YXZ");
    qAbs.setFromEuler(euler); // physical (Q_FLAT applied at output)
    if (!oriInit) {
      q.copy(qAbs);
      qRef.copy(qAbs);
      oriInit = true;
    }
    hasOrientation = true;
  }

  /** Integrate gyroscope body rate into q (gimbal-free bridge). */
  function onDeviceMotion(e) {
    if (mode !== "imu") return;
    const rr = e.rotationRate;
    if (!rr) return;
    const now = performance.now();
    let dt = lastMotion ? (now - lastMotion) / 1000 : 0.016;
    lastMotion = now;
    if (!(dt > 0) || dt > 0.1) dt = 0.016;
    gyroActive = true;
    const wx = (rr.beta || 0) * DEG;
    const wy = (rr.gamma || 0) * DEG;
    const wz = (rr.alpha || 0) * DEG;
    const mag = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (mag < 1e-7) return;
    const ang = mag * dt;
    const s = Math.sin(ang / 2) / mag;
    dq.set(wx * s, wy * s, wz * s, Math.cos(ang / 2));
    q.multiply(dq).normalize(); // body-frame integration
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
      qRef.copy(q);
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

    // q was carried by the gyro since last frame. Lock it to the absolute
    // reading UNLESS the two disagree violently -> that's a gimbal glitch, so
    // let the gyro keep carrying (smooth bridge) until the reading is sane again.
    if (oriInit) {
      const disagree = q.angleTo(qAbs);
      if (!gyroActive) {
        q.slerp(qAbs, smoothing); // no gyro available: plain direct control
        bridging = false;
      } else if (disagree <= jumpGate) {
        q.slerp(qAbs, smoothing); // absolute is trustworthy -> lock (direct feel)
        bridging = false;
      } else {
        bridging = true; // glitch: gyro bridges, no lock this frame
      }
    }

    // amplify deviation from recenter (sensitivity 1.0 -> untouched)
    qRefInv.copy(qRef).invert();
    qRel.copy(q).multiply(qRefInv);
    scaleAngle(qRel, sensitivity, qRel);
    qEff.copy(qRel).multiply(qRef);
    finalQuat.copy(qEff).multiply(Q_FLAT);

    dir.copy(aimAxis).applyQuaternion(finalQuat).multiply(invert).normalize();
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
      return { mode, ori: lastOri, hasOrientation, gyroActive, bridging };
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

/** Attach to orientation (absolute preferred) + motion (gyro bridge). */
export function listenOrientation(pointer) {
  if ("ondeviceorientationabsolute" in window) {
    window.addEventListener("deviceorientationabsolute", pointer.onDeviceOrientation);
  }
  window.addEventListener("deviceorientation", pointer.onDeviceOrientation);
  window.addEventListener("devicemotion", pointer.onDeviceMotion);
}
