import * as THREE from "three";

/**
 * A sphere of radius `R` partitioned into pyramid/frustum cells in spherical
 * coordinates (r, theta, phi). Up axis is world +Y.
 *
 *   r     in [0, R]   split into Rdiv concentric shells
 *   theta in [0, pi]  polar angle from +Y, split into Tdiv bands
 *   phi   in [0, 2pi) azimuth around +Y, split into Pdiv sectors
 *
 * Each cell is a curved truncated pyramid (frustum) with its apex toward the
 * center; the innermost shell collapses to true pyramids. The grid is implicit:
 * we never instantiate cells, we compute the cell an arbitrary point falls in.
 */
export class SphericalGrid {
  constructor({
    R = 1,
    Rdiv = 6,
    Tdiv = 12,
    Pdiv = 24,
    origin = new THREE.Vector3(),
  } = {}) {
    this.R = R;
    this.Rdiv = Rdiv;
    this.Tdiv = Tdiv;
    this.Pdiv = Pdiv;
    this.origin = origin.clone();
  }

  get cellCount() {
    return this.Rdiv * this.Tdiv * this.Pdiv;
  }

  pack(ir, it, ip) {
    return (ir * this.Tdiv + it) * this.Pdiv + ip;
  }

  unpack(id) {
    const ip = id % this.Pdiv;
    const it = Math.floor(id / this.Pdiv) % this.Tdiv;
    const ir = Math.floor(id / (this.Pdiv * this.Tdiv));
    return { ir, it, ip };
  }

  /** World point -> cell id, or -1 if the point is outside the sphere. */
  cellAt(point) {
    const vx = point.x - this.origin.x;
    const vy = point.y - this.origin.y;
    const vz = point.z - this.origin.z;
    const r = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (r > this.R) return -1;

    const theta = r === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, vy / r)));
    let phi = Math.atan2(vz, vx);
    if (phi < 0) phi += Math.PI * 2;

    const ir = Math.min(this.Rdiv - 1, Math.floor((r / this.R) * this.Rdiv));
    const it = Math.min(this.Tdiv - 1, Math.floor((theta / Math.PI) * this.Tdiv));
    const ip = Math.floor((phi / (Math.PI * 2)) * this.Pdiv) % this.Pdiv;
    return this.pack(ir, it, ip);
  }

  /** Spherical (r, theta, phi) -> world Cartesian (Vector3). */
  _toCartesian(r, theta, phi, out = new THREE.Vector3()) {
    const st = Math.sin(theta);
    return out.set(
      this.origin.x + r * st * Math.cos(phi),
      this.origin.y + r * Math.cos(theta),
      this.origin.z + r * st * Math.sin(phi)
    );
  }

  /**
   * The 8 world-space corners of a cell, ordered by the bit pattern
   * index = ri*4 + ti*2 + pi  (ri,ti,pi each 0 = low bound, 1 = high bound).
   */
  cellCorners(id, out = []) {
    const { ir, it, ip } = this.unpack(id);
    const r0 = (ir / this.Rdiv) * this.R;
    const r1 = ((ir + 1) / this.Rdiv) * this.R;
    const t0 = (it / this.Tdiv) * Math.PI;
    const t1 = ((it + 1) / this.Tdiv) * Math.PI;
    const p0 = (ip / this.Pdiv) * Math.PI * 2;
    const p1 = ((ip + 1) / this.Pdiv) * Math.PI * 2;
    const rs = [r0, r1];
    const ts = [t0, t1];
    const ps = [p0, p1];
    let k = 0;
    for (let ri = 0; ri < 2; ri++)
      for (let ti = 0; ti < 2; ti++)
        for (let pi = 0; pi < 2; pi++) {
          out[k] = this._toCartesian(rs[ri], ts[ti], ps[pi], out[k]);
          k++;
        }
    out.length = 8;
    return out;
  }

  cellCenter(id, out = new THREE.Vector3()) {
    const { ir, it, ip } = this.unpack(id);
    const r = ((ir + 0.5) / this.Rdiv) * this.R;
    const theta = ((it + 0.5) / this.Tdiv) * Math.PI;
    const phi = ((ip + 0.5) / this.Pdiv) * Math.PI * 2;
    return this._toCartesian(r, theta, phi, out);
  }

  /**
   * A conservative step length for walking a segment without skipping cells
   * (used by the line-fill brush). Half the smallest cell extent over the grid.
   */
  sampleStep() {
    return this.R / (2 * Math.max(this.Rdiv, this.Tdiv, this.Pdiv));
  }
}
