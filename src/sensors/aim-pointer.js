import * as THREE from "three";

// -90deg about X: device screen-normal (+Z) -> world up (+Y); flat phone = level.
const Q_FLAT = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

/**
 * Drift-free orientation -> direction control, improved for sculpting:
 *  - quaternion smoothing (slerp toward the raw reading) to kill hand jitter
 *  - recenter(): make wherever you point "forward"
 *  - absolute heading when available (iOS webkitCompassHeading / Android absolute)
 *  - desktop fallback: setManualAim(yaw, pitch) when there is no IMU
 *
 * direction = offset^-1 . smoothedQuat . aimAxis    (then per-axis invert)
 */
export function createAimPointer({
  origin = new THREE.Vector3(),
  aimAxis = new THREE.Vector3(0, 1, 0), // phone top edge; use (0,0,-1) for back camera
  invert = new THREE.Vector3(1, 1, 1),
  smoothing = 0.25,
} = {}) {
  const aimAxis2 = new THREE.Vector3(0, 0, 1); // phone screen normal (for the roll marker)
  const rawQuat = new THREE.Quaternion();
  const smoothQuat = new THREE.Quaternion();
  const offsetInv = new THREE.Quaternion(); // applied after smoothing (recenter)
  const dir = new THREE.Vector3(0, 1, 0);
  const up = new THREE.Vector3(0, 0, 1); // screen-normal direction in world space
  const tmpUp = new THREE.Vector3();
  const euler = new THREE.Euler();
  let heading = null;
  let hasOrientation = false;
  let mode = "imu"; // "imu" = device orientation, "manual" = yaw/pitch (drag/keys)
  let manualYaw = 0;
  let manualPitch = 0;

  function onDeviceOrientation(e) {
    if (mode !== "imu") return; // ignore the IMU while in drag/manual mode
    let aDeg = e.alpha || 0;
    if (e.webkitCompassHeading != null) {
      heading = e.webkitCompassHeading; // iOS absolute heading
      aDeg = 360 - heading;
    } else if (e.absolute === true && e.alpha != null) {
      heading = (360 - e.alpha) % 360; // Android absolute orientation
    }
    const a = (aDeg * Math.PI) / 180;
    const b = ((e.beta || 0) * Math.PI) / 180;
    const g = ((e.gamma || 0) * Math.PI) / 180;
    euler.set(b, a, -g, "YXZ");
    rawQuat.setFromEuler(euler).multiply(Q_FLAT);
    hasOrientation = true;
  }

  /** Drag / keyboard aim: yaw (around +Y) and pitch (up/down), radians. */
  function setManualAim(yaw, pitch) {
    mode = "manual";
    manualYaw = yaw;
    manualPitch = Math.max(-1.5533, Math.min(1.5533, pitch));
  }

  /** Switch between "imu" (phone orientation) and "manual" (drag/keys) aim. */
  function setAimMode(m) {
    mode = m === "manual" ? "manual" : "imu";
  }

  /** Capture the current orientation as the new "forward" reference. */
  function recenter() {
    if (mode === "manual") {
      manualYaw = 0;
      manualPitch = 0;
    } else {
      offsetInv.copy(smoothQuat).invert();
    }
  }

  /** Advance smoothing + recompute the aim direction. Call once per frame. */
  function update() {
    if (mode === "manual") {
      const cp = Math.cos(manualPitch);
      dir
        .set(
          Math.sin(manualYaw) * cp,
          Math.sin(manualPitch),
          Math.cos(manualYaw) * cp
        )
        .multiply(invert)
        .normalize();
      // no real roll in manual mode: point the screen marker "up" relative to aim
      tmpUp.set(0, 1, 0);
      up.copy(tmpUp).addScaledVector(dir, -tmpUp.dot(dir));
      if (up.lengthSq() < 1e-4) up.set(0, 0, 1);
      up.normalize();
      return dir;
    }
    smoothQuat.slerp(rawQuat, smoothing);
    dir
      .copy(aimAxis)
      .applyQuaternion(smoothQuat)
      .applyQuaternion(offsetInv)
      .multiply(invert)
      .normalize();
    up
      .copy(aimAxis2)
      .applyQuaternion(smoothQuat)
      .applyQuaternion(offsetInv)
      .normalize();
    return dir;
  }

  /** World-space target point at distance `reach` along the aim direction. */
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

/** iOS needs a user gesture + HTTPS to grant motion/orientation. */
export async function requestOrientationPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    const res = await D.requestPermission(); // must be called from a tap handler
    if (res !== "granted") throw new Error("orientation permission denied");
  }
}

/** Attach to the best available orientation event (absolute preferred). */
export function listenOrientation(pointer) {
  if ("ondeviceorientationabsolute" in window) {
    window.addEventListener(
      "deviceorientationabsolute",
      pointer.onDeviceOrientation
    );
  }
  window.addEventListener("deviceorientation", pointer.onDeviceOrientation);
}
